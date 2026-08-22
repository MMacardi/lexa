// Collects the debugging context that turns a vague "it's broken" into a fixable
// report: the current route, environment, the last JS errors + failed network
// calls (captured passively in a ring buffer), and — on demand — a screenshot of
// the page. Kept dependency-light: html2canvas-pro is imported only when a
// screenshot is actually requested, so it never weighs down the main bundle.

export interface CapturedError {
  message: string;
  source: string; // "error" | "promise" | "http:<status>"
  time: string; // HH:MM:SS
}

const RING = 15;
const errors: CapturedError[] = [];
let installed = false;

function push(message: string, source: string) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  errors.push({ message: message.slice(0, 500), source, time });
  if (errors.length > RING) errors.shift();
}

/** Install the passive listeners once. Safe to call from multiple mounts. */
export function initBugCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (e) => {
    const msg = e.message || (e.error && String(e.error)) || "Unknown error";
    const at = e.filename ? ` @ ${e.filename}:${e.lineno}` : "";
    push(msg + at, "error");
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    push(typeof r === "string" ? r : r?.message ? r.message : JSON.stringify(r), "promise");
  });

  // Wrap fetch to note failed API calls (4xx/5xx and network errors). This is the
  // single most useful signal for backend-side bugs.
  const orig = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    try {
      const res = await orig(...args);
      if (!res.ok) {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url ?? String(args[0]);
        push(`${res.status} ${res.statusText} — ${url}`, `http:${res.status}`);
      }
      return res;
    } catch (err) {
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url ?? String(args[0]);
      push(`network fail — ${url}: ${(err as Error)?.message ?? err}`, "http:network");
      throw err;
    }
  };
}

export function getCapturedErrors(): CapturedError[] {
  return [...errors];
}

export interface BugContext {
  url: string;
  route: string;
  userAgent: string;
  viewport: string;
  locale: string;
  theme: string;
}

export function collectContext(): BugContext {
  const w = window;
  return {
    url: w.location.href,
    route: w.location.pathname + w.location.search,
    userAgent: navigator.userAgent,
    viewport: `${w.innerWidth}×${w.innerHeight} @${w.devicePixelRatio ?? 1}x`,
    locale: navigator.language,
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
  };
}

/**
 * Capture a screenshot of the visible page as a JPEG data URL. Uses
 * html2canvas-pro (oklch-aware, unlike the original) loaded on demand. Downscaled
 * and JPEG-compressed to keep the upload small. Returns null on any failure so the
 * report can still be sent without an image.
 */
export async function captureScreenshot(): Promise<string | null> {
  try {
    const { default: html2canvas } = await import("html2canvas-pro");
    const scale = Math.min(1, 1000 / Math.max(window.innerWidth, 1)); // cap width ~1000px
    const canvas = await html2canvas(document.body, {
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
      scale,
      useCORS: true,
      logging: false,
      // Only the current viewport — a full-page shot of a long list is rarely useful.
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
    });
    return canvas.toDataURL("image/jpeg", 0.75);
  } catch (e) {
    console.warn("[bug] screenshot capture failed", e);
    return null;
  }
}
