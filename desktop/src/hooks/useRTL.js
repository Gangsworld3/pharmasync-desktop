import { useEffect } from "react";
import { getLang, subscribeLang } from "../i18n/i18n.js";

function applyDir(currentLang) {
  document.documentElement.dir = currentLang === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = currentLang;
}

export function useRTL() {
  useEffect(() => {
    applyDir(getLang());
    return subscribeLang(applyDir);
  }, []);
}
