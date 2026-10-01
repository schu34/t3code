export interface HarnessPromptRelationshipInstruction {
  readonly name: string;
  readonly direction: "requester" | "responder";
  readonly instructions: string;
}

export interface HarnessPromptBehavior {
  readonly role?: {
    readonly name: string;
    readonly instructions: string;
  };
  readonly relationships: ReadonlyArray<HarnessPromptRelationshipInstruction>;
}

/** Keep behavior in the provider request, not in the persisted user message. */
export function applyHarnessPromptBehavior(
  userMessage: string,
  behavior: HarnessPromptBehavior,
): string {
  const sections: Array<string> = [];
  const role = behavior.role;
  const roleInstructions = role?.instructions.trim();
  if (role && roleInstructions) {
    sections.push(`### Role: ${role.name}\n${roleInstructions}`);
  }
  for (const relationship of behavior.relationships) {
    const instructions = relationship.instructions.trim();
    if (!instructions) continue;
    sections.push(
      `### Relationship: ${relationship.name} (${relationship.direction})\n${instructions}`,
    );
  }
  if (sections.length === 0) return userMessage;
  const prefix = [
    "Follow the applicable T3 Harness behavior instructions while handling this request.",
    ...sections,
    "### User request",
  ].join("\n\n");
  const availablePrefixLength = Math.max(
    0,
    PROVIDER_SEND_TURN_MAX_INPUT_CHARS - userMessage.length - 2,
  );
  if (prefix.length > availablePrefixLength) {
    return availablePrefixLength === 0
      ? userMessage
      : `${prefix.slice(0, availablePrefixLength)}\n\n${userMessage}`;
  }
  return `${prefix}\n\n${userMessage}`;
}
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";
