// Back-compat shim: the upsell hook now lives in ./upsell (it needs JSX for the
// popup). Existing imports of "@/lib/useUpsell" keep working via this re-export.
export { useUpsell } from "./upsell";
export type { UpsellOptions } from "./upsell";
