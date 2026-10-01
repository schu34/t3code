import type { HarnessGraphSnapshot, HarnessRoleDefinitionId, ProjectId } from "@t3tools/contracts";

export function relationshipDefinitionConflicts(
  definitions: ReadonlyArray<
    Pick<
      HarnessGraphSnapshot["relationshipDefinitions"][number],
      "projectId" | "requesterRoleIds" | "responderRoleIds"
    >
  >,
  projectId: ProjectId,
  requesterRoleIds: ReadonlyArray<HarnessRoleDefinitionId>,
  responderRoleIds: ReadonlyArray<HarnessRoleDefinitionId>,
): boolean {
  return definitions.some(
    (definition) =>
      definition.projectId === projectId &&
      definition.requesterRoleIds.some((roleId) => requesterRoleIds.includes(roleId)) &&
      definition.responderRoleIds.some((roleId) => responderRoleIds.includes(roleId)),
  );
}
