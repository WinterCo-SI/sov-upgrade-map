import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import sdeEn from "./sde/sde.en.json";
import sdeZh from "./sde/sde.zh.json";

export const SUPPORTED_LANGUAGES = ["en", "zh"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = "sovUpgradeMapLang";

export const i18nReady = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES,
    nonExplicitSupportedLngs: true,
    defaultNS: "translation",
    ns: ["translation", "sde"],
    resources: {
      en: {
        translation: en,
        sde: sdeEn,
      },
      zh: {
        translation: zh,
        sde: sdeZh,
      },
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

export function displayLanguage(): SupportedLanguage {
  return i18n.language?.startsWith("zh") ? "zh" : "en";
}

export async function changeLanguage(language: SupportedLanguage) {
  await i18n.changeLanguage(language);
}

function translateSde(
  category: "region" | "system" | "type",
  value: string | number | undefined,
): string {
  const key = value === undefined || value === "" ? i18n.t("common.unknown") : String(value);
  return i18n.t(`${category}.${key}`, { ns: "sde", defaultValue: key });
}

export function translateRegion(value: string | number | undefined): string {
  return translateSde("region", value);
}

export function translateSystem(value: string | number | undefined): string {
  return translateSde("system", value);
}

export function translateType(value: string | number | undefined): string {
  return translateSde("type", value);
}

export function translatePowerState(value: string | undefined): string {
  switch (value) {
    case "Online":
      return i18n.t("details.online");
    case "Offline":
      return i18n.t("details.offline");
    case "Low":
      return i18n.t("details.low");
    case "Pending":
      return i18n.t("details.pending");
    case "Unspecified":
      return i18n.t("common.unknown");
    default:
      return value || i18n.t("common.unknown");
  }
}

export default i18n;
