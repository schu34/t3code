import { HarnessRoleDefinitionId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { relationshipDefinitionConflicts } from "./harnessDefinition.logic";

describe("relationshipDefinitionConflicts", () => {
  const pm = HarnessRoleDefinitionId.make("role-pm");
  const implementor = HarnessRoleDefinitionId.make("role-implementor");
  const seniorEngineer = HarnessRoleDefinitionId.make("role-senior-engineer");

  it("allows one reusable definition to cover multiple role pairs", () => {
    expect(
      relationshipDefinitionConflicts(
        [
          {
            requesterRoleIds: [pm],
            responderRoleIds: [seniorEngineer],
          },
        ],
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
            requesterRoleIds: [pm],
            responderRoleIds: [implementor, seniorEngineer],
          },
        ],
        [pm],
        [implementor],
      ),
    ).toBe(true);
  });

  it("keeps request and response direction distinct", () => {
    expect(
      relationshipDefinitionConflicts(
        [{ requesterRoleIds: [implementor], responderRoleIds: [pm] }],
        [pm],
        [implementor],
      ),
    ).toBe(false);
  });
});
