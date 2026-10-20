"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { stopSpeech } from "@/lib/speak";

export function SpeechLifecycle() {
  const pathname = usePathname();
  useEffect(() => {
    const stop = () => stopSpeech();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stopSpeech();
    };
  }, [pathname]);
  return null;
}
