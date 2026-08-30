export type DashboardCardId =
  | "today"
  | "calendar"
  | "focus"
  | "projects"
  | "recent"
  | "review"
  | "activity"
  | "quickLinks";

export interface QuickLinkSetting {
  label: string;
  path: string;
  icon: string;
}

export interface ResearchDashboardSettings {
  schemaVersion: number;
  title: string;
  subtitle: string;
  openOnStartup: boolean;
  openNotesInNewTab: boolean;
  density: "comfortable" | "compact";
  dailyRoot: string;
  dailyFolderFormat: string;
  dailyFileFormat: string;
  dailyShortcutLabel: string;
  projectRoot: string;
  papersRoot: string;
  literatureRoot: string;
  applicationRoot: string;
  logsRoot: string;
  mapsRoot: string;
  recentLimit: number;
  taskLimit: number;
  quickLinks: QuickLinkSetting[];
  visibleCards: Record<DashboardCardId, boolean>;
  useCardColors: boolean;
  cardColors: Record<DashboardCardId, string>;
}

export interface SearchFile {
  path: string;
  name: string;
  basename: string;
  aliases: string[];
  mtime: number;
}

export interface DashboardTask {
  path: string;
  line: number;
  text: string;
  section: string;
  source: "today" | "project";
  mtime: number;
}

export interface DailySnapshot {
  path: string;
  exists: boolean;
  workSummary: string[];
  tasks: DashboardTask[];
}

export interface ProjectTopic {
  name: string;
  path: string;
  noteCount: number;
  activeCount: number;
  draftCount: number;
  mtime: number;
}

export interface DashboardFile {
  path: string;
  basename: string;
  mtime: number;
  summary: string;
  kind: string;
}

export interface ReviewItem extends DashboardFile {
  reason: string;
}

export interface ActivityDay {
  date: string;
  active: boolean;
  future: boolean;
}

export interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
  hasDaily: boolean;
  isToday: boolean;
}

export interface DashboardStats {
  notes: number;
  stableNotes: number;
  projectTopics: number;
  dailyStreak: number;
}

export interface DashboardModel {
  generatedAt: number;
  today: string;
  searchFiles: SearchFile[];
  daily: DailySnapshot;
  focusTasks: DashboardTask[];
  projectTopics: ProjectTopic[];
  recentFiles: DashboardFile[];
  reviewItems: ReviewItem[];
  activityDays: ActivityDay[];
  calendarDays: CalendarDay[];
  stats: DashboardStats;
}
