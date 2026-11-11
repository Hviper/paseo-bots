import { describe, expect, it, vi } from "vitest";
import {
  buildAgentInternalRoute,
  buildAgentNativeDeepLink,
  findAgentId,
  isCreateAgentTool,
  openAgentRoute,
  subagentInfoOf,
} from "../shared/subagent-jump";

describe("subagent-jump", () => {
  it("detects create_agent tool names", () => {
    expect(isCreateAgentTool("create_agent")).toBe(true);
    expect(isCreateAgentTool("mcp__paseo__create_agent")).toBe(true);
    expect(isCreateAgentTool("paseo.create_agent")).toBe(true);
    expect(isCreateAgentTool("invoke_subagent")).toBe(true);
    expect(isCreateAgentTool("call_mcp_tool", { ServerName: "paseo", ToolName: "create_agent" })).toBe(true);
    expect(isCreateAgentTool("read_file")).toBe(false);
    expect(isCreateAgentTool("run_command")).toBe(false);
  });

  it("extracts agent ID from stringified JSON and objects", () => {
    const uuid = "8f9c1a4f-12f9-47a5-ac7c-f4cac00bee19";
    expect(findAgentId({ agentId: uuid })).toBe(uuid);
    expect(findAgentId(JSON.stringify({ agentId: uuid }))).toBe(uuid);
    expect(findAgentId({ structuredContent: { agentId: uuid } })).toBe(uuid);
    expect(findAgentId(`Agent spawned successfully: ${uuid}`)).toBe(uuid);
    expect(findAgentId({ content: [{ type: "text", text: `ID: ${uuid}` }] })).toBe(uuid);
    expect(findAgentId("no id here")).toBe(null);
  });

  it("extracts subagent info from finished create_agent call", () => {
    const uuid = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
    const result = subagentInfoOf({
      name: "create_agent",
      status: "completed",
      detail: {
        type: "unknown",
        input: {
          title: "验数子代理",
          initialPrompt: "请检查 DWD 表数据完整度",
        },
        output: JSON.stringify({ agentId: uuid, status: "idle" }),
      },
    });

    expect(result).toEqual({
      agentId: uuid,
      title: "验数子代理",
      status: "completed",
      prompt: "请检查 DWD 表数据完整度",
    });
  });

  it("extracts subagent info from call_mcp_tool wrapper", () => {
    const uuid = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
    const result = subagentInfoOf({
      name: "call_mcp_tool",
      status: "completed",
      detail: {
        type: "unknown",
        input: {
          ServerName: "paseo",
          ToolName: "create_agent",
          Arguments: {
            title: "代码审查专家",
          },
        },
        output: { agentId: uuid, status: "running" },
      },
    });

    expect(result).toEqual({
      agentId: uuid,
      title: "代码审查专家",
      status: "completed",
    });
  });

  it("returns null if agentId has not arrived yet (streaming/running)", () => {
    const result = subagentInfoOf({
      name: "create_agent",
      status: "running",
      detail: {
        type: "unknown",
        input: { title: "后台任务" },
        output: null,
      },
    });
    expect(result).toBe(null);
  });

  it("ignores unrelated tool calls", () => {
    expect(
      subagentInfoOf({
        name: "run_command",
        status: "completed",
        detail: { type: "shell", command: "ls -la", output: "some output" },
      }),
    ).toBe(null);
  });

  it("builds correct internal route for Expo Router on web", () => {
    const route = buildAgentInternalRoute("srv_T3_NziK01RcU", "65c503d6-464b-47c0-8bb4-ffa0cd44aef7");
    expect(route).toBe("/h/srv_T3_NziK01RcU/agent/65c503d6-464b-47c0-8bb4-ffa0cd44aef7");

    const fallbackRoute = buildAgentInternalRoute("", "abc");
    expect(fallbackRoute).toBe("/h/local/agent/abc");
  });

  it("builds native deep link for external / mobile launches", () => {
    const link = buildAgentNativeDeepLink("srv_T3_NziK01RcU", "65c503d6-464b-47c0-8bb4-ffa0cd44aef7");
    expect(link).toBe("paseo://h/srv_T3_NziK01RcU/agent/65c503d6-464b-47c0-8bb4-ffa0cd44aef7");
  });

  it("openAgentRoute prefers navigation.openAgent when available", () => {
    const openAgentMock = vi.fn();
    const result = openAgentRoute({
      agentId: "agent-123",
      serverId: "srv_test",
      navigation: { openAgent: openAgentMock },
    });
    expect(result).toEqual({ method: "navigation" });
    expect(openAgentMock).toHaveBeenCalledWith({
      agentId: "agent-123",
      serverId: "srv_test",
    });
  });

  it("openAgentRoute performs client-side pushState and popstate dispatch on web", () => {
    const pushStateMock = vi.fn();
    const dispatchMock = vi.fn();
    class MockEvent {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    }

    const mockWindow = {
      history: { pushState: pushStateMock },
      dispatchEvent: dispatchMock,
      Event: MockEvent as any,
    };

    const result = openAgentRoute({
      agentId: "agent-456",
      serverId: "srv_web",
      isWeb: true,
      window: mockWindow,
    });

    expect(result).toEqual({
      method: "history",
      url: "/h/srv_web/agent/agent-456",
    });
    expect(pushStateMock).toHaveBeenCalledWith(null, "", "/h/srv_web/agent/agent-456");
    expect(dispatchMock).toHaveBeenCalled();
    const dispatchedEvent = dispatchMock.mock.calls[0][0];
    expect(dispatchedEvent.type).toBe("popstate");
  });

  it("openAgentRoute falls back to location.assign if pushState is not a function", () => {
    const assignMock = vi.fn();
    const mockWindow = {
      location: { assign: assignMock },
    };

    const result = openAgentRoute({
      agentId: "agent-789",
      serverId: "srv_web",
      isWeb: true,
      window: mockWindow,
    });

    expect(result).toEqual({
      method: "assign",
      url: "/h/srv_web/agent/agent-789",
    });
    expect(assignMock).toHaveBeenCalledWith("/h/srv_web/agent/agent-789");
  });

  it("openAgentRoute falls back to native deep link when off web", () => {
    const openUrlMock = vi.fn();
    const result = openAgentRoute({
      agentId: "agent-999",
      serverId: "srv_mobile",
      isWeb: false,
      openUrl: openUrlMock,
    });

    expect(result).toEqual({
      method: "openUrl",
      url: "paseo://h/srv_mobile/agent/agent-999",
    });
    expect(openUrlMock).toHaveBeenCalledWith("paseo://h/srv_mobile/agent/agent-999");
  });
});
