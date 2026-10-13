import { DEFAULT_MODEL, ProviderInstanceId } from "@t3tools/contracts";
import type { EnvironmentId, HarnessGraphSnapshot, ThreadId, TurnId } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useComposerDraftStore, markPromotedDraftThreadByRef } from "../composerDraftStore";
import { threadEnvironment } from "../state/threads";
import { vcsEnvironment } from "../state/vcs";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { randomHex } from "../lib/utils";

import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { SidebarInset } from "./ui/sidebar";
import HarnessCanvas from "./HarnessCanvas";
import HarnessDefinitionDialog from "./HarnessDefinitionDialog";
import {
  buildHarnessCanvasSnapshotFromThreads,
  deriveHarnessCreationEdges,
  harnessAgentId,
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
import { useClientSettings } from "../hooks/useSettings";
import { buildProjectGroups, selectProjectGroupingSettings } from "../logicalProject";
import { useUiStateStore } from "../uiStateStore";

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
    agents: agentsWithProvenance,
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
  const allProjects = useProjects();
  const allThreads = useThreadShells();
  // The canvas follows the sidebar's project filter so it shows the same work.
  const projectScopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projects = useMemo(() => {
    const environmentProjects = allProjects.filter(
      (project) => project.environmentId === environmentId,
    );
    if (projectScopeKey === null) return environmentProjects;
    const group = buildProjectGroups({
      projects: allProjects,
      settings: projectGroupingSettings,
      preferredEnvironmentId: environmentId,
    }).find((candidate) => candidate.key === projectScopeKey);
    if (group === undefined) return environmentProjects;
    const members = new Set(group.memberProjectRefs.map((ref) => scopedProjectKey(ref)));
    return environmentProjects.filter((project) =>
      members.has(scopedProjectKey(scopeProjectRef(project.environmentId, project.id))),
    );
  }, [allProjects, environmentId, projectGroupingSettings, projectScopeKey]);
  const threads = useMemo(() => {
    const projectIds = new Set<string>(projects.map((project) => project.id));
    return allThreads.filter(
      (thread) => thread.environmentId === environmentId && projectIds.has(thread.projectId),
    );
  }, [allThreads, environmentId, projects]);
  const navigate = useNavigate();
  const [isDefinitionDialogOpen, setDefinitionDialogOpen] = useState(false);
  const newThread = useNewThreadHandler();
  const latestProject = projects[0];
  const graphRead = useEnvironmentQuery(
    environmentId === null ? null : harnessGraphRead({ environmentId, input: {} }),
  );
  const graphLive = useEnvironmentQuery(
    environmentId === null ? null : harnessGraphSubscribe({ environmentId, input: {} }),
  );
  const unscopedGraph = graphLive.data ?? graphRead.data;
  const graph = useMemo((): HarnessGraphSnapshot | null => {
    if (unscopedGraph == null) return null;
    const projectIds = new Set<string>(projects.map((project) => project.id));
    return {
      ...unscopedGraph,
      agents: unscopedGraph.agents.filter((agent) => projectIds.has(agent.projectId)),
    };
  }, [projects, unscopedGraph]);
  const snapshot = useMemo(
    () =>
      environmentId === null
        ? { agents: [], edges: [] }
        : buildSnapshot(environmentId, threads, projects, graph),
    [environmentId, graph, projects, threads],
  );

  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const createWorktree = useAtomCommand(vcsEnvironment.createWorktree, { reportFailure: false });
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

  // Each agent works in its own worktree, branched from its lead's branch, so
  // agents never edit the same checkout and the lead merges their branches.
  const createGraphThread = useCallback(
    async (projectId: HarnessCanvasAgent["projectId"], title: string, baseBranch?: string) => {
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
      const worktree =
        project === undefined
          ? null
          : await createWorktree({
              environmentId,
              input: {
                cwd: project.workspaceRoot,
                refName: baseBranch ?? "HEAD",
                newRefName: buildTemporaryWorktreeBranchName(randomHex),
                ...(baseBranch === undefined ? {} : { baseRefName: baseBranch }),
                path: null,
              },
            });
      // Projects outside version control keep sharing the project checkout.
      const checkout =
        worktree?._tag === "Success"
          ? { branch: worktree.value.worktree.refName, worktreePath: worktree.value.worktree.path }
          : { branch: draft.branch, worktreePath: draft.worktreePath };
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
          ...checkout,
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
    [createThread, createWorktree, environmentId, navigate, newThread, projects],
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
      const parentBranch = threads.find((thread) => thread.id === parent.backing.threadId)?.branch;
      const result = await createGraphThread(parent.projectId, title, parentBranch ?? undefined);
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
    threads,
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
        projects={projects.map((project) => ({ id: project.id, title: project.title }))}
        graph={graph}
        onCreateRole={(input) => run(createRole, input)}
        onAssignRole={(input) => run(setAgent, input)}
      />
    </>
  );
}
