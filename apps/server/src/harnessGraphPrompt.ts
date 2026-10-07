import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";

export interface HarnessPromptRole {
  readonly name: string;
  readonly instructions: string;
}

/** Keep role behavior in the provider request, not in the persisted user message. */
export function applyHarnessRolePrompt(
  userMessage: string,
  role: HarnessPromptRole | undefined,
): string {
  const instructions = role?.instructions.trim();
  if (role === undefined || !instructions) return userMessage;
  const prefix = [
    "Follow the applicable T3 Harness role instructions while handling this request.",
    `### Role: ${role.name}\n${instructions}`,
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
