import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  App: class {},
  Notice: class {},
  PluginSettingTab: class {},
  Setting: class {}
}));

import {
  DEFAULT_CARD_COLORS,
  DEFAULT_QUICK_LINKS,
  mergeSettings,
  restoreDefaultCardColors
} from "../src/settings";

describe("settings migration", () => {
  it("uses default quick links when the saved field is missing", () => {
    expect(mergeSettings({}).quickLinks).toEqual(DEFAULT_QUICK_LINKS);
  });

  it("preserves an intentionally empty quick-link list", () => {
    expect(mergeSettings({ quickLinks: [] }).quickLinks).toEqual([]);
  });

  it("migrates older settings to the complete default card palette", () => {
    const merged = mergeSettings({ schemaVersion: 1 });
    expect(merged.schemaVersion).toBe(3);
    expect(merged.useCardColors).toBe(true);
    expect(merged.cardColors).toEqual(DEFAULT_CARD_COLORS);
  });

  it("migrates the former dark activity green to the softer palette", () => {
    const merged = mergeSettings({
      schemaVersion: 2,
      cardColors: {
        ...DEFAULT_CARD_COLORS,
        activity: "#3E8B95"
      }
    });

    expect(merged.cardColors.activity).toBe("#73C6C8");
  });

  it("preserves valid custom colors and rejects malformed persisted values", () => {
    const merged = mergeSettings({
      useCardColors: false,
      cardColors: {
        ...DEFAULT_CARD_COLORS,
        today: "#abcdef",
        focus: "not-a-color"
      }
    });

    expect(merged.useCardColors).toBe(false);
    expect(merged.cardColors.today).toBe("#ABCDEF");
    expect(merged.cardColors.focus).toBe(DEFAULT_CARD_COLORS.focus);
  });

  it("restores only the palette without re-enabling disabled card colors", () => {
    const disabled = mergeSettings({
      useCardColors: false,
      cardColors: {
        ...DEFAULT_CARD_COLORS,
        today: "#112233"
      }
    });

    const restored = restoreDefaultCardColors(disabled);

    expect(restored.useCardColors).toBe(false);
    expect(restored.cardColors).toEqual(DEFAULT_CARD_COLORS);
  });
});
