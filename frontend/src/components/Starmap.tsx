import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { MapDataset, SolarSystem, SovereigntySystemStatus } from "../types";
import { getSecurityColor } from "../utils";
import { RotateCcw } from "lucide-react";

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

interface ViewState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

const VIEW_CONFIG = {
  MIN_SCALE: 0.1,
  MAX_SCALE: 40.0,
};

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
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewState, setViewState] = useState<ViewState>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const [hoveredSystem, setHoveredSystem] = useState<SolarSystem | null>(null);

  const getSystemPos = useCallback(
    (sys: SolarSystem): { x: number; y: number } => {
      if (sys.x2d !== undefined && sys.y2d !== undefined) {
        return { x: sys.x2d, y: -sys.y2d };
      }
      return { x: sys.x, y: -sys.z };
    },
    [],
  );

  const { bounds, normalizedPositions } = useMemo(() => {
    if (!mapData?.systems?.length)
      return { bounds: null, normalizedPositions: new Map() };

    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

    for (const sys of mapData.systems) {
      const pos = getSystemPos(sys);
      if (pos.x < minX) minX = pos.x;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.y > maxY) maxY = pos.y;
    }

    const w = maxX - minX;
    const h = maxY - minY;

    const normalize = (px: number, py: number): { x: number; y: number } => {
      const rawNx = w === 0 ? 0.5 : (px - minX) / w;
      const rawNy = h === 0 ? 0.5 : (py - minY) / h;
      const scaleFactor = 0.6;
      const offset = (1.0 - scaleFactor) / 2.0;
      return {
        x: rawNx * scaleFactor + offset,
        y: rawNy * scaleFactor + offset,
      };
    };

    const positions = new Map<number, { x: number; y: number }>();
    for (const sys of mapData.systems) {
      const pos = getSystemPos(sys);
      positions.set(sys.id, normalize(pos.x, pos.y));
    }

    return {
      bounds: {
        minX,
        maxX,
        minY,
        maxY,
        width: w,
        height: h,
        aspect: h === 0 ? 1 : w / h,
      },
      normalizedPositions: positions,
    };
  }, [mapData, getSystemPos]);

  const systemMap = useMemo(() => {
    const map = new Map<number, SolarSystem>();
    if (mapData?.systems) {
      for (const sys of mapData.systems) {
        map.set(sys.id, sys);
      }
    }
    return map;
  }, [mapData]);

  const normalizedToScreen = useCallback(
    (nx: number, ny: number): { x: number; y: number } => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height);
      const marginX = (rect.width - size) / 2;
      const marginY = (rect.height - size) / 2;
      const screenX = marginX + nx * size * viewState.scale + viewState.offsetX;
      const screenY = marginY + ny * size * viewState.scale + viewState.offsetY;
      return { x: screenX, y: screenY };
    },
    [viewState],
  );

  const getSystemScreenPos = useCallback(
    (
      sys: SolarSystem,
      screenPosCache: Map<number, { x: number; y: number }>,
    ): { x: number; y: number } => {
      if (screenPosCache.has(sys.id)) {
        return screenPosCache.get(sys.id)!;
      }
      const normPos = normalizedPositions.get(sys.id);
      let pos: { x: number; y: number };
      if (!normPos) {
        const rawPos = getSystemPos(sys);
        pos = normalizedToScreen(rawPos.x, rawPos.y);
      } else {
        pos = normalizedToScreen(normPos.x, normPos.y);
      }
      screenPosCache.set(sys.id, pos);
      return pos;
    },
    [normalizedPositions, normalizedToScreen, getSystemPos],
  );

  const findSystemAtPosition = useCallback(
    (screenX: number, screenY: number): SolarSystem | null => {
      if (!mapData?.systems) return null;
      const threshold = 15;
      let closest: SolarSystem | null = null;
      let closestDist = Infinity;
      const screenPosCache = new Map<number, { x: number; y: number }>();

      if (sovData) {
        const sovMap = new Map<number, SovereigntySystemStatus>();
        for (const s of sovData) sovMap.set(s.system_id, s);

        for (const sys of mapData.systems) {
          const status = sovMap.get(sys.id);
          if (!status || !status.upgrades || status.upgrades.length === 0)
            continue;

          const pos = getSystemScreenPos(sys, screenPosCache);
          const radius = 14;
          const boxPadding = 6;
          const fontSize = 10;

          const measureCtx = canvasRef.current?.getContext("2d");
          if (!measureCtx) continue;
          measureCtx.font = `${fontSize}px "MapleMono", monospace`;

          const titleText = sys.name;
          let maxTextWidth = measureCtx.measureText(titleText).width;
          for (const ug of status.upgrades) {
            const w = measureCtx.measureText(`\u2022 ${ug.name}`).width;
            if (w > maxTextWidth) maxTextWidth = w;
          }

          const boxWidth = maxTextWidth + boxPadding * 2;
          const lineCount = status.upgrades.length + 1;
          const boxHeight = lineCount * (fontSize + 4) + boxPadding * 2;
          const boxX = pos.x - boxWidth / 2;
          const boxY = pos.y - radius - boxHeight - 6;

          if (
            screenX >= boxX &&
            screenX <= boxX + boxWidth &&
            screenY >= boxY &&
            screenY <= boxY + boxHeight
          ) {
            return sys;
          }
        }
      }

      for (const sys of mapData.systems) {
        const pos = getSystemScreenPos(sys, screenPosCache);
        const dist = Math.sqrt(
          Math.pow(pos.x - screenX, 2) + Math.pow(pos.y - screenY, 2),
        );
        if (dist < threshold && dist < closestDist) {
          closest = sys;
          closestDist = dist;
        }
      }

      return closest;
    },
    [mapData, getSystemScreenPos, sovData],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !mapData || !bounds) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    ctx.fillStyle = "#010409";
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    for (let i = 0; i < 400; i++) {
      const x = (((i * 7919) % 1000) / 1000) * rect.width;
      const y = (((i * 104729) % 1000) / 1000) * rect.height;
      const size = (((i * 31) % 100) / 100) * 1.0 + 0.2;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    const screenPosCache = new Map<number, { x: number; y: number }>();
    const getCachedPos = (sys: SolarSystem) =>
      getSystemScreenPos(sys, screenPosCache);

    const padding = 50;
    const visibleSystems = mapData.systems.filter((sys) => {
      const pos = getCachedPos(sys);
      return (
        pos.x > -padding &&
        pos.x < rect.width + padding &&
        pos.y > -padding &&
        pos.y < rect.height + padding
      );
    });

    const scale = viewState.scale;
    const showRegionLabels = scale < 4.0;
    const regionLabelOpacity =
      scale > 2.0 ? Math.max(0, (4.0 - scale) / 2.0) : 1.0;
    const showConstellationLabels = scale >= 3.0 && scale < 7.0;
    const showSystemLabels = scale >= 5.0;
    const showSystemDetails = scale >= 7.0;

    // stargate connections
    if (mapData.edges) {
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 0.8;
      for (const edge of mapData.edges) {
        const fromSys = systemMap.get(edge.from);
        const toSys = systemMap.get(edge.to);
        if (!fromSys || !toSys) continue;
        const from = getCachedPos(fromSys);
        const to = getCachedPos(toSys);

        const isFromVisible =
          from.x > -padding &&
          from.x < rect.width + padding &&
          from.y > -padding &&
          from.y < rect.height + padding;
        const isToVisible =
          to.x > -padding &&
          to.x < rect.width + padding &&
          to.y > -padding &&
          to.y < rect.height + padding;
        if (!isFromVisible && !isToVisible) continue;

        const isCrossRegion = fromSys.regionId !== toSys.regionId;
        if (isCrossRegion && scale > 3.0) {
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 6]);
        } else {
          ctx.globalAlpha = 0.3;
          ctx.lineWidth = 0.8;
          ctx.setLineDash([]);
        }

        ctx.strokeStyle = getSecurityColor(fromSys.security);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // constellation names
    if (showConstellationLabels && mapData.constellations) {
      ctx.fillStyle = "#4ade80";
      ctx.font = '11px "MapleMono", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const constellation of mapData.constellations) {
        const constellationSystems = mapData.systems.filter(
          (s) => s.constellationId === constellation.id,
        );
        if (constellationSystems.length === 0) continue;

        let sumX = 0,
          sumY = 0;
        for (const sys of constellationSystems) {
          const pos = normalizedPositions.get(sys.id);
          if (pos) {
            sumX += pos.x;
            sumY += pos.y;
          }
        }
        const avgPos = normalizedToScreen(
          sumX / constellationSystems.length,
          sumY / constellationSystems.length,
        );
        if (
          avgPos.x > -padding &&
          avgPos.x < rect.width + padding &&
          avgPos.y > -padding &&
          avgPos.y < rect.height + padding
        ) {
          ctx.fillText(constellation.name, avgPos.x + 2, avgPos.y - 2);
        }
      }
    }

    // sov lookup
    const sovMap = new Map<number, SovereigntySystemStatus>();
    if (sovData) {
      for (const s of sovData) {
        sovMap.set(s.system_id, s);
      }
    }

    // system dots
    const baseRadius = showSystemDetails ? 12 : 2.5;

    for (const sys of visibleSystems) {
      const pos = getCachedPos(sys);
      const isActive = activeSystem?.id === sys.id;
      const isHovered = hoveredSystem?.id === sys.id;

      let radius = baseRadius;
      let color: string;

      const sov = sovMap.get(sys.id);
      if (sov) {
        // ADM 1.0 → white, ADM 5.0 → red
        radius = showSystemDetails ? 14 : 5.0;
        const t = Math.max(0, Math.min(1, (sov.adm - 1.0) / 4.0));
        const r = Math.round(255 + t * (239 - 255));
        const g = Math.round(255 + t * (68 - 255));
        const b = Math.round(255 + t * (68 - 255));
        color = `rgb(${r}, ${g}, ${b})`;
      } else {
        radius = 2.5;
        color = "#ffffff";
      }

      // glow ring for selected or hovered
      if (isActive || isHovered) {
        const glowRadius = radius * 2.0;
        const gradient = ctx.createRadialGradient(
          pos.x,
          pos.y,
          0,
          pos.x,
          pos.y,
          glowRadius,
        );
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, "transparent");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // render dot
      ctx.fillStyle = color;
      ctx.globalAlpha = showSystemDetails ? 0.9 : 0.85;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // ADM value inside dot
      if (showSystemDetails && sov) {
        ctx.fillStyle = "#000000";
        ctx.font = 'bold 9px "MapleMono", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sov.adm.toFixed(1), pos.x, pos.y + 1);
      }

      // system name label
      const shouldShowLabel = showSystemLabels || isActive || isHovered;
      if (shouldShowLabel) {
        ctx.fillStyle = isActive ? "#ffffff" : "#d1d5db";
        ctx.font = showSystemDetails
          ? '11px "MapleMono", monospace'
          : '9px "MapleMono", monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.shadowColor = "rgba(0, 0, 0, 0.95)";
        ctx.shadowBlur = 4;
        ctx.fillText(sys.name, pos.x, pos.y + radius + 4);
        ctx.shadowBlur = 0;
      }
    }

    // upgrade tooltips — topmost system layer
    if (scale >= 18.0 && sovData) {
      const sortedSystems = visibleSystems.toSorted((a) =>
        a.id === hoveredSystem?.id ? 1 : -1,
      );

      for (const sys of sortedSystems) {
        const status = sovMap.get(sys.id);
        if (!status || !status.upgrades || status.upgrades.length === 0)
          continue;
        const pos = getCachedPos(sys);
        const radius = showSystemDetails ? 14 : 5.0;

        const boxPadding = 6;
        const fontSize = 10;
        ctx.font = `${fontSize}px "MapleMono", monospace`;

        const titleText = sys.name;
        let maxTextWidth = ctx.measureText(titleText).width;
        for (const ug of status.upgrades) {
          const w = ctx.measureText(`\u2022 ${ug.name}`).width;
          if (w > maxTextWidth) maxTextWidth = w;
        }

        const boxWidth = maxTextWidth + boxPadding * 2;
        const lineCount = status.upgrades.length + 1;
        const boxHeight = lineCount * (fontSize + 4) + boxPadding * 2;
        const boxX = pos.x - boxWidth / 2;
        const boxY = pos.y - radius - boxHeight - 6;

        // tooltip bg
        ctx.fillStyle = "rgba(9, 9, 11, 0.85)";
        ctx.strokeStyle = "rgba(39, 39, 42, 0.8)";
        ctx.lineWidth = 1;

        const rx = boxX,
          ry = boxY,
          rw = boxWidth,
          rh = boxHeight,
          rad = 4;
        ctx.beginPath();
        ctx.moveTo(rx + rad, ry);
        ctx.lineTo(rx + rw - rad, ry);
        ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rad);
        ctx.lineTo(rx + rw, ry + rh - rad);
        ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rad, ry + rh);
        ctx.lineTo(rx + rad, ry + rh);
        ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rad);
        ctx.lineTo(rx, ry + rad);
        ctx.quadraticCurveTo(rx, ry, rx + rad, ry);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // system name in tooltip
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#f97316";
        ctx.font = `bold ${fontSize}px "MapleMono", monospace`;
        ctx.fillText(titleText, boxX + boxPadding, boxY + boxPadding);

        // separator
        ctx.strokeStyle = "rgba(63, 63, 70, 0.4)";
        ctx.beginPath();
        ctx.moveTo(boxX + boxPadding, boxY + boxPadding + fontSize + 2);
        ctx.lineTo(
          boxX + boxWidth - boxPadding,
          boxY + boxPadding + fontSize + 2,
        );
        ctx.stroke();

        // upgrade items
        ctx.fillStyle = "#d1d5db";
        ctx.font = `${fontSize}px "MapleMono", monospace`;
        status.upgrades.forEach((ug, idx) => {
          const textY =
            boxY + boxPadding + (idx + 1) * (fontSize + 4) + 2;
          ctx.fillText(`\u2022 ${ug.name}`, boxX + boxPadding, textY);
        });
      }
    }

    // region labels — topmost layer
    if (showRegionLabels && regionLabelOpacity > 0 && mapData.regions) {
      ctx.globalAlpha = regionLabelOpacity;
      ctx.fillStyle = "#7dd3fc";
      ctx.font = 'bold 14px "MapleMono", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const region of mapData.regions) {
        const regionSystems = mapData.systems.filter(
          (s) => s.regionId === region.id,
        );
        if (regionSystems.length === 0) continue;

        let sumX = 0,
          sumY = 0;
        for (const sys of regionSystems) {
          const pos = normalizedPositions.get(sys.id);
          if (pos) {
            sumX += pos.x;
            sumY += pos.y;
          }
        }
        const avgPos = normalizedToScreen(
          sumX / regionSystems.length,
          sumY / regionSystems.length,
        );
        if (
          avgPos.x > -padding &&
          avgPos.x < rect.width + padding &&
          avgPos.y > -padding &&
          avgPos.y < rect.height + padding
        ) {
          const textWidth = ctx.measureText(region.name).width;
          ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
          ctx.fillRect(
            avgPos.x - textWidth / 2 - 4,
            avgPos.y - 10,
            textWidth + 8,
            20,
          );
          ctx.fillStyle = "#7dd3fc";
          ctx.fillText(region.name, avgPos.x, avgPos.y);
        }
      }
      ctx.globalAlpha = 1;
    }
  }, [
    mapData,
    bounds,
    viewState,
    getSystemScreenPos,
    hoveredSystem,
    activeSystem,
    systemMap,
    sovData,
    normalizedPositions,
    normalizedToScreen,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const handleResize = () => draw();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  // fit initial region on first load
  useEffect(() => {
    if (!mapData?.systems || !initialRegionId || normalizedPositions.size === 0 || !containerRef.current) return;

    const regionSystems = mapData.systems.filter((s) => s.regionId === initialRegionId);
    if (regionSystems.length < 2) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const sys of regionSystems) {
      const p = normalizedPositions.get(sys.id);
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (minX === Infinity) return;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const regionW = maxX - minX;
    const regionH = maxY - minY;

    const rect = containerRef.current.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const marginX = (rect.width - size) / 2;
    const marginY = (rect.height - size) / 2;

    const pad = 0.2;
    const fitScale = Math.min(
      (1 - pad * 2) / regionW,
      (1 - pad * 2) / regionH,
      8.0,
    );

    setViewState({
      scale: fitScale,
      offsetX: rect.width / 2 - marginX - centerX * size * fitScale,
      offsetY: rect.height / 2 - marginY - centerY * size * fitScale,
    });
  }, [mapData, initialRegionId, normalizedPositions]);

  // window-level mousemove/mouseup — keeps dragging smooth even outside canvas
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      setViewState((prev) => ({
        ...prev,
        offsetX: e.clientX - dragStartRef.current.x,
        offsetY: e.clientY - dragStartRef.current.y,
      }));
    };
    const onUp = () => { isDraggingRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      e.preventDefault();
      isDraggingRef.current = true;
      dragStartRef.current = {
        x: e.clientX - viewState.offsetX,
        y: e.clientY - viewState.offsetY,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingRef.current) return; // handled by window listener
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const system = findSystemAtPosition(
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    setHoveredSystem(system);
    onSystemHover?.(system);
  };

  const handleMouseUp = () => { /* handled by window listener */ };

  const handleMouseLeave = () => {
    // don't reset dragging — keep it smooth across container boundary
    setHoveredSystem(null);
    onSystemHover?.(null);
  };

  const handleClick = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const system = findSystemAtPosition(
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    if (system) {
      onSystemClick?.(system);
    }
  };

  // fly to clicked system
  useEffect(() => {
    if (
      !centerTarget ||
      !containerRef.current ||
      normalizedPositions.size === 0
    )
      return;

    const normPos = normalizedPositions.get(centerTarget.system.id);
    if (!normPos) return;

    setViewState((current) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return current;

      const size = Math.min(rect.width, rect.height);
      const marginX = (rect.width - size) / 2;
      const marginY = (rect.height - size) / 2;
      const targetX = rect.width / 2;
      const targetY = rect.height / 2;
      const newScale = Math.max(current.scale, centerTarget.zoom);
      const newOffsetX = targetX - marginX - normPos.x * size * newScale;
      const newOffsetY = targetY - marginY - normPos.y * size * newScale;

      return { scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY };
    });
  }, [centerTarget, normalizedPositions]);

  // mouse wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(
        VIEW_CONFIG.MIN_SCALE,
        Math.min(VIEW_CONFIG.MAX_SCALE, viewState.scale * delta),
      );
      if (newScale === viewState.scale) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const size = Math.min(rect.width, rect.height);
      const marginX = (rect.width - size) / 2;
      const marginY = (rect.height - size) / 2;

      const newOffsetX =
        viewState.offsetX -
        (mouseX - marginX - viewState.offsetX) *
          (newScale / viewState.scale - 1);
      const newOffsetY =
        viewState.offsetY -
        (mouseY - marginY - viewState.offsetY) *
          (newScale / viewState.scale - 1);

      setViewState({ scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY });
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [viewState]);

  const handleReset = () => {
    setViewState({ offsetX: 0, offsetY: 0, scale: 1 });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const center = { x: rect.width / 2, y: rect.height / 2 };
      const system = findSystemAtPosition(center.x, center.y);
      if (system) onSystemClick?.(system);
    }
  };

  return (
    <div
      ref={containerRef}
      className="starmap-container"
      role="application"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <canvas
        ref={canvasRef}
        className="starmap-canvas"
        style={{ width: "100%", height: "100%" }}
      />

      <div className="absolute top-4 right-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={handleReset}
          className="p-2 bg-black/40 backdrop-blur-md hover:bg-orange-500/20 rounded-lg border border-white/10 hover:border-orange-500/50 transition-all shadow-lg group"
          title="重置视图"
        >
          <RotateCcw
            size={18}
            className="text-gray-300 group-hover:text-white"
          />
        </button>
      </div>

      <div className="absolute bottom-4 right-4 p-3 bg-gray-900/90 backdrop-blur-md border border-gray-800 rounded-lg shadow-xl text-xs text-gray-300 space-y-2 pointer-events-none select-none z-10 w-40">
        <div className="font-bold text-gray-500 mb-2 border-b border-gray-700 pb-1">
          图例
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full bg-[#ef4444] shadow-[0_0_5px_rgba(239,68,68,0.5)]"></div>
          <span>5.0 ADM (最高)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full bg-[#ffffff] shadow-[0_0_5px_rgba(255,255,255,0.5)]"></div>
          <span>1.0 ADM (最低)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ffffff]"></div>
          <span>无主权数据</span>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-orange-500 mx-auto"></div>
            <p className="text-gray-400 mt-3">加载星图数据...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Starmap;
