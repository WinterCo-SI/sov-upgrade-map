use std::sync::Arc;

use anyhow::{Context, Result};
use reqwest::Client;
use tokio::fs;
use tracing::{error, warn};

use crate::{
    models::{RefreshTokenResponse, TokenEntry},
    state::AppState,
};

pub async fn refresh_tokens(state: &Arc<AppState>) {
    let Ok(text) = fs::read_to_string(&state.config.token_file).await else {
        return;
    };

    let mut tokens = match serde_json::from_str::<Vec<TokenEntry>>(&text) {
        Ok(tokens) => tokens,
        Err(err) => {
            error!(
                "failed to parse token file {}: {err}",
                state.config.token_file.display()
            );
            return;
        }
    };

    let mut changed = false;
    for token in &mut tokens {
        if token.refresh_token.is_some()
            && token.client_id.is_some()
            && token.client_secret.is_some()
        {
            match refresh_token(&state.http, token).await {
                Ok(refreshed) => changed |= refreshed,
                Err(err) => {
                    warn!(
                        "failed to refresh token {}: {err:#}",
                        token.name.as_deref().unwrap_or("<unnamed>")
                    );
                }
            }
        }
    }

    if changed {
        match serde_json::to_string_pretty(&tokens) {
            Ok(serialized) => {
                if let Err(err) =
                    fs::write(&state.config.token_file, format!("{serialized}\n")).await
                {
                    warn!(
                        "failed to write refreshed token file {}: {err}",
                        state.config.token_file.display()
                    );
                }
            }
            Err(err) => warn!("failed to serialize refreshed tokens: {err}"),
        }
    }

    let usable = tokens
        .iter()
        .filter(|token| !token.access_token.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>();
    let mut state_tokens = state.tokens.write().await;
    *state_tokens = usable;
}

async fn refresh_token(client: &Client, token: &mut TokenEntry) -> Result<bool> {
    let Some(refresh_token) = token.refresh_token.clone() else {
        return Ok(false);
    };
    let Some(client_id) = token.client_id.as_deref() else {
        return Ok(false);
    };
    let Some(client_secret) = token.client_secret.as_deref() else {
        return Ok(false);
    };

    let response = client
        .post("https://login.eveonline.com/v2/oauth/token")
        .basic_auth(client_id, Some(client_secret))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
        ])
        .send()
        .await
        .context("sending token refresh request")?
        .error_for_status()
        .context("token refresh failed")?
        .json::<RefreshTokenResponse>()
        .await
        .context("decoding token refresh response")?;

    let changed = token.access_token != response.access_token
        || response
            .refresh_token
            .as_ref()
            .is_some_and(|next_refresh_token| {
                token.refresh_token.as_ref() != Some(next_refresh_token)
            });

    token.access_token = response.access_token;
    if let Some(next_refresh_token) = response.refresh_token {
        token.refresh_token = Some(next_refresh_token);
    }

    Ok(changed)
}
