import type { HarnessGraphSnapshot, HarnessRoleDefinitionId } from "@t3tools/contracts";

export function relationshipDefinitionConflicts(
  definitions: ReadonlyArray<
    Pick<
      HarnessGraphSnapshot["relationshipDefinitions"][number],
      "requesterRoleIds" | "responderRoleIds"
    >
  >,
  requesterRoleIds: ReadonlyArray<HarnessRoleDefinitionId>,
  responderRoleIds: ReadonlyArray<HarnessRoleDefinitionId>,
): boolean {
  return definitions.some(
    (definition) =>
      definition.requesterRoleIds.some((roleId) => requesterRoleIds.includes(roleId)) &&
      definition.responderRoleIds.some((roleId) => responderRoleIds.includes(roleId)),
  );
}
