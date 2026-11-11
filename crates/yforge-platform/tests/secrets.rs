use yforge_core::{JiraKind, PlatformKind};
use yforge_platform::{NewConnection, NewJiraConnection};

#[test]
fn connection_debug_never_contains_platform_or_jira_tokens() {
    let platform = NewConnection {
        kind: PlatformKind::GitHub,
        host: "example.test".to_owned(),
        name: "Example".to_owned(),
        token: "synthetic-platform-secret".to_owned(),
        insecure_tls: false,
    };
    let jira = NewJiraConnection {
        kind: JiraKind::DataCenter,
        site: "https://issues.example.test".to_owned(),
        email: None,
        token: "synthetic-jira-secret".to_owned(),
    };
    assert!(!format!("{platform:?}").contains("synthetic-platform-secret"));
    assert!(!format!("{jira:?}").contains("synthetic-jira-secret"));
}
