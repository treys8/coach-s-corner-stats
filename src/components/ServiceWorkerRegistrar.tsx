"use client";

import { useEffect } from "react";

/** Registers /sw.js once on mount. Mounted only on the live-scoring route
 *  so the SW doesn't take over the whole app in this phase. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Skip in dev to avoid stale-cache headaches when iterating on the
    // scoring code. Production deployments still get the SW.
    if (process.env.NODE_ENV !== "production") return;

    let cancelled = false;
    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch {
        // Service worker registration failures aren't user-actionable;
        // the app still works without offline-page support.
      }
    };
    // Defer until the page has settled so registration doesn't compete
    // with first paint of the live-scoring shell.
    if (document.readyState === "complete") {
      void register();
    } else {
      const onLoad = () => {
        if (!cancelled) void register();
      };
      window.addEventListener("load", onLoad, { once: true });
      return () => {
        cancelled = true;
        window.removeEventListener("load", onLoad);
      };
    }
  }, []);

  return null;
}
