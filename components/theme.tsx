"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

const themes = ["system", "light", "dark"] as const;
const labels = { system: "跟随系统", light: "浅色", dark: "深色" };
const icons = { system: Monitor, light: Sun, dark: Moon };
type Theme = typeof themes[number];

const storageKey = "hkb-theme";
const changeEvent = "hkb-theme-change";
let temporaryTheme: Theme | undefined;

function getTheme(): Theme {
  if (temporaryTheme) return temporaryTheme;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* The browser can block storage. */ }
  return "system";
}

function getServerTheme(): Theme {
  return "system";
}

function subscribe(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === storageKey || event.key === null) onChange();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("pageshow", onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("pageshow", onChange);
  };
}

function selectTheme(theme: Theme) {
  try {
    localStorage.setItem(storageKey, theme);
    temporaryTheme = undefined;
  } catch {
    temporaryTheme = theme;
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function ThemeControl() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  useEffect(() => {
    // Keep the initial paint preference while React hydrates the server's system snapshot.
    const current = getTheme();
    if (current === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = current;
  }, [theme]);
  const Icon = icons[theme];
  const next = themes[(themes.indexOf(theme) + 1) % themes.length];
  return <button
    className="icon-button" type="button" title={`主题：${labels[theme]}`}
    aria-label={`当前主题：${labels[theme]}，切换为${labels[next]}`}
    onClick={() => selectTheme(next)}
  ><Icon aria-hidden="true" size={17} /></button>;
}
