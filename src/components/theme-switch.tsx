"use client";
import { MoonStar, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { subscribeAppearance, getAppearance, getServerAppearance, setAppearance } from "../lib/browser-theme";

export function ThemeSwitch() {
  const appearance = useSyncExternalStore(subscribeAppearance, getAppearance, getServerAppearance);

  function toggleTheme() {
    setAppearance(appearance === "dark" ? "light" : "dark");
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
