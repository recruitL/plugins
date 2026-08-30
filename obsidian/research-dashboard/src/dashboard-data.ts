import { App, TFile, normalizePath } from "obsidian";
import type {
  DashboardFile,
  DashboardModel,
  DashboardTask,
  DailySnapshot,
  ProjectTopic,
  ResearchDashboardSettings,
  ReviewItem,
  SearchFile
} from "./types";
import {
  ACTIVITY_WEEKS,
  buildActivityDays,
  buildCalendarDays,
  buildDailyPath,
  calculateDailyStreak,
  formatIsoDate,
  getDailyDateFromPath,
  isPathInside,
  normalizeStringArray,
  parseMarkdownTasks,
  stripWikiLink
} from "./utils";

const PROJECT_TASK_SECTION = /待办|后续动作|后续待办|后续精读任务|下一步/i;
const EXCLUDED_TASK_SECTION = /验收|检查清单|复核清单/i;
const TODAY_TASK_SECTION = /今日任务/i;
const REVIEW_LIMIT = 6;
const PROJECT_TASK_FILE_LIMIT = 30;
const PROJECT_TASKS_PER_FILE = 3;

interface FrontmatterRecord {
  [key: string]: unknown;
}

interface TopicAccumulator {
  name: string;
  files: TFile[];
}

export class DashboardDataService {
  constructor(private readonly app: App) {}

  async build(settings: ResearchDashboardSettings): Promise<DashboardModel> {
    const now = new Date();
    const today = formatIsoDate(now);
    const files = this.app.vault.getMarkdownFiles();
    const dailyPath = normalizePath(
      buildDailyPath(
        now,
        settings.dailyRoot,
        settings.dailyFolderFormat,
        settings.dailyFileFormat
      )
    );

    const dailyDates = new Set(
      files
        .filter((file) => isPathInside(file.path, settings.dailyRoot))
        .map((file) => getDailyDateFromPath(file.path))
        .filter((date): date is string => Boolean(date))
    );

    const searchFiles = this.buildSearchFiles(files);
    const projectFiles = files.filter((file) => isPathInside(file.path, settings.projectRoot));
    const stableFiles = files.filter((file) => this.isStableKnowledgeFile(file, settings));
    const daily = await this.buildDailySnapshot(dailyPath);
    const projectTasks = await this.buildProjectTasks(projectFiles);
    const focusTasks = [...daily.tasks, ...projectTasks]
      .sort((a, b) => {
        if (a.source !== b.source) return a.source === "today" ? -1 : 1;
        return b.mtime - a.mtime || a.line - b.line;
      })
      .slice(0, settings.taskLimit);
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

  private buildSearchFiles(files: TFile[]): SearchFile[] {
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

  private async buildDailySnapshot(path: string): Promise<DailySnapshot> {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof TFile)) {
      return { path, exists: false, workSummary: [], tasks: [] };
    }

    const frontmatter = this.getFrontmatter(abstractFile);
    const content = await this.app.vault.cachedRead(abstractFile);
    const tasks = parseMarkdownTasks(content, { includeSections: TODAY_TASK_SECTION }).map(
      (task): DashboardTask => ({
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

  private async buildProjectTasks(files: TFile[]): Promise<DashboardTask[]> {
    const candidates = files
      .filter((file) => {
        const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
        return headings.some((heading) => PROJECT_TASK_SECTION.test(heading.heading));
      })
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, PROJECT_TASK_FILE_LIMIT);

    const taskGroups = await Promise.all(
      candidates.map(async (file) => {
        const content = await this.app.vault.cachedRead(file);
        return parseMarkdownTasks(content, {
          includeSections: PROJECT_TASK_SECTION,
          excludeSections: EXCLUDED_TASK_SECTION
        }).map(
          (task): DashboardTask => ({
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

  private buildProjectTopics(files: TFile[], projectRoot: string): ProjectTopic[] {
    const root = normalizePath(projectRoot).replace(/\/$/, "");
    const groups = new Map<string, TopicAccumulator>();

    files.forEach((file) => {
      const relativePath = file.path.slice(root.length).replace(/^\//, "");
      const firstSegment = relativePath.split("/")[0];
      const name = relativePath.includes("/") ? firstSegment : file.basename;
      const group = groups.get(name) ?? { name, files: [] };
      group.files.push(file);
      groups.set(name, group);
    });

    return Array.from(groups.values())
      .map((group) => {
        const preferred = [...group.files].sort((a, b) => {
          const aType = String(this.getFrontmatter(a).type ?? "").toLowerCase();
          const bType = String(this.getFrontmatter(b).type ?? "").toLowerCase();
          const aRank = aType === "project" || aType === "project_overview" ? 1 : 0;
          const bRank = bType === "project" || bType === "project_overview" ? 1 : 0;
          return bRank - aRank || b.stat.mtime - a.stat.mtime;
        })[0];

        const statuses = group.files.map((file) =>
          String(this.getFrontmatter(file).status ?? "").toLowerCase()
        );

        return {
          name: group.name,
          path: preferred.path,
          noteCount: group.files.length,
          activeCount: statuses.filter((status) => status === "active").length,
          draftCount: statuses.filter((status) => status === "draft").length,
          mtime: Math.max(...group.files.map((file) => file.stat.mtime))
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  private buildRecentFiles(
    files: TFile[],
    settings: ResearchDashboardSettings
  ): DashboardFile[] {
    return [...files]
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .map((file) => {
        const frontmatter = this.getFrontmatter(file);
        return {
          path: file.path,
          basename: file.basename,
          mtime: file.stat.mtime,
          summary: normalizeStringArray(frontmatter.summary)[0] ?? "",
          kind: this.getKnowledgeKind(file.path, settings)
        };
      });
  }

  private buildReviewItems(files: TFile[]): ReviewItem[] {
    return files
      .flatMap((file): ReviewItem[] => {
        const frontmatter = this.getFrontmatter(file);
        const status = String(frontmatter.status ?? "").toLowerCase();
        const needsReview = frontmatter.needs_review === true || frontmatter.needs_review === "true";
        if (!needsReview && status !== "draft") return [];

        return [
          {
            path: file.path,
            basename: file.basename,
            mtime: file.stat.mtime,
            summary: normalizeStringArray(frontmatter.summary)[0] ?? "",
            kind: String(frontmatter.type ?? "note"),
            reason: needsReview ? "needs_review" : "draft"
          }
        ];
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  private isStableKnowledgeFile(
    file: TFile,
    settings: ResearchDashboardSettings
  ): boolean {
    return [
      settings.projectRoot,
      settings.papersRoot,
      settings.literatureRoot,
      settings.applicationRoot
    ].some((root) => isPathInside(file.path, root));
  }

  private getKnowledgeKind(path: string, settings: ResearchDashboardSettings): string {
    if (isPathInside(path, settings.projectRoot)) return "项目";
    if (isPathInside(path, settings.papersRoot)) return "文章";
    if (isPathInside(path, settings.literatureRoot)) return "文献";
    if (isPathInside(path, settings.applicationRoot)) return "应用";
    return "笔记";
  }

  private getFrontmatter(file: TFile): FrontmatterRecord {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return frontmatter && typeof frontmatter === "object"
      ? (frontmatter as FrontmatterRecord)
      : {};
  }
}

export function getProjectLabel(projectValue: unknown): string {
  const value = normalizeStringArray(projectValue)[0];
  return value ? stripWikiLink(value) : "";
}
