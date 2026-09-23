import type {
  EnvironmentId,
  HarnessAgentId,
  HarnessChannel,
  HarnessChannelId,
  HarnessGraphSnapshot,
  TurnId,
} from "@t3tools/contracts";
import { useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useComposerDraftStore } from "../composerDraftStore";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { SidebarInset } from "./ui/sidebar";
import HarnessCanvas from "./HarnessCanvas";
import {
  buildHarnessCanvasSnapshotFromThreads,
  harnessAgentId,
  layoutHarnessCanvasAgents,
  type HarnessCanvasActions,
  type HarnessCanvasAgent,
  type HarnessCanvasChannel,
  type HarnessCanvasSnapshot,
} from "../harnessCanvas.logic";
import {
  harnessGraphGetChannel,
  harnessGraphOpenChannel,
  harnessGraphRead,
  harnessGraphRegisterAgent,
  harnessGraphSendCoordination,
  harnessGraphSetChannelStatus,
  harnessGraphSubscribe,
  harnessGraphUpdateCanvas,
  harnessGraphUpsertRelationship,
} from "../state/harnessGraph";
import { useEnvironmentQuery } from "../state/query";
import { useProjects, useThreadShells } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { randomUUID } from "../lib/utils";

function graphAgentFor(
  graph: HarnessGraphSnapshot | null,
  localAgent: HarnessCanvasAgent,
): HarnessGraphSnapshot["agents"][number] | undefined {
  return graph?.agents.find(
    (agent) => agent.threadId === localAgent.threadId && agent.projectId === localAgent.projectId,
  );
}

function hydrateCanvasChannel(
  channel: HarnessChannel,
  localIdByServerId: ReadonlyMap<string, string>,
): HarnessCanvasChannel | null {
  const sourceAgentId = localIdByServerId.get(channel.agentAId);
  const targetAgentId = localIdByServerId.get(channel.agentBId);
  if (sourceAgentId === undefined || targetAgentId === undefined) return null;
  return {
    id: channel.channelId,
    sourceAgentId,
    targetAgentId,
    topic: channel.topic,
    state: channel.status,
    revision: Math.max(channel.revisionA, channel.revisionB),
    messageCount: channel.messages.length,
    transcript: channel.messages.map((message) => ({
      id: message.messageId,
      authorAgentId: localIdByServerId.get(message.senderAgentId) ?? message.senderAgentId,
      text: message.body,
      createdAt: message.createdAt,
    })),
    decisions: channel.decisions.map((text, index) => ({
      id: `${channel.channelId}:decision:${index}`,
      text,
      revision: channel.convergenceRound,
      createdAt: channel.updatedAt,
    })),
    lastSyncedAt: channel.status === "aligned" ? channel.updatedAt : null,
  };
}

function buildSnapshot(
  environmentId: EnvironmentId,
  threads: ReturnType<typeof useThreadShells>,
  projects: ReturnType<typeof useProjects>,
  drafts: ReadonlyArray<{
    readonly draftId: string;
    readonly environmentId: EnvironmentId;
    readonly threadId: string;
    readonly projectId: string;
  }>,
  graph: HarnessGraphSnapshot | null,
): HarnessCanvasSnapshot {
  const base = buildHarnessCanvasSnapshotFromThreads(
    threads.filter((thread) => thread.environmentId === environmentId),
    projects.filter((project) => project.environmentId === environmentId),
    new Map(),
    { topInset: 280 },
  );
  if (graph === null) return base;

  const graphOnlyAgents = graph.agents.flatMap((serverAgent) => {
    const alreadyVisible = base.agents.some(
      (agent) =>
        agent.threadId === serverAgent.threadId && agent.projectId === serverAgent.projectId,
    );
    if (alreadyVisible) return [];
    const project = projects.find(
      (candidate) =>
        candidate.environmentId === environmentId && candidate.id === serverAgent.projectId,
    );
    const draft = drafts.find(
      (candidate) =>
        candidate.environmentId === environmentId &&
        candidate.threadId === serverAgent.threadId &&
        candidate.projectId === serverAgent.projectId,
    );
    const runtimeState =
      serverAgent.status === "failed"
        ? ("failed" as const)
        : serverAgent.status === "paused"
          ? ("waiting" as const)
          : serverAgent.status === "completed"
            ? ("stopped" as const)
            : ("idle" as const);
    return [
      {
        id: harnessAgentId(environmentId, serverAgent.threadId),
        environmentId,
        threadId: serverAgent.threadId,
        ...(draft === undefined ? {} : { draftId: draft.draftId }),
        projectId: serverAgent.projectId,
        title: serverAgent.displayName,
        projectTitle: project?.title ?? "Unknown project",
        activity:
          serverAgent.status === "failed"
            ? "Agent failed"
            : serverAgent.status === "paused"
              ? "Paused by Harness"
              : serverAgent.status === "completed"
                ? "Completed"
                : "Awaiting first turn",
        runtimeState,
        deliveryStage: "implementing" as const,
        archived: serverAgent.status === "completed",
        completed: serverAgent.status === "completed",
        unreadCount: 0,
        position:
          serverAgent.canvas.x === 0 && serverAgent.canvas.y === 0
            ? null
            : { x: serverAgent.canvas.x, y: serverAgent.canvas.y },
        latestCompletedTurnId: null,
      } satisfies HarnessCanvasAgent,
    ];
  });
  const allAgents = [...base.agents, ...graphOnlyAgents];

  const serverIdByLocalId = new Map(
    allAgents.flatMap((agent) => {
      const serverAgent = graphAgentFor(graph, agent);
      return serverAgent === undefined ? [] : [[agent.id, serverAgent.agentId] as const];
    }),
  );
  const edges = [
    ...graph.relationships.flatMap((relationship) => {
      const source = allAgents.find(
        (agent) => serverIdByLocalId.get(agent.id) === relationship.sourceAgentId,
      );
      const target = allAgents.find(
        (agent) => serverIdByLocalId.get(agent.id) === relationship.targetAgentId,
      );
      return source === undefined || target === undefined
        ? []
        : [
            {
              id: relationship.relationshipId,
              source: source.id,
              target: target.id,
              kind: relationship.kind,
              channelId: null,
            } as const,
          ];
    }),
    ...graph.channels.flatMap((channel) => {
      const source = allAgents.find(
        (agent) => serverIdByLocalId.get(agent.id) === channel.agentAId,
      );
      const target = allAgents.find(
        (agent) => serverIdByLocalId.get(agent.id) === channel.agentBId,
      );
      return source === undefined || target === undefined
        ? []
        : [
            {
              id: `channel:${channel.channelId}`,
              source: source.id,
              target: target.id,
              kind: "coordination" as const,
              channelId: channel.channelId,
            },
          ];
    }),
  ];
  const graphPositionByThread = new Map(
    graph.agents.map((agent) => [agent.threadId, agent.canvas] as const),
  );
  const agents = layoutHarnessCanvasAgents(
    allAgents.map((agent) => {
      const savedPosition = graphPositionByThread.get(agent.threadId);
      return {
        ...agent,
        // A zero canvas is the graph's unset sentinel. Let the relationship-aware
        // layout place fresh agents instead of treating the base grid as saved.
        position:
          savedPosition === undefined || (savedPosition.x === 0 && savedPosition.y === 0)
            ? null
            : savedPosition,
      };
    }),
    { topInset: 280, edges },
  );
  const channels: ReadonlyArray<HarnessCanvasChannel> = graph.channels.flatMap((channel) => {
    const source = allAgents.find((agent) => serverIdByLocalId.get(agent.id) === channel.agentAId);
    const target = allAgents.find((agent) => serverIdByLocalId.get(agent.id) === channel.agentBId);
    if (source === undefined || target === undefined) return [];
    return [
      {
        id: channel.channelId,
        sourceAgentId: source.id,
        targetAgentId: target.id,
        topic: channel.topic,
        state: channel.status,
        revision: Math.max(channel.revisionA, channel.revisionB),
        messageCount: channel.messageCount,
        transcript: [],
        decisions: channel.decisions.map((text, index) => ({
          id: `${channel.channelId}:decision:${index}`,
          text,
          revision: channel.convergenceRound,
          createdAt: channel.updatedAt,
        })),
        lastSyncedAt: channel.status === "aligned" ? channel.updatedAt : null,
      },
    ];
  });
  return { revision: graph.revision, agents, edges, channels };
}

function commandError(result: { readonly _tag: string }): Error | null {
  return result._tag === "Failure" ? new Error("The Harness graph request failed.") : null;
}

export default function HarnessWorkspace() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const environmentId = primaryEnvironmentId ?? environments[0]?.environmentId ?? null;
  const projects = useProjects();
  const threads = useThreadShells();
  const draftThreadsByThreadKey = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const drafts = useMemo(
    () =>
      Object.entries(draftThreadsByThreadKey).map(([draftId, draft]) => ({
        draftId,
        environmentId: draft.environmentId,
        threadId: draft.threadId,
        projectId: draft.projectId,
      })),
    [draftThreadsByThreadKey],
  );
  const navigate = useNavigate();
  const newThread = useNewThreadHandler();
  const latestProject = projects.find((project) => project.environmentId === environmentId);
  const graphRead = useEnvironmentQuery(
    environmentId === null ? null : harnessGraphRead({ environmentId, input: {} }),
  );
  const graphLive = useEnvironmentQuery(
    environmentId === null ? null : harnessGraphSubscribe({ environmentId, input: {} }),
  );
  const graph = graphLive.data ?? graphRead.data;
  const snapshot = useMemo(
    () =>
      environmentId === null
        ? { revision: 0, agents: [], edges: [], channels: [] }
        : buildSnapshot(environmentId, threads, projects, drafts, graph),
    [drafts, environmentId, graph, projects, threads],
  );

  const updateCanvas = useAtomCommand(harnessGraphUpdateCanvas, { reportFailure: false });
  const upsertRelationship = useAtomCommand(harnessGraphUpsertRelationship, {
    reportFailure: false,
  });
  const openChannel = useAtomCommand(harnessGraphOpenChannel, { reportFailure: false });
  const getChannel = useAtomCommand(harnessGraphGetChannel, { reportFailure: false });
  const setChannelStatus = useAtomCommand(harnessGraphSetChannelStatus, { reportFailure: false });
  const registerAgent = useAtomCommand(harnessGraphRegisterAgent, { reportFailure: false });
  const sendCoordination = useAtomCommand(harnessGraphSendCoordination, { reportFailure: false });

  const serverAgentId = useCallback(
    (localId: string): HarnessAgentId | null => {
      const local = snapshot.agents.find((agent) => agent.id === localId);
      if (local === undefined || graph === null) return null;
      return graphAgentFor(graph, local)?.agentId ?? null;
    },
    [graph, snapshot.agents],
  );
  const run = useCallback(
    async <A,>(
      command: (target: {
        environmentId: EnvironmentId;
        input: A;
      }) => Promise<{ readonly _tag: string }>,
      input: A,
    ) => {
      if (environmentId === null) return;
      const result = await command({ environmentId, input });
      const error = commandError(result);
      if (error) throw error;
    },
    [environmentId],
  );

  const actions = useMemo<HarnessCanvasActions | null>(() => {
    if (environmentId === null) return null;
    return {
      updatePosition: async ({ agentId, position }) => {
        const serverId = serverAgentId(agentId);
        if (serverId === null) return;
        await run(updateCanvas, {
          agentId: serverId,
          x: position.x,
          y: position.y,
          collapsed: false,
        });
      },
      createAgent: async () => {
        if (latestProject === undefined) return;
        const result = await newThread(scopeProjectRef(environmentId, latestProject.id), {
          reuseExistingDraft: false,
        });
        if (result === null) return;
        await run(registerAgent, {
          agentId: result.threadId as unknown as HarnessAgentId,
          threadId: result.threadId,
          projectId: latestProject.id,
          displayName: "New Codex agent",
          role: "root" as const,
        });
      },
      createChild: async (agentId) => {
        const parent = snapshot.agents.find((agent) => agent.id === agentId);
        if (parent === undefined) return;
        const result = await newThread(scopeProjectRef(environmentId, parent.projectId), {
          reuseExistingDraft: false,
        });
        if (result === null) return;
        const parentServerId = serverAgentId(agentId);
        if (parentServerId === null) return;
        const childServerId = result.threadId as unknown as HarnessAgentId;
        await run(registerAgent, {
          agentId: childServerId,
          threadId: result.threadId,
          projectId: parent.projectId,
          displayName: "Delegated agent",
          role: "delegated" as const,
          parentAgentId: parentServerId,
        });
        await run(upsertRelationship, {
          sourceAgentId: parentServerId,
          targetAgentId: childServerId,
          kind: "delegation" as const,
        });
      },
      forkSidechat: async (agentId, completedTurnId) => {
        const parent = snapshot.agents.find((agent) => agent.id === agentId);
        const parentServerId = serverAgentId(agentId);
        if (parent === undefined || parentServerId === null) return;
        const result = await newThread(scopeProjectRef(environmentId, parent.projectId), {
          reuseExistingDraft: false,
        });
        if (result === null) return;
        const sidechatServerId = result.threadId as unknown as HarnessAgentId;
        await run(registerAgent, {
          agentId: sidechatServerId,
          threadId: result.threadId,
          projectId: parent.projectId,
          displayName: "Side chat",
          role: "sidechat" as const,
          parentAgentId: parentServerId,
        });
        await run(upsertRelationship, {
          sourceAgentId: parentServerId,
          targetAgentId: sidechatServerId,
          kind: "sidechat" as const,
          forkedFromTurnId: completedTurnId as TurnId,
        });
      },
      connect: async (sourceAgentId, targetAgentId) => {
        const source = serverAgentId(sourceAgentId);
        const target = serverAgentId(targetAgentId);
        if (source === null || target === null || source === target) return;
        await run(upsertRelationship, {
          sourceAgentId: source,
          targetAgentId: target,
          kind: "sidechat" as const,
          topic: "Shared work",
        });
        await run(openChannel, { agentAId: source, agentBId: target, topic: "Shared work" });
      },
      loadChannel: async (channelId) => {
        const result = await getChannel({
          environmentId,
          input: { channelId: channelId as HarnessChannelId },
        });
        if (result._tag === "Failure") return null;
        const localIdByServerId = new Map(
          graph?.agents.flatMap((serverAgent) => {
            const local = snapshot.agents.find(
              (agent) =>
                agent.threadId === serverAgent.threadId &&
                agent.projectId === serverAgent.projectId,
            );
            return local === undefined ? [] : [[serverAgent.agentId, local.id] as const];
          }) ?? [],
        );
        return hydrateCanvasChannel(result.value, localIdByServerId);
      },
      syncChannel: async (channelId) =>
        run(setChannelStatus, {
          channelId: channelId as HarnessChannelId,
          status: "aligned" as const,
        }),
      pauseChannel: async (channelId) =>
        run(setChannelStatus, {
          channelId: channelId as HarnessChannelId,
          status: "paused" as const,
        }),
      resumeChannel: async (channelId) =>
        run(setChannelStatus, {
          channelId: channelId as HarnessChannelId,
          status: "syncing" as const,
        }),
      disconnectChannel: async (channelId) =>
        run(setChannelStatus, {
          channelId: channelId as HarnessChannelId,
          status: "paused" as const,
        }),
      sendCoordination: async (channelId, body) => {
        const channel = snapshot.channels.find((entry) => entry.id === channelId);
        if (channel === undefined) return;
        const senderAgentId = serverAgentId(channel.sourceAgentId);
        const graphChannel = graph?.channels.find((entry) => entry.channelId === channelId);
        if (senderAgentId === null || graphChannel === undefined) return;
        await run(sendCoordination, {
          channelId: graphChannel.channelId,
          senderAgentId,
          authorKind: "user" as const,
          kind: "update" as const,
          topic: graphChannel.topic,
          body,
          deduplicationKey: `user:${randomUUID()}`,
        });
      },
    };
  }, [
    environmentId,
    latestProject,
    getChannel,
    newThread,
    openChannel,
    registerAgent,
    run,
    sendCoordination,
    setChannelStatus,
    serverAgentId,
    graph,
    snapshot.agents,
    snapshot.channels,
    updateCanvas,
    upsertRelationship,
  ]);

  const onSelectAgent = useCallback(
    (agent: HarnessCanvasAgent) => {
      if (agent.draftId !== undefined) {
        void navigate({
          to: "/draft/$draftId",
          params: { draftId: agent.draftId },
        });
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: agent.environmentId, threadId: agent.threadId },
      });
    },
    [navigate],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <HarnessCanvas
        snapshot={snapshot}
        actions={actions}
        onSelectAgent={onSelectAgent}
        className="min-h-0"
      />
    </SidebarInset>
  );
}
