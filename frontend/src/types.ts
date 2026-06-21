export interface SolarSystem {
  id: number;
  name: string;
  constellationId: number;
  regionId: number;
  security: number | null;
  x: number;
  y: number;
  z: number;
  x2d?: number;
  y2d?: number;
}

export interface Region {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface Constellation {
  id: number;
  name: string;
  regionId: number;
  x: number;
  y: number;
  z: number;
}

export interface StargateEdge {
  from: number;
  to: number;
}

export interface MapDataset {
  buildNumber: number;
  regions: Region[];
  constellations: Constellation[];
  systems: SolarSystem[];
  edges: StargateEdge[];
}

export interface StatusUpgrade {
  type_id: number;
  typeId?: number;
  power_state?: string;
}

export interface VulnerabilityWindow {
  start: string;
  end: string;
}

export interface SovereigntyDevelopment {
  activity_defense_multiplier: number;
  military_level: number;
  industrial_level: number;
  strategic_level: number;
}

export interface SovereigntyHubSummary {
  id: number;
  vulnerability_window?: VulnerabilityWindow;
}

export interface ResourceAmount {
  available: number;
  allocated: number;
}

export interface SovereigntyHubResources {
  power: ResourceAmount;
  workforce: ResourceAmount;
}

export interface Reagent {
  type_id: number;
  amount: number;
  burning_per_hour: number;
}

export interface ReagentBay {
  last_updated: string;
  reagents: Reagent[];
}

export interface WorkforceTransportSource {
  solar_system_id: number;
  amount?: number;
}

export interface WorkforceTransportImport {
  sources: WorkforceTransportSource[];
}

export interface WorkforceTransportExport {
  amount?: number;
  solar_system_id?: number;
}

export type WorkforceTransportMode =
  | { import: WorkforceTransportImport }
  | { export: WorkforceTransportExport }
  | { transit: boolean | null };

export interface WorkforceTransport {
  configuration?: WorkforceTransportMode;
  state?: WorkforceTransportMode;
}

export interface SovereigntySystemStatus {
  system_id: number;
  hub_id?: number;
  hub_solar_system_id?: number;
  alliance_id?: number;
  corporation_id?: number;
  faction_id?: number;
  claimed_since?: string;
  adm?: number;
  development?: SovereigntyDevelopment;
  is_capital_system?: boolean;
  sovereignty_hub?: SovereigntyHubSummary;
  upgrades: StatusUpgrade[];
  reagent_bay?: ReagentBay;
  resources?: SovereigntyHubResources;
  workforce_transport?: WorkforceTransport;
  skyhooks: RaidableSkyhook[];
  last_updated?: string;
  hub_detail_error?: string;
}

export interface RaidableSkyhook {
  planet_id: number;
  solar_system_id: number;
  theft_vulnerability: VulnerabilityWindow;
}

export interface SovereigntyStatusResponse {
  systems: SovereigntySystemStatus[];
  updated_at?: string;
  sovereignty_updated_at?: string;
  skyhooks_updated_at?: string;
  hub_details_updated_at?: string;
}

export interface SearchItem {
  id: number;
  name: string;
  type: "system" | "region" | "constellation";
  security?: number;
  regionName?: string;
}
