import {
  HarnessRelationshipDefinitionId,
  HarnessRoleDefinitionId,
  type HarnessCreateRelationshipDefinitionInput,
  type HarnessCreateRoleDefinitionInput,
  type HarnessGraphSnapshot,
  type HarnessRegisterAgentInput,
  type ProjectId,
} from "@t3tools/contracts";
import { useState, type FormEvent } from "react";
import { randomUUID } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

type AuthoringTab = "roles" | "relationships";

export interface HarnessDefinitionProject {
  readonly id: ProjectId;
  readonly title: string;
}

export default function HarnessDefinitionDialog({
  open,
  onOpenChange,
  projects,
  graph,
  onCreateRole,
  onAssignRole,
  onCreateRelationship,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projects: ReadonlyArray<HarnessDefinitionProject>;
  readonly graph: HarnessGraphSnapshot | null;
  readonly onCreateRole: (input: HarnessCreateRoleDefinitionInput) => Promise<void>;
  readonly onAssignRole: (input: HarnessRegisterAgentInput) => Promise<void>;
  readonly onCreateRelationship: (input: HarnessCreateRelationshipDefinitionInput) => Promise<void>;
}) {
  const [tab, setTab] = useState<AuthoringTab>("roles");
  const [projectId, setProjectId] = useState<ProjectId | "">(projects[0]?.id ?? "");
  const [roleName, setRoleName] = useState("");
  const [roleInstructions, setRoleInstructions] = useState("");
  const [agentToAssignId, setAgentToAssignId] = useState("");
  const [roleToAssignId, setRoleToAssignId] = useState<HarnessRoleDefinitionId | "">("");
  const [relationshipName, setRelationshipName] = useState("");
  const [requestInstructions, setRequestInstructions] = useState("");
  const [responseInstructions, setResponseInstructions] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleProjectId = projects.some((project) => project.id === projectId)
    ? projectId
    : (projects[0]?.id ?? "");
  const roles = graph?.roleDefinitions ?? [];
  const relationships = graph?.relationshipDefinitions ?? [];
  const assignableAgents =
    graph?.agents.filter(
      (agent) => agent.projectId === visibleProjectId && agent.backing.kind === "thread",
    ) ?? [];

  const submitRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await onCreateRole({
        roleDefinitionId: HarnessRoleDefinitionId.make("role:" + randomUUID()),
        name: roleName.trim(),
        instructions: roleInstructions,
      });
      setRoleName("");
      setRoleInstructions("");
    } catch {
      setError("Could not create this role. Check the name and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const submitRelationship = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await onCreateRelationship({
        relationshipDefinitionId: HarnessRelationshipDefinitionId.make(
          "relationship:" + randomUUID(),
        ),
        name: relationshipName.trim(),
        requestInstructions,
        responseInstructions,
      });
      setRelationshipName("");
      setRequestInstructions("");
      setResponseInstructions("");
    } catch {
      setError("Could not create this relationship. Check its name and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const submitRoleAssignment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const agent = assignableAgents.find((candidate) => candidate.agentId === agentToAssignId);
    if (agent === undefined || agent.backing.kind !== "thread" || roleToAssignId === "") return;
    setIsSaving(true);
    setError(null);
    try {
      await onAssignRole({
        agentId: agent.agentId,
        threadId: agent.backing.threadId,
        kind: agent.kind,
        roleDefinitionId: roleToAssignId,
        ...(agent.spawnedByAgentId === undefined
          ? {}
          : { spawnedByAgentId: agent.spawnedByAgentId }),
      });
    } catch {
      setError("Could not assign this role to the selected agent.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Roles & relationships</DialogTitle>
          <DialogDescription>
            Define reusable roles and relationships for all projects in this environment.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-4" scrollFade={false}>
          <div className="flex gap-2 border-b border-border/70 pb-2" role="tablist">
            {(["roles", "relationships"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={tab === value ? "secondary" : "ghost"}
                role="tab"
                aria-selected={tab === value}
                onClick={() => {
                  setTab(value);
                  setError(null);
                }}
              >
                {value === "roles" ? "Roles" : "Relationships"}
              </Button>
            ))}
          </div>

          {tab === "roles" ? (
            <>
              <form className="grid gap-3" onSubmit={submitRole}>
                <div className="grid gap-2">
                  <Label htmlFor="harness-role-name">Role name</Label>
                  <Input
                    id="harness-role-name"
                    value={roleName}
                    onChange={(event) => setRoleName(event.target.value)}
                    placeholder="Senior engineer"
                    maxLength={120}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="harness-role-instructions">Instructions</Label>
                  <Textarea
                    id="harness-role-instructions"
                    value={roleInstructions}
                    onChange={(event) => setRoleInstructions(event.target.value)}
                    placeholder="Review architecture, call out risks, and explain tradeoffs."
                    rows={4}
                  />
                </div>
                <div className="grid gap-2">
                  <h3 className="text-xs font-semibold text-muted-foreground">Available roles</h3>
                  {roles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No roles have been created.</p>
                  ) : (
                    roles.map((role) => (
                      <div key={role.roleDefinitionId} className="rounded-md border px-3 py-2">
                        <p className="text-sm font-medium">{role.name}</p>
                        {role.instructions ? (
                          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                            {role.instructions}
                          </p>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
                <DialogFooter variant="bare" className="px-0">
                  <Button type="submit" disabled={isSaving || roleName.trim().length === 0}>
                    Create role
                  </Button>
                </DialogFooter>
              </form>
              <form className="grid gap-2 rounded-lg border p-3" onSubmit={submitRoleAssignment}>
                <h3 className="text-sm font-semibold">Assign a role to an agent</h3>
                {projects.length > 0 ? (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Project
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                      value={visibleProjectId}
                      onChange={(event) => {
                        setProjectId(event.target.value as ProjectId);
                        setAgentToAssignId("");
                        setError(null);
                      }}
                      disabled={isSaving}
                    >
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {assignableAgents.length === 0 || roles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Create a role, then choose a project with an agent to assign it to.
                  </p>
                ) : (
                  <>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      Agent
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                        value={agentToAssignId}
                        onChange={(event) => setAgentToAssignId(event.target.value)}
                        disabled={isSaving}
                      >
                        <option value="">Choose an agent…</option>
                        {assignableAgents.map((agent) => (
                          <option key={agent.agentId} value={agent.agentId}>
                            {agent.displayName} —{" "}
                            {roles.find((role) => role.roleDefinitionId === agent.roleDefinitionId)
                              ?.name ?? "Unknown role"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      Role
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                        value={roleToAssignId}
                        onChange={(event) =>
                          setRoleToAssignId(event.target.value as HarnessRoleDefinitionId)
                        }
                        disabled={isSaving}
                      >
                        <option value="">Choose a role…</option>
                        {roles.map((role) => (
                          <option key={role.roleDefinitionId} value={role.roleDefinitionId}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={isSaving || agentToAssignId === "" || roleToAssignId === ""}
                      >
                        Assign role
                      </Button>
                    </div>
                  </>
                )}
              </form>
            </>
          ) : (
            <form className="grid gap-3" onSubmit={submitRelationship}>
              <div className="grid gap-2">
                <Label htmlFor="harness-relationship-name">Relationship name</Label>
                <Input
                  id="harness-relationship-name"
                  value={relationshipName}
                  onChange={(event) => setRelationshipName(event.target.value)}
                  placeholder="Product decision"
                  maxLength={120}
                  required
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid content-start gap-2">
                  <Label htmlFor="harness-request-instructions">When requesting</Label>
                  <Textarea
                    id="harness-request-instructions"
                    value={requestInstructions}
                    onChange={(event) => setRequestInstructions(event.target.value)}
                    placeholder="Frame the question as a product decision."
                    rows={4}
                  />
                </div>
                <div className="grid content-start gap-2">
                  <Label htmlFor="harness-response-instructions">When responding</Label>
                  <Textarea
                    id="harness-response-instructions"
                    value={responseInstructions}
                    onChange={(event) => setResponseInstructions(event.target.value)}
                    placeholder="Give a recommendation and explain why."
                    rows={4}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <h3 className="text-xs font-semibold text-muted-foreground">
                  Available relationships
                </h3>
                {relationships.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No relationships have been created.
                  </p>
                ) : (
                  relationships.map((relationship) => (
                    <div
                      key={relationship.relationshipDefinitionId}
                      className="rounded-md border px-3 py-2"
                    >
                      <p className="text-sm font-medium">{relationship.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {relationship.requestInstructions || "No request instructions"} →{" "}
                        {relationship.responseInstructions || "No response instructions"}
                      </p>
                    </div>
                  ))
                )}
              </div>
              <DialogFooter variant="bare" className="px-0">
                <Button type="submit" disabled={isSaving || relationshipName.trim().length === 0}>
                  Create relationship
                </Button>
              </DialogFooter>
            </form>
          )}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
