import type { ActivityDay, CalendarDay, QuickLinkSetting } from "./types";

export const ACTIVITY_WEEKS = 52;

const DATE_TOKEN_PATTERN = /YYYY|MM|DD/g;
const TASK_PATTERN = /^\s*[-*+]\s+\[([ xX-])\]\s*(.*)$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

export interface ParsedTask {
  line: number;
  text: string;
  section: string;
  completed: boolean;
}

export interface ParseTaskOptions {
  includeSections?: RegExp;
  excludeSections?: RegExp;
  includeCompleted?: boolean;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDatePattern(date: Date, pattern: string): string {
  const values: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad2(date.getMonth() + 1),
    DD: pad2(date.getDate())
  };

  return pattern.replace(DATE_TOKEN_PATTERN, (token) => values[token]);
}

export function formatIsoDate(date: Date): string {
  return formatDatePattern(date, "YYYY-MM-DD");
}

export function buildDailyPath(
  date: Date,
  root: string,
  folderFormat: string,
  fileFormat: string
): string {
  const cleanRoot = sanitizeVaultPath(root);
  const folder = formatDatePattern(date, folderFormat);
  const file = `${formatDatePattern(date, fileFormat)}.md`;
  return [cleanRoot, folder, file].filter(Boolean).join("/");
}

export function sanitizeVaultPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

export function isSafeVaultPath(path: string): boolean {
  const clean = sanitizeVaultPath(path);
  return clean.length > 0 && !clean.split("/").includes("..");
}

export function isPathInside(path: string, root: string): boolean {
  const cleanPath = sanitizeVaultPath(path);
  const cleanRoot = sanitizeVaultPath(root);
  return cleanPath === cleanRoot || cleanPath.startsWith(`${cleanRoot}/`);
}

export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeStringArray(item))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  return [];
}

export function stripWikiLink(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  return match ? (match[2] ?? match[1]).trim() : trimmed;
}

export function parseMarkdownTasks(
  content: string,
  options: ParseTaskOptions = {}
): ParsedTask[] {
  const lines = content.split(/\r?\n/);
  const headings: string[] = [];
  const tasks: ParsedTask[] = [];
  let fenceMarker: string | null = null;

  lines.forEach((line, index) => {
    const fence = line.match(FENCE_PATTERN)?.[1] ?? null;
    if (fence) {
      const marker = fence[0];
      if (!fenceMarker) {
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        fenceMarker = null;
      }
      return;
    }

    if (fenceMarker) return;

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      const level = heading[1].length;
      headings.splice(level - 1);
      headings[level - 1] = heading[2].trim();
      return;
    }

    const task = line.match(TASK_PATTERN);
    if (!task) return;

    const section = headings.filter(Boolean).join(" / ");
    if (options.includeSections && !options.includeSections.test(section)) return;
    if (options.excludeSections && options.excludeSections.test(section)) return;

    const completed = task[1].toLowerCase() === "x";
    if (completed && !options.includeCompleted) return;

    const text = task[2].trim();
    if (!text) return;

    tasks.push({
      line: index,
      text,
      section,
      completed
    });
  });

  return tasks;
}

export function getDailyDateFromPath(path: string): string | null {
  const filename = path.split("/").pop() ?? "";
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : match[1];
}

export function calculateDailyStreak(
  dailyDates: Iterable<string>,
  today: Date
): number {
  const dates = new Set(dailyDates);
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (!dates.has(formatIsoDate(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (dates.has(formatIsoDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function startOfCalendarWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  return result;
}

export function buildActivityDays(
  dailyDates: Iterable<string>,
  weeks: number,
  today: Date
): ActivityDay[] {
  const activeDates = new Set(dailyDates);
  const currentWeek = startOfCalendarWeek(today);
  const start = new Date(currentWeek);
  start.setDate(start.getDate() - Math.max(weeks - 1, 0) * 7);

  const todayKey = formatIsoDate(today);
  return Array.from({ length: Math.max(weeks, 1) * 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = formatIsoDate(date);
    return {
      date: key,
      active: activeDates.has(key),
      future: key > todayKey
    };
  });
}

export function buildCalendarDays(
  dailyDates: Iterable<string>,
  month: Date,
  today: Date
): CalendarDay[] {
  const activeDates = new Set(dailyDates);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = startOfCalendarWeek(first);
  const todayKey = formatIsoDate(today);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = formatIsoDate(date);
    return {
      date: key,
      day: date.getDate(),
      inMonth: date.getMonth() === month.getMonth(),
      hasDaily: activeDates.has(key),
      isToday: key === todayKey
    };
  });
}

export function fuzzyScore(query: string, candidate: string): number | null {
  const needle = query.trim().toLocaleLowerCase();
  const haystack = candidate.toLocaleLowerCase();
  if (!needle) return 0;

  const directIndex = haystack.indexOf(needle);
  if (directIndex >= 0) {
    const boundaryBonus = directIndex === 0 || /[\s/_-]/.test(haystack[directIndex - 1]) ? 80 : 0;
    return 1200 + boundaryBonus - directIndex * 3 - (haystack.length - needle.length) * 0.05;
  }

  let cursor = 0;
  let firstMatch = -1;
  let gaps = 0;
  for (const char of needle) {
    const index = haystack.indexOf(char, cursor);
    if (index < 0) return null;
    if (firstMatch < 0) firstMatch = index;
    gaps += index - cursor;
    cursor = index + 1;
  }

  return 600 - firstMatch * 4 - gaps * 5 - haystack.length * 0.02;
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const deltaSeconds = Math.round((timestamp - now) / 1000);
  const absolute = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

  if (absolute < 60) return "刚刚";
  if (absolute < 3600) return formatter.format(Math.round(deltaSeconds / 60), "minute");
  if (absolute < 86400) return formatter.format(Math.round(deltaSeconds / 3600), "hour");
  if (absolute < 86400 * 30) return formatter.format(Math.round(deltaSeconds / 86400), "day");
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function parseQuickLinks(value: string): QuickLinkSetting[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [label = "", path = "", icon = "file-text"] = line
        .split("|")
        .map((item) => item.trim());
      if (!label || !isSafeVaultPath(path)) return [];
      return [{ label, path: sanitizeVaultPath(path), icon: icon || "file-text" }];
    });
}

export function serializeQuickLinks(links: QuickLinkSetting[]): string {
  return links.map((link) => `${link.label} | ${link.path} | ${link.icon}`).join("\n");
}
