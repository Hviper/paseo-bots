import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AgentWatchdog, type DesktopHostLike } from "../shared/watchdog";

interface WindowWithPaseo {
  paseoDesktop?: DesktopHostLike;
  location?: { pathname: string };
  document?: { hasFocus?(): boolean };
  addEventListener?(event: string, listener: () => void): void;
  removeEventListener?(event: string, listener: () => void): void;
}

let globalWatchdog: AgentWatchdog | null = null;

export function getWatchdog(): AgentWatchdog | null {
  return globalWatchdog;
}

export function getPaseoDesktopHost(): DesktopHostLike | null {
  const g = globalThis as unknown as WindowWithPaseo;
  return g.paseoDesktop ?? null;
}

/**
 * Installs the agent watchdog and completion notification listener in the Paseo client.
 */
export function installAgentWatchdog(client: PluginClientContext): () => void {
  const getWindow = (): WindowWithPaseo | null => {
    const g = globalThis as unknown as WindowWithPaseo;
    return typeof g.addEventListener === "function" ? g : null;
  };

  const isAppFocused = (): boolean => {
    const win = getWindow();
    return Boolean(win?.document?.hasFocus?.());
  };

  const isAgentFocused = (agentId: string): boolean => {
    const win = getWindow();
    return Boolean(win?.location?.pathname?.includes(agentId));
  };

  const watchdog = new AgentWatchdog({
    stallThresholdMs: 5 * 60 * 1000,
    getDesktopHost: getPaseoDesktopHost,
    isAppFocused,
    isAgentFocused,
    onAgentStalled: (agent, stalledMs) => {
      const minutes = Math.round(stalledMs / 60000);
      const host = getPaseoDesktopHost();
      host?.notification?.sendNotification?.({
        title: "Agent 执行已超过 5 分钟无响应",
        body: `Agent「${agent.title}」已静默 ${minutes} 分钟，可能处于复杂深度推理中或已异常挂起。`,
        data: { agentId: agent.id },
      });
    },
    onAgentRecovered: (agent) => {
      console.log(`[paseo-bots:watchdog] Agent recovered activity: ${agent.title} (${agent.id})`);
    },
  });

  globalWatchdog = watchdog;

  // 1. Initial sync of existing agents
  try {
    void client.paseo.agents.list().then((res) => {
      if (res && Array.isArray(res.entries)) {
        for (const entry of res.entries) {
          if (entry?.agent) {
            watchdog.updateAgent(entry.agent);
          }
        }
      }
    }).catch((err: unknown) => {
      console.warn("[paseo-bots:watchdog] Initial agents list failed:", err);
    });
  } catch (err: unknown) {
    console.warn("[paseo-bots:watchdog] Failed to call agents.list:", err);
  }

  // 2. Subscribe to low-level agent updates
  let unsubscribeAgents: (() => void) | undefined;
  try {
    unsubscribeAgents = client.paseo.agents.subscribe((update) => {
      if (update && update.kind === "upsert" && update.agent) {
        watchdog.updateAgent(update.agent);
      }
    });
  } catch (err: unknown) {
    console.warn("[paseo-bots:watchdog] Failed to subscribe to agent updates:", err);
  }

  // 3. Periodic timer to detect stalled running agents (every 30 seconds)
  const timer = setInterval(() => {
    watchdog.checkStalled();
  }, 30_000);

  // 4. Focus handler to automatically clear unread dock badges
  const onFocus = () => {
    watchdog.clearAllUnread();
  };
  const win = getWindow();
  win?.addEventListener?.("focus", onFocus);

  return () => {
    unsubscribeAgents?.();
    clearInterval(timer);
    win?.removeEventListener?.("focus", onFocus);
    if (globalWatchdog === watchdog) {
      globalWatchdog = null;
    }
  };
}
