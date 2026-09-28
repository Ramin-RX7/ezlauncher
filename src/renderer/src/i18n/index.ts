import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

export const defaultNS = "translation";
export const resources = { en: { translation: en } } as const;

/** Keep <html lang> and <html dir> in sync with the language, so right-to-left languages work. */
function applyDocumentLanguage(lng: string): void {
  document.documentElement.lang = lng;
  document.documentElement.dir = i18n.dir(lng);
}

i18n.on("languageChanged", applyDocumentLanguage);

void i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS,
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

export default i18n;
