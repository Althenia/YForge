# AI Providers v2

Status: **approved 2026-09-30** (owner decision: ChatGPT API key + headless OAuth, Claude API key + Claude Code adapter, models API, per-feature model and prompt config)

## Provider matrix

| Kind | Auth | Run base | Models API |
|---|---|---|---|
| `chatgpt` | API key | `https://api.openai.com/v1` (Responses API) | `GET /v1/models` |
| `chatgpt` | Subscription (headless OAuth) | `https://chatgpt.com/backend-api/codex` (Responses API, OAuth Bearer) | `GET /models` with OAuth |
| `claude` | API key | `https://api.anthropic.com/v1` (Messages API, `x-api-key`) | `GET /v1/models` |
| `claude` | Subscription (Claude Code) | `https://api.anthropic.com/v1` (Messages API, OAuth Bearer + `anthropic-beta` flags, `x-app: cli`) | `GET /v1/models` with OAuth |
| `openrouter` | API key | `https://openrouter.ai/api/v1` (chat completions) | `GET /api/v1/models` |
| `openai_compatible` | API key | user base URL | `GET {base}/models` |

- Each provider row stores `auth_mode` (`api_key` | `subscription`). API keys and OAuth tokens live in the Keychain under YForge's own service; never in the database.
- **Connections are direct API calls, the YCoding pattern — no CLI spawn at run time.**
- **ChatGPT OAuth (YForge implements its own, per YCoding):**
  - client id `app_EMoamEEZ73f0CkXaXp7hrann`, issuer `https://auth.openai.com`;
  - browser flow: PKCE, `GET {issuer}/oauth/authorize` with scopes `openid profile email offline_access`, `codex_cli_simplified_flow=true`, `id_token_add_organizations=true`, `originator=yforge`, redirect `http://localhost:<port>/auth/callback` (local listener), exchange at `POST {issuer}/oauth/token` (`grant_type=authorization_code`);
  - headless flow: `POST {issuer}/api/accounts/deviceauth/usercode` `{client_id}` → `{device_auth_id, user_code, interval}`; show the code; poll `POST {issuer}/api/accounts/deviceauth/token` `{device_auth_id, user_code}` → `{authorization_code}`; exchange with redirect `{issuer}/deviceauth/callback`;
  - refresh: `POST {issuer}/oauth/token` (`grant_type=refresh_token`);
  - account id: JWT claim `chatgpt_account_id` (id_token, then access_token, then `https://api.openai.com/auth` claim, then `organizations[0].id`).
- **Claude Code subscription (YCoding pattern):** read the macOS Keychain service `Claude Code-credentials` (`claudeAiOauth` JSON: `accessToken`, `refreshToken`, `expiresAt`, `subscriptionType`); refresh via `POST https://claude.ai/v1/oauth/token` with client id `9d1c250a-e61b-44d9-88ed-5944d1962f5e`. Requires Claude Code installed and signed in; YForge reads, never writes, Claude Code's store.
- **Run requests:**
  - ChatGPT subscription: OpenAI Responses API at `https://chatgpt.com/backend-api/codex/responses`, `Authorization: Bearer`, `chatgpt-account-id: <account id>`;
  - ChatGPT API key: `https://api.openai.com/v1/responses` with `Authorization: Bearer`;
  - Claude (key or OAuth): `https://api.anthropic.com/v1/messages`; key uses `x-api-key`, OAuth uses `Authorization: Bearer` + `anthropic-version: 2023-06-01` + `anthropic-beta` flags + `x-app: cli`;
  - OpenRouter: `https://openrouter.ai/api/v1/chat/completions`;
  - OpenAI-compatible: `{base_url}/responses` (or `/chat/completions` per the existing adapter).

## Models API

- New command `ai_models(provider_id) -> ModelInfo[]` with `{ id, display_name, context_window }`.
- Every model picker in the UI is a dropdown fed by this command. Free-text model entry is removed.
- When the provider has no key / is not signed in, the picker shows the requirement ("Add an API key" / "Sign in") instead of a list.
- Model ids are validated against the listed set at save time.

## Per-feature configuration

- Features: `generate_commit`, `recompose`, `conflict_fix`.
- Each feature stores: `provider_id`, `model_id`, `prompt_template`. New store table `ai_feature_config` (migration 6), keyed by feature.
- `prompt_template` contains the `{context}` placeholder; the default is the current built-in prompt for that feature; "Reset to default" restores it.
- Settings UI: three feature cards (Generate commit, Recompose, Conflict fix), each with provider picker, model picker (models API), and prompt editor.
- `ai_run` dispatches through the per-feature config; a feature with no config uses the active provider and default prompt.
- The provider list and active-provider concept stays; per-feature config overrides it for that feature.

## Verification

- Adapters against fake `TcpListener` servers: request shape (method, path, headers, body), response mapping, 401/403 → `ai_auth_required`, models mapping.
- OAuth readers: fixture files for `~/.codex/auth.json` and a Keychain stub behind the existing `SecretStore` trait.
- Store: feature-config CRUD, migration bump to 6.
- Frontend: model picker from the API, feature cards, prompt editor with reset, run dispatch per feature.
- Live smoke (ignored test): ChatGPT subscription via the codex backend and Claude subscription via Keychain, one generate call each, on this machine.
