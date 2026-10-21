"use client";

import { useEffect, useState } from "react";

// Load the same fonts without holding first paint or deferred app scripts behind
// Google's stylesheet. System fonts cover the wait (and a failed font request).
export function FontStyles({ href }: { href: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return mounted ? <link id="app-fonts" rel="stylesheet" href={href} /> : null;
}
