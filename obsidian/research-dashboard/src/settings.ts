import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ResearchDashboardPlugin from "./main";
import type {
  DashboardCardId,
  QuickLinkSetting,
  ResearchDashboardSettings
} from "./types";
import {
  isSafeVaultPath,
  parseQuickLinks,
  sanitizeVaultPath,
  serializeQuickLinks
} from "./utils";

export const DEFAULT_QUICK_LINKS: QuickLinkSetting[] = [
  { label: "知识库导航", path: "08 Maps/知识库导航.md", icon: "map" },
  { label: "项目总览", path: "08 Maps/项目总览.md", icon: "folder-kanban" },
  { label: "日常记录", path: "08 Maps/日常记录索引.md", icon: "calendar-days" },
  { label: "Zotero 文献", path: "08 Maps/Zotero 文献索引.md", icon: "library" },
  { label: "AI 对话", path: "08 Maps/AI 对话索引.md", icon: "messages-square" },
  {
    label: "软件手册",
    path: "Application/软件使用手册索引.md",
    icon: "wrench"
  }
];

const DEFAULT_VISIBLE_CARDS: Record<DashboardCardId, boolean> = {
  today: true,
  calendar: true,
  focus: true,
  projects: true,
  recent: true,
  review: true,
  activity: true,
  quickLinks: true
};

const SETTINGS_SCHEMA_VERSION = 3;
const LEGACY_ACTIVITY_COLOR = "#3E8B95";

export const DEFAULT_CARD_COLORS: Record<DashboardCardId, string> = {
  today: "#4C78A8",
  calendar: "#2A9D8F",
  focus: "#D08C3F",
  projects: "#5F8D62",
  recent: "#5E78A6",
  review: "#C4677A",
  activity: "#73C6C8",
  quickLinks: "#7B6BA8"
};

export const DEFAULT_SETTINGS: ResearchDashboardSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  title: "科研工作台",
  subtitle: "今日入口、研究主题与知识沉淀",
  openOnStartup: false,
  openNotesInNewTab: true,
  density: "comfortable",
  dailyRoot: "01 Daily",
  dailyFolderFormat: "YYYYMM",
  dailyFileFormat: "YYYY-MM-DD",
  dailyShortcutLabel: "⌃⌘C",
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

const CARD_LABELS: Array<[DashboardCardId, string]> = [
  ["activity", "记录活跃度"],
  ["today", "今日 Daily"],
  ["calendar", "月历"],
  ["focus", "聚焦待办"],
  ["quickLinks", "快捷入口"],
  ["projects", "研究主题"],
  ["review", "待复核"],
  ["recent", "最近沉淀"]
];

export function mergeSettings(loaded: Partial<ResearchDashboardSettings>): ResearchDashboardSettings {
  const loadedColors = loaded.cardColors as
    | Partial<Record<DashboardCardId, string>>
    | undefined;
  const cardColors = (Object.keys(DEFAULT_CARD_COLORS) as DashboardCardId[]).reduce(
    (colors, cardId) => {
      const candidate = loadedColors?.[cardId];
      const normalized =
        typeof candidate === "string" && /^#[0-9a-f]{6}$/i.test(candidate.trim())
          ? candidate.trim().toUpperCase()
          : null;
      colors[cardId] =
        cardId === "activity" &&
        (loaded.schemaVersion ?? 0) < SETTINGS_SCHEMA_VERSION &&
        normalized === LEGACY_ACTIVITY_COLOR
          ? DEFAULT_CARD_COLORS.activity
          : normalized ?? DEFAULT_CARD_COLORS[cardId];
      return colors;
    },
    {} as Record<DashboardCardId, string>
  );

  return {
    ...DEFAULT_SETTINGS,
    ...loaded,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    quickLinks: Array.isArray(loaded.quickLinks) ? loaded.quickLinks : DEFAULT_QUICK_LINKS,
    visibleCards: {
      ...DEFAULT_VISIBLE_CARDS,
      ...(loaded.visibleCards ?? {})
    },
    useCardColors:
      typeof loaded.useCardColors === "boolean"
        ? loaded.useCardColors
        : DEFAULT_SETTINGS.useCardColors,
    cardColors
  };
}

export function restoreDefaultCardColors(
  settings: ResearchDashboardSettings
): ResearchDashboardSettings {
  return {
    ...settings,
    cardColors: { ...DEFAULT_CARD_COLORS }
  };
}

export class ResearchDashboardSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ResearchDashboardPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Research Dashboard" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "设置只保存在插件自己的 data.json 中，不会写入知识笔记。"
    });

    new Setting(containerEl)
      .setName("仪表盘标题")
      .setDesc("显示在首页顶部。")
      .addText((text) =>
        text.setValue(this.plugin.settings.title).onChange(async (value) => {
          this.plugin.settings.title = value.trim() || DEFAULT_SETTINGS.title;
          await this.persist();
        })
      );

    new Setting(containerEl)
      .setName("副标题")
      .setDesc("用一句话说明当前首页的用途。")
      .addText((text) =>
        text.setValue(this.plugin.settings.subtitle).onChange(async (value) => {
          this.plugin.settings.subtitle = value.trim();
          await this.persist();
        })
      );

    new Setting(containerEl)
      .setName("启动时打开")
      .setDesc("默认关闭，避免打断现有 workspace。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openOnStartup).onChange(async (value) => {
          this.plugin.settings.openOnStartup = value;
          await this.persist();
        })
      );

    new Setting(containerEl)
      .setName("笔记在新标签打开")
      .setDesc("开启后保留仪表盘；关闭后在当前标签打开笔记。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openNotesInNewTab).onChange(async (value) => {
          this.plugin.settings.openNotesInNewTab = value;
          await this.persist();
        })
      );

    new Setting(containerEl)
      .setName("布局密度")
      .setDesc("紧凑模式适合小屏幕或高信息密度工作区。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("comfortable", "舒适")
          .addOption("compact", "紧凑")
          .setValue(this.plugin.settings.density)
          .onChange(async (value) => {
            this.plugin.settings.density = value === "compact" ? "compact" : "comfortable";
            await this.persist();
          })
      );

    containerEl.createEl("h3", { text: "数据路径" });
    this.addPathSetting("Daily 根目录", "日期子目录会按下方格式拼接。", "dailyRoot");

    new Setting(containerEl)
      .setName("Daily 月份目录格式")
      .setDesc("支持 YYYY、MM、DD；当前结构使用 YYYYMM。")
      .addText((text) =>
        text.setValue(this.plugin.settings.dailyFolderFormat).onChange(async (value) => {
          this.plugin.settings.dailyFolderFormat = value.trim() || "YYYYMM";
          await this.persist();
        })
      );

    new Setting(containerEl)
      .setName("Daily 文件名格式")
      .setDesc("不含 .md；当前结构使用 YYYY-MM-DD。")
      .addText((text) =>
        text.setValue(this.plugin.settings.dailyFileFormat).onChange(async (value) => {
          this.plugin.settings.dailyFileFormat = value.trim() || "YYYY-MM-DD";
          await this.persist();
        })
      );

    new Setting(containerEl)
      .setName("Daily 快捷键提示")
      .setDesc("今日文件缺失时显示；插件不会自动创建 Daily。")
      .addText((text) =>
        text.setValue(this.plugin.settings.dailyShortcutLabel).onChange(async (value) => {
          this.plugin.settings.dailyShortcutLabel = value.trim();
          await this.persist();
        })
      );

    this.addPathSetting("项目目录", "研究主题、项目待办和最近沉淀的数据源。", "projectRoot");
    this.addPathSetting("课题组文章目录", "长期知识最近更新的数据源。", "papersRoot");
    this.addPathSetting("外部文献目录", "长期知识最近更新的数据源。", "literatureRoot");
    this.addPathSetting("应用手册目录", "长期知识最近更新的数据源。", "applicationRoot");
    this.addPathSetting("日志目录", "仅用于路径语义，首版不聚合日志正文。", "logsRoot");
    this.addPathSetting("Maps 目录", "仅用于路径语义和快捷入口。", "mapsRoot");

    containerEl.createEl("h3", { text: "卡片与数量" });
    CARD_LABELS.forEach(([cardId, label]) => {
      new Setting(containerEl)
        .setName(label)
        .setDesc("显示或隐藏这张首页卡片。")
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.visibleCards[cardId]).onChange(async (value) => {
            this.plugin.settings.visibleCards[cardId] = value;
            await this.persist();
          })
        );
    });

    new Setting(containerEl)
      .setName("最近沉淀数量")
      .setDesc("显示 3–12 条。")
      .addSlider((slider) =>
        slider
          .setLimits(3, 12, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.recentLimit)
          .onChange(async (value) => {
            this.plugin.settings.recentLimit = value;
            await this.persist();
          })
      );

    new Setting(containerEl)
      .setName("聚焦待办数量")
      .setDesc("显示 4–16 条；只读取今日任务和项目明确待办区块。")
      .addSlider((slider) =>
        slider
          .setLimits(4, 16, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.taskLimit)
          .onChange(async (value) => {
            this.plugin.settings.taskLimit = value;
            await this.persist();
          })
      );

    containerEl.createEl("h3", { text: "区块颜色" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "每个颜色会轻量作用于对应卡片的边框、标题图标与背景；正文仍使用主题文字颜色。"
    });

    new Setting(containerEl)
      .setName("启用区块配色")
      .setDesc("关闭后所有卡片恢复为当前 Obsidian 主题的统一样式，已选颜色会保留。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useCardColors).onChange(async (value) => {
          this.plugin.settings.useCardColors = value;
          await this.persist();
        })
      );

    CARD_LABELS.forEach(([cardId, label]) => {
      new Setting(containerEl)
        .setName(label)
        .setDesc(`默认 ${DEFAULT_CARD_COLORS[cardId]}`)
        .addColorPicker((picker) =>
          picker.setValue(this.plugin.settings.cardColors[cardId]).onChange(async (value) => {
            this.plugin.settings.cardColors[cardId] = value.toUpperCase();
            await this.persist();
          })
        );
    });

    new Setting(containerEl)
      .setName("恢复默认调色板")
      .setDesc("恢复为克制的科研工作台配色，不影响卡片显隐和其他设置。")
      .addButton((button) =>
        button.setButtonText("恢复调色板").onClick(async () => {
          this.plugin.settings = restoreDefaultCardColors(this.plugin.settings);
          await this.persist();
          new Notice("区块颜色已恢复默认调色板");
          this.display();
        })
      );

    containerEl.createEl("h3", { text: "快捷入口" });
    new Setting(containerEl)
      .setName("入口列表")
      .setDesc("每行：名称 | vault 路径 | Lucide 图标名。无效或含 .. 的路径会被忽略。")
      .addTextArea((area) => {
        area
          .setValue(serializeQuickLinks(this.plugin.settings.quickLinks))
          .setPlaceholder("项目总览 | 08 Maps/项目总览.md | folder-kanban")
          .onChange(async (value) => {
            this.plugin.settings.quickLinks = parseQuickLinks(value);
            await this.persist();
          });
        area.inputEl.rows = 8;
        area.inputEl.cols = 48;
      });

    new Setting(containerEl)
      .setName("恢复全部默认设置")
      .setDesc("只重置插件设置，不改任何笔记。")
      .addButton((button) =>
        button.setButtonText("恢复默认").setWarning().onClick(async () => {
          this.plugin.settings = mergeSettings({});
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          new Notice("Research Dashboard 设置已恢复默认");
          this.display();
        })
      );
  }

  private addPathSetting(
    name: string,
    description: string,
    key:
      | "dailyRoot"
      | "projectRoot"
      | "papersRoot"
      | "literatureRoot"
      | "applicationRoot"
      | "logsRoot"
      | "mapsRoot"
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) =>
        text.setValue(this.plugin.settings[key]).onChange(async (value) => {
          if (!isSafeVaultPath(value)) return;
          this.plugin.settings[key] = sanitizeVaultPath(value);
          await this.persist();
        })
      );
  }

  private async persist(): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
  }
}
