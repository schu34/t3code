import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TurnId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const HarnessRoleId = TrimmedNonEmptyString.pipe(Schema.brand("HarnessRoleId"));
export type HarnessRoleId = typeof HarnessRoleId.Type;

export const HarnessEdgeId = TrimmedNonEmptyString.pipe(Schema.brand("HarnessEdgeId"));
export type HarnessEdgeId = typeof HarnessEdgeId.Type;

export const HarnessAgentStatus = Schema.Literals(["active", "paused", "completed", "failed"]);
export type HarnessAgentStatus = typeof HarnessAgentStatus.Type;

/** Reusable instructions applied to every turn of the agents assigned to it. */
export const HarnessRole = Schema.Struct({
  roleId: HarnessRoleId,
  name: TrimmedNonEmptyString,
  instructions: Schema.String,
  createdAt: IsoDateTime,
});
export type HarnessRole = typeof HarnessRole.Type;

/**
 * Graph-owned data for one thread. Every project thread is an agent; a thread
 * without stored metadata is a root agent with no role.
 */
export const HarnessAgentMetadata = Schema.Struct({
  threadId: ThreadId,
  roleId: Schema.optional(HarnessRoleId),
  /** Creator thread. Absent for root agents. */
  parentThreadId: Schema.optional(ThreadId),
  /** Parent turn a side chat was forked from. */
  forkedFromTurnId: Schema.optional(TurnId),
});
export type HarnessAgentMetadata = typeof HarnessAgentMetadata.Type;

/**
 * Read view assembled from metadata and the backing thread. Provider-native
 * children are derived from provider activity, addressed by their child
 * transcript thread id, and are inspect-only.
 */
export const HarnessAgent = Schema.Struct({
  ...HarnessAgentMetadata.fields,
  projectId: ProjectId,
  displayName: TrimmedNonEmptyString,
  status: HarnessAgentStatus,
  native: Schema.optional(
    Schema.Struct({
      provider: TrimmedNonEmptyString,
      providerAgentId: TrimmedNonEmptyString,
    }),
  ),
});
export type HarnessAgent = typeof HarnessAgent.Type;

/** A user-drawn communication link between two agents, separate from creation. */
export const HarnessEdge = Schema.Struct({
  edgeId: HarnessEdgeId,
  sourceThreadId: ThreadId,
  targetThreadId: ThreadId,
  label: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type HarnessEdge = typeof HarnessEdge.Type;

export const HarnessGraphSnapshot = Schema.Struct({
  agents: Schema.Array(HarnessAgent),
  edges: Schema.Array(HarnessEdge),
  roles: Schema.Array(HarnessRole),
});
export type HarnessGraphSnapshot = typeof HarnessGraphSnapshot.Type;

export const HarnessGraphReadInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
});
export type HarnessGraphReadInput = typeof HarnessGraphReadInput.Type;

export const HarnessCreateRoleInput = Schema.Struct({
  roleId: HarnessRoleId,
  name: TrimmedNonEmptyString,
  instructions: Schema.String,
});
export type HarnessCreateRoleInput = typeof HarnessCreateRoleInput.Type;

/**
 * Upserts a thread's graph metadata. An omitted role is left unchanged and
 * `null` clears it. Creation origin can be set once and never changed.
 */
export const HarnessSetAgentInput = Schema.Struct({
  threadId: ThreadId,
  roleId: Schema.optional(Schema.NullOr(HarnessRoleId)),
  parentThreadId: Schema.optional(ThreadId),
  forkedFromTurnId: Schema.optional(TurnId),
});
export type HarnessSetAgentInput = typeof HarnessSetAgentInput.Type;

export const HarnessUpsertEdgeInput = Schema.Struct({
  edgeId: Schema.optional(HarnessEdgeId),
  sourceThreadId: ThreadId,
  targetThreadId: ThreadId,
  label: Schema.optional(TrimmedNonEmptyString),
});
export type HarnessUpsertEdgeInput = typeof HarnessUpsertEdgeInput.Type;

export class HarnessGraphValidationError extends Schema.TaggedError<HarnessGraphValidationError>()(
  "HarnessGraphValidationError",
  {
    operation: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}

export class HarnessGraphPersistenceError extends Schema.TaggedError<HarnessGraphPersistenceError>()(
  "HarnessGraphPersistenceError",
  {
    operation: TrimmedNonEmptyString,
    detail: Schema.optional(TrimmedNonEmptyString),
  },
) {
  override get message(): string {
    return this.detail === undefined
      ? `Harness graph persistence failed in ${this.operation}.`
      : `Harness graph persistence failed in ${this.operation}: ${this.detail}`;
  }
}

export const HarnessGraphError = Schema.Union([
  HarnessGraphValidationError,
  HarnessGraphPersistenceError,
]);
export type HarnessGraphError = typeof HarnessGraphError.Type;
