import { DEFAULT_MODEL, ProviderInstanceId } from "@t3tools/contracts";
import type { EnvironmentId, HarnessGraphSnapshot, ThreadId, TurnId } from "@t3tools/contracts";
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
  harnessAgentId,
  layoutHarnessCanvasAgents,
  type HarnessCanvasActions,
  type HarnessCanvasAgent,
  type HarnessCanvasSnapshot,
} from "../harnessCanvas.logic";
import { useRightPanelStore } from "../rightPanelStore";
import {
  harnessGraphCreateRole,
  harnessGraphRead,
  harnessGraphSetAgent,
  harnessGraphSubscribe,
  harnessGraphUpsertEdge,
} from "../state/harnessGraph";
import { useEnvironmentQuery } from "../state/query";
import { useProjects, useThreadShells } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";

type GraphAgent = HarnessGraphSnapshot["agents"][number];

/** Native children nest under each other; their transcripts live in the top-level thread. */
function ownerThreadId(agent: GraphAgent, byThreadId: ReadonlyMap<string, GraphAgent>): ThreadId {
  let current = agent;
  while (current.native !== undefined && current.parentThreadId !== undefined) {
    const parent = byThreadId.get(current.parentThreadId);
    if (parent === undefined) return current.parentThreadId;
    current = parent;
  }
  return current.threadId;
}

function buildSnapshot(
  environmentId: EnvironmentId,
  threads: ReturnType<typeof useThreadShells>,
  projects: ReturnType<typeof useProjects>,
  graph: HarnessGraphSnapshot | null,
): HarnessCanvasSnapshot {
  const base = buildHarnessCanvasSnapshotFromThreads(
    threads.filter((thread) => thread.environmentId === environmentId),
    projects.filter((project) => project.environmentId === environmentId),
    new Map(),
    { topInset: 280 },
  );
  if (graph === null) return base;

  const byThreadId = new Map<string, GraphAgent>(graph.agents.map((a) => [a.threadId, a]));
  const nativeAgents = graph.agents.flatMap((serverAgent) => {
    const native = serverAgent.native;
    if (native === undefined) return [];
    const project = projects.find(
      (p) => p.environmentId === environmentId && p.id === serverAgent.projectId,
    );
    return [
      {
        id: harnessAgentId(environmentId, serverAgent.threadId),
        kind: "delegated" as const,
        parentAgentId: null,
        environmentId,
        backing: {
          kind: "native" as const,
          threadId: serverAgent.threadId,
          provider: native.provider,
          providerAgentId: native.providerAgentId,
          ownerThreadId: ownerThreadId(serverAgent, byThreadId),
        },
        projectId: serverAgent.projectId,
        title: serverAgent.displayName,
        projectTitle: project?.title ?? "Unknown project",
        activity: `Native ${native.provider} subagent`,
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
  const agentsWithProvenance = [...base.agents, ...nativeAgents].map((agent) => {
    const metadata = byThreadId.get(agent.backing.threadId);
    const parentThreadId = metadata?.parentThreadId;
    return {
      ...agent,
      kind:
        parentThreadId === undefined
          ? ("root" as const)
          : metadata?.forkedFromTurnId === undefined
            ? ("delegated" as const)
            : ("sidechat" as const),
      parentAgentId:
        parentThreadId === undefined ? null : harnessAgentId(environmentId, parentThreadId),
      // Base positions are fallback layout, not user-dragged session positions.
      position: null,
    };
  });
  const edges = [
    ...deriveHarnessCreationEdges(agentsWithProvenance),
    ...graph.edges.map((edge) => ({
      id: edge.edgeId,
      source: harnessAgentId(environmentId, edge.sourceThreadId),
      target: harnessAgentId(environmentId, edge.targetThreadId),
      kind: "coordination" as const,
      ...(edge.label === undefined ? {} : { label: edge.label }),
    })),
  ];
  return {
    agents: layoutHarnessCanvasAgents(agentsWithProvenance, { topInset: 280 }),
    edges,
  };
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
        ? { agents: [], edges: [] }
        : buildSnapshot(environmentId, threads, projects, graph),
    [environmentId, graph, projects, threads],
  );

  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const createRole = useAtomCommand(harnessGraphCreateRole, { reportFailure: false });
  const setAgent = useAtomCommand(harnessGraphSetAgent, { reportFailure: false });
  const upsertEdge = useAtomCommand(harnessGraphUpsertEdge, { reportFailure: false });

  const threadIdFor = useCallback(
    (localId: string): ThreadId | null =>
      snapshot.agents.find((agent) => agent.id === localId)?.backing.threadId ?? null,
    [snapshot.agents],
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
    const createUnder = async (
      agentId: string,
      title: string,
      forkedFromTurnId?: TurnId,
    ): Promise<void> => {
      const parent = snapshot.agents.find((agent) => agent.id === agentId);
      if (parent === undefined || parent.backing.kind !== "thread") return;
      const result = await createGraphThread(parent.projectId, title);
      if (result === null) return;
      await run(setAgent, {
        threadId: result.threadId,
        parentThreadId: parent.backing.threadId,
        ...(forkedFromTurnId === undefined ? {} : { forkedFromTurnId }),
      });
    };
    return {
      createAgent: async () => {
        if (latestProject === undefined) return;
        await createGraphThread(latestProject.id, "New agent");
      },
      createChild: (agentId) => createUnder(agentId, "New agent"),
      forkSidechat: (agentId, completedTurnId) =>
        createUnder(agentId, "Side chat", completedTurnId as TurnId),
      connect: async (sourceAgentId, targetAgentId) => {
        const sourceThreadId = threadIdFor(sourceAgentId);
        const targetThreadId = threadIdFor(targetAgentId);
        if (sourceThreadId === null || targetThreadId === null) return;
        if (sourceThreadId === targetThreadId) return;
        await run(upsertEdge, { sourceThreadId, targetThreadId });
      },
    };
  }, [
    environmentId,
    latestProject,
    createGraphThread,
    run,
    setAgent,
    snapshot.agents,
    threadIdFor,
    upsertEdge,
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
      const threadId = nativeBacking?.ownerThreadId ?? agent.backing.threadId;
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
        onCreateRole={(input) => run(createRole, input)}
        onAssignRole={(input) => run(setAgent, input)}
      />
    </>
  );
}
