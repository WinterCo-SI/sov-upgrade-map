use std::{collections::HashMap, sync::Arc};

use anyhow::{Context, Result};
use chrono::Utc;
use futures::stream::{self, StreamExt};
use tracing::{error, info, warn};

use crate::{
    config::{
        COMPATIBILITY_DATE, HUB_DETAIL_CONCURRENCY, HUB_DETAIL_REFRESH, SKYHOOK_REFRESH,
        SOVEREIGNTY_REFRESH,
    },
    esi::fetch_esi_json,
    models::{
        EsiClaim, EsiHubDetail, EsiSkyhooksResponse, EsiSovereigntyResponse, EsiSovereigntySystem,
        HubDetailResult, SovereigntySystem, TokenEntry,
    },
    state::AppState,
    tokens::refresh_tokens,
};

pub fn spawn_refresh_loops(state: Arc<AppState>) {
    let sovereignty_state = state.clone();
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(SOVEREIGNTY_REFRESH);
        loop {
            timer.tick().await;
            info!("refreshing sovereignty");
            refresh_sovereignty(&sovereignty_state).await;
        }
    });

    let skyhook_state = state.clone();
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(SKYHOOK_REFRESH);
        loop {
            timer.tick().await;
            info!("refreshing skyhooks");
            refresh_skyhooks(&skyhook_state).await;
        }
    });

    tokio::spawn(async move {
        let mut timer = tokio::time::interval(HUB_DETAIL_REFRESH);
        loop {
            timer.tick().await;
            info!("refreshing hub details");
            refresh_hub_details(&state).await;
        }
    });
}

pub async fn refresh_sovereignty(state: &Arc<AppState>) {
    match fetch_esi_json::<EsiSovereigntyResponse>(
        &state.http,
        &state.config.esi_base_url,
        "/sovereignty/systems",
        None,
    )
    .await
    {
        Ok(response) => {
            let systems = response
                .solar_systems
                .into_iter()
                .map(project_sovereignty_system)
                .collect::<Vec<_>>();

            let mut cache = state.cache.write().await;
            cache.sovereignty = systems;
            cache.sovereignty_updated_at = Some(Utc::now());
            info!(
                "updated sovereignty cache with {} systems",
                cache.sovereignty.len()
            );
        }
        Err(err) => error!("failed to refresh sovereignty systems: {err:#}"),
    }
}

pub async fn refresh_skyhooks(state: &Arc<AppState>) {
    match fetch_esi_json::<EsiSkyhooksResponse>(
        &state.http,
        &state.config.esi_base_url,
        "/skyhooks/raidable",
        None,
    )
    .await
    {
        Ok(response) => {
            let mut cache = state.cache.write().await;
            cache.skyhooks = response.skyhooks;
            cache.skyhooks_updated_at = Some(Utc::now());
            info!(
                "updated skyhook cache with {} entries",
                cache.skyhooks.len()
            );
        }
        Err(err) => error!("failed to refresh raidable skyhooks: {err:#}"),
    }
}

pub async fn refresh_hub_details(state: &Arc<AppState>) {
    refresh_tokens(state).await;

    let tokens = state.tokens.read().await.clone();
    if tokens.is_empty() {
        warn!(
            "no tokens configured; hub upgrades, reagent bay, resources, and workforce transport are unavailable"
        );
        return;
    }

    let hubs = {
        let cache = state.cache.read().await;
        cache
            .sovereignty
            .iter()
            .filter_map(|system| {
                Some((
                    system.corporation_id?,
                    system.sovereignty_hub.as_ref()?.id,
                    system.system_id,
                ))
            })
            .collect::<Vec<_>>()
    };

    if hubs.is_empty() {
        return;
    }

    let existing_errors = {
        let cache = state.cache.read().await;
        cache
            .hub_details
            .iter()
            .filter_map(|(hub_id, result)| match result {
                HubDetailResult::Error(message) => Some((*hub_id, message.clone())),
                HubDetailResult::Detail(_) => None,
            })
            .collect::<HashMap<_, _>>()
    };

    let token_count = tokens.len();
    let results = stream::iter(hubs.into_iter().enumerate())
        .map(|(index, (corporation_id, hub_id, _))| {
            let state = state.clone();
            let token = tokens[index % token_count].clone();
            async move {
                let result = fetch_hub_detail(&state, &token, corporation_id, hub_id).await;
                (hub_id, result)
            }
        })
        .buffer_unordered(HUB_DETAIL_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

    let mut details = HashMap::new();
    for (hub_id, result) in results {
        match result {
            Ok(detail) => {
                details.insert(hub_id, HubDetailResult::Detail(detail));
            }
            Err(err) => {
                let message = err.to_string();
                if existing_errors.get(&hub_id) != Some(&message) {
                    warn!("failed to fetch hub {hub_id}: {message}");
                }
                details.insert(hub_id, HubDetailResult::Error(message));
            }
        }
    }

    let mut cache = state.cache.write().await;
    cache.hub_details = details;
    cache.hub_details_updated_at = Some(Utc::now());
    info!(
        "updated hub detail cache with {} entries",
        cache.hub_details.len()
    );
}

fn project_sovereignty_system(system: EsiSovereigntySystem) -> SovereigntySystem {
    match system.claim {
        EsiClaim::Alliance { alliance } => SovereigntySystem {
            system_id: system.solar_system_id,
            hub_id: Some(alliance.sovereignty_hub.id),
            hub_solar_system_id: Some(system.solar_system_id),
            alliance_id: Some(alliance.alliance_id),
            corporation_id: Some(alliance.corporation_id),
            faction_id: None,
            claimed_since: Some(alliance.claimed_since),
            adm: Some(alliance.development.activity_defense_multiplier),
            development: Some(alliance.development),
            is_capital_system: alliance.is_capital_system,
            sovereignty_hub: Some(alliance.sovereignty_hub),
            upgrades: Vec::new(),
            skyhooks: Vec::new(),
            reagent_bay: None,
            resources: None,
            workforce_transport: None,
            hub_detail_error: None,
        },
        EsiClaim::Faction { faction } => SovereigntySystem {
            system_id: system.solar_system_id,
            hub_id: None,
            hub_solar_system_id: None,
            alliance_id: None,
            corporation_id: None,
            faction_id: Some(faction.faction_id),
            claimed_since: None,
            adm: None,
            development: None,
            is_capital_system: false,
            sovereignty_hub: None,
            upgrades: Vec::new(),
            skyhooks: Vec::new(),
            reagent_bay: None,
            resources: None,
            workforce_transport: None,
            hub_detail_error: None,
        },
        EsiClaim::Unclaimed { unclaimed } => {
            let _ = unclaimed;
            SovereigntySystem {
                system_id: system.solar_system_id,
                hub_id: None,
                hub_solar_system_id: None,
                alliance_id: None,
                corporation_id: None,
                faction_id: None,
                claimed_since: None,
                adm: None,
                development: None,
                is_capital_system: false,
                sovereignty_hub: None,
                upgrades: Vec::new(),
                skyhooks: Vec::new(),
                reagent_bay: None,
                resources: None,
                workforce_transport: None,
                hub_detail_error: None,
            }
        }
    }
}

async fn fetch_hub_detail(
    state: &Arc<AppState>,
    token: &TokenEntry,
    corporation_id: i64,
    hub_id: i64,
) -> Result<EsiHubDetail> {
    let url = format!(
        "{}/corporations/{}/structures/sovereignty-hubs/{}",
        state.config.esi_base_url, corporation_id, hub_id
    );

    state
        .http
        .get(url)
        .header("X-Compatibility-Date", COMPATIBILITY_DATE)
        .bearer_auth(&token.access_token)
        .send()
        .await
        .context("sending hub detail request")?
        .error_for_status()
        .context("hub detail request failed")?
        .json::<EsiHubDetail>()
        .await
        .context("decoding hub detail response")
}
