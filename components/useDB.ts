"use client";

import { useEffect, useState, useCallback } from "react";
import { DB, load, update as storeUpdate } from "@/lib/store";

export function useDB() {
  const [db, setDb] = useState<DB | null>(null);

  useEffect(() => {
    setDb(load());
    const onChange = () => setDb(load());
    window.addEventListener("lr-db-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("lr-db-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const mutate = useCallback((fn: (db: DB) => void) => {
    const next = storeUpdate(fn);
    setDb({ ...next });
  }, []);

  return { db, mutate };
}
