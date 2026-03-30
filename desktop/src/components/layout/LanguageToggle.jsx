import { useLang } from "../../hooks/useLang.js";

export default function LanguageToggle() {
  const { lang, toggleLang } = useLang();
  return (
    <button type="button" onClick={toggleLang}>
      {lang === "en" ? "AR" : "EN"}
    </button>
  );
}
