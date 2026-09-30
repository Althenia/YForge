#[derive(Debug, Clone)]
pub struct Endpoints {
    pub openai_api: String,
    pub chatgpt_backend: String,
    pub anthropic_api: String,
    pub openrouter_api: String,
    pub openai_auth: String,
    pub claude_token: String,
    pub callback_port: u16,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            openai_api: "https://api.openai.com/v1".to_owned(),
            chatgpt_backend: "https://chatgpt.com/backend-api/codex".to_owned(),
            anthropic_api: "https://api.anthropic.com/v1".to_owned(),
            openrouter_api: "https://openrouter.ai/api/v1".to_owned(),
            openai_auth: "https://auth.openai.com".to_owned(),
            claude_token: "https://claude.ai/v1/oauth/token".to_owned(),
            callback_port: 1455,
        }
    }
}
