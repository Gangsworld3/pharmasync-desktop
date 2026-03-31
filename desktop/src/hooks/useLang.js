import { useEffect, useState } from "react";

export function useLang() {
  const [lang, setLang] = useState(() => (localStorage.getItem("lang") === "ar" ? "ar" : "en"));

  useEffect(() => {
    let unsubscribe = () => {};
    let isMounted = true;

    (async () => {
      const { getLang, subscribeLang } = await import("../i18n/i18n.js");
      if (!isMounted) {
        return;
      }
      setLang(getLang());
      unsubscribe = subscribeLang(setLang);
    })();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  async function toggleLang() {
    const { loadLang } = await import("../i18n/i18n.js");
    await loadLang(lang === "en" ? "ar" : "en");
  }

  return { lang, toggleLang };
}
