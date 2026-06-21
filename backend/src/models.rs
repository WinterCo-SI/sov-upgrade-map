use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct EsiSovereigntyResponse {
    pub solar_systems: Vec<EsiSovereigntySystem>,
}

#[derive(Debug, Deserialize)]
pub struct EsiSovereigntySystem {
    pub solar_system_id: i64,
    pub claim: EsiClaim,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum EsiClaim {
    Alliance { alliance: EsiAllianceClaim },
    Faction { faction: EsiFactionClaim },
    Unclaimed { unclaimed: bool },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EsiAllianceClaim {
    pub alliance_id: i64,
    pub corporation_id: i64,
    pub claimed_since: DateTime<Utc>,
    pub sovereignty_hub: EsiSovereigntyHub,
    pub is_capital_system: bool,
    pub development: SovereigntyDevelopment,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EsiFactionClaim {
    pub faction_id: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EsiSovereigntyHub {
    pub id: i64,
    pub vulnerability_window: Option<VulnerabilityWindow>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct VulnerabilityWindow {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SovereigntyDevelopment {
    pub activity_defense_multiplier: f64,
    pub military_level: i64,
    pub industrial_level: i64,
    pub strategic_level: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SovereigntySystem {
    pub system_id: i64,
    pub hub_id: Option<i64>,
    pub hub_solar_system_id: Option<i64>,
    pub alliance_id: Option<i64>,
    pub corporation_id: Option<i64>,
    pub faction_id: Option<i64>,
    pub claimed_since: Option<DateTime<Utc>>,
    pub adm: Option<f64>,
    pub development: Option<SovereigntyDevelopment>,
    pub is_capital_system: bool,
    pub sovereignty_hub: Option<EsiSovereigntyHub>,
    #[serde(default)]
    pub upgrades: Vec<HubUpgrade>,
    #[serde(default)]
    pub skyhooks: Vec<RaidableSkyhook>,
    pub reagent_bay: Option<ReagentBay>,
    pub resources: Option<HubResources>,
    pub workforce_transport: Option<WorkforceTransport>,
    pub hub_detail_error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EsiSkyhooksResponse {
    pub skyhooks: Vec<RaidableSkyhook>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RaidableSkyhook {
    pub planet_id: i64,
    pub solar_system_id: i64,
    pub theft_vulnerability: VulnerabilityWindow,
}

#[derive(Clone, Debug, Deserialize)]
pub struct EsiHubDetail {
    pub id: i64,
    pub solar_system_id: i64,
    pub upgrades: Vec<HubUpgrade>,
    pub reagent_bay: ReagentBay,
    pub resources: HubResources,
    pub workforce_transport: WorkforceTransport,
    pub vulnerability_window: Option<VulnerabilityWindow>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HubUpgrade {
    pub type_id: i64,
    pub power_state: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ReagentBay {
    pub last_updated: DateTime<Utc>,
    pub reagents: Vec<Reagent>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Reagent {
    pub type_id: i64,
    pub amount: i64,
    pub burning_per_hour: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HubResources {
    pub power: ResourceAmount,
    pub workforce: ResourceAmount,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResourceAmount {
    pub available: i64,
    pub allocated: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WorkforceTransport {
    pub configuration: serde_json::Value,
    pub state: serde_json::Value,
}

#[derive(Clone, Debug)]
pub enum HubDetailResult {
    Detail(EsiHubDetail),
    Error(String),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TokenEntry {
    pub name: Option<String>,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RefreshTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub systems: Vec<SovereigntySystem>,
    pub updated_at: Option<DateTime<Utc>>,
    pub sovereignty_updated_at: Option<DateTime<Utc>>,
    pub skyhooks_updated_at: Option<DateTime<Utc>>,
    pub hub_details_updated_at: Option<DateTime<Utc>>,
}
