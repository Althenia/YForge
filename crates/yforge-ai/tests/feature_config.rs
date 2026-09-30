mod common;

use common::{
    add_active, commit_context, http_input, keyed_input, provider_input, Harness, HttpFake, Reply,
    GOOD,
};
use serde_json::{json, Value};
use yforge_ai::{Ai, AiError, Endpoints};
use yforge_core::{
    AiFeature, AiFeatureConfig, AuthMode, CancelToken, CoreError, ErrorKind, ProviderKind,
};

fn kind_of(error: AiError) -> ErrorKind {
    CoreError::from(error).kind()
}

fn config(
    feature: AiFeature,
    provider_id: &str,
    model_id: &str,
    template: &str,
) -> AiFeatureConfig {
    AiFeatureConfig {
        feature,
        provider_id: provider_id.to_owned(),
        model_id: model_id.to_owned(),
        prompt_template: template.to_owned(),
    }
}

fn model_list_fake() -> HttpFake {
    HttpFake::start(|request| {
        if request.path.ends_with("/models") {
            Reply::ok(&json!({"data": [{"id": "listed-model"}]}).to_string())
        } else {
            Reply::ok(&common::chat_reply(GOOD))
        }
    })
}

async fn endpoint_provider(h: &Harness, ai: &Ai, fake: &HttpFake, name: &str) -> String {
    ai.add(h.dir(), http_input(name, &fake.url, None))
        .await
        .unwrap()
        .config
        .id
}

#[tokio::test]
async fn every_feature_starts_unset_with_its_default_prompt_containing_the_placeholder() {
    let h = Harness::new();

    let summaries = h.ai().feature_configs(h.dir()).await.unwrap();

    assert_eq!(
        summaries.iter().map(|s| s.feature).collect::<Vec<_>>(),
        AiFeature::ALL
    );
    for summary in &summaries {
        assert_eq!(summary.config, None);
        assert_eq!(
            summary.default_prompt_template.matches("{context}").count(),
            1
        );
    }
    assert!(summaries[0]
        .default_prompt_template
        .contains("Git commit messages"));
    assert!(summaries[1].default_prompt_template.contains("regroup"));
    assert!(summaries[2]
        .default_prompt_template
        .contains("merge conflicts"));
}

#[tokio::test]
async fn saving_needs_the_placeholder_a_listed_model_and_a_signed_in_provider() {
    let h = Harness::new();
    let fake = model_list_fake();
    let ai = h.ai();
    let id = endpoint_provider(&h, &ai, &fake, "Local").await;
    let keyless = ai
        .add(
            h.dir(),
            provider_input(ProviderKind::Claude, AuthMode::ApiKey, "Claude"),
        )
        .await
        .unwrap()
        .config
        .id;

    let cases = [
        (
            config(AiFeature::Recompose, &id, "listed-model", "no placeholder"),
            ErrorKind::InvalidRequest,
        ),
        (
            config(
                AiFeature::Recompose,
                &id,
                "listed-model",
                "{context} {context}",
            ),
            ErrorKind::InvalidRequest,
        ),
        (
            config(AiFeature::Recompose, &id, "  ", "x {context}"),
            ErrorKind::InvalidRequest,
        ),
        (
            config(AiFeature::Recompose, &id, "invented-model", "x {context}"),
            ErrorKind::InvalidRequest,
        ),
        (
            config(AiFeature::Recompose, "nope", "listed-model", "x {context}"),
            ErrorKind::InvalidRequest,
        ),
        (
            config(AiFeature::Recompose, &keyless, "m", "x {context}"),
            ErrorKind::AiAuthRequired,
        ),
    ];
    for (bad, expected) in cases {
        let error = ai.set_feature(h.dir(), bad.clone()).await.unwrap_err();
        assert_eq!(kind_of(error), expected, "{bad:?}");
    }

    assert!(yforge_core::ai_feature_configs(h.dir()).unwrap().is_empty());
}

#[tokio::test]
async fn a_saved_feature_runs_on_its_own_provider_model_and_prompt_while_others_use_the_active_one()
{
    let h = Harness::new();
    let active = model_list_fake();
    let feature_fake = model_list_fake();
    let ai = h.ai();
    let active_id = endpoint_provider(&h, &ai, &active, "Active").await;
    yforge_core::ai_choose(h.dir(), Some(&active_id), Some("active-model")).unwrap();
    let feature_id = endpoint_provider(&h, &ai, &feature_fake, "Feature").await;

    let saved = ai
        .set_feature(
            h.dir(),
            config(
                AiFeature::GenerateCommit,
                &feature_id,
                " listed-model ",
                "Be terse.\n{context}\nJSON only.",
            ),
        )
        .await
        .unwrap();
    let commit = ai
        .resolve(h.dir(), AiFeature::GenerateCommit)
        .await
        .unwrap();
    let other = ai.resolve(h.dir(), AiFeature::Recompose).await.unwrap();
    ai.commit_message(&commit, &commit_context(), &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(
        saved.config.unwrap(),
        config(
            AiFeature::GenerateCommit,
            &feature_id,
            "listed-model",
            "Be terse.\n{context}\nJSON only."
        )
    );
    assert_eq!(
        (commit.config.id.as_str(), commit.model.as_str()),
        (feature_id.as_str(), "listed-model")
    );
    assert_eq!(
        (other.config.id.as_str(), other.model.as_str()),
        (active_id.as_str(), "active-model")
    );
    let runs: Vec<_> = feature_fake
        .requests()
        .into_iter()
        .filter(|r| r.path.ends_with("/chat/completions"))
        .collect();
    assert_eq!(runs.len(), 1);
    let sent: Value = serde_json::from_str(&runs[0].body).unwrap();
    assert_eq!(sent["model"], "listed-model");
    assert_eq!(sent["messages"][0]["content"], "Be terse.");
    let user = sent["messages"][1]["content"].as_str().unwrap();
    assert!(user.contains("+DIFF-MARKER") && user.ends_with("\nJSON only."));
    assert!(active
        .requests()
        .iter()
        .all(|r| r.path.ends_with("/models")));
}

#[tokio::test]
async fn a_feature_with_its_own_config_needs_no_active_provider() {
    let h = Harness::new();
    let fake = model_list_fake();
    let ai = h.ai();
    let id = endpoint_provider(&h, &ai, &fake, "Local").await;
    ai.set_feature(
        h.dir(),
        config(AiFeature::ConflictFix, &id, "listed-model", "{context}"),
    )
    .await
    .unwrap();

    let conflict = ai.resolve(h.dir(), AiFeature::ConflictFix).await.unwrap();
    let unset = ai.resolve(h.dir(), AiFeature::Recompose).await.unwrap_err();

    assert_eq!(conflict.model, "listed-model");
    assert_eq!(kind_of(unset), ErrorKind::AiNotConfigured);
}

#[tokio::test]
async fn resetting_a_feature_returns_it_to_the_active_provider_and_the_default_prompt() {
    let h = Harness::new();
    let fake = model_list_fake();
    let ai = h.ai();
    let id = endpoint_provider(&h, &ai, &fake, "Local").await;
    yforge_core::ai_choose(h.dir(), Some(&id), Some("active-model")).unwrap();
    ai.set_feature(
        h.dir(),
        config(
            AiFeature::Recompose,
            &id,
            "listed-model",
            "Custom {context}",
        ),
    )
    .await
    .unwrap();

    let reset = ai
        .reset_feature(h.dir(), AiFeature::Recompose)
        .await
        .unwrap();
    let selection = ai.resolve(h.dir(), AiFeature::Recompose).await.unwrap();

    assert_eq!(reset.config, None);
    assert!(reset.default_prompt_template.contains("regroup"));
    assert_eq!(selection.model, "active-model");
    let listed = ai.feature_configs(h.dir()).await.unwrap();
    assert!(listed.iter().all(|summary| summary.config.is_none()));
}

#[tokio::test]
async fn removing_a_provider_drops_its_feature_configs() {
    let h = Harness::new();
    let fake = model_list_fake();
    let ai = h.ai_at(Endpoints::default());
    let id = endpoint_provider(&h, &ai, &fake, "Local").await;
    ai.set_feature(
        h.dir(),
        config(AiFeature::Recompose, &id, "listed-model", "{context}"),
    )
    .await
    .unwrap();
    add_active(
        &h,
        &ai,
        keyed_input(ProviderKind::Openrouter, "OR", "k"),
        "m",
    )
    .await;

    ai.remove(h.dir(), &id).await.unwrap();

    let listed = ai.feature_configs(h.dir()).await.unwrap();
    assert!(listed.iter().all(|summary| summary.config.is_none()));
}
