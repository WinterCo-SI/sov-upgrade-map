use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;

use crate::config::COMPATIBILITY_DATE;

pub async fn fetch_esi_json<T>(
    client: &Client,
    base_url: &str,
    path: &str,
    bearer_token: Option<&str>,
) -> Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    let url = format!("{base_url}{path}");
    let mut request = client
        .get(url)
        .header("X-Compatibility-Date", COMPATIBILITY_DATE)
        .header("Accept-Language", "en");
    if let Some(token) = bearer_token {
        request = request.bearer_auth(token);
    }

    request
        .send()
        .await
        .context("sending ESI request")?
        .error_for_status()
        .context("ESI request returned an error")?
        .json::<T>()
        .await
        .context("decoding ESI response")
}
