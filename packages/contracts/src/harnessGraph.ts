import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TurnId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/** Stable identity for a user-facing agent in the Harness graph. */
export const HarnessAgentId = TrimmedNonEmptyString.pipe(Schema.brand("HarnessAgentId"));
export type HarnessAgentId = typeof HarnessAgentId.Type;

export const HarnessRelationshipId = TrimmedNonEmptyString.pipe(
  Schema.brand("HarnessRelationshipId"),
);
export type HarnessRelationshipId = typeof HarnessRelationshipId.Type;

export const HarnessChannelId = TrimmedNonEmptyString.pipe(Schema.brand("HarnessChannelId"));
export type HarnessChannelId = typeof HarnessChannelId.Type;

export const HarnessCoordinationMessageId = TrimmedNonEmptyString.pipe(
  Schema.brand("HarnessCoordinationMessageId"),
);
export type HarnessCoordinationMessageId = typeof HarnessCoordinationMessageId.Type;

export const HarnessDeliveryId = TrimmedNonEmptyString.pipe(Schema.brand("HarnessDeliveryId"));
export type HarnessDeliveryId = typeof HarnessDeliveryId.Type;

export const HarnessAgentRole = Schema.Literals(["root", "delegated", "sidechat"]);
export type HarnessAgentRole = typeof HarnessAgentRole.Type;

export const HarnessAgentStatus = Schema.Literals(["active", "paused", "completed", "failed"]);
export type HarnessAgentStatus = typeof HarnessAgentStatus.Type;

/** Operations the client can truthfully offer for a graph-backed agent. */
export const HarnessAgentCapability = Schema.Literals(["inspect"]);
export type HarnessAgentCapability = typeof HarnessAgentCapability.Type;

/** The graph can point at a durable T3 thread or a provider-owned child transcript. */
export const HarnessAgentBacking = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("thread"),
    threadId: ThreadId,
  }),
  Schema.Struct({
    kind: Schema.Literal("native"),
    threadId: Schema.optional(ThreadId),
    provider: TrimmedNonEmptyString,
    providerInstanceId: Schema.optional(ProviderInstanceId),
    providerAgentId: TrimmedNonEmptyString,
    parentThreadId: ThreadId,
    capabilities: Schema.Array(HarnessAgentCapability),
  }),
]);
export type HarnessAgentBacking = typeof HarnessAgentBacking.Type;

export const HarnessRelationshipKind = Schema.Literals(["delegation", "sidechat"]);
export type HarnessRelationshipKind = typeof HarnessRelationshipKind.Type;

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

export const HarnessCoordinationMessageKind = Schema.Literals([
  "update",
  "question",
  "agreement",
  "decision",
  "test-result",
]);
export type HarnessCoordinationMessageKind = typeof HarnessCoordinationMessageKind.Type;

/** A bounded convergence round. A channel may never negotiate beyond round 3. */
export const HarnessConvergenceRound = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 3 }),
);
export type HarnessConvergenceRound = typeof HarnessConvergenceRound.Type;

export const HarnessCanvasPosition = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  collapsed: Schema.Boolean,
});
export type HarnessCanvasPosition = typeof HarnessCanvasPosition.Type;

export const HarnessAgent = Schema.Struct({
  agentId: HarnessAgentId,
  /** Optional for native provider children; retained for older clients. */
  threadId: Schema.optional(ThreadId),
  projectId: ProjectId,
  displayName: TrimmedNonEmptyString,
  role: HarnessAgentRole,
  status: HarnessAgentStatus,
  /** Optional so clients can still decode snapshots from pre-backing servers. */
  backing: Schema.optional(HarnessAgentBacking),
  parentAgentId: Schema.optional(HarnessAgentId),
  canvas: HarnessCanvasPosition,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HarnessAgent = typeof HarnessAgent.Type;

export const HarnessRelationship = Schema.Struct({
  relationshipId: HarnessRelationshipId,
  sourceAgentId: HarnessAgentId,
  targetAgentId: HarnessAgentId,
  kind: HarnessRelationshipKind,
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
  role: HarnessAgentRole,
  parentAgentId: Schema.optional(HarnessAgentId),
  status: Schema.optional(HarnessAgentStatus),
  canvas: Schema.optional(HarnessCanvasPosition),
});
export type HarnessRegisterAgentInput = typeof HarnessRegisterAgentInput.Type;

export const HarnessUpdateCanvasInput = Schema.Struct({
  agentId: HarnessAgentId,
  x: Schema.Finite,
  y: Schema.Finite,
  collapsed: Schema.Boolean,
});
export type HarnessUpdateCanvasInput = typeof HarnessUpdateCanvasInput.Type;

export const HarnessUpsertRelationshipInput = Schema.Struct({
  relationshipId: Schema.optional(HarnessRelationshipId),
  sourceAgentId: HarnessAgentId,
  targetAgentId: HarnessAgentId,
  kind: HarnessRelationshipKind,
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
