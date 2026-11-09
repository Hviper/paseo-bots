import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import type { Bot } from "../../../shared/bot";
import type { BotHost } from "../../data";
import { useAgentProfiles, useProviders } from "../../data";
import { errorText, nativeTokens, useHover } from "../../native";
import { ui } from "../../typography";
import { measureAnchor, useMenu, type MenuEntry } from "../../ui/Menu";
import { tooltip } from "../../ui/Tooltip";
import { modeIcon, providerIcon } from "./logic";

type Colors = PluginTheme["colors"];

export { modeIcon, providerIcon };

interface PillProps {
  colors: Colors;
  bot: Bot;
  host: BotHost;
  disabled?: boolean;
  onPatch?(patch: Partial<Bot>): void;
}

/**
 * Model & Agent selector pill: renders current model and provider, and
 * opens an anchored menu to switch model, thinking option, provider, or refresh models.
 */
export function ModelSelectorPill({ colors, bot, host, disabled = false, onPatch }: PillProps) {
  const modelRef = useRef<View>(null);
  const menu = useMenu();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hovered, hoverProps } = useHover();

  const providers = useProviders(host);
  const profiles = useAgentProfiles(host);

  const provider = providers.data?.find((entry) => entry.provider === bot.provider);
  const models = (provider?.models ?? []).filter((m) => m.isSelectable !== false);
  const currentModel = models.find((m) => m.id === bot.model);
  const thinking = currentModel?.thinkingOptions ?? models.find((m) => m.isDefault)?.thinkingOptions ?? [];
  const currentThinking = thinking.find((t) => t.id === bot.thinkingOptionId);

  // Compute displayed label
  const displayModelName = currentModel
    ? currentThinking
      ? `${currentModel.label} (${currentThinking.label})`
      : currentModel.label
    : bot.model
    ? bot.model
    : provider
    ? `${provider.label ?? provider.provider}`
    : "Model";

  const iconName = providerIcon(bot.provider);

  const openModelMenu = async () => {
    const anchor = await measureAnchor(modelRef);
    if (!anchor) return;

    const entries: MenuEntry[] = [];

    // 1. Models for current provider
    if (models.length > 0) {
      for (const m of models) {
        entries.push({
          label: m.label,
          selected: (bot.model === m.id) || (!bot.model && m.isDefault),
          onSelect: () => {
            onPatch?.({ model: m.id, thinkingOptionId: null });
          },
        });
      }
    } else if (provider) {
      entries.push({
        label: `Default (${provider.label ?? provider.provider})`,
        selected: !bot.model,
        onSelect: () => onPatch?.({ model: null, thinkingOptionId: null }),
      });
    }

    // 2. Thinking options for current model (if supported)
    if (thinking.length > 0) {
      entries.push({ kind: "separator" });
      for (const t of thinking) {
        entries.push({
          label: `Thinking: ${t.label}`,
          selected: bot.thinkingOptionId === t.id,
          onSelect: () => onPatch?.({ thinkingOptionId: t.id }),
        });
      }
    }

    // 3. Switch Agent Provider
    const otherProviders = (providers.data ?? []).filter((p) => p.provider !== bot.provider);
    if (otherProviders.length > 0) {
      entries.push({ kind: "separator" });
      for (const p of otherProviders) {
        entries.push({
          label: `Agent: ${p.label ?? p.provider}${p.status === "ready" ? "" : ` (${p.status})`}`,
          icon: providerIcon(p.provider),
          onSelect: () => {
            onPatch?.({
              provider: p.provider,
              model: null,
              modeId: p.defaultModeId ?? null,
              thinkingOptionId: null,
            });
          },
        });
      }
    }

    // 4. Agent Profiles
    const profileList = profiles.data ?? [];
    if (profileList.length > 0) {
      entries.push({ kind: "separator" });
      for (const prof of profileList) {
        const isCurrent = bot.provider === prof.provider && (bot.model ?? null) === (prof.model ?? null);
        entries.push({
          label: `Profile: ${prof.name}`,
          icon: "Sparkles",
          selected: isCurrent,
          onSelect: () => {
            onPatch?.({
              provider: prof.provider,
              model: prof.model ?? null,
              modeId: prof.modeId ?? null,
              thinkingOptionId: prof.thinkingOptionId ?? null,
            });
          },
        });
      }
    }

    // 5. Refresh models
    entries.push({ kind: "separator" });
    entries.push({
      label: "Refresh models",
      icon: "RefreshCw",
      pendingLabel: "Refreshing models...",
      onSelect: async () => {
        try {
          if (host.api) {
            await host.api.providers.refresh();
            await queryClient.invalidateQueries({ queryKey: ["paseo-bots", "providers", host.key] });
            await queryClient.invalidateQueries({ queryKey: ["paseo-bots", "profiles", host.key] });
            toast.show("Models refreshed", { variant: "success" });
          }
        } catch (error) {
          toast.error(`Failed to refresh models: ${errorText(error)}`);
        }
      },
    });

    menu.open({ anchor, align: "start", width: 280, title: "Agent & Model", entries });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Select model: ${displayModelName}`}
      {...tooltip("Select model & agent")}
      disabled={disabled}
      onPress={() => void openModelMenu()}
      {...hoverProps}
      style={{
        height: 28,
        borderRadius: 6,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: hovered ? colors.surface2 : "transparent",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <View ref={modelRef} collapsable={false} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Icon name={iconName} size={14} color={colors.foreground} />
        <Text numberOfLines={1} style={{ fontSize: ui(13), fontWeight: "500", color: colors.foreground, maxWidth: 160 }}>
          {displayModelName}
        </Text>
        <Icon name="ChevronDown" size={12} color={colors.foregroundMuted} />
      </View>
    </Pressable>
  );
}

/**
 * Mode selector pill: renders approval / permission mode, and
 * opens an anchored menu to switch modes (e.g. Full access, Ask first, Read-only).
 */
export function ModeSelectorPill({ colors, bot, host, disabled = false, onPatch }: PillProps) {
  const modeRef = useRef<View>(null);
  const menu = useMenu();
  const providers = useProviders(host);
  const { hovered, hoverProps } = useHover();

  const provider = providers.data?.find((entry) => entry.provider === bot.provider);
  const modes = provider?.modes ?? [];
  const currentMode = modes.find((mode) => mode.id === (bot.modeId ?? provider?.defaultModeId));

  const displayModeName = currentMode?.label ?? (bot.modeId ? bot.modeId : "Full access");
  const iconName = modeIcon(bot.modeId ?? provider?.defaultModeId);

  const openModeMenu = async () => {
    const anchor = await measureAnchor(modeRef);
    if (!anchor) return;

    const entries: MenuEntry[] = modes.map((m) => ({
      label: m.label,
      trailing: m.description ? (m.description.length > 25 ? `${m.description.slice(0, 25)}…` : m.description) : undefined,
      selected: (bot.modeId ?? provider?.defaultModeId) === m.id,
      icon: modeIcon(m.id),
      onSelect: () => onPatch?.({ modeId: m.id }),
    }));

    if (entries.length === 0) {
      entries.push({
        label: "Default mode",
        selected: true,
        icon: "ShieldCheck",
        onSelect: () => {},
      });
    }

    menu.open({ anchor, align: "start", width: 240, title: "Approval mode", entries });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Approval mode: ${displayModeName}`}
      {...tooltip("Approval mode")}
      disabled={disabled}
      onPress={() => void openModeMenu()}
      {...hoverProps}
      style={{
        height: 28,
        borderRadius: 6,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: hovered ? colors.surface2 : "transparent",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <View ref={modeRef} collapsable={false} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Icon name={iconName} size={14} color={colors.foreground} />
        <Text numberOfLines={1} style={{ fontSize: ui(13), fontWeight: "500", color: colors.foreground, maxWidth: 120 }}>
          {displayModeName}
        </Text>
        <Icon name="ChevronDown" size={12} color={colors.foregroundMuted} />
      </View>
    </Pressable>
  );
}

/**
 * Microphone / Dictation button.
 */
export function MicButton({ colors, iconSize, onTranscript }: { colors: Colors; iconSize: number; onTranscript(text: string): void }) {
  const { hovered, hoverProps } = useHover();
  const [listening, setListening] = useState(false);
  const toast = useToast();
  const recognitionRef = useRef<any>(null);

  const toggleListening = () => {
    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      setListening(false);
      return;
    }

    if (Platform.OS === "web") {
      const win = globalThis as unknown as {
        SpeechRecognition?: any;
        webkitSpeechRecognition?: any;
        navigator?: { language?: string };
      };
      const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = false;
          recognition.interimResults = false;
          recognition.lang = win.navigator?.language || "zh-CN";
          recognition.onresult = (event: any) => {
            const transcript = event.results?.[0]?.[0]?.transcript;
            if (transcript) onTranscript(transcript);
          };
          recognition.onerror = (event: any) => {
            setListening(false);
            if (event.error !== "no-speech") {
              toast.error(`Voice error: ${event.error}`);
            }
          };
          recognition.onend = () => setListening(false);
          recognition.start();
          recognitionRef.current = recognition;
          setListening(true);
          return;
        } catch (err) {
          toast.error("Could not start speech recognition");
        }
      }
    }
    toast.show("Voice input is not available in this browser window.", { variant: "info" });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listening ? "Stop dictation" : "Dictation"}
      {...tooltip(listening ? "Listening..." : "Dictation")}
      onPress={toggleListening}
      {...hoverProps}
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: listening ? colors.surface2 : hovered ? colors.surface2 : "transparent",
      }}
    >
      <Icon name="Mic" size={iconSize} color={listening ? "#ef4444" : hovered ? colors.foreground : colors.foregroundMuted} />
    </Pressable>
  );
}
