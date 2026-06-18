import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en";
import hi from "./hi";

export const LANGUAGE_STORAGE_KEY = "ev_mobile_language";

export type AppLanguage = "en" | "hi";

const resources = {
  en: { translation: en },
  hi: { translation: hi },
};

function detectDeviceLanguage(): AppLanguage {
  const locale = Localization.getLocales()[0]?.languageCode?.toLowerCase();
  if (locale === "hi") return "hi";
  return "en";
}

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  compatibilityJSON: "v4",
  interpolation: { escapeValue: false },
});

export async function loadStoredLanguage(): Promise<AppLanguage> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    const lang: AppLanguage =
      stored === "en" || stored === "hi" ? stored : detectDeviceLanguage();
    await i18n.changeLanguage(lang);
    return lang;
  } catch {
    const lang = detectDeviceLanguage();
    await i18n.changeLanguage(lang);
    return lang;
  }
}

export async function setAppLanguage(lang: AppLanguage): Promise<void> {
  await i18n.changeLanguage(lang);
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
}

export default i18n;
