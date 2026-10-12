"use client";
import { MoonStar, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Appearance = "dark" | "light";
const KEY = "archeagent-appearance";
const EVENT = "archeagent-theme-change";

function subscribe(notify: () => void) {
  window.addEventListener(EVENT, notify);
  return () => window.removeEventListener(EVENT, notify);
}
function getSnapshot(): Appearance {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
function getServerSnapshot(): Appearance {
  return "dark";
}

export function ThemeSwitch() {
  const appearance = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggleTheme() {
    const next: Appearance = appearance === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch {
      // Private browsing may disable storage; toggling still works.
    }
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <button type="button" className="theme-switch"
      aria-label={appearance === "dark" ? "Switch to pearl light theme" : "Switch to obsidian dark theme"}
      title={appearance === "dark" ? "Pearl light" : "Obsidian dark"}
      aria-pressed={appearance === "light"}
      onClick={toggleTheme}>
      {appearance === "dark" ? <Sun size={16} aria-hidden="true" /> : <MoonStar size={16} aria-hidden="true" />}
      <span>{appearance === "dark" ? "Pearl" : "Obsidian"}</span>
    </button>
  );
}
