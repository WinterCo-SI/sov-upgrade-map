#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import unzipper from "unzipper";

const STATIC_DATA_PAGE = "https://developers.eveonline.com/static-data";
const STATIC_DATA_LATEST =
  "https://developers.eveonline.com/static-data/tranquility/latest.jsonl";
const STATIC_DATA_ARCHIVE_BASE =
  "https://developers.eveonline.com/static-data/tranquility";
const OUTPUT_PATH = path.resolve("src/data/map.generated.ts");
const KNOWN_SPACE_REGION_IDS = new Set([
  10000001, 10000002, 10000003, 10000004, 10000005, 10000006, 10000007,
  10000008, 10000009, 10000010, 10000011, 10000012, 10000013, 10000014,
  10000015, 10000016, 10000017, 10000018, 10000019, 10000020, 10000021,
  10000022, 10000023, 10000025, 10000027, 10000028, 10000029, 10000030,
  10000031, 10000032, 10000033, 10000034, 10000035, 10000036, 10000037,
  10000038, 10000039, 10000040, 10000041, 10000042, 10000043, 10000044,
  10000045, 10000046, 10000047, 10000048, 10000049, 10000050, 10000051,
  10000052, 10000053, 10000054, 10000055, 10000056, 10000057, 10000058,
  10000059, 10000060, 10000061, 10000062, 10000063, 10000064, 10000065,
  10000066, 10000067, 10000068, 10000069, 10000070,
]);

function localizedName(value, lang) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const direct = value[lang];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const en = value.en;
    if (typeof en === "string" && en.trim()) return en.trim();
  }
  return null;
}

function point3d(value) {
  if (!value || typeof value !== "object") return null;
  const { x, y, z } = value;
  return [x, y, z].every((v) => typeof v === "number" && Number.isFinite(v))
    ? { x, y, z }
    : null;
}

function point2d(value) {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value;
  return [x, y].every((v) => typeof v === "number" && Number.isFinite(v))
    ? { x, y }
    : null;
}

function destinationGateId(stargateDoc) {
  const destination = stargateDoc?.destination;
  if (typeof destination === "number") return destination;
  if (destination && typeof destination === "object") {
    if (typeof destination.stargateID === "number") return destination.stargateID;
    if (typeof destination.stargateId === "number") return destination.stargateId;
  }
  return null;
}

async function fetchStaticDataArchiveUrl() {
  const response = await fetch(STATIC_DATA_LATEST);
  if (!response.ok) {
    throw new Error(
      `Failed to load static data metadata: ${response.status} ${response.statusText}`,
    );
  }

  const firstLine = (await response.text()).split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine) throw new Error("Static data metadata response was empty.");

  const metadata = JSON.parse(firstLine);
  const buildNumber = Number(metadata?.buildNumber);
  if (!Number.isFinite(buildNumber)) {
    throw new Error("Static data metadata did not include a valid buildNumber.");
  }

  return {
    buildNumber,
    archiveUrl: `${STATIC_DATA_ARCHIVE_BASE}/eve-online-static-data-${buildNumber}-jsonl.zip`,
  };
}

async function extractStaticDataArchive(tempDir) {
  const { buildNumber, archiveUrl } = await fetchStaticDataArchiveUrl();
  const response = await fetch(archiveUrl);
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download static data archive: ${response.status} ${response.statusText}`,
    );
  }

  await pipeline(Readable.fromWeb(response.body), unzipper.Extract({ path: tempDir }));
  return { buildNumber, archiveUrl };
}

async function readArchiveText(rootDir, fileName) {
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        return fs.readFile(fullPath, "utf8");
      }
    }
  }

  throw new Error(`Could not find ${fileName} in extracted static data archive.`);
}

async function readJsonl(rootDir, fileName) {
  return (await readArchiveText(rootDir, fileName))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeRecord(name, value) {
  return `export const ${name} = ${JSON.stringify(value, null, 2)} as const;\n`;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Generate bundled EVE map data from the official SDE JSONL archive.");
    console.log("");
    console.log("Usage:");
    console.log("  pnpm generate:map-data");
    console.log("");
    console.log(`Metadata: ${STATIC_DATA_LATEST}`);
    console.log(`Page:     ${STATIC_DATA_PAGE}`);
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sov-map-data-"));
  let archiveUrl = "";

  try {
    const archive = await extractStaticDataArchive(tempDir);
    archiveUrl = archive.archiveUrl;

    const [regionRows, constellationRows, systemRows, stargateRows] =
      await Promise.all([
        readJsonl(tempDir, "mapRegions.jsonl"),
        readJsonl(tempDir, "mapConstellations.jsonl"),
        readJsonl(tempDir, "mapSolarSystems.jsonl"),
        readJsonl(tempDir, "mapStargates.jsonl"),
      ]);

    const gateToSystem = new Map();
    const systems = { en: [], zh: [] };
    const regions = { en: [], zh: [] };
    const constellations = { en: [], zh: [] };

    for (const doc of regionRows) {
      const id = Number(doc?._key);
      const pos = point3d(doc?.position);
      if (!Number.isFinite(id) || !pos) continue;
      if (!KNOWN_SPACE_REGION_IDS.has(id)) continue;

      for (const lang of ["en", "zh"]) {
        regions[lang].push({
          id,
          name: localizedName(doc?.name, lang) ?? String(id),
          x: pos.x,
          y: pos.y,
          z: pos.z,
        });
      }
    }

    for (const doc of constellationRows) {
      const id = Number(doc?._key);
      const regionId = Number(doc?.regionID);
      const pos = point3d(doc?.position);
      if (!Number.isFinite(id) || !Number.isFinite(regionId) || !pos) continue;
      if (!KNOWN_SPACE_REGION_IDS.has(regionId)) continue;

      for (const lang of ["en", "zh"]) {
        constellations[lang].push({
          id,
          regionId,
          name: localizedName(doc?.name, lang) ?? String(id),
          x: pos.x,
          y: pos.y,
          z: pos.z,
        });
      }
    }

    for (const doc of systemRows) {
      const id = Number(doc?._key);
      const constellationId = Number(doc?.constellationID);
      const regionId = Number(doc?.regionID);
      const pos = point3d(doc?.position);
      const pos2d = point2d(doc?.position2D);
      if (
        !Number.isFinite(id) ||
        !Number.isFinite(constellationId) ||
        !Number.isFinite(regionId) ||
        !pos
      ) {
        continue;
      }
      if (!KNOWN_SPACE_REGION_IDS.has(regionId)) continue;

      for (const gateId of Array.isArray(doc?.stargateIDs) ? doc.stargateIDs : []) {
        const gate = Number(gateId);
        if (Number.isFinite(gate)) gateToSystem.set(gate, id);
      }

      for (const lang of ["en", "zh"]) {
        const entry = {
          id,
          constellationId,
          regionId,
          name: localizedName(doc?.name, lang) ?? String(id),
          security:
            typeof doc?.security === "number" && Number.isFinite(doc.security)
              ? doc.security
              : null,
          x: pos.x,
          y: pos.y,
          z: pos.z,
        };
        if (pos2d) {
          entry.x2d = pos2d.x;
          entry.y2d = pos2d.y;
        }
        systems[lang].push(entry);
      }
    }

    const edgeKeys = new Set();
    for (const doc of stargateRows) {
      const sourceSystem = Number(doc?.solarSystemID);
      const destinationSystemFromDoc = Number(doc?.destination?.solarSystemID);
      const destinationGate = destinationGateId(doc);
      const destinationSystem = Number.isFinite(destinationSystemFromDoc)
        ? destinationSystemFromDoc
        : gateToSystem.get(destinationGate);

      if (Number.isFinite(sourceSystem) && Number.isFinite(destinationSystem)) {
        edgeKeys.add(`${sourceSystem}:${destinationSystem}`);
      }
    }

    const allowedSystems = new Set(systems.en.map((system) => system.id));
    const edges = Array.from(edgeKeys)
      .map((key) => key.split(":").map(Number))
      .filter(([from, to]) => from !== to && allowedSystems.has(from) && allowedSystems.has(to))
      .map(([from, to]) => ({ from, to }))
      .sort((a, b) => a.from - b.from || a.to - b.to);

    for (const lang of ["en", "zh"]) {
      regions[lang].sort((a, b) => a.id - b.id);
      constellations[lang].sort((a, b) => a.id - b.id);
      systems[lang].sort((a, b) => a.id - b.id);
    }

    const output =
      `// Auto-generated by scripts/generate-map-data.mjs\n` +
      `// Source: ${archiveUrl || STATIC_DATA_PAGE}\n\n` +
      `import type { MapDataset } from "../types";\n\n` +
      writeRecord("MAP_BUILD_NUMBER", archive.buildNumber) +
      "\n" +
      writeRecord("REGIONS_EN", regions.en) +
      "\n" +
      writeRecord("REGIONS_ZH", regions.zh) +
      "\n" +
      writeRecord("CONSTELLATIONS_EN", constellations.en) +
      "\n" +
      writeRecord("CONSTELLATIONS_ZH", constellations.zh) +
      "\n" +
      writeRecord("SYSTEMS_EN", systems.en) +
      "\n" +
      writeRecord("SYSTEMS_ZH", systems.zh) +
      "\n" +
      writeRecord("STARGATE_EDGES", edges) +
      "\n" +
      `export function getBundledMapDataset(language: string): MapDataset {\n` +
      `  const useZh = language.toLowerCase().startsWith("zh");\n` +
      `  return {\n` +
      `    buildNumber: MAP_BUILD_NUMBER,\n` +
      `    regions: (useZh ? REGIONS_ZH : REGIONS_EN) as unknown as MapDataset["regions"],\n` +
      `    constellations: (useZh ? CONSTELLATIONS_ZH : CONSTELLATIONS_EN) as unknown as MapDataset["constellations"],\n` +
      `    systems: (useZh ? SYSTEMS_ZH : SYSTEMS_EN) as unknown as MapDataset["systems"],\n` +
      `    edges: STARGATE_EDGES as unknown as MapDataset["edges"],\n` +
      `  };\n` +
      `}\n`;

    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, output, "utf8");

    console.log("Generated bundled map data:");
    console.log(`  Source:         ${archiveUrl}`);
    console.log(`  Build number:   ${archive.buildNumber}`);
    console.log(`  Regions:        ${regions.en.length}`);
    console.log(`  Constellations: ${constellations.en.length}`);
    console.log(`  Systems:        ${systems.en.length}`);
    console.log(`  Edges:          ${edges.length}`);
    console.log(`  Output:         ${OUTPUT_PATH}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
