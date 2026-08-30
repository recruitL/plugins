import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("Style Settings compatibility", () => {
  it("isolates Phycat card mode to the active dashboard view", () => {
    expect(css).toContain("body.layout-cards:not(.is-mobile)");
    expect(css).toContain('[data-type="research-dashboard-view"]');
    expect(css).toContain("> .view-content.research-dashboard-view");
    expect(css).toContain("background-color: var(--background-primary) !important;");
  });

  it("removes the floating outer card only when the active view is the dashboard", () => {
    expect(css).toMatch(
      /\.workspace-tab-container:has\([\s\S]*?\.workspace-leaf\.mod-active[\s\S]*?data-type="research-dashboard-view"[\s\S]*?\)\s*\{[\s\S]*?margin:\s*0;[\s\S]*?border:\s*0;[\s\S]*?box-shadow:\s*none;/
    );
  });

  it("neutralizes broad theme heading shadows inside dashboard cards", () => {
    expect(css).toMatch(/\.rd-card h2\s*\{[\s\S]*?text-shadow:\s*none !important;/);
  });
});
