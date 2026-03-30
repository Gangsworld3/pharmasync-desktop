let lang = "en";
let dict = {};
const subscribers = new Set();

function emit() {
  for (const callback of subscribers) {
    callback(lang);
  }
}

export async function loadLang(nextLang) {
  lang = nextLang;
  const module = await import(`./${nextLang}.json`);
  dict = module.default ?? {};
  localStorage.setItem("lang", nextLang);
  emit();
}

export async function initializeLanguage() {
  const persisted = localStorage.getItem("lang");
  const initial = persisted === "ar" ? "ar" : "en";
  await loadLang(initial);
}

export function t(key) {
  return dict[key] ?? key;
}

export function getLang() {
  return lang;
}

export function subscribeLang(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}
