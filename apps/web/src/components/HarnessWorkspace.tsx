import {
  HarnessRoleDefinitionId,
  HarnessRelationshipDefinitionId,
  HarnessRelationshipId,
  HarnessAgentId,
  DEFAULT_MODEL,
  ProviderInstanceId,
} from "@t3tools/contracts";
import type {
  EnvironmentId,
  HarnessChannel,
  HarnessChannelId,
  HarnessGraphSnapshot,
  TurnId,
} from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useComposerDraftStore, markPromotedDraftThreadByRef } from "../composerDraftStore";
import { threadEnvironment } from "../state/threads";

import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { SidebarInset } from "./ui/sidebar";
import HarnessCanvas from "./HarnessCanvas";
import HarnessDefinitionDialog from "./HarnessDefinitionDialog";
import {
  buildHarnessCanvasSnapshotFromThreads,
  deriveHarnessCreationEdges,
  harnessNativeAgentId,
  layoutHarnessCanvasAgents,
  type HarnessCanvasActions,
  type HarnessCanvasAgent,
  type HarnessCanvasChannel,
  type HarnessCanvasSnapshot,
} from "../harnessCanvas.logic";
import { useRightPanelStore } from "../rightPanelStore";
import {
  harnessGraphCreateRelationshipDefinition,
  harnessGraphCreateRoleDefinition,
  harnessGraphGetChannel,
  harnessGraphOpenChannel,
  harnessGraphRead,
  harnessGraphRegisterAgent,
  harnessGraphSendCoordination,
  harnessGraphSubscribe,
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
  if (graph === null) return undefined;
  const nativeBacking = localAgent.backing.kind === "native" ? localAgent.backing : undefined;
  if (nativeBacking !== undefined) {
    return graph.agents.find((agent) => agent.agentId === nativeBacking.serverAgentId);
  }
  const threadBacking = localAgent.backing.kind === "thread" ? localAgent.backing : undefined;
  const threadId = threadBacking?.threadId;
  return threadId === undefined
    ? undefined
    : graph.agents.find(
        (agent) =>
          agent.backing.kind === "thread" &&
          agent.backing.threadId === threadId &&
          agent.projectId === localAgent.projectId,
      );
}

function defaultRoleId(): HarnessRoleDefinitionId {
  return HarnessRoleDefinitionId.make("builtin:general");
}

function hydrateCanvasChannel(
  channel: HarnessChannel,
  localIdByServerId: ReadonlyMap<string, string>,
  graph: HarnessGraphSnapshot | null,
): HarnessCanvasChannel | null {
  const relationship = graph?.relationships.find(
    (r) => r.relationshipId === channel.relationshipId,
  );
  if (!relationship) return null;
  const sourceAgentId = localIdByServerId.get(relationship.sourceAgentId);
  const targetAgentId = localIdByServerId.get(relationship.targetAgentId);
  if (sourceAgentId === undefined || targetAgentId === undefined) return null;
  return {
    id: channel.channelId,
    sourceAgentId,
    targetAgentId,
    topic: channel.topic,
    messageCount: channel.messages.length,
    transcript: channel.messages.map((message) => ({
      id: message.messageId,
      authorAgentId: localIdByServerId.get(message.senderAgentId) ?? message.senderAgentId,
      text: message.body,
      createdAt: message.createdAt,
    })),
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
    const backing = serverAgent.backing;
    if (backing.kind !== "native") return [];
    const project = projects.find(
      (p) => p.environmentId === environmentId && p.id === serverAgent.projectId,
    );
    return [
      {
        id: harnessNativeAgentId(environmentId, serverAgent.agentId),
        kind: serverAgent.kind,
        spawnedByAgentId: null,
        environmentId,
        backing: { ...backing, serverAgentId: serverAgent.agentId },
        projectId: serverAgent.projectId,
        title: serverAgent.displayName,
        projectTitle: project?.title ?? "Unknown project",
        activity: `Native ${backing.provider} subagent`,
        runtimeState:
          serverAgent.status === "failed"
            ? ("failed" as const)
            : serverAgent.status === "completed"
              ? ("stopped" as const)
              : serverAgent.status === "paused"
                ? ("waiting" as const)
                : ("working" as const),
        deliveryStage: "implementing" as const,
        archived: false,
        completed: serverAgent.status === "completed",
        unreadCount: 0,
        position: null,
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
  const localIdByServerId = new Map(
    [...serverIdByLocalId].map(([localId, serverId]) => [serverId, localId] as const),
  );
  const agentsWithProvenance = allAgents.map((agent) => {
    const metadata = graphAgentFor(graph, agent);
    return {
      ...agent,
      kind: metadata?.kind ?? agent.kind,
      spawnedByAgentId:
        metadata?.spawnedByAgentId === undefined
          ? null
          : (localIdByServerId.get(metadata.spawnedByAgentId) ?? null),
      // Base positions are fallback layout, not user-dragged session positions.
      position: null,
    };
  });
  const edges = [
    ...deriveHarnessCreationEdges(agentsWithProvenance),
    ...graph.relationships.flatMap((relationship) => {
      const source = localIdByServerId.get(relationship.sourceAgentId);
      const target = localIdByServerId.get(relationship.targetAgentId);
      return source === undefined || target === undefined
        ? []
        : [
            {
              id: relationship.relationshipId,
              source,
              target,
              kind: "coordination",
              label:
                graph.relationshipDefinitions.find(
                  (d) => d.relationshipDefinitionId === relationship.relationshipDefinitionId,
                )?.name ?? "Communication",
              channelId:
                graph.channels.find((c) => c.relationshipId === relationship.relationshipId)
                  ?.channelId ?? null,
            } as const,
          ];
    }),
  ];
  const agents = layoutHarnessCanvasAgents(agentsWithProvenance, { topInset: 280 });
  const channels: ReadonlyArray<HarnessCanvasChannel> = graph.channels.flatMap((channel) => {
    const relationship = graph.relationships.find(
      (r) => r.relationshipId === channel.relationshipId,
    );
    const source = allAgents.find(
      (agent) => serverIdByLocalId.get(agent.id) === relationship?.sourceAgentId,
    );
    const target = allAgents.find(
      (agent) => serverIdByLocalId.get(agent.id) === relationship?.targetAgentId,
    );
    if (source === undefined || target === undefined) return [];
    return [
      {
        id: channel.channelId,
        sourceAgentId: source.id,
        targetAgentId: target.id,
        topic: channel.topic,
        messageCount: channel.messageCount,
        transcript: [],
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
  const [isDefinitionDialogOpen, setDefinitionDialogOpen] = useState(false);
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

  const upsertRelationship = useAtomCommand(harnessGraphUpsertRelationship, {
    reportFailure: false,
  });
  const openChannel = useAtomCommand(harnessGraphOpenChannel, { reportFailure: false });
  const getChannel = useAtomCommand(harnessGraphGetChannel, { reportFailure: false });
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const registerAgent = useAtomCommand(harnessGraphRegisterAgent, { reportFailure: false });
  const sendCoordination = useAtomCommand(harnessGraphSendCoordination, { reportFailure: false });
  const createRoleDefinition = useAtomCommand(harnessGraphCreateRoleDefinition, {
    reportFailure: false,
  });
  const createRelationshipDefinition = useAtomCommand(harnessGraphCreateRelationshipDefinition, {
    reportFailure: false,
  });

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

  const createGraphThread = useCallback(
    async (projectId: HarnessCanvasAgent["projectId"], title: string) => {
      if (environmentId === null) return null;
      const result = await newThread(scopeProjectRef(environmentId, projectId), {
        reuseExistingDraft: false,
        envMode: "local",
      });
      if (!result) return null;
      const state = useComposerDraftStore.getState();
      const draft = state.getDraftSession(result.draftId);
      if (!draft) return null;
      const composer = state.getComposerDraft(result.draftId);
      const project = projects.find((p) => p.environmentId === environmentId && p.id === projectId);
      const modelSelection = (composer?.activeProvider
        ? composer.modelSelectionByProvider[composer.activeProvider]
        : undefined) ??
        project?.defaultModelSelection ?? {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        };
      const created = await createThread({
        environmentId,
        input: {
          threadId: result.threadId,
          projectId,
          title,
          modelSelection,
          runtimeMode: draft.runtimeMode,
          interactionMode: draft.interactionMode,
          branch: draft.branch,
          worktreePath: draft.worktreePath,
          createdAt: draft.createdAt,
        },
      });
      const error = commandError(created);
      if (error) throw error;
      markPromotedDraftThreadByRef(scopeThreadRef(environmentId, result.threadId));
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.threadId },
      });
      return result;
    },
    [createThread, environmentId, navigate, newThread, projects],
  );

  const actions = useMemo<HarnessCanvasActions | null>(() => {
    if (environmentId === null) return null;
    return {
      createAgent: async () => {
        if (latestProject === undefined) return;
        const result = await createGraphThread(latestProject.id, "New agent");
        if (result === null) return;
        await run(registerAgent, {
          agentId: HarnessAgentId.make(result.threadId),
          threadId: result.threadId,
          kind: "root" as const,
          roleDefinitionId: defaultRoleId(),
        });
      },
      createChild: async (agentId) => {
        const parent = snapshot.agents.find((agent) => agent.id === agentId);
        if (parent === undefined) return;
        const parentServerId = serverAgentId(agentId);
        if (parentServerId === null) return;
        const relationshipDefinitionId = HarnessRelationshipDefinitionId.make("builtin:delegation");
        const result = await createGraphThread(parent.projectId, "New agent");
        if (result === null) return;
        const childServerId = HarnessAgentId.make(result.threadId);
        await run(registerAgent, {
          agentId: childServerId,
          threadId: result.threadId,
          kind: "delegated" as const,
          roleDefinitionId: defaultRoleId(),
          spawnedByAgentId: parentServerId,
        });
        await run(upsertRelationship, {
          sourceAgentId: parentServerId,
          targetAgentId: childServerId,
          relationshipDefinitionId,
        });
      },
      forkSidechat: async (agentId, completedTurnId) => {
        const parent = snapshot.agents.find((agent) => agent.id === agentId);
        const parentServerId = serverAgentId(agentId);
        if (parent === undefined || parentServerId === null) return;
        const result = await createGraphThread(parent.projectId, "Side chat");
        if (result === null) return;
        const sidechatServerId = HarnessAgentId.make(result.threadId);
        await run(registerAgent, {
          agentId: sidechatServerId,
          threadId: result.threadId,
          kind: "sidechat" as const,
          roleDefinitionId: defaultRoleId(),
          spawnedByAgentId: parentServerId,
        });
        await run(upsertRelationship, {
          sourceAgentId: parentServerId,
          targetAgentId: sidechatServerId,
          relationshipDefinitionId: HarnessRelationshipDefinitionId.make("builtin:sidechat"),
          forkedFromTurnId: completedTurnId as TurnId,
        });
      },
      connect: async (sourceAgentId, targetAgentId, definitionId) => {
        const source = serverAgentId(sourceAgentId);
        const target = serverAgentId(targetAgentId);
        if (source === null || target === null || source === target) return;
        const relationshipDefinitionId = HarnessRelationshipDefinitionId.make(definitionId);
        const relationshipId = HarnessRelationshipId.make(randomUUID());
        await run(upsertRelationship, {
          sourceAgentId: source,
          targetAgentId: target,
          relationshipDefinitionId,
          topic:
            graph?.relationshipDefinitions.find(
              (d) => d.relationshipDefinitionId === relationshipDefinitionId,
            )?.name ?? "Shared work",
          relationshipId,
        });
        await run(openChannel, {
          relationshipId,
          topic:
            graph?.relationshipDefinitions.find(
              (d) => d.relationshipDefinitionId === relationshipDefinitionId,
            )?.name ?? "Shared work",
        });
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
              (agent) => graphAgentFor(graph, agent)?.agentId === serverAgent.agentId,
            );
            return local === undefined ? [] : [[serverAgent.agentId, local.id] as const];
          }) ?? [],
        );
        return hydrateCanvasChannel(result.value, localIdByServerId, graph);
      },
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
          body,
          deduplicationKey: `user:${randomUUID()}`,
        });
      },
    };
  }, [
    environmentId,
    latestProject,
    getChannel,
    createGraphThread,
    openChannel,
    registerAgent,
    run,
    sendCoordination,
    serverAgentId,
    graph,
    snapshot.agents,
    snapshot.channels,
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
      const nativeBacking = agent.backing.kind === "native" ? agent.backing : undefined;
      const threadId =
        agent.backing.kind === "thread" ? agent.backing.threadId : agent.backing.parentThreadId;
      if (threadId === undefined) return;
      if (nativeBacking !== undefined) {
        useRightPanelStore
          .getState()
          .openAgents(scopeThreadRef(agent.environmentId, threadId), nativeBacking.providerAgentId);
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: agent.environmentId, threadId },
      });
    },
    [navigate],
  );

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <HarnessCanvas
          snapshot={snapshot}
          relationshipDefinitions={
            graph?.relationshipDefinitions.map((definition) => ({
              id: definition.relationshipDefinitionId,
              name: definition.name,
            })) ?? []
          }
          actions={actions}
          onSelectAgent={onSelectAgent}
          onEditDefinitions={() => setDefinitionDialogOpen(true)}
          className="min-h-0"
        />
      </SidebarInset>
      <HarnessDefinitionDialog
        open={isDefinitionDialogOpen}
        onOpenChange={setDefinitionDialogOpen}
        projects={projects
          .filter((project) => project.environmentId === environmentId)
          .map((project) => ({ id: project.id, title: project.title }))}
        graph={graph ?? null}
        onCreateRole={(input) => run(createRoleDefinition, input)}
        onAssignRole={(input) => run(registerAgent, input)}
        onCreateRelationship={(input) => run(createRelationshipDefinition, input)}
      />
    </>
  );
}
