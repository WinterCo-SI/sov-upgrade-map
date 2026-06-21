use std::collections::HashMap;

use chrono::{DateTime, Utc};
use reqwest::Client;
use tokio::sync::RwLock;

use crate::{
    config::Config,
    models::{HubDetailResult, RaidableSkyhook, SovereigntySystem, TokenEntry},
};

#[derive(Debug)]
pub struct AppState {
    pub http: Client,
    pub config: Config,
    pub cache: RwLock<Cache>,
    pub tokens: RwLock<Vec<TokenEntry>>,
}

#[derive(Debug, Default)]
pub struct Cache {
    pub sovereignty: Vec<SovereigntySystem>,
    pub skyhooks: Vec<RaidableSkyhook>,
    pub hub_details: HashMap<i64, HubDetailResult>,
    pub sovereignty_updated_at: Option<DateTime<Utc>>,
    pub skyhooks_updated_at: Option<DateTime<Utc>>,
    pub hub_details_updated_at: Option<DateTime<Utc>>,
}
