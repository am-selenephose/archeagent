import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeAppearance } from "../src/lib/browser-theme";
import { formatOperationalNumber } from "../src/lib/ui-format";

afterEach(() => vi.unstubAllGlobals());

function browserEnvironment() {
  const events = new EventTarget();
  const root = { dataset: { theme: "dark" } };
  const storage = {};
  vi.stubGlobal("window", events);
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("localStorage", storage);
  return {
    events, root,
    storageEvent(key: string | null, newValue: string | null, storageArea: object = storage) {
      const event = new Event("storage");
      Object.assign(event, { key, newValue, storageArea });
      events.dispatchEvent(event);
    },
  };
}

describe("Owned appearance synchronization", () => {
  it("applies a valid appearance from this page's local storage key", async () => {
    const environment = browserEnvironment();
    let snapshots = 0;
    const unsubscribe = subscribeAppearance(() => { snapshots += 1; });
    environment.storageEvent("archeagent-appearance", "light");
    expect(environment.root.dataset.theme).toBe("light");
    expect(snapshots).toBe(1);
    unsubscribe();
  });

  it("ignores unrelated keys, unsupported values and session storage", async () => {
    const environment = browserEnvironment();
    let snapshots = 0;
    const unsubscribe = subscribeAppearance(() => { snapshots += 1; });
    environment.storageEvent("another-page", "light");
    environment.storageEvent("archeagent-appearance", "PRIVATE_SENTINEL");
    environment.storageEvent("archeagent-appearance", "light", {});
    expect(environment.root.dataset.theme).toBe("dark");
    expect(snapshots).toBe(0);
    unsubscribe();
  });

  it("removes both event listeners when the subscriber unmounts", async () => {
    const environment = browserEnvironment();
    let snapshots = 0;
    const unsubscribe = subscribeAppearance(() => { snapshots += 1; });
    unsubscribe();
    environment.storageEvent("archeagent-appearance", "light");
    environment.events.dispatchEvent(new Event("archeagent-theme-change"));
    expect(environment.root.dataset.theme).toBe("dark");
    expect(snapshots).toBe(0);
  });
});

describe("Operational number display", () => {
  it.each([
    [null, "count", "--"], [Infinity, "count", "--"], [NaN, "currency", "--"],
    [-0, "currency", "$0.00"], [0.004, "currency", "<$0.01"],
    [-0.004, "currency", "-<$0.01"], [1234.5, "currency", "$1,234.50"],
    [0.12345, "probability", "12.35%"], [0.00004, "probability", "<0.01%"],
    [19554, "count", "19,554"],
  ] as const)("formats %s as %s without invalid or signed-zero text", async (value, type, expected) => {
    expect(formatOperationalNumber(value, type)).toBe(expected);
  });
});
