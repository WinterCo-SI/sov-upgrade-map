use std::{env, path::PathBuf, time::Duration};

pub const ESI_BASE_URL: &str = "https://esi.evetech.net";
pub const DEFAULT_USER_AGENT: &str = "sov-upgrade-map/0.1 (https://esi.evetech.net)";
pub const EVE_SSO_AUTHORIZE_URL: &str = "https://login.eveonline.com/v2/oauth/authorize";
pub const DEFAULT_EVE_SSO_SCOPES: &str = "esi-structures.read_corporation.v1";
pub const COMPATIBILITY_DATE: &str = "2026-06-09";
pub const SOVEREIGNTY_REFRESH: Duration = Duration::from_secs(5 * 60);
pub const SKYHOOK_REFRESH: Duration = Duration::from_secs(15 * 60);
pub const HUB_DETAIL_REFRESH: Duration = Duration::from_secs(15 * 60);
pub const HUB_DETAIL_CONCURRENCY: usize = 8;

#[derive(Clone, Debug)]
pub struct Config {
    pub esi_base_url: String,
    pub user_agent: String,
    pub token_file: PathBuf,
    pub eve_sso_authorize_url: String,
    pub eve_sso_client_id: Option<String>,
    pub eve_sso_redirect_uri: Option<String>,
    pub eve_sso_scopes: Vec<String>,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            esi_base_url: env_or_default("ESI_BASE_URL", ESI_BASE_URL),
            user_agent: env_or_default("ESI_USER_AGENT", DEFAULT_USER_AGENT),
            token_file: optional_env("SOV_TOKEN_FILE")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("tokens.json")),
            eve_sso_authorize_url: env_or_default("EVE_SSO_AUTHORIZE_URL", EVE_SSO_AUTHORIZE_URL),
            eve_sso_client_id: optional_env("EVE_SSO_CLIENT_ID"),
            eve_sso_redirect_uri: optional_env("EVE_SSO_REDIRECT_URI"),
            eve_sso_scopes: optional_env("EVE_SSO_SCOPES")
                .map(|value| parse_scopes(&value))
                .filter(|scopes| !scopes.is_empty())
                .unwrap_or_else(|| parse_scopes(DEFAULT_EVE_SSO_SCOPES)),
        }
    }
}

pub fn parse_scopes(value: &str) -> Vec<String> {
    value
        .split(|character: char| character == ',' || character.is_whitespace())
        .map(str::trim)
        .filter(|scope| !scope.is_empty())
        .map(str::to_string)
        .collect()
}

fn env_or_default(name: &str, default: &str) -> String {
    optional_env(name).unwrap_or_else(|| default.to_string())
}

fn optional_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
