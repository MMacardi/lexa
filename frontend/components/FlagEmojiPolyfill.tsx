"use client";

import { useEffect } from "react";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";

// Windows has no flag emoji — 🇬🇧 renders as the letters "GB". Where flags are
// missing, this loads a flags-only webfont ("Twemoji Country Flags", listed first
// in --font-sans/--font-serif); everywhere else it's a no-op.
export function FlagEmojiPolyfill() {
  useEffect(() => {
    polyfillCountryFlagEmojis();
  }, []);
  return null;
}
