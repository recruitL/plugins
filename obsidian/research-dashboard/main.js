"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  VIEW_TYPE_RESEARCH_DASHBOARD: () => VIEW_TYPE_RESEARCH_DASHBOARD,
  default: () => ResearchDashboardPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/dashboard-data.ts
var import_obsidian = require("obsidian");

// src/utils.ts
var ACTIVITY_WEEKS = 52;
var DATE_TOKEN_PATTERN = /YYYY|MM|DD/g;
var TASK_PATTERN = /^\s*[-*+]\s+\[([ xX-])\]\s*(.*)$/;
var HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
var FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;
function pad2(value) {
  return String(value).padStart(2, "0");
}
function formatDatePattern(date, pattern) {
  const values = {
    YYYY: String(date.getFullYear()),
    MM: pad2(date.getMonth() + 1),
    DD: pad2(date.getDate())
  };
  return pattern.replace(DATE_TOKEN_PATTERN, (token) => values[token]);
}
function formatIsoDate(date) {
  return formatDatePattern(date, "YYYY-MM-DD");
}
function buildDailyPath(date, root, folderFormat, fileFormat) {
  const cleanRoot = sanitizeVaultPath(root);
  const folder = formatDatePattern(date, folderFormat);
  const file = `${formatDatePattern(date, fileFormat)}.md`;
  return [cleanRoot, folder, file].filter(Boolean).join("/");
}
function sanitizeVaultPath(path) {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}
function isSafeVaultPath(path) {
  const clean = sanitizeVaultPath(path);
  return clean.length > 0 && !clean.split("/").includes("..");
}
function isPathInside(path, root) {
  const cleanPath = sanitizeVaultPath(path);
  const cleanRoot = sanitizeVaultPath(root);
  return cleanPath === cleanRoot || cleanPath.startsWith(`${cleanRoot}/`);
}
function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeStringArray(item)).map((item) => item.trim()).filter(Boolean);
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
function parseMarkdownTasks(content, options = {}) {
  const lines = content.split(/\r?\n/);
  const headings = [];
  const tasks = [];
  let fenceMarker = null;
  lines.forEach((line, index) => {
    var _a, _b;
    const fence = (_b = (_a = line.match(FENCE_PATTERN)) == null ? void 0 : _a[1]) != null ? _b : null;
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
function getDailyDateFromPath(path) {
  var _a;
  const filename = (_a = path.split("/").pop()) != null ? _a : "";
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  if (!match) return null;
  const date = /* @__PURE__ */ new Date(`${match[1]}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : match[1];
}
function calculateDailyStreak(dailyDates, today) {
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
function startOfCalendarWeek(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  return result;
}
function buildActivityDays(dailyDates, weeks, today) {
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
function buildCalendarDays(dailyDates, month, today) {
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
function fuzzyScore(query, candidate) {
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
function formatRelativeTime(timestamp, now = Date.now()) {
  const deltaSeconds = Math.round((timestamp - now) / 1e3);
  const absolute = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (absolute < 60) return "\u521A\u521A";
  if (absolute < 3600) return formatter.format(Math.round(deltaSeconds / 60), "minute");
  if (absolute < 86400) return formatter.format(Math.round(deltaSeconds / 3600), "hour");
  if (absolute < 86400 * 30) return formatter.format(Math.round(deltaSeconds / 86400), "day");
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}
function parseQuickLinks(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const [label = "", path = "", icon = "file-text"] = line.split("|").map((item) => item.trim());
    if (!label || !isSafeVaultPath(path)) return [];
    return [{ label, path: sanitizeVaultPath(path), icon: icon || "file-text" }];
  });
}
function serializeQuickLinks(links) {
  return links.map((link) => `${link.label} | ${link.path} | ${link.icon}`).join("\n");
}

// src/dashboard-data.ts
var PROJECT_TASK_SECTION = /待办|后续动作|后续待办|后续精读任务|下一步/i;
var EXCLUDED_TASK_SECTION = /验收|检查清单|复核清单/i;
var TODAY_TASK_SECTION = /今日任务/i;
var REVIEW_LIMIT = 6;
var PROJECT_TASK_FILE_LIMIT = 30;
var PROJECT_TASKS_PER_FILE = 3;
var DashboardDataService = class {
  constructor(app) {
    this.app = app;
  }
  async build(settings) {
    const now = /* @__PURE__ */ new Date();
    const today = formatIsoDate(now);
    const files = this.app.vault.getMarkdownFiles();
    const dailyPath = (0, import_obsidian.normalizePath)(
      buildDailyPath(
        now,
        settings.dailyRoot,
        settings.dailyFolderFormat,
        settings.dailyFileFormat
      )
    );
    const dailyDates = new Set(
      files.filter((file) => isPathInside(file.path, settings.dailyRoot)).map((file) => getDailyDateFromPath(file.path)).filter((date) => Boolean(date))
    );
    const searchFiles = this.buildSearchFiles(files);
    const projectFiles = files.filter((file) => isPathInside(file.path, settings.projectRoot));
    const stableFiles = files.filter((file) => this.isStableKnowledgeFile(file, settings));
    const daily = await this.buildDailySnapshot(dailyPath);
    const projectTasks = await this.buildProjectTasks(projectFiles);
    const focusTasks = [...daily.tasks, ...projectTasks].sort((a, b) => {
      if (a.source !== b.source) return a.source === "today" ? -1 : 1;
      return b.mtime - a.mtime || a.line - b.line;
    }).slice(0, settings.taskLimit);
    const projectTopics = this.buildProjectTopics(projectFiles, settings.projectRoot);
    const recentFiles = this.buildRecentFiles(stableFiles, settings).slice(0, settings.recentLimit);
    const reviewItems = this.buildReviewItems(stableFiles).slice(0, REVIEW_LIMIT);
    return {
      generatedAt: Date.now(),
      today,
      searchFiles,
      daily,
      focusTasks,
      projectTopics,
      recentFiles,
      reviewItems,
      activityDays: buildActivityDays(dailyDates, ACTIVITY_WEEKS, now),
      calendarDays: buildCalendarDays(dailyDates, now, now),
      stats: {
        notes: files.length,
        stableNotes: stableFiles.length,
        projectTopics: projectTopics.length,
        dailyStreak: calculateDailyStreak(dailyDates, now)
      }
    };
  }
  buildSearchFiles(files) {
    return files.map((file) => {
      const frontmatter = this.getFrontmatter(file);
      const aliases = [
        ...normalizeStringArray(frontmatter.aliases),
        ...normalizeStringArray(frontmatter.alias)
      ];
      return {
        path: file.path,
        name: file.name,
        basename: file.basename,
        aliases: Array.from(new Set(aliases)),
        mtime: file.stat.mtime
      };
    });
  }
  async buildDailySnapshot(path) {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof import_obsidian.TFile)) {
      return { path, exists: false, workSummary: [], tasks: [] };
    }
    const frontmatter = this.getFrontmatter(abstractFile);
    const content = await this.app.vault.cachedRead(abstractFile);
    const tasks = parseMarkdownTasks(content, { includeSections: TODAY_TASK_SECTION }).map(
      (task) => ({
        path: abstractFile.path,
        line: task.line,
        text: task.text,
        section: task.section,
        source: "today",
        mtime: abstractFile.stat.mtime
      })
    );
    return {
      path,
      exists: true,
      workSummary: normalizeStringArray(frontmatter.work_summary),
      tasks
    };
  }
  async buildProjectTasks(files) {
    const candidates = files.filter((file) => {
      var _a, _b;
      const headings = (_b = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.headings) != null ? _b : [];
      return headings.some((heading) => PROJECT_TASK_SECTION.test(heading.heading));
    }).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, PROJECT_TASK_FILE_LIMIT);
    const taskGroups = await Promise.all(
      candidates.map(async (file) => {
        const content = await this.app.vault.cachedRead(file);
        return parseMarkdownTasks(content, {
          includeSections: PROJECT_TASK_SECTION,
          excludeSections: EXCLUDED_TASK_SECTION
        }).map(
          (task) => ({
            path: file.path,
            line: task.line,
            text: task.text,
            section: task.section,
            source: "project",
            mtime: file.stat.mtime
          })
        );
      })
    );
    return taskGroups.flatMap((tasks) => tasks.slice(0, PROJECT_TASKS_PER_FILE));
  }
  buildProjectTopics(files, projectRoot) {
    const root = (0, import_obsidian.normalizePath)(projectRoot).replace(/\/$/, "");
    const groups = /* @__PURE__ */ new Map();
    files.forEach((file) => {
      var _a;
      const relativePath = file.path.slice(root.length).replace(/^\//, "");
      const firstSegment = relativePath.split("/")[0];
      const name = relativePath.includes("/") ? firstSegment : file.basename;
      const group = (_a = groups.get(name)) != null ? _a : { name, files: [] };
      group.files.push(file);
      groups.set(name, group);
    });
    return Array.from(groups.values()).map((group) => {
      const preferred = [...group.files].sort((a, b) => {
        var _a, _b;
        const aType = String((_a = this.getFrontmatter(a).type) != null ? _a : "").toLowerCase();
        const bType = String((_b = this.getFrontmatter(b).type) != null ? _b : "").toLowerCase();
        const aRank = aType === "project" || aType === "project_overview" ? 1 : 0;
        const bRank = bType === "project" || bType === "project_overview" ? 1 : 0;
        return bRank - aRank || b.stat.mtime - a.stat.mtime;
      })[0];
      const statuses = group.files.map(
        (file) => {
          var _a;
          return String((_a = this.getFrontmatter(file).status) != null ? _a : "").toLowerCase();
        }
      );
      return {
        name: group.name,
        path: preferred.path,
        noteCount: group.files.length,
        activeCount: statuses.filter((status) => status === "active").length,
        draftCount: statuses.filter((status) => status === "draft").length,
        mtime: Math.max(...group.files.map((file) => file.stat.mtime))
      };
    }).sort((a, b) => b.mtime - a.mtime);
  }
  buildRecentFiles(files, settings) {
    return [...files].sort((a, b) => b.stat.mtime - a.stat.mtime).map((file) => {
      var _a;
      const frontmatter = this.getFrontmatter(file);
      return {
        path: file.path,
        basename: file.basename,
        mtime: file.stat.mtime,
        summary: (_a = normalizeStringArray(frontmatter.summary)[0]) != null ? _a : "",
        kind: this.getKnowledgeKind(file.path, settings)
      };
    });
  }
  buildReviewItems(files) {
    return files.flatMap((file) => {
      var _a, _b, _c;
      const frontmatter = this.getFrontmatter(file);
      const status = String((_a = frontmatter.status) != null ? _a : "").toLowerCase();
      const needsReview = frontmatter.needs_review === true || frontmatter.needs_review === "true";
      if (!needsReview && status !== "draft") return [];
      return [
        {
          path: file.path,
          basename: file.basename,
          mtime: file.stat.mtime,
          summary: (_b = normalizeStringArray(frontmatter.summary)[0]) != null ? _b : "",
          kind: String((_c = frontmatter.type) != null ? _c : "note"),
          reason: needsReview ? "needs_review" : "draft"
        }
      ];
    }).sort((a, b) => b.mtime - a.mtime);
  }
  isStableKnowledgeFile(file, settings) {
    return [
      settings.projectRoot,
      settings.papersRoot,
      settings.literatureRoot,
      settings.applicationRoot
    ].some((root) => isPathInside(file.path, root));
  }
  getKnowledgeKind(path, settings) {
    if (isPathInside(path, settings.projectRoot)) return "\u9879\u76EE";
    if (isPathInside(path, settings.papersRoot)) return "\u6587\u7AE0";
    if (isPathInside(path, settings.literatureRoot)) return "\u6587\u732E";
    if (isPathInside(path, settings.applicationRoot)) return "\u5E94\u7528";
    return "\u7B14\u8BB0";
  }
  getFrontmatter(file) {
    var _a;
    const frontmatter = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
    return frontmatter && typeof frontmatter === "object" ? frontmatter : {};
  }
};

// src/dashboard-view.ts
var import_obsidian2 = require("obsidian");
var VIEW_REFRESH_DELAY_MS = 180;
var SEARCH_RESULT_LIMIT = 8;
var ResearchDashboardView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.model = null;
    this.renderToken = 0;
    this.refreshTimer = null;
    this.dirty = false;
    this.searchInput = null;
    this.searchResultsEl = null;
    this.searchMatches = [];
    this.activeSearchIndex = -1;
  }
  getViewType() {
    return VIEW_TYPE_RESEARCH_DASHBOARD;
  }
  getDisplayText() {
    return this.plugin.settings.title;
  }
  getIcon() {
    return "layout-dashboard";
  }
  async onOpen() {
    this.contentEl.addClass("research-dashboard-view");
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.leaf && this.dirty) this.requestRefresh(true);
      })
    );
    this.registerDomEvent(this.containerEl.ownerDocument, "keydown", (event) => {
      var _a;
      if (this.app.workspace.activeLeaf !== this.leaf) return;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target == null ? void 0 : target.matches("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      (_a = this.searchInput) == null ? void 0 : _a.focus();
    });
    await this.renderDashboard(true);
  }
  async onClose() {
    this.renderToken += 1;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.searchInput = null;
    this.searchResultsEl = null;
    this.model = null;
    this.contentEl.empty();
  }
  requestRefresh(force = false) {
    this.dirty = true;
    if (!force && this.app.workspace.activeLeaf !== this.leaf) return;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.renderDashboard(false);
    }, force ? 0 : VIEW_REFRESH_DELAY_MS);
  }
  async renderDashboard(initial) {
    var _a, _b, _c, _d;
    const token = ++this.renderToken;
    const previousQuery = (_b = (_a = this.searchInput) == null ? void 0 : _a.value) != null ? _b : "";
    const restoreSearchFocus = document.activeElement === this.searchInput;
    const previousScrollTop = this.contentEl.scrollTop;
    if (initial || !this.model) this.renderLoading();
    else this.contentEl.addClass("is-refreshing");
    try {
      const model = await this.plugin.dataService.build(this.plugin.settings);
      if (token !== this.renderToken) return;
      this.model = model;
      this.dirty = false;
      this.renderModel(model, previousQuery, restoreSearchFocus);
      this.contentEl.scrollTop = previousScrollTop;
      if (restoreSearchFocus) {
        (_c = this.searchInput) == null ? void 0 : _c.focus();
        (_d = this.searchInput) == null ? void 0 : _d.setSelectionRange(previousQuery.length, previousQuery.length);
      }
    } catch (error) {
      if (token !== this.renderToken) return;
      this.renderError(error);
    } finally {
      if (token === this.renderToken) this.contentEl.removeClass("is-refreshing");
    }
  }
  renderLoading() {
    this.contentEl.empty();
    const shell = this.contentEl.createDiv({ cls: "rd-shell rd-loading-shell" });
    shell.createDiv({ cls: "rd-loading-line rd-loading-title" });
    shell.createDiv({ cls: "rd-loading-line rd-loading-search" });
    const grid = shell.createDiv({ cls: "rd-loading-grid" });
    for (let index = 0; index < 6; index += 1) {
      grid.createDiv({ cls: "rd-loading-card" });
    }
  }
  renderError(error) {
    this.contentEl.empty();
    const shell = this.contentEl.createDiv({ cls: "rd-shell" });
    const state = shell.createDiv({ cls: "rd-global-state" });
    const icon = state.createDiv({ cls: "rd-global-state-icon" });
    (0, import_obsidian2.setIcon)(icon, "circle-alert");
    state.createEl("h2", { text: "\u4EEA\u8868\u76D8\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6" });
    state.createEl("p", {
      text: error instanceof Error ? error.message : "\u53D1\u751F\u4E86\u672A\u77E5\u9519\u8BEF\u3002"
    });
    const retry = state.createEl("button", { cls: "mod-cta", text: "\u91CD\u65B0\u52A0\u8F7D" });
    retry.addEventListener("click", () => this.requestRefresh(true));
  }
  renderModel(model, previousQuery, reopenSearchResults) {
    this.contentEl.empty();
    this.searchInput = null;
    this.searchResultsEl = null;
    this.searchMatches = [];
    this.activeSearchIndex = -1;
    const densityClass = `rd-density-${this.plugin.settings.density}`;
    const colorClass = this.plugin.settings.useCardColors ? "rd-card-colors-on" : "";
    const shell = this.contentEl.createDiv({ cls: `rd-shell ${densityClass} ${colorClass}` });
    this.renderHero(shell, model, previousQuery, reopenSearchResults);
    this.renderStats(shell, model);
    const grid = shell.createDiv({ cls: "rd-grid" });
    const visible = this.plugin.settings.visibleCards;
    if (visible.activity) {
      this.renderCardSafely(
        grid,
        "activity",
        "activity",
        "\u8BB0\u5F55\u6D3B\u8DC3\u5EA6",
        "rd-span-12",
        (body) => this.renderActivityCard(body, model)
      );
    }
    if (visible.today) {
      this.renderCardSafely(
        grid,
        "today",
        "calendar-check",
        "\u4ECA\u65E5 Daily",
        "rd-span-7",
        (body) => this.renderTodayCard(body, model)
      );
    }
    if (visible.calendar) {
      this.renderCardSafely(
        grid,
        "calendar",
        "calendar-days",
        "\u672C\u6708\u8BB0\u5F55",
        "rd-span-5",
        (body) => this.renderCalendarCard(body, model)
      );
    }
    if (visible.focus) {
      this.renderCardSafely(
        grid,
        "focus",
        "list-checks",
        "\u805A\u7126\u5F85\u529E",
        "rd-span-7",
        (body) => this.renderFocusCard(body, model.focusTasks)
      );
    }
    if (visible.quickLinks) {
      this.renderCardSafely(
        grid,
        "quickLinks",
        "blocks",
        "\u5FEB\u6377\u5165\u53E3",
        "rd-span-5",
        (body) => this.renderQuickLinks(body)
      );
    }
    if (visible.projects) {
      this.renderCardSafely(
        grid,
        "projects",
        "folder-kanban",
        "\u7814\u7A76\u4E3B\u9898",
        "rd-span-7",
        (body) => this.renderProjectsCard(body, model)
      );
    }
    if (visible.review) {
      this.renderCardSafely(
        grid,
        "review",
        "scan-search",
        "\u5F85\u590D\u6838",
        "rd-span-5",
        (body) => this.renderReviewCard(body, model)
      );
    }
    if (visible.recent) {
      this.renderCardSafely(
        grid,
        "recent",
        "history",
        "\u6700\u8FD1\u6C89\u6DC0",
        "rd-span-12",
        (body) => this.renderRecentCard(body, model.recentFiles)
      );
    }
    const footer = shell.createEl("footer", { cls: "rd-footer" });
    footer.createSpan({ text: "LOCAL ONLY" });
    footer.createSpan({ text: "\u4E0D\u4F9D\u8D56 Dataview \xB7 \u4E0D\u4FEE\u6539\u7B14\u8BB0" });
    footer.createSpan({ text: `\u66F4\u65B0\u4E8E ${new Date(model.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` });
  }
  renderHero(container, model, previousQuery, reopenSearchResults) {
    const hero = container.createEl("header", { cls: "rd-hero" });
    const top = hero.createDiv({ cls: "rd-hero-top" });
    const identity = top.createDiv({ cls: "rd-identity" });
    identity.createDiv({ cls: "rd-eyebrow", text: "LOCAL RESEARCH HOME" });
    identity.createEl("h1", { text: this.plugin.settings.title });
    if (this.plugin.settings.subtitle) {
      identity.createEl("p", { text: this.plugin.settings.subtitle });
    }
    const dateArea = top.createDiv({ cls: "rd-date-area" });
    const now = /* @__PURE__ */ new Date();
    dateArea.createEl("time", {
      attr: { datetime: model.today },
      text: new Intl.DateTimeFormat("zh-CN", {
        month: "long",
        day: "numeric",
        weekday: "long"
      }).format(now)
    });
    const refresh = dateArea.createEl("button", {
      cls: "rd-icon-button",
      attr: { "aria-label": "\u5237\u65B0\u4EEA\u8868\u76D8", title: "\u5237\u65B0\u4EEA\u8868\u76D8" }
    });
    (0, import_obsidian2.setIcon)(refresh, "refresh-cw");
    refresh.addEventListener("click", () => this.requestRefresh(true));
    const search = hero.createDiv({ cls: "rd-search" });
    const searchIcon = search.createDiv({ cls: "rd-search-icon" });
    (0, import_obsidian2.setIcon)(searchIcon, "search");
    const input = search.createEl("input", {
      cls: "rd-search-input",
      attr: {
        type: "search",
        placeholder: "\u641C\u7D22\u6587\u4EF6\u540D\u3001\u8DEF\u5F84\u6216 alias\u2026",
        "aria-label": "\u641C\u7D22 vault \u7B14\u8BB0",
        "aria-expanded": "false",
        autocomplete: "off",
        spellcheck: "false"
      }
    });
    input.value = previousQuery;
    const shortcut = search.createEl("kbd", { text: "/" });
    shortcut.setAttr("aria-hidden", "true");
    const results = search.createDiv({
      cls: "rd-search-results",
      attr: { role: "listbox", "aria-label": "\u641C\u7D22\u7ED3\u679C" }
    });
    results.hidden = true;
    this.searchInput = input;
    this.searchResultsEl = results;
    input.addEventListener("input", () => this.updateSearchResults(input.value, false));
    input.addEventListener("focus", () => this.updateSearchResults(input.value, true));
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!search.contains(document.activeElement)) this.hideSearchResults();
      }, 120);
    });
    input.addEventListener("keydown", (event) => this.handleSearchKeydown(event));
    if (previousQuery && reopenSearchResults) this.updateSearchResults(previousQuery, false);
  }
  renderStats(container, model) {
    const stats = container.createEl("dl", { cls: "rd-stats" });
    const entries = [
      [String(model.stats.notes), "\u5168\u90E8\u7B14\u8BB0", "file-text"],
      [String(model.stats.stableNotes), "\u957F\u671F\u77E5\u8BC6", "archive"],
      [String(model.stats.projectTopics), "\u7814\u7A76\u4E3B\u9898", "folder-kanban"],
      [`${model.stats.dailyStreak} \u5929`, "Daily \u8FDE\u7EED", "flame"]
    ];
    entries.forEach(([value, label, iconName]) => {
      const stat = stats.createDiv({ cls: "rd-stat" });
      const icon = stat.createDiv({ cls: "rd-stat-icon" });
      (0, import_obsidian2.setIcon)(icon, iconName);
      const copy = stat.createDiv();
      copy.createEl("dd", { text: value });
      copy.createEl("dt", { text: label });
    });
  }
  renderCardSafely(grid, id, iconName, title, spanClass, renderBody) {
    const card = grid.createEl("section", {
      cls: `rd-card ${spanClass}`,
      attr: { "data-card": id, "aria-labelledby": `rd-card-${id}` }
    });
    if (this.plugin.settings.useCardColors) {
      card.style.setProperty("--rd-card-color", this.plugin.settings.cardColors[id]);
    }
    const header = card.createEl("header", { cls: "rd-card-header" });
    const titleGroup = header.createDiv({ cls: "rd-card-title-group" });
    const icon = titleGroup.createDiv({ cls: "rd-card-icon" });
    (0, import_obsidian2.setIcon)(icon, iconName);
    titleGroup.createEl("h2", { text: title, attr: { id: `rd-card-${id}` } });
    const body = card.createDiv({ cls: "rd-card-body" });
    try {
      renderBody(body);
    } catch (error) {
      body.empty();
      const state = body.createDiv({ cls: "rd-empty-state is-error" });
      state.createEl("strong", { text: "\u8FD9\u5F20\u5361\u7247\u6682\u65F6\u65E0\u6CD5\u663E\u793A" });
      state.createEl("span", {
        text: error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF"
      });
    }
  }
  renderTodayCard(body, model) {
    const daily = model.daily;
    if (!daily.exists) {
      const state = body.createDiv({ cls: "rd-empty-state rd-today-missing" });
      const icon = state.createDiv({ cls: "rd-empty-icon" });
      (0, import_obsidian2.setIcon)(icon, "file-clock");
      state.createEl("strong", { text: "\u4ECA\u65E5 Daily \u5C1A\u672A\u521B\u5EFA" });
      state.createEl("span", { text: daily.path });
      const hint = state.createDiv({ cls: "rd-shortcut-hint" });
      hint.createSpan({ text: "\u4F7F\u7528\u73B0\u6709 QuickAdd \u5FEB\u6377\u952E" });
      if (this.plugin.settings.dailyShortcutLabel) {
        hint.createEl("kbd", { text: this.plugin.settings.dailyShortcutLabel });
      }
      return;
    }
    const openButton = body.createEl("button", { cls: "rd-inline-action" });
    const openIcon = openButton.createSpan({ cls: "rd-inline-action-icon" });
    (0, import_obsidian2.setIcon)(openIcon, "arrow-up-right");
    openButton.createSpan({ text: "\u6253\u5F00\u4ECA\u65E5\u65E5\u8BB0" });
    openButton.addEventListener("click", () => void this.plugin.openFile(daily.path));
    if (daily.workSummary.length > 0) {
      const summary = body.createEl("ul", { cls: "rd-summary-list" });
      daily.workSummary.slice(0, 4).forEach((item) => summary.createEl("li", { text: item }));
    } else {
      body.createEl("p", { cls: "rd-muted", text: "work_summary \u76EE\u524D\u4E3A\u7A7A\u3002" });
    }
    const taskLabel = body.createDiv({ cls: "rd-section-label" });
    taskLabel.createSpan({ text: "\u4ECA\u65E5\u4EFB\u52A1" });
    taskLabel.createSpan({ text: String(daily.tasks.length) });
    if (daily.tasks.length === 0) {
      body.createEl("p", { cls: "rd-muted", text: "\u6CA1\u6709\u975E\u7A7A\u7684\u672A\u5B8C\u6210\u4EFB\u52A1\u3002" });
    } else {
      const list = body.createDiv({ cls: "rd-mini-task-list" });
      daily.tasks.slice(0, 3).forEach((task) => this.renderTaskRow(list, task, false));
    }
  }
  renderCalendarCard(body, model) {
    const now = /* @__PURE__ */ new Date();
    const heading = body.createDiv({ cls: "rd-calendar-heading" });
    heading.createEl("strong", {
      text: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(now)
    });
    heading.createSpan({ text: "\u5706\u70B9\u8868\u793A\u5B58\u5728 Daily" });
    const calendar = body.createDiv({ cls: "rd-calendar" });
    ["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u65E5"].forEach(
      (day) => calendar.createDiv({ cls: "rd-calendar-weekday", text: day })
    );
    model.calendarDays.forEach((day) => {
      const classNames = ["rd-calendar-day"];
      if (!day.inMonth) classNames.push("is-outside");
      if (day.isToday) classNames.push("is-today");
      if (day.hasDaily) classNames.push("has-daily");
      const cell = calendar.createEl(day.hasDaily ? "button" : "div", {
        cls: classNames.join(" "),
        attr: {
          "aria-label": `${day.date}${day.hasDaily ? "\uFF0C\u6709 Daily" : "\uFF0C\u65E0 Daily"}`,
          title: day.date
        }
      });
      cell.createSpan({ text: String(day.day) });
      if (day.hasDaily) cell.createSpan({ cls: "rd-calendar-dot" });
      if (day.hasDaily && cell instanceof HTMLButtonElement) {
        cell.addEventListener("click", () => {
          const [year, month, date] = day.date.split("-").map(Number);
          const path = (0, import_obsidian2.normalizePath)(
            buildDailyPath(
              new Date(year, month - 1, date),
              this.plugin.settings.dailyRoot,
              this.plugin.settings.dailyFolderFormat,
              this.plugin.settings.dailyFileFormat
            )
          );
          void this.plugin.openFile(path);
        });
      }
    });
  }
  renderFocusCard(body, tasks) {
    if (tasks.length === 0) {
      const state = body.createDiv({ cls: "rd-empty-state" });
      state.createEl("strong", { text: "\u76EE\u524D\u6CA1\u6709\u805A\u7126\u5F85\u529E" });
      state.createEl("span", { text: "\u8FD9\u91CC\u53EA\u6536\u5F55\u4ECA\u65E5\u4EFB\u52A1\u548C\u9879\u76EE\u4E2D\u660E\u786E\u7684\u5F85\u529E\u533A\u5757\u3002" });
      return;
    }
    const list = body.createDiv({ cls: "rd-task-list" });
    tasks.forEach((task) => this.renderTaskRow(list, task, true));
  }
  renderTaskRow(container, task, showSource) {
    const button = container.createEl("button", { cls: "rd-task-row" });
    const check = button.createSpan({ cls: "rd-task-check" });
    (0, import_obsidian2.setIcon)(check, "square");
    const copy = button.createSpan({ cls: "rd-task-copy" });
    copy.createSpan({ cls: "rd-task-text", text: task.text });
    const meta = copy.createSpan({ cls: "rd-task-meta" });
    if (showSource) {
      meta.createSpan({
        cls: `rd-source-chip is-${task.source}`,
        text: task.source === "today" ? "\u4ECA\u65E5" : "\u9879\u76EE"
      });
    }
    meta.createSpan({ text: this.basenameFromPath(task.path) });
    button.addEventListener("click", () => void this.plugin.openFile(task.path, task.line));
  }
  renderQuickLinks(body) {
    if (this.plugin.settings.quickLinks.length === 0) {
      body.createEl("p", { cls: "rd-muted", text: "\u53EF\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u6DFB\u52A0\u6B63\u5F0F\u5165\u53E3\u3002" });
      return;
    }
    const links = body.createDiv({ cls: "rd-quick-links" });
    this.plugin.settings.quickLinks.forEach((link) => {
      const exists = this.app.vault.getAbstractFileByPath((0, import_obsidian2.normalizePath)(link.path)) instanceof import_obsidian2.TFile;
      const button = links.createEl("button", {
        cls: `rd-quick-link${exists ? "" : " is-missing"}`,
        attr: {
          title: exists ? link.path : `\u672A\u627E\u5230\uFF1A${link.path}`,
          "aria-label": `${link.label}${exists ? "" : "\uFF0C\u6587\u4EF6\u4E0D\u5B58\u5728"}`
        }
      });
      button.disabled = !exists;
      const icon = button.createSpan({ cls: "rd-quick-link-icon" });
      (0, import_obsidian2.setIcon)(icon, link.icon || "file-text");
      button.createSpan({ cls: "rd-quick-link-label", text: link.label });
      button.addEventListener("click", () => void this.plugin.openFile(link.path));
    });
  }
  renderProjectsCard(body, model) {
    if (model.projectTopics.length === 0) {
      body.createEl("p", { cls: "rd-muted", text: "\u9879\u76EE\u76EE\u5F55\u4E0B\u6682\u65F6\u6CA1\u6709 Markdown \u7B14\u8BB0\u3002" });
      return;
    }
    const list = body.createDiv({ cls: "rd-project-list" });
    model.projectTopics.slice(0, 7).forEach((topic) => {
      const button = list.createEl("button", { cls: "rd-project-row" });
      const icon = button.createSpan({ cls: "rd-project-icon" });
      (0, import_obsidian2.setIcon)(icon, "folder");
      const copy = button.createSpan({ cls: "rd-project-copy" });
      copy.createSpan({ cls: "rd-project-name", text: topic.name });
      const meta = copy.createSpan({ cls: "rd-project-meta" });
      meta.createSpan({ text: `${topic.noteCount} \u7BC7` });
      if (topic.activeCount > 0) {
        meta.createSpan({ cls: "rd-status-chip is-active", text: `${topic.activeCount} active` });
      }
      if (topic.draftCount > 0) {
        meta.createSpan({ cls: "rd-status-chip is-draft", text: `${topic.draftCount} draft` });
      }
      button.createSpan({ cls: "rd-row-time", text: formatRelativeTime(topic.mtime) });
      button.addEventListener("click", () => void this.plugin.openFile(topic.path));
    });
  }
  renderReviewCard(body, model) {
    if (model.reviewItems.length === 0) {
      const state = body.createDiv({ cls: "rd-empty-state" });
      const icon = state.createDiv({ cls: "rd-empty-icon" });
      (0, import_obsidian2.setIcon)(icon, "circle-check");
      state.createEl("strong", { text: "\u6CA1\u6709\u663E\u5F0F\u5F85\u590D\u6838\u9879" });
      state.createEl("span", { text: "\u4F9D\u636E needs_review: true \u4E0E status: draft\u3002" });
      return;
    }
    const list = body.createDiv({ cls: "rd-review-list" });
    model.reviewItems.forEach((item) => {
      const button = list.createEl("button", { cls: "rd-review-row" });
      const copy = button.createSpan({ cls: "rd-review-copy" });
      copy.createSpan({ cls: "rd-review-title", text: item.basename });
      copy.createSpan({ cls: "rd-review-path", text: item.path });
      button.createSpan({
        cls: `rd-review-reason is-${item.reason.replace("_", "-")}`,
        text: item.reason === "needs_review" ? "\u5F85\u4EBA\u5DE5\u590D\u6838" : "\u8349\u7A3F"
      });
      button.addEventListener("click", () => void this.plugin.openFile(item.path));
    });
  }
  renderRecentCard(body, files) {
    if (files.length === 0) {
      body.createEl("p", { cls: "rd-muted", text: "\u957F\u671F\u77E5\u8BC6\u76EE\u5F55\u4E0B\u6682\u65F6\u6CA1\u6709\u7B14\u8BB0\u3002" });
      return;
    }
    const grid = body.createDiv({ cls: "rd-recent-grid" });
    files.forEach((file) => {
      const button = grid.createEl("button", { cls: "rd-recent-item" });
      const top = button.createSpan({ cls: "rd-recent-top" });
      top.createSpan({ cls: "rd-kind-chip", text: file.kind });
      top.createSpan({ cls: "rd-recent-time", text: formatRelativeTime(file.mtime) });
      button.createSpan({ cls: "rd-recent-title", text: file.basename });
      button.createSpan({
        cls: `rd-recent-summary${file.summary ? "" : " is-path"}`,
        text: file.summary || file.path
      });
      button.addEventListener("click", () => void this.plugin.openFile(file.path));
    });
  }
  renderActivityCard(body, model) {
    const intro = body.createDiv({ cls: "rd-activity-intro" });
    intro.createEl("p", {
      text: `\u8FC7\u53BB ${ACTIVITY_WEEKS} \u5468\u7684 Daily \u6587\u4EF6\u5B58\u5728\u60C5\u51B5\u3002\u5B83\u8868\u793A\u8BB0\u5F55\u8FDE\u7EED\u6027\uFF0C\u4E0D\u4EE3\u8868\u79D1\u7814\u4EA7\u51FA\u6216\u7F16\u8F91\u65F6\u957F\u3002`
    });
    const legend = intro.createDiv({ cls: "rd-activity-legend" });
    legend.createSpan({ text: "\u65E0\u8BB0\u5F55" });
    legend.createSpan({ cls: "rd-activity-cell" });
    legend.createSpan({ cls: "rd-activity-cell is-active" });
    legend.createSpan({ text: "\u6709\u8BB0\u5F55" });
    const chart = body.createDiv({
      cls: "rd-activity-chart",
      attr: { role: "img", "aria-label": `\u8FC7\u53BB ${ACTIVITY_WEEKS} \u5468\u7684 Daily \u8BB0\u5F55\u6D3B\u8DC3\u5EA6` }
    });
    const months = chart.createDiv({
      cls: "rd-activity-months",
      attr: { "aria-hidden": "true" }
    });
    Array.from({ length: ACTIVITY_WEEKS }, (_, weekIndex) => {
      const week = model.activityDays.slice(weekIndex * 7, weekIndex * 7 + 7);
      const firstOfMonth = week.find((day) => day.date.endsWith("-01"));
      const labelDate = firstOfMonth != null ? firstOfMonth : weekIndex === 0 ? week[0] : void 0;
      const month = labelDate ? Number(labelDate.date.slice(5, 7)) : null;
      months.createSpan({ text: month ? `${month}\u6708` : "" });
    });
    const labels = chart.createDiv({ cls: "rd-activity-labels" });
    ["\u4E00", "", "\u4E09", "", "\u4E94", "", "\u65E5"].forEach((label) => labels.createSpan({ text: label }));
    const cells = chart.createDiv({ cls: "rd-activity-cells" });
    model.activityDays.forEach((day) => {
      const classes = ["rd-activity-cell"];
      if (day.active) classes.push("is-active");
      if (day.future) classes.push("is-future");
      cells.createSpan({
        cls: classes.join(" "),
        attr: {
          title: `${day.date} \xB7 ${day.active ? "\u6709 Daily" : "\u65E0 Daily"}`,
          "aria-hidden": "true"
        }
      });
    });
  }
  updateSearchResults(query, showRecent) {
    if (!this.model || !this.searchResultsEl || !this.searchInput) return;
    const trimmed = query.trim();
    let matches;
    if (!trimmed && showRecent) {
      matches = [...this.model.searchFiles].sort((a, b) => b.mtime - a.mtime).slice(0, SEARCH_RESULT_LIMIT).map((file) => ({ file, score: 0 }));
    } else if (trimmed) {
      const tokens = trimmed.split(/\s+/).filter(Boolean);
      matches = this.model.searchFiles.flatMap((file) => {
        const searchable = `${file.basename} ${file.path} ${file.aliases.join(" ")}`;
        const scores = tokens.map((token) => fuzzyScore(token, searchable));
        if (scores.some((score) => score === null)) return [];
        const numericScores = scores.filter((score) => score !== null);
        return [{ file, score: numericScores.reduce((sum, score) => sum + score, 0) }];
      }).sort((a, b) => b.score - a.score || b.file.mtime - a.file.mtime).slice(0, SEARCH_RESULT_LIMIT);
    } else {
      this.hideSearchResults();
      return;
    }
    this.searchMatches = matches;
    this.activeSearchIndex = matches.length > 0 ? 0 : -1;
    this.renderSearchMatches(trimmed ? `\u641C\u7D22\u7ED3\u679C \xB7 ${matches.length}` : "\u6700\u8FD1\u4FEE\u6539\u7684\u7B14\u8BB0");
  }
  renderSearchMatches(label) {
    if (!this.searchResultsEl || !this.searchInput) return;
    const results = this.searchResultsEl;
    results.empty();
    results.hidden = false;
    this.searchInput.setAttr("aria-expanded", "true");
    results.createDiv({ cls: "rd-search-results-label", text: label });
    if (this.searchMatches.length === 0) {
      results.createDiv({ cls: "rd-search-empty", text: "\u6CA1\u6709\u5339\u914D\u7684\u7B14\u8BB0" });
      return;
    }
    this.searchMatches.forEach((match, index) => {
      const button = results.createEl("button", {
        cls: `rd-search-result${index === this.activeSearchIndex ? " is-active" : ""}`,
        attr: { role: "option", "aria-selected": index === this.activeSearchIndex ? "true" : "false" }
      });
      const icon = button.createSpan({ cls: "rd-search-result-icon" });
      (0, import_obsidian2.setIcon)(icon, "file-text");
      const copy = button.createSpan({ cls: "rd-search-result-copy" });
      copy.createSpan({ cls: "rd-search-result-title", text: match.file.basename });
      copy.createSpan({ cls: "rd-search-result-path", text: match.file.path });
      button.addEventListener("mouseenter", () => {
        this.activeSearchIndex = index;
        this.syncActiveSearchResult();
      });
      button.addEventListener("click", () => void this.openSearchMatch(index));
    });
  }
  handleSearchKeydown(event) {
    var _a;
    if (event.key === "Escape") {
      event.preventDefault();
      this.hideSearchResults();
      (_a = this.searchInput) == null ? void 0 : _a.blur();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (this.searchMatches.length === 0) return;
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      this.activeSearchIndex = (this.activeSearchIndex + direction + this.searchMatches.length) % this.searchMatches.length;
      this.syncActiveSearchResult();
      return;
    }
    if (event.key === "Enter" && this.activeSearchIndex >= 0) {
      event.preventDefault();
      void this.openSearchMatch(this.activeSearchIndex);
    }
  }
  syncActiveSearchResult() {
    if (!this.searchResultsEl) return;
    const buttons = Array.from(this.searchResultsEl.querySelectorAll(".rd-search-result"));
    buttons.forEach((button, index) => {
      const active = index === this.activeSearchIndex;
      button.toggleClass("is-active", active);
      button.setAttr("aria-selected", active ? "true" : "false");
      if (active) button.scrollIntoView({ block: "nearest" });
    });
  }
  async openSearchMatch(index) {
    const match = this.searchMatches[index];
    if (!match) return;
    this.hideSearchResults();
    await this.plugin.openFile(match.file.path);
  }
  hideSearchResults() {
    var _a;
    if (this.searchResultsEl) this.searchResultsEl.hidden = true;
    (_a = this.searchInput) == null ? void 0 : _a.setAttr("aria-expanded", "false");
    this.searchMatches = [];
    this.activeSearchIndex = -1;
  }
  basenameFromPath(path) {
    var _a, _b;
    return (_b = (_a = path.split("/").pop()) == null ? void 0 : _a.replace(/\.md$/i, "")) != null ? _b : path;
  }
};

// src/settings.ts
var import_obsidian3 = require("obsidian");
var DEFAULT_QUICK_LINKS = [
  { label: "\u77E5\u8BC6\u5E93\u5BFC\u822A", path: "08 Maps/\u77E5\u8BC6\u5E93\u5BFC\u822A.md", icon: "map" },
  { label: "\u9879\u76EE\u603B\u89C8", path: "08 Maps/\u9879\u76EE\u603B\u89C8.md", icon: "folder-kanban" },
  { label: "\u65E5\u5E38\u8BB0\u5F55", path: "08 Maps/\u65E5\u5E38\u8BB0\u5F55\u7D22\u5F15.md", icon: "calendar-days" },
  { label: "Zotero \u6587\u732E", path: "08 Maps/Zotero \u6587\u732E\u7D22\u5F15.md", icon: "library" },
  { label: "AI \u5BF9\u8BDD", path: "08 Maps/AI \u5BF9\u8BDD\u7D22\u5F15.md", icon: "messages-square" },
  {
    label: "\u8F6F\u4EF6\u624B\u518C",
    path: "Application/\u8F6F\u4EF6\u4F7F\u7528\u624B\u518C\u7D22\u5F15.md",
    icon: "wrench"
  }
];
var DEFAULT_VISIBLE_CARDS = {
  today: true,
  calendar: true,
  focus: true,
  projects: true,
  recent: true,
  review: true,
  activity: true,
  quickLinks: true
};
var SETTINGS_SCHEMA_VERSION = 3;
var LEGACY_ACTIVITY_COLOR = "#3E8B95";
var DEFAULT_CARD_COLORS = {
  today: "#4C78A8",
  calendar: "#2A9D8F",
  focus: "#D08C3F",
  projects: "#5F8D62",
  recent: "#5E78A6",
  review: "#C4677A",
  activity: "#73C6C8",
  quickLinks: "#7B6BA8"
};
var DEFAULT_SETTINGS = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  title: "\u79D1\u7814\u5DE5\u4F5C\u53F0",
  subtitle: "\u4ECA\u65E5\u5165\u53E3\u3001\u7814\u7A76\u4E3B\u9898\u4E0E\u77E5\u8BC6\u6C89\u6DC0",
  openOnStartup: false,
  openNotesInNewTab: true,
  density: "comfortable",
  dailyRoot: "01 Daily",
  dailyFolderFormat: "YYYYMM",
  dailyFileFormat: "YYYY-MM-DD",
  dailyShortcutLabel: "\u2303\u2318C",
  projectRoot: "03 Projects_Task",
  papersRoot: "04 Papers",
  literatureRoot: "06 Literature",
  applicationRoot: "Application",
  logsRoot: "07 Logs",
  mapsRoot: "08 Maps",
  recentLimit: 6,
  taskLimit: 8,
  quickLinks: DEFAULT_QUICK_LINKS,
  visibleCards: DEFAULT_VISIBLE_CARDS,
  useCardColors: true,
  cardColors: DEFAULT_CARD_COLORS
};
var CARD_LABELS = [
  ["activity", "\u8BB0\u5F55\u6D3B\u8DC3\u5EA6"],
  ["today", "\u4ECA\u65E5 Daily"],
  ["calendar", "\u6708\u5386"],
  ["focus", "\u805A\u7126\u5F85\u529E"],
  ["quickLinks", "\u5FEB\u6377\u5165\u53E3"],
  ["projects", "\u7814\u7A76\u4E3B\u9898"],
  ["review", "\u5F85\u590D\u6838"],
  ["recent", "\u6700\u8FD1\u6C89\u6DC0"]
];
function mergeSettings(loaded) {
  var _a;
  const loadedColors = loaded.cardColors;
  const cardColors = Object.keys(DEFAULT_CARD_COLORS).reduce(
    (colors, cardId) => {
      var _a2;
      const candidate = loadedColors == null ? void 0 : loadedColors[cardId];
      const normalized = typeof candidate === "string" && /^#[0-9a-f]{6}$/i.test(candidate.trim()) ? candidate.trim().toUpperCase() : null;
      colors[cardId] = cardId === "activity" && ((_a2 = loaded.schemaVersion) != null ? _a2 : 0) < SETTINGS_SCHEMA_VERSION && normalized === LEGACY_ACTIVITY_COLOR ? DEFAULT_CARD_COLORS.activity : normalized != null ? normalized : DEFAULT_CARD_COLORS[cardId];
      return colors;
    },
    {}
  );
  return {
    ...DEFAULT_SETTINGS,
    ...loaded,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    quickLinks: Array.isArray(loaded.quickLinks) ? loaded.quickLinks : DEFAULT_QUICK_LINKS,
    visibleCards: {
      ...DEFAULT_VISIBLE_CARDS,
      ...(_a = loaded.visibleCards) != null ? _a : {}
    },
    useCardColors: typeof loaded.useCardColors === "boolean" ? loaded.useCardColors : DEFAULT_SETTINGS.useCardColors,
    cardColors
  };
}
function restoreDefaultCardColors(settings) {
  return {
    ...settings,
    cardColors: { ...DEFAULT_CARD_COLORS }
  };
}
var ResearchDashboardSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Research Dashboard" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "\u8BBE\u7F6E\u53EA\u4FDD\u5B58\u5728\u63D2\u4EF6\u81EA\u5DF1\u7684 data.json \u4E2D\uFF0C\u4E0D\u4F1A\u5199\u5165\u77E5\u8BC6\u7B14\u8BB0\u3002"
    });
    new import_obsidian3.Setting(containerEl).setName("\u4EEA\u8868\u76D8\u6807\u9898").setDesc("\u663E\u793A\u5728\u9996\u9875\u9876\u90E8\u3002").addText(
      (text) => text.setValue(this.plugin.settings.title).onChange(async (value) => {
        this.plugin.settings.title = value.trim() || DEFAULT_SETTINGS.title;
        await this.persist();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u526F\u6807\u9898").setDesc("\u7528\u4E00\u53E5\u8BDD\u8BF4\u660E\u5F53\u524D\u9996\u9875\u7684\u7528\u9014\u3002").addText(
      (text) => text.setValue(this.plugin.settings.subtitle).onChange(async (value) => {
        this.plugin.settings.subtitle = value.trim();
        await this.persist();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u542F\u52A8\u65F6\u6253\u5F00").setDesc("\u9ED8\u8BA4\u5173\u95ED\uFF0C\u907F\u514D\u6253\u65AD\u73B0\u6709 workspace\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.openOnStartup).onChange(async (value) => {
        this.plugin.settings.openOnStartup = value;
        await this.persist();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u7B14\u8BB0\u5728\u65B0\u6807\u7B7E\u6253\u5F00").setDesc("\u5F00\u542F\u540E\u4FDD\u7559\u4EEA\u8868\u76D8\uFF1B\u5173\u95ED\u540E\u5728\u5F53\u524D\u6807\u7B7E\u6253\u5F00\u7B14\u8BB0\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.openNotesInNewTab).onChange(async (value) => {
        this.plugin.settings.openNotesInNewTab = value;
        await this.persist();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u5E03\u5C40\u5BC6\u5EA6").setDesc("\u7D27\u51D1\u6A21\u5F0F\u9002\u5408\u5C0F\u5C4F\u5E55\u6216\u9AD8\u4FE1\u606F\u5BC6\u5EA6\u5DE5\u4F5C\u533A\u3002").addDropdown(
      (dropdown) => dropdown.addOption("comfortable", "\u8212\u9002").addOption("compact", "\u7D27\u51D1").setValue(this.plugin.settings.density).onChange(async (value) => {
        this.plugin.settings.density = value === "compact" ? "compact" : "comfortable";
        await this.persist();
      })
    );
    containerEl.createEl("h3", { text: "\u6570\u636E\u8DEF\u5F84" });
    this.addPathSetting("Daily \u6839\u76EE\u5F55", "\u65E5\u671F\u5B50\u76EE\u5F55\u4F1A\u6309\u4E0B\u65B9\u683C\u5F0F\u62FC\u63A5\u3002", "dailyRoot");
    new import_obsidian3.Setting(containerEl).setName("Daily \u6708\u4EFD\u76EE\u5F55\u683C\u5F0F").setDesc("\u652F\u6301 YYYY\u3001MM\u3001DD\uFF1B\u5F53\u524D\u7ED3\u6784\u4F7F\u7528 YYYYMM\u3002").addText(
      (text) => text.setValue(this.plugin.settings.dailyFolderFormat).onChange(async (value) => {
        this.plugin.settings.dailyFolderFormat = value.trim() || "YYYYMM";
        await this.persist();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Daily \u6587\u4EF6\u540D\u683C\u5F0F").setDesc("\u4E0D\u542B .md\uFF1B\u5F53\u524D\u7ED3\u6784\u4F7F\u7528 YYYY-MM-DD\u3002").addText(
      (text) => text.setValue(this.plugin.settings.dailyFileFormat).onChange(async (value) => {
        this.plugin.settings.dailyFileFormat = value.trim() || "YYYY-MM-DD";
        await this.persist();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Daily \u5FEB\u6377\u952E\u63D0\u793A").setDesc("\u4ECA\u65E5\u6587\u4EF6\u7F3A\u5931\u65F6\u663E\u793A\uFF1B\u63D2\u4EF6\u4E0D\u4F1A\u81EA\u52A8\u521B\u5EFA Daily\u3002").addText(
      (text) => text.setValue(this.plugin.settings.dailyShortcutLabel).onChange(async (value) => {
        this.plugin.settings.dailyShortcutLabel = value.trim();
        await this.persist();
      })
    );
    this.addPathSetting("\u9879\u76EE\u76EE\u5F55", "\u7814\u7A76\u4E3B\u9898\u3001\u9879\u76EE\u5F85\u529E\u548C\u6700\u8FD1\u6C89\u6DC0\u7684\u6570\u636E\u6E90\u3002", "projectRoot");
    this.addPathSetting("\u8BFE\u9898\u7EC4\u6587\u7AE0\u76EE\u5F55", "\u957F\u671F\u77E5\u8BC6\u6700\u8FD1\u66F4\u65B0\u7684\u6570\u636E\u6E90\u3002", "papersRoot");
    this.addPathSetting("\u5916\u90E8\u6587\u732E\u76EE\u5F55", "\u957F\u671F\u77E5\u8BC6\u6700\u8FD1\u66F4\u65B0\u7684\u6570\u636E\u6E90\u3002", "literatureRoot");
    this.addPathSetting("\u5E94\u7528\u624B\u518C\u76EE\u5F55", "\u957F\u671F\u77E5\u8BC6\u6700\u8FD1\u66F4\u65B0\u7684\u6570\u636E\u6E90\u3002", "applicationRoot");
    this.addPathSetting("\u65E5\u5FD7\u76EE\u5F55", "\u4EC5\u7528\u4E8E\u8DEF\u5F84\u8BED\u4E49\uFF0C\u9996\u7248\u4E0D\u805A\u5408\u65E5\u5FD7\u6B63\u6587\u3002", "logsRoot");
    this.addPathSetting("Maps \u76EE\u5F55", "\u4EC5\u7528\u4E8E\u8DEF\u5F84\u8BED\u4E49\u548C\u5FEB\u6377\u5165\u53E3\u3002", "mapsRoot");
    containerEl.createEl("h3", { text: "\u5361\u7247\u4E0E\u6570\u91CF" });
    CARD_LABELS.forEach(([cardId, label]) => {
      new import_obsidian3.Setting(containerEl).setName(label).setDesc("\u663E\u793A\u6216\u9690\u85CF\u8FD9\u5F20\u9996\u9875\u5361\u7247\u3002").addToggle(
        (toggle) => toggle.setValue(this.plugin.settings.visibleCards[cardId]).onChange(async (value) => {
          this.plugin.settings.visibleCards[cardId] = value;
          await this.persist();
        })
      );
    });
    new import_obsidian3.Setting(containerEl).setName("\u6700\u8FD1\u6C89\u6DC0\u6570\u91CF").setDesc("\u663E\u793A 3\u201312 \u6761\u3002").addSlider(
      (slider) => slider.setLimits(3, 12, 1).setDynamicTooltip().setValue(this.plugin.settings.recentLimit).onChange(async (value) => {
        this.plugin.settings.recentLimit = value;
        await this.persist();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u805A\u7126\u5F85\u529E\u6570\u91CF").setDesc("\u663E\u793A 4\u201316 \u6761\uFF1B\u53EA\u8BFB\u53D6\u4ECA\u65E5\u4EFB\u52A1\u548C\u9879\u76EE\u660E\u786E\u5F85\u529E\u533A\u5757\u3002").addSlider(
      (slider) => slider.setLimits(4, 16, 1).setDynamicTooltip().setValue(this.plugin.settings.taskLimit).onChange(async (value) => {
        this.plugin.settings.taskLimit = value;
        await this.persist();
      })
    );
    containerEl.createEl("h3", { text: "\u533A\u5757\u989C\u8272" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "\u6BCF\u4E2A\u989C\u8272\u4F1A\u8F7B\u91CF\u4F5C\u7528\u4E8E\u5BF9\u5E94\u5361\u7247\u7684\u8FB9\u6846\u3001\u6807\u9898\u56FE\u6807\u4E0E\u80CC\u666F\uFF1B\u6B63\u6587\u4ECD\u4F7F\u7528\u4E3B\u9898\u6587\u5B57\u989C\u8272\u3002"
    });
    new import_obsidian3.Setting(containerEl).setName("\u542F\u7528\u533A\u5757\u914D\u8272").setDesc("\u5173\u95ED\u540E\u6240\u6709\u5361\u7247\u6062\u590D\u4E3A\u5F53\u524D Obsidian \u4E3B\u9898\u7684\u7EDF\u4E00\u6837\u5F0F\uFF0C\u5DF2\u9009\u989C\u8272\u4F1A\u4FDD\u7559\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.useCardColors).onChange(async (value) => {
        this.plugin.settings.useCardColors = value;
        await this.persist();
      })
    );
    CARD_LABELS.forEach(([cardId, label]) => {
      new import_obsidian3.Setting(containerEl).setName(label).setDesc(`\u9ED8\u8BA4 ${DEFAULT_CARD_COLORS[cardId]}`).addColorPicker(
        (picker) => picker.setValue(this.plugin.settings.cardColors[cardId]).onChange(async (value) => {
          this.plugin.settings.cardColors[cardId] = value.toUpperCase();
          await this.persist();
        })
      );
    });
    new import_obsidian3.Setting(containerEl).setName("\u6062\u590D\u9ED8\u8BA4\u8C03\u8272\u677F").setDesc("\u6062\u590D\u4E3A\u514B\u5236\u7684\u79D1\u7814\u5DE5\u4F5C\u53F0\u914D\u8272\uFF0C\u4E0D\u5F71\u54CD\u5361\u7247\u663E\u9690\u548C\u5176\u4ED6\u8BBE\u7F6E\u3002").addButton(
      (button) => button.setButtonText("\u6062\u590D\u8C03\u8272\u677F").onClick(async () => {
        this.plugin.settings = restoreDefaultCardColors(this.plugin.settings);
        await this.persist();
        new import_obsidian3.Notice("\u533A\u5757\u989C\u8272\u5DF2\u6062\u590D\u9ED8\u8BA4\u8C03\u8272\u677F");
        this.display();
      })
    );
    containerEl.createEl("h3", { text: "\u5FEB\u6377\u5165\u53E3" });
    new import_obsidian3.Setting(containerEl).setName("\u5165\u53E3\u5217\u8868").setDesc("\u6BCF\u884C\uFF1A\u540D\u79F0 | vault \u8DEF\u5F84 | Lucide \u56FE\u6807\u540D\u3002\u65E0\u6548\u6216\u542B .. \u7684\u8DEF\u5F84\u4F1A\u88AB\u5FFD\u7565\u3002").addTextArea((area) => {
      area.setValue(serializeQuickLinks(this.plugin.settings.quickLinks)).setPlaceholder("\u9879\u76EE\u603B\u89C8 | 08 Maps/\u9879\u76EE\u603B\u89C8.md | folder-kanban").onChange(async (value) => {
        this.plugin.settings.quickLinks = parseQuickLinks(value);
        await this.persist();
      });
      area.inputEl.rows = 8;
      area.inputEl.cols = 48;
    });
    new import_obsidian3.Setting(containerEl).setName("\u6062\u590D\u5168\u90E8\u9ED8\u8BA4\u8BBE\u7F6E").setDesc("\u53EA\u91CD\u7F6E\u63D2\u4EF6\u8BBE\u7F6E\uFF0C\u4E0D\u6539\u4EFB\u4F55\u7B14\u8BB0\u3002").addButton(
      (button) => button.setButtonText("\u6062\u590D\u9ED8\u8BA4").setWarning().onClick(async () => {
        this.plugin.settings = mergeSettings({});
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
        new import_obsidian3.Notice("Research Dashboard \u8BBE\u7F6E\u5DF2\u6062\u590D\u9ED8\u8BA4");
        this.display();
      })
    );
  }
  addPathSetting(name, description, key) {
    new import_obsidian3.Setting(this.containerEl).setName(name).setDesc(description).addText(
      (text) => text.setValue(this.plugin.settings[key]).onChange(async (value) => {
        if (!isSafeVaultPath(value)) return;
        this.plugin.settings[key] = sanitizeVaultPath(value);
        await this.persist();
      })
    );
  }
  async persist() {
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
  }
};

// src/main.ts
var VIEW_TYPE_RESEARCH_DASHBOARD = "research-dashboard-view";
var REFRESH_DELAY_MS = 450;
var ResearchDashboardPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.refreshTimer = null;
  }
  async onload() {
    await this.loadSettings();
    this.dataService = new DashboardDataService(this.app);
    this.registerView(
      VIEW_TYPE_RESEARCH_DASHBOARD,
      (leaf) => new ResearchDashboardView(leaf, this)
    );
    this.addRibbonIcon("layout-dashboard", "\u6253\u5F00\u79D1\u7814\u4EEA\u8868\u76D8", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-research-dashboard",
      name: "\u6253\u5F00\u79D1\u7814\u4EEA\u8868\u76D8",
      callback: () => {
        void this.activateView();
      }
    });
    this.addCommand({
      id: "refresh-research-dashboard",
      name: "\u5237\u65B0\u79D1\u7814\u4EEA\u8868\u76D8",
      callback: () => this.refreshViews(true)
    });
    this.addSettingTab(new ResearchDashboardSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openOnStartup) void this.activateView(false);
    });
  }
  onunload() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_RESEARCH_DASHBOARD);
  }
  async activateView(focus = true) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_RESEARCH_DASHBOARD)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({
        type: VIEW_TYPE_RESEARCH_DASHBOARD,
        active: true
      });
    }
    if (focus) this.app.workspace.revealLeaf(leaf);
  }
  async openFile(path, line) {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof import_obsidian4.TFile)) return false;
    const leaf = this.settings.openNotesInNewTab ? this.app.workspace.getLeaf("tab") : this.app.workspace.getLeaf(false);
    await leaf.openFile(abstractFile);
    if (typeof line === "number" && leaf.view instanceof import_obsidian4.MarkdownView) {
      const editor = leaf.view.editor;
      editor.setCursor({ line: Math.max(line, 0), ch: 0 });
      editor.scrollIntoView(
        {
          from: { line: Math.max(line - 2, 0), ch: 0 },
          to: { line: line + 2, ch: 0 }
        },
        true
      );
    }
    return true;
  }
  refreshViews(force = false) {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_RESEARCH_DASHBOARD).forEach((leaf) => {
      if (leaf.view instanceof ResearchDashboardView) {
        leaf.view.requestRefresh(force);
      }
    });
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = mergeSettings(loaded != null ? loaded : {});
  }
  scheduleRefresh() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshViews();
    }, REFRESH_DELAY_MS);
  }
};
