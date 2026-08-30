import { describe, expect, it } from "vitest";
import {
  ACTIVITY_WEEKS,
  buildActivityDays,
  buildCalendarDays,
  buildDailyPath,
  calculateDailyStreak,
  fuzzyScore,
  normalizeStringArray,
  parseMarkdownTasks,
  parseQuickLinks
} from "../src/utils";

describe("daily path helpers", () => {
  it("builds the vault monthly daily path", () => {
    const date = new Date(2026, 7, 30);
    expect(buildDailyPath(date, "01 Daily", "YYYYMM", "YYYY-MM-DD")).toBe(
      "01 Daily/202608/2026-08-30.md"
    );
  });

  it("normalizes mixed work_summary values", () => {
    expect(normalizeStringArray(["A", "", ["B"]])).toEqual(["A", "B"]);
    expect(normalizeStringArray("one line")).toEqual(["one line"]);
    expect(normalizeStringArray(null)).toEqual([]);
  });
});

describe("task parsing", () => {
  const content = `# Daily

## 今日任务
- [ ] 真任务
- [x] 已完成
- [ ]

\`\`\`markdown
- [ ] 代码示例
\`\`\`

## 验收清单
- [ ] 不应进入聚焦任务
`;

  it("keeps non-empty pending tasks in the selected section", () => {
    expect(
      parseMarkdownTasks(content, { includeSections: /今日任务/ }).map((task) => task.text)
    ).toEqual(["真任务"]);
  });

  it("can exclude checklist-style sections", () => {
    expect(
      parseMarkdownTasks(content, {
        excludeSections: /验收|检查清单|复核清单/
      }).map((task) => task.text)
    ).toEqual(["真任务"]);
  });
});

describe("activity calculations", () => {
  it("allows today to be missing without breaking yesterday's streak", () => {
    expect(
      calculateDailyStreak(
        ["2026-08-27", "2026-08-28", "2026-08-29"],
        new Date(2026, 7, 30)
      )
    ).toBe(3);
  });

  it("builds complete Monday-first activity weeks", () => {
    const days = buildActivityDays(["2026-08-29"], 2, new Date(2026, 7, 30));
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe("2026-08-17");
    expect(days.find((day) => day.date === "2026-08-29")?.active).toBe(true);
  });

  it("builds a complete 52-week activity year", () => {
    const days = buildActivityDays([], ACTIVITY_WEEKS, new Date(2026, 7, 31));
    expect(days).toHaveLength(364);
    expect(days[0].date).toBe("2025-09-08");
    expect(days.at(-1)?.date).toBe("2026-09-06");
  });

  it("builds a six-week calendar grid", () => {
    const days = buildCalendarDays(["2026-08-29"], new Date(2026, 7, 1), new Date(2026, 7, 30));
    expect(days).toHaveLength(42);
    expect(days[0].date).toBe("2026-07-27");
    expect(days.find((day) => day.date === "2026-08-29")?.hasDaily).toBe(true);
  });
});

describe("search and settings helpers", () => {
  it("ranks exact filename matches above loose subsequences", () => {
    expect(fuzzyScore("qnm", "QNM EP 点数值方法")).toBeGreaterThan(
      fuzzyScore("qnm", "quantum-notes-method") ?? 0
    );
  });

  it("parses safe quick links and rejects parent traversal", () => {
    expect(
      parseQuickLinks(
        "知识库导航 | 08 Maps/知识库导航.md | map\n坏路径 | ../secret | file\n缺少路径"
      )
    ).toEqual([
      { label: "知识库导航", path: "08 Maps/知识库导航.md", icon: "map" }
    ]);
  });
});
