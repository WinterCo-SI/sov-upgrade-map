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
  typeId: number;
  name: string;
}

export interface SovereigntySystemStatus {
  system_id: number;
  alliance_id: number;
  adm: number;
  upgrades: StatusUpgrade[];
}

export interface SearchItem {
  id: number;
  name: string;
  type: "system" | "region" | "constellation";
  security?: number;
  regionName?: string;
}
