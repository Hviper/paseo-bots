/**
 * Watchdog and completion tracking for Paseo agents.
 *
 * Monitors:
 * 1. Liveness & Stalled Detection: Warns when an agent in 'running' state has no activity
 *    for longer than stallThresholdMs (default 5 minutes), helping catch hung processes,
 *    deadlocks, or dropped network connections.
 * 2. Unread Completion & macOS Dock Badge: Tracks agents that finish while in background,
 *    updating the macOS Dock badge count and sending OS notifications.
 */

export interface TrackedAgent {
  id: string;
  title: string;
  status: string;
  startTime: number;
  lastActivityTime: number;
  isStalled: boolean;
  notifiedStalled: boolean;
}

export interface DesktopWindowLike {
  setBadgeCount?(count?: number): Promise<void> | void;
}

export interface DesktopNotificationLike {
  sendNotification?(payload: { title: string; body?: string; data?: unknown }): Promise<boolean> | boolean;
}

export interface DesktopHostLike {
  window?: {
    getCurrentWindow?(): DesktopWindowLike;
  };
  notification?: DesktopNotificationLike;
}

export interface AgentWatchdogOptions {
  /** Milliseconds of inactivity before a running agent is considered stalled. Default: 5 minutes */
  stallThresholdMs?: number;
  /** Whether to sync unread completed agents to macOS Dock badge. Default: true */
  enableDockBadge?: boolean;
  /** Whether to send OS desktop notifications on completion or stall. Default: true */
  enableNotifications?: boolean;
  /** Custom desktop host provider (e.g. window.paseoDesktop) */
  getDesktopHost?: () => DesktopHostLike | null | undefined;
  /** Whether the app or window is currently focused/visible */
  isAppFocused?: () => boolean;
  /** Check if a specific agent is currently open/focused by user */
  isAgentFocused?: (agentId: string) => boolean;
  /** Callback fired when an agent is first flagged as stalled */
  onAgentStalled?: (agent: TrackedAgent, stalledMs: number) => void;
  /** Callback fired when a stalled agent resumes activity */
  onAgentRecovered?: (agent: TrackedAgent) => void;
  /** Callback fired when an agent finishes execution */
  onAgentCompleted?: (agent: TrackedAgent, wasBackground: boolean) => void;
}

export class AgentWatchdog {
  private stallThresholdMs: number;
  private enableDockBadge: boolean;
  private enableNotifications: boolean;
  private readonly getDesktopHost: () => DesktopHostLike | null | undefined;
  private readonly isAppFocused: () => boolean;
  private readonly isAgentFocused: (agentId: string) => boolean;
  private readonly onAgentStalled?: (agent: TrackedAgent, stalledMs: number) => void;
  private readonly onAgentRecovered?: (agent: TrackedAgent) => void;
  private readonly onAgentCompleted?: (agent: TrackedAgent, wasBackground: boolean) => void;

  private readonly trackedAgents = new Map<string, TrackedAgent>();
  private readonly unreadCompletedAgentIds = new Set<string>();

  constructor(options: AgentWatchdogOptions = {}) {
    this.stallThresholdMs = options.stallThresholdMs ?? 5 * 60 * 1000;
    this.enableDockBadge = options.enableDockBadge ?? true;
    this.enableNotifications = options.enableNotifications ?? true;
    this.getDesktopHost = options.getDesktopHost ?? (() => {
      const g = globalThis as unknown as { paseoDesktop?: DesktopHostLike };
      return g.paseoDesktop ?? null;
    });
    this.isAppFocused = options.isAppFocused ?? (() => true);
    this.isAgentFocused = options.isAgentFocused ?? (() => false);
    this.onAgentStalled = options.onAgentStalled;
    this.onAgentRecovered = options.onAgentRecovered;
    this.onAgentCompleted = options.onAgentCompleted;
  }

  setOptions(options: Partial<Pick<AgentWatchdogOptions, "stallThresholdMs" | "enableDockBadge" | "enableNotifications">>): void {
    if (options.stallThresholdMs !== undefined) this.stallThresholdMs = options.stallThresholdMs;
    if (options.enableDockBadge !== undefined) this.enableDockBadge = options.enableDockBadge;
    if (options.enableNotifications !== undefined) this.enableNotifications = options.enableNotifications;
  }

  /**
   * Updates an agent's status snapshot.
   */
  updateAgent(agent: {
    id: string;
    title?: string | null;
    status: string;
    lastActivityAt?: Date | string | number | null;
  }, now = Date.now()): void {
    const existing = this.trackedAgents.get(agent.id);
    const prevStatus = existing?.status;
    const title = agent.title || existing?.title || `Agent (${agent.id.slice(0, 8)})`;

    let activityTime = now;
    if (agent.lastActivityAt) {
      const parsed = new Date(agent.lastActivityAt).getTime();
      if (!isNaN(parsed) && parsed > 0) {
        activityTime = parsed;
      }
    }

    if (!existing) {
      const newEntry: TrackedAgent = {
        id: agent.id,
        title,
        status: agent.status,
        startTime: now,
        lastActivityTime: activityTime,
        isStalled: false,
        notifiedStalled: false,
      };
      this.trackedAgents.set(agent.id, newEntry);
      return;
    }

    // Agent already exists
    existing.title = title;
    existing.status = agent.status;

    // Detect status transition from running -> idle (completion)
    if (prevStatus === "running" && (agent.status === "idle" || agent.status === "closed")) {
      existing.isStalled = false;
      existing.notifiedStalled = false;

      const isFocused = this.isAppFocused() && this.isAgentFocused(agent.id);
      if (!isFocused) {
        if (this.enableDockBadge) {
          this.unreadCompletedAgentIds.add(agent.id);
          this.syncDockBadge();
        }
        if (this.enableNotifications) {
          this.sendOsNotification(
            `任务完成: ${existing.title}`,
            `Agent 已顺利完成执行，处于就绪状态。`,
            { agentId: agent.id },
          );
        }
      }

      this.onAgentCompleted?.(existing, !isFocused);
    } else if (agent.status === "running" && prevStatus !== "running") {
      // Re-started turn
      existing.startTime = now;
      existing.lastActivityTime = now;
      existing.isStalled = false;
      existing.notifiedStalled = false;
    } else if (activityTime > existing.lastActivityTime) {
      existing.lastActivityTime = activityTime;
      if (existing.isStalled) {
        existing.isStalled = false;
        existing.notifiedStalled = false;
        this.onAgentRecovered?.(existing);
      }
    }
  }

  /**
   * Records active stream/tool activity for a running agent.
   */
  recordActivity(agentId: string, now = Date.now()): void {
    const agent = this.trackedAgents.get(agentId);
    if (!agent) return;

    agent.lastActivityTime = now;
    if (agent.isStalled) {
      agent.isStalled = false;
      agent.notifiedStalled = false;
      this.onAgentRecovered?.(agent);
    }
  }

  /**
   * Checks for stalled running agents that exceeded stallThresholdMs.
   */
  checkStalled(now = Date.now()): TrackedAgent[] {
    const stalledList: TrackedAgent[] = [];

    for (const agent of this.trackedAgents.values()) {
      if (agent.status !== "running") continue;

      const idleDuration = now - agent.lastActivityTime;
      if (idleDuration >= this.stallThresholdMs) {
        agent.isStalled = true;
        stalledList.push(agent);

        if (!agent.notifiedStalled) {
          agent.notifiedStalled = true;
          this.onAgentStalled?.(agent, idleDuration);
        }
      }
    }

    return stalledList;
  }

  /**
   * Marks an agent as viewed/read by user, clearing its unread completion badge.
   */
  markAgentViewed(agentId: string): void {
    if (this.unreadCompletedAgentIds.delete(agentId)) {
      this.syncDockBadge();
    }
  }

  /**
   * Clears all unread badges (e.g. when user focuses app window).
   */
  clearAllUnread(): void {
    if (this.unreadCompletedAgentIds.size > 0) {
      this.unreadCompletedAgentIds.clear();
      this.syncDockBadge();
    }
  }

  getUnreadCount(): number {
    return this.unreadCompletedAgentIds.size;
  }

  getTrackedAgent(agentId: string): TrackedAgent | undefined {
    return this.trackedAgents.get(agentId);
  }

  getAllTrackedAgents(): TrackedAgent[] {
    return Array.from(this.trackedAgents.values());
  }

  /**
   * Dispatches a test notification and sets a temporary macOS Dock badge.
   * Useful for user to verify system notification and badge permissions.
   */
  testNotification(): { badgeSet: boolean; notificationSent: boolean } {
    const host = this.getDesktopHost();
    const win = host?.window?.getCurrentWindow?.();
    const notifier = host?.notification;

    let badgeSet = false;
    let notificationSent = false;

    if (typeof win?.setBadgeCount === "function") {
      void Promise.resolve(win.setBadgeCount(1)).catch(() => {});
      // Auto-clear test badge after 5 seconds if there are no real unread agents
      setTimeout(() => {
        if (this.unreadCompletedAgentIds.size === 0) {
          if (typeof win?.setBadgeCount === "function") {
            void Promise.resolve(win.setBadgeCount(undefined)).catch(() => {});
          }
        }
      }, 5000);
      badgeSet = true;
    }

    if (typeof notifier?.sendNotification === "function") {
      void Promise.resolve(
        notifier.sendNotification({
          title: "Paseo 桌面提醒测试",
          body: "如果看到此通知且 Dock 图标出现了数字角标「1」，说明 macOS 系统通知权限已完全就绪！",
        }),
      ).catch(() => {});
      notificationSent = true;
    }

    return { badgeSet, notificationSent };
  }

  /**
   * Updates macOS Dock badge count via Electron host API.
   */
  private syncDockBadge(): void {
    const host = this.getDesktopHost();
    const win = host?.window?.getCurrentWindow?.();
    if (typeof win?.setBadgeCount === "function") {
      const count = this.unreadCompletedAgentIds.size;
      void Promise.resolve(win.setBadgeCount(count > 0 ? count : undefined)).catch(() => {});
    }
  }

  /**
   * Sends an OS desktop notification banner.
   */
  private sendOsNotification(title: string, body: string, data?: unknown): void {
    const host = this.getDesktopHost();
    const notifier = host?.notification;
    if (typeof notifier?.sendNotification === "function") {
      void Promise.resolve(notifier.sendNotification({ title, body, data })).catch(() => {});
    }
  }
}
