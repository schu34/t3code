import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TurnId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** Stable identity for a user-facing agent in the Harness graph. */
export const HarnessAgentId = TrimmedNonEmptyString.pipe(Schema.brand("HarnessAgentId"));
export type HarnessAgentId = typeof HarnessAgentId.Type;

export const HarnessRelationshipId = TrimmedNonEmptyString.pipe(
  Schema.brand("HarnessRelationshipId"),
);
export type HarnessRelationshipId = typeof HarnessRelationshipId.Type;

export const HarnessRoleDefinitionId = TrimmedNonEmptyString.pipe(
  Schema.brand("HarnessRoleDefinitionId"),
);
export type HarnessRoleDefinitionId = typeof HarnessRoleDefinitionId.Type;

export const HarnessRelationshipDefinitionId = TrimmedNonEmptyString.pipe(
  Schema.brand("HarnessRelationshipDefinitionId"),
);
export type HarnessRelationshipDefinitionId = typeof HarnessRelationshipDefinitionId.Type;

export const HarnessChannelId = TrimmedNonEmptyString.pipe(Schema.brand("HarnessChannelId"));
export type HarnessChannelId = typeof HarnessChannelId.Type;

export const HarnessCoordinationMessageId = TrimmedNonEmptyString.pipe(
  Schema.brand("HarnessCoordinationMessageId"),
);
export type HarnessCoordinationMessageId = typeof HarnessCoordinationMessageId.Type;

/** Structural origin of an agent in the graph; persona behavior lives in its role definition. */
export const HarnessAgentKind = Schema.Literals(["root", "delegated", "sidechat"]);
export type HarnessAgentKind = typeof HarnessAgentKind.Type;

export const HarnessAgentStatus = Schema.Literals(["active", "paused", "completed", "failed"]);
export type HarnessAgentStatus = typeof HarnessAgentStatus.Type;

export const HarnessMessageAuthorKind = Schema.Literals(["user", "agent"]);
export type HarnessMessageAuthorKind = typeof HarnessMessageAuthorKind.Type;
/** Stable locator persisted with graph metadata, not a second agent runtime. */
export const HarnessAgentBackingReference = Schema.Struct({
  kind: Schema.Literal("thread"),
  threadId: ThreadId,
});
export type HarnessAgentBackingReference = typeof HarnessAgentBackingReference.Type;

export const HarnessAgentBacking = HarnessAgentBackingReference;
export type HarnessAgentBacking = typeof HarnessAgentBacking.Type;

export const HarnessRoleDefinition = Schema.Struct({
  roleDefinitionId: HarnessRoleDefinitionId,
  name: TrimmedNonEmptyString,
  instructions: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HarnessRoleDefinition = typeof HarnessRoleDefinition.Type;

export const HarnessRelationshipDefinition = Schema.Struct({
  relationshipDefinitionId: HarnessRelationshipDefinitionId,
  name: TrimmedNonEmptyString,
  requestInstructions: Schema.String,
  responseInstructions: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HarnessRelationshipDefinition = typeof HarnessRelationshipDefinition.Type;

/** Graph-owned overlay; presentation and lifecycle belong to the backing. */
export const HarnessAgentMetadata = Schema.Struct({
  agentId: HarnessAgentId,
  backing: HarnessAgentBackingReference,
  kind: HarnessAgentKind,
  roleDefinitionId: HarnessRoleDefinitionId,
  spawnedByAgentId: Schema.optional(HarnessAgentId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HarnessAgentMetadata = typeof HarnessAgentMetadata.Type;

/** Read-only UI view assembled from graph metadata and its current backing. */
export const HarnessAgent = Schema.Struct({
  ...HarnessAgentMetadata.fields,
  backing: HarnessAgentBacking,
  projectId: ProjectId,
  displayName: TrimmedNonEmptyString,
  status: HarnessAgentStatus,
});
export type HarnessAgent = typeof HarnessAgent.Type;

export const HarnessRelationship = Schema.Struct({
  relationshipId: HarnessRelationshipId,
  sourceAgentId: HarnessAgentId,
  targetAgentId: HarnessAgentId,
  relationshipDefinitionId: HarnessRelationshipDefinitionId,
  topic: Schema.optional(TrimmedNonEmptyString),
  forkedFromTurnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});
export type HarnessRelationship = typeof HarnessRelationship.Type;

export const HarnessCoordinationMessage = Schema.Struct({
  messageId: HarnessCoordinationMessageId,
  channelId: HarnessChannelId,
  senderAgentId: HarnessAgentId,
  recipientAgentId: HarnessAgentId,
  authorKind: HarnessMessageAuthorKind,
  body: Schema.String,
  sequence: Schema.Int.check(Schema.isGreaterThan(0)),
  deduplicationKey: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type HarnessCoordinationMessage = typeof HarnessCoordinationMessage.Type;
export const HarnessChannelSummary = Schema.Struct({
  channelId: HarnessChannelId,
  relationshipId: HarnessRelationshipId,
  topic: TrimmedNonEmptyString,
  messageCount: NonNegativeInt,
  lastSequence: NonNegativeInt,
  createdAt: IsoDateTime,
});
export type HarnessChannelSummary = typeof HarnessChannelSummary.Type;
export const HarnessChannel = Schema.Struct({
  ...HarnessChannelSummary.fields,
  messages: Schema.Array(HarnessCoordinationMessage),
});
export type HarnessChannel = typeof HarnessChannel.Type;

export const HarnessGraphSnapshot = Schema.Struct({
  revision: NonNegativeInt,
  agents: Schema.Array(HarnessAgent),
  relationships: Schema.Array(HarnessRelationship),
  roleDefinitions: Schema.Array(HarnessRoleDefinition),
  relationshipDefinitions: Schema.Array(HarnessRelationshipDefinition),
  channels: Schema.Array(HarnessChannelSummary),
});
export type HarnessGraphSnapshot = typeof HarnessGraphSnapshot.Type;

export const HarnessGraphReadInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
});
export type HarnessGraphReadInput = typeof HarnessGraphReadInput.Type;

export const HarnessGraphStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: HarnessGraphSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("changed"),
    snapshot: HarnessGraphSnapshot,
  }),
]);
export type HarnessGraphStreamEvent = typeof HarnessGraphStreamEvent.Type;

export const HarnessGetChannelInput = Schema.Struct({
  channelId: HarnessChannelId,
});
export type HarnessGetChannelInput = typeof HarnessGetChannelInput.Type;

export const HarnessRegisterAgentInput = Schema.Struct({
  agentId: HarnessAgentId,
  threadId: ThreadId,
  kind: HarnessAgentKind,
  roleDefinitionId: HarnessRoleDefinitionId,
  spawnedByAgentId: Schema.optional(HarnessAgentId),
});
export type HarnessRegisterAgentInput = typeof HarnessRegisterAgentInput.Type;

export const HarnessCreateRoleDefinitionInput = Schema.Struct({
  roleDefinitionId: HarnessRoleDefinitionId,
  name: TrimmedNonEmptyString,
  instructions: Schema.String,
});
export type HarnessCreateRoleDefinitionInput = typeof HarnessCreateRoleDefinitionInput.Type;

export const HarnessCreateRelationshipDefinitionInput = Schema.Struct({
  relationshipDefinitionId: HarnessRelationshipDefinitionId,
  name: TrimmedNonEmptyString,
  requestInstructions: Schema.String,
  responseInstructions: Schema.String,
});
export type HarnessCreateRelationshipDefinitionInput =
  typeof HarnessCreateRelationshipDefinitionInput.Type;

export const HarnessUpsertRelationshipInput = Schema.Struct({
  relationshipId: Schema.optional(HarnessRelationshipId),
  sourceAgentId: HarnessAgentId,
  targetAgentId: HarnessAgentId,
  relationshipDefinitionId: HarnessRelationshipDefinitionId,
  topic: Schema.optional(TrimmedNonEmptyString),
  forkedFromTurnId: Schema.optional(TurnId),
});
export type HarnessUpsertRelationshipInput = typeof HarnessUpsertRelationshipInput.Type;

export const HarnessOpenChannelInput = Schema.Struct({
  channelId: Schema.optional(HarnessChannelId),
  relationshipId: HarnessRelationshipId,
  topic: TrimmedNonEmptyString,
});
export type HarnessOpenChannelInput = typeof HarnessOpenChannelInput.Type;
export const HarnessSendCoordinationMessageInput = Schema.Struct({
  channelId: HarnessChannelId,
  senderAgentId: HarnessAgentId,
  authorKind: HarnessMessageAuthorKind,
  body: Schema.String,
  deduplicationKey: TrimmedNonEmptyString,
});
export type HarnessSendCoordinationMessageInput = typeof HarnessSendCoordinationMessageInput.Type;

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
