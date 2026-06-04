"use client";

import { useEffect, useState, useCallback } from "react";
import { DB, load, hydrate, update as storeUpdate } from "@/lib/store";

export function useDB() {
  const [db, setDb] = useState<DB | null>(null);

  useEffect(() => {
    setDb(load());            // instant paint from local mirror
    hydrate().then(setDb);    // then pull authoritative server snapshot
    const onChange = () => setDb({ ...load() });
    window.addEventListener("lr-db-change", onChange);
    window.addEventListener("storage", onChange);
    // re-pull from server when the tab regains focus (picks up changes made
    // on another device or — soon — by the WhatsApp brain)
    const onFocus = () => hydrate().then(setDb);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("lr-db-change", onChange);
      window.removeEventListener("storage", onChange);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const mutate = useCallback((fn: (db: DB) => void) => {
    const next = storeUpdate(fn);
    setDb({ ...next });
  }, []);

  return { db, mutate };
}
