"use client";

import { useEffect, useState } from "react";

// User-defined languages (beyond the built-in LANGS), stored locally. The code
// is a slug derived from the name; the backend's langName() falls back to the
// code, so passing a readable slug still produces sensible LLM prompts.
const KEY = "lexa.customLangs";
const EVT = "lexa-langs-changed";

export interface CustomLang {
  code: string;
  name: string;
}

export function getCustomLangs(): CustomLang[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as CustomLang[];
  } catch {
    return [];
  }
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "lang";
}

/** Add a custom language (idempotent on code); returns the created/existing one. */
export function addCustomLang(rawName: string): CustomLang {
  const name = rawName.trim();
  const code = slug(name);
  const list = getCustomLangs();
  if (!list.some((l) => l.code === code)) {
    list.push({ code, name });
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(EVT));
  }
  return { code, name };
}

/** Reactive list of custom languages (updates when one is added anywhere). */
export function useCustomLangs(): CustomLang[] {
  const [langs, setLangs] = useState<CustomLang[]>([]);
  useEffect(() => {
    const sync = () => setLangs(getCustomLangs());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return langs;
}
