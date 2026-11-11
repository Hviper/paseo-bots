import { describe, expect, it } from "vitest";
import { settingsRevisionRpc } from "../shared/rpc";

describe("settingsRevisionRpc", () => {
  it("defines contract for checking settings revision on disk", () => {
    expect(settingsRevisionRpc.name).toBe("bots.settings.revision");
    expect(settingsRevisionRpc.input.parse({})).toEqual({});
    expect(settingsRevisionRpc.output.parse({ revision: "abc123sha" })).toEqual({
      revision: "abc123sha",
    });
  });

  it("fails output validation on invalid shapes", () => {
    expect(() => settingsRevisionRpc.output.parse({})).toThrow();
    expect(() => settingsRevisionRpc.output.parse({ revision: 123 })).toThrow();
  });
});
