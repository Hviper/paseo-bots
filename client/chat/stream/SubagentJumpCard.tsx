import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useAgent } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {
  openAgentRoute,
  type SubagentJumpData,
  type WebWindowLike,
} from "../../../shared/subagent-jump";
import { StatusBadge, type BadgeVariant } from "../../panel/controls";
import { ui } from "../../typography";

export async function openAgentSession(target: {
  agentId: string;
  serverId?: string;
  navigation?: { openAgent?: (input: { agentId: string; serverId?: string }) => void };
}): Promise<void> {
  const res = openAgentRoute({
    ...target,
    isWeb: Platform.OS === "web",
    window: globalThis as unknown as WebWindowLike,
  });
  if (res.method === "openUrl" && res.url) {
    await Linking.openURL(res.url);
  }
}

const STATUS_VARIANTS: Record<string, { label: string; variant: BadgeVariant }> = {
  running: { label: "运行中", variant: "warning" },
  idle: { label: "空闲", variant: "success" },
  closed: { label: "已结束", variant: "muted" },
  failed: { label: "异常", variant: "error" },
};

export function SubagentJumpCard(props: PluginTimelineItemProps<SubagentJumpData>) {
  const { item, theme, host } = props;
  const data = item.data;
  const colors = theme.colors;
  const toast = useToast();
  const [hovered, setHovered] = useState(false);

  // Subscribe to live agent state if available on client
  const liveAgent = useAgent(data.agentId, (agent) => {
    if (!agent) return null;
    return {
      title: agent.title,
      status: agent.status,
    };
  });

  const displayTitle = liveAgent?.title || data.title || `子 Agent (${data.agentId.slice(0, 7)})`;
  const currentStatus = liveAgent?.status || data.status || "idle";
  const statusInfo = STATUS_VARIANTS[currentStatus] || { label: currentStatus, variant: "muted" as BadgeVariant };

  const handleOpen = async () => {
    try {
      const nav = (props as unknown as { navigation?: { openAgent?: (input: { agentId: string; serverId?: string }) => void } }).navigation;
      await openAgentSession({
        agentId: data.agentId,
        serverId: host?.id,
        navigation: nav,
      });
    } catch (err) {
      console.error("[SubagentJumpCard] Navigation failed:", err);
      toast.error("无法跳转到子 Agent 会话");
    }
  };

  const modelBadge = [data.provider, data.model].filter(Boolean).join(" / ");

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface1,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: colors.surface2 }]}>
          <Icon name="Bot" size={16} color={colors.accent} />
        </View>

        <View style={styles.titleCol}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={[styles.titleText, { color: colors.foreground }]}>
              {displayTitle}
            </Text>
            <StatusBadge colors={colors} label={statusInfo.label} variant={statusInfo.variant} />
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.subText, { color: colors.foregroundMuted }]}>
              {`ID: ${data.agentId.slice(0, 8)}`}
            </Text>
            {Boolean(modelBadge) && (
              <Text numberOfLines={1} style={[styles.modelBadgeText, { color: colors.foregroundMuted }]}>
                {`• ${modelBadge}`}
              </Text>
            )}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="跳转到子 Agent 会话"
          onPress={handleOpen}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          style={({ pressed }) => [
            styles.jumpButton,
            {
              backgroundColor: hovered ? colors.accent : colors.surface2,
              borderColor: hovered ? colors.accent : colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.jumpButtonText,
              { color: hovered ? colors.accentForeground : colors.foreground },
            ]}
          >
            打开子会话
          </Text>
          <Icon
            name="ArrowUpRight"
            size={14}
            color={hovered ? colors.accentForeground : colors.foreground}
          />
        </Pressable>
      </View>

      {Boolean(data.prompt) && (
        <View style={[styles.promptBox, { backgroundColor: colors.surface2 }]}>
          <Text numberOfLines={2} style={[styles.promptText, { color: colors.foregroundMuted }]}>
            {data.prompt}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 6,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  titleCol: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  titleText: {
    fontSize: ui(13),
    fontWeight: "600",
    flexShrink: 1,
  },
  subText: {
    fontSize: ui(11),
  },
  modelBadgeText: {
    fontSize: ui(11),
    flexShrink: 1,
  },
  promptBox: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  promptText: {
    fontSize: ui(11),
    lineHeight: 16,
  },
  jumpButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  jumpButtonText: {
    fontSize: ui(12),
    fontWeight: "500",
  },
});
