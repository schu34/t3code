import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import * as Stream from "effect/Stream";

import { connectionAtomRuntime } from "../connection/runtime";

/** Durable graph reads and mutations used by the Harness canvas. */
export const harnessGraphRead = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:harness-graph:read",
  tag: WS_METHODS.harnessGraphRead,
  staleTimeMs: 5_000,
  idleTtlMs: 5 * 60_000,
});

export const harnessGraphSubscribe = createEnvironmentRpcSubscriptionAtomFamily(
  connectionAtomRuntime,
  {
    label: "environment-data:harness-graph:subscribe",
    tag: WS_METHODS.harnessGraphSubscribe,
    transform: (events) =>
      events.pipe(
        Stream.filter((event): event is NonNullable<typeof event> => event !== null),
        Stream.map((event) => event.snapshot),
      ),
  },
);

export const harnessGraphRegisterAgent = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:harness-graph:register-agent",
  tag: WS_METHODS.harnessGraphRegisterAgent,
});

export const harnessGraphUpdateCanvas = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:harness-graph:update-canvas",
  tag: WS_METHODS.harnessGraphUpdateCanvas,
  concurrency: {
    mode: "latest",
    key: ({ environmentId, input }) => `${environmentId}:${input.agentId}`,
  },
});

export const harnessGraphUpsertRelationship = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:harness-graph:upsert-relationship",
  tag: WS_METHODS.harnessGraphUpsertRelationship,
});

export const harnessGraphOpenChannel = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:harness-graph:open-channel",
  tag: WS_METHODS.harnessGraphOpenChannel,
});

export const harnessGraphGetChannel = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:harness-graph:get-channel",
  tag: WS_METHODS.harnessGraphGetChannel,
});

export const harnessGraphSendCoordination = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:harness-graph:send-coordination",
  tag: WS_METHODS.harnessGraphSendCoordination,
});

export const harnessGraphAcknowledgeCoordination = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "environment-data:harness-graph:acknowledge-coordination",
    tag: WS_METHODS.harnessGraphAcknowledgeCoordination,
  },
);

export const harnessGraphSetChannelStatus = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:harness-graph:set-channel-status",
  tag: WS_METHODS.harnessGraphSetChannelStatus,
});

export const harnessGraphUpdateDelivery = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:harness-graph:update-delivery",
  tag: WS_METHODS.harnessGraphUpdateDelivery,
});
