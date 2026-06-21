import React, { useReducer, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ConfigProvider, theme, Select, Table, Button, Tooltip } from "antd";
import axios from "axios";
import type {
  MapDataset,
  SolarSystem,
  SovereigntyStatusResponse,
  SovereigntySystemStatus,
} from "./types";
import { getSecurityColor } from "./utils";
import Starmap from "./components/Starmap";
import { Shield, Menu } from "lucide-react";
import { getBundledMapDataset } from "./data/map.generated";
import { changeLanguage, displayLanguage, translatePowerState, translateType } from "./i18n";
import type { SupportedLanguage } from "./i18n";

const { darkAlgorithm } = theme;

const MONO_FONT_STACK = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const CHINESE_SANS_FONT_STACK = "'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', 'Source Han Sans SC', 'Segoe UI', Arial, sans-serif";

function createTheme(useChineseFont: boolean) {
  return {
    algorithm: darkAlgorithm,
    token: {
      colorPrimary: "#f97316",
      colorBgBase: "#09090b",
      colorBgContainer: "#121214",
      colorBorder: "#27272a",
      colorText: "#e4e4e7",
      borderRadius: 4,
      fontFamily: useChineseFont ? CHINESE_SANS_FONT_STACK : MONO_FONT_STACK,
    },
    components: {
      Select: { colorBgContainer: "#09090b", colorBorder: "#27272a" },
    },
  };
}

interface CenterTarget {
  system: SolarSystem;
  zoom: number;
}

interface State {
  sidebarOpen: boolean;
  mapData: MapDataset | null;
  mapLoading: boolean;
  sovData: SovereigntySystemStatus[];
  sovLoading: boolean;
  selectedRegionId: number | null;
  selectedConstellationId: number | null;
  activeSystem: SolarSystem | null;
  centerTarget: CenterTarget | null;
}

type Action =
  | { type: "SET_MAP_DATA"; payload: MapDataset }
  | { type: "SET_MAP_LOADING"; payload: boolean }
  | { type: "SET_SOV_DATA"; payload: SovereigntySystemStatus[] }
  | { type: "SET_SOV_LOADING"; payload: boolean }
  | { type: "SET_REGION"; payload: number | null }
  | { type: "SET_CONSTELLATION"; payload: number | null }
  | { type: "SET_ACTIVE_SYSTEM"; payload: SolarSystem | null }
  | { type: "SET_CENTER_TARGET"; payload: CenterTarget | null }
  | { type: "TOGGLE_SIDEBAR" };

const initialState: State = {
  sidebarOpen: true,
  mapData: null,
  mapLoading: true,
  sovData: [],
  sovLoading: false,
  selectedRegionId: 10000003,
  selectedConstellationId: null,
  activeSystem: null,
  centerTarget: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_MAP_DATA": return { ...state, mapData: action.payload };
    case "SET_MAP_LOADING": return { ...state, mapLoading: action.payload };
    case "SET_SOV_DATA": return { ...state, sovData: action.payload };
    case "SET_SOV_LOADING": return { ...state, sovLoading: action.payload };
    case "SET_REGION": return { ...state, selectedRegionId: action.payload, selectedConstellationId: null };
    case "SET_CONSTELLATION": return { ...state, selectedConstellationId: action.payload };
    case "SET_ACTIVE_SYSTEM": return { ...state, activeSystem: action.payload };
    case "SET_CENTER_TARGET": return { ...state, centerTarget: action.payload };
    case "TOGGLE_SIDEBAR": return { ...state, sidebarOpen: !state.sidebarOpen };
    default: return state;
  }
}

const SovUpgradeMap: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [state, dispatch] = useReducer(reducer, initialState);
  const { sidebarOpen, mapData, mapLoading, sovData, sovLoading, selectedRegionId, selectedConstellationId, activeSystem, centerTarget } = state;
  const useChineseFont = displayLanguage() === "zh";
  const customTheme = useMemo(() => createTheme(useChineseFont), [useChineseFont]);

  useEffect(() => {
    document.title = t("app.title");
    document.documentElement.lang = useChineseFont ? "zh-CN" : "en";
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", t("app.description"));
  }, [i18n.language, t, useChineseFont]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      dispatch({ type: "SET_MAP_LOADING", payload: true });
      try {
        const dataset = getBundledMapDataset(i18n.language);
        if (!cancelled) dispatch({ type: "SET_MAP_DATA", payload: dataset });
      } catch (e) {
        if (!cancelled) console.error(t("status.mapDatasetError"), e);
      } finally {
        if (!cancelled) dispatch({ type: "SET_MAP_LOADING", payload: false });
      }
    };
    load();
    return () => { cancelled = true; };
  }, [i18n.language, t]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      dispatch({ type: "SET_SOV_LOADING", payload: true });
      try {
        const res = await axios.get<SovereigntyStatusResponse | SovereigntySystemStatus[]>(
          `/api/public/sovereignty/status?lang=${displayLanguage()}`,
        );
        const systems = Array.isArray(res.data) ? res.data : res.data.systems;
        if (!cancelled) dispatch({ type: "SET_SOV_DATA", payload: systems || [] });
      } catch {
        if (!cancelled) dispatch({ type: "SET_SOV_DATA", payload: [] });
      } finally {
        if (!cancelled) dispatch({ type: "SET_SOV_LOADING", payload: false });
      }
    };
    load();
    return () => { cancelled = true; };
  }, [i18n.language]);

  const sovMap = useMemo(() => {
    const map = new Map<number, SovereigntySystemStatus>();
    if (sovData) for (const s of sovData) map.set(s.system_id, s);
    return map;
  }, [sovData]);

  const regionOptions = useMemo(() => {
    if (!mapData?.regions) return [];
    return mapData.regions
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({ value: r.id, label: r.name }));
  }, [mapData]);

  const constellationOptions = useMemo(() => {
    if (!mapData?.constellations) return [];
    const list = selectedRegionId
      ? mapData.constellations.filter((c) => c.regionId === selectedRegionId)
      : mapData.constellations;
    return list
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ value: c.id, label: c.name }));
  }, [mapData, selectedRegionId]);

  const filteredSystems = useMemo(() => {
    if (!mapData?.systems) return [];
    return mapData.systems.filter((sys) => {
      if (selectedRegionId && sys.regionId !== selectedRegionId) return false;
      if (selectedConstellationId && sys.constellationId !== selectedConstellationId) return false;
      return true;
    });
  }, [mapData, selectedRegionId, selectedConstellationId]);

  const sovCols = useMemo(() => [
    {
      title: t("table.system"),
      dataIndex: "name",
      key: "name",
      width: 110,
      sorter: (a: SolarSystem, b: SolarSystem) => a.name.localeCompare(b.name),
      render: (text: string, record: SolarSystem) => (
        <Button
          type="link"
          className="p-0 text-xs font-mono system-name-text text-orange-400 h-auto"
          onClick={() => {
            dispatch({ type: "SET_CENTER_TARGET", payload: { system: record, zoom: 20 } });
            dispatch({ type: "SET_ACTIVE_SYSTEM", payload: record });
          }}
        >
          {text}
        </Button>
      ),
    },
    {
      title: t("table.security"),
      dataIndex: "security",
      key: "security",
      width: 80,
      sorter: (a: SolarSystem, b: SolarSystem) => (a.security ?? 0) - (b.security ?? 0),
      render: (val: number | null) => (
        <span style={{ color: getSecurityColor(val) }} className="font-mono font-bold">
          {val?.toFixed(2) ?? t("common.notAvailable")}
        </span>
      ),
    },
    {
      title: t("table.adm"),
      key: "adm",
      width: 65,
      sorter: (a: SolarSystem, b: SolarSystem) => (sovMap.get(a.id)?.adm ?? 0) - (sovMap.get(b.id)?.adm ?? 0),
      render: (_: unknown, record: SolarSystem) => {
        const status = sovMap.get(record.id);
        return <span className="font-mono text-zinc-300">{status?.adm ? status.adm.toFixed(1) : "-"}</span>;
      },
    },
    {
      title: t("table.development"),
      key: "development",
      width: 92,
      render: (_: unknown, record: SolarSystem) => {
        const dev = sovMap.get(record.id)?.development;
        if (!dev) return <span className="text-zinc-600">-</span>;
        return (
          <span className="text-[10px] text-zinc-300 font-mono">
            {t("details.military")} {dev.military_level} / {t("details.industrial")} {dev.industrial_level} / {t("details.strategic")} {dev.strategic_level}
          </span>
        );
      },
    },
    {
      title: t("table.resources"),
      key: "resources",
      width: 95,
      render: (_: unknown, record: SolarSystem) => {
        const resources = sovMap.get(record.id)?.resources;
        if (!resources) return <span className="text-zinc-600">-</span>;
        return (
          <Tooltip
            title={`${t("details.power")}: ${resources.power.allocated}/${resources.power.available}; ${t("details.workforce")}: ${resources.workforce.allocated}/${resources.workforce.available}`}
            placement="topLeft"
          >
            <span className="text-[10px] text-sky-300 font-mono cursor-help">
              {resources.power.allocated}/{resources.power.available} {t("details.powerUnit")}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: t("table.skyhooks"),
      key: "skyhooks",
      width: 80,
      render: (_: unknown, record: SolarSystem) => {
        const skyhooks = sovMap.get(record.id)?.skyhooks ?? [];
        if (!skyhooks.length) return <span className="text-zinc-600">-</span>;
        return <span className="text-[10px] text-cyan-300 font-mono">{skyhooks.length}</span>;
      },
    },
    {
      title: t("table.upgrades"),
      key: "upgrades",
      render: (_: unknown, record: SolarSystem) => {
        const status = sovMap.get(record.id);
        if (!status?.upgrades?.length) return <span className="text-zinc-600">-</span>;
        const names = status.upgrades
          .map((u) => `${translateType(u.type_id ?? u.typeId)}${u.power_state ? ` (${translatePowerState(u.power_state)})` : ""}`)
          .join(", ");
        return (
          <Tooltip title={names} placement="topLeft">
            <span className="text-[10px] text-green-400 font-mono line-clamp-1 max-w-[140px] cursor-help">
              {names}
            </span>
          </Tooltip>
        );
      },
    },
  ], [i18n.language, sovMap, t]);

  const handleRegionChange = (val: number | null) => {
    dispatch({ type: "SET_REGION", payload: val });
  };

  const handleSystemClick = useCallback((system: SolarSystem) => {
    dispatch({ type: "SET_ACTIVE_SYSTEM", payload: system });
  }, []);

  return (
    <ConfigProvider theme={customTheme}>
      <div className="relative w-screen h-screen overflow-hidden bg-black select-none">
        <footer className="absolute bottom-0 left-0 right-0 h-14 bg-zinc-950/75 backdrop-blur-md border-t border-zinc-900/60 z-20 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-zinc-900/35 p-1 rounded-md border border-zinc-850">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-orange-500/20 border border-orange-500/40 shadow-[0_0_16px_rgba(249,115,22,0.45)]">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_8px_#f97316] animate-pulse" />
                <Shield size={15} className="text-orange-500" />
                <span className="text-xs font-mono font-bold text-white">
                  {t("console.sovereigntyStatus")}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Select
              size="small"
              value={i18n.language}
              onChange={(val) => changeLanguage(val as SupportedLanguage)}
              options={[
                {
                  value: "zh",
                  label: <span className="text-[11px] font-mono">{t("common.languageChinese")}</span>,
                },
                {
                  value: "en",
                  label: <span className="text-[11px] font-mono">{t("common.languageEnglish")}</span>,
                },
              ]}
              popupClassName="bg-zinc-900 border border-zinc-800"
              className="w-16"
            />
            <Button
              type="text"
              icon={<Menu size={14} />}
              onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
              className={`text-zinc-400 hover:text-orange-400 border border-zinc-800 bg-zinc-900/20 w-7 h-7 flex items-center justify-center p-0 ${sidebarOpen ? "text-orange-400 border-orange-500/20" : ""}`}
            />
          </div>
        </footer>

        <div className="absolute inset-0 w-full h-full z-0">
          <Starmap
            mapData={mapData}
            sovData={sovData}
            onSystemClick={handleSystemClick}
            activeSystem={activeSystem}
            loading={mapLoading}
            centerTarget={centerTarget}
            initialRegionId={10000003}
          />
        </div>

        <div
          className={`absolute top-0 right-0 bottom-14 w-[420px] bg-zinc-950/85 backdrop-blur-md border-l border-zinc-800/70 z-10 shadow-2xl transition-all duration-300 flex flex-col overflow-hidden ${
            sidebarOpen
              ? "translate-x-0 opacity-100"
              : "translate-x-full opacity-0 pointer-events-none"
          }`}
        >
          <div className="px-4 py-2.5 border-b border-zinc-900/80 flex items-center justify-between bg-zinc-950/40">
            <span className="text-[10px] font-bold text-zinc-300 font-mono tracking-widest uppercase">
              {t("console.sovereigntyConsole")}
            </span>
            <Button
              type="text"
              size="small"
              icon={
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 12 12"
                  fill="none"
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  <path
                    d="M3 3L9 9M9 3L3 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              }
              onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
              className="w-6 h-6 flex items-center justify-center p-0 hover:bg-zinc-900"
            />
          </div>

          <div className="flex-1 min-h-0 p-3 flex flex-col space-y-3 overflow-hidden">
            <div className="space-y-3 p-1 flex-shrink-0">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-zinc-400 font-mono">
                  {t("console.regionFilter")}
                </span>
                <Select
                  showSearch
                  allowClear
                  placeholder={
                    t("console.selectRegion")
                  }
                  value={selectedRegionId}
                  onChange={handleRegionChange}
                  filterOption={(input, option) =>
                    String(option?.label ?? "")
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  options={regionOptions}
                  className="w-full text-xs font-mono"
                  popupClassName="bg-zinc-900 border border-zinc-800"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-zinc-400 font-mono">
                  {t("console.constellationFilter")}
                </span>
                <Select
                  showSearch
                  allowClear
                  placeholder={
                    t("console.selectConstellation")
                  }
                  value={selectedConstellationId}
                  onChange={(val) => dispatch({ type: "SET_CONSTELLATION", payload: val })}
                  filterOption={(input, option) =>
                    String(option?.label ?? "")
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  options={constellationOptions}
                  className="w-full text-xs font-mono"
                  popupClassName="bg-zinc-900 border border-zinc-800"
                  disabled={!selectedRegionId}
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 sovereignty-table-container">
              <Table
                dataSource={filteredSystems}
                columns={sovCols}
                rowKey="id"
                size="small"
                loading={sovLoading}
                pagination={false}
                scroll={{ y: "100%" }}
                className="sovereignty-table font-mono h-full"
              />
            </div>
          </div>
        </div>

        {!sidebarOpen && (
          <Tooltip
            title={
              t("console.expandConsole")
            }
          >
            <Button
              shape="circle"
              icon={<Menu size={15} />}
              onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
              className="absolute top-4 right-4 z-10 border border-zinc-800 bg-zinc-950/80 backdrop-blur text-zinc-400 hover:text-orange-400 hover:border-orange-500/40 w-9 h-9 flex items-center justify-center shadow-lg"
            />
          </Tooltip>
        )}
      </div>
    </ConfigProvider>
  );
};

export default SovUpgradeMap;
