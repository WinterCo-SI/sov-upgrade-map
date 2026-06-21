import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import {
  COORDINATE_SYSTEM,
  OrbitView,
  OrbitViewport,
  OrthographicView,
  type Color,
  type OrthographicViewState,
  type OrbitViewState,
  type PickingInfo,
  type ViewStateChangeParameters,
} from "@deck.gl/core";
import { LineLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { useTranslation } from "react-i18next";
import type {
  MapDataset,
  SolarSystem,
  SovereigntySystemStatus,
  WorkforceTransportMode,
} from "../types";
import { getSecurityColor } from "../utils";
import { RotateCcw } from "lucide-react";
import { displayLanguage, translatePowerState, translateType } from "../i18n";

interface StarmapProps {
  mapData: MapDataset | null;
  sovData: SovereigntySystemStatus[] | null;
  onSystemClick?: (system: SolarSystem) => void;
  onSystemHover?: (system: SolarSystem | null) => void;
  activeSystem?: SolarSystem | null;
  loading?: boolean;
  centerTarget?: { system: SolarSystem; zoom: number } | null;
  initialRegionId?: number;
}

type MapMode = "2d" | "3d";
type Vec3 = [number, number, number];
type DeckViewState = OrthographicViewState | OrbitViewState;
type DragButton = "left" | "right";
type StarmapControllerOptions =
  | false
  | {
      dragPan: boolean;
      dragRotate: boolean;
      dragMode: "pan" | "rotate";
      scrollZoom: boolean;
      doubleClickZoom: boolean;
      touchZoom: boolean;
      touchRotate: boolean;
      keyboard: boolean;
    };

interface DragState {
  button: DragButton;
  pointerId: number;
  startX: number;
  startY: number;
  viewportWidth: number;
  viewportHeight: number;
  startViewState: DeckViewState;
}

interface SystemDatum {
  system: SolarSystem;
  status?: SovereigntySystemStatus;
  position: Vec3;
  radius: number;
  color: Color;
  depthPriority: number;
  isPlayerSov: boolean;
  isActive: boolean;
  isHovered: boolean;
}

interface EdgeDatum {
  from: SolarSystem;
  to: SolarSystem;
  source: Vec3;
  target: Vec3;
  crossRegion: boolean;
  depthPriority: number;
}

interface LabelDatum {
  id: number;
  name: string;
  position: Vec3;
  kind: "system" | "constellation" | "region";
  depthPriority: number;
  active?: boolean;
}

interface CoordinateProjector {
  toScene: (system: SolarSystem, mode: MapMode) => Vec3;
}

interface SceneProjection {
  center: Vec3;
  scale: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface DepthCue {
  priority: number;
}

const MIN_2D_ZOOM = -7;
const MAX_2D_ZOOM = 6;
const MIN_3D_ZOOM = -11;
const MAX_3D_ZOOM = 18;
const SCENE_SIZE = 1600;
const DETAIL_SCALE = 7;
const REGION_LABEL_SCALE = 4;
const SYSTEM_LABEL_SCALE = 5;
const IMPORTANT_SYSTEM_LABEL_SCALE = 3;
const ROTATE_SENSITIVITY = 0.75;
const WHEEL_ZOOM_SENSITIVITY = 0.0025;
const DISTANT_NODE_ALPHA = 0.22;
const DISTANT_LINE_ALPHA = 0.2;
const DISTANT_LABEL_ALPHA = 0.18;
const DISTANT_NODE_RADIUS = 0.55;
const DISTANT_LINE_WIDTH = 0.55;
const DISTANT_LABEL_SIZE = 0.72;
const DEFAULT_2D_VIEW: OrthographicViewState = {
  target: [0, 0, 0],
  zoom: -1,
  minZoom: MIN_2D_ZOOM,
  maxZoom: MAX_2D_ZOOM,
};
const DEFAULT_3D_VIEW: OrbitViewState = {
  target: [0, 0, 0],
  zoom: -1.2,
  rotationOrbit: 25,
  rotationX: 55,
  minZoom: MIN_3D_ZOOM,
  maxZoom: MAX_3D_ZOOM,
  minRotationX: -89,
  maxRotationX: 89,
};

const LATIN_MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New'";
const CHINESE_CANVAS_FONT = "'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', 'Source Han Sans SC', 'Segoe UI', Arial, sans-serif";
const SYSTEM_NAME_FONT = `${LATIN_MONO_FONT}, ${CHINESE_CANVAS_FONT}`;

function uiFont(): string {
  return displayLanguage() === "zh" ? CHINESE_CANVAS_FONT : `${LATIN_MONO_FONT}, monospace`;
}

function transportModeName(mode: WorkforceTransportMode | undefined, t: (key: string) => string): string {
  if (!mode) return t("common.none");
  if ("import" in mode) return t("details.import");
  if ("export" in mode) return t("details.export");
  if ("transit" in mode) return t("details.transit");
  return t("common.none");
}

function transportModeAmount(mode: WorkforceTransportMode | undefined): string {
  if (!mode) return "";
  if ("import" in mode) {
    const total = mode.import.sources.reduce((sum, source) => sum + (source.amount ?? 0), 0);
    return total > 0 ? ` ${total}` : "";
  }
  if ("export" in mode && mode.export.amount !== undefined) {
    return ` ${mode.export.amount}`;
  }
  return "";
}

function formatWorkforceTransport(
  transport: SovereigntySystemStatus["workforce_transport"] | undefined,
  t: (key: string) => string,
): string | null {
  if (!transport) return null;
  const configured = `${transportModeName(transport.configuration, t)}${transportModeAmount(transport.configuration)}`;
  const current = `${transportModeName(transport.state, t)}${transportModeAmount(transport.state)}`;
  return `${t("details.workforceTransport")} ${t("details.configured")} ${configured} / ${t("details.current")} ${current}`;
}

function hexToColor(hex: string, alpha = 255): Color {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return [r, g, b, alpha];
}

function colorWithDepth(color: Color, priority: number, minimumAlpha: number): Color {
  const alpha = color[3] ?? 255;
  return [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    Math.round(alpha * depthBlend(priority, minimumAlpha)),
  ];
}

function admColor(status: SovereigntySystemStatus | undefined): Color {
  if (!status?.alliance_id) return status?.faction_id ? [156, 163, 175, 220] : [255, 255, 255, 220];
  const adm = status.adm ?? status.development?.activity_defense_multiplier ?? 1;
  const admScale = Math.max(0, Math.min(1, (adm - 1.0) / 4.0));
  return [
    Math.round(255 + admScale * (239 - 255)),
    Math.round(255 + admScale * (68 - 255)),
    Math.round(255 + admScale * (68 - 255)),
    235,
  ];
}

function securityText(system: SolarSystem): string {
  return system.security === null ? "--" : system.security.toFixed(1);
}

function admText(status: SovereigntySystemStatus | undefined): string {
  const adm = status?.adm ?? status?.development?.activity_defense_multiplier;
  return adm === undefined ? "--" : adm.toFixed(1);
}

function dotlanNodeText(datum: SystemDatum, details: boolean): string {
  if (!details) return datum.system.name;
  return `${datum.system.name}\n${securityText(datum.system)}  ADM ${admText(datum.status)}`;
}

function dotlanNodeBackground(datum: SystemDatum): Color {
  return admColor(datum.status);
}

function dotlanNodeBorder(datum: SystemDatum): Color {
  if (datum.isActive || datum.isHovered) return [255, 255, 255, 255];
  if (datum.status?.is_capital_system) return [251, 191, 36, 255];
  if (datum.status?.skyhooks?.length) return [34, 211, 238, 245];
  return [24, 24, 27, 230];
}

function dotlanNodeTextColor(datum: SystemDatum): Color {
  if (datum.isActive || datum.isHovered) return [255, 255, 255, 255];
  const background = dotlanNodeBackground(datum);
  const luminance = (0.299 * background[0] + 0.587 * background[1] + 0.114 * background[2]) / 255;
  return luminance > 0.58 ? [24, 24, 27, 255] : [255, 255, 255, 255];
}

function systemRadius(status: SovereigntySystemStatus | undefined, zoom: number): number {
  const details = scaleFromZoom(zoom) >= DETAIL_SCALE;
  if (status?.alliance_id) return details ? 14 : 5;
  return status?.faction_id ? 2.5 : 3.2;
}

function raw2dPosition(system: SolarSystem): Vec3 {
  if (system.x2d !== undefined && system.y2d !== undefined) {
    return [system.x2d, system.y2d, 0];
  }
  return [system.x, system.z, 0];
}

function raw3dPosition(system: SolarSystem): Vec3 {
  return [system.x, -system.z, system.y];
}

function averagePosition(positions: Vec3[]): Vec3 {
  if (!positions.length) return [0, 0, 0];
  const sum = positions.reduce<Vec3>(
    (total, point) => [total[0] + point[0], total[1] + point[1], total[2] + point[2]],
    [0, 0, 0],
  );
  return [sum[0] / positions.length, sum[1] / positions.length, sum[2] / positions.length];
}

function createSceneProjection(positions: Vec3[], flat = false): SceneProjection {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const dimensions = flat ? 2 : 3;

  for (const position of positions) {
    for (let index = 0; index < dimensions; index += 1) {
      min[index] = Math.min(min[index], position[index]);
      max[index] = Math.max(max[index], position[index]);
    }
  }

  if (flat) {
    min[2] = 0;
    max[2] = 0;
  }

  const center: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    flat ? 0 : (min[2] + max[2]) / 2,
  ];
  const span = Math.max(
    max[0] - min[0],
    max[1] - min[1],
    flat ? 1 : max[2] - min[2],
    1,
  );

  return {
    center,
    scale: SCENE_SIZE / span,
  };
}

function createCoordinateProjector(mapData: MapDataset | null): CoordinateProjector {
  if (!mapData?.systems?.length) {
    return { toScene: () => [0, 0, 0] };
  }

  const projection2d = createSceneProjection(mapData.systems.map(raw2dPosition), true);
  const projection3d = createSceneProjection(mapData.systems.map(raw3dPosition));

  return {
    toScene: (system, mode) => {
      const raw = mode === "2d" ? raw2dPosition(system) : raw3dPosition(system);
      const { center, scale } = mode === "2d" ? projection2d : projection3d;
      return [
        (raw[0] - center[0]) * scale,
        (raw[1] - center[1]) * scale,
        mode === "2d" ? 0 : (raw[2] - center[2]) * scale,
      ];
    },
  };
}

function fitViewForSystems(systems: SolarSystem[], mode: MapMode, projector: CoordinateProjector): DeckViewState {
  if (systems.length < 2) return mode === "2d" ? DEFAULT_2D_VIEW : DEFAULT_3D_VIEW;
  const positions = systems.map((system) => projector.toScene(system, mode));
  const center = averagePosition(positions);
  let span = 1;
  for (const position of positions) {
    span = Math.max(
      span,
      Math.abs(position[0] - center[0]),
      Math.abs(position[1] - center[1]),
      Math.abs(position[2] - center[2]),
    );
  }
  const zoom = clampZoomForMode(Math.log2(360 / span), mode);
  if (mode === "2d") {
    return {
      ...DEFAULT_2D_VIEW,
      target: center,
      zoom,
    };
  }
  return {
    ...DEFAULT_3D_VIEW,
    target: center,
    zoom,
  };
}

function zoomValue(viewState: DeckViewState): number {
  if ("zoomX" in viewState && typeof viewState.zoomX === "number") return viewState.zoomX;
  const zoom = viewState.zoom;
  return Array.isArray(zoom) ? zoom[0] : zoom ?? 0;
}

function scaleFromZoom(zoom: number): number {
  return 2 ** zoom;
}

function zoomFromScale(scale: number): number {
  return Math.log2(Math.max(1, scale));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function depthBlend(priority: number, minimum: number): number {
  return minimum + (1 - minimum) * clamp(priority, 0, 1);
}

function toVec3(value: readonly number[] | undefined): Vec3 {
  return [value?.[0] ?? 0, value?.[1] ?? 0, value?.[2] ?? 0];
}

function targetForMode(value: readonly number[] | undefined, mode: MapMode): Vec3 {
  const target = toVec3(value);
  return mode === "2d" ? [target[0], target[1], 0] : target;
}

function normalizeVec3(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 0.000001 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, -1];
}

function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function zoomBoundsForMode(mode: MapMode): [number, number] {
  return mode === "2d" ? [MIN_2D_ZOOM, MAX_2D_ZOOM] : [MIN_3D_ZOOM, MAX_3D_ZOOM];
}

function clampZoomForMode(zoom: number, mode: MapMode): number {
  const [minZoom, maxZoom] = zoomBoundsForMode(mode);
  return clamp(zoom, minZoom, maxZoom);
}

function viewWithModeDefaults(viewState: DeckViewState, mode: MapMode): DeckViewState {
  const zoom = clampZoomForMode(zoomValue(viewState), mode);
  if (mode === "2d") {
    return {
      ...DEFAULT_2D_VIEW,
      target: targetForMode(viewState.target, "2d"),
      zoom,
      zoomX: zoom,
      zoomY: zoom,
    };
  }
  return {
    ...DEFAULT_3D_VIEW,
    target: targetForMode(viewState.target, "3d"),
    zoom,
    rotationOrbit: "rotationOrbit" in viewState ? viewState.rotationOrbit : DEFAULT_3D_VIEW.rotationOrbit,
    rotationX: "rotationX" in viewState ? viewState.rotationX : DEFAULT_3D_VIEW.rotationX,
  };
}

function orbitViewportFromState(viewState: OrbitViewState, size: ViewportSize): OrbitViewport {
  return new OrbitViewport({
    id: "main",
    width: Math.max(1, size.width),
    height: Math.max(1, size.height),
    target: toVec3(viewState.target),
    zoom: zoomValue(viewState),
    rotationOrbit: viewState.rotationOrbit ?? DEFAULT_3D_VIEW.rotationOrbit ?? 0,
    rotationX: viewState.rotationX ?? DEFAULT_3D_VIEW.rotationX ?? 0,
    orbitAxis: "Z",
    fovy: 50,
  });
}

function createDepthCueBySystemId(
  systems: SolarSystem[],
  viewState: DeckViewState,
  viewportSize: ViewportSize,
  projector: CoordinateProjector,
): Map<number, DepthCue> {
  if (!systems.length) return new Map();

  const orbitState = viewWithModeDefaults(viewState, "3d") as OrbitViewState;
  const target = toVec3(orbitState.target);
  const viewport = orbitViewportFromState(orbitState, viewportSize);
  const camera = toVec3(viewport.cameraPosition);
  const forward = normalizeVec3([
    target[0] - camera[0],
    target[1] - camera[1],
    target[2] - camera[2],
  ]);
  const depths = systems.map((system) => {
    const position = projector.toScene(system, "3d");
    return {
      id: system.id,
      depth: dotVec3([position[0] - camera[0], position[1] - camera[1], position[2] - camera[2]], forward),
    };
  });
  const minDepth = Math.min(...depths.map((entry) => entry.depth));
  const maxDepth = Math.max(...depths.map((entry) => entry.depth));
  const span = Math.max(1, maxDepth - minDepth);
  const cues = new Map<number, DepthCue>();

  for (const entry of depths) {
    const normalizedDepth = (entry.depth - minDepth) / span;
    const distantAmount = smoothstep(0.12, 0.92, normalizedDepth);
    cues.set(entry.id, { priority: 1 - distantAmount });
  }

  return cues;
}

function drag3dViewState(drag: DragState, point: { x: number; y: number }): DeckViewState {
  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;
  const start = viewWithModeDefaults(drag.startViewState, "3d") as OrbitViewState;

  if (drag.button === "right") {
    const startTarget: Vec3 = [
      start.target[0] ?? 0,
      start.target[1] ?? 0,
      start.target[2] ?? 0,
    ];
    const viewport = orbitViewportFromState(start, { width: drag.viewportWidth, height: drag.viewportHeight });
    const center = viewport.project(startTarget);
    const nextTarget = viewport.panByPosition(startTarget, [center[0] + dx, center[1] + dy]).target ?? startTarget;

    return {
      ...start,
      target: [
        nextTarget[0] ?? startTarget[0],
        nextTarget[1] ?? startTarget[1],
        nextTarget[2] ?? startTarget[2],
      ],
    };
  }

  return {
    ...start,
    rotationOrbit: (start.rotationOrbit ?? DEFAULT_3D_VIEW.rotationOrbit ?? 0) + dx * ROTATE_SENSITIVITY,
    rotationX: clamp(
      (start.rotationX ?? DEFAULT_3D_VIEW.rotationX ?? 0) + dy * ROTATE_SENSITIVITY,
      DEFAULT_3D_VIEW.minRotationX ?? -85,
      DEFAULT_3D_VIEW.maxRotationX ?? 85,
    ),
  };
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("button, a, input, select, textarea, [role='button']"));
}

function tooltipText(
  datum: SystemDatum,
  t: (key: string) => string,
): string {
  const lines = [datum.system.name];
  const status = datum.status;
  if (!status) return lines.join("\n");

  if (status.development) {
    lines.push(
      `${t("details.military")} ${status.development.military_level} / ${t("details.industrial")} ${status.development.industrial_level} / ${t("details.strategic")} ${status.development.strategic_level}`,
    );
  }
  if (status.resources) {
    lines.push(
      `${t("details.power")} ${status.resources.power.allocated}/${status.resources.power.available}  ${t("details.workforce")} ${status.resources.workforce.allocated}/${status.resources.workforce.available}`,
    );
  }
  const transportText = formatWorkforceTransport(status.workforce_transport, t);
  if (transportText) lines.push(transportText);
  if (status.reagent_bay?.reagents?.length) {
    const reagentText = status.reagent_bay.reagents
      .slice(0, 2)
      .map((reagent) => `${translateType(reagent.type_id)}: ${reagent.amount}`)
      .join(", ");
    lines.push(`${t("details.reagents")}: ${reagentText}`);
  }
  if (status.upgrades?.length) {
    lines.push(
      ...status.upgrades.map(
        (upgrade) =>
          `- ${translateType(upgrade.type_id ?? upgrade.typeId)}${upgrade.power_state ? ` (${translatePowerState(upgrade.power_state)})` : ""}`,
      ),
    );
  }
  if (status.skyhooks?.length) {
    lines.push(`${t("map.raidableSkyhook")}: ${status.skyhooks.length}`);
  }
  return lines.join("\n");
}

const Starmap: React.FC<StarmapProps> = ({
  mapData,
  sovData,
  onSystemClick,
  onSystemHover,
  activeSystem,
  loading = false,
  centerTarget = null,
  initialRegionId,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<MapMode>("2d");
  const [viewState, setViewState] = useState<DeckViewState>(DEFAULT_2D_VIEW);
  const [hoveredSystem, setHoveredSystem] = useState<SolarSystem | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 1, height: 1 });
  const didFitInitialRegion = useRef(false);
  const dragState = useRef<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const projector = useMemo(() => createCoordinateProjector(mapData), [mapData]);
  const positionForMode = useCallback(
    (system: SolarSystem) => projector.toScene(system, mode),
    [mode, projector],
  );
  const currentUiFont = uiFont();
  const zoom = zoomValue(viewState);
  const visualScale = scaleFromZoom(zoom);
  const regionOverview = visualScale < REGION_LABEL_SCALE;

  const sovMap = useMemo(() => {
    const map = new Map<number, SovereigntySystemStatus>();
    if (sovData) {
      for (const status of sovData) map.set(status.system_id, status);
    }
    return map;
  }, [sovData]);

  const systemMap = useMemo(() => {
    const map = new Map<number, SolarSystem>();
    if (mapData?.systems) {
      for (const system of mapData.systems) map.set(system.id, system);
    }
    return map;
  }, [mapData]);

  const depthCueBySystemId = useMemo(
    () =>
      mode === "3d" && mapData?.systems
        ? createDepthCueBySystemId(mapData.systems, viewState, viewportSize, projector)
        : new Map<number, DepthCue>(),
    [mapData, mode, projector, viewState, viewportSize],
  );

  const systems = useMemo<SystemDatum[]>(() => {
    if (!mapData?.systems) return [];
    return mapData.systems.map((system) => {
      const status = sovMap.get(system.id);
      const isActive = activeSystem?.id === system.id;
      const isHovered = hoveredSystem?.id === system.id;
      const depthPriority = mode === "3d" && !isActive && !isHovered
        ? (depthCueBySystemId.get(system.id)?.priority ?? 1)
        : 1;
      return {
        system,
        status,
        position: positionForMode(system),
        radius: systemRadius(status, zoom),
        color: admColor(status),
        depthPriority,
        isPlayerSov: Boolean(status?.alliance_id),
        isActive,
        isHovered,
      };
    });
  }, [activeSystem, depthCueBySystemId, hoveredSystem, mapData, mode, positionForMode, sovMap, zoom]);

  const edges = useMemo<EdgeDatum[]>(() => {
    if (!mapData?.edges) return [];
    return mapData.edges.flatMap((edge) => {
      const from = systemMap.get(edge.from);
      const to = systemMap.get(edge.to);
      if (!from || !to) return [];
      const fromPriority = depthCueBySystemId.get(from.id)?.priority ?? 1;
      const toPriority = depthCueBySystemId.get(to.id)?.priority ?? 1;
      return [{
        from,
        to,
        source: positionForMode(from),
        target: positionForMode(to),
        crossRegion: from.regionId !== to.regionId,
        depthPriority: mode === "3d" ? Math.max(fromPriority, toPriority) : 1,
      }];
    });
  }, [depthCueBySystemId, mapData, mode, positionForMode, systemMap]);

  const labelData = useMemo<LabelDatum[]>(() => {
    if (!mapData?.systems) return [];
    const labels: LabelDatum[] = [];
    if (regionOverview) {
      if (mapData.regions) {
        for (const region of mapData.regions) {
          const regionSystems = mapData.systems.filter((system) => system.regionId === region.id);
          labels.push({
            id: region.id,
            name: region.name,
            position: averagePosition(regionSystems.map(positionForMode)),
            kind: "region",
            depthPriority: 1,
          });
        }
      }
      return labels;
    }

    const showAllSystemLabels = visualScale >= SYSTEM_LABEL_SCALE;
    const showImportantSystemLabels = visualScale >= IMPORTANT_SYSTEM_LABEL_SCALE;
    for (const datum of systems) {
      if (
        datum.isActive ||
        datum.isHovered ||
        showAllSystemLabels ||
        (showImportantSystemLabels && Boolean(datum.status?.is_capital_system || datum.status?.skyhooks?.length))
      ) {
        labels.push({
          id: datum.system.id,
          name: datum.system.name,
          position: datum.position,
          kind: "system",
          depthPriority: datum.depthPriority,
          active: datum.isActive,
        });
      }
    }

    if (visualScale >= IMPORTANT_SYSTEM_LABEL_SCALE && visualScale < DETAIL_SCALE && mapData.constellations) {
      for (const constellation of mapData.constellations) {
        const constellationSystems = mapData.systems.filter((system) => system.constellationId === constellation.id);
        labels.push({
          id: constellation.id,
          name: constellation.name,
          position: averagePosition(constellationSystems.map(positionForMode)),
          kind: "constellation",
          depthPriority: mode === "3d"
            ? Math.max(...constellationSystems.map((system) => depthCueBySystemId.get(system.id)?.priority ?? 1))
            : 1,
        });
      }
    }

    return labels;
  }, [depthCueBySystemId, mapData, mode, positionForMode, regionOverview, systems, visualScale]);

  const systemNodeIds = useMemo(
    () => new Set(labelData.filter((label) => label.kind === "system").map((label) => label.id)),
    [labelData],
  );
  const systemNodeData = useMemo(
    () => systems.filter((datum) => systemNodeIds.has(datum.system.id)),
    [systemNodeIds, systems],
  );
  const mapLabelData = useMemo(() => labelData.filter((label) => label.kind !== "system"), [labelData]);

  const initialRegionView = useMemo(() => {
    if (!mapData?.systems || !initialRegionId) return null;
    const regionSystems = mapData.systems.filter((system) => system.regionId === initialRegionId);
    return fitViewForSystems(regionSystems, mode, projector);
  }, [initialRegionId, mapData, mode, projector]);

  const applyViewState = useCallback((nextViewState: DeckViewState) => {
    setViewState(nextViewState);
  }, []);

  const handleReset = useCallback(() => {
    applyViewState(initialRegionView ?? (mode === "2d" ? DEFAULT_2D_VIEW : DEFAULT_3D_VIEW));
  }, [applyViewState, initialRegionView, mode]);

  useEffect(() => {
    if (!initialRegionView || didFitInitialRegion.current) return;
    didFitInitialRegion.current = true;
    setViewState(initialRegionView);
  }, [initialRegionView]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateViewportSize = () => {
      const rect = container.getBoundingClientRect();
      setViewportSize((current) => {
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        return current.width === width && current.height === height ? current : { width, height };
      });
    };

    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const switchMode = useCallback((nextMode: MapMode) => {
    setMode(nextMode);
    setViewState((current) => viewWithModeDefaults(current, nextMode));
  }, []);

  useEffect(() => {
    if (!centerTarget) return;
    const target = targetForMode(positionForMode(centerTarget.system), mode);
    setViewState((current) => {
      const nextZoom = clampZoomForMode(Math.max(zoomValue(current), zoomFromScale(centerTarget.zoom)), mode);
      return {
        ...(mode === "2d" ? DEFAULT_2D_VIEW : DEFAULT_3D_VIEW),
        ...current,
        target,
        zoom: nextZoom,
      };
    });
  }, [centerTarget, mode, positionForMode]);

  const controller = useMemo<StarmapControllerOptions>(
    () =>
      mode === "2d"
        ? {
            dragPan: true,
            dragRotate: false,
            dragMode: "pan",
            scrollZoom: true,
            doubleClickZoom: false,
            touchZoom: true,
            touchRotate: false,
            keyboard: true,
          }
        : false,
    [mode],
  );
  const views = useMemo(
    () =>
      mode === "2d"
        ? new OrthographicView({ id: "main", controller, flipY: false })
        : new OrbitView({ id: "main", controller, orbitAxis: "Z", fovy: 50 }),
    [controller, mode],
  );

  const layers = useMemo(() => {
    const showDetails = visualScale >= DETAIL_SCALE;
    return [
      new LineLayer<EdgeDatum>({
        id: "stargates",
        data: edges,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getSourcePosition: (edge) => edge.source,
        getTargetPosition: (edge) => edge.target,
        getColor: (edge) => {
          const color = hexToColor(getSecurityColor(edge.from.security), edge.crossRegion ? 120 : 85);
          return mode === "3d" ? colorWithDepth(color, edge.depthPriority, DISTANT_LINE_ALPHA) : color;
        },
        getWidth: (edge) => {
          const width = edge.crossRegion && visualScale > IMPORTANT_SYSTEM_LABEL_SCALE ? 1.4 : 0.8;
          return mode === "3d" ? width * depthBlend(edge.depthPriority, DISTANT_LINE_WIDTH) : width;
        },
        widthUnits: "pixels",
      }),
      new ScatterplotLayer<SystemDatum>({
        id: "system-dots",
        data: systems,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        pickable: true,
        billboard: mode === "3d",
        stroked: true,
        filled: true,
        radiusUnits: "pixels",
        lineWidthUnits: "pixels",
        getPosition: (datum) => datum.position,
        getRadius: (datum) =>
          mode === "3d" ? datum.radius * depthBlend(datum.depthPriority, DISTANT_NODE_RADIUS) : datum.radius,
        getFillColor: (datum) =>
          mode === "3d" ? colorWithDepth(datum.color, datum.depthPriority, DISTANT_NODE_ALPHA) : datum.color,
        getLineColor: (datum) => {
          let color: Color = [24, 24, 27, 180];
          if (datum.status?.is_capital_system) color = [251, 191, 36, 255];
          if (datum.isActive || datum.isHovered) color = [255, 255, 255, 255];
          if (datum.status?.skyhooks?.length) color = [34, 211, 238, 230];
          return mode === "3d" ? colorWithDepth(color, datum.depthPriority, DISTANT_NODE_ALPHA) : color;
        },
        getLineWidth: (datum) => {
          let width = 0.5;
          if (datum.isActive || datum.isHovered) width = 2.5;
          else if (datum.status?.is_capital_system || datum.status?.skyhooks?.length) width = showDetails ? 2 : 1;
          return mode === "3d" ? width * depthBlend(datum.depthPriority, DISTANT_LINE_WIDTH) : width;
        },
        radiusMinPixels: 2,
        radiusMaxPixels: 18,
        lineWidthMinPixels: 0.5,
        onClick: (info: PickingInfo<SystemDatum>) => {
          if (info.object) onSystemClick?.(info.object.system);
          return true;
        },
        onHover: (info: PickingInfo<SystemDatum>) => {
          const system = info.object?.system ?? null;
          setHoveredSystem(system);
          onSystemHover?.(system);
          return true;
        },
      }),
      new TextLayer<SystemDatum>({
        id: "adm-values",
        data: showDetails && !regionOverview && systemNodeData.length === 0 ? systems.filter((datum) => datum.isPlayerSov) : [],
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: (datum) => datum.position,
        getText: (datum) => (datum.status?.adm ?? datum.status?.development?.activity_defense_multiplier)?.toFixed(1) ?? "-",
        getColor: (datum) => (mode === "3d" ? colorWithDepth([0, 0, 0, 255], datum.depthPriority, 0.35) : [0, 0, 0, 255]),
        getSize: (datum) => (mode === "3d" ? 9 * depthBlend(datum.depthPriority, DISTANT_LABEL_SIZE) : 9),
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        fontFamily: currentUiFont,
        fontWeight: "700",
        billboard: true,
        characterSet: "auto",
      }),
      new TextLayer<SystemDatum>({
        id: "system-node-cards",
        data: systemNodeData,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        pickable: true,
        getPosition: (datum) => datum.position,
        getText: (datum) => dotlanNodeText(datum, showDetails),
        getColor: (datum) => {
          const color = dotlanNodeTextColor(datum);
          return mode === "3d" ? colorWithDepth(color, datum.depthPriority, DISTANT_LABEL_ALPHA) : color;
        },
        getSize: (datum) => {
          const size = showDetails ? 9 : 10;
          return mode === "3d" ? size * depthBlend(datum.depthPriority, DISTANT_LABEL_SIZE) : size;
        },
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        getPixelOffset: [0, 0],
        background: true,
        getBackgroundColor: (datum) => {
          const color = dotlanNodeBackground(datum);
          return mode === "3d" ? colorWithDepth(color, datum.depthPriority, DISTANT_NODE_ALPHA) : color;
        },
        getBorderColor: (datum) => {
          const color = dotlanNodeBorder(datum);
          return mode === "3d" ? colorWithDepth(color, datum.depthPriority, DISTANT_LABEL_ALPHA) : color;
        },
        getBorderWidth: (datum) => (datum.isActive || datum.isHovered ? 2 : datum.status?.is_capital_system ? 1.5 : 1),
        backgroundPadding: showDetails ? [7, 4, 7, 4] : [6, 3, 6, 3],
        backgroundBorderRadius: 2,
        fontFamily: SYSTEM_NAME_FONT,
        fontWeight: "700",
        lineHeight: 1.12,
        billboard: true,
        characterSet: "auto",
        onClick: (info: PickingInfo<SystemDatum>) => {
          if (info.object) onSystemClick?.(info.object.system);
          return true;
        },
        onHover: (info: PickingInfo<SystemDatum>) => {
          const system = info.object?.system ?? null;
          setHoveredSystem(system);
          onSystemHover?.(system);
          return true;
        },
      }),
      new TextLayer<LabelDatum>({
        id: "labels",
        data: mapLabelData,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: (label) => label.position,
        getText: (label) => label.name,
        getColor: (label) => {
          let color: Color = label.active ? [255, 255, 255, 255] : [209, 213, 219, 235];
          if (label.kind === "region") color = [125, 211, 252, 220];
          if (label.kind === "constellation") color = [74, 222, 128, 235];
          return mode === "3d" ? colorWithDepth(color, label.depthPriority, DISTANT_LABEL_ALPHA) : color;
        },
        getSize: (label) => {
          const size = label.kind === "region" ? 14 : label.kind === "constellation" ? 11 : showDetails ? 11 : 9;
          return mode === "3d" ? size * depthBlend(label.depthPriority, DISTANT_LABEL_SIZE) : size;
        },
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        getPixelOffset: (label) => (label.kind === "system" ? [0, -8] : [0, 0]),
        background: true,
        getBackgroundColor: (label) => {
          const color: Color = label.kind === "system" ? [0, 0, 0, 0] : [0, 0, 0, 170];
          return mode === "3d" ? colorWithDepth(color, label.depthPriority, DISTANT_LABEL_ALPHA) : color;
        },
        backgroundPadding: [5, 2],
        backgroundBorderRadius: 3,
        fontFamily: SYSTEM_NAME_FONT,
        fontWeight: "700",
        billboard: true,
        characterSet: "auto",
      }),
    ];
  }, [currentUiFont, edges, mapLabelData, mode, onSystemClick, onSystemHover, regionOverview, systemNodeData, systems, visualScale]);

  const handleViewStateChange = useCallback((params: ViewStateChangeParameters<DeckViewState>) => {
    const nextViewState = viewWithModeDefaults(params.viewState, mode);
    setViewState(nextViewState);
  }, [mode]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== "3d" || isInteractiveTarget(event.target)) return;
    if (event.button !== 0 && event.button !== 2) return;

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      button: event.button === 2 ? "right" : "left",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewportWidth: Math.max(1, rect.width),
      viewportHeight: Math.max(1, rect.height),
      startViewState: viewWithModeDefaults(viewState, "3d"),
    };
  }, [mode, viewState]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== "3d" || !dragState.current) return;
    if (dragState.current.pointerId !== event.pointerId) return;

    event.preventDefault();
    setViewState(drag3dViewState(dragState.current, { x: event.clientX, y: event.clientY }));
  }, [mode]);

  const finishPointerDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (mode === "3d" && dragState.current?.pointerId === event.pointerId) {
      event.preventDefault();
      setViewState(drag3dViewState(dragState.current, { x: event.clientX, y: event.clientY }));
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragState.current = null;
    }
  }, [mode]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (mode !== "3d" || isInteractiveTarget(event.target)) return;

    event.preventDefault();
    setViewState((current) => {
      const start = viewWithModeDefaults(current, "3d") as OrbitViewState;
      return {
        ...start,
        zoom: clampZoomForMode(zoomValue(start) - event.deltaY * WHEEL_ZOOM_SENSITIVITY, "3d"),
      };
    });
  }, [mode]);

  return (
    <div
      ref={containerRef}
      className="starmap-container"
      role="application"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onWheel={handleWheel}
    >
      <DeckGL
        views={views}
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        layers={layers}
        getTooltip={({ object }: PickingInfo<SystemDatum>) =>
          object
            ? {
                text: tooltipText(object, t),
                style: {
                  backgroundColor: "rgba(9, 9, 11, 0.92)",
                  border: "1px solid rgba(63, 63, 70, 0.8)",
                  borderRadius: "4px",
                  color: "#d4d4d8",
                  fontFamily: currentUiFont,
                  fontSize: "11px",
                  lineHeight: "1.45",
                  maxWidth: "360px",
                  whiteSpace: "pre-line",
                },
              }
            : null
        }
        style={{ background: "transparent" }}
      />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(17,24,39,0.28)_0%,rgba(0,0,0,0)_62%)]" />

      <div className="absolute top-4 right-4 flex flex-col gap-2">
        <div className="flex rounded-md border border-white/10 bg-black/45 p-1 shadow-lg backdrop-blur-md">
          <button
            type="button"
            onClick={() => switchMode("2d")}
            className={`px-2 py-1 text-[11px] ${mode === "2d" ? "bg-orange-500/25 text-white" : "text-zinc-400 hover:text-white"}`}
          >
            2D
          </button>
          <button
            type="button"
            onClick={() => switchMode("3d")}
            className={`px-2 py-1 text-[11px] ${mode === "3d" ? "bg-orange-500/25 text-white" : "text-zinc-400 hover:text-white"}`}
          >
            3D
          </button>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="p-2 bg-black/40 backdrop-blur-md hover:bg-orange-500/20 rounded-lg border border-white/10 hover:border-orange-500/50 transition-all shadow-lg group"
          title={t("map.resetView")}
        >
          <RotateCcw
            size={18}
            className="text-gray-300 group-hover:text-white"
          />
        </button>
      </div>

      <div className="absolute bottom-20 left-4 p-3 bg-gray-900/90 backdrop-blur-md border border-gray-800 rounded-lg shadow-xl text-xs text-gray-300 space-y-2 pointer-events-none select-none z-10 w-40">
        <div className="font-bold text-gray-500 mb-2 border-b border-gray-700 pb-1">
          {t("map.legend")}
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full bg-[#ef4444] shadow-[0_0_5px_rgba(239,68,68,0.5)]"></div>
          <span>{t("map.admHighest")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full bg-[#ffffff] shadow-[0_0_5px_rgba(255,255,255,0.5)]"></div>
          <span>{t("map.admLowest")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full border border-[#fbbf24]"></div>
          <span>{t("map.capitalSystem")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full border border-dashed border-[#22d3ee]"></div>
          <span>{t("map.raidableSkyhook")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ffffff]"></div>
          <span>{t("map.noSovereigntyData")}</span>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-orange-500 mx-auto"></div>
            <p className="text-gray-400 mt-3">{t("map.loading")}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Starmap;
