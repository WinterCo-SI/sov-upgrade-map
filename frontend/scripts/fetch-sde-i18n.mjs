#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import unzipper from "unzipper";

const SDE_URL =
  "https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip";
const OUT_DIR = path.resolve("src/sde");
const LANGS = ["en", "zh"];

function localizedName(record, lang) {
  const source = record.nameID ?? record.name ?? record.nameId;
  if (typeof source === "string") return source;
  return source?.[lang] ?? source?.en ?? "";
}

function matchesEntry(fileName, suffixes) {
  const normalized = fileName.replace(/\\/g, "/").toLowerCase();
  return suffixes.some((suffix) => normalized.endsWith(suffix.toLowerCase()));
}

async function readZipEntries(buffer, suffixes) {
  const zip = await unzipper.Open.buffer(buffer);
  const out = new Map();
  for (const entry of zip.files) {
    if (matchesEntry(entry.path, suffixes)) {
      out.set(path.basename(entry.path).toLowerCase(), await entry.buffer());
    }
  }
  return out;
}

function parseJsonl(buffer) {
  return buffer
    .toString("utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createLocaleMap() {
  return Object.fromEntries(
    LANGS.map((lang) => [
      lang,
      {
        region: {},
        system: {},
        type: {},
      },
    ]),
  );
}

function canonicalMap(records, category) {
  const out = createLocaleMap();
  for (const record of records) {
    const english = localizedName(record, "en");
    if (!english) continue;
    for (const lang of LANGS) {
      const translated = localizedName(record, lang);
      if (translated) out[lang][category][english] = translated;
    }
  }
  return out;
}

function typeMap(typeRecords) {
  const out = createLocaleMap();
  for (const record of typeRecords) {
    const english = localizedName(record, "en");
    if (!english) continue;
    const typeId = Number(record._key);
    if (!Number.isFinite(typeId)) continue;

    for (const lang of LANGS) {
      const translated = localizedName(record, lang);
      if (translated) out[lang].type[String(typeId)] = translated;
    }
  }
  return out;
}

function mergeLangData(target, source) {
  for (const lang of LANGS) {
    for (const category of ["region", "system", "type"]) {
      Object.assign(target[lang][category], source[lang][category]);
    }
  }
}

async function main() {
  console.log(`Downloading SDE from ${SDE_URL}`);
  const response = await fetch(SDE_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download SDE: ${response.status} ${response.statusText}`);
  }

  const chunks = [];
  for await (const chunk of Readable.fromWeb(response.body)) chunks.push(chunk);
  const entries = await readZipEntries(Buffer.concat(chunks), [
    "types.jsonl",
    "regions.jsonl",
    "mapRegions.jsonl",
    "solarSystems.jsonl",
    "mapSolarSystems.jsonl",
  ]);

  const types = entries.get("types.jsonl");
  const regions = entries.get("regions.jsonl") ?? entries.get("mapregions.jsonl");
  const solarSystems =
    entries.get("solarsystems.jsonl") ?? entries.get("mapsolarsystems.jsonl");

  if (!types || !regions || !solarSystems) {
    throw new Error(
      `Missing expected SDE files. Found: ${Array.from(entries.keys()).join(", ")}`,
    );
  }

  const data = createLocaleMap();
  mergeLangData(data, canonicalMap(parseJsonl(regions), "region"));
  mergeLangData(data, canonicalMap(parseJsonl(solarSystems), "system"));
  mergeLangData(data, typeMap(parseJsonl(types)));

  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const lang of LANGS) {
    await fs.writeFile(
      path.join(OUT_DIR, `sde.${lang}.json`),
      `${JSON.stringify(data[lang], null, 2)}\n`,
      "utf8",
    );
    console.log(`Wrote ${path.relative(process.cwd(), path.join(OUT_DIR, `sde.${lang}.json`))}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
