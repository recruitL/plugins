import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DashboardDataService } from "./dashboard-data";
import { ResearchDashboardView } from "./dashboard-view";
import {
  ResearchDashboardSettingTab,
  mergeSettings
} from "./settings";
import type { ResearchDashboardSettings } from "./types";

export const VIEW_TYPE_RESEARCH_DASHBOARD = "research-dashboard-view";
const REFRESH_DELAY_MS = 450;

export default class ResearchDashboardPlugin extends Plugin {
  settings!: ResearchDashboardSettings;
  dataService!: DashboardDataService;
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.dataService = new DashboardDataService(this.app);

    this.registerView(
      VIEW_TYPE_RESEARCH_DASHBOARD,
      (leaf) => new ResearchDashboardView(leaf, this)
    );

    this.addRibbonIcon("layout-dashboard", "打开科研仪表盘", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-research-dashboard",
      name: "打开科研仪表盘",
      callback: () => {
        void this.activateView();
      }
    });

    this.addCommand({
      id: "refresh-research-dashboard",
      name: "刷新科研仪表盘",
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

  onunload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_RESEARCH_DASHBOARD);
  }

  async activateView(focus = true): Promise<void> {
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

  async openFile(path: string, line?: number): Promise<boolean> {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof TFile)) return false;

    const leaf: WorkspaceLeaf = this.settings.openNotesInNewTab
      ? this.app.workspace.getLeaf("tab")
      : this.app.workspace.getLeaf(false);
    await leaf.openFile(abstractFile);

    if (typeof line === "number" && leaf.view instanceof MarkdownView) {
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

  refreshViews(force = false): void {
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_RESEARCH_DASHBOARD)
      .forEach((leaf) => {
        if (leaf.view instanceof ResearchDashboardView) {
          leaf.view.requestRefresh(force);
        }
      });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<ResearchDashboardSettings> | null;
    this.settings = mergeSettings(loaded ?? {});
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshViews();
    }, REFRESH_DELAY_MS);
  }
}
