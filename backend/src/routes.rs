use std::{collections::HashMap, sync::Arc};

use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{
    models::{HubDetailResult, RaidableSkyhook, StatusResponse},
    state::AppState,
};

pub fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", axum::routing::get(healthz))
        .route(
            "/api/auth/eve/authorize",
            axum::routing::get(crate::auth::eve_authorize),
        )
        .route(
            "/api/public/sovereignty/status",
            axum::routing::get(sovereignty_status),
        )
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn healthz(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let cache = state.cache.read().await;
    let ready = cache.sovereignty_updated_at.is_some() && cache.skyhooks_updated_at.is_some();
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(serde_json::json!({ "ready": ready })))
}

async fn sovereignty_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let cache = state.cache.read().await;
    let mut skyhooks_by_system: HashMap<i64, Vec<RaidableSkyhook>> = HashMap::new();
    for skyhook in &cache.skyhooks {
        skyhooks_by_system
            .entry(skyhook.solar_system_id)
            .or_default()
            .push(skyhook.clone());
    }

    let mut systems = cache.sovereignty.clone();
    for system in &mut systems {
        system.skyhooks = skyhooks_by_system
            .remove(&system.system_id)
            .unwrap_or_default();

        if let Some(hub_id) = system.sovereignty_hub.as_ref().map(|hub| hub.id) {
            match cache.hub_details.get(&hub_id) {
                Some(HubDetailResult::Detail(detail)) => {
                    system.hub_id = Some(detail.id);
                    system.hub_solar_system_id = Some(detail.solar_system_id);
                    system.upgrades = detail.upgrades.clone();
                    system.reagent_bay = Some(detail.reagent_bay.clone());
                    system.resources = Some(detail.resources.clone());
                    system.workforce_transport = Some(detail.workforce_transport.clone());
                    if let Some(window) = &detail.vulnerability_window {
                        if let Some(hub) = &mut system.sovereignty_hub {
                            hub.vulnerability_window = Some(window.clone());
                        }
                    }
                }
                Some(HubDetailResult::Error(message)) => {
                    system.hub_detail_error = Some(message.clone());
                }
                None => {}
            }
        }
    }

    let updated_at = [
        cache.sovereignty_updated_at,
        cache.skyhooks_updated_at,
        cache.hub_details_updated_at,
    ]
    .into_iter()
    .flatten()
    .max();

    Json(StatusResponse {
        systems,
        updated_at,
        sovereignty_updated_at: cache.sovereignty_updated_at,
        skyhooks_updated_at: cache.skyhooks_updated_at,
        hub_details_updated_at: cache.hub_details_updated_at,
    })
}
