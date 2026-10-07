import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applyHarnessRolePrompt } from "./harnessGraphPrompt.ts";

describe("applyHarnessRolePrompt", () => {
  it("prefixes role instructions without changing the stored user message", () => {
    const result = applyHarnessRolePrompt("Review this implementation", {
      name: "Implementor",
      instructions: "Prefer small, tested changes.",
    });

    expect(result).toContain("### Role: Implementor\nPrefer small, tested changes.");
    expect(result).toContain("### User request\n\nReview this implementation");
  });

  it("leaves prompts unchanged without a role or with blank instructions", () => {
    expect(applyHarnessRolePrompt("Hello", undefined)).toBe("Hello");
    expect(applyHarnessRolePrompt("Hello", { name: "Empty", instructions: "  " })).toBe("Hello");
  });

  it("never pushes the user message past the provider input limit", () => {
    const message = "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS - 10);
    const result = applyHarnessRolePrompt(message, { name: "Long", instructions: "y".repeat(500) });
    expect(result.length).toBeLessThanOrEqual(PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
    expect(result.endsWith(message)).toBe(true);
  });
});
