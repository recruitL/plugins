import { ItemView, TFile, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";
import type ResearchDashboardPlugin from "./main";
import { VIEW_TYPE_RESEARCH_DASHBOARD } from "./main";
import type {
  DashboardCardId,
  DashboardFile,
  DashboardModel,
  DashboardTask,
  SearchFile
} from "./types";
import {
  ACTIVITY_WEEKS,
  buildDailyPath,
  formatRelativeTime,
  fuzzyScore
} from "./utils";

const VIEW_REFRESH_DELAY_MS = 180;
const SEARCH_RESULT_LIMIT = 8;

interface SearchMatch {
  file: SearchFile;
  score: number;
}

export class ResearchDashboardView extends ItemView {
  private model: DashboardModel | null = null;
  private renderToken = 0;
  private refreshTimer: number | null = null;
  private dirty = false;
  private searchInput: HTMLInputElement | null = null;
  private searchResultsEl: HTMLElement | null = null;
  private searchMatches: SearchMatch[] = [];
  private activeSearchIndex = -1;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ResearchDashboardPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_RESEARCH_DASHBOARD;
  }

  getDisplayText(): string {
    return this.plugin.settings.title;
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("research-dashboard-view");
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.leaf && this.dirty) this.requestRefresh(true);
      })
    );
    this.registerDomEvent(this.containerEl.ownerDocument, "keydown", (event) => {
      if (this.app.workspace.activeLeaf !== this.leaf) return;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      this.searchInput?.focus();
    });
    await this.renderDashboard(true);
  }

  async onClose(): Promise<void> {
    this.renderToken += 1;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.searchInput = null;
    this.searchResultsEl = null;
    this.model = null;
    this.contentEl.empty();
  }

  requestRefresh(force = false): void {
    this.dirty = true;
    if (!force && this.app.workspace.activeLeaf !== this.leaf) return;

    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.renderDashboard(false);
    }, force ? 0 : VIEW_REFRESH_DELAY_MS);
  }

  private async renderDashboard(initial: boolean): Promise<void> {
    const token = ++this.renderToken;
    const previousQuery = this.searchInput?.value ?? "";
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
        this.searchInput?.focus();
        this.searchInput?.setSelectionRange(previousQuery.length, previousQuery.length);
      }
    } catch (error) {
      if (token !== this.renderToken) return;
      this.renderError(error);
    } finally {
      if (token === this.renderToken) this.contentEl.removeClass("is-refreshing");
    }
  }

  private renderLoading(): void {
    this.contentEl.empty();
    const shell = this.contentEl.createDiv({ cls: "rd-shell rd-loading-shell" });
    shell.createDiv({ cls: "rd-loading-line rd-loading-title" });
    shell.createDiv({ cls: "rd-loading-line rd-loading-search" });
    const grid = shell.createDiv({ cls: "rd-loading-grid" });
    for (let index = 0; index < 6; index += 1) {
      grid.createDiv({ cls: "rd-loading-card" });
    }
  }

  private renderError(error: unknown): void {
    this.contentEl.empty();
    const shell = this.contentEl.createDiv({ cls: "rd-shell" });
    const state = shell.createDiv({ cls: "rd-global-state" });
    const icon = state.createDiv({ cls: "rd-global-state-icon" });
    setIcon(icon, "circle-alert");
    state.createEl("h2", { text: "仪表盘暂时无法读取" });
    state.createEl("p", {
      text: error instanceof Error ? error.message : "发生了未知错误。"
    });
    const retry = state.createEl("button", { cls: "mod-cta", text: "重新加载" });
    retry.addEventListener("click", () => this.requestRefresh(true));
  }

  private renderModel(
    model: DashboardModel,
    previousQuery: string,
    reopenSearchResults: boolean
  ): void {
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
      this.renderCardSafely(grid, "activity", "activity", "记录活跃度", "rd-span-12", (body) =>
        this.renderActivityCard(body, model)
      );
    }
    if (visible.today) {
      this.renderCardSafely(grid, "today", "calendar-check", "今日 Daily", "rd-span-7", (body) =>
        this.renderTodayCard(body, model)
      );
    }
    if (visible.calendar) {
      this.renderCardSafely(grid, "calendar", "calendar-days", "本月记录", "rd-span-5", (body) =>
        this.renderCalendarCard(body, model)
      );
    }
    if (visible.focus) {
      this.renderCardSafely(grid, "focus", "list-checks", "聚焦待办", "rd-span-7", (body) =>
        this.renderFocusCard(body, model.focusTasks)
      );
    }
    if (visible.quickLinks) {
      this.renderCardSafely(grid, "quickLinks", "blocks", "快捷入口", "rd-span-5", (body) =>
        this.renderQuickLinks(body)
      );
    }
    if (visible.projects) {
      this.renderCardSafely(grid, "projects", "folder-kanban", "研究主题", "rd-span-7", (body) =>
        this.renderProjectsCard(body, model)
      );
    }
    if (visible.review) {
      this.renderCardSafely(grid, "review", "scan-search", "待复核", "rd-span-5", (body) =>
        this.renderReviewCard(body, model)
      );
    }
    if (visible.recent) {
      this.renderCardSafely(grid, "recent", "history", "最近沉淀", "rd-span-12", (body) =>
        this.renderRecentCard(body, model.recentFiles)
      );
    }
    const footer = shell.createEl("footer", { cls: "rd-footer" });
    footer.createSpan({ text: "LOCAL ONLY" });
    footer.createSpan({ text: "不依赖 Dataview · 不修改笔记" });
    footer.createSpan({ text: `更新于 ${new Date(model.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` });
  }

  private renderHero(
    container: HTMLElement,
    model: DashboardModel,
    previousQuery: string,
    reopenSearchResults: boolean
  ): void {
    const hero = container.createEl("header", { cls: "rd-hero" });
    const top = hero.createDiv({ cls: "rd-hero-top" });
    const identity = top.createDiv({ cls: "rd-identity" });
    identity.createDiv({ cls: "rd-eyebrow", text: "LOCAL RESEARCH HOME" });
    identity.createEl("h1", { text: this.plugin.settings.title });
    if (this.plugin.settings.subtitle) {
      identity.createEl("p", { text: this.plugin.settings.subtitle });
    }

    const dateArea = top.createDiv({ cls: "rd-date-area" });
    const now = new Date();
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
      attr: { "aria-label": "刷新仪表盘", title: "刷新仪表盘" }
    });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => this.requestRefresh(true));

    const search = hero.createDiv({ cls: "rd-search" });
    const searchIcon = search.createDiv({ cls: "rd-search-icon" });
    setIcon(searchIcon, "search");
    const input = search.createEl("input", {
      cls: "rd-search-input",
      attr: {
        type: "search",
        placeholder: "搜索文件名、路径或 alias…",
        "aria-label": "搜索 vault 笔记",
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
      attr: { role: "listbox", "aria-label": "搜索结果" }
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

  private renderStats(container: HTMLElement, model: DashboardModel): void {
    const stats = container.createEl("dl", { cls: "rd-stats" });
    const entries: Array<[string, string, string]> = [
      [String(model.stats.notes), "全部笔记", "file-text"],
      [String(model.stats.stableNotes), "长期知识", "archive"],
      [String(model.stats.projectTopics), "研究主题", "folder-kanban"],
      [`${model.stats.dailyStreak} 天`, "Daily 连续", "flame"]
    ];

    entries.forEach(([value, label, iconName]) => {
      const stat = stats.createDiv({ cls: "rd-stat" });
      const icon = stat.createDiv({ cls: "rd-stat-icon" });
      setIcon(icon, iconName);
      const copy = stat.createDiv();
      copy.createEl("dd", { text: value });
      copy.createEl("dt", { text: label });
    });
  }

  private renderCardSafely(
    grid: HTMLElement,
    id: DashboardCardId,
    iconName: string,
    title: string,
    spanClass: string,
    renderBody: (body: HTMLElement) => void
  ): void {
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
    setIcon(icon, iconName);
    titleGroup.createEl("h2", { text: title, attr: { id: `rd-card-${id}` } });
    const body = card.createDiv({ cls: "rd-card-body" });

    try {
      renderBody(body);
    } catch (error) {
      body.empty();
      const state = body.createDiv({ cls: "rd-empty-state is-error" });
      state.createEl("strong", { text: "这张卡片暂时无法显示" });
      state.createEl("span", {
        text: error instanceof Error ? error.message : "未知错误"
      });
    }
  }

  private renderTodayCard(body: HTMLElement, model: DashboardModel): void {
    const daily = model.daily;
    if (!daily.exists) {
      const state = body.createDiv({ cls: "rd-empty-state rd-today-missing" });
      const icon = state.createDiv({ cls: "rd-empty-icon" });
      setIcon(icon, "file-clock");
      state.createEl("strong", { text: "今日 Daily 尚未创建" });
      state.createEl("span", { text: daily.path });
      const hint = state.createDiv({ cls: "rd-shortcut-hint" });
      hint.createSpan({ text: "使用现有 QuickAdd 快捷键" });
      if (this.plugin.settings.dailyShortcutLabel) {
        hint.createEl("kbd", { text: this.plugin.settings.dailyShortcutLabel });
      }
      return;
    }

    const openButton = body.createEl("button", { cls: "rd-inline-action" });
    const openIcon = openButton.createSpan({ cls: "rd-inline-action-icon" });
    setIcon(openIcon, "arrow-up-right");
    openButton.createSpan({ text: "打开今日日记" });
    openButton.addEventListener("click", () => void this.plugin.openFile(daily.path));

    if (daily.workSummary.length > 0) {
      const summary = body.createEl("ul", { cls: "rd-summary-list" });
      daily.workSummary.slice(0, 4).forEach((item) => summary.createEl("li", { text: item }));
    } else {
      body.createEl("p", { cls: "rd-muted", text: "work_summary 目前为空。" });
    }

    const taskLabel = body.createDiv({ cls: "rd-section-label" });
    taskLabel.createSpan({ text: "今日任务" });
    taskLabel.createSpan({ text: String(daily.tasks.length) });
    if (daily.tasks.length === 0) {
      body.createEl("p", { cls: "rd-muted", text: "没有非空的未完成任务。" });
    } else {
      const list = body.createDiv({ cls: "rd-mini-task-list" });
      daily.tasks.slice(0, 3).forEach((task) => this.renderTaskRow(list, task, false));
    }
  }

  private renderCalendarCard(body: HTMLElement, model: DashboardModel): void {
    const now = new Date();
    const heading = body.createDiv({ cls: "rd-calendar-heading" });
    heading.createEl("strong", {
      text: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(now)
    });
    heading.createSpan({ text: "圆点表示存在 Daily" });

    const calendar = body.createDiv({ cls: "rd-calendar" });
    ["一", "二", "三", "四", "五", "六", "日"].forEach((day) =>
      calendar.createDiv({ cls: "rd-calendar-weekday", text: day })
    );

    model.calendarDays.forEach((day) => {
      const classNames = ["rd-calendar-day"];
      if (!day.inMonth) classNames.push("is-outside");
      if (day.isToday) classNames.push("is-today");
      if (day.hasDaily) classNames.push("has-daily");

      const cell = calendar.createEl(day.hasDaily ? "button" : "div", {
        cls: classNames.join(" "),
        attr: {
          "aria-label": `${day.date}${day.hasDaily ? "，有 Daily" : "，无 Daily"}`,
          title: day.date
        }
      });
      cell.createSpan({ text: String(day.day) });
      if (day.hasDaily) cell.createSpan({ cls: "rd-calendar-dot" });

      if (day.hasDaily && cell instanceof HTMLButtonElement) {
        cell.addEventListener("click", () => {
          const [year, month, date] = day.date.split("-").map(Number);
          const path = normalizePath(
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

  private renderFocusCard(body: HTMLElement, tasks: DashboardTask[]): void {
    if (tasks.length === 0) {
      const state = body.createDiv({ cls: "rd-empty-state" });
      state.createEl("strong", { text: "目前没有聚焦待办" });
      state.createEl("span", { text: "这里只收录今日任务和项目中明确的待办区块。" });
      return;
    }

    const list = body.createDiv({ cls: "rd-task-list" });
    tasks.forEach((task) => this.renderTaskRow(list, task, true));
  }

  private renderTaskRow(container: HTMLElement, task: DashboardTask, showSource: boolean): void {
    const button = container.createEl("button", { cls: "rd-task-row" });
    const check = button.createSpan({ cls: "rd-task-check" });
    setIcon(check, "square");
    const copy = button.createSpan({ cls: "rd-task-copy" });
    copy.createSpan({ cls: "rd-task-text", text: task.text });
    const meta = copy.createSpan({ cls: "rd-task-meta" });
    if (showSource) {
      meta.createSpan({
        cls: `rd-source-chip is-${task.source}`,
        text: task.source === "today" ? "今日" : "项目"
      });
    }
    meta.createSpan({ text: this.basenameFromPath(task.path) });
    button.addEventListener("click", () => void this.plugin.openFile(task.path, task.line));
  }

  private renderQuickLinks(body: HTMLElement): void {
    if (this.plugin.settings.quickLinks.length === 0) {
      body.createEl("p", { cls: "rd-muted", text: "可在插件设置中添加正式入口。" });
      return;
    }

    const links = body.createDiv({ cls: "rd-quick-links" });
    this.plugin.settings.quickLinks.forEach((link) => {
      const exists = this.app.vault.getAbstractFileByPath(normalizePath(link.path)) instanceof TFile;
      const button = links.createEl("button", {
        cls: `rd-quick-link${exists ? "" : " is-missing"}`,
        attr: {
          title: exists ? link.path : `未找到：${link.path}`,
          "aria-label": `${link.label}${exists ? "" : "，文件不存在"}`
        }
      });
      button.disabled = !exists;
      const icon = button.createSpan({ cls: "rd-quick-link-icon" });
      setIcon(icon, link.icon || "file-text");
      button.createSpan({ cls: "rd-quick-link-label", text: link.label });
      button.addEventListener("click", () => void this.plugin.openFile(link.path));
    });
  }

  private renderProjectsCard(body: HTMLElement, model: DashboardModel): void {
    if (model.projectTopics.length === 0) {
      body.createEl("p", { cls: "rd-muted", text: "项目目录下暂时没有 Markdown 笔记。" });
      return;
    }

    const list = body.createDiv({ cls: "rd-project-list" });
    model.projectTopics.slice(0, 7).forEach((topic) => {
      const button = list.createEl("button", { cls: "rd-project-row" });
      const icon = button.createSpan({ cls: "rd-project-icon" });
      setIcon(icon, "folder");
      const copy = button.createSpan({ cls: "rd-project-copy" });
      copy.createSpan({ cls: "rd-project-name", text: topic.name });
      const meta = copy.createSpan({ cls: "rd-project-meta" });
      meta.createSpan({ text: `${topic.noteCount} 篇` });
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

  private renderReviewCard(body: HTMLElement, model: DashboardModel): void {
    if (model.reviewItems.length === 0) {
      const state = body.createDiv({ cls: "rd-empty-state" });
      const icon = state.createDiv({ cls: "rd-empty-icon" });
      setIcon(icon, "circle-check");
      state.createEl("strong", { text: "没有显式待复核项" });
      state.createEl("span", { text: "依据 needs_review: true 与 status: draft。" });
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
        text: item.reason === "needs_review" ? "待人工复核" : "草稿"
      });
      button.addEventListener("click", () => void this.plugin.openFile(item.path));
    });
  }

  private renderRecentCard(body: HTMLElement, files: DashboardFile[]): void {
    if (files.length === 0) {
      body.createEl("p", { cls: "rd-muted", text: "长期知识目录下暂时没有笔记。" });
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

  private renderActivityCard(body: HTMLElement, model: DashboardModel): void {
    const intro = body.createDiv({ cls: "rd-activity-intro" });
    intro.createEl("p", {
      text: `过去 ${ACTIVITY_WEEKS} 周的 Daily 文件存在情况。它表示记录连续性，不代表科研产出或编辑时长。`
    });
    const legend = intro.createDiv({ cls: "rd-activity-legend" });
    legend.createSpan({ text: "无记录" });
    legend.createSpan({ cls: "rd-activity-cell" });
    legend.createSpan({ cls: "rd-activity-cell is-active" });
    legend.createSpan({ text: "有记录" });

    const chart = body.createDiv({
      cls: "rd-activity-chart",
      attr: { role: "img", "aria-label": `过去 ${ACTIVITY_WEEKS} 周的 Daily 记录活跃度` }
    });
    const months = chart.createDiv({
      cls: "rd-activity-months",
      attr: { "aria-hidden": "true" }
    });
    Array.from({ length: ACTIVITY_WEEKS }, (_, weekIndex) => {
      const week = model.activityDays.slice(weekIndex * 7, weekIndex * 7 + 7);
      const firstOfMonth = week.find((day) => day.date.endsWith("-01"));
      const labelDate = firstOfMonth ?? (weekIndex === 0 ? week[0] : undefined);
      const month = labelDate ? Number(labelDate.date.slice(5, 7)) : null;
      months.createSpan({ text: month ? `${month}月` : "" });
    });
    const labels = chart.createDiv({ cls: "rd-activity-labels" });
    ["一", "", "三", "", "五", "", "日"].forEach((label) => labels.createSpan({ text: label }));
    const cells = chart.createDiv({ cls: "rd-activity-cells" });
    model.activityDays.forEach((day) => {
      const classes = ["rd-activity-cell"];
      if (day.active) classes.push("is-active");
      if (day.future) classes.push("is-future");
      cells.createSpan({
        cls: classes.join(" "),
        attr: {
          title: `${day.date} · ${day.active ? "有 Daily" : "无 Daily"}`,
          "aria-hidden": "true"
        }
      });
    });
  }

  private updateSearchResults(query: string, showRecent: boolean): void {
    if (!this.model || !this.searchResultsEl || !this.searchInput) return;
    const trimmed = query.trim();
    let matches: SearchMatch[];

    if (!trimmed && showRecent) {
      matches = [...this.model.searchFiles]
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, SEARCH_RESULT_LIMIT)
        .map((file) => ({ file, score: 0 }));
    } else if (trimmed) {
      const tokens = trimmed.split(/\s+/).filter(Boolean);
      matches = this.model.searchFiles
        .flatMap((file): SearchMatch[] => {
          const searchable = `${file.basename} ${file.path} ${file.aliases.join(" ")}`;
          const scores = tokens.map((token) => fuzzyScore(token, searchable));
          if (scores.some((score) => score === null)) return [];
          const numericScores = scores.filter((score): score is number => score !== null);
          return [{ file, score: numericScores.reduce((sum, score) => sum + score, 0) }];
        })
        .sort((a, b) => b.score - a.score || b.file.mtime - a.file.mtime)
        .slice(0, SEARCH_RESULT_LIMIT);
    } else {
      this.hideSearchResults();
      return;
    }

    this.searchMatches = matches;
    this.activeSearchIndex = matches.length > 0 ? 0 : -1;
    this.renderSearchMatches(trimmed ? `搜索结果 · ${matches.length}` : "最近修改的笔记");
  }

  private renderSearchMatches(label: string): void {
    if (!this.searchResultsEl || !this.searchInput) return;
    const results = this.searchResultsEl;
    results.empty();
    results.hidden = false;
    this.searchInput.setAttr("aria-expanded", "true");
    results.createDiv({ cls: "rd-search-results-label", text: label });

    if (this.searchMatches.length === 0) {
      results.createDiv({ cls: "rd-search-empty", text: "没有匹配的笔记" });
      return;
    }

    this.searchMatches.forEach((match, index) => {
      const button = results.createEl("button", {
        cls: `rd-search-result${index === this.activeSearchIndex ? " is-active" : ""}`,
        attr: { role: "option", "aria-selected": index === this.activeSearchIndex ? "true" : "false" }
      });
      const icon = button.createSpan({ cls: "rd-search-result-icon" });
      setIcon(icon, "file-text");
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

  private handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.hideSearchResults();
      this.searchInput?.blur();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (this.searchMatches.length === 0) return;
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      this.activeSearchIndex =
        (this.activeSearchIndex + direction + this.searchMatches.length) % this.searchMatches.length;
      this.syncActiveSearchResult();
      return;
    }

    if (event.key === "Enter" && this.activeSearchIndex >= 0) {
      event.preventDefault();
      void this.openSearchMatch(this.activeSearchIndex);
    }
  }

  private syncActiveSearchResult(): void {
    if (!this.searchResultsEl) return;
    const buttons = Array.from(this.searchResultsEl.querySelectorAll<HTMLButtonElement>(".rd-search-result"));
    buttons.forEach((button, index) => {
      const active = index === this.activeSearchIndex;
      button.toggleClass("is-active", active);
      button.setAttr("aria-selected", active ? "true" : "false");
      if (active) button.scrollIntoView({ block: "nearest" });
    });
  }

  private async openSearchMatch(index: number): Promise<void> {
    const match = this.searchMatches[index];
    if (!match) return;
    this.hideSearchResults();
    await this.plugin.openFile(match.file.path);
  }

  private hideSearchResults(): void {
    if (this.searchResultsEl) this.searchResultsEl.hidden = true;
    this.searchInput?.setAttr("aria-expanded", "false");
    this.searchMatches = [];
    this.activeSearchIndex = -1;
  }

  private basenameFromPath(path: string): string {
    return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
  }
}
