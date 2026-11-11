import type { PluginClientContext } from "@getpaseo/plugin/client";
import { z } from "zod";
import { BotsSurface } from "./client/BotsSurface";
import { NativeConnectCard } from "./client/chat/stream/ConnectCard";
import { ProposalCard } from "./client/chat/stream/ProposalCard";
import { RoutineRunCard } from "./client/chat/stream/RoutineRunCard";
import { SubagentJumpCard } from "./client/chat/stream/SubagentJumpCard";
import { requestIntent } from "./client/intent";
import { BotsSettings } from "./client/settings/BotsSettings";
import { installTooltips } from "./client/ui/Tooltip";
import { appSignIns } from "./shared/apps";
import { BOT_LABEL } from "./shared/bot";
import { proposalIdOf } from "./shared/proposals";
import { APP_SIGN_IN_CARD, AppSignInSchema, helloRpc, ROUTINE_RUN_CARD, RoutineRunCardSchema } from "./shared/rpc";
import { LEARN_COMMAND, learnPrompt } from "./shared/skills";
import { SUBAGENT_JUMP_CARD, SubagentJumpDataSchema, subagentInfoOf } from "./shared/subagent-jump";

export default function contribute(client: PluginClientContext) {
  // Hands the daemon side its Paseo API so bot routines can run.
  void client.rpc(helloRpc, {}).catch(() => {});
  const removeTooltips = installTooltips();
  client.addSurface("bots", BotsSurface);
  client.addSidebarItem({ id: "bots", title: "Bots", icon: "Bot", surface: "bots" });
  client.addSettingsScreen({ id: "bots", title: "Bots", icon: "Bot", Component: BotsSettings });
  client.addCommandCenterItem({
    id: "open-bots",
    title: "Open Bots",
    icon: "Bot",
    keywords: ["bot", "assistant", "persona"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("bots");
    },
  });
  client.addCommandCenterItem({
    id: "new-bot",
    title: "New bot",
    icon: "Plus",
    keywords: ["bot", "create", "assistant"],
    context: "global",
    onSelect({ openSurface }) {
      requestIntent({ kind: "new-bot" });
      openSurface("bots");
    },
  });
  // Bot chats opened in Paseo's own agent view get the same /learn and skill cards.
  client.addSlashCommand({
    ...LEARN_COMMAND,
    context: "agent",
    async onSubmit({ agent, args, paseo }) {
      if (!agent.labels[BOT_LABEL]) throw new Error("/learn works in bot chats.");
      await paseo.agents.ref(agent.id).send(learnPrompt(args));
    },
  });
  // Paseo native /boost multi-agent orchestrator slash command
  client.addSlashCommand({
    name: "boost",
    description: "Invoke the Boost multi-agent orchestrator for complex tasks (Paseo native)",
    argumentHint: "<complex task description>",
    context: "agent",
    async onSubmit({ agent, args, paseo }) {
      const topic = args.trim();
      const prompt = topic
        ? `【执行 Boost 多智能体编排】\n请按照 /boost 技能规范（基于 Paseo create_agent 编排规范）推进以下复杂任务：\n${topic}`
        : `【执行 Boost 多智能体编排】\n请按照 /boost 技能规范（基于 Paseo create_agent 编排规范）开始战略规划与多智能体分工协同。`;
      await paseo.agents.ref(agent.id).send(prompt);
    },
  });
  client.addTimelineTransformer({
    id: "proposals",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const proposalId = proposalIdOf(item);
      return proposalId ? { items: [{ type: "plugin", kind: "proposal", version: 1, data: { proposalId } }] } : undefined;
    },
  });
  client.addTimelineRenderer({
    kind: "proposal",
    version: 1,
    schema: z.object({ proposalId: z.string() }),
    Component: ({ item, theme, layout }) => <ProposalCard colors={theme.colors} compact={layout.compact} proposalId={item.data.proposalId} />,
  });
  // A bot's request to connect an app, in Paseo's view too.
  client.addTimelineTransformer({
    id: "app-sign-ins",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const signIns = appSignIns(item);
      return signIns.length ? { items: signIns.map((data) => ({ type: "plugin", ...APP_SIGN_IN_CARD, data })) } : undefined;
    },
  });
  client.addTimelineRenderer({
    ...APP_SIGN_IN_CARD,
    schema: AppSignInSchema,
    Component: ({ item, agentId, timestamp, theme }) => <NativeConnectCard colors={theme.colors} signIn={item.data} since={timestamp.getTime()} agentId={agentId} />,
  });
  // A routine's results chat opened in Paseo's view shows its run cards too (no navigation there).
  client.addTimelineRenderer({
    ...ROUTINE_RUN_CARD,
    schema: RoutineRunCardSchema,
    Component: ({ item, theme }) => <RoutineRunCard colors={theme.colors} card={item.data} />,
  });
  // Subagent Jump Card for Paseo create_agent calls
  client.addTimelineTransformer({
    id: "subagent-jump",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const info = subagentInfoOf(item as any);
      if (!info) return undefined;
      return {
        items: [
          {
            type: "plugin",
            ...SUBAGENT_JUMP_CARD,
            data: info,
          },
        ],
      };
    },
  });
  client.addTimelineRenderer({
    ...SUBAGENT_JUMP_CARD,
    schema: SubagentJumpDataSchema,
    Component: (props) => <SubagentJumpCard {...props} />,
  });
  return removeTooltips;
}
