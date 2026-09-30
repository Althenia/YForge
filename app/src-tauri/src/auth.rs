use std::collections::HashMap;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Runtime};
use yforge_core::{AuthHandler, AuthPromptEvent, AuthReply};

pub const AUTH_PROMPT_EVENT: &str = "auth-prompt";
pub const AUTH_TIMEOUT: Duration = Duration::from_secs(120);

struct Pending {
    operation: String,
    reply: Sender<AuthReply>,
}

#[derive(Clone, Default)]
pub struct PromptRegistry(Arc<Mutex<HashMap<String, Pending>>>);

pub fn reply_name(reply: &AuthReply) -> &'static str {
    match reply {
        AuthReply::Credentials { .. } => "credentials",
        AuthReply::Trust => "trust",
        AuthReply::Cancel => "cancel",
        AuthReply::TimedOut => "timed_out",
    }
}

impl PromptRegistry {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Pending>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn insert(&self, id: String, operation: String, reply: Sender<AuthReply>) {
        self.lock().insert(id, Pending { operation, reply });
    }

    fn remove(&self, id: &str) {
        self.lock().remove(id);
    }

    pub fn respond(&self, id: &str, reply: AuthReply) -> bool {
        match self.lock().remove(id) {
            Some(pending) => pending.reply.send(reply).is_ok(),
            None => false,
        }
    }

    pub fn cancel_operation(&self, operation: &str) {
        let mut pending = self.lock();
        let ids: Vec<String> = pending
            .iter()
            .filter(|(_, entry)| entry.operation == operation)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            if let Some(entry) = pending.remove(&id) {
                let _ = entry.reply.send(AuthReply::Cancel);
            }
        }
    }

    pub fn handler<R: Runtime>(
        &self,
        app: AppHandle<R>,
        operation: String,
        timeout: Duration,
    ) -> AuthHandler {
        let registry = self.clone();
        Arc::new(move |mut prompt| {
            let (sender, receiver) = mpsc::channel();
            prompt.id = format!("{operation}/{}", prompt.id);
            let id = prompt.id.clone();
            registry.insert(id.clone(), operation.clone(), sender);
            log::debug!(
                "auth-prompt operation={operation} id={id} kind={:?} host={:?}",
                prompt.kind,
                prompt.host
            );
            let payload = AuthPromptEvent {
                operation: operation.clone(),
                prompt,
            };
            if let Err(error) = app.emit(AUTH_PROMPT_EVENT, payload) {
                log::warn!("could not emit {AUTH_PROMPT_EVENT}: {error}");
            }
            let reply = receiver
                .recv_timeout(timeout)
                .unwrap_or(AuthReply::TimedOut);
            registry.remove(&id);
            log::debug!(
                "auth-reply operation={operation} id={id} reply={}",
                reply_name(&reply)
            );
            reply
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Listener;
    use yforge_core::{AuthKind, AuthPrompt};

    fn prompt() -> AuthPrompt {
        AuthPrompt {
            id: "auth-1".to_owned(),
            kind: AuthKind::Credentials,
            url: Some("https://example.test".to_owned()),
            host: Some("example.test".to_owned()),
            username: None,
            message: "example.test needs credentials.".to_owned(),
            fingerprint: None,
        }
    }

    fn ask(
        timeout: Duration,
    ) -> (
        PromptRegistry,
        std::sync::mpsc::Receiver<String>,
        std::thread::JoinHandle<AuthReply>,
    ) {
        let app = tauri::test::mock_app();
        let registry = PromptRegistry::default();
        let (events, received) = mpsc::channel();
        app.listen(AUTH_PROMPT_EVENT, move |event| {
            let _ = events.send(event.payload().to_owned());
        });
        let handler = registry.handler(app.handle().clone(), "op-1".to_owned(), timeout);
        let asking = std::thread::spawn(move || {
            let reply = handler(prompt());
            drop(app);
            reply
        });
        (registry, received, asking)
    }

    #[test]
    fn a_prompt_round_trips_through_the_event_and_the_response() {
        let (registry, received, asking) = ask(Duration::from_secs(10));

        let payload: serde_json::Value =
            serde_json::from_str(&received.recv_timeout(Duration::from_secs(10)).unwrap()).unwrap();
        assert_eq!(payload["operation"], "op-1");
        assert_eq!(payload["prompt"]["id"], "op-1/auth-1");
        assert_eq!(payload["prompt"]["kind"], "credentials");
        let reply = AuthReply::Credentials {
            username: Some("yui".into()),
            secret: "s3cret".into(),
            save: true,
        };
        assert!(registry.respond("op-1/auth-1", reply.clone()));

        assert_eq!(asking.join().unwrap(), reply);
        assert!(!registry.respond("op-1/auth-1", AuthReply::Cancel));
    }

    #[test]
    fn an_unanswered_prompt_times_out() {
        let (_registry, received, asking) = ask(Duration::from_millis(100));
        received.recv_timeout(Duration::from_secs(10)).unwrap();

        assert_eq!(asking.join().unwrap(), AuthReply::TimedOut);
    }

    #[test]
    fn cancelling_the_operation_answers_its_pending_prompts_with_cancel() {
        let (registry, received, asking) = ask(Duration::from_secs(10));
        received.recv_timeout(Duration::from_secs(10)).unwrap();

        registry.cancel_operation("op-1");

        assert_eq!(asking.join().unwrap(), AuthReply::Cancel);
    }

    #[test]
    fn reply_names_never_include_secrets() {
        let reply = AuthReply::Credentials {
            username: None,
            secret: "s3cret".into(),
            save: false,
        };
        assert_eq!(reply_name(&reply), "credentials");
    }
}
