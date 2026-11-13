import { describe, expect, it, vi } from "vitest";
import { AgentWatchdog, type DesktopHostLike } from "../shared/watchdog";

describe("AgentWatchdog", () => {
  it("tracks new agents and updates activity", () => {
    const watchdog = new AgentWatchdog();
    watchdog.updateAgent({
      id: "agent-1",
      title: "Worker 1",
      status: "running",
    }, 1000);

    const tracked = watchdog.getTrackedAgent("agent-1");
    expect(tracked).toBeDefined();
    expect(tracked?.title).toBe("Worker 1");
    expect(tracked?.status).toBe("running");
    expect(tracked?.lastActivityTime).toBe(1000);
    expect(tracked?.isStalled).toBe(false);
  });

  it("detects stalled agents when exceeding stallThresholdMs", () => {
    const onStalled = vi.fn();
    const watchdog = new AgentWatchdog({
      stallThresholdMs: 300_000, // 5 minutes
      onAgentStalled: onStalled,
    });

    watchdog.updateAgent({
      id: "agent-2",
      title: "Antigravity Long Run",
      status: "running",
    }, 1_000_000);

    // 4 minutes later: not stalled
    let stalled = watchdog.checkStalled(1_240_000);
    expect(stalled).toHaveLength(0);
    expect(onStalled).not.toHaveBeenCalled();

    // 5 minutes later: stalled!
    stalled = watchdog.checkStalled(1_300_000);
    expect(stalled).toHaveLength(1);
    expect(stalled[0].id).toBe("agent-2");
    expect(stalled[0].isStalled).toBe(true);
    expect(onStalled).toHaveBeenCalledWith(stalled[0], 300_000);

    // Subsequent check does not re-notify
    watchdog.checkStalled(1_310_000);
    expect(onStalled).toHaveBeenCalledTimes(1);
  });

  it("recovers a stalled agent when new activity is recorded", () => {
    const onRecovered = vi.fn();
    const watchdog = new AgentWatchdog({
      stallThresholdMs: 300_000,
      onAgentRecovered: onRecovered,
    });

    watchdog.updateAgent({
      id: "agent-3",
      title: "Worker 3",
      status: "running",
    }, 1_000_000);

    watchdog.checkStalled(1_350_000);
    expect(watchdog.getTrackedAgent("agent-3")?.isStalled).toBe(true);

    // Activity arrives
    watchdog.recordActivity("agent-3", 1_360_000);
    const agent = watchdog.getTrackedAgent("agent-3");
    expect(agent?.isStalled).toBe(false);
    expect(agent?.lastActivityTime).toBe(1_360_000);
    expect(onRecovered).toHaveBeenCalledWith(agent);
  });

  it("updates macOS dock badge and sends notification on background completion", () => {
    const setBadgeCountMock = vi.fn();
    const sendNotificationMock = vi.fn();
    const mockHost: DesktopHostLike = {
      window: {
        getCurrentWindow: () => ({
          setBadgeCount: setBadgeCountMock,
        }),
      },
      notification: {
        sendNotification: sendNotificationMock,
      },
    };

    const onCompleted = vi.fn();
    const watchdog = new AgentWatchdog({
      getDesktopHost: () => mockHost,
      isAppFocused: () => false, // App is in background
      isAgentFocused: () => false,
      onAgentCompleted: onCompleted,
    });

    watchdog.updateAgent({
      id: "agent-task",
      title: "Data Pipeline",
      status: "running",
    }, 1000);

    // Completes
    watchdog.updateAgent({
      id: "agent-task",
      title: "Data Pipeline",
      status: "idle",
    }, 2000);

    expect(watchdog.getUnreadCount()).toBe(1);
    expect(setBadgeCountMock).toHaveBeenCalledWith(1);
    expect(sendNotificationMock).toHaveBeenCalledWith({
      title: "任务完成: Data Pipeline",
      body: "Agent 已顺利完成执行，处于就绪状态。",
      data: { agentId: "agent-task" },
    });
    expect(onCompleted).toHaveBeenCalled();

    // Mark as viewed: badge count cleared
    watchdog.markAgentViewed("agent-task");
    expect(watchdog.getUnreadCount()).toBe(0);
    expect(setBadgeCountMock).toHaveBeenCalledWith(undefined);
  });

  it("does not trigger unread badge if user is actively viewing the agent", () => {
    const setBadgeCountMock = vi.fn();
    const mockHost: DesktopHostLike = {
      window: {
        getCurrentWindow: () => ({
          setBadgeCount: setBadgeCountMock,
        }),
      },
    };

    const watchdog = new AgentWatchdog({
      getDesktopHost: () => mockHost,
      isAppFocused: () => true,
      isAgentFocused: (id) => id === "agent-focused",
    });

    watchdog.updateAgent({ id: "agent-focused", status: "running" });
    watchdog.updateAgent({ id: "agent-focused", status: "idle" });

    // No badge added because user is looking at it
    expect(watchdog.getUnreadCount()).toBe(0);
    expect(setBadgeCountMock).not.toHaveBeenCalled();
  });

  it("handles testNotification correctly", () => {
    const setBadgeCountMock = vi.fn();
    const sendNotificationMock = vi.fn();
    const mockHost: DesktopHostLike = {
      window: {
        getCurrentWindow: () => ({
          setBadgeCount: setBadgeCountMock,
        }),
      },
      notification: {
        sendNotification: sendNotificationMock,
      },
    };

    const watchdog = new AgentWatchdog({
      getDesktopHost: () => mockHost,
    });

    const res = watchdog.testNotification();
    expect(res.badgeSet).toBe(true);
    expect(res.notificationSent).toBe(true);
    expect(setBadgeCountMock).toHaveBeenCalledWith(1);
    expect(sendNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Paseo 桌面提醒测试",
    }));
  });

  it("respects enableDockBadge and enableNotifications toggles", () => {
    const setBadgeCountMock = vi.fn();
    const sendNotificationMock = vi.fn();
    const mockHost: DesktopHostLike = {
      window: {
        getCurrentWindow: () => ({
          setBadgeCount: setBadgeCountMock,
        }),
      },
      notification: {
        sendNotification: sendNotificationMock,
      },
    };

    const watchdog = new AgentWatchdog({
      getDesktopHost: () => mockHost,
      isAppFocused: () => false,
      enableDockBadge: false,
      enableNotifications: false,
    });

    watchdog.updateAgent({ id: "agent-muted", status: "running" });
    watchdog.updateAgent({ id: "agent-muted", status: "idle" });

    expect(setBadgeCountMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(watchdog.getUnreadCount()).toBe(0);
  });
});
