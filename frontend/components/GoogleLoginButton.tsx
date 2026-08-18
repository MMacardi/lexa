"use client";

import { useEffect, useRef } from "react";

// Renders the official Google Identity Services button. Requires
// NEXT_PUBLIC_GOOGLE_CLIENT_ID and the site origin authorised in Google Cloud
// Console. Calls onCredential with the Google ID token (a JWT) to verify server-side.
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

type GsiId = {
  initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
};
type GsiWindow = Window & { google?: { accounts: { id: GsiId } } };

export function GoogleLoginButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;

  useEffect(() => {
    if (!CLIENT_ID || !ref.current) return;
    let cancelled = false;

    const render = () => {
      const g = (window as GsiWindow).google;
      if (cancelled || !g || !ref.current) return;
      g.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (r) => cbRef.current(r.credential),
      });
      g.accounts.id.renderButton(ref.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 320,
      });
    };

    if ((window as GsiWindow).google) {
      render();
    } else {
      const existing = document.getElementById("gsi-script") as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener("load", render);
      } else {
        const s = document.createElement("script");
        s.id = "gsi-script";
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.defer = true;
        s.onload = render;
        document.head.appendChild(s);
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  if (!CLIENT_ID) return null;
  return <div ref={ref} className="flex justify-center" />;
}
