import { useEffect, useState } from "react";
import { getLang, loadLang, subscribeLang } from "../i18n/i18n.js";

export function useLang() {
  const [lang, setLang] = useState(getLang());

  useEffect(() => subscribeLang(setLang), []);

  async function toggleLang() {
    await loadLang(lang === "en" ? "ar" : "en");
  }

  return { lang, toggleLang };
}
