import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewSource = readFileSync(
  new URL("../src/dashboard-view.ts", import.meta.url),
  "utf8"
);
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const dataSource = readFileSync(
  new URL("../src/dashboard-data.ts", import.meta.url),
  "utf8"
);

describe("dashboard visual hierarchy", () => {
  it("renders activity before every other card", () => {
    const activity = viewSource.indexOf("if (visible.activity)");
    const today = viewSource.indexOf("if (visible.today)");

    expect(activity).toBeGreaterThan(-1);
    expect(activity).toBeLessThan(today);
    expect(viewSource.slice(activity, today)).toContain('"rd-span-12"');
  });

  it("uses the larger search control and matching loading state", () => {
    expect(css).toMatch(
      /\.rd-search\s*\{[\s\S]*?width:\s*min\(100%, 1040px\);/
    );
    expect(css).toMatch(
      /\.rd-search-input\s*\{[\s\S]*?height:\s*52px;[\s\S]*?font-size:\s*15px;/
    );
    expect(css).toMatch(
      /\.rd-loading-search\s*\{[\s\S]*?width:\s*min\(100%, 1040px\);[\s\S]*?height:\s*52px;/
    );
  });

  it("renders a full 52-week activity year with a responsive grid", () => {
    expect(dataSource).toContain("buildActivityDays(dailyDates, ACTIVITY_WEEKS, now)");
    expect(viewSource).toContain("过去 ${ACTIVITY_WEEKS} 周");
    expect(css).toMatch(
      /\.rd-activity-cells\s*\{[\s\S]*?grid-template-columns:\s*repeat\(52, minmax\(7px, 1fr\)\);/
    );
  });

  it("uses a softer theme-aware fill for recorded days", () => {
    expect(css).toMatch(
      /\.rd-activity-cell\.is-active\s*\{[\s\S]*?var\(--rd-card-color, var\(--rd-accent\)\) 68%[\s\S]*?var\(--background-primary\)/
    );
  });
});
