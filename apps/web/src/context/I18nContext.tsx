import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DICTIONARIES,
  SUPPORTED_LANGS,
  type DictKey,
  type Lang,
} from "../i18n/dictionaries.js";

const STORAGE_KEY = "loom.lang";

/** Autocomplete for known keys while still accepting dynamic strings. */
type TranslateKey = DictKey | (string & Record<never, never>);

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslateKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectLang(): Lang {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)) {
      return stored as Lang;
    }
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    const base = navigator.language.split("-")[0]?.toLowerCase();
    if (base && (SUPPORTED_LANGS as readonly string[]).includes(base)) {
      return base as Lang;
    }
  }
  return "en";
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang());

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang);
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
    setLangState(l);
  }, []);

  const t = useCallback(
    (key: TranslateKey, vars?: Record<string, string | number>) => {
      const dict = DICTIONARIES[lang] as Record<string, string>;
      const en = DICTIONARIES.en as Record<string, string>;
      const value = dict[key] ?? en[key] ?? key;
      return interpolate(value, vars);
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
