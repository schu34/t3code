import type { HarnessAgentStatus } from "@t3tools/contracts";

/** The small activity slice needed to derive provider-owned graph nodes. */
export interface HarnessNativeActivity {
  readonly kind: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

export interface HarnessNativeAgentObservation {
  readonly providerAgentId: string;
  readonly title: string;
  readonly role: string | null;
  readonly status: HarnessAgentStatus;
  /** Provider-native parent id, when the adapter supplied one. */
  readonly parentProviderAgentId: string | null;
  readonly observedAt: string;
}

interface MutableObservation extends HarnessNativeAgentObservation {
  source: "normalized" | "legacy-collab";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function shortText(value: string, limit = 120): string {
  const firstLine = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const text = firstLine ?? value.trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function titleForPayload(payload: Record<string, unknown>, fallback: string): string {
  for (const key of ["title", "detail", "description", "summary"]) {
    const value = asString(payload[key]);
    if (value) return shortText(value);
  }
  return fallback;
}

function statusFromRuntime(value: unknown, fallback: HarnessAgentStatus): HarnessAgentStatus {
  switch (value) {
    case "failed":
    case "error":
      return "failed";
    case "completed":
    case "cancelled":
    case "canceled":
    case "interrupted":
    case "stopped":
      return "completed";
    case "waiting":
    case "paused":
    case "idle":
      return "paused";
    case "pending":
    case "running":
    default:
      return fallback;
  }
}

function statusFromLegacyState(value: unknown): HarnessAgentStatus {
  switch (value) {
    case "failed":
    case "error":
      return "failed";
    case "completed":
    case "cancelled":
    case "canceled":
    case "interrupted":
    case "stopped":
      return "completed";
    case "idle":
      return "paused";
    case "pendingInit":
    case "pending":
    case "inProgress":
    case "running":
    default:
      return "active";
  }
}

function upsertNormalized(
  observations: Map<string, MutableObservation>,
  activity: HarnessNativeActivity,
): void {
  if (
    activity.kind !== "task.started" &&
    activity.kind !== "task.progress" &&
    activity.kind !== "task.updated" &&
    activity.kind !== "task.completed"
  ) {
    return;
  }
  const payload = asRecord(activity.payload);
  const providerAgentId = asString(payload?.taskId);
  if (!payload || !providerAgentId || payload.agentKind !== "agent") return;

  const existing = observations.get(providerAgentId);
  const normalizedExisting = existing?.source === "normalized" ? existing : undefined;
  const status =
    activity.kind === "task.completed"
      ? payload.status === "failed" || payload.status === "error"
        ? "failed"
        : "completed"
      : statusFromRuntime(payload.status, normalizedExisting?.status ?? "active");
  const title = titleForPayload(payload, normalizedExisting?.title ?? providerAgentId);
  const role = asString(payload.role) ?? normalizedExisting?.role ?? null;
  const parentProviderAgentId =
    asString(payload.parentAgentId) ??
    asString(payload.agentId) ??
    normalizedExisting?.parentProviderAgentId ??
    null;

  observations.set(providerAgentId, {
    source: "normalized",
    providerAgentId,
    title,
    role,
    status,
    parentProviderAgentId,
    observedAt: activity.createdAt,
  });
}

function receiverIds(item: Record<string, unknown>): ReadonlyArray<string> {
  return Array.isArray(item.receiverThreadIds)
    ? item.receiverThreadIds.filter((value): value is string => asString(value) !== undefined)
    : [];
}

function upsertLegacyCollab(
  observations: Map<string, MutableObservation>,
  titles: Map<string, string>,
  activity: HarnessNativeActivity,
): void {
  const payload = asRecord(activity.payload);
  if (payload?.itemType !== "collab_agent_tool_call") return;
  const data = asRecord(payload.data);
  const item = asRecord(data?.item);
  if (item?.type !== "collabAgentToolCall") return;

  const tool = asString(item.tool);
  const prompt = asString(item.prompt);
  const itemReceivers = receiverIds(item);
  const states = asRecord(item.agentsStates);
  if (prompt) {
    for (const id of itemReceivers) titles.set(id, shortText(prompt));
    if (states) {
      for (const id of Object.keys(states)) titles.set(id, shortText(prompt));
    }
  }

  for (const providerAgentId of itemReceivers) {
    const existing = observations.get(providerAgentId);
    if (existing !== undefined) continue;
    observations.set(providerAgentId, {
      source: "legacy-collab",
      providerAgentId,
      title: titles.get(providerAgentId) ?? `Native subagent ${providerAgentId.slice(0, 8)}`,
      role: "provider-native",
      status: "active",
      parentProviderAgentId: null,
      observedAt: activity.createdAt,
    });
  }

  if (states) {
    for (const [providerAgentId, rawState] of Object.entries(states)) {
      if (!providerAgentId) continue;
      const state = asRecord(rawState);
      const existing = observations.get(providerAgentId);
      if (existing?.source === "normalized") continue;
      observations.set(providerAgentId, {
        source: "legacy-collab",
        providerAgentId,
        title: titles.get(providerAgentId) ?? `Native subagent ${providerAgentId.slice(0, 8)}`,
        role: existing?.role ?? "provider-native",
        status: statusFromLegacyState(state?.status),
        parentProviderAgentId: existing?.parentProviderAgentId ?? null,
        observedAt: activity.createdAt,
      });
    }
  }

  if (tool === "closeAgent") {
    const closeStatus = statusFromLegacyState(item.status);
    for (const providerAgentId of itemReceivers) {
      const existing = observations.get(providerAgentId);
      if (existing?.source === "normalized") continue;
      observations.set(providerAgentId, {
        source: "legacy-collab",
        providerAgentId,
        title: titles.get(providerAgentId) ?? `Native subagent ${providerAgentId.slice(0, 8)}`,
        role: existing?.role ?? "provider-native",
        status: closeStatus === "active" ? "completed" : closeStatus,
        parentProviderAgentId: existing?.parentProviderAgentId ?? null,
        observedAt: activity.createdAt,
      });
    }
  }
}

/**
 * Fold normalized provider task rows, with a compatibility fallback for the
 * older Codex collab tool payload. Normalized rows win for an identity when a
 * provider emits both shapes, preventing duplicate canvas nodes.
 */
export function foldHarnessNativeActivities(
  activities: ReadonlyArray<HarnessNativeActivity>,
): ReadonlyArray<HarnessNativeAgentObservation> {
  const observations = new Map<string, MutableObservation>();
  const titles = new Map<string, string>();
  for (const activity of activities) {
    upsertNormalized(observations, activity);
    upsertLegacyCollab(observations, titles, activity);
  }
  return [...observations.values()].map(({ source: _source, ...observation }) => observation);
}
