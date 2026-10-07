import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

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
  },
);

export const harnessGraphSetAgent = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:harness-graph:set-agent",
  tag: WS_METHODS.harnessGraphSetAgent,
});

export const harnessGraphUpsertEdge = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:harness-graph:upsert-edge",
  tag: WS_METHODS.harnessGraphUpsertEdge,
});
