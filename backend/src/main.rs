mod auth;
mod config;
mod esi;
mod models;
mod refresh;
mod routes;
mod state;
mod tokens;

use std::{env, net::SocketAddr, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use reqwest::Client;
use tokio::{net::TcpListener, sync::RwLock};
use tracing::{error, info};

use crate::{
    config::Config,
    refresh::{refresh_hub_details, refresh_skyhooks, refresh_sovereignty, spawn_refresh_loops},
    routes::app,
    state::{AppState, Cache},
    tokens::refresh_tokens,
};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sov_upgrade_map_backend=info,tower_http=info".into()),
        )
        .init();

    let config = Config::from_env();
    let http = Client::builder()
        .user_agent(config.user_agent.clone())
        .timeout(Duration::from_secs(30))
        .build()
        .context("building HTTP client")?;

    let app_state = Arc::new(AppState {
        http,
        config,
        cache: RwLock::new(Cache::default()),
        tokens: RwLock::new(Vec::new()),
    });

    refresh_tokens(&app_state).await;
    refresh_sovereignty(&app_state).await;
    refresh_skyhooks(&app_state).await;
    refresh_hub_details(&app_state).await;
    spawn_refresh_loops(app_state.clone());

    let listen_addr: SocketAddr = env::var("LISTEN_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_string())
        .parse()
        .context("LISTEN_ADDR must be a socket address, for example 127.0.0.1:8080")?;

    let listener = TcpListener::bind(listen_addr)
        .await
        .with_context(|| format!("binding {listen_addr}"))?;
    info!("starting Rust backend on {listen_addr}");

    axum::serve(listener, app(app_state))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("serving HTTP")?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = tokio::signal::ctrl_c().await {
            error!("failed to install Ctrl+C handler: {err}");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(err) => error!("failed to install signal handler: {err}"),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
