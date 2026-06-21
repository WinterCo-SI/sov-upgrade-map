use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect},
};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{config::parse_scopes, state::AppState};

#[derive(Debug, Deserialize)]
pub struct EveAuthorizeQuery {
    pub scope: Option<String>,
    pub scopes: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug)]
pub enum AuthorizeError {
    MissingConfig(&'static str),
    EmptyScopes,
    InvalidAuthorizeUrl(url::ParseError),
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: &'static str,
    message: String,
}

pub async fn eve_authorize(
    State(state): State<Arc<AppState>>,
    Query(query): Query<EveAuthorizeQuery>,
) -> impl IntoResponse {
    match build_eve_authorize_url(&state, &query) {
        Ok(url) => Redirect::temporary(url.as_str()).into_response(),
        Err(error) => error.into_response(),
    }
}

pub fn build_eve_authorize_url(
    state: &AppState,
    query: &EveAuthorizeQuery,
) -> Result<Url, AuthorizeError> {
    let config = &state.config;
    let client_id = config
        .eve_sso_client_id
        .as_deref()
        .ok_or(AuthorizeError::MissingConfig("EVE_SSO_CLIENT_ID"))?;
    let redirect_uri = config
        .eve_sso_redirect_uri
        .as_deref()
        .ok_or(AuthorizeError::MissingConfig("EVE_SSO_REDIRECT_URI"))?;
    let scopes = requested_scopes(query).unwrap_or_else(|| config.eve_sso_scopes.clone());
    if scopes.is_empty() {
        return Err(AuthorizeError::EmptyScopes);
    }

    let mut url =
        Url::parse(&config.eve_sso_authorize_url).map_err(AuthorizeError::InvalidAuthorizeUrl)?;
    {
        let mut query_pairs = url.query_pairs_mut();
        query_pairs.append_pair("response_type", "code");
        query_pairs.append_pair("client_id", client_id);
        query_pairs.append_pair("redirect_uri", redirect_uri);
        query_pairs.append_pair("scope", &scopes.join(" "));
        if let Some(state) = query
            .state
            .as_deref()
            .map(str::trim)
            .filter(|state| !state.is_empty())
        {
            query_pairs.append_pair("state", state);
        }
    }

    Ok(url)
}

fn requested_scopes(query: &EveAuthorizeQuery) -> Option<Vec<String>> {
    query
        .scope
        .as_deref()
        .or(query.scopes.as_deref())
        .map(parse_scopes)
        .filter(|scopes| !scopes.is_empty())
}

impl IntoResponse for AuthorizeError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            Self::MissingConfig(name) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("{name} must be configured before authorizing EVE SSO scopes"),
            ),
            Self::EmptyScopes => (
                StatusCode::BAD_REQUEST,
                "at least one EVE SSO scope is required".to_string(),
            ),
            Self::InvalidAuthorizeUrl(error) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("EVE_SSO_AUTHORIZE_URL is invalid: {error}"),
            ),
        };

        (
            status,
            Json(ErrorBody {
                error: "eve_sso_authorize_error",
                message,
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, path::PathBuf};

    use reqwest::Client;
    use tokio::sync::RwLock;

    use super::*;
    use crate::{
        config::{ESI_BASE_URL, EVE_SSO_AUTHORIZE_URL},
        state::Cache,
    };

    fn app_state() -> AppState {
        AppState {
            http: Client::new(),
            config: crate::config::Config {
                esi_base_url: ESI_BASE_URL.to_string(),
                user_agent: "test-agent".to_string(),
                token_file: PathBuf::from("tokens.json"),
                eve_sso_authorize_url: EVE_SSO_AUTHORIZE_URL.to_string(),
                eve_sso_client_id: Some("client-id".to_string()),
                eve_sso_redirect_uri: Some("http://localhost:8080/callback".to_string()),
                eve_sso_scopes: vec!["esi-structures.read_corporation.v1".to_string()],
            },
            cache: RwLock::new(Cache::default()),
            tokens: RwLock::new(Vec::new()),
        }
    }

    #[test]
    fn builds_authorize_url_from_configured_scope() {
        let state = app_state();
        let url = build_eve_authorize_url(
            &state,
            &EveAuthorizeQuery {
                scope: None,
                scopes: None,
                state: Some("state-123".to_string()),
            },
        )
        .expect("authorize URL");

        let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(
            url.origin().ascii_serialization(),
            "https://login.eveonline.com"
        );
        assert_eq!(url.path(), "/v2/oauth/authorize");
        assert_eq!(query.get("response_type"), Some(&"code".to_string()));
        assert_eq!(query.get("client_id"), Some(&"client-id".to_string()));
        assert_eq!(
            query.get("redirect_uri"),
            Some(&"http://localhost:8080/callback".to_string())
        );
        assert_eq!(
            query.get("scope"),
            Some(&"esi-structures.read_corporation.v1".to_string())
        );
        assert_eq!(query.get("state"), Some(&"state-123".to_string()));
    }

    #[test]
    fn query_scope_overrides_configured_scope() {
        let state = app_state();
        let url = build_eve_authorize_url(
            &state,
            &EveAuthorizeQuery {
                scope: Some("esi-location.read_location.v1, esi-skills.read_skills.v1".to_string()),
                scopes: None,
                state: None,
            },
        )
        .expect("authorize URL");

        let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(
            query.get("scope"),
            Some(&"esi-location.read_location.v1 esi-skills.read_skills.v1".to_string())
        );
    }

    #[test]
    fn missing_sso_client_id_is_reported() {
        let mut state = app_state();
        state.config.eve_sso_client_id = None;
        let error = build_eve_authorize_url(
            &state,
            &EveAuthorizeQuery {
                scope: None,
                scopes: None,
                state: None,
            },
        )
        .expect_err("missing client ID");

        assert!(matches!(
            error,
            AuthorizeError::MissingConfig("EVE_SSO_CLIENT_ID")
        ));
    }
}
