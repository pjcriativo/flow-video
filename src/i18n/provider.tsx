"use client";

import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { getVersion, initLocale, subscribe } from "./index";

/**
 * Reads the saved language on load and draws the app again whenever it changes. The English
 * page arrives first and the saved language is applied right after.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const version = useSyncExternalStore(subscribe, getVersion, () => 0);
  useEffect(() => {
    initLocale();
  }, []);
  return <Fragment key={version}>{children}</Fragment>;
}
