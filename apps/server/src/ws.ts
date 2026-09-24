import {
  sameUsageLimitCommandCoverage,
  withUsageLimitsCommands,
} from "@t3tools/shared/usageLimits";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL,
  AuthAccessStreamError,
  type AuthAccessStreamEvent,
  type AuthEnvironmentScope,
  AuthSessionId,
  ClientConnectionMethod,
  ClientDeviceType,
  ClientOs,
  ClientSurface,
  ClientWebDeployment,
  CommandId,
  type DiscoveredLocalServerList,
  EventId,
  type EditorId,
  type FileManagerRevealKind,
  type OrchestrationClientOrigin,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  type OrchestrationShellStreamEvent,
  type OrchestrationShellStreamItem,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  type ProjectEntriesFailure,
  type ProjectFileFailure,
  type ProjectFileOperation,
  ProjectListEntriesError,
  ProjectReadFileError,
  ProjectSearchContentsError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  ProviderUploadFeedbackError,
  ProviderSetupError,
  RelayClientInstallFailedError,
  type RelayClientInstallProgressEvent,
  ServerSelfUpdateError,
  type ServerSelfUpdateProgressEvent,
  type ServerLifecycleStreamEvent,
  type FilesystemBrowseFailure,
  FilesystemBrowseError,
  AssetWorkspaceContextNotFoundError,
  AssetWorkspaceContextResolutionError,
  RpcClientId,
  EnvironmentAuthorizationError,
  ThreadId,
  TurnId,
  type TerminalAttachStreamEvent,
  type TerminalError,
  type TerminalEvent,
  type TerminalMetadataStreamEvent,
  type PullRequestRef,
  WS_METHODS,
  WsRpcGroup,
  WORKTREE_SETUP_ACTIVITY_KIND,
  worktreeSetupActivityId,
  type WorktreeSetupSnapshot,
  HarnessAgentId,
  HarnessChannelId,
  HarnessCoordinationMessageId,
  HarnessDeliveryId,
  HarnessGraphConvergenceLimitError,
  type HarnessGraphError,
  HarnessGraphPersistenceError,
  HarnessGraphValidationError,
  HarnessRelationshipId,
  HARNESS_GRAPH_MAX_CONVERGENCE_ROUNDS,
  providerChildThreadId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import { HttpRouter, HttpServerRequest, HttpServerRespondable } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import * as CheckpointDiffQuery from "./checkpointing/CheckpointDiffQuery.ts";
import * as ServerConfig from "./config.ts";
import * as EnvironmentTheme from "./environmentTheme.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import {
  projectActivityEvent,
  projectThreadDetailSnapshot,
} from "./orchestration/ActivityPayloadProjection.ts";
import { makeThreadLiveEventCoalescer } from "./orchestration/ThreadLiveEventCoalescer.ts";
import { makeLiveStreamBudget, type RetainedLiveItem } from "./orchestration/LiveStreamBudget.ts";
import {
  cleanupFailedUploadedAttachments,
  normalizeDispatchCommand,
} from "./orchestration/Normalizer.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "./orchestration/Services/ThreadDeletionReactor.ts";
import {
  observeRpcEffect as instrumentRpcEffect,
  observeRpcStream as instrumentRpcStream,
  observeRpcStreamEffect as instrumentRpcStreamEffect,
} from "./observability/RpcInstrumentation.ts";
import * as ProviderRegistry from "./provider/Services/ProviderRegistry.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import * as ProviderSessionDirectory from "./provider/Services/ProviderSessionDirectory.ts";
import * as ProviderMaintenanceRunner from "./provider/providerMaintenanceRunner.ts";
import { ProviderAuthService } from "./provider/Services/ProviderAuthService.ts";
import { ProviderInstanceRegistry } from "./provider/Services/ProviderInstanceRegistry.ts";
import { makeProviderInstallation } from "./provider/providerInstallation.ts";
import * as ServerSelfUpdate from "./cloud/selfUpdate.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import { withTerminalOutputWindow } from "./terminal/OutputProtocol.ts";
import * as PreviewAutomationBroker from "./mcp/PreviewAutomationBroker.ts";
import * as DeviceService from "./device/DeviceService.ts";
import { remoteSshDeviceHosts } from "./device/localSshDeviceHost.ts";
import * as PreviewManager from "./preview/Manager.ts";
import { issueAssetUrl } from "./assets/AssetAccess.ts";
import { deletePendingAttachment, issueAttachmentUploadUrl } from "./assets/AttachmentUpload.ts";
import * as PortScanner from "./preview/PortScanner.ts";
import * as WorkspaceEntries from "./workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./workspace/WorkspaceFileSystem.ts";
import { readWorkflowScript } from "./orchestration/workflowScriptQuery.ts";
import * as WorkspacePaths from "./workspace/WorkspacePaths.ts";
import { foldHarnessNativeActivities } from "./harnessGraph.ts";
import * as VcsStatusBroadcaster from "./vcs/VcsStatusBroadcaster.ts";
import * as VcsProvisioningService from "./vcs/VcsProvisioningService.ts";
import * as GitWorkflowService from "./git/GitWorkflowService.ts";
import { linkCreatedPullRequest } from "./git/linkCreatedPullRequest.ts";
import * as ReviewService from "./review/ReviewService.ts";
import * as ProjectSetupScriptRunner from "./project/ProjectSetupScriptRunner.ts";
import * as ProjectCloneTracker from "./project/ProjectCloneTracker.ts";
import * as RepositoryIdentityResolver from "./project/RepositoryIdentityResolver.ts";
import * as WorktreeSetupTracker from "./project/WorktreeSetupTracker.ts";
import * as AgentSessionScanner from "./project/AgentSessionScanner.ts";
import { importRecentAgentThreads } from "./project/AgentSessionImporter.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as RemoteOpenTargets from "./environment/RemoteOpenTargets.ts";
import * as BackgroundPolicy from "./background/BackgroundPolicy.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { requiredScopeForRpcMethod } from "./auth/RpcAuthorization.ts";
import * as ProcessDiagnostics from "./diagnostics/ProcessDiagnostics.ts";
import * as ProcessResourceMonitor from "./diagnostics/ProcessResourceMonitor.ts";
import * as ResourceTelemetry from "./resourceTelemetry/ResourceTelemetry.ts";
import * as HostResources from "./resourceTelemetry/HostResources.ts";
import * as AnalyticsService from "./telemetry/AnalyticsService.ts";
import * as UsageLimitSources from "./usage/UsageLimitSources.ts";
import * as UsageService from "./usage/UsageService.ts";
import * as TraceDiagnostics from "./diagnostics/TraceDiagnostics.ts";
import * as PullRequestService from "./pullRequest/PullRequestService.ts";
import { listLinkedPullRequestThreads } from "./pullRequest/linkedThreads.ts";
import { pullRequestSyncKey } from "./pullRequest/pullRequestSyncKey.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as PullRequestSyncReactor from "./orchestration/PullRequestSyncReactor.ts";
import * as SourceControlDiscovery from "./sourceControl/SourceControlDiscovery.ts";
import * as SourceControlRepositoryService from "./sourceControl/SourceControlRepositoryService.ts";
import * as AzureDevOpsCli from "./sourceControl/AzureDevOpsCli.ts";
import * as BitbucketApi from "./sourceControl/BitbucketApi.ts";
import * as GitHubCli from "./sourceControl/GitHubCli.ts";
import * as GitLabCli from "./sourceControl/GitLabCli.ts";
import * as ForgejoCli from "./sourceControl/ForgejoCli.ts";
import * as SourceControlProviderRegistry from "./sourceControl/SourceControlProviderRegistry.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "./vcs/VcsDriverRegistry.ts";
import * as VcsProjectConfig from "./vcs/VcsProjectConfig.ts";
import * as PairingGrantStore from "./auth/PairingGrantStore.ts";
import * as SessionStore from "./auth/SessionStore.ts";
import { failEnvironmentAuthInvalid, failEnvironmentInternal } from "./auth/http.ts";
import * as RelayClient from "@t3tools/shared/relayClient";
const decodeUnknownJsonString = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeUnknownJsonString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const CONFIG_DISCOVERY_TIMEOUT = Duration.seconds(5);

const resolveDiscoveryForConfig = <A, E, R>(
  discovery: Effect.Effect<A, E, R>,
  onTimeout: () => A,
) =>
  discovery.pipe(
    Effect.timeoutOption(CONFIG_DISCOVERY_TIMEOUT),
    Effect.map(Option.getOrElse(onTimeout)),
  );

export const resolveAvailableEditorsForConfig = <A, E, R>(
  discovery: Effect.Effect<ReadonlyArray<A>, E, R>,
) => resolveDiscoveryForConfig(discovery, () => []);

export const resolveFileManagerRevealKindForConfig = <E, R>(
  discovery: Effect.Effect<FileManagerRevealKind | undefined, E, R>,
) => resolveDiscoveryForConfig(discovery, () => undefined);

function unexpectedCompatibilityError(error: never): never {
  throw new Error(`Unhandled compatibility error: ${String(error)}`);
}

/** Preserve the setup runner's broader pre-refactor message normalization. */
function legacySetupFailureDescription(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }
  return String(cause);
}

function projectEntriesFailureContext(error: WorkspaceEntries.WorkspaceEntriesError): {
  readonly failure: ProjectEntriesFailure;
  readonly normalizedCwd?: string;
  readonly timeout?: string;
  readonly detail?: string;
} {
  switch (error._tag) {
    case "WorkspaceRootNotExistsError":
      return {
        failure: "workspace_root_not_found",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceRootCreateFailedError":
      return {
        failure: "workspace_root_create_failed",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceRootStatFailedError":
      return {
        failure: "workspace_root_stat_failed",
        normalizedCwd: error.normalizedWorkspaceRoot,
        detail: error.phase,
      };
    case "WorkspaceRootNotDirectoryError":
      return {
        failure: "workspace_root_not_directory",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceEntriesReadDirectoryError":
      return {
        failure: "directory_list_failed",
        ...(error.cwd !== undefined ? { normalizedCwd: error.cwd } : {}),
        detail: error.message,
      };
    case "WorkspaceSearchIndexCreateFailed":
      return {
        failure: "search_index_create_failed",
        normalizedCwd: error.cwd,
        detail: error.reason,
      };
    case "WorkspaceSearchIndexScanTimedOut":
      return {
        failure: "search_index_scan_timed_out",
        normalizedCwd: error.cwd,
        timeout: error.timeout,
      };
    case "WorkspaceSearchIndexSearchFailed":
      return {
        failure: "search_index_search_failed",
        normalizedCwd: error.cwd,
        detail: error.reason,
      };
    default:
      return unexpectedCompatibilityError(error);
  }
}

function filesystemBrowseFailureContext(error: WorkspaceEntries.WorkspaceEntriesBrowseError): {
  readonly failure: FilesystemBrowseFailure;
  readonly parentPath?: string;
  readonly platform?: string;
} {
  switch (error._tag) {
    case "WorkspaceEntriesWindowsPathUnsupportedError":
      return { failure: "windows_path_unsupported", platform: error.platform };
    case "WorkspaceEntriesCurrentProjectRequiredError":
      return { failure: "current_project_required" };
    case "WorkspaceEntriesReadDirectoryError":
      return { failure: "read_directory_failed", parentPath: error.parentPath };
    default:
      return unexpectedCompatibilityError(error);
  }
}

function projectFileFailureContext(
  error:
    | WorkspaceFileSystem.WorkspaceFileSystemError
    | WorkspacePaths.WorkspacePathOutsideRootError,
): {
  readonly failure: ProjectFileFailure;
  readonly resolvedPath?: string;
  readonly resolvedWorkspaceRoot?: string;
  readonly operation?: ProjectFileOperation;
  readonly operationPath?: string;
} {
  switch (error._tag) {
    case "WorkspacePathOutsideRootError":
      return { failure: "workspace_path_outside_root" };
    case "WorkspaceFileSystemOperationError":
      return {
        failure: "operation_failed",
        resolvedPath: error.resolvedPath,
        operation: error.operation,
        operationPath: error.operationPath,
      };
    case "WorkspaceFilePathEscapeError":
      return {
        failure: "resolved_path_outside_root",
        resolvedPath: error.resolvedPath,
        resolvedWorkspaceRoot: error.resolvedWorkspaceRoot,
      };
    case "WorkspacePathNotFileError":
      return { failure: "path_not_file", resolvedPath: error.resolvedPath };
    case "WorkspaceBinaryFileError":
      return { failure: "binary_file", resolvedPath: error.resolvedPath };
    default:
      return unexpectedCompatibilityError(error);
  }
}

function projectSetupScriptCompatibilityDetail(
  error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError,
): string {
  switch (error._tag) {
    case "ProjectSetupScriptOperationError":
      return legacySetupFailureDescription(error.cause);
    case "ProjectSetupScriptProjectNotFoundError":
      return "Project was not found for setup script execution.";
    default:
      return unexpectedCompatibilityError(error);
  }
}

export function isThreadDetailEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.message-sent"
      | "thread.proposed-plan-upserted"
      | "thread.activity-appended"
      | "thread.turn-diff-completed"
      | "thread.reverted"
      | "thread.session-set";
  }
> {
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.reverted" ||
    event.type === "thread.session-set"
  );
}

const PROVIDER_STATUS_DEBOUNCE_MS = 200;

// When a resuming client's cursor is more than this many events behind the
// current head, skip the per-event catch-up replay and send a fresh shell
// snapshot instead. Replaying each intervening event costs a shell refetch;
// past this gap a single O(active-threads) snapshot is cheaper and bounded.
// Matches the event store's default page size (DEFAULT_READ_FROM_SEQUENCE_LIMIT).
const SHELL_RESUME_MAX_GAP = 1_000;

// Thread replay counts only this thread's rows. Busy or pruned unrelated
// streams must not force a full thread snapshot.
const THREAD_RESUME_MAX_EVENTS = 1_000;
// Row count alone does not bound replay memory: a few events with large tool
// payloads can decode to gigabytes. Before replaying, sum the serialized
// payload bytes of the range in SQL and reset with a snapshot past this budget.
const ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES = 8 * 1024 * 1024;

function toAuthAccessStreamEvent(
  change: PairingGrantStore.BootstrapCredentialChange | SessionStore.SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

const isClientSurface = Schema.is(ClientSurface);
const isClientConnectionMethod = Schema.is(ClientConnectionMethod);
const isClientDeviceType = Schema.is(ClientDeviceType);
const isClientOs = Schema.is(ClientOs);
const isClientWebDeployment = Schema.is(ClientWebDeployment);
const MAX_CLIENT_APP_VERSION_LENGTH = 64;
const MAX_CLIENT_BROWSER_LENGTH = 64;
const MAX_CLIENT_DEVICE_MODEL_LENGTH = 80;

// Optional client identity announced on the /ws upgrade URL next to wsTicket.
// Lenient by design: absent or malformed values degrade to {} so a connection
// never fails over attribution metadata.
function readClientConnectionOrigin(
  request: HttpServerRequest.HttpServerRequest,
): OrchestrationClientOrigin {
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) {
    return {};
  }
  const surface = url.value.searchParams.get("clientSurface");
  const appVersion = url.value.searchParams.get("clientAppVersion")?.trim() ?? "";
  return {
    ...(isClientSurface(surface) ? { surface } : {}),
    ...(appVersion !== "" && appVersion.length <= MAX_CLIENT_APP_VERSION_LENGTH
      ? { appVersion }
      : {}),
  };
}

// Client telemetry stays in this socket's RPC layer. It must not become a
// server-global "current client" because several client types can connect at once.
function readClientAnalyticsProps(request: HttpServerRequest.HttpServerRequest) {
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) {
    return {};
  }

  const surface = url.value.searchParams.get("clientSurface");
  const appVersion = url.value.searchParams.get("clientAppVersion")?.trim() ?? "";
  const deviceType = url.value.searchParams.get("clientDeviceType");
  const os = url.value.searchParams.get("clientOs");
  const webDeployment = url.value.searchParams.get("clientWebDeployment");
  const browser = url.value.searchParams.get("clientBrowser")?.trim() ?? "";
  const connectionMethod = url.value.searchParams.get("connectionMethod");
  const rawOsMajorVersion = url.value.searchParams.get("clientOsMajorVersion") ?? "";
  const osMajorVersion = Number(rawOsMajorVersion);
  const deviceModel = url.value.searchParams.get("clientDeviceModel")?.trim() ?? "";
  const isMobile = surface === "mobile";
  const hasOsMajorVersion =
    isMobile && rawOsMajorVersion !== "" && Number.isInteger(osMajorVersion) && osMajorVersion > 0;
  const hasDeviceModel =
    isMobile && deviceModel !== "" && deviceModel.length <= MAX_CLIENT_DEVICE_MODEL_LENGTH;

  return {
    ...(isClientSurface(surface) ? { surface } : {}),
    ...(appVersion !== "" && appVersion.length <= MAX_CLIENT_APP_VERSION_LENGTH
      ? { appVersion, clientAppVersion: appVersion }
      : {}),
    ...(isClientOs(os)
      ? {
          clientOs: os,
          ...(isMobile && (os === "iOS" || os === "Android") ? { os } : {}),
        }
      : {}),
    ...(isClientDeviceType(deviceType) ? { clientDeviceType: deviceType } : {}),
    ...(surface === "web" && isClientWebDeployment(webDeployment) ? { webDeployment } : {}),
    ...(surface === "web" && browser !== "" && browser.length <= MAX_CLIENT_BROWSER_LENGTH
      ? { clientBrowser: browser }
      : {}),
    ...(hasOsMajorVersion ? { osMajorVersion, clientOsMajorVersion: osMajorVersion } : {}),
    ...(hasDeviceModel ? { deviceModel, clientDeviceModel: deviceModel } : {}),
    ...(isClientConnectionMethod(connectionMethod) ? { connectionMethod } : {}),
  };
}

const makeWsRpcLayer = (
  currentSession: EnvironmentAuth.AuthenticatedSession,
  clientOrigin: OrchestrationClientOrigin,
  clientAnalyticsProps: Readonly<Record<string, unknown>>,
  previewAutomationBroker: PreviewAutomationBroker.PreviewAutomationBroker["Service"],
  harnessGraphChanges: PubSub.PubSub<void>,
) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const currentSessionId = currentSession.sessionId;
      const crypto = yield* Crypto.Crypto;
      const sql = yield* SqlClient.SqlClient;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
      /** A reference's host-level link key; the project's own host where the ref names none. */
      const resolvePullRequestSyncKey = (reference: PullRequestRef) =>
        reference.host !== undefined && reference.repository.includes("/")
          ? Effect.succeed(pullRequestSyncKey(reference))
          : projectionSnapshotQuery.getProjectShellById(reference.projectId).pipe(
              Effect.map((project) =>
                pullRequestSyncKey(reference, Option.getOrUndefined(project)?.repositoryIdentity),
              ),
              Effect.orElseSucceed(() => null),
            );
      const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
      const threadDeletionReactor = yield* ThreadDeletionReactor;
      const analytics = yield* AnalyticsService.AnalyticsService;
      // Every command dispatched on this connection carries the connecting
      // client's origin, including server-generated bootstrap sub-commands:
      // the client's request caused them.
      const hasClientOrigin =
        clientOrigin.surface !== undefined || clientOrigin.appVersion !== undefined;
      const dispatchFromClient: OrchestrationEngine.OrchestrationEngineShape["dispatch"] = (
        command,
      ) =>
        orchestrationEngine.dispatch(
          command,
          hasClientOrigin ? { origin: clientOrigin } : undefined,
        );
      const recordClientCommandAnalytics = (command: OrchestrationCommand) => {
        switch (command.type) {
          case "thread.create":
            return analytics.record("client.thread.started", clientAnalyticsProps);
          case "thread.turn.start":
            return command.bootstrap?.createThread
              ? Effect.andThen(
                  analytics.record("client.thread.started", clientAnalyticsProps),
                  analytics.record("client.turn.requested", clientAnalyticsProps),
                )
              : analytics.record("client.turn.requested", clientAnalyticsProps);
          default:
            return Effect.void;
        }
      };
      const checkpointDiffQuery = yield* CheckpointDiffQuery.CheckpointDiffQuery;
      const keybindings = yield* Keybindings.Keybindings;
      const environmentTheme = yield* EnvironmentTheme.EnvironmentThemeService;
      const usageLimitSources = yield* UsageLimitSources.UsageLimitSources;
      const externalLauncher = yield* ExternalLauncher.ExternalLauncher;
      const remoteOpenTargets = yield* RemoteOpenTargets.RemoteOpenTargets;
      const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
      const review = yield* ReviewService.ReviewService;
      const vcsProvisioning = yield* VcsProvisioningService.VcsProvisioningService;
      const vcsStatusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const terminalManager = yield* TerminalManager.TerminalManager;
      const previewManager = yield* PreviewManager.PreviewManager;
      const deviceService = yield* DeviceService.DeviceService;
      const deviceHostContext =
        yield* Effect.context<Effect.Services<ReturnType<typeof remoteSshDeviceHosts>>>();
      const portDiscovery = yield* PortScanner.PortDiscovery;
      const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
      const providerService = yield* ProviderService.ProviderService;
      const providerSessionDirectory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
      const providerMaintenanceRunner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
      const providerAuth = yield* ProviderAuthService;
      const providerInstances = yield* ProviderInstanceRegistry;
      const providerInstallation = yield* makeProviderInstallation();
      const serverUpdate = yield* ServerSelfUpdate.ServerSelfUpdate;
      const config = yield* ServerConfig.ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
      const canReplayPersistedRange = Effect.fnUntraced(function* (
        afterSequence: number,
        headSequence: number,
        maxGap: number,
      ) {
        const replayGap = headSequence - afterSequence;
        if (replayGap < 0 || replayGap > maxGap) {
          return false;
        }
        const stats = yield* projectionSnapshotQuery
          .getEventReplayStats({
            fromSequenceExclusive: afterSequence,
            toSequenceInclusive: headSequence,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to measure orchestration replay range",
                  cause,
                }),
            ),
          );
        if (stats.payloadBytes > ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES) {
          yield* Effect.logDebug("orchestration replay replaced by snapshot", {
            afterSequence,
            headSequence,
            replayGap,
            eventCount: stats.eventCount,
            payloadBytes: stats.payloadBytes,
            payloadBudgetBytes: ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES,
          });
          return false;
        }
        return true;
      });
      const projectSetupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
      const worktreeSetupTracker = yield* WorktreeSetupTracker.WorktreeSetupTracker;
      const projectCloneTracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      const repositoryIdentityResolver =
        yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      // Clone hooks run on the tracker's fiber, outside any RPC, so the
      // normalizer's services are captured here rather than inherited.
      const normalizerContext = yield* Effect.context<
        | FileSystem.FileSystem
        | Path.Path
        | ServerConfig.ServerConfig
        | WorkspacePaths.WorkspacePaths
      >();
      const agentSessionScanner = yield* AgentSessionScanner.AgentSessionScanner;
      const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
      const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
      const rpcClientIds = yield* Ref.make(new Set<RpcClientId>());
      yield* Effect.addFinalizer(() =>
        Ref.get(rpcClientIds).pipe(
          Effect.flatMap((clientIds) =>
            Effect.forEach(
              clientIds,
              (clientId) => backgroundPolicy.removeRpcClient(currentSessionId, clientId),
              {
                discard: true,
              },
            ),
          ),
          Effect.ignore,
        ),
      );
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sourceControlDiscovery = yield* SourceControlDiscovery.SourceControlDiscovery;
      const automaticGitFetchInterval = serverSettings.getSettings.pipe(
        Effect.map(
          (settings) => resolveServerBackgroundActivitySettings(settings).automaticGitFetchInterval,
        ),
        Effect.catch((cause) =>
          Effect.logWarning("Failed to read automatic Git fetch interval setting", {
            detail: cause.message,
          }).pipe(Effect.as(DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL)),
        ),
      );
      const sourceControlRepositories =
        yield* SourceControlRepositoryService.SourceControlRepositoryService;
      const pullRequests = yield* PullRequestService.PullRequestService;
      const withPullRequestViewer = pullRequests.withRoutingCredential;
      const pullRequestSync = yield* PullRequestSyncReactor.PullRequestSyncReactor;
      const bootstrapCredentials = yield* PairingGrantStore.PairingGrantStore;
      const sessions = yield* SessionStore.SessionStore;
      const processDiagnostics = yield* ProcessDiagnostics.ProcessDiagnostics;
      const hostResources = yield* HostResources.HostResources;
      const processResourceMonitor = yield* ProcessResourceMonitor.ProcessResourceMonitor;
      const resourceTelemetry = yield* ResourceTelemetry.ResourceTelemetry;
      const usage = yield* UsageService.UsageService;
      const relayClient = yield* RelayClient.RelayClient;
      const authorizationError = (requiredScope: AuthEnvironmentScope) =>
        new EnvironmentAuthorizationError({
          message: `The authenticated token is missing required scope: ${requiredScope}.`,
          requiredScope,
        });
      const authorizeEffect = <A, E, R>(
        requiredScope: AuthEnvironmentScope,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E | EnvironmentAuthorizationError, R> =>
        currentSession.scopes.includes(requiredScope)
          ? effect
          : Effect.fail(authorizationError(requiredScope));
      const authorizeStream = <A, E, R>(
        requiredScope: AuthEnvironmentScope,
        stream: Stream.Stream<A, E, R>,
      ): Stream.Stream<A, E | EnvironmentAuthorizationError, R> =>
        currentSession.scopes.includes(requiredScope)
          ? stream
          : Stream.fail(authorizationError(requiredScope));
      const observeRpcEffect = <A, E, R>(
        method: string,
        effect: Effect.Effect<A, E, R>,
        traceAttributes?: Readonly<Record<string, unknown>>,
      ) =>
        instrumentRpcEffect(
          method,
          authorizeEffect(requiredScopeForRpcMethod(method), effect),
          traceAttributes,
        );
      const observeRpcStream = <A, E, R>(
        method: string,
        stream: Stream.Stream<A, E, R>,
        traceAttributes?: Readonly<Record<string, unknown>>,
      ) =>
        instrumentRpcStream(
          method,
          authorizeStream(requiredScopeForRpcMethod(method), stream),
          traceAttributes,
        );
      const observeRpcStreamEffect = <A, StreamError, StreamContext, EffectError, EffectContext>(
        method: string,
        effect: Effect.Effect<
          Stream.Stream<A, StreamError, StreamContext>,
          EffectError,
          EffectContext
        >,
        traceAttributes?: Readonly<Record<string, unknown>>,
      ) =>
        instrumentRpcStreamEffect(
          method,
          authorizeEffect(requiredScopeForRpcMethod(method), effect),
          traceAttributes,
        );
      const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
        isOrchestrationDispatchCommandError(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: cause instanceof Error ? cause.message : fallbackMessage,
              cause,
            });
      const randomUUID = crypto.randomUUIDv4.pipe(
        Effect.mapError((cause) =>
          toDispatchCommandError(cause, "Failed to generate orchestration command identifier."),
        ),
      );
      const serverEventId = randomUUID.pipe(Effect.map(EventId.make));
      const serverCommandId = (tag: string) =>
        randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

      const loadAuthAccessSnapshot = () =>
        Effect.all({
          pairingLinks: serverAuth.listPairingLinks(),
          clientSessions: serverAuth.listClientSessions(currentSessionId),
        }).pipe(
          Effect.mapError(
            (error) =>
              new AuthAccessStreamError({
                message: error.message,
              }),
          ),
        );

      const appendSetupScriptActivity = (input: {
        readonly threadId: ThreadId;
        readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
        readonly summary: string;
        readonly createdAt: string;
        readonly payload: Record<string, unknown>;
        readonly tone: "info" | "error";
      }) =>
        Effect.all({
          commandId: serverCommandId("setup-script-activity"),
          activityId: serverEventId,
        }).pipe(
          Effect.flatMap(({ commandId, activityId }) =>
            dispatchFromClient({
              type: "thread.activity.append",
              commandId,
              threadId: input.threadId,
              activity: {
                id: activityId,
                tone: input.tone,
                kind: input.kind,
                summary: input.summary,
                payload: input.payload,
                turnId: null,
                createdAt: input.createdAt,
              },
              createdAt: input.createdAt,
            }),
          ),
        );

      // The worktree setup's durable record: one activity per thread, upserted
      // by a fixed id when the setup starts and again when it settles. Live
      // progress keeps streaming from the tracker; this is what a reload or
      // another client reads. Best effort: the thread may already be gone
      // after a failed bootstrap.
      const recordWorktreeSetup = (snapshot: WorktreeSetupSnapshot) =>
        serverCommandId("worktree-setup-activity").pipe(
          Effect.flatMap((commandId) =>
            dispatchFromClient({
              type: "thread.activity.append",
              commandId,
              threadId: snapshot.threadId,
              activity: {
                id: EventId.make(worktreeSetupActivityId(snapshot.threadId)),
                tone:
                  snapshot.phase === "failed" ||
                  snapshot.stages.some((stage) => stage.status === "failed")
                    ? "error"
                    : "info",
                kind: WORKTREE_SETUP_ACTIVITY_KIND,
                summary:
                  snapshot.phase === "running"
                    ? "Setting up worktree"
                    : snapshot.phase === "done"
                      ? "Worktree ready"
                      : snapshot.phase === "cancelled"
                        ? "Worktree setup cancelled"
                        : "Worktree setup failed",
                payload: snapshot,
                turnId: null,
                createdAt: snapshot.startedAt,
              },
              createdAt: snapshot.endedAt ?? snapshot.startedAt,
            }),
          ),
          Effect.ignoreCause({ log: true }),
        );

      const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause);
        return isOrchestrationDispatchCommandError(error)
          ? error
          : new OrchestrationDispatchCommandError({
              message:
                error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
              cause,
            });
      };

      // Shell updates refetch the aggregate. Message and tool bodies are not needed.
      const toShellEvent = ({
        type,
        aggregateKind,
        aggregateId,
        sequence,
      }: OrchestrationEvent) => ({
        type,
        aggregateKind,
        aggregateId,
        sequence,
      });
      type ShellEvent = ReturnType<typeof toShellEvent>;

      const toShellStreamEvent = (
        event: ShellEvent,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
        switch (event.type) {
          case "project.created":
          case "project.meta-updated":
            return projectUpsertOrRemove(ProjectId.make(event.aggregateId), event.sequence);
          case "project.deleted":
            return Effect.succeed(
              Option.some({
                kind: "project-removed" as const,
                sequence: event.sequence,
                projectId: ProjectId.make(event.aggregateId),
              }),
            );
          case "thread.deleted":
          case "thread.archived":
            return Effect.succeed(
              Option.some({
                kind: "thread-removed" as const,
                sequence: event.sequence,
                threadId: ThreadId.make(event.aggregateId),
              }),
            );
          case "thread.unarchived":
            return threadUpsertOrRemove(ThreadId.make(event.aggregateId), event.sequence);
          default:
            if (event.aggregateKind !== "thread") {
              return Effect.succeed(Option.none());
            }
            return threadUpsertOrRemove(ThreadId.make(event.aggregateId), event.sequence);
        }
      };

      // Coalescing makes each projection read represent every event for that
      // aggregate in the current window. Retry a typed persistence failure once
      // so a brief read failure cannot strand the shell at its previous state.
      // If both attempts fail, log and drop the stream item; treating an error as
      // a missing row would incorrectly remove a still-active aggregate.
      const retryShellProjectionRead = <A, E>(
        aggregateKind: "project" | "thread",
        aggregateId: string,
        read: Effect.Effect<A, E>,
      ): Effect.Effect<Option.Option<A>, never, never> =>
        read.pipe(
          Effect.retry({ times: 1 }),
          Effect.map(Option.some),
          Effect.tapError((error) =>
            Effect.logWarning("orchestration shell projection refetch failed", {
              aggregateKind,
              aggregateId,
              error,
            }),
          ),
          Effect.orElseSucceed(() => Option.none()),
        );

      const projectUpsertOrRemove = (
        projectId: ProjectId,
        sequence: number,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> =>
        retryShellProjectionRead(
          "project",
          projectId,
          projectionSnapshotQuery.getProjectShellById(projectId),
        ).pipe(
          Effect.map(
            Option.flatMap((project) =>
              Option.match(project, {
                onNone: () =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "project-removed" as const,
                    sequence,
                    projectId,
                  }),
                onSome: (nextProject) =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "project-upserted" as const,
                    sequence,
                    project: nextProject,
                  }),
              }),
            ),
          ),
        );

      // Refetch a thread's shell and emit an upsert if it is still active, or a
      // `thread-removed` if the projection has no active row for it. Emitting a
      // removal on a `none` (rather than dropping the event) is what keeps
      // coalescing correct: when a burst collapses a `thread.deleted`/`archived`
      // into a later refetchable event for the same thread, the refetch returns
      // `none` for the now-inactive row and this still tells the sidebar to drop
      // it. A `thread-removed` the client does not have is a harmless no-op. The
      // projection commits in the same transaction before the event publishes,
      // so a `none` reliably means the thread is deleted or archived, not
      // not-yet-persisted.
      const threadUpsertOrRemove = (
        threadId: ThreadId,
        sequence: number,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> =>
        retryShellProjectionRead(
          "thread",
          threadId,
          projectionSnapshotQuery.getThreadShellById(threadId),
        ).pipe(
          Effect.map(
            Option.flatMap((thread) =>
              Option.match(thread, {
                onNone: () =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "thread-removed" as const,
                    sequence,
                    threadId,
                  }),
                onSome: (nextThread) =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "thread-upserted" as const,
                    sequence,
                    thread: nextThread,
                  }),
              }),
            ),
          ),
        );

      // Turn a batch of domain events into shell stream items, coalescing by
      // aggregate first. `toShellStreamEvent` re-reads the *current* projected
      // shell for an aggregate, so within a batch only the latest event per
      // aggregate matters: a burst of streaming `thread.message-sent` deltas for
      // one thread collapses into a single shell refetch, and an unrelated
      // `thread.created` in the same batch is never stuck behind those DB reads.
      //
      // Input events arrive in ascending sequence; we keep the last (highest
      // sequence) event per aggregate, then re-sort ascending before emitting so
      // the client — which applies shell items strictly by increasing sequence
      // and drops any `sequence <= snapshotSequence` — never skips a coalesced
      // item. The refetch runs with bounded concurrency (order-preserving).
      const SHELL_REFETCH_CONCURRENCY = 8;
      const coalesceShellEvents = (
        events: ReadonlyArray<ShellEvent>,
      ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamEvent>, never, never> =>
        Effect.gen(function* () {
          if (events.length === 0) {
            return [];
          }
          const latestByAggregate = new Map<string, ShellEvent>();
          for (const event of events) {
            latestByAggregate.set(`${event.aggregateKind}:${event.aggregateId}`, event);
          }
          const survivors = Array.from(latestByAggregate.values()).sort(
            (left, right) => left.sequence - right.sequence,
          );
          const shellEvents = yield* Effect.forEach(survivors, toShellStreamEvent, {
            concurrency: SHELL_REFETCH_CONCURRENCY,
          });
          return shellEvents.flatMap((option) => (Option.isSome(option) ? [option.value] : []));
        });

      // Small time/size window over which to coalesce shell events. The window
      // bounds the worst-case added latency for a brand-new thread to appear in
      // the sidebar (imperceptible), while collapsing high-frequency streaming
      // traffic so it can't serialize the shell stream behind per-event DB reads.
      const SHELL_COALESCE_WINDOW = Duration.millis(50);
      const SHELL_COALESCE_MAX_CHUNK = 512;
      const coalesceShellStream = <E, R>(
        stream: Stream.Stream<OrchestrationEvent, E, R>,
      ): Stream.Stream<OrchestrationShellStreamEvent, E, R> =>
        stream.pipe(
          Stream.map(toShellEvent),
          Stream.groupedWithin(SHELL_COALESCE_MAX_CHUNK, SHELL_COALESCE_WINDOW),
          Stream.mapEffect(coalesceShellEvents),
          Stream.flatMap((items) => Stream.fromIterable(items)),
        );

      type ShellLiveInput =
        | { readonly kind: "event"; readonly event: ShellEvent }
        | { readonly kind: "synchronized" };

      // A completion marker is queued alongside live event metadata so it cannot
      // overtake an event still waiting in the coalescing window. Split each
      // batch at markers and coalesce only the event segments on either side.
      const coalesceShellLiveInputs = (
        inputs: ReadonlyArray<ShellLiveInput>,
      ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamItem>, never, never> =>
        Effect.gen(function* () {
          const output: Array<OrchestrationShellStreamItem> = [];
          let pendingEvents: Array<ShellEvent> = [];

          for (const input of inputs) {
            if (input.kind === "event") {
              pendingEvents.push(input.event);
              continue;
            }

            output.push(...(yield* coalesceShellEvents(pendingEvents)));
            pendingEvents = [];
            output.push({ kind: "synchronized" });
          }

          output.push(...(yield* coalesceShellEvents(pendingEvents)));
          return output;
        });

      const dispatchBootstrapTurnStart = (
        command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
        Effect.gen(function* () {
          const bootstrap = command.bootstrap;
          const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
          let createdThread = false;
          let targetProjectId = bootstrap?.createThread?.projectId;
          let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
          let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;
          // The setup script's terminal, once started. Cancel closes only this
          // one so terminals the user opened meanwhile survive.
          let setupTerminalId: string | null = null;

          // Set once the checkout starts; see the session.set below.
          let preparingSessionSet = false;
          const markPreparingSessionFailed = (detail: string) =>
            Effect.gen(function* () {
              const failedAt = yield* nowIso;
              yield* dispatchFromClient({
                type: "thread.session.set",
                commandId: yield* serverCommandId("bootstrap-thread-preparing-failed"),
                threadId,
                session: {
                  threadId,
                  status: "error",
                  providerName: null,
                  providerInstanceId:
                    bootstrap?.createThread?.modelSelection.instanceId ??
                    command.modelSelection?.instanceId,
                  runtimeMode: command.runtimeMode,
                  activeTurnId: null,
                  lastError: detail.trim().length > 0 ? detail : "Worktree setup failed.",
                  updatedAt: failedAt,
                },
                createdAt: failedAt,
              });
            });
          const cleanupCreatedThread = () =>
            createdThread
              ? serverCommandId("bootstrap-thread-delete").pipe(
                  Effect.flatMap((commandId) =>
                    dispatchFromClient({
                      type: "thread.delete",
                      commandId,
                      threadId: command.threadId,
                    }),
                  ),
                  Effect.as(true),
                )
              : Effect.succeed(false);

          const recordSetupScriptLaunchFailure = (input: {
            readonly error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError;
            readonly requestedAt: string;
            readonly worktreePath: string;
          }) => {
            const detail = projectSetupScriptCompatibilityDetail(input.error);
            return appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.failed",
              summary: "Setup script failed to start",
              createdAt: input.requestedAt,
              payload: {
                detail,
                worktreePath: input.worktreePath,
              },
              tone: "error",
            }).pipe(
              Effect.ignoreCause({ log: false }),
              Effect.flatMap(() =>
                Effect.logWarning("bootstrap turn start failed to launch setup script", {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  detail,
                }),
              ),
            );
          };

          const recordSetupScriptStarted = (input: {
            readonly requestedAt: string;
            readonly worktreePath: string;
            readonly scriptId: string;
            readonly scriptName: string;
            readonly terminalId: string;
          }) =>
            Effect.gen(function* () {
              const startedAt = yield* nowIso;
              const payload = {
                scriptId: input.scriptId,
                scriptName: input.scriptName,
                terminalId: input.terminalId,
                worktreePath: input.worktreePath,
              };
              yield* Effect.all([
                appendSetupScriptActivity({
                  threadId: command.threadId,
                  kind: "setup-script.requested",
                  summary: "Starting setup script",
                  createdAt: input.requestedAt,
                  payload,
                  tone: "info",
                }),
                appendSetupScriptActivity({
                  threadId: command.threadId,
                  kind: "setup-script.started",
                  summary: "Setup script started",
                  createdAt: startedAt,
                  payload,
                  tone: "info",
                }),
              ]).pipe(
                Effect.asVoid,
                Effect.catch((error) =>
                  Effect.logWarning(
                    "bootstrap turn start launched setup script but failed to record setup activity",
                    {
                      threadId: command.threadId,
                      worktreePath: input.worktreePath,
                      scriptId: input.scriptId,
                      terminalId: input.terminalId,
                      detail: error.message,
                    },
                  ),
                ),
              );
            });

          const tracked = bootstrap?.prepareWorktree !== undefined;
          const threadId = command.threadId;
          const track = (effect: Effect.Effect<void>) => (tracked ? effect : Effect.void);

          // Starts the setup script. For tracked bootstraps it returns the
          // effect that waits for the script to exit and records the outcome
          // on the card; whether the agent stage waits on it depends on the
          // script's `async` flag. Returns null when nothing is left to await.
          // Untracked callers keep the old fire-and-forget behavior.
          const runSetupProgram = () =>
            Effect.gen(function* () {
              if (!bootstrap?.runSetupScript || !targetWorktreePath) {
                yield* track(worktreeSetupTracker.stageStatus(threadId, "setup-script", "skipped"));
                return null;
              }
              const worktreePath = targetWorktreePath;
              const requestedAt = yield* nowIso;
              yield* track(worktreeSetupTracker.stageStatus(threadId, "setup-script", "running"));
              const setupResult = yield* projectSetupScriptRunner
                .runForThread({
                  threadId,
                  ...(targetProjectId ? { projectId: targetProjectId } : {}),
                  ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                  worktreePath,
                  ...(tracked
                    ? {
                        observeCompletion: {
                          onOutputLine: (line) =>
                            worktreeSetupTracker.appendTail(threadId, "setup-script", line),
                        },
                      }
                    : {}),
                })
                .pipe(
                  Effect.matchEffect({
                    onFailure: (error) =>
                      recordSetupScriptLaunchFailure({
                        error,
                        requestedAt,
                        worktreePath,
                      }).pipe(
                        Effect.andThen(
                          track(
                            worktreeSetupTracker.stageStatus(
                              threadId,
                              "setup-script",
                              "failed",
                              "failed to start",
                            ),
                          ),
                        ),
                        Effect.as(null),
                      ),
                    onSuccess: (setupResult) => {
                      if (setupResult.status !== "started") {
                        return track(
                          worktreeSetupTracker.stageStatus(
                            threadId,
                            "setup-script",
                            "skipped",
                            "no setup script",
                          ),
                        ).pipe(Effect.as(null));
                      }
                      setupTerminalId = setupResult.terminalId;
                      return recordSetupScriptStarted({
                        requestedAt,
                        worktreePath,
                        scriptId: setupResult.scriptId,
                        scriptName: setupResult.scriptName,
                        terminalId: setupResult.terminalId,
                      }).pipe(
                        Effect.andThen(
                          track(
                            worktreeSetupTracker.update(threadId, (snapshot) => ({
                              ...snapshot,
                              setupScript: {
                                name: setupResult.scriptName,
                                command: setupResult.scriptCommand,
                                terminalId: setupResult.terminalId,
                              },
                            })),
                          ),
                        ),
                        Effect.as(setupResult),
                      );
                    },
                  }),
                );
              if (!tracked || !setupResult?.completion) {
                return null;
              }
              // The setup script is best effort, like the untracked path: a
              // failed install must not throw away the worktree the user just
              // waited for. The card keeps the failed stage and its terminal.
              // Forked right away so the terminal listener behind `completion`
              // is always consumed, even when the turn dispatch fails before
              // anyone would otherwise wait on it. The tracker update is a
              // no-op once the snapshot has been dropped.
              const completionFiber = yield* setupResult.completion.pipe(
                Effect.flatMap((completion) => {
                  if (completion.exitCode === 0) {
                    return worktreeSetupTracker.stageStatus(threadId, "setup-script", "done");
                  }
                  const detail =
                    completion.exitCode === null
                      ? "terminal closed before the script finished"
                      : `exit ${completion.exitCode}`;
                  return worktreeSetupTracker.stageStatus(
                    threadId,
                    "setup-script",
                    "failed",
                    detail,
                  );
                }),
                Effect.forkDetach,
              );
              if (!setupResult.async) {
                yield* Fiber.join(completionFiber);
                return null;
              }
              return completionFiber;
            });

          const bootstrapProgram = Effect.gen(function* () {
            const prepareWorktree = bootstrap?.prepareWorktree;
            let shouldPrepareWorktree = prepareWorktree
              ? yield* gitWorkflow.isRepository(prepareWorktree.projectCwd)
              : false;
            let worktreeBaseRef = prepareWorktree?.baseBranch ?? null;

            if (prepareWorktree && shouldPrepareWorktree) {
              // "Start from origin" is a stored default; repos without the
              // requested remote branch fall back to the local base branch.
              const startFromOrigin =
                prepareWorktree.startFromOrigin === true &&
                (yield* gitWorkflow.remoteExists({
                  cwd: prepareWorktree.projectCwd,
                  remoteName: "origin",
                }));
              if (startFromOrigin) {
                yield* track(worktreeSetupTracker.stageStatus(threadId, "fetch", "running"));
                yield* gitWorkflow.fetchRemote({
                  cwd: prepareWorktree.projectCwd,
                  remoteName: "origin",
                  refName: prepareWorktree.baseBranch,
                });
                const remoteBaseExists = yield* gitWorkflow.remoteBranchExists({
                  cwd: prepareWorktree.projectCwd,
                  refName: prepareWorktree.baseBranch,
                  remoteName: "origin",
                });
                if (remoteBaseExists) {
                  const resolvedRemoteBase = yield* gitWorkflow.resolveRemoteTrackingCommit({
                    cwd: prepareWorktree.projectCwd,
                    refName: prepareWorktree.baseBranch,
                    fallbackRemoteName: "origin",
                  });
                  worktreeBaseRef = resolvedRemoteBase.commitSha;
                  yield* track(
                    worktreeSetupTracker.stageStatus(
                      threadId,
                      "fetch",
                      "done",
                      `origin/${prepareWorktree.baseBranch} at ${resolvedRemoteBase.commitSha.slice(0, 7)}`,
                    ),
                  );
                } else {
                  yield* track(
                    worktreeSetupTracker.stageStatus(
                      threadId,
                      "fetch",
                      "warning",
                      `origin/${prepareWorktree.baseBranch} not found, using local branch`,
                    ),
                  );
                }
              } else {
                yield* track(worktreeSetupTracker.stageStatus(threadId, "fetch", "skipped"));
              }

              const resolvedWorktreeBaseRef = worktreeBaseRef ?? prepareWorktree.baseBranch;
              shouldPrepareWorktree = yield* gitWorkflow.hasCommit({
                cwd: prepareWorktree.projectCwd,
                refName: resolvedWorktreeBaseRef,
              });
              worktreeBaseRef = resolvedWorktreeBaseRef;
              yield* track(
                worktreeSetupTracker.update(threadId, (snapshot) => ({
                  ...snapshot,
                  baseRef: resolvedWorktreeBaseRef,
                })),
              );
            }

            if (prepareWorktree && !shouldPrepareWorktree) {
              if (prepareWorktree.requireWorktree) {
                return yield* new OrchestrationDispatchCommandError({
                  message:
                    "A separate worktree requires a Git repository and a base branch with a commit.",
                });
              }
              // Not a git repo, or the base has no commit: the thread runs in
              // the project checkout instead. The card says so and moves on.
              yield* track(
                worktreeSetupTracker.update(threadId, (snapshot) => ({
                  ...snapshot,
                  stages: snapshot.stages.map((stage) =>
                    stage.id === "fetch" || stage.id === "checkout" || stage.id === "submodules"
                      ? { ...stage, status: "skipped", detail: "using project checkout" }
                      : stage,
                  ),
                })),
              );
            }

            if (bootstrap?.createThread) {
              const created = yield* dispatchFromClient({
                type: "thread.create",
                commandId: yield* serverCommandId("bootstrap-thread-create"),
                threadId: command.threadId,
                projectId: bootstrap.createThread.projectId,
                title: bootstrap.createThread.title,
                modelSelection: bootstrap.createThread.modelSelection,
                runtimeMode: bootstrap.createThread.runtimeMode,
                interactionMode: bootstrap.createThread.interactionMode,
                branch: bootstrap.createThread.branch,
                worktreePath: bootstrap.createThread.worktreePath,
                createdAt: bootstrap.createThread.createdAt,
              });
              // The successful create is a fence in the engine command queue:
              // every delete for the prior incarnation committed before it.
              // Drain through that event before setup or turn start can own
              // terminals and provider sessions under the reused thread id.
              createdThread = true;
              yield* threadDeletionReactor.drainThrough(created.sequence);
              // Persist the send now rather than with the turn: the thread is
              // real from here on, so any client (or a reload) sees the message
              // while the worktree is still being prepared. The turn start
              // later references this id instead of re-sending the text.
              yield* dispatchFromClient({
                type: "thread.message.user.append",
                commandId: yield* serverCommandId("bootstrap-thread-message"),
                threadId: command.threadId,
                message: {
                  messageId: command.message.messageId,
                  text: command.message.text,
                  attachments: command.message.attachments,
                  ...(command.message.context !== undefined
                    ? { context: command.message.context }
                    : {}),
                },
                createdAt: command.createdAt,
              });
              if (tracked) {
                const running = yield* worktreeSetupTracker.get(threadId);
                if (running) yield* recordWorktreeSetup(running);
              }
            }

            if (prepareWorktree && shouldPrepareWorktree && worktreeBaseRef) {
              if (bootstrap?.createThread && createdThread) {
                // The checkout and setup script can run for minutes before the
                // turn starts, and the created thread carries no message or
                // turn until then. Project a starting session now so every
                // client lists the thread as working and a reopened thread
                // knows to follow the setup stream. A failed or cancelled setup
                // deletes the thread, so nothing lingers.
                const preparingAt = yield* nowIso;
                yield* dispatchFromClient({
                  type: "thread.session.set",
                  commandId: yield* serverCommandId("bootstrap-thread-preparing"),
                  threadId,
                  session: {
                    threadId,
                    status: "starting",
                    providerName: null,
                    providerInstanceId: bootstrap.createThread.modelSelection.instanceId,
                    runtimeMode: command.runtimeMode,
                    activeTurnId: null,
                    lastError: null,
                    updatedAt: preparingAt,
                  },
                  createdAt: preparingAt,
                });
                preparingSessionSet = true;
              }
              yield* worktreeSetupTracker.stageStatus(threadId, "checkout", "running");
              let checkoutTotal: number | null = null;
              const worktree = yield* gitWorkflow.createWorktree(
                {
                  cwd: prepareWorktree.projectCwd,
                  refName: worktreeBaseRef,
                  newRefName: prepareWorktree.branch,
                  baseRefName: prepareWorktree.baseBranch,
                  path: null,
                },
                {
                  progress: {
                    // Git has registered the directory at this point, so a
                    // cancel during the submodule step can still remove it.
                    onWorktreeClaimed: (path) =>
                      Effect.sync(() => {
                        targetWorktreePath = path;
                      }),
                    onCheckoutProgress: ({ percent, completed, total }) => {
                      checkoutTotal = total;
                      return worktreeSetupTracker.stage(threadId, "checkout", {
                        percent,
                        detail: `${completed.toLocaleString("en-US")} / ${total.toLocaleString("en-US")} files`,
                      });
                    },
                    onSubmodulesStarted: () =>
                      worktreeSetupTracker
                        .stageStatus(
                          threadId,
                          "checkout",
                          "done",
                          checkoutTotal === null
                            ? null
                            : `${checkoutTotal.toLocaleString("en-US")} files`,
                        )
                        .pipe(
                          Effect.andThen(
                            worktreeSetupTracker.stageStatus(threadId, "submodules", "running"),
                          ),
                        ),
                    onSubmoduleLine: (line) => {
                      const submodulePath = /Submodule path '([^']+)'/.exec(line)?.[1];
                      return submodulePath === undefined
                        ? Effect.void
                        : worktreeSetupTracker.stage(threadId, "submodules", {
                            detail: submodulePath,
                          });
                    },
                    onSubmodulesFinished: ({ ok, detail }) =>
                      worktreeSetupTracker.stageStatus(
                        threadId,
                        "submodules",
                        ok ? "done" : "warning",
                        ok ? undefined : (detail ?? "submodule checkout failed"),
                      ),
                  },
                },
              );
              const checkoutEndedAt = yield* nowIso;
              yield* worktreeSetupTracker.update(threadId, (snapshot) => ({
                ...snapshot,
                worktreePath: worktree.worktree.path,
                stages: snapshot.stages.map((stage) => {
                  if (stage.id === "checkout" && stage.status === "running") {
                    return {
                      ...stage,
                      status: "done",
                      percent: 100,
                      endedAt: checkoutEndedAt,
                      detail:
                        checkoutTotal === null
                          ? stage.detail
                          : `${checkoutTotal.toLocaleString("en-US")} files`,
                    };
                  }
                  if (stage.id === "submodules" && stage.status === "pending") {
                    return { ...stage, status: "skipped", detail: "none" };
                  }
                  return stage;
                }),
              }));
              targetWorktreePath = worktree.worktree.path;
              yield* dispatchFromClient({
                type: "thread.meta.update",
                commandId: yield* serverCommandId("bootstrap-thread-meta-update"),
                threadId,
                branch: worktree.worktree.refName,
                worktreePath: targetWorktreePath,
              });
              yield* refreshGitStatus(targetWorktreePath);
            }

            const pendingSetupScript = yield* runSetupProgram();

            yield* track(worktreeSetupTracker.stageStatus(threadId, "agent", "running"));
            // Past this point a cancel would roll back a thread whose turn has
            // started. Drop the cancel handle and make the handoff atomic.
            yield* track(worktreeSetupTracker.markUncancellable(threadId));
            const started = yield* Effect.uninterruptible(
              dispatchFromClient(finalTurnStartCommand),
            );
            yield* track(worktreeSetupTracker.stageStatus(threadId, "agent", "done"));
            // An async setup script outlives the handoff: the snapshot stays
            // running so the client keeps its row next to the agent's work,
            // and settles when the script exits. The turn already started, so
            // the wait cannot fail the dispatch.
            const settle = tracked
              ? worktreeSetupTracker
                  .finish(threadId, "done")
                  .pipe(
                    Effect.flatMap((snapshot) =>
                      snapshot ? recordWorktreeSetup(snapshot) : Effect.void,
                    ),
                  )
              : Effect.void;
            if (pendingSetupScript) {
              yield* Fiber.join(pendingSetupScript).pipe(
                Effect.ignoreCause({ log: true }),
                Effect.andThen(settle),
                Effect.forkDetach,
              );
            } else {
              yield* settle;
            }
            return started;
          });

          const cleanupAndFail = (
            cause: Cause.Cause<unknown>,
            dispatchError: OrchestrationDispatchCommandError,
          ) =>
            Effect.uninterruptible(cleanupCreatedThread()).pipe(
              Effect.matchCauseEffect({
                onFailure: (cleanupCause) =>
                  Effect.logWarning("bootstrap thread cleanup failed", {
                    threadId,
                    detail: Cause.pretty(cleanupCause),
                  }).pipe(
                    // The thread outlived its setup. Its preparing session
                    // must not read as working forever, so record the failure
                    // on it instead.
                    Effect.andThen(
                      preparingSessionSet
                        ? markPreparingSessionFailed(dispatchError.message).pipe(
                            Effect.ignoreCause({ log: true }),
                          )
                        : Effect.void,
                    ),
                    Effect.flatMap(() => Effect.fail(dispatchError)),
                  ),
                onSuccess: (threadDeleted) =>
                  Effect.fail(
                    threadDeleted ||
                      (bootstrap?.createThread &&
                        bootstrap.prepareWorktree?.requireWorktree === true &&
                        !createdThread)
                      ? new OrchestrationDispatchCommandError({
                          message: dispatchError.message,
                          ...(dispatchError.cause !== undefined
                            ? { cause: dispatchError.cause }
                            : {}),
                          bootstrapThreadDisposition: threadDeleted ? "deleted" : "not-created",
                        })
                      : dispatchError,
                  ),
              }),
            );

          const settledBootstrapProgram = bootstrapProgram.pipe(
            Effect.interruptible,
            Effect.catchCause((cause) => {
              const dispatchError = toBootstrapDispatchCommandCauseError(cause);
              if (Cause.hasInterruptsOnly(cause)) {
                // A user cancel interrupts the forked bootstrap fiber. The
                // created thread is rolled back like any other failure so the
                // draft returns to the composer. The setup terminal is closed
                // first so a still-running script cannot hold files open in
                // the worktree while git removes it. Closing kills the
                // process asynchronously, so the removal retries briefly.
                const closeSetupTerminal = setupTerminalId
                  ? terminalManager.close({
                      threadId,
                      terminalId: setupTerminalId,
                      deleteHistory: true,
                    })
                  : Effect.void;
                const removeCreatedWorktree =
                  tracked && targetWorktreePath && bootstrap?.prepareWorktree
                    ? closeSetupTerminal.pipe(
                        Effect.ignoreCause({ log: true }),
                        Effect.andThen(
                          gitWorkflow
                            .removeWorktree({
                              cwd: bootstrap.prepareWorktree.projectCwd,
                              path: targetWorktreePath,
                              force: true,
                            })
                            .pipe(
                              Effect.retry({ times: 4, schedule: Schedule.spaced("500 millis") }),
                            ),
                        ),
                        Effect.ignoreCause({ log: true }),
                        Effect.uninterruptible,
                      )
                    : Effect.void;
                return track(
                  worktreeSetupTracker
                    .finish(threadId, "cancelled")
                    .pipe(
                      Effect.flatMap((snapshot) =>
                        snapshot ? recordWorktreeSetup(snapshot) : Effect.void,
                      ),
                    ),
                ).pipe(
                  Effect.andThen(removeCreatedWorktree),
                  Effect.andThen(
                    tracked
                      ? cleanupAndFail(
                          cause,
                          new OrchestrationDispatchCommandError({
                            message: "Worktree setup cancelled.",
                          }),
                        )
                      : Effect.fail(dispatchError),
                  ),
                );
              }
              return track(
                worktreeSetupTracker
                  .finish(threadId, "failed", dispatchError.message)
                  .pipe(
                    Effect.flatMap((snapshot) =>
                      snapshot ? recordWorktreeSetup(snapshot) : Effect.void,
                    ),
                  ),
              ).pipe(Effect.andThen(cleanupAndFail(cause, dispatchError)));
            }),
            // Cancellation must finish recording and rollback after the bootstrap is interrupted.
            Effect.uninterruptible,
          );

          // The bootstrap outlives the connection that asked for it: a reload
          // or a dropped socket must not abandon a half-made worktree, and
          // the thread it created is already visible to every client. The
          // RPC only waits on the detached fiber; a user cancel interrupts it
          // through the tracker.
          const runBootstrap = tracked
            ? Effect.gen(function* () {
                // Fork and register as one step: a detached fiber keeps going
                // if the caller is interrupted, so it must never exist without
                // the tracker entry that cancel and the stage updates key on.
                const fiber = yield* Effect.uninterruptible(
                  Effect.gen(function* () {
                    const fiber = yield* Effect.forkDetach(settledBootstrapProgram);
                    yield* worktreeSetupTracker.begin({
                      threadId,
                      branch: bootstrap?.prepareWorktree?.branch ?? null,
                      baseRef: bootstrap?.prepareWorktree?.baseBranch ?? null,
                      stages: ["fetch", "checkout", "submodules", "setup-script", "agent"],
                      fiber,
                    });
                    return fiber;
                  }),
                );
                return yield* Fiber.join(fiber);
              })
            : settledBootstrapProgram;

          return yield* runBootstrap;
        });

      const dispatchNormalizedCommand = (
        normalizedCommand: OrchestrationCommand,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
        const dispatchEffect =
          normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
            ? dispatchBootstrapTurnStart(normalizedCommand)
            : dispatchFromClient(normalizedCommand).pipe(
                Effect.tap(({ sequence }) =>
                  // Returning from thread.create is the handoff point at which
                  // clients may start resources for the new incarnation. Use
                  // its event sequence as the exact deletion-cleanup fence.
                  normalizedCommand.type === "thread.create"
                    ? threadDeletionReactor.drainThrough(sequence)
                    : Effect.void,
                ),
                Effect.mapError((cause) =>
                  toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                ),
              );

        return startup
          .enqueueCommand(dispatchEffect)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );
      };

      // Only clients that answer /usage-limits themselves see it in the catalogs;
      // an older client would send the injected command to the provider.
      const loadServerConfig = (options: { readonly usageLimitsCommand: boolean }) =>
        Effect.gen(function* () {
          const keybindingsConfig = yield* keybindings.loadConfigState;
          const currentProviders = yield* providerRegistry.getProviders;
          const providers = options.usageLimitsCommand
            ? withUsageLimitsCommands(currentProviders, yield* usageLimitSources.current)
            : currentProviders;
          const settings = ServerSettings.redactServerSettingsForClient(
            yield* serverSettings.getSettings,
          );
          const environment = yield* serverEnvironment.getDescriptor;
          const auth = yield* serverAuth.getDescriptor();
          const availableEditors: ReadonlyArray<EditorId> = yield* resolveAvailableEditorsForConfig(
            externalLauncher.resolveAvailableEditors(),
          );
          const fileManagerRevealKind = availableEditors.includes("file-manager")
            ? yield* resolveFileManagerRevealKindForConfig(
                externalLauncher.resolveFileManagerRevealKind(),
              )
            : undefined;

          return {
            environment,
            auth,
            cwd: config.cwd,
            keybindingsConfigPath: config.keybindingsConfigPath,
            keybindings: keybindingsConfig.keybindings,
            issues: keybindingsConfig.issues,
            providers,
            availableEditors,
            // Same discovery-with-timeout treatment as editors: a slow probe
            // must not stall server.getConfig, so it degrades to no targets.
            remoteOpenTargets: yield* resolveAvailableEditorsForConfig(
              remoteOpenTargets.resolveTargets(),
            ),
            observability: {
              logsDirectoryPath: config.logsDir,
              localTracingEnabled: true,
              ...(config.otlpTracesUrl !== undefined
                ? { otlpTracesUrl: config.otlpTracesUrl }
                : {}),
              otlpTracesEnabled: config.otlpTracesUrl !== undefined,
              ...(config.otlpMetricsUrl !== undefined
                ? { otlpMetricsUrl: config.otlpMetricsUrl }
                : {}),
              otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
              ...(config.otlpLogsUrl !== undefined ? { otlpLogsUrl: config.otlpLogsUrl } : {}),
              otlpLogsEnabled: config.otlpLogsUrl !== undefined,
            },
            settings,
            shellResumeCompletionMarker: true,
            ...(fileManagerRevealKind === undefined
              ? {}
              : {
                  shellRevealInFileManager: true,
                  shellRevealInFileManagerKind: fileManagerRevealKind,
                }),
            threadResumeCompletionMarker: true,
            threadSnapshotPagination: true,
            reasoningMessages: true,
          };
        });

      const refreshGitStatus = (cwd: string) =>
        vcsStatusBroadcaster
          .refreshStatus(cwd)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

      // Harness keeps graph and coordination state in its own durable tables. The
      // helpers below intentionally live beside the RPC layer for the first slice:
      // they share the same authenticated SQL connection and can be moved behind a
      // service once the graph protocol stabilizes.
      type HarnessAgentRow = {
        readonly agent_id: string;
        readonly thread_id: string;
        readonly project_id: string;
        readonly display_name: string;
        readonly role: "root" | "delegated" | "sidechat";
        readonly status: "active" | "paused" | "completed" | "failed";
        readonly backing_kind: "thread" | "native";
        readonly provider_name: string | null;
        readonly provider_instance_id: string | null;
        readonly provider_agent_id: string | null;
        readonly parent_thread_id: string | null;
        readonly capabilities_json: string;
        readonly parent_agent_id: string | null;
        readonly canvas_x: number;
        readonly canvas_y: number;
        readonly canvas_collapsed: number;
        readonly created_at: string;
        readonly updated_at: string;
      };
      type HarnessRelationshipRow = {
        readonly relationship_id: string;
        readonly source_agent_id: string;
        readonly target_agent_id: string;
        readonly kind: "delegation" | "sidechat";
        readonly topic: string | null;
        readonly forked_from_turn_id: string | null;
        readonly created_at: string;
      };
      type HarnessChannelRow = {
        readonly channel_id: string;
        readonly agent_a_id: string;
        readonly agent_b_id: string;
        readonly topic: string;
        readonly status: "syncing" | "aligned" | "needs-attention" | "paused";
        readonly summary: string | null;
        readonly decisions_json: string;
        readonly revision_a: number;
        readonly revision_b: number;
        readonly acknowledged_revision_a: number;
        readonly acknowledged_revision_b: number;
        readonly convergence_round: number;
        readonly created_at: string;
        readonly updated_at: string;
      };
      type HarnessMessageRow = {
        readonly message_id: string;
        readonly channel_id: string;
        readonly sender_agent_id: string;
        readonly recipient_agent_id: string;
        readonly author_kind: "user" | "agent";
        readonly message_kind: "update" | "question" | "agreement" | "decision" | "test-result";
        readonly topic: string;
        readonly body: string;
        readonly summary: string | null;
        readonly decisions_json: string;
        readonly revision: number;
        readonly round: 1 | 2 | 3;
        readonly deduplication_key: string;
        readonly created_at: string;
      };
      type HarnessDeliveryRow = {
        readonly delivery_id: string;
        readonly message_id: string;
        readonly channel_id: string;
        readonly sender_agent_id: string;
        readonly recipient_agent_id: string;
        readonly side: "outbox" | "inbox";
        readonly state: "pending" | "delivered" | "acknowledged" | "failed";
        readonly attempt_count: number;
        readonly last_error: string | null;
        readonly created_at: string;
        readonly updated_at: string;
      };

      const harnessPersistence = <A, E, R>(operation: string, effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.mapError(
            () =>
              new HarnessGraphPersistenceError({
                operation,
              }),
          ),
        );
      const harnessValidation = (operation: string, detail: string) =>
        Effect.fail(new HarnessGraphValidationError({ operation, detail }));
      const isHarnessGraphError = (error: unknown): error is HarnessGraphError => {
        if (typeof error !== "object" || error === null || !("_tag" in error)) return false;
        const tag = (error as { readonly _tag?: unknown })._tag;
        return (
          tag === "HarnessGraphValidationError" ||
          tag === "HarnessGraphConvergenceLimitError" ||
          tag === "HarnessGraphPersistenceError"
        );
      };
      const observeHarnessRpcEffect = <A, E, R>(
        method: string,
        effect: Effect.Effect<A, E, R>,
        attributes: Readonly<Record<string, unknown>>,
      ) =>
        observeRpcEffect(
          method,
          effect.pipe(
            Effect.mapError((error) =>
              isHarnessGraphError(error)
                ? error
                : new HarnessGraphPersistenceError({ operation: method }),
            ),
          ),
          attributes,
        ) as unknown as Effect.Effect<A, HarnessGraphError, never>;
      const observeHarnessRpcStreamEffect = <A, E, R>(
        method: string,
        effect: Effect.Effect<Stream.Stream<A, E, R>, E, R>,
        attributes: Readonly<Record<string, unknown>>,
      ) =>
        observeRpcStreamEffect(
          method,
          effect.pipe(
            Effect.mapError((error) =>
              isHarnessGraphError(error)
                ? error
                : new HarnessGraphPersistenceError({ operation: method }),
            ),
          ),
          attributes,
        ) as unknown as Stream.Stream<A, HarnessGraphError, never>;
      const parseDecisions = (value: string): ReadonlyArray<string> => {
        try {
          const parsed: unknown = JSON.parse(value);
          return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
            ? parsed
            : [];
        } catch {
          return [];
        }
      };
      const nullable = (value: string | null): { readonly summary?: string } =>
        value === null ? {} : { summary: value };
      const parseHarnessCapabilities = (value: string): ReadonlyArray<"inspect"> => {
        const parsed = parseDecisions(value).filter(
          (capability): capability is "inspect" => capability === "inspect",
        );
        return parsed.length > 0 ? parsed : ["inspect"];
      };
      const makeHarnessAgent = (row: HarnessAgentRow) => {
        const nativeBacking =
          row.backing_kind === "native" &&
          row.provider_agent_id !== null &&
          row.parent_thread_id !== null
            ? {
                kind: "native" as const,
                threadId: ThreadId.make(row.thread_id),
                provider: row.provider_name ?? "native",
                ...(row.provider_instance_id === null
                  ? {}
                  : { providerInstanceId: ProviderInstanceId.make(row.provider_instance_id) }),
                providerAgentId: row.provider_agent_id,
                parentThreadId: ThreadId.make(row.parent_thread_id),
                capabilities: parseHarnessCapabilities(row.capabilities_json),
              }
            : null;
        return {
          agentId: HarnessAgentId.make(row.agent_id),
          ...(nativeBacking === null
            ? {
                threadId: ThreadId.make(row.thread_id),
                backing: {
                  kind: "thread" as const,
                  threadId: ThreadId.make(row.thread_id),
                },
              }
            : {
                threadId: ThreadId.make(row.thread_id),
                backing: nativeBacking,
              }),
          projectId: ProjectId.make(row.project_id),
          displayName: row.display_name,
          role: row.role,
          status: row.status,
          ...(row.parent_agent_id === null
            ? {}
            : { parentAgentId: HarnessAgentId.make(row.parent_agent_id) }),
          canvas: {
            x: Number(row.canvas_x),
            y: Number(row.canvas_y),
            collapsed: Number(row.canvas_collapsed) !== 0,
          },
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      };
      const makeHarnessRelationship = (row: HarnessRelationshipRow) => ({
        relationshipId: HarnessRelationshipId.make(row.relationship_id),
        sourceAgentId: HarnessAgentId.make(row.source_agent_id),
        targetAgentId: HarnessAgentId.make(row.target_agent_id),
        kind: row.kind,
        ...(row.topic === null ? {} : { topic: row.topic }),
        ...(row.forked_from_turn_id === null
          ? {}
          : { forkedFromTurnId: TurnId.make(row.forked_from_turn_id) }),
        createdAt: row.created_at,
      });
      const makeHarnessMessage = (row: HarnessMessageRow) => ({
        messageId: HarnessCoordinationMessageId.make(row.message_id),
        channelId: HarnessChannelId.make(row.channel_id),
        senderAgentId: HarnessAgentId.make(row.sender_agent_id),
        recipientAgentId: HarnessAgentId.make(row.recipient_agent_id),
        authorKind: row.author_kind,
        kind: row.message_kind,
        topic: row.topic,
        body: row.body,
        ...nullable(row.summary),
        decisions: parseDecisions(row.decisions_json),
        revision: Number(row.revision),
        round: row.round,
        deduplicationKey: row.deduplication_key,
        createdAt: row.created_at,
      });
      const makeHarnessDelivery = (row: HarnessDeliveryRow) => ({
        deliveryId: HarnessDeliveryId.make(row.delivery_id),
        messageId: HarnessCoordinationMessageId.make(row.message_id),
        channelId: HarnessChannelId.make(row.channel_id),
        senderAgentId: HarnessAgentId.make(row.sender_agent_id),
        recipientAgentId: HarnessAgentId.make(row.recipient_agent_id),
        side: row.side,
        state: row.state,
        attemptCount: Number(row.attempt_count),
        ...(row.last_error === null ? {} : { lastError: row.last_error }),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      const makeHarnessChannelSummary = (
        row: HarnessChannelRow & {
          readonly message_count: number;
          readonly pending_outbox_count: number;
          readonly pending_inbox_count: number;
        },
      ) => ({
        channelId: HarnessChannelId.make(row.channel_id),
        agentAId: HarnessAgentId.make(row.agent_a_id),
        agentBId: HarnessAgentId.make(row.agent_b_id),
        topic: row.topic,
        status: row.status,
        ...nullable(row.summary),
        decisions: parseDecisions(row.decisions_json),
        revisionA: Number(row.revision_a),
        revisionB: Number(row.revision_b),
        acknowledgedRevisionA: Number(row.acknowledged_revision_a),
        acknowledgedRevisionB: Number(row.acknowledged_revision_b),
        convergenceRound: Number(row.convergence_round),
        messageCount: Number(row.message_count),
        pendingOutboxCount: Number(row.pending_outbox_count),
        pendingInboxCount: Number(row.pending_inbox_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      const bumpHarnessRevision = harnessPersistence(
        "bump-revision",
        Effect.gen(function* () {
          yield* sql`
            UPDATE harness_graph_meta
            SET value = CAST(value AS INTEGER) + 1
            WHERE key = 'revision'
          `;
          const rows = yield* sql<{ readonly value: string }>`
            SELECT value FROM harness_graph_meta WHERE key = 'revision'
          `;
          return Number(rows[0]?.value ?? 0);
        }),
      );
      const publishHarnessGraphChange = PubSub.publish(harnessGraphChanges, undefined);
      const requireHarnessAgent = (agentId: HarnessAgentId) =>
        harnessPersistence(
          "load-agent",
          sql<HarnessAgentRow>`
            SELECT agent_id, thread_id, project_id, display_name, role, status,
                   backing_kind, provider_name, provider_instance_id, provider_agent_id,
                   parent_thread_id, capabilities_json,
                   parent_agent_id, canvas_x, canvas_y, canvas_collapsed,
                   created_at, updated_at
            FROM harness_agents WHERE agent_id = ${agentId}
          `,
        ).pipe(
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? harnessValidation("load-agent", `Agent '${agentId}' does not exist.`)
              : Effect.succeed(rows[0]),
          ),
        );
      const requireHarnessChannel = (channelId: HarnessChannelId) =>
        harnessPersistence(
          "load-channel",
          sql<HarnessChannelRow>`
            SELECT channel_id, agent_a_id, agent_b_id, topic, status, summary,
                   decisions_json, revision_a, revision_b, acknowledged_revision_a,
                   acknowledged_revision_b, convergence_round, created_at, updated_at
            FROM harness_channels WHERE channel_id = ${channelId}
          `,
        ).pipe(
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? harnessValidation("load-channel", `Channel '${channelId}' does not exist.`)
              : Effect.succeed(rows[0]),
          ),
        );
      const ensureHarnessAgents = harnessPersistence(
        "sync-agents",
        Effect.gen(function* () {
          const shell = yield* projectionSnapshotQuery.getShellSnapshot();
          const archivedShell = yield* projectionSnapshotQuery.getArchivedShellSnapshot();
          const threads = [...shell.threads, ...archivedShell.threads];
          const existingRows = yield* sql<{
            readonly agent_id: string;
            readonly thread_id: string;
          }>`
            SELECT agent_id, thread_id FROM harness_agents
          `;
          const existingAgentIds = new Set(existingRows.map((row) => row.agent_id));
          const existingThreadIds = new Set(existingRows.map((row) => row.thread_id));
          let changed = false;
          let insertionIndex = existingRows.length;
          for (const thread of threads) {
            if (existingAgentIds.has(thread.id) || existingThreadIds.has(thread.id)) continue;
            const createdAt = yield* nowIso;
            const column = insertionIndex % 4;
            const row = Math.floor(insertionIndex / 4);
            yield* sql`
              INSERT OR IGNORE INTO harness_agents (
                agent_id, thread_id, project_id, display_name, role, status,
                canvas_x, canvas_y, canvas_collapsed, created_at, updated_at
              ) VALUES (
                ${thread.id}, ${thread.id}, ${thread.projectId}, ${thread.title},
                'root', ${thread.settledOverride === "settled" || thread.archivedAt !== null ? "completed" : "active"},
                ${80 + column * 300}, ${80 + row * 190}, 0, ${createdAt}, ${createdAt}
              )
            `;
            existingAgentIds.add(thread.id);
            existingThreadIds.add(thread.id);
            insertionIndex += 1;
            changed = true;
          }
          if (changed) {
            yield* sql`
              UPDATE harness_graph_meta
              SET value = CAST(value AS INTEGER) + 1
              WHERE key = 'revision'
            `;
            yield* publishHarnessGraphChange;
          }
        }),
      );
      const syncNativeHarnessAgents = harnessPersistence(
        "sync-native-agents",
        Effect.gen(function* () {
          const shell = yield* projectionSnapshotQuery.getShellSnapshot();
          const archivedShell = yield* projectionSnapshotQuery.getArchivedShellSnapshot();
          const threads = [...shell.threads, ...archivedShell.threads];
          const threadById = new Map<string, (typeof threads)[number]>(
            threads.map((thread) => [thread.id, thread] as const),
          );
          const rootAgentRows = yield* sql<{
            readonly agent_id: string;
            readonly thread_id: string;
            readonly backing_kind: "thread" | "native";
          }>`
            SELECT agent_id, thread_id, backing_kind
            FROM harness_agents
            WHERE backing_kind = 'thread'
          `;
          const rootAgentIdByThreadId = new Map(
            rootAgentRows.map((row) => [row.thread_id, row.agent_id] as const),
          );
          const existingNativeRows = yield* sql<{
            readonly agent_id: string;
            readonly thread_id: string;
            readonly display_name: string;
            readonly status: "active" | "paused" | "completed" | "failed";
            readonly parent_agent_id: string | null;
            readonly provider_name: string | null;
            readonly provider_instance_id: string | null;
            readonly provider_agent_id: string | null;
            readonly parent_thread_id: string | null;
            readonly capabilities_json: string;
          }>`
            SELECT agent_id, thread_id, display_name, status, parent_agent_id, provider_name,
                   provider_instance_id, provider_agent_id, parent_thread_id, capabilities_json
            FROM harness_agents
            WHERE backing_kind = 'native'
          `;
          const existingNativeById = new Map(
            existingNativeRows.map((row) => [row.agent_id, row] as const),
          );
          const activityRows = yield* sql<{
            readonly thread_id: string;
            readonly kind: string;
            readonly payload_json: string;
            readonly created_at: string;
          }>`
            SELECT thread_id, kind, payload_json, created_at
            FROM projection_thread_activities
            WHERE kind IN ('task.started', 'task.progress', 'task.updated', 'task.completed')
               OR (
                 json_valid(payload_json) = 1
                 AND json_extract(payload_json, '$.itemType') = 'collab_agent_tool_call'
               )
            ORDER BY thread_id,
              CASE WHEN sequence IS NULL THEN 0 ELSE 1 END,
              sequence, created_at, activity_id
          `;
          const activitiesByThread = new Map<
            string,
            Array<{
              readonly kind: string;
              readonly payload: unknown;
              readonly createdAt: string;
            }>
          >();
          for (const row of activityRows) {
            let payload: unknown;
            try {
              payload = decodeUnknownJsonString(row.payload_json);
            } catch {
              continue;
            }
            const activities = activitiesByThread.get(row.thread_id) ?? [];
            activities.push({ kind: row.kind, payload, createdAt: row.created_at });
            activitiesByThread.set(row.thread_id, activities);
          }

          let changed = false;
          let insertionIndex = rootAgentRows.length + existingNativeRows.length;
          const nativeRows: Array<{
            readonly agentId: string;
            readonly storageThreadId: string;
            readonly projectId: string;
            readonly displayName: string;
            readonly status: "active" | "paused" | "completed" | "failed";
            readonly providerName: string;
            readonly providerInstanceId: string | null;
            readonly providerAgentId: string;
            readonly parentThreadId: string;
            readonly rootAgentId: string;
            readonly parentAgentId: string;
            readonly observedAt: string;
          }> = [];

          for (const [parentThreadId, activities] of activitiesByThread) {
            const parentThread = threadById.get(parentThreadId);
            const rootAgentId = rootAgentIdByThreadId.get(parentThreadId);
            if (parentThread === undefined || rootAgentId === undefined) continue;
            const observations = foldHarnessNativeActivities(activities);
            const nativeAgentIdByProviderId = new Map(
              observations.map(
                (observation) =>
                  [
                    observation.providerAgentId,
                    `native:${parentThreadId}:${observation.providerAgentId}`,
                  ] as const,
              ),
            );
            const providerName = parentThread.session?.providerName ?? "native";
            const providerInstanceId = parentThread.session?.providerInstanceId ?? null;
            for (const observation of observations) {
              const agentId = nativeAgentIdByProviderId.get(observation.providerAgentId);
              if (agentId === undefined) continue;
              const parentAgentId =
                (observation.parentProviderAgentId === null
                  ? undefined
                  : nativeAgentIdByProviderId.get(observation.parentProviderAgentId)) ??
                rootAgentId;
              nativeRows.push({
                agentId,
                storageThreadId: providerChildThreadId(
                  ThreadId.make(parentThreadId),
                  observation.providerAgentId,
                ),
                projectId: parentThread.projectId,
                displayName: observation.title,
                status: observation.status,
                providerName,
                providerInstanceId,
                providerAgentId: observation.providerAgentId,
                parentThreadId,
                rootAgentId,
                parentAgentId,
                observedAt: observation.observedAt,
              });
            }
          }

          const nativeCapabilitiesJson = encodeUnknownJsonString(["inspect"]);
          for (const row of nativeRows) {
            const existing = existingNativeById.get(row.agentId);
            if (
              existing === undefined ||
              existing.thread_id !== row.storageThreadId ||
              existing.display_name !== row.displayName ||
              existing.status !== row.status ||
              existing.parent_agent_id !== row.parentAgentId ||
              existing.provider_name !== row.providerName ||
              existing.provider_instance_id !== row.providerInstanceId ||
              existing.provider_agent_id !== row.providerAgentId ||
              existing.parent_thread_id !== row.parentThreadId ||
              existing.capabilities_json !== nativeCapabilitiesJson
            ) {
              changed = true;
            }
            const canvasColumn = insertionIndex % 4;
            const canvasRow = Math.floor(insertionIndex / 4);
            const createdAt = existing === undefined ? row.observedAt : undefined;
            yield* sql`
              INSERT INTO harness_agents (
                agent_id, thread_id, project_id, display_name, role, status,
                parent_agent_id, canvas_x, canvas_y, canvas_collapsed,
                created_at, updated_at, backing_kind, provider_name,
                provider_instance_id, provider_agent_id, parent_thread_id, capabilities_json
              ) VALUES (
                ${row.agentId}, ${row.storageThreadId}, ${row.projectId}, ${row.displayName},
                'delegated', ${row.status}, ${row.rootAgentId},
                ${80 + canvasColumn * 300}, ${80 + canvasRow * 190}, 0,
                ${createdAt ?? row.observedAt}, ${row.observedAt}, 'native', ${row.providerName},
                ${row.providerInstanceId}, ${row.providerAgentId}, ${row.parentThreadId},
                ${nativeCapabilitiesJson}
              )
              ON CONFLICT (agent_id) DO UPDATE SET
                thread_id = excluded.thread_id,
                project_id = excluded.project_id,
                display_name = excluded.display_name,
                role = excluded.role,
                status = excluded.status,
                parent_agent_id = excluded.parent_agent_id,
                updated_at = excluded.updated_at,
                backing_kind = excluded.backing_kind,
                provider_name = excluded.provider_name,
                provider_instance_id = excluded.provider_instance_id,
                provider_agent_id = excluded.provider_agent_id,
                parent_thread_id = excluded.parent_thread_id,
                capabilities_json = excluded.capabilities_json
            `;
            if (existing === undefined) insertionIndex += 1;
          }

          for (const row of nativeRows) {
            if (row.parentAgentId !== row.rootAgentId) {
              yield* sql`
                UPDATE harness_agents
                SET parent_agent_id = ${row.parentAgentId}, updated_at = ${row.observedAt}
                WHERE agent_id = ${row.agentId}
              `;
            }
            const relationshipId = `native-delegation:${row.agentId}`;
            yield* sql`
              DELETE FROM harness_relationships
                WHERE relationship_id = ${relationshipId}
            `;
            yield* sql`
              INSERT INTO harness_relationships (
                relationship_id, source_agent_id, target_agent_id, kind, topic, created_at
              ) VALUES (
                ${relationshipId}, ${row.parentAgentId}, ${row.agentId}, 'delegation',
                'Provider native subagent', ${row.observedAt}
              )
              ON CONFLICT (source_agent_id, target_agent_id, kind)
              DO UPDATE SET topic = excluded.topic
            `;
          }

          if (changed) {
            yield* sql`
              UPDATE harness_graph_meta
              SET value = CAST(value AS INTEGER) + 1
              WHERE key = 'revision'
            `;
          }
        }),
      );
      const readHarnessSnapshot = (input: { readonly projectId?: ProjectId | undefined } = {}) =>
        harnessPersistence(
          "read-snapshot",
          Effect.gen(function* () {
            yield* ensureHarnessAgents;
            yield* syncNativeHarnessAgents;
            const revisionRows = yield* sql<{ readonly value: string }>`
              SELECT value FROM harness_graph_meta WHERE key = 'revision'
            `;
            const agents =
              input.projectId === undefined
                ? yield* sql<HarnessAgentRow>`
                    SELECT agent_id, thread_id, project_id, display_name, role, status,
                           backing_kind, provider_name, provider_instance_id, provider_agent_id,
                           parent_thread_id, capabilities_json,
                           parent_agent_id, canvas_x, canvas_y, canvas_collapsed,
                           created_at, updated_at
                    FROM harness_agents ORDER BY created_at, agent_id
                  `
                : yield* sql<HarnessAgentRow>`
                    SELECT agent_id, thread_id, project_id, display_name, role, status,
                           backing_kind, provider_name, provider_instance_id, provider_agent_id,
                           parent_thread_id, capabilities_json,
                           parent_agent_id, canvas_x, canvas_y, canvas_collapsed,
                           created_at, updated_at
                    FROM harness_agents WHERE project_id = ${input.projectId}
                    ORDER BY created_at, agent_id
                  `;
            const relationships =
              input.projectId === undefined
                ? yield* sql<HarnessRelationshipRow>`
                    SELECT relationship_id, source_agent_id, target_agent_id, kind, topic,
                           forked_from_turn_id, created_at
                    FROM harness_relationships ORDER BY created_at, relationship_id
                  `
                : yield* sql<HarnessRelationshipRow>`
                    SELECT r.relationship_id, r.source_agent_id, r.target_agent_id, r.kind,
                           r.topic, r.forked_from_turn_id, r.created_at
                    FROM harness_relationships r
                    JOIN harness_agents a ON a.agent_id = r.source_agent_id
                    WHERE a.project_id = ${input.projectId}
                    ORDER BY r.created_at, r.relationship_id
                  `;
            const channels =
              input.projectId === undefined
                ? yield* sql<
                    HarnessChannelRow & {
                      readonly message_count: number;
                      readonly pending_outbox_count: number;
                      readonly pending_inbox_count: number;
                    }
                  >`
                    SELECT c.*,
                      (SELECT COUNT(*) FROM harness_coordination_messages m WHERE m.channel_id = c.channel_id) AS message_count,
                      (SELECT COUNT(*) FROM harness_deliveries d WHERE d.channel_id = c.channel_id AND d.side = 'outbox' AND d.state = 'pending') AS pending_outbox_count,
                      (SELECT COUNT(*) FROM harness_deliveries d WHERE d.channel_id = c.channel_id AND d.side = 'inbox' AND d.state = 'pending') AS pending_inbox_count
                    FROM harness_channels c ORDER BY c.updated_at, c.channel_id
                  `
                : yield* sql<
                    HarnessChannelRow & {
                      readonly message_count: number;
                      readonly pending_outbox_count: number;
                      readonly pending_inbox_count: number;
                    }
                  >`
                    SELECT c.*,
                      (SELECT COUNT(*) FROM harness_coordination_messages m WHERE m.channel_id = c.channel_id) AS message_count,
                      (SELECT COUNT(*) FROM harness_deliveries d WHERE d.channel_id = c.channel_id AND d.side = 'outbox' AND d.state = 'pending') AS pending_outbox_count,
                      (SELECT COUNT(*) FROM harness_deliveries d WHERE d.channel_id = c.channel_id AND d.side = 'inbox' AND d.state = 'pending') AS pending_inbox_count
                    FROM harness_channels c
                    JOIN harness_agents a ON a.agent_id = c.agent_a_id
                    WHERE a.project_id = ${input.projectId}
                    ORDER BY c.updated_at, c.channel_id
                  `;
            return {
              revision: Number(revisionRows[0]?.value ?? 0),
              agents: agents.map(makeHarnessAgent),
              relationships: relationships.map(makeHarnessRelationship),
              channels: channels.map(makeHarnessChannelSummary),
            };
          }),
        );
      const readHarnessChannel = (channel: HarnessChannelRow) =>
        harnessPersistence(
          "read-channel",
          Effect.gen(function* () {
            const messages = yield* sql<HarnessMessageRow>`
              SELECT message_id, channel_id, sender_agent_id, recipient_agent_id,
                     author_kind, message_kind, topic, body, summary, decisions_json,
                     revision, round, deduplication_key, created_at
              FROM harness_coordination_messages
              WHERE channel_id = ${channel.channel_id}
              ORDER BY created_at, message_id
            `;
            const deliveries = yield* sql<HarnessDeliveryRow>`
              SELECT delivery_id, message_id, channel_id, sender_agent_id,
                     recipient_agent_id, side, state, attempt_count, last_error,
                     created_at, updated_at
              FROM harness_deliveries
              WHERE channel_id = ${channel.channel_id}
              ORDER BY created_at, delivery_id
            `;
            return {
              channelId: HarnessChannelId.make(channel.channel_id),
              agentAId: HarnessAgentId.make(channel.agent_a_id),
              agentBId: HarnessAgentId.make(channel.agent_b_id),
              topic: channel.topic,
              status: channel.status,
              ...nullable(channel.summary),
              decisions: parseDecisions(channel.decisions_json),
              revisionA: Number(channel.revision_a),
              revisionB: Number(channel.revision_b),
              acknowledgedRevisionA: Number(channel.acknowledged_revision_a),
              acknowledgedRevisionB: Number(channel.acknowledged_revision_b),
              convergenceRound: Number(channel.convergence_round),
              messages: messages.map(makeHarnessMessage),
              outbox: deliveries.filter((row) => row.side === "outbox").map(makeHarnessDelivery),
              inbox: deliveries.filter((row) => row.side === "inbox").map(makeHarnessDelivery),
              createdAt: channel.created_at,
              updatedAt: channel.updated_at,
            };
          }),
        );

      return WsRpcGroup.of({
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.dispatchCommand,
            Effect.gen(function* () {
              yield* ProjectCloneTracker.rejectCommandsDuringClone(projectCloneTracker, command);
              const normalizedCommand = yield* normalizeDispatchCommand(command);
              // Archive removes the thread from the client, so this transport
              // closes its session and terminals after the command lands.
              // Settlement cleanup is driven by thread.settled events in the
              // provider reactor, including settlements that have no client.
              const archiveCommand =
                normalizedCommand.type === "thread.archive" ? normalizedCommand : undefined;
              // Best-effort on purpose: the user's archive must not
              // fail because this cleanup read blipped, so a failed read
              // logs and skips the stop instead of propagating.
              const shouldStopSessionAfterCommand = archiveCommand
                ? yield* projectionSnapshotQuery.getThreadShellById(archiveCommand.threadId).pipe(
                    Effect.map(
                      Option.match({
                        onNone: () => false,
                        onSome: (thread) =>
                          thread.session !== null && thread.session.status !== "stopped",
                      }),
                    ),
                    Effect.catchCause((cause) =>
                      Effect.logWarning(
                        "failed to read thread session state before session-stop check",
                        { threadId: archiveCommand.threadId, cause },
                      ).pipe(Effect.as(false)),
                    ),
                  )
                : false;
              const result = yield* dispatchNormalizedCommand(normalizedCommand).pipe(
                Effect.tapError(() => cleanupFailedUploadedAttachments(command, normalizedCommand)),
              );
              yield* recordClientCommandAnalytics(normalizedCommand);
              yield* ProjectCloneTracker.discardCloneForDeletedProject(
                projectCloneTracker,
                normalizedCommand,
              );
              if (archiveCommand) {
                if (shouldStopSessionAfterCommand) {
                  yield* Effect.gen(function* () {
                    const stopCommand = yield* normalizeDispatchCommand({
                      type: "thread.session.stop",
                      commandId: CommandId.make(
                        `session-stop-for-archive:${archiveCommand.commandId}`,
                      ),
                      threadId: archiveCommand.threadId,
                      createdAt: yield* nowIso,
                    });

                    yield* dispatchNormalizedCommand(stopCommand);
                  }).pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning("failed to stop provider session during archive", {
                        threadId: archiveCommand.threadId,
                        cause,
                      }),
                    ),
                  );
                }

                // Archive removes the thread from view, so its user-opened
                // terminal panes close with it.
                yield* terminalManager.close({ threadId: archiveCommand.threadId }).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to close thread terminals after archive", {
                      threadId: archiveCommand.threadId,
                      error: error.message,
                    }),
                  ),
                );
              }
              return result;
            }).pipe(
              Effect.mapError((cause) =>
                isOrchestrationDispatchCommandError(cause)
                  ? cause
                  : new OrchestrationDispatchCommandError({
                      message: "Failed to dispatch orchestration command",
                      cause,
                    }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getWorkflowScript]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getWorkflowScript,
            readWorkflowScript({ scriptPath: input.scriptPath }),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getTurnDiff,
            checkpointDiffQuery.getTurnDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetTurnDiffError({
                    message: "Failed to load turn diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getFullThreadDiff,
            checkpointDiffQuery.getFullThreadDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetFullThreadDiffError({
                    message: "Failed to load full thread diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.searchThreads]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.searchThreads,
            projectionSnapshotQuery.searchThreads(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationSearchThreadsError({
                    message: "Failed to search threads",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.subscribeShell]: (input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeShell,
            Effect.gen(function* () {
              // Coalesce the live shell stream per aggregate over a small window
              // so bursts of high-frequency events (streaming message deltas,
              // activity appends) collapse into a single shell refetch and never
              // serialize a brand-new thread's `thread.created` behind hundreds
              // of per-event DB reads. See coalesceShellStream.
              // Attach live delivery into a scope-bound buffer BEFORE loading any
              // snapshot or draining catch-up, otherwise an event published while
              // the snapshot query is in flight is lost (it is past the snapshot's
              // sequence but the live subscription is not attached yet). Every
              // path below emits from this same buffered live tail. Overlapping
              // events are deduped by sequence on the client.
              const liveBudget = yield* makeLiveStreamBudget();
              const liveBuffer = yield* Queue.unbounded<
                RetainedLiveItem<ShellLiveInput>,
                OrchestrationGetSnapshotError
              >();
              let liveBufferClosed = false;
              const closeLiveBuffer = (error?: OrchestrationGetSnapshotError) =>
                Effect.gen(function* () {
                  if (liveBufferClosed) {
                    return;
                  }
                  liveBufferClosed = true;
                  liveBudget.release(yield* Queue.clear(liveBuffer).pipe(Effect.orDie));
                  if (error) {
                    yield* Queue.fail(liveBuffer, error);
                  }
                  yield* Queue.shutdown(liveBuffer);
                });
              yield* Effect.addFinalizer(() => closeLiveBuffer());
              yield* liveBudget.failed.pipe(
                Effect.catchTags({ OrchestrationGetSnapshotError: closeLiveBuffer }),
                Effect.forkScoped,
              );
              yield* Effect.forkScoped(
                orchestrationEngine.streamDomainEvents.pipe(
                  Stream.map(toShellEvent),
                  Stream.runForEach((event) =>
                    liveBudget.retain({ kind: "event" as const, event }, event).pipe(
                      Effect.flatMap((item) => Queue.offer(liveBuffer, item)),
                      Effect.uninterruptible,
                    ),
                  ),
                  // Stop the PubSub consumer even if RPC delivery is waiting
                  // for an ACK and never pulls the failed buffer again.
                  Effect.raceFirst(liveBudget.failed),
                  Effect.catchTags({ OrchestrationGetSnapshotError: () => Effect.void }),
                ),
                { startImmediately: true },
              );
              const coalesceRetainedInputs = (
                items: ReadonlyArray<RetainedLiveItem<ShellLiveInput>>,
              ) =>
                coalesceShellLiveInputs(items.map((item) => item.value)).pipe(
                  Effect.flatMap((output) => liveBudget.replace(items, output)),
                );
              const bufferedLiveStream = Stream.fromQueue(liveBuffer).pipe(
                Stream.groupedWithin(SHELL_COALESCE_MAX_CHUNK, SHELL_COALESCE_WINDOW),
                Stream.mapEffect(coalesceRetainedInputs),
                Stream.flatMap((items) => Stream.fromIterable(items)),
              );

              const loadSnapshot = projectionSnapshotQuery.getShellSnapshot().pipe(
                Effect.tapError((cause) =>
                  Effect.logError("orchestration shell snapshot load failed", { cause }),
                ),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: "Failed to load orchestration shell snapshot",
                      cause,
                    }),
                ),
              );

              // Offer the completion marker into the same queue as live events.
              // Anything buffered while snapshot/replay work was in flight is
              // therefore delivered before the client is told it is synchronized.
              const synchronizedThenLive = liveBudget.deliver(
                input.requestCompletionMarker === true
                  ? Stream.concat(
                      Stream.fromEffect(
                        liveBudget.retain({ kind: "synchronized" as const }).pipe(
                          Effect.flatMap((item) => Queue.offer(liveBuffer, item)),
                          Effect.uninterruptible,
                          Effect.andThen(Queue.takeAll(liveBuffer)),
                          Effect.flatMap(coalesceRetainedInputs),
                        ),
                      ).pipe(Stream.flatMap((items) => Stream.fromIterable(items))),
                      bufferedLiveStream,
                    )
                  : bufferedLiveStream,
              );

              // When the client already holds a shell snapshot (cached, or loaded
              // over HTTP) it passes that snapshot's sequence, and we resume by
              // replaying shell events after it instead of re-sending the whole
              // projects/threads list over the socket. If the client is too far
              // behind, we fall back to a fresh snapshot instead of an unbounded
              // replay (see below).
              if (input.afterSequence !== undefined) {
                const afterSequence = input.afterSequence;
                const headSequence = yield* orchestrationEngine.latestSequence;
                const replayGap = headSequence - afterSequence;
                // Gap too large: replaying every intervening event (each a shell
                // refetch) is far more expensive than a single O(active-threads)
                // snapshot. A cursor ahead of this engine's authoritative state
                // is also invalid, so reset it with a snapshot. Send the snapshot
                // followed by the buffered live tail, exactly as the
                // no-afterSequence path does.
                if (
                  !(yield* canReplayPersistedRange(
                    afterSequence,
                    headSequence,
                    SHELL_RESUME_MAX_GAP,
                  ))
                ) {
                  const snapshot = yield* loadSnapshot;
                  return Stream.concat(
                    Stream.make({ kind: "snapshot" as const, snapshot }),
                    synchronizedThenLive,
                  );
                }
                const catchUpStream = coalesceShellStream(
                  // Replay only through the head captured above. Newer events
                  // are already covered by the live subscription, so this bound
                  // cannot chase a moving event-store head or grow the live
                  // buffer indefinitely while waiting for an empty page.
                  orchestrationEngine.readEvents(afterSequence, replayGap),
                ).pipe(
                  Stream.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: "Failed to replay orchestration shell events",
                        cause,
                      }),
                  ),
                );
                return Stream.concat(catchUpStream, synchronizedThenLive);
              }

              const snapshot = yield* loadSnapshot;
              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot,
                }),
                synchronizedThenLive,
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: (_input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
            projectionSnapshotQuery.getArchivedShellSnapshot().pipe(
              Effect.tapError((cause) =>
                Effect.logError("orchestration archived shell snapshot load failed", { cause }),
              ),
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: "Failed to load archived orchestration shell snapshot",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeThread,
            Effect.gen(function* () {
              const isThisThreadDetailEvent = (event: OrchestrationEvent) =>
                event.aggregateKind === "thread" &&
                event.aggregateId === input.threadId &&
                isThreadDetailEvent(event);

              const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                Stream.filter(isThisThreadDetailEvent),
                Stream.map((event) => ({
                  kind: "event" as const,
                  event: projectActivityEvent(event, input.reasoningMessages === true),
                })),
              );

              // Attach live delivery before reading either replay or snapshot state.
              // Otherwise an event published while the snapshot is loading is lost.
              const liveBuffer = yield* makeThreadLiveEventCoalescer();
              yield* Effect.forkScoped(
                liveStream.pipe(
                  Stream.runForEachArray(liveBuffer.offerAll),
                  Effect.raceFirst(liveBuffer.failed),
                  Effect.catchTags({ OrchestrationGetSnapshotError: () => Effect.void }),
                ),
                { startImmediately: true },
              );
              const bufferedLiveStream = liveBuffer.stream;
              let replayOnMissingSnapshot: typeof bufferedLiveStream | undefined;

              // When the client already loaded the snapshot over HTTP it passes
              // that snapshot's sequence, and we resume the live subscription by
              // replaying persisted events after it instead of re-sending the
              // (potentially multi-KB) snapshot frame over the socket.
              //
              // The live PubSub subscription must be attached *before* draining
              // the catch-up replay, otherwise events published during the replay
              // window are dropped (they are past the persisted tail the replay
              // read, but the live stream is not yet subscribed). So fork the
              // live stream into a buffer bound to this stream's scope, then emit
              // catch-up followed by the buffered/ongoing live events. Overlapping
              // events are deduped by sequence on the client.
              //
              // Measure only this thread's rows. Global sequence gaps can
              // contain unrelated or pruned streams. Keep an explicit upper
              // bound so events after the captured head stay in the live tail.
              if (input.afterSequence !== undefined) {
                const afterSequence = input.afterSequence;
                const headSequence = yield* orchestrationEngine.latestSequence;
                const range = {
                  threadId: input.threadId,
                  fromSequenceExclusive: afterSequence,
                  toSequenceInclusive: headSequence,
                };
                const replayStats =
                  afterSequence > headSequence
                    ? null
                    : yield* orchestrationEngine
                        .getThreadReplayStats({
                          ...range,
                          maxEvents: THREAD_RESUME_MAX_EVENTS,
                        })
                        .pipe(
                          Effect.mapError(
                            (cause) =>
                              new OrchestrationGetSnapshotError({
                                message: `Failed to measure thread ${input.threadId} replay range`,
                                cause,
                              }),
                          ),
                        );
                if (
                  replayStats !== null &&
                  replayStats.eventCount <= THREAD_RESUME_MAX_EVENTS &&
                  replayStats.payloadBytes <= ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES
                ) {
                  const catchUpStream = orchestrationEngine
                    .readThreadEvents({ ...range, limit: THREAD_RESUME_MAX_EVENTS })
                    .pipe(
                      Stream.filter(isThisThreadDetailEvent),
                      Stream.map((event) => ({
                        kind: "event" as const,
                        event: projectActivityEvent(event, input.reasoningMessages === true),
                      })),
                      Stream.mapError(
                        (cause) =>
                          new OrchestrationGetSnapshotError({
                            message: `Failed to replay thread ${input.threadId} events`,
                            cause,
                          }),
                      ),
                    );
                  const afterCatchUp =
                    input.requestCompletionMarker === true
                      ? Stream.unwrap(
                          liveBuffer
                            .offer({ kind: "synchronized" as const })
                            .pipe(Effect.as(bufferedLiveStream)),
                        )
                      : bufferedLiveStream;
                  const replay = Stream.concat(catchUpStream, afterCatchUp);
                  if (!replayStats.hasCreateEvent) {
                    return replay;
                  }
                  replayOnMissingSnapshot = replay;
                }
                // A recreated thread needs a fresh snapshot if it still exists.
                // Oversized replays and invalid cursors also use the snapshot path.
              }

              const snapshot = yield* projectionSnapshotQuery
                .getThreadDetailSnapshot(
                  input.threadId,
                  // Windowing the fallback snapshot is opt-in per subscription:
                  // clients that don't send turnLimit (including all
                  // pre-pagination clients) get the full thread, since they
                  // have no way to load older pages.
                  input.turnLimit === undefined ? undefined : { turnLimit: input.turnLimit },
                )
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: `Failed to load thread ${input.threadId}`,
                        cause,
                      }),
                  ),
                );

              if (Option.isNone(snapshot)) {
                // The recreated thread can already be deleted. Preserve the
                // bounded replay and shell removal instead of retrying a
                // snapshot that cannot exist. Oversized ranges still fail.
                if (replayOnMissingSnapshot !== undefined) {
                  return replayOnMissingSnapshot;
                }
                return yield* new OrchestrationGetSnapshotError({
                  message: `Thread ${input.threadId} was not found`,
                  cause: input.threadId,
                });
              }

              const afterSnapshot =
                input.requestCompletionMarker === true
                  ? Stream.unwrap(
                      liveBuffer
                        .offer({ kind: "synchronized" as const })
                        .pipe(Effect.as(bufferedLiveStream)),
                    )
                  : bufferedLiveStream;
              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot: projectThreadDetailSnapshot(
                    snapshot.value,
                    input.reasoningMessages === true,
                  ),
                }),
                afterSnapshot,
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.serverProbe]: (_input) =>
          observeRpcEffect(WS_METHODS.serverProbe, Effect.succeed({}), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverGetConfig]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetConfig,
            loadServerConfig({ usageLimitsCommand: false }),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverRefreshProviders]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshProviders,
            Effect.gen(function* () {
              // An untargeted refresh is "re-read everything's status", which
              // includes quota from configured usage-limit sources. Awaited,
              // not forked: the RPC scope closes on return and would
              // interrupt a fork before the hub answered.
              if (input.instanceId === undefined) {
                yield* usageLimitSources.refresh;
              }
              let providers = yield* input.cwd !== undefined && input.instanceId !== undefined
                ? providerRegistry.refreshWorkspaceSnapshot({
                    instanceId: input.instanceId,
                    cwd: input.cwd,
                  })
                : input.instanceId !== undefined
                  ? providerRegistry.refreshInstance(input.instanceId)
                  : providerRegistry.refresh();
              if (input.refreshModels) {
                const instances = yield* providerInstances.listInstances;
                for (const instance of instances) {
                  if (
                    !instance.refreshModels ||
                    (input.instanceId !== undefined && input.instanceId !== instance.instanceId) ||
                    !providers.some(
                      (provider) =>
                        provider.instanceId === instance.instanceId &&
                        provider.enabled &&
                        provider.installed,
                    )
                  )
                    continue;
                  yield* instance.refreshModels().pipe(
                    Effect.mapError(
                      (error) =>
                        new ProviderSetupError({
                          instanceId: instance.instanceId,
                          operation: "refresh-models",
                          detail: error.detail,
                        }),
                    ),
                  );
                  providers = yield* providerRegistry.refreshInstance(instance.instanceId);
                }
              }
              return { providers };
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.providerUploadFeedback]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerUploadFeedback,
            providerService.uploadFeedback(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderUploadFeedbackError({
                    threadId: input.threadId,
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.serverUpdateProvider]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateProvider,
            providerMaintenanceRunner.updateProvider(input),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.providerConsumeResetCredit]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerConsumeResetCredit,
            Effect.gen(function* () {
              if ("sourceId" in input) return yield* usageLimitSources.consumeResetCredit(input);
              const instance = yield* providerInstances.getInstance(input.instanceId);
              // A disabled instance must not spend anything on its account.
              if (instance === undefined || !instance.enabled) {
                return yield* new ProviderSetupError({
                  instanceId: input.instanceId,
                  operation: "consume-reset-credit",
                  detail: instance ? "This provider is disabled." : "Provider instance not found.",
                });
              }
              if (instance.consumeResetCredit === undefined) {
                return yield* new ProviderSetupError({
                  instanceId: input.instanceId,
                  operation: "consume-reset-credit",
                  detail: "This provider does not bank reset credits.",
                });
              }
              const outcome = yield* instance.consumeResetCredit().pipe(
                Effect.mapError(
                  (error) =>
                    new ProviderSetupError({
                      instanceId: input.instanceId,
                      operation: "consume-reset-credit",
                      detail: error.detail,
                      cause: error,
                    }),
                ),
              );
              return { outcome };
            }),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerAuthStart]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerAuthStart,
            providerAuth.start(input, currentSessionId),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerAuthComplete]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerAuthComplete,
            providerAuth.complete(input, currentSessionId),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerAuthCancel]: (input) =>
          observeRpcEffect(
            WS_METHODS.providerAuthCancel,
            providerAuth.cancel(input, currentSessionId),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerAuthLogout]: (input) =>
          observeRpcEffect(WS_METHODS.providerAuthLogout, providerAuth.logout(input), {
            "rpc.aggregate": "provider",
          }),
        [WS_METHODS.providerAuthSubscribe]: (input) =>
          observeRpcStream(
            WS_METHODS.providerAuthSubscribe,
            providerAuth.subscribe(input, currentSessionId),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerInstallStart]: (input) =>
          observeRpcEffect(WS_METHODS.providerInstallStart, providerInstallation.start(input), {
            "rpc.aggregate": "provider",
          }),
        [WS_METHODS.providerInstallCancel]: (input) =>
          observeRpcEffect(WS_METHODS.providerInstallCancel, providerInstallation.cancel(input), {
            "rpc.aggregate": "provider",
          }),
        [WS_METHODS.providerInstallSubscribe]: (input) =>
          observeRpcStream(
            WS_METHODS.providerInstallSubscribe,
            providerInstallation.subscribe(input),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerInstallRemove]: (input) =>
          observeRpcEffect(WS_METHODS.providerInstallRemove, providerInstallation.remove(input), {
            "rpc.aggregate": "provider",
          }),
        [WS_METHODS.serverUpdateServer]: (input) =>
          observeRpcEffect(WS_METHODS.serverUpdateServer, serverUpdate.update(input), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverUpdateServerWithProgress]: (input) =>
          observeRpcStream(
            WS_METHODS.serverUpdateServerWithProgress,
            Stream.callback<ServerSelfUpdateProgressEvent, ServerSelfUpdateError>((queue) =>
              serverUpdate
                .update(input, (stage) =>
                  Queue.offer(queue, {
                    type: "progress",
                    stage,
                  }).pipe(Effect.asVoid),
                )
                .pipe(
                  Effect.flatMap((result) =>
                    Queue.offer(queue, {
                      type: "complete",
                      result,
                    }),
                  ),
                  Effect.catchTags({
                    ServerSelfUpdateError: (error) => Queue.fail(queue, error),
                  }),
                  Effect.andThen(Queue.end(queue)),
                  Effect.forkScoped,
                ),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverCommitDesktopUpdate]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverCommitDesktopUpdate,
            serverUpdate.commitDesktopUpdate(input.requestId),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpsertKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverUpsertKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverRemoveKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverRemoveKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.removeKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetSettings]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetSettings,
            serverSettings.getSettings.pipe(
              Effect.map(ServerSettings.redactServerSettingsForClient),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateSettings,
            Effect.gen(function* () {
              const deviceHosts = patch.deviceHosts
                ? yield* remoteSshDeviceHosts(patch.deviceHosts).pipe(
                    Effect.provide(deviceHostContext),
                  )
                : undefined;
              const settings = yield* serverSettings.updateSettings({
                ...patch,
                ...(deviceHosts ? { deviceHosts } : {}),
              });
              return ServerSettings.redactServerSettingsForClient(settings);
            }),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverDiscoverSourceControl]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverDiscoverSourceControl,
            sourceControlDiscovery.discover,
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverGetTraceDiagnostics]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetTraceDiagnostics,
            TraceDiagnostics.readTraceDiagnostics({
              traceFilePath: config.serverTracePath,
              maxFiles: config.traceMaxFiles,
            }),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverGetProcessDiagnostics]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetProcessDiagnostics, processDiagnostics.read, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverGetHostResources]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetHostResources, hostResources.read, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverGetProcessResourceHistory]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverGetProcessResourceHistory,
            processResourceMonitor.readHistory(input),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverGetResourceTelemetryHistory]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverGetResourceTelemetryHistory,
            resourceTelemetry.readHistory(input),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverGetUsageSummary]: (input) =>
          observeRpcEffect(WS_METHODS.serverGetUsageSummary, usage.readSummary(input), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRefreshUsageRates]: (_input) =>
          observeRpcEffect(WS_METHODS.serverRefreshUsageRates, usage.refreshRates, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRetryResourceTelemetry]: (_input) =>
          observeRpcEffect(WS_METHODS.serverRetryResourceTelemetry, resourceTelemetry.retry, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverSignalProcess]: (input) =>
          observeRpcEffect(WS_METHODS.serverSignalProcess, processDiagnostics.signal(input), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverReportClientActivity]: (input, metadata) =>
          Ref.update(rpcClientIds, (clientIds) => {
            const next = new Set(clientIds);
            next.add(RpcClientId.make(metadata.client.id));
            return next;
          }).pipe(
            Effect.andThen(
              observeRpcEffect(
                WS_METHODS.serverReportClientActivity,
                backgroundPolicy.reportClientActivity(
                  currentSessionId,
                  RpcClientId.make(metadata.client.id),
                  input,
                ),
                { "rpc.aggregate": "server" },
              ),
            ),
          ),
        [WS_METHODS.serverReportHostPowerState]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverReportHostPowerState,
            backgroundPolicy.reportHostPowerState(input),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetBackgroundPolicy]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetBackgroundPolicy, backgroundPolicy.snapshot, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.cloudGetRelayClientStatus]: (_input) =>
          observeRpcEffect(WS_METHODS.cloudGetRelayClientStatus, relayClient.resolve, {
            "rpc.aggregate": "cloud",
          }),
        [WS_METHODS.cloudInstallRelayClient]: (_input) =>
          observeRpcStream(
            WS_METHODS.cloudInstallRelayClient,
            Stream.callback<RelayClientInstallProgressEvent, RelayClientInstallFailedError>(
              (queue) =>
                relayClient
                  .installWithProgress((event) => Queue.offer(queue, event).pipe(Effect.asVoid))
                  .pipe(
                    Effect.flatMap((status) =>
                      Queue.offer(queue, {
                        type: "complete",
                        status,
                      }),
                    ),
                    Effect.catchTag("RelayClientInstallError", (error) =>
                      Queue.fail(
                        queue,
                        new RelayClientInstallFailedError({
                          reason: error.reason,
                          message: error.message,
                        }),
                      ),
                    ),
                    Effect.andThen(Queue.end(queue)),
                    Effect.forkScoped,
                  ),
            ),
            { "rpc.aggregate": "cloud" },
          ),
        [WS_METHODS.pullRequestsList]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsList, pullRequests.list(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsListStats]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsListStats, pullRequests.listStats(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsRoutingIdentity]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsRoutingIdentity,
            pullRequests.routingIdentity(input),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsRouting]: (input) =>
          observeRpcEffect(WS_METHODS.pullRequestsRouting, pullRequests.routing(input), {
            "rpc.aggregate": "pull-requests",
          }),
        [WS_METHODS.pullRequestsSummary]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsSummary,
            withPullRequestViewer(input, pullRequests.summary(input)),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsStack]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsStack,
            withPullRequestViewer(input, pullRequests.stack(input)),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsLinkedThreads]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsLinkedThreads,
            resolvePullRequestSyncKey(input).pipe(
              Effect.flatMap((key) =>
                key === null
                  ? Effect.succeed({ threads: [] })
                  : listLinkedPullRequestThreads(key).pipe(
                      Effect.provideService(SqlClient.SqlClient, sql),
                    ),
              ),
            ),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsDetail]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsDetail,
            withPullRequestViewer(input, pullRequests.detail(input)),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsPreview]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsPreview,
            withPullRequestViewer(input, pullRequests.preview(input)),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsActivity]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsActivity,
            withPullRequestViewer(input, pullRequests.activity(input)),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsThreadComments]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsThreadComments,
            withPullRequestViewer(input, pullRequests.threadComments(input)),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsDiffFileContents]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsDiffFileContents,
            withPullRequestViewer(input, pullRequests.diffFileContents(input)),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsFilesViewed]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsFilesViewed,
            withPullRequestViewer(input, pullRequests.filesViewed(input)),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsSetFilesViewed]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsSetFilesViewed,
            withPullRequestViewer(input, pullRequests.setFilesViewed(input)),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsRunAction]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsRunAction,
            withPullRequestViewer(input, pullRequests.runAction(input)).pipe(
              Effect.tap(() =>
                resolvePullRequestSyncKey(input).pipe(
                  Effect.flatMap((key) =>
                    key === null ? Effect.void : pullRequestSync.requestSync(key),
                  ),
                ),
              ),
            ),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsUpdate]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsUpdate,
            withPullRequestViewer(input, pullRequests.update(input)),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsComment]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsComment,
            withPullRequestViewer(input, pullRequests.comment(input)),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsUpdateComment]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsUpdateComment,
            withPullRequestViewer(input, pullRequests.updateComment(input)),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsSubmitReview]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsSubmitReview,
            withPullRequestViewer(input, pullRequests.submitReview(input)),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsReplyToThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsReplyToThread,
            withPullRequestViewer(input, pullRequests.replyToThread(input)),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsSetThreadResolution]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsSetThreadResolution,
            withPullRequestViewer(input, pullRequests.setThreadResolution(input)),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsSetReaction]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsSetReaction,
            withPullRequestViewer(input, pullRequests.setReaction(input)),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.pullRequestsInvalidate]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsInvalidate,
            pullRequests.invalidate(input, { notifyReaders: true }).pipe(
              // A reader asking for fresh host state also wants the thread badges it feeds to
              // catch up, including a merged link the sweep would otherwise never revisit.
              Effect.andThen(
                input.reference === undefined || input.filesViewedOnly === true
                  ? Effect.void
                  : resolvePullRequestSyncKey(input.reference).pipe(
                      Effect.flatMap((key) =>
                        key === null ? Effect.void : pullRequestSync.requestSync(key),
                      ),
                    ),
              ),
            ),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsSubscribeRefreshes]: () =>
          observeRpcStream(
            WS_METHODS.pullRequestsSubscribeRefreshes,
            pullRequests.subscribeRefreshes,
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsReviewerCandidates]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsReviewerCandidates,
            withPullRequestViewer(input, pullRequests.reviewerCandidates(input)),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsRequestReviewers]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsRequestReviewers,
            withPullRequestViewer(input, pullRequests.requestReviewers(input)),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsLabelCandidates]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsLabelCandidates,
            withPullRequestViewer(input, pullRequests.labelCandidates(input)),
            { "rpc.aggregate": "pull-requests" },
          ),
        [WS_METHODS.pullRequestsSetLabels]: (input) =>
          observeRpcEffect(
            WS_METHODS.pullRequestsSetLabels,
            withPullRequestViewer(input, pullRequests.setLabels(input)),
            {
              "rpc.aggregate": "pull-requests",
            },
          ),
        [WS_METHODS.sourceControlLookupRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlLookupRepository,
            sourceControlRepositories.lookupRepository(input),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlCloneRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlCloneRepository,
            sourceControlRepositories.cloneRepository(input),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.projectCloneStart]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectCloneStart,
            projectCloneTracker.start(input, {
              createProject: (project) =>
                Effect.gen(function* () {
                  const normalizedCommand = yield* normalizeDispatchCommand({
                    type: "project.create",
                    commandId: yield* serverCommandId("project-clone-create"),
                    projectId: project.projectId,
                    title: project.title,
                    workspaceRoot: project.workspaceRoot,
                    createWorkspaceRootIfMissing: true,
                    createdAt: project.createdAt,
                  });
                  yield* dispatchNormalizedCommand(normalizedCommand);
                  yield* recordClientCommandAnalytics(normalizedCommand);
                }).pipe(Effect.provideContext(normalizerContext)),
              onCloned: (project) =>
                // The project was created against an empty directory, so its
                // cached identity is "not a repository" until this refresh.
                // Re-emitting the project shell carries the new identity to
                // every client without a round trip.
                repositoryIdentityResolver.resolve(project.workspaceRoot, { refresh: true }).pipe(
                  Effect.andThen(
                    Effect.gen(function* () {
                      const command = yield* normalizeDispatchCommand({
                        type: "project.meta.update",
                        commandId: yield* serverCommandId("project-clone-done"),
                        projectId: project.projectId,
                      });
                      yield* dispatchNormalizedCommand(command);
                    }),
                  ),
                  Effect.andThen(refreshGitStatus(project.workspaceRoot)),
                  Effect.ignoreCause({ log: true }),
                  Effect.provideContext(normalizerContext),
                ),
            }),
            { "rpc.aggregate": "source-control" },
          ),
        [WS_METHODS.projectCloneCancel]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectCloneCancel,
            projectCloneTracker
              .cancel(input.projectId)
              .pipe(Effect.map((applied) => ({ applied }))),
            { "rpc.aggregate": "source-control" },
          ),
        [WS_METHODS.projectCloneRetry]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectCloneRetry,
            projectCloneTracker.retry(input.projectId).pipe(Effect.map((applied) => ({ applied }))),
            { "rpc.aggregate": "source-control" },
          ),
        [WS_METHODS.subscribeProjectClones]: () =>
          observeRpcStream(WS_METHODS.subscribeProjectClones, projectCloneTracker.stream, {
            "rpc.aggregate": "source-control",
          }),
        [WS_METHODS.sourceControlPublishRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlPublishRepository,
            sourceControlRepositories
              .publishRepository(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchEntries,
            workspaceEntries.search(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectSearchEntriesError({
                    cwd: input.cwd,
                    queryLength: input.query.length,
                    limit: input.limit,
                    ...projectEntriesFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsSearchContents]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchContents,
            workspaceEntries.searchContents(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectSearchContentsError({
                    cwd: input.cwd,
                    queryLength: input.query.length,
                    limit: input.limit,
                    ...projectEntriesFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsListEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsListEntries,
            workspaceEntries.list(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectListEntriesError({
                    ...input,
                    ...projectEntriesFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsReadFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsReadFile,
            workspaceFileSystem.readFile(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectReadFileError({
                    ...input,
                    ...projectFileFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsWriteFile,
            workspaceFileSystem.writeFile(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectWriteFileError({
                    cwd: input.cwd,
                    relativePath: input.relativePath,
                    ...projectFileFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          observeRpcEffect(WS_METHODS.shellOpenInEditor, externalLauncher.launchEditor(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.filesystemBrowse]: (input) =>
          observeRpcEffect(
            WS_METHODS.filesystemBrowse,
            workspaceEntries.browse(input).pipe(
              Effect.mapError(
                (cause) =>
                  new FilesystemBrowseError({
                    ...input,
                    ...filesystemBrowseFailureContext(cause),
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.attachmentsCreateUploadUrl]: (input) =>
          observeRpcEffect(WS_METHODS.attachmentsCreateUploadUrl, issueAttachmentUploadUrl(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.attachmentsDelete]: (input) =>
          observeRpcEffect(
            WS_METHODS.attachmentsDelete,
            deletePendingAttachment(input.attachmentId),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.agentSessionsScan]: () =>
          observeRpcEffect(WS_METHODS.agentSessionsScan, agentSessionScanner.scan, {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.agentSessionsImport]: (input) =>
          observeRpcEffect(
            WS_METHODS.agentSessionsImport,
            importRecentAgentThreads(input).pipe(
              Effect.provideService(AgentSessionScanner.AgentSessionScanner, agentSessionScanner),
              Effect.provideService(
                OrchestrationEngine.OrchestrationEngineService,
                orchestrationEngine,
              ),
              Effect.provideService(
                ProjectionSnapshotQuery.ProjectionSnapshotQuery,
                projectionSnapshotQuery,
              ),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(
                ProviderSessionDirectory.ProviderSessionDirectory,
                providerSessionDirectory,
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.assetsCreateUrl]: (input) =>
          observeRpcEffect(
            WS_METHODS.assetsCreateUrl,
            Effect.gen(function* () {
              const path = yield* Path.Path;
              // An absolute media path can be linked from a thread on another environment.
              if (
                input.resource._tag === "attachment" ||
                input.resource._tag === "native-app-icon" ||
                // GitHub media names the repository it authenticates through itself.
                input.resource._tag === "github-media" ||
                (input.resource._tag === "media-file" && path.isAbsolute(input.resource.path))
              ) {
                return yield* issueAssetUrl({ resource: input.resource });
              }
              if (input.resource._tag === "draft-workspace-file") {
                // A project draft names its workspace directly; there is no
                // thread to resolve one from.
                return yield* issueAssetUrl({
                  resource: input.resource,
                  workspaceRoot: input.resource.cwd,
                });
              }
              if (input.resource._tag === "project-favicon") {
                const project = yield* projectionSnapshotQuery
                  .getActiveProjectByWorkspaceRoot(input.resource.cwd)
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new AssetWorkspaceContextResolutionError({
                          resource: input.resource,
                          cause,
                        }),
                    ),
                  );
                if (Option.isNone(project)) {
                  return yield* new AssetWorkspaceContextNotFoundError({
                    resource: input.resource,
                  });
                }
                return yield* issueAssetUrl({
                  resource: input.resource,
                  ...(project.value.faviconPath
                    ? { projectFaviconPath: project.value.faviconPath }
                    : {}),
                });
              }
              const thread = yield* projectionSnapshotQuery
                .getThreadShellById(input.resource.threadId)
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new AssetWorkspaceContextResolutionError({
                        resource: input.resource,
                        cause,
                      }),
                  ),
                );
              if (Option.isNone(thread)) {
                return yield* new AssetWorkspaceContextNotFoundError({
                  resource: input.resource,
                });
              }
              const project = yield* projectionSnapshotQuery
                .getProjectShellById(thread.value.projectId)
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new AssetWorkspaceContextResolutionError({
                        resource: input.resource,
                        cause,
                      }),
                  ),
                );
              if (Option.isNone(project)) {
                return yield* new AssetWorkspaceContextNotFoundError({
                  resource: input.resource,
                });
              }
              return yield* issueAssetUrl({
                resource: input.resource,
                workspaceRoot: thread.value.worktreePath ?? project.value.workspaceRoot,
              });
            }),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.subscribeVcsStatus]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeVcsStatus,
            vcsStatusBroadcaster.streamStatus(input, {
              automaticRemoteRefreshInterval: automaticGitFetchInterval,
            }),
            {
              "rpc.aggregate": "vcs",
            },
          ),
        [WS_METHODS.subscribeWorktreeSetup]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeWorktreeSetup,
            worktreeSetupTracker.stream(input.threadId),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.worktreeSetupCancel]: (input) =>
          observeRpcEffect(
            WS_METHODS.worktreeSetupCancel,
            worktreeSetupTracker
              .cancel(input.threadId)
              .pipe(Effect.map((cancelled) => ({ cancelled }))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsRefreshStatus]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsRefreshStatus,
            vcsStatusBroadcaster.refreshStatus(input.cwd),
            {
              "rpc.aggregate": "vcs",
            },
          ),
        [WS_METHODS.vcsPull]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsPull,
            gitWorkflow.pullCurrentBranch(input.cwd).pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Effect.failCause(cause),
                onSuccess: (result) =>
                  refreshGitStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
              }),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          observeRpcStream(
            WS_METHODS.gitRunStackedAction,
            Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
              gitWorkflow
                .runStackedAction(input, {
                  actionId: input.actionId,
                  progressReporter: {
                    publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                  },
                })
                .pipe(
                  Effect.matchCauseEffect({
                    onFailure: (cause) => Queue.failCause(queue, cause),
                    onSuccess: (result) =>
                      (input.threadId === undefined
                        ? Effect.void
                        : linkCreatedPullRequest({
                            threadId: input.threadId,
                            result,
                            commandId: serverCommandId("pr-created-link"),
                          }).pipe(
                            Effect.provideService(
                              OrchestrationEngine.OrchestrationEngineService,
                              orchestrationEngine,
                            ),
                            Effect.provideService(
                              ProjectionSnapshotQuery.ProjectionSnapshotQuery,
                              projectionSnapshotQuery,
                            ),
                          )
                      ).pipe(
                        Effect.andThen(refreshGitStatus(input.cwd)),
                        Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                      ),
                  }),
                ),
            ),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitResolvePullRequest,
            gitWorkflow.resolvePullRequest(input),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPreparePullRequestThread,
            gitWorkflow
              .preparePullRequestThread(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.vcsListRefs]: (input) =>
          observeRpcEffect(WS_METHODS.vcsListRefs, gitWorkflow.listRefs(input), {
            "rpc.aggregate": "vcs",
          }),
        [WS_METHODS.vcsCreateWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsCreateWorktree,
            gitWorkflow.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsRemoveWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsRemoveWorktree,
            gitWorkflow.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsCreateRef]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsCreateRef,
            gitWorkflow.createRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsSwitchRef]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsSwitchRef,
            gitWorkflow.switchRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsInit]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsInit,
            vcsProvisioning
              .initRepository(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.reviewGetDiffPreview]: (input) =>
          observeRpcEffect(WS_METHODS.reviewGetDiffPreview, review.getDiffPreview(input), {
            "rpc.aggregate": "review",
          }),
        [WS_METHODS.reviewGetDiffFileContents]: (input) =>
          observeRpcEffect(
            WS_METHODS.reviewGetDiffFileContents,
            review.getDiffFileContents(input),
            { "rpc.aggregate": "review" },
          ),
        [WS_METHODS.terminalOpen]: (input) =>
          observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalAttach]: (input) =>
          observeRpcStream(
            WS_METHODS.terminalAttach,
            Stream.callback<TerminalAttachStreamEvent, TerminalError>((queue) =>
              Effect.acquireRelease(
                terminalManager.attachStream(input, (event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.terminalWrite]: (input) =>
          observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalResize]: (input) =>
          observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClear]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalRestart]: (input) =>
          observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClose]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.subscribeTerminalEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalEvents,
            Stream.callback<TerminalEvent>((queue) =>
              Effect.acquireRelease(
                terminalManager.subscribe((event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.subscribeTerminalMetadata]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalMetadata,
            Stream.callback<TerminalMetadataStreamEvent>((queue) =>
              Effect.acquireRelease(
                terminalManager.subscribeMetadata((event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.previewOpen]: (input) =>
          observeRpcEffect(WS_METHODS.previewOpen, previewManager.open(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewNavigate]: (input) =>
          observeRpcEffect(WS_METHODS.previewNavigate, previewManager.navigate(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewResize]: (input) =>
          observeRpcEffect(WS_METHODS.previewResize, previewManager.resize(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewRefresh]: (input) =>
          observeRpcEffect(WS_METHODS.previewRefresh, previewManager.refresh(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewClose]: (input) =>
          observeRpcEffect(WS_METHODS.previewClose, previewManager.close(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewList]: (input) =>
          observeRpcEffect(WS_METHODS.previewList, previewManager.list(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewReportStatus]: (input) =>
          observeRpcEffect(WS_METHODS.previewReportStatus, previewManager.reportStatus(input), {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.previewAutomationConnect]: (input) =>
          observeRpcStreamEffect(
            WS_METHODS.previewAutomationConnect,
            previewAutomationBroker.connect(input),
            { "rpc.aggregate": "preview-automation" },
          ),
        [WS_METHODS.previewAutomationRespond]: (input) =>
          observeRpcEffect(
            WS_METHODS.previewAutomationRespond,
            previewAutomationBroker.respond(input),
            { "rpc.aggregate": "preview-automation" },
          ),
        [WS_METHODS.previewAutomationFocusHost]: (input) =>
          observeRpcEffect(
            WS_METHODS.previewAutomationFocusHost,
            previewAutomationBroker.focusHost(input),
            { "rpc.aggregate": "preview-automation" },
          ),
        [WS_METHODS.subscribePreviewEvents]: (_input) =>
          observeRpcStream(WS_METHODS.subscribePreviewEvents, previewManager.events, {
            "rpc.aggregate": "preview",
          }),
        [WS_METHODS.deviceConfigure]: (input) =>
          observeRpcEffect(WS_METHODS.deviceConfigure, deviceService.configure(input), {
            "rpc.aggregate": "device",
          }),
        [WS_METHODS.deviceTestHost]: (input) =>
          observeRpcEffect(WS_METHODS.deviceTestHost, deviceService.testHost(input), {
            "rpc.aggregate": "device",
          }),
        [WS_METHODS.deviceList]: (_input) =>
          observeRpcEffect(WS_METHODS.deviceList, deviceService.list, {
            "rpc.aggregate": "device",
          }),
        [WS_METHODS.deviceOpen]: (input) =>
          observeRpcEffect(WS_METHODS.deviceOpen, deviceService.open(input), {
            "rpc.aggregate": "device",
          }),
        [WS_METHODS.deviceClose]: (input) =>
          observeRpcEffect(WS_METHODS.deviceClose, deviceService.close(input), {
            "rpc.aggregate": "device",
          }),
        [WS_METHODS.deviceShutdown]: (input) =>
          observeRpcEffect(WS_METHODS.deviceShutdown, deviceService.shutdown(input), {
            "rpc.aggregate": "device",
          }),
        [WS_METHODS.deviceDetail]: (input) =>
          observeRpcEffect(WS_METHODS.deviceDetail, deviceService.detail(input), {
            "rpc.aggregate": "device",
          }),
        [WS_METHODS.deviceAction]: (input) =>
          observeRpcEffect(WS_METHODS.deviceAction, deviceService.action(input), {
            "rpc.aggregate": "device",
          }),
        [WS_METHODS.subscribeDeviceState]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeDeviceState,
            DeviceService.stateStream(deviceService),
            { "rpc.aggregate": "device" },
          ),
        [WS_METHODS.subscribeDiscoveredLocalServers]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeDiscoveredLocalServers,
            Stream.callback<DiscoveredLocalServerList>((queue) =>
              Effect.gen(function* () {
                const configuredUrls = input.configuredUrls ?? [];
                yield* portDiscovery.retain;
                const initial = yield* portDiscovery.scan(configuredUrls);
                const initialScannedAt = DateTime.formatIso(yield* DateTime.now);
                yield* Queue.offer(queue, {
                  servers: initial,
                  scannedAt: initialScannedAt,
                  configuredUrlProbing: true,
                });
                yield* portDiscovery.subscribe(
                  { configuredUrls, initialSnapshot: initial },
                  (servers) =>
                    Effect.gen(function* () {
                      const scannedAt = DateTime.formatIso(yield* DateTime.now);
                      yield* Queue.offer(queue, {
                        servers,
                        scannedAt,
                        configuredUrlProbing: true,
                      });
                    }),
                );
              }),
            ),
            { "rpc.aggregate": "preview" },
          ),
        [WS_METHODS.subscribeServerConfig]: (input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerConfig,
            Effect.gen(function* () {
              const usageLimitsCommand = input.usageLimitsCommand === true;
              const config = yield* loadServerConfig({ usageLimitsCommand });
              const keybindingsUpdates = keybindings.streamChanges.pipe(
                Stream.map((event) => ({
                  version: 1 as const,
                  type: "keybindingsUpdated" as const,
                  payload: {
                    keybindings: event.keybindings,
                    issues: event.issues,
                  },
                })),
              );
              const providerStatuses = Stream.zipLatestWith(
                // The registry stream carries changes only. Seed it with the current
                // providers so a source refresh that lands before any provider change
                // still pairs up and reaches the client.
                Stream.concat(
                  Stream.fromEffect(providerRegistry.getProviders),
                  providerRegistry.streamChanges,
                ),
                usageLimitSources.streamChanges.pipe(
                  // Quota updates already have their own stream. Republish the model
                  // catalog only when the set of providers offered the command changes.
                  Stream.changesWith(
                    usageLimitsCommand ? sameUsageLimitCommandCoverage : () => true,
                  ),
                ),
                (providers, sources) =>
                  usageLimitsCommand ? withUsageLimitsCommands(providers, sources) : providers,
              ).pipe(
                // Both sides replay their current value, so the first pairing normally
                // repeats the snapshot the client already holds. Compare against that
                // snapshot rather than dropping blindly: a refresh that landed between
                // the snapshot and the subscription still goes out.
                (updates) => Stream.concat(Stream.make(config.providers), updates),
                Stream.changesWith(
                  (previous, next) => JSON.stringify(previous) === JSON.stringify(next),
                ),
                Stream.drop(1),
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: { providers },
                })),
                Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
              );
              // The only source of published themes: the stream emits the
              // current set before any change, so the snapshot carrying it too
              // would just send every client the same array twice per connect.
              // Gated on the subscriber's capability flag because an
              // already-shipped client decodes this stream against the old
              // event union and its whole config subscription dies on an
              // unknown member.
              const environmentThemeUpdates =
                input.environmentThemes === true
                  ? environmentTheme.streamChanges.pipe(
                      Stream.map((themes) => ({
                        version: 1 as const,
                        type: "environmentThemesUpdated" as const,
                        payload: { themes },
                      })),
                    )
                  : Stream.empty;
              // Same gate as themes: an older client dies on an unknown event.
              const usageLimitSourceUpdates =
                input.usageLimitSources === true
                  ? usageLimitSources.streamChanges.pipe(
                      Stream.map((sources) => ({
                        version: 1 as const,
                        type: "usageLimitSourcesUpdated" as const,
                        payload: { sources },
                      })),
                    )
                  : Stream.empty;
              const settingsUpdates = serverSettings.streamChanges.pipe(
                Stream.map((settings) => ServerSettings.redactServerSettingsForClient(settings)),
                Stream.map((settings) => ({
                  version: 1 as const,
                  type: "settingsUpdated" as const,
                  payload: { settings },
                })),
              );

              const liveUpdates = Stream.merge(
                keybindingsUpdates,
                Stream.merge(
                  providerStatuses,
                  Stream.merge(
                    settingsUpdates,
                    Stream.merge(environmentThemeUpdates, usageLimitSourceUpdates),
                  ),
                ),
              );

              return Stream.concat(
                Stream.make({ version: 1 as const, type: "snapshot" as const, config }),
                liveUpdates,
              );
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerLifecycle,
            Effect.gen(function* () {
              const liveBuffer = yield* Queue.unbounded<ServerLifecycleStreamEvent>();
              yield* Effect.forkScoped(
                lifecycleEvents.stream.pipe(
                  Stream.runForEach((event) => Queue.offer(liveBuffer, event)),
                ),
                { startImmediately: true },
              );
              const snapshot = yield* lifecycleEvents.snapshot;
              const snapshotEvents = Array.from(snapshot.events).toSorted(
                (left, right) => left.sequence - right.sequence,
              );
              const liveEvents = Stream.fromQueue(liveBuffer).pipe(
                Stream.filter((event) => event.sequence > snapshot.sequence),
              );
              return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeAuthAccess]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeAuthAccess,
            Effect.gen(function* () {
              const initialSnapshot = yield* loadAuthAccessSnapshot();
              const revisionRef = yield* Ref.make(1);
              const accessChanges: Stream.Stream<
                PairingGrantStore.BootstrapCredentialChange | SessionStore.SessionCredentialChange
              > = Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

              const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
                Stream.mapEffect((change) =>
                  Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                    Effect.map((revision) =>
                      toAuthAccessStreamEvent(change, revision, currentSessionId),
                    ),
                  ),
                ),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  revision: 1,
                  type: "snapshot" as const,
                  payload: initialSnapshot,
                }),
                liveEvents,
              );
            }),
            { "rpc.aggregate": "auth" },
          ),
        [WS_METHODS.subscribeBackgroundPolicy]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeBackgroundPolicy,
            Stream.unwrap(
              Effect.map(backgroundPolicy.subscribe, ({ latest, changes }) =>
                Stream.concat(Stream.make(latest), changes),
              ),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeResourceTelemetry]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeResourceTelemetry,
            Stream.unwrap(
              Effect.map(resourceTelemetry.subscribe, ({ latest, changes }) =>
                Stream.concat(Stream.make(latest), changes),
              ),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.harnessGraphRead]: (input) =>
          observeHarnessRpcEffect(WS_METHODS.harnessGraphRead, readHarnessSnapshot(input), {
            "rpc.aggregate": "harness",
          }),
        [WS_METHODS.harnessGraphSubscribe]: (input) =>
          observeHarnessRpcStreamEffect(
            WS_METHODS.harnessGraphSubscribe,
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(harnessGraphChanges);
              const domainEvents = yield* orchestrationEngine.subscribeDomainEvents;
              const initial = yield* readHarnessSnapshot(input);
              const nativeChanges = domainEvents.pipe(
                Stream.filter((event) => {
                  if (event.type !== "thread.activity-appended") return false;
                  const activity = event.payload.activity;
                  if (
                    activity.kind === "task.started" ||
                    activity.kind === "task.progress" ||
                    activity.kind === "task.updated" ||
                    activity.kind === "task.completed"
                  ) {
                    return true;
                  }
                  return (
                    typeof activity.payload === "object" &&
                    activity.payload !== null &&
                    (activity.payload as { readonly itemType?: unknown }).itemType ===
                      "collab_agent_tool_call"
                  );
                }),
                Stream.debounce(Duration.millis(100)),
                Stream.map(() => undefined),
              );
              const changes = Stream.merge(
                Stream.fromSubscription(subscription),
                nativeChanges,
              ).pipe(
                Stream.mapEffect(() =>
                  readHarnessSnapshot(input).pipe(
                    Effect.map((snapshot) => ({ kind: "changed" as const, snapshot })),
                  ),
                ),
              );
              return Stream.concat(
                Stream.make({ kind: "snapshot" as const, snapshot: initial }),
                changes,
              );
            }),
            { "rpc.aggregate": "harness" },
          ),
        [WS_METHODS.harnessGraphGetChannel]: (input) =>
          observeHarnessRpcEffect(
            WS_METHODS.harnessGraphGetChannel,
            Effect.gen(function* () {
              const channel = yield* requireHarnessChannel(input.channelId);
              return yield* readHarnessChannel(channel);
            }),
            { "rpc.aggregate": "harness" },
          ),
        [WS_METHODS.harnessGraphRegisterAgent]: (input) =>
          observeHarnessRpcEffect(
            WS_METHODS.harnessGraphRegisterAgent,
            Effect.gen(function* () {
              if (input.parentAgentId !== undefined)
                yield* requireHarnessAgent(input.parentAgentId);
              const createdAt = yield* nowIso;
              const canvas = input.canvas ?? { x: 0, y: 0, collapsed: false };
              yield* harnessPersistence(
                "register-agent",
                sql`
                  INSERT INTO harness_agents (
                    agent_id, thread_id, project_id, display_name, role, status,
                    parent_agent_id, canvas_x, canvas_y, canvas_collapsed, created_at, updated_at
                  ) VALUES (
                    ${input.agentId}, ${input.threadId}, ${input.projectId}, ${input.displayName},
                    ${input.role}, ${input.status ?? "active"}, ${input.parentAgentId ?? null},
                    ${canvas.x}, ${canvas.y}, ${canvas.collapsed ? 1 : 0}, ${createdAt}, ${createdAt}
                  )
                  ON CONFLICT (agent_id) DO UPDATE SET
                    thread_id = excluded.thread_id,
                    project_id = excluded.project_id,
                    display_name = excluded.display_name,
                    role = excluded.role,
                    status = excluded.status,
                    parent_agent_id = excluded.parent_agent_id,
                    updated_at = excluded.updated_at
                `,
              );
              yield* bumpHarnessRevision;
              yield* publishHarnessGraphChange;
              return makeHarnessAgent(yield* requireHarnessAgent(input.agentId));
            }),
            { "rpc.aggregate": "harness" },
          ),
        [WS_METHODS.harnessGraphUpdateCanvas]: (input) =>
          observeHarnessRpcEffect(
            WS_METHODS.harnessGraphUpdateCanvas,
            Effect.gen(function* () {
              yield* requireHarnessAgent(input.agentId);
              const updatedAt = yield* nowIso;
              yield* harnessPersistence(
                "update-canvas",
                sql`
                  UPDATE harness_agents
                  SET canvas_x = ${input.x}, canvas_y = ${input.y},
                      canvas_collapsed = ${input.collapsed ? 1 : 0}, updated_at = ${updatedAt}
                  WHERE agent_id = ${input.agentId}
                `,
              );
              yield* bumpHarnessRevision;
              yield* publishHarnessGraphChange;
              return yield* readHarnessSnapshot();
            }),
            { "rpc.aggregate": "harness" },
          ),
        [WS_METHODS.harnessGraphUpsertRelationship]: (input) =>
          observeHarnessRpcEffect(
            WS_METHODS.harnessGraphUpsertRelationship,
            Effect.gen(function* () {
              if (input.sourceAgentId === input.targetAgentId) {
                return yield* harnessValidation(
                  "upsert-relationship",
                  "An agent cannot connect to itself.",
                );
              }
              yield* requireHarnessAgent(input.sourceAgentId);
              yield* requireHarnessAgent(input.targetAgentId);
              const relationshipId =
                input.relationshipId ?? HarnessRelationshipId.make(yield* crypto.randomUUIDv4);
              const createdAt = yield* nowIso;
              yield* harnessPersistence(
                "upsert-relationship",
                sql`
                  INSERT INTO harness_relationships (
                    relationship_id, source_agent_id, target_agent_id, kind, topic,
                    forked_from_turn_id, created_at
                  ) VALUES (
                    ${relationshipId}, ${input.sourceAgentId}, ${input.targetAgentId}, ${input.kind},
                    ${input.topic ?? null}, ${input.forkedFromTurnId ?? null}, ${createdAt}
                  )
                  ON CONFLICT (source_agent_id, target_agent_id, kind) DO UPDATE SET
                    topic = excluded.topic,
                    forked_from_turn_id = excluded.forked_from_turn_id
                `,
              );
              yield* bumpHarnessRevision;
              yield* publishHarnessGraphChange;
              return yield* readHarnessSnapshot();
            }),
            { "rpc.aggregate": "harness" },
          ),
        [WS_METHODS.harnessGraphOpenChannel]: (input) =>
          observeHarnessRpcEffect(
            WS_METHODS.harnessGraphOpenChannel,
            Effect.gen(function* () {
              if (input.agentAId === input.agentBId) {
                return yield* harnessValidation(
                  "open-channel",
                  "A coordination channel needs two agents.",
                );
              }
              yield* requireHarnessAgent(input.agentAId);
              yield* requireHarnessAgent(input.agentBId);
              const [agentAId, agentBId] =
                input.agentAId < input.agentBId
                  ? [input.agentAId, input.agentBId]
                  : [input.agentBId, input.agentAId];
              const existing = yield* harnessPersistence(
                "load-channel-by-topic",
                sql<{ readonly channel_id: string }>`
                  SELECT channel_id FROM harness_channels
                  WHERE agent_a_id = ${agentAId} AND agent_b_id = ${agentBId} AND topic = ${input.topic}
                `,
              );
              if (existing[0] === undefined) {
                const channelId =
                  input.channelId ?? HarnessChannelId.make(yield* crypto.randomUUIDv4);
                const createdAt = yield* nowIso;
                yield* harnessPersistence(
                  "open-channel",
                  sql`
                    INSERT INTO harness_channels (
                      channel_id, agent_a_id, agent_b_id, topic, status, decisions_json,
                      created_at, updated_at
                    ) VALUES (
                      ${channelId}, ${agentAId}, ${agentBId}, ${input.topic}, 'syncing', '[]',
                      ${createdAt}, ${createdAt}
                    )
                  `,
                );
                yield* bumpHarnessRevision;
                yield* publishHarnessGraphChange;
              }
              return yield* readHarnessSnapshot();
            }),
            { "rpc.aggregate": "harness" },
          ),
        [WS_METHODS.harnessGraphSendCoordination]: (input) =>
          observeHarnessRpcEffect(
            WS_METHODS.harnessGraphSendCoordination,
            Effect.gen(function* () {
              const channel = yield* requireHarnessChannel(input.channelId);
              const senderIsA = input.senderAgentId === channel.agent_a_id;
              const senderIsB = input.senderAgentId === channel.agent_b_id;
              if (!senderIsA && !senderIsB) {
                return yield* harnessValidation(
                  "send-coordination",
                  "The sender is not a channel participant.",
                );
              }
              const duplicate = yield* harnessPersistence(
                "load-coordination-deduplication",
                sql<{ readonly message_id: string }>`
                  SELECT message_id FROM harness_coordination_messages
                  WHERE channel_id = ${input.channelId}
                    AND sender_agent_id = ${input.senderAgentId}
                    AND deduplication_key = ${input.deduplicationKey}
                `,
              );
              if (duplicate[0] !== undefined) return yield* readHarnessSnapshot();
              if (channel.convergence_round >= HARNESS_GRAPH_MAX_CONVERGENCE_ROUNDS) {
                return yield* new HarnessGraphConvergenceLimitError({
                  channelId: input.channelId,
                  maxRounds: HARNESS_GRAPH_MAX_CONVERGENCE_ROUNDS,
                });
              }
              const round = (input.round ?? channel.convergence_round + 1) as 1 | 2 | 3;
              if (round < 1 || round > HARNESS_GRAPH_MAX_CONVERGENCE_ROUNDS) {
                return yield* harnessValidation(
                  "send-coordination",
                  "Coordination rounds must be between 1 and 3.",
                );
              }
              const revision =
                (senderIsA ? Number(channel.revision_a) : Number(channel.revision_b)) + 1;
              const recipientAgentId = senderIsA ? channel.agent_b_id : channel.agent_a_id;
              const messageId = HarnessCoordinationMessageId.make(yield* crypto.randomUUIDv4);
              const outboxId = HarnessDeliveryId.make(yield* crypto.randomUUIDv4);
              const inboxId = HarnessDeliveryId.make(yield* crypto.randomUUIDv4);
              const createdAt = yield* nowIso;
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              const decisions = JSON.stringify(input.decisions ?? []);
              yield* harnessPersistence(
                "send-coordination",
                sql.withTransaction(
                  Effect.gen(function* () {
                    yield* sql`
                      INSERT INTO harness_coordination_messages (
                        message_id, channel_id, sender_agent_id, recipient_agent_id,
                        author_kind, message_kind, topic, body, summary, decisions_json,
                        revision, round, deduplication_key, created_at
                      ) VALUES (
                        ${messageId}, ${input.channelId}, ${input.senderAgentId}, ${recipientAgentId},
                        ${input.authorKind}, ${input.kind}, ${input.topic ?? channel.topic}, ${input.body},
                        ${input.summary ?? null}, ${decisions}, ${revision}, ${round},
                        ${input.deduplicationKey}, ${createdAt}
                      )
                    `;
                    yield* sql`
                      INSERT INTO harness_deliveries (
                        delivery_id, message_id, channel_id, sender_agent_id, recipient_agent_id,
                        side, state, attempt_count, created_at, updated_at
                      ) VALUES
                        (${outboxId}, ${messageId}, ${input.channelId}, ${input.senderAgentId}, ${recipientAgentId}, 'outbox', 'pending', 0, ${createdAt}, ${createdAt}),
                        (${inboxId}, ${messageId}, ${input.channelId}, ${input.senderAgentId}, ${recipientAgentId}, 'inbox', 'pending', 0, ${createdAt}, ${createdAt})
                    `;
                    yield* sql`
                      UPDATE harness_channels SET
                        ${senderIsA ? sql`revision_a = ${revision}` : sql`revision_b = ${revision}`},
                        convergence_round = MAX(convergence_round, ${round}),
                        status = 'syncing', updated_at = ${createdAt}
                      WHERE channel_id = ${input.channelId}
                    `;
                  }),
                ),
              );
              yield* bumpHarnessRevision;
              yield* publishHarnessGraphChange;
              return yield* readHarnessSnapshot();
            }),
            { "rpc.aggregate": "harness" },
          ),
        [WS_METHODS.harnessGraphAcknowledgeCoordination]: (input) =>
          observeHarnessRpcEffect(
            WS_METHODS.harnessGraphAcknowledgeCoordination,
            Effect.gen(function* () {
              const channel = yield* requireHarnessChannel(input.channelId);
              const senderIsA = input.agentId === channel.agent_a_id;
              const senderIsB = input.agentId === channel.agent_b_id;
              if (!senderIsA && !senderIsB) {
                return yield* harnessValidation(
                  "acknowledge-coordination",
                  "The acknowledger is not a channel participant.",
                );
              }
              const message = yield* harnessPersistence(
                "load-coordination-message",
                sql<{
                  readonly message_id: string;
                  readonly sender_agent_id: string;
                  readonly recipient_agent_id: string;
                  readonly revision: number;
                }>`
                  SELECT message_id, sender_agent_id, recipient_agent_id, revision
                  FROM harness_coordination_messages
                  WHERE message_id = ${input.messageId} AND channel_id = ${input.channelId}
                `,
              );
              if (message[0] === undefined) {
                return yield* harnessValidation(
                  "acknowledge-coordination",
                  "The coordination message does not exist.",
                );
              }
              if (message[0].recipient_agent_id !== input.agentId) {
                return yield* harnessValidation(
                  "acknowledge-coordination",
                  "Only the message recipient can acknowledge coordination.",
                );
              }
              const messageStreamRevision =
                message[0].sender_agent_id === channel.agent_a_id
                  ? Number(channel.revision_a)
                  : message[0].sender_agent_id === channel.agent_b_id
                    ? Number(channel.revision_b)
                    : null;
              if (
                messageStreamRevision === null ||
                input.revision < Number(message[0].revision) ||
                input.revision > messageStreamRevision
              ) {
                return yield* harnessValidation(
                  "acknowledge-coordination",
                  "The acknowledged revision is outside the message stream.",
                );
              }
              const updatedAt = yield* nowIso;
              const nextAckA = senderIsA
                ? Math.max(Number(channel.acknowledged_revision_a), input.revision)
                : Number(channel.acknowledged_revision_a);
              const nextAckB = senderIsB
                ? Math.max(Number(channel.acknowledged_revision_b), input.revision)
                : Number(channel.acknowledged_revision_b);
              const aligned =
                nextAckA >= Number(channel.revision_b) && nextAckB >= Number(channel.revision_a);
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              const decisions = JSON.stringify(
                input.decisions ?? parseDecisions(channel.decisions_json),
              );
              yield* harnessPersistence(
                "acknowledge-coordination",
                sql.withTransaction(
                  Effect.gen(function* () {
                    yield* sql`
                      UPDATE harness_channels SET
                        acknowledged_revision_a = ${nextAckA},
                        acknowledged_revision_b = ${nextAckB},
                        convergence_round = MAX(convergence_round, ${input.round}),
                        status = ${input.status ?? (aligned ? "aligned" : "syncing")},
                        summary = ${input.summary ?? channel.summary},
                        decisions_json = ${decisions},
                        updated_at = ${updatedAt}
                      WHERE channel_id = ${input.channelId}
                    `;
                    yield* sql`
                      UPDATE harness_deliveries
                      SET state = 'acknowledged', updated_at = ${updatedAt}
                      WHERE message_id = ${input.messageId}
                        AND side = 'inbox'
                        AND recipient_agent_id = ${input.agentId}
                    `;
                  }),
                ),
              );
              yield* bumpHarnessRevision;
              yield* publishHarnessGraphChange;
              return yield* readHarnessSnapshot();
            }),
            { "rpc.aggregate": "harness" },
          ),
        [WS_METHODS.harnessGraphSetChannelStatus]: (input) =>
          observeHarnessRpcEffect(
            WS_METHODS.harnessGraphSetChannelStatus,
            Effect.gen(function* () {
              const channel = yield* requireHarnessChannel(input.channelId);
              const updatedAt = yield* nowIso;
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              const decisions = JSON.stringify(
                input.decisions ?? parseDecisions(channel.decisions_json),
              );
              yield* harnessPersistence(
                "set-channel-status",
                sql`
                  UPDATE harness_channels
                  SET status = ${input.status}, summary = ${input.summary ?? channel.summary},
                      decisions_json = ${decisions},
                      updated_at = ${updatedAt}
                  WHERE channel_id = ${input.channelId}
                `,
              );
              yield* bumpHarnessRevision;
              yield* publishHarnessGraphChange;
              return yield* readHarnessSnapshot();
            }),
            { "rpc.aggregate": "harness" },
          ),
        [WS_METHODS.harnessGraphUpdateDelivery]: (input) =>
          observeHarnessRpcEffect(
            WS_METHODS.harnessGraphUpdateDelivery,
            Effect.gen(function* () {
              const rows = yield* harnessPersistence(
                "load-delivery",
                sql<{ readonly delivery_id: string }>`
                  SELECT delivery_id FROM harness_deliveries
                  WHERE delivery_id = ${input.deliveryId} AND side = ${input.side}
                `,
              );
              if (rows[0] === undefined)
                return yield* harnessValidation("update-delivery", "The delivery does not exist.");
              const updatedAt = yield* nowIso;
              yield* harnessPersistence(
                "update-delivery",
                sql`
                  UPDATE harness_deliveries
                  SET state = ${input.state}, last_error = ${input.error ?? null},
                      attempt_count = attempt_count + 1, updated_at = ${updatedAt}
                  WHERE delivery_id = ${input.deliveryId} AND side = ${input.side}
                `,
              );
              yield* bumpHarnessRevision;
              yield* publishHarnessGraphChange;
              return yield* readHarnessSnapshot();
            }),
            { "rpc.aggregate": "harness" },
          ),
        [WS_METHODS.harnessGraphListDeliveries]: (input) =>
          observeHarnessRpcEffect(
            WS_METHODS.harnessGraphListDeliveries,
            Effect.gen(function* () {
              const deliveries =
                input.agentId === undefined
                  ? input.state === undefined
                    ? yield* sql<HarnessDeliveryRow>`
                        SELECT delivery_id, message_id, channel_id, sender_agent_id,
                               recipient_agent_id, side, state, attempt_count, last_error,
                               created_at, updated_at
                        FROM harness_deliveries
                        ORDER BY updated_at, delivery_id
                      `
                    : yield* sql<HarnessDeliveryRow>`
                        SELECT delivery_id, message_id, channel_id, sender_agent_id,
                               recipient_agent_id, side, state, attempt_count, last_error,
                               created_at, updated_at
                        FROM harness_deliveries
                        WHERE state = ${input.state}
                        ORDER BY updated_at, delivery_id
                      `
                  : input.state === undefined
                    ? yield* sql<HarnessDeliveryRow>`
                        SELECT delivery_id, message_id, channel_id, sender_agent_id,
                               recipient_agent_id, side, state, attempt_count, last_error,
                               created_at, updated_at
                        FROM harness_deliveries
                        WHERE sender_agent_id = ${input.agentId}
                           OR recipient_agent_id = ${input.agentId}
                        ORDER BY updated_at, delivery_id
                      `
                    : yield* sql<HarnessDeliveryRow>`
                        SELECT delivery_id, message_id, channel_id, sender_agent_id,
                               recipient_agent_id, side, state, attempt_count, last_error,
                               created_at, updated_at
                        FROM harness_deliveries
                        WHERE state = ${input.state}
                          AND (sender_agent_id = ${input.agentId}
                            OR recipient_agent_id = ${input.agentId})
                        ORDER BY updated_at, delivery_id
                      `;
              return deliveries.map(makeHarnessDelivery);
            }),
            { "rpc.aggregate": "harness" },
          ),
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const previewAutomationBroker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    const baseServerSelfUpdate = yield* ServerSelfUpdate.ServerSelfUpdate;
    const config = yield* ServerConfig.ServerConfig;
    const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
    const serverSelfUpdate = yield* ServerSelfUpdate.withRunningThreadContinuation({
      mode: config.mode,
      selfUpdate: baseServerSelfUpdate,
      prepare: startup.markRunningProviderSessionsForContinuation.pipe(
        Effect.mapError(
          (cause) =>
            new ServerSelfUpdateError({
              reason: "Could not prepare running threads to continue after the update.",
              cause,
            }),
        ),
      ),
      clear: (threadIds) =>
        startup.clearProviderSessionContinuationMarkers(threadIds).pipe(
          Effect.mapError(
            (cause) =>
              new ServerSelfUpdateError({
                reason: "Could not clear thread continuation markers after the update failed.",
                cause,
              }),
          ),
        ),
    });
    const pullRequests = yield* PullRequestService.PullRequestService;
    const sql = yield* SqlClient.SqlClient;
    const harnessGraphChanges = yield* PubSub.unbounded<void>();
    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;
        const analytics = yield* AnalyticsService.AnalyticsService;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request).pipe(
          Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
            failEnvironmentAuthInvalid(
              EnvironmentAuth.serverAuthCredentialReason(error),
              EnvironmentAuth.serverAuthDpopFailureReason(error),
            ),
          ),
          Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
            failEnvironmentInternal("internal_error", error),
          ),
        );
        const clientOrigin = readClientConnectionOrigin(request);
        const clientAnalyticsProps = readClientAnalyticsProps(request);
        yield* sessions.recordClientConnection(session.sessionId, clientOrigin);
        yield* analytics.record("client.connected", clientAnalyticsProps);
        const rpcWebSocketHttpEffect = yield* Effect.gen(function* () {
          const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
          yield* RpcServer.make(WsRpcGroup, { disableTracing: true }).pipe(
            Effect.provideService(RpcServer.Protocol, withTerminalOutputWindow(protocol)),
            Effect.forkScoped,
          );
          // @effect-diagnostics-next-line returnEffectInGen:off
          return httpEffect;
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(
              session,
              clientOrigin,
              clientAnalyticsProps,
              previewAutomationBroker,
              harnessGraphChanges,
            ).pipe(
              Layer.provideMerge(RpcSerialization.layerJson),
              Layer.provide(Layer.succeed(SqlClient.SqlClient, sql)),
              Layer.provide(AgentSessionScanner.layer),
              Layer.provide(ProviderMaintenanceRunner.layer),
              Layer.provide(Layer.succeed(ServerSelfUpdate.ServerSelfUpdate, serverSelfUpdate)),
              // One server-lifetime service means clients share the same PR caches, and a WS
              // mutation invalidates the HTTP diff cache that every client reads from.
              Layer.provide(Layer.succeed(PullRequestService.PullRequestService, pullRequests)),
              Layer.provide(
                SourceControlDiscovery.layer.pipe(
                  Layer.provide(
                    SourceControlProviderRegistry.layer.pipe(
                      Layer.provide(
                        Layer.mergeAll(
                          AzureDevOpsCli.layer,
                          BitbucketApi.layer,
                          GitHubCli.layer,
                          GitLabCli.layer,
                          ForgejoCli.layer,
                        ),
                      ),
                      Layer.provideMerge(GitVcsDriver.layer),
                      Layer.provide(
                        VcsDriverRegistry.layer.pipe(Layer.provide(VcsProjectConfig.layer)),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(
        Effect.catchTags({
          EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
          EnvironmentInternalError: HttpServerRespondable.toResponse,
        }),
      ),
    );
  }),
);
