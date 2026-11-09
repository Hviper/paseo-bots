import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { defaultModelId, type Bot } from "../../../shared/bot";
import type { BotHost } from "../../data";
import { useAgentProfiles, useProviders } from "../../data";
import { errorText, nativeTokens, placeholderColor, useHover } from "../../native";
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
 * opens an anchored ModelBrowser popover matching Paseo's native experience.
 */
export function ModelSelectorPill({ colors, bot, host, disabled = false, onPatch }: PillProps) {
  const modelRef = useRef<View>(null);
  const menu = useMenu();
  const { hovered, hoverProps } = useHover();

  const providers = useProviders(host);
  const provider = providers.data?.find((entry) => entry.provider === bot.provider);
  const models = (provider?.models ?? []).filter((m) => m.isSelectable !== false);
  const resolvedModelId = bot.model ?? defaultModelId(models);
  const currentModel = models.find((m) => m.id === resolvedModelId);
  const thinking = currentModel?.thinkingOptions ?? models.find((m) => m.isDefault)?.thinkingOptions ?? [];
  const currentThinking = thinking.find((t) => t.id === bot.thinkingOptionId);

  // Compute displayed label: exactly like Paseo native
  const displayModelName = currentModel
    ? currentThinking
      ? `${currentModel.label} (${currentThinking.label})`
      : currentModel.label
    : resolvedModelId
    ? resolvedModelId
    : provider
    ? `${provider.label ?? provider.provider}`
    : "Model";

  const iconName = providerIcon(bot.provider);

  const openModelBrowser = async () => {
    const anchor = await measureAnchor(modelRef);
    if (!anchor) return;

    menu.open({
      anchor,
      align: "start",
      width: 360,
      title: "选择模型",
      content: (onClose) => (
        <ModelBrowser colors={colors} bot={bot} host={host} onClose={onClose} onPatch={onPatch} />
      ),
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Select model: ${displayModelName}`}
      {...tooltip("Select model & agent")}
      disabled={disabled}
      onPress={() => void openModelBrowser()}
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
        <Text numberOfLines={1} style={{ fontSize: ui(13), fontWeight: "500", color: colors.foreground, maxWidth: 180 }}>
          {displayModelName}
        </Text>
        <Icon name="ChevronDown" size={12} color={colors.foregroundMuted} />
      </View>
    </Pressable>
  );
}

interface ModelBrowserProps {
  colors: Colors;
  bot: Bot;
  host: BotHost;
  onClose(): void;
  onPatch?(patch: Partial<Bot>): void;
}

/**
 * Paseo's native ModelBrowser reproduced:
 * 1. Root view shows Search bar + "提供方" (Providers) with model counts and right chevron.
 * 2. Clicking a provider drills down to that provider's models with back button and "刷新模型".
 * 3. Typing in the search bar instantly searches across all available models from all providers.
 */
function ModelBrowser({ colors, bot, host, onClose, onPatch }: ModelBrowserProps) {
  const tokens = nativeTokens(colors);
  const toast = useToast();
  const queryClient = useQueryClient();
  const providers = useProviders(host);
  const profiles = useAgentProfiles(host);

  const [view, setView] = useState<{ kind: "providers" } | { kind: "models"; providerId: string; providerLabel: string }>({
    kind: "providers",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const allProviders = providers.data ?? [];
  const currentProvider = allProviders.find((p) => p.provider === bot.provider);
  const currentProviderModels = (currentProvider?.models ?? []).filter((m) => m.isSelectable !== false);
  const resolvedCurrentModelId = bot.model ?? defaultModelId(currentProviderModels);

  const handleRefresh = async (providerId?: string) => {
    if (!host.api || refreshing) return;
    setRefreshing(true);
    try {
      await host.api.providers.refresh(providerId ? { providers: [providerId] } : undefined);
      await queryClient.invalidateQueries({ queryKey: ["paseo-bots", "providers", host.key] });
      await queryClient.invalidateQueries({ queryKey: ["paseo-bots", "profiles", host.key] });
      toast.show("模型已刷新", { variant: "success" });
    } catch (err) {
      toast.error(`刷新失败: ${errorText(err)}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSelectModel = (providerId: string, modelId: string) => {
    const targetProv = allProviders.find((p) => p.provider === providerId);
    onPatch?.({
      provider: providerId,
      model: modelId,
      modeId: targetProv?.defaultModeId ?? null,
      thinkingOptionId: null,
    });
    onClose();
  };

  const isSearching = searchQuery.trim().length > 0;

  // View: Search across all providers
  if (isSearching) {
    const q = searchQuery.trim().toLowerCase();
    const searchMatches: Array<{ provider: (typeof allProviders)[number]; model: (typeof currentProviderModels)[number] }> = [];
    for (const p of allProviders) {
      for (const m of (p.models ?? []).filter((m) => m.isSelectable !== false)) {
        if (
          m.label.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          (p.label ?? p.provider).toLowerCase().includes(q)
        ) {
          searchMatches.push({ provider: p, model: m });
        }
      }
    }

    return (
      <View style={{ width: "100%", maxHeight: 440 }}>
        {/* Search Bar */}
        <View style={{ flexDirection: "row", alignItems: "center", height: 42, paddingHorizontal: 12, gap: 8 }}>
          <Icon name="Search" size={15} color={colors.foregroundMuted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="搜索所有模型..."
            placeholderTextColor={placeholderColor(colors)}
            autoFocus
            style={{ flex: 1, fontSize: ui(14), color: colors.foreground, padding: 0 }}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery("")} style={{ padding: 4 }}>
              <Icon name="X" size={14} color={colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ height: 1, backgroundColor: tokens.borderAccent }} />

        {/* Search Results */}
        <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
          {searchMatches.length === 0 ? (
            <Text style={{ padding: 24, textAlign: "center", color: colors.foregroundMuted, fontSize: ui(13) }}>
              没有匹配的模型
            </Text>
          ) : (
            searchMatches.map(({ provider: p, model: m }) => {
              const isSelected = bot.provider === p.provider && resolvedCurrentModelId === m.id;
              return (
                <ModelMatchRow
                  key={`${p.provider}:${m.id}`}
                  colors={colors}
                  provider={p}
                  model={m}
                  isSelected={isSelected}
                  onSelect={() => handleSelectModel(p.provider, m.id)}
                />
              );
            })
          )}
        </ScrollView>
      </View>
    );
  }

  // View: Drilled down into Provider Models
  if (view.kind === "models") {
    const activeProv = allProviders.find((p) => p.provider === view.providerId);
    const rawModels = (activeProv?.models ?? []).filter((m) => m.isSelectable !== false);
    const filterQuery = providerSearch.trim().toLowerCase();
    const filteredModels = filterQuery
      ? rawModels.filter((m) => m.label.toLowerCase().includes(filterQuery) || m.id.toLowerCase().includes(filterQuery))
      : rawModels;

    const activeResolvedModelId = bot.provider === view.providerId ? (bot.model ?? defaultModelId(rawModels)) : null;

    return (
      <View style={{ width: "100%", maxHeight: 440 }}>
        {/* Back Button + Provider Title */}
        <View style={{ flexDirection: "row", alignItems: "center", height: 42, paddingHorizontal: 10, gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to providers"
            onPress={() => {
              setView({ kind: "providers" });
              setProviderSearch("");
            }}
            style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="ChevronLeft" size={16} color={colors.foreground} />
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
            <Icon name={providerIcon(view.providerId)} size={16} color={colors.foreground} />
            <Text style={{ fontSize: ui(14), fontWeight: "600", color: colors.foreground }}>{view.providerLabel}</Text>
          </View>
          <Text style={{ fontSize: ui(12), color: colors.foregroundMuted, paddingRight: 6 }}>
            {rawModels.length} 个模型
          </Text>
        </View>
        <View style={{ height: 1, backgroundColor: tokens.borderAccent }} />

        {/* Local Search within Provider */}
        <View style={{ flexDirection: "row", alignItems: "center", height: 38, paddingHorizontal: 12, gap: 8 }}>
          <Icon name="Search" size={14} color={colors.foregroundMuted} />
          <TextInput
            value={providerSearch}
            onChangeText={setProviderSearch}
            placeholder="搜索模型..."
            placeholderTextColor={placeholderColor(colors)}
            style={{ flex: 1, fontSize: ui(13), color: colors.foreground, padding: 0 }}
          />
          {providerSearch ? (
            <Pressable onPress={() => setProviderSearch("")} style={{ padding: 4 }}>
              <Icon name="X" size={13} color={colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ height: 1, backgroundColor: tokens.borderAccent }} />

        {/* Model List */}
        <ScrollView style={{ maxHeight: 290 }} showsVerticalScrollIndicator={false}>
          {filteredModels.length === 0 ? (
            <Text style={{ padding: 20, textAlign: "center", color: colors.foregroundMuted, fontSize: ui(13) }}>
              没有匹配的模型
            </Text>
          ) : (
            filteredModels.map((m) => {
              const isSelected = activeResolvedModelId === m.id;
              return (
                <ModelItemRow
                  key={m.id}
                  colors={colors}
                  model={m}
                  isSelected={isSelected}
                  onSelect={() => handleSelectModel(view.providerId, m.id)}
                />
              );
            })
          )}
        </ScrollView>

        {/* Refresh Models Footer */}
        <View style={{ height: 1, backgroundColor: tokens.borderAccent }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh models"
          disabled={refreshing}
          onPress={() => void handleRefresh(view.providerId)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            height: 38,
            gap: 6,
            backgroundColor: colors.surface1,
          }}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.foregroundMuted} />
          ) : (
            <Icon name="RefreshCw" size={13} color={colors.foregroundMuted} />
          )}
          <Text style={{ fontSize: ui(13), color: colors.foregroundMuted }}>
            {refreshing ? "正在刷新模型..." : "刷新模型"}
          </Text>
        </Pressable>
      </View>
    );
  }

  // View: Providers List (Matches Image 1 directly)
  return (
    <View style={{ width: "100%", maxHeight: 440 }}>
      {/* Top Search All Input */}
      <View style={{ flexDirection: "row", alignItems: "center", height: 42, paddingHorizontal: 12, gap: 8 }}>
        <Icon name="Search" size={15} color={colors.foregroundMuted} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="搜索所有模型..."
          placeholderTextColor={placeholderColor(colors)}
          style={{ flex: 1, fontSize: ui(14), color: colors.foreground, padding: 0 }}
        />
      </View>
      <View style={{ height: 1, backgroundColor: tokens.borderAccent }} />

      {/* Provider List */}
      <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
        <Text style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4, fontSize: ui(12), fontWeight: "500", color: colors.foregroundMuted }}>
          提供方
        </Text>
        {allProviders.map((p) => {
          const selectableCount = (p.models ?? []).filter((m) => m.isSelectable !== false).length;
          const isCurrentProvider = bot.provider === p.provider;
          return (
            <ProviderRow
              key={p.provider}
              colors={colors}
              provider={p}
              count={selectableCount}
              isCurrent={isCurrentProvider}
              onSelect={() =>
                setView({
                  kind: "models",
                  providerId: p.provider,
                  providerLabel: p.label ?? p.provider,
                })
              }
            />
          );
        })}

        {/* Profiles Section (if any configured) */}
        {(profiles.data ?? []).length > 0 ? (
          <>
            <View style={{ height: 1, marginVertical: 6, backgroundColor: tokens.borderAccent }} />
            <Text style={{ paddingHorizontal: 14, paddingTop: 6, paddingBottom: 4, fontSize: ui(12), fontWeight: "500", color: colors.foregroundMuted }}>
              Agent Profiles
            </Text>
            {profiles.data!.map((prof) => {
              const isCurrent = bot.provider === prof.provider && (bot.model ?? null) === (prof.model ?? null);
              return (
                <ProfileRow
                  key={prof.id}
                  colors={colors}
                  profile={prof}
                  isCurrent={isCurrent}
                  onSelect={() => {
                    onPatch?.({
                      provider: prof.provider,
                      model: prof.model ?? null,
                      modeId: prof.modeId ?? null,
                      thinkingOptionId: prof.thinkingOptionId ?? null,
                    });
                    onClose();
                  }}
                />
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ProviderRow({
  colors,
  provider,
  count,
  isCurrent,
  onSelect,
}: {
  colors: Colors;
  provider: { provider: string; label?: string };
  count: number;
  isCurrent: boolean;
  onSelect(): void;
}) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${provider.label ?? provider.provider}, ${count} models`}
      onPress={onSelect}
      {...hoverProps}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        height: 38,
        paddingHorizontal: 12,
        marginHorizontal: 4,
        marginVertical: 1,
        borderRadius: 6,
        backgroundColor: hovered ? colors.surface2 : "transparent",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Icon name={providerIcon(provider.provider)} size={16} color={colors.foreground} />
        <Text style={{ fontSize: ui(14), color: colors.foreground, fontWeight: isCurrent ? "600" : "400" }}>
          {provider.label ?? provider.provider}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontSize: ui(13), color: colors.foregroundMuted }}>
          {count} 个模型
        </Text>
        <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
      </View>
    </Pressable>
  );
}

function ModelItemRow({
  colors,
  model,
  isSelected,
  onSelect,
}: {
  colors: Colors;
  model: { id: string; label: string };
  isSelected: boolean;
  onSelect(): void;
}) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={model.label}
      onPress={onSelect}
      {...hoverProps}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        height: 36,
        paddingHorizontal: 12,
        marginHorizontal: 4,
        marginVertical: 1,
        borderRadius: 6,
        backgroundColor: hovered ? colors.surface2 : "transparent",
      }}
    >
      <Text style={{ fontSize: ui(14), color: colors.foreground, fontWeight: isSelected ? "600" : "400", flex: 1 }} numberOfLines={1}>
        {model.label}
      </Text>
      {isSelected ? <Icon name="Check" size={16} color={colors.accent} /> : null}
    </Pressable>
  );
}

function ModelMatchRow({
  colors,
  provider,
  model,
  isSelected,
  onSelect,
}: {
  colors: Colors;
  provider: { provider: string; label?: string };
  model: { id: string; label: string };
  isSelected: boolean;
  onSelect(): void;
}) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${model.label}, ${provider.label ?? provider.provider}`}
      onPress={onSelect}
      {...hoverProps}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 12,
        paddingVertical: 7,
        marginHorizontal: 4,
        marginVertical: 1,
        borderRadius: 6,
        backgroundColor: hovered ? colors.surface2 : "transparent",
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: ui(14), color: colors.foreground, fontWeight: isSelected ? "600" : "400" }} numberOfLines={1}>
          {model.label}
        </Text>
        <Text style={{ fontSize: ui(12), color: colors.foregroundMuted }}>
          提供方: {provider.label ?? provider.provider}
        </Text>
      </View>
      {isSelected ? <Icon name="Check" size={16} color={colors.accent} /> : null}
    </Pressable>
  );
}

function ProfileRow({
  colors,
  profile,
  isCurrent,
  onSelect,
}: {
  colors: Colors;
  profile: { name: string; provider: string; model?: string | null };
  isCurrent: boolean;
  onSelect(): void;
}) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Profile: ${profile.name}`}
      onPress={onSelect}
      {...hoverProps}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        height: 38,
        paddingHorizontal: 12,
        marginHorizontal: 4,
        marginVertical: 1,
        borderRadius: 6,
        backgroundColor: hovered ? colors.surface2 : "transparent",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
        <Icon name="Sparkles" size={16} color={colors.foreground} />
        <Text style={{ fontSize: ui(14), color: colors.foreground, fontWeight: isCurrent ? "600" : "400" }} numberOfLines={1}>
          {profile.name}
        </Text>
      </View>
      <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
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
