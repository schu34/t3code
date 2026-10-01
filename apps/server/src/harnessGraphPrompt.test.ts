import { describe, expect, it } from "vite-plus/test";

import { applyHarnessPromptBehavior } from "./harnessGraphPrompt.ts";

describe("applyHarnessPromptBehavior", () => {
  it("adds role and requester instructions without changing the stored user message", () => {
    const result = applyHarnessPromptBehavior("Review this implementation", {
      role: { name: "Implementor", instructions: "Prefer small, tested changes." },
      relationships: [
        {
          name: "Senior review",
          direction: "requester",
          instructions: "Ask for a code review and include the tradeoffs.",
        },
      ],
    });

    expect(result).toContain("### Role: Implementor");
    expect(result).toContain("Prefer small, tested changes.");
    expect(result).toContain("### Relationship: Senior review (requester)");
    expect(result).toContain("Ask for a code review and include the tradeoffs.");
    expect(result).toContain("### User request\n\nReview this implementation");
  });

  it("selects responder instructions for the receiving side", () => {
    expect(
      applyHarnessPromptBehavior("Please review this", {
        relationships: [
          {
            name: "Senior review",
            direction: "responder",
            instructions: "Review correctness and identify risky assumptions.",
          },
        ],
      }),
    ).toContain("### Relationship: Senior review (responder)");
  });

  it("leaves ordinary thread prompts unchanged when no Harness behavior applies", () => {
    expect(applyHarnessPromptBehavior("Hello", { relationships: [] })).toBe("Hello");
  });
});
