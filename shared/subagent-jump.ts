import { z } from "zod";

export const SUBAGENT_JUMP_CARD = { kind: "subagent-jump", version: 1 } as const;

export const SubagentJumpDataSchema = z.object({
  agentId: z.string(),
  title: z.string().optional(),
  status: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
});

export type SubagentJumpData = z.infer<typeof SubagentJumpDataSchema>;

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function findAgentId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      const nested = findAgentId(parsed);
      if (nested) return nested;
    } catch {}
    const match = value.match(UUID_REGEX);
    return match ? match[0] : null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.agentId === "string" && UUID_REGEX.test(record.agentId)) {
      return record.agentId;
    }
    if (typeof record.id === "string" && UUID_REGEX.test(record.id)) {
      return record.id;
    }
    if (record.structuredContent) {
      const found = findAgentId(record.structuredContent);
      if (found) return found;
    }
    if (Array.isArray(record.content)) {
      for (const block of record.content) {
        if (block && typeof block === "object" && "text" in block) {
          const found = findAgentId(block.text);
          if (found) return found;
        }
      }
    }
    if (record.output) {
      const found = findAgentId(record.output);
      if (found) return found;
    }
  }
  return null;
}

export function findAgentTitle(input: unknown, output: unknown): string | undefined {
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    const args = (rec.Arguments && typeof rec.Arguments === "object" ? rec.Arguments : rec) as Record<string, unknown>;
    if (typeof args.title === "string" && args.title.trim()) {
      return args.title.trim();
    }
    if (typeof args.initialPrompt === "string" && args.initialPrompt.trim()) {
      const p = args.initialPrompt.trim();
      return p.length > 40 ? `${p.slice(0, 40)}…` : p;
    }
    if (typeof args.Role === "string" && args.Role.trim()) {
      return args.Role.trim();
    }
    if (typeof args.Prompt === "string" && args.Prompt.trim()) {
      const p = args.Prompt.trim();
      return p.length > 40 ? `${p.slice(0, 40)}…` : p;
    }
  }
  if (output && typeof output === "object") {
    const rec = output as Record<string, unknown>;
    if (typeof rec.title === "string" && rec.title.trim()) {
      return rec.title.trim();
    }
  }
  return undefined;
}

export function isCreateAgentTool(name: string, input?: unknown): boolean {
  const lower = name.trim().toLowerCase();
  if (lower === "create_agent" || lower.endsWith("__create_agent") || lower.endsWith(".create_agent")) {
    return true;
  }
  if (lower === "call_mcp_tool" && input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    const serverName = String(rec.ServerName ?? "").toLowerCase();
    const toolName = String(rec.ToolName ?? "").toLowerCase();
    if ((serverName === "paseo" || serverName.includes("paseo")) && toolName === "create_agent") {
      return true;
    }
  }
  if (lower === "invoke_subagent") {
    return true;
  }
  return false;
}

export function subagentInfoOf(call: {
  name: string;
  status: string;
  detail?: unknown;
  input?: unknown;
  output?: unknown;
}): SubagentJumpData | null {
  const detail = (call.detail && typeof call.detail === "object" ? call.detail : {}) as Record<string, unknown>;
  const input = detail.input ?? call.input;
  const isTarget = isCreateAgentTool(call.name, input) || detail.type === "sub_agent";
  if (!isTarget) return null;

  const output = detail.output ?? call.output ?? (detail.type === "sub_agent" ? detail.log : undefined);
  const agentId = findAgentId(output) ?? findAgentId(detail);
  if (!agentId) return null;

  const title = findAgentTitle(input, output) ?? (detail.description as string | undefined);

  let provider: string | undefined;
  let model: string | undefined;
  let prompt: string | undefined;

  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    const args = (rec.Arguments && typeof rec.Arguments === "object" ? rec.Arguments : rec) as Record<string, unknown>;
    if (typeof args.provider === "string" && args.provider.trim()) {
      provider = args.provider.trim();
    }
    if (typeof args.model === "string" && args.model.trim()) {
      model = args.model.trim();
    } else if (typeof args.Model === "string" && args.Model.trim()) {
      model = args.Model.trim();
    }
    if (typeof args.prompt === "string" && args.prompt.trim()) {
      prompt = args.prompt.trim();
    } else if (typeof args.initialPrompt === "string" && args.initialPrompt.trim()) {
      prompt = args.initialPrompt.trim();
    } else if (typeof args.Prompt === "string" && args.Prompt.trim()) {
      prompt = args.Prompt.trim();
    }
  }

  return {
    agentId,
    title,
    status: call.status,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

/**
 * Builds the internal relative Expo Router path for an agent view.
 * Paseo's Expo Router registers `./h/[serverId]/agent/[agentId].tsx` matching
 * `/h/${serverId}/agent/${agentId}`.
 */
export function buildAgentInternalRoute(serverId: string, agentId: string): string {
  const normServer = (serverId || "local").trim();
  const normAgent = (agentId || "").trim();
  return `/h/${encodeURIComponent(normServer)}/agent/${encodeURIComponent(normAgent)}`;
}

/**
 * Builds the OS-level native deep link (`paseo://h/...`).
 * Used for external launchers or native mobile schemes parsed by Paseo's main process.
 */
export function buildAgentNativeDeepLink(serverId: string, agentId: string): string {
  const normServer = (serverId || "local").trim();
  const normAgent = (agentId || "").trim();
  return `paseo://h/${encodeURIComponent(normServer)}/agent/${encodeURIComponent(normAgent)}`;
}

export interface WebWindowLike {
  history?: {
    pushState?(data: unknown, unused: string, url?: string | URL | null): void;
  };
  dispatchEvent?(event: unknown): boolean;
  location?: {
    assign?(url: string): void;
    href?: string;
  };
  PopStateEvent?: new (type: string, eventInitDict?: unknown) => unknown;
  Event?: new (type: string, eventInitDict?: unknown) => unknown;
}

export interface OpenAgentTarget {
  agentId: string;
  serverId?: string;
  navigation?: { openAgent?: (input: { agentId: string; serverId?: string }) => void };
  isWeb?: boolean;
  openUrl?: (url: string) => Promise<unknown> | unknown;
  window?: WebWindowLike;
}

export type OpenAgentMethod = "navigation" | "history" | "assign" | "openUrl";

export interface OpenAgentResult {
  method: OpenAgentMethod;
  url?: string;
}

/**
 * Resolves the appropriate navigation strategy for an agent session.
 * In Web/Electron, client-side SPA navigation via pushState/popstate is used to avoid
 * breaking Expo Router's `/h/[serverId]/agent/[agentId]` route resolution.
 */
export function openAgentRoute(target: OpenAgentTarget): OpenAgentResult {
  if (typeof target.navigation?.openAgent === "function") {
    target.navigation.openAgent({ agentId: target.agentId, serverId: target.serverId });
    return { method: "navigation" };
  }

  const serverId = target.serverId || "local";
  const internalRoute = buildAgentInternalRoute(serverId, target.agentId);
  const isWeb = target.isWeb ?? (typeof target.window !== "undefined");

  if (isWeb) {
    const win = target.window ?? (globalThis as unknown as WebWindowLike);
    if (typeof win?.history?.pushState === "function" && typeof win?.dispatchEvent === "function") {
      win.history.pushState(null, "", internalRoute);
      const EventCtor = win.PopStateEvent ?? win.Event;
      if (EventCtor) {
        win.dispatchEvent(new EventCtor("popstate"));
        return { method: "history", url: internalRoute };
      }
    }
    if (typeof win?.location?.assign === "function") {
      win.location.assign(internalRoute);
      return { method: "assign", url: internalRoute };
    }
  }

  const deepLink = isWeb ? internalRoute : buildAgentNativeDeepLink(serverId, target.agentId);
  if (typeof target.openUrl === "function") {
    target.openUrl(deepLink);
  }
  return { method: "openUrl", url: deepLink };
}
