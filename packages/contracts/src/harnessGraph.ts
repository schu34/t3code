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

export const HarnessDeliveryId = TrimmedNonEmptyString.pipe(Schema.brand("HarnessDeliveryId"));
export type HarnessDeliveryId = typeof HarnessDeliveryId.Type;

/** Structural origin of an agent in the graph; persona behavior lives in its role definition. */
export const HarnessAgentKind = Schema.Literals(["root", "delegated", "sidechat"]);
export type HarnessAgentKind = typeof HarnessAgentKind.Type;

export const HarnessAgentStatus = Schema.Literals(["active", "paused", "completed", "failed"]);
export type HarnessAgentStatus = typeof HarnessAgentStatus.Type;

/** Structural edge used for graph layout; interaction behavior lives in its definition. */
export const HarnessRelationshipStructure = Schema.Literals(["delegation", "sidechat"]);
export type HarnessRelationshipStructure = typeof HarnessRelationshipStructure.Type;

export const HarnessCoordinationStatus = Schema.Literals([
  "syncing",
  "aligned",
  "needs-attention",
  "paused",
]);
export type HarnessCoordinationStatus = typeof HarnessCoordinationStatus.Type;

export const HarnessDeliveryState = Schema.Literals([
  "pending",
  "delivered",
  "acknowledged",
  "failed",
]);
export type HarnessDeliveryState = typeof HarnessDeliveryState.Type;

export const HarnessDeliverySide = Schema.Literals(["outbox", "inbox"]);
export type HarnessDeliverySide = typeof HarnessDeliverySide.Type;

export const HarnessMessageAuthorKind = Schema.Literals(["user", "agent"]);
export type HarnessMessageAuthorKind = typeof HarnessMessageAuthorKind.Type;

export const HarnessCoordinationMessageKind = TrimmedNonEmptyString;
export type HarnessCoordinationMessageKind = typeof HarnessCoordinationMessageKind.Type;

/** A bounded convergence round. A channel may never negotiate beyond round 3. */
export const HarnessConvergenceRound = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 3 }),
);
export type HarnessConvergenceRound = typeof HarnessConvergenceRound.Type;

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
  requesterRoleIds: Schema.Array(HarnessRoleDefinitionId),
  responderRoleIds: Schema.Array(HarnessRoleDefinitionId),
  requestInstructions: Schema.String,
  responseInstructions: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HarnessRelationshipDefinition = typeof HarnessRelationshipDefinition.Type;

export const HarnessAgent = Schema.Struct({
  agentId: HarnessAgentId,
  threadId: ThreadId,
  projectId: ProjectId,
  displayName: TrimmedNonEmptyString,
  kind: HarnessAgentKind,
  roleDefinitionId: HarnessRoleDefinitionId,
  status: HarnessAgentStatus,
  parentAgentId: Schema.optional(HarnessAgentId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HarnessAgent = typeof HarnessAgent.Type;

export const HarnessRelationship = Schema.Struct({
  relationshipId: HarnessRelationshipId,
  sourceAgentId: HarnessAgentId,
  targetAgentId: HarnessAgentId,
  structure: HarnessRelationshipStructure,
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
  kind: HarnessCoordinationMessageKind,
  topic: TrimmedNonEmptyString,
  body: Schema.String,
  summary: Schema.optional(Schema.String),
  decisions: Schema.Array(Schema.String),
  revision: NonNegativeInt,
  round: HarnessConvergenceRound,
  deduplicationKey: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type HarnessCoordinationMessage = typeof HarnessCoordinationMessage.Type;

export const HarnessDelivery = Schema.Struct({
  deliveryId: HarnessDeliveryId,
  messageId: HarnessCoordinationMessageId,
  channelId: HarnessChannelId,
  senderAgentId: HarnessAgentId,
  recipientAgentId: HarnessAgentId,
  side: HarnessDeliverySide,
  state: HarnessDeliveryState,
  attemptCount: NonNegativeInt,
  lastError: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HarnessDelivery = typeof HarnessDelivery.Type;

export const HarnessChannel = Schema.Struct({
  channelId: HarnessChannelId,
  agentAId: HarnessAgentId,
  agentBId: HarnessAgentId,
  topic: TrimmedNonEmptyString,
  status: HarnessCoordinationStatus,
  summary: Schema.optional(Schema.String),
  decisions: Schema.Array(Schema.String),
  revisionA: NonNegativeInt,
  revisionB: NonNegativeInt,
  acknowledgedRevisionA: NonNegativeInt,
  acknowledgedRevisionB: NonNegativeInt,
  convergenceRound: NonNegativeInt,
  messages: Schema.Array(HarnessCoordinationMessage),
  outbox: Schema.Array(HarnessDelivery),
  inbox: Schema.Array(HarnessDelivery),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HarnessChannel = typeof HarnessChannel.Type;

/** Lightweight channel row used by graph snapshots and canvas subscriptions. */
export const HarnessChannelSummary = Schema.Struct({
  channelId: HarnessChannelId,
  agentAId: HarnessAgentId,
  agentBId: HarnessAgentId,
  topic: TrimmedNonEmptyString,
  status: HarnessCoordinationStatus,
  summary: Schema.optional(Schema.String),
  decisions: Schema.Array(Schema.String),
  revisionA: NonNegativeInt,
  revisionB: NonNegativeInt,
  acknowledgedRevisionA: NonNegativeInt,
  acknowledgedRevisionB: NonNegativeInt,
  convergenceRound: NonNegativeInt,
  messageCount: NonNegativeInt,
  pendingOutboxCount: NonNegativeInt,
  pendingInboxCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HarnessChannelSummary = typeof HarnessChannelSummary.Type;

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
  projectId: ProjectId,
  displayName: TrimmedNonEmptyString,
  kind: HarnessAgentKind,
  roleDefinitionId: HarnessRoleDefinitionId,
  parentAgentId: Schema.optional(HarnessAgentId),
  status: Schema.optional(HarnessAgentStatus),
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
  requesterRoleIds: Schema.Array(HarnessRoleDefinitionId),
  responderRoleIds: Schema.Array(HarnessRoleDefinitionId),
  requestInstructions: Schema.String,
  responseInstructions: Schema.String,
});
export type HarnessCreateRelationshipDefinitionInput =
  typeof HarnessCreateRelationshipDefinitionInput.Type;

export const HarnessUpsertRelationshipInput = Schema.Struct({
  relationshipId: Schema.optional(HarnessRelationshipId),
  sourceAgentId: HarnessAgentId,
  targetAgentId: HarnessAgentId,
  structure: HarnessRelationshipStructure,
  relationshipDefinitionId: HarnessRelationshipDefinitionId,
  topic: Schema.optional(TrimmedNonEmptyString),
  forkedFromTurnId: Schema.optional(TurnId),
});
export type HarnessUpsertRelationshipInput = typeof HarnessUpsertRelationshipInput.Type;

export const HarnessOpenChannelInput = Schema.Struct({
  channelId: Schema.optional(HarnessChannelId),
  agentAId: HarnessAgentId,
  agentBId: HarnessAgentId,
  topic: TrimmedNonEmptyString,
});
export type HarnessOpenChannelInput = typeof HarnessOpenChannelInput.Type;

export const HarnessSendCoordinationMessageInput = Schema.Struct({
  channelId: HarnessChannelId,
  senderAgentId: HarnessAgentId,
  authorKind: HarnessMessageAuthorKind,
  kind: HarnessCoordinationMessageKind,
  topic: Schema.optional(TrimmedNonEmptyString),
  body: Schema.String,
  summary: Schema.optional(Schema.String),
  decisions: Schema.optional(Schema.Array(Schema.String)),
  deduplicationKey: TrimmedNonEmptyString,
  round: Schema.optional(HarnessConvergenceRound),
});
export type HarnessSendCoordinationMessageInput = typeof HarnessSendCoordinationMessageInput.Type;

export const HarnessAcknowledgeCoordinationInput = Schema.Struct({
  channelId: HarnessChannelId,
  messageId: HarnessCoordinationMessageId,
  agentId: HarnessAgentId,
  revision: NonNegativeInt,
  round: HarnessConvergenceRound,
  status: Schema.optional(HarnessCoordinationStatus),
  summary: Schema.optional(Schema.String),
  decisions: Schema.optional(Schema.Array(Schema.String)),
});
export type HarnessAcknowledgeCoordinationInput = typeof HarnessAcknowledgeCoordinationInput.Type;

export const HarnessSetChannelStatusInput = Schema.Struct({
  channelId: HarnessChannelId,
  status: HarnessCoordinationStatus,
  summary: Schema.optional(Schema.String),
  decisions: Schema.optional(Schema.Array(Schema.String)),
});
export type HarnessSetChannelStatusInput = typeof HarnessSetChannelStatusInput.Type;

export const HarnessUpdateDeliveryInput = Schema.Struct({
  deliveryId: HarnessDeliveryId,
  side: HarnessDeliverySide,
  state: HarnessDeliveryState,
  error: Schema.optional(Schema.String),
});
export type HarnessUpdateDeliveryInput = typeof HarnessUpdateDeliveryInput.Type;

export const HarnessListDeliveriesInput = Schema.Struct({
  agentId: Schema.optional(HarnessAgentId),
  state: Schema.optional(HarnessDeliveryState),
});
export type HarnessListDeliveriesInput = typeof HarnessListDeliveriesInput.Type;

export const HarnessListDeliveriesResult = Schema.Array(HarnessDelivery);
export type HarnessListDeliveriesResult = typeof HarnessListDeliveriesResult.Type;

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

export class HarnessGraphConvergenceLimitError extends Schema.TaggedError<HarnessGraphConvergenceLimitError>()(
  "HarnessGraphConvergenceLimitError",
  {
    channelId: HarnessChannelId,
    maxRounds: Schema.Literal(3),
  },
) {
  override get message(): string {
    return `Coordination channel '${this.channelId}' reached the ${this.maxRounds}-round convergence limit.`;
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
  HarnessGraphConvergenceLimitError,
  HarnessGraphPersistenceError,
]);
export type HarnessGraphError = typeof HarnessGraphError.Type;

export const HARNESS_GRAPH_MAX_CONVERGENCE_ROUNDS = 3 as const;
