import type { Profile } from "./api";
import { SNAPSHOT_KEY } from "./sessionCache";

// Only the fields needed to draw the cached learner shell, never credentials,
// linked identities, contact details or admin permissions.
export function saveAccountSnapshot(profile: Profile) {
  const { telegramId, invited, deleteAfter, hskTarget, hskVersion, hasWords, nativeLang } = profile;
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ v: 1, telegramId, invited, deleteAfter, hskTarget, hskVersion, hasWords, nativeLang }));
  } catch { /* storage unavailable */ }
}

export function readAccountSnapshot(): Profile | null {
  try {
    const data = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? "null");
    if (data?.v !== 1 || typeof data.telegramId !== "string" || !data.telegramId || typeof data.invited !== "boolean") return null;
    return {
      telegramId: data.telegramId, invited: data.invited, deleteAfter: typeof data.deleteAfter === "string" ? data.deleteAfter : null,
      hskTarget: typeof data.hskTarget === "number" ? data.hskTarget : null,
      hskVersion: data.hskVersion === "3.0" ? "3.0" : "2.0", hasWords: data.hasWords === true,
      nativeLang: typeof data.nativeLang === "string" ? data.nativeLang : null,
    };
  } catch { return null; }
}

export function clearAccountSnapshot() {
  try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* storage unavailable */ }
}
