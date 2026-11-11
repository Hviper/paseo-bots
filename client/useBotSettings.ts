import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { botSettings, type BotSettingsValues } from "../shared/bot";
import { settingsRevisionRpc } from "../shared/rpc";

export type BotSettingsState = ReturnType<typeof useBotSettingsState>;

function useBotSettingsState() {
  return useSettings(botSettings);
}

/**
 * The bots settings document with one write queue. Every write reads the latest
 * revision when it runs and retries on a conflict, so autosaves, menu actions
 * and the other plugin surface never overwrite each other.
 *
 * Supports hot-reloading when the settings file on disk (bots.json) is edited
 * externally (e.g. adding a bot in an editor), via revision checking and window focus.
 */
export function useBotSettings() {
  const settings = useBotSettingsState();
  const toast = useToast();
  const latest = useRef(settings);
  latest.current = settings;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const checkRevision = useRpc(settingsRevisionRpc);

  // Periodic revision check to detect disk changes made outside the UI
  useQuery({
    queryKey: ["paseo-bots", "settings-revision"],
    queryFn: async () => {
      try {
        const { revision } = await checkRevision({});
        const current = latest.current;
        if (current.status === "ready" && revision && current.revision && revision !== current.revision) {
          await current.reload();
        }
        return revision;
      } catch {
        return null;
      }
    },
    refetchInterval: 1500,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // Also check and reload immediately when the window or app regains focus
  useEffect(() => {
    const triggerReload = () => {
      void (async () => {
        try {
          const { revision } = await checkRevision({});
          const current = latest.current;
          if (current.status === "ready" && revision && current.revision && revision !== current.revision) {
            await current.reload();
          }
        } catch {
          // ignore
        }
      })();
    };

    const win = globalThis as unknown as {
      addEventListener?(type: string, listener: () => void): void;
      removeEventListener?(type: string, listener: () => void): void;
      document?: {
        visibilityState?: string;
        addEventListener?(type: string, listener: () => void): void;
        removeEventListener?(type: string, listener: () => void): void;
      };
    };

    if (Platform.OS === "web" && typeof win.addEventListener === "function") {
      win.addEventListener("focus", triggerReload);
      const onVisChange = () => {
        if (win.document?.visibilityState === "visible") triggerReload();
      };
      if (typeof win.document?.addEventListener === "function") {
        win.document.addEventListener("visibilitychange", onVisChange);
      }
      return () => {
        win.removeEventListener?.("focus", triggerReload);
        win.document?.removeEventListener?.("visibilitychange", onVisChange);
      };
    }

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") triggerReload();
    });
    return () => sub.remove();
  }, [checkRevision]);

  const commit = (mutate: (values: BotSettingsValues) => BotSettingsValues): Promise<boolean> => {
    const run = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = latest.current;
        if (current.status !== "ready") return false;
        if (await current.save(mutate(current.values), current.revision)) {
          // Let the hook render the new revision before the next queued write reads it.
          await new Promise((resolve) => setTimeout(resolve, 0));
          return true;
        }
        await current.reload();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      toast.error(latest.current.saveError ?? "Couldn't save bots. Try again.");
      return false;
    };
    const result = queue.current.then(run);
    queue.current = result.catch(() => false);
    return result;
  };

  return { settings, latest, commit };
}
