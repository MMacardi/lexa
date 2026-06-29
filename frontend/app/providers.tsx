"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AccountProvider } from "@/lib/account";
import { ThemeProvider } from "@/lib/theme";
import { ToastProvider } from "@/lib/toast";

// TanStack Query needs a client created on the React tree. useState keeps a
// single client per browser session (not recreated on every render).
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ToastProvider>
          <AccountProvider>{children}</AccountProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
