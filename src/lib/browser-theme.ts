export type Appearance = "dark" | "light";
const KEY = "archeagent-appearance";
const EVENT = "archeagent-theme-change";

export function subscribeAppearance(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    try {
      if (event.storageArea !== localStorage || event.key !== KEY) return;
    } catch { return; }
    if (event.newValue !== "dark" && event.newValue !== "light" && event.newValue !== null) return;
    document.documentElement.dataset.theme = event.newValue === "light" ? "light" : "dark";
    notify();
  };
  window.addEventListener(EVENT, notify);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener("storage", onStorage);
  };
}

export function getAppearance(): Appearance {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function getServerAppearance(): Appearance { return "dark"; }

export function setAppearance(appearance: Appearance) {
  document.documentElement.dataset.theme = appearance;
  try { localStorage.setItem(KEY, appearance); } catch {
    // The current page remains usable when private browsing disables storage.
  }
  window.dispatchEvent(new Event(EVENT));
}
