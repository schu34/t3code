import { HarnessRoleDefinitionId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { relationshipDefinitionConflicts } from "./harnessDefinition.logic";

describe("relationshipDefinitionConflicts", () => {
  const projectId = ProjectId.make("project-1");
  const pm = HarnessRoleDefinitionId.make("role-pm");
  const implementor = HarnessRoleDefinitionId.make("role-implementor");
  const seniorEngineer = HarnessRoleDefinitionId.make("role-senior-engineer");

  it("allows one reusable definition to cover multiple role pairs", () => {
    expect(
      relationshipDefinitionConflicts(
        [
          {
            projectId,
            requesterRoleIds: [pm],
            responderRoleIds: [seniorEngineer],
          },
        ],
        projectId,
        [pm],
        [implementor],
      ),
    ).toBe(false);
  });

  it("rejects a second behavior for an already-covered ordered role pair", () => {
    expect(
      relationshipDefinitionConflicts(
        [
          {
            projectId,
            requesterRoleIds: [pm],
            responderRoleIds: [implementor, seniorEngineer],
          },
        ],
        projectId,
        [pm],
        [implementor],
      ),
    ).toBe(true);
  });
});
