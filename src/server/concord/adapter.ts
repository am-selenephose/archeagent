import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, unlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, Result } from "@modelcontextprotocol/sdk/types.js";
import { registerWorkflowTools } from "@concord-ai/concord-mcp/dist/tools/workflow.js";
import { registerWorkStateResource } from "@concord-ai/concord-mcp/dist/tools/get-work-state.js";
import { registerPullEndpoint, drainInbox } from "@concord-ai/concord-mcp/dist/cli/commands/inbox.js";
import { renderEventsJsonl, renderHandoffMarkdown, renderReviewPacketMarkdown, renderWorkStateJson } from "@concord-ai/concord-mcp/dist/artifacts/index.js";
import { buildRoster } from "@concord-ai/concord-mcp/dist/domain/presence.js";
import type { AgentMessageDispatcher } from "@concord-ai/concord-mcp/dist/tools/agent-messages.js";
import type { HandoffRecord, Repositories, ReviewRecord, TaskRecord } from "@concord-ai/concord-mcp/dist/db/index.js";
import { validateLocalPaths, assertSafeFile, LocalStateError, writePrivateFile, type LocalPaths } from "./local-paths";
import { invocationSchema, readSourceRevision, type openPrivateStore, type Invocation, type SourceRevision } from "./private-store";
import type { LocalIdentity } from "./local-runtime";

type AdapterOptions = { repos: Repositories; store: ReturnType<typeof openPrivateStore>; paths: LocalPaths; identity: LocalIdentity; actorId: string };
const tools = new Set(["start_work", "inspect_work", "update_work", "transfer_work", "finish_work", "register_pull_endpoint", "drain_own_inbox"]);
const writes = new Set(["start_work", "update_work", "transfer_work", "finish_work", "register_pull_endpoint", "drain_own_inbox"]);
const selectorKeys = new Set(["workspace_id", "root", "root_dir", "repo_root", "repo", "repository", "database", "database_path", "concord_path", "state_dir", "filename", "endpoint", "address"]);
const queues = new Map<string, Promise<unknown>>();

/** Serialize both mutations and artifacts across adapter processes, with bounded waiting. */
async function writerLease(paths: LocalPaths): Promise<() => void> {
  const filename = join(paths.stateDir, "adapter-write.lock");
  const deadline = Date.now() + 5000;
  for (;;) {
    validateLocalPaths(paths); assertSafeFile(filename);
    try {
      const fd = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const owned = fstatSync(fd);
      return () => {
        try { const current = lstatSync(filename); if (current.isFile() && current.nlink === 1 && current.ino === owned.ino && current.dev === owned.dev) unlinkSync(filename); } finally { closeSync(fd); }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw new LocalStateError();
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}
async function serialized<T>(paths: LocalPaths, operation: () => Promise<T>): Promise<T> {
  const preceding = queues.get(paths.stateDir) ?? Promise.resolve();
  const pending = preceding.catch(() => undefined).then(operation);
  queues.set(paths.stateDir, pending);
  try { return await pending; } finally { if (queues.get(paths.stateDir) === pending) queues.delete(paths.stateDir); }
}
function validateArguments(value: unknown, depth = 0): void {
  if (depth > 8) throw new LocalStateError();
  if (typeof value === "string" && value.length > 16_384) throw new LocalStateError();
  if (Array.isArray(value)) { if (value.length > 256) throw new LocalStateError(); for (const item of value) validateArguments(item, depth + 1); }
  else if (value && typeof value === "object") { const entries = Object.entries(value); if (entries.length > 64) throw new LocalStateError(); for (const [key, item] of entries) { if (selectorKeys.has(key)) throw new LocalStateError(); validateArguments(item, depth + 1); } }
}
function pullOnly(repos: Repositories): void {
  if (repos.agentEndpoints.list().some(endpoint => endpoint.transport !== "pull" || endpoint.capabilities.some(capability => ["local-ipc", "app-server", "inject", "steer"].includes(capability)))) throw new LocalStateError();
}

/** Preserve upstream rendering/latest-store-record selection, but acquire each
 * output descriptor through the guarded private writer instead of its unsafe
 * path-following writeArtifacts filesystem wrapper. */
function regenerateArtifacts(paths: LocalPaths, repos: Repositories): void {
  const generatedAt = new Date().toISOString();
  const artifacts = repos.db.transaction(() => {
    const tasks = repos.tasks.list();
    const roster = buildRoster(repos.agents.list(), Date.parse(generatedAt));
    const outputs = [
      { filename: "WORK_STATE.json", content: renderWorkStateJson(tasks, roster, generatedAt) },
      { filename: "events.jsonl", content: renderEventsJsonl(repos.events.list()) },
    ];
    let latestHandoff: { task: TaskRecord; handoff: HandoffRecord } | undefined;
    let latestReview: { task: TaskRecord; review: ReviewRecord } | undefined;
    for (const task of tasks) {
      const handoff = repos.handoffs.latestForTask(task.taskId);
      if (handoff && (!latestHandoff || handoff.createdAt >= latestHandoff.handoff.createdAt)) latestHandoff = { task, handoff };
      const review = repos.reviews.latestForTask(task.taskId);
      if (review && (!latestReview || review.createdAt >= latestReview.review.createdAt)) latestReview = { task, review };
    }
    if (latestHandoff) outputs.push({ filename: "HANDOFF.md", content: renderHandoffMarkdown(latestHandoff.task, latestHandoff.handoff) });
    if (latestReview) outputs.push({ filename: "REVIEW_PACKET.md", content: renderReviewPacketMarkdown(latestReview.task, latestReview.review, repos.handoffs.latestForTask(latestReview.task.taskId)) });
    return outputs;
  })();
  for (const artifact of artifacts) writePrivateFile(paths, join(paths.stateDir, artifact.filename), artifact.content);
}

export function createBoundAdapter({ repos, store, paths, identity, actorId }: AdapterOptions) {
  const serverInstanceId = randomUUID();
  const server = new McpServer({ name: "archeagent-fixed-local-concord", version: "1.0.0" }, { instructions: "Fixed staging Concord tools. Actor identity is operator-assigned and is not proof of a model session. Messages use pull-only delivery: refresh register_pull_endpoint before expecting a message and invoke drain_own_inbox in the recipient session. No release authority is granted." });
  let wrote = false;
  const fixedSelector = (workspaceId?: string) => {
    if (workspaceId !== undefined) throw new LocalStateError();
    validateLocalPaths(paths);
    return { workspaceId: identity.sourceInstanceId, repoRoot: paths.rootDir, concordPath: paths.stateDir, repos };
  };
  const dispatcher: AgentMessageDispatcher = { async deliver() { throw new LocalStateError(); } };

  async function dispatch(name: string, args: Record<string, unknown>, handler: () => Promise<Result>): Promise<Result> {
    return serialized(paths, async () => {
      const startedAt = new Date().toISOString();
      let outcome: Invocation["outcome"] = "rejected"; let result: Result;
      let release: (() => void) | undefined; let accepted = false;
      let before: SourceRevision | undefined;
      wrote = false;
      try {
        validateLocalPaths(paths);
        if (!tools.has(name) || Buffer.byteLength(JSON.stringify(args)) > 262_144) throw new LocalStateError();
        validateArguments(args);
        if (writes.has(name) && args.agent_id !== undefined && args.agent_id !== actorId) throw new LocalStateError();
        if ((name === "register_pull_endpoint" || name === "drain_own_inbox") && Object.keys(args).length) throw new LocalStateError();
        if (name === "inspect_work" && typeof args.message_id === "string") {
          const message = repos.agentMessages.get(args.message_id);
          if (!message || (message.senderAgentId !== actorId && message.recipientAgentId !== actorId)) throw new LocalStateError();
        }
        if (writes.has(name)) { release = await writerLease(paths); validateLocalPaths(paths); pullOnly(repos); }
        before = readSourceRevision(repos.db);
        accepted = true;
        result = await handler();
        outcome = result.isError === true ? "failed" : "succeeded";
        if (name === "inspect_work") result = privateInspection(result, args);
        if (wrote) {
          try { validateLocalPaths(paths); regenerateArtifacts(paths, repos); validateLocalPaths(paths); notifyChanged(); }
          catch { outcome = "db_committed_export_failed"; result = { isError: true, content: [{ type: "text", text: "The Concord operation committed, but local export regeneration failed. This capture is incomplete; the database operation was not rolled back." }], structuredContent: { acquisition_status: "incomplete", outcome } }; }
        }
      } catch {
        outcome = accepted ? "failed" : "rejected";
        result = { isError: true, content: [{ type: "text", text: accepted ? "Local Concord operation failed." : "Local Concord request rejected." }] };
      }
      try {
        if (tools.has(name)) {
          const after = readSourceRevision(repos.db);
          const data = result.structuredContent as Record<string, unknown> | undefined;
          const refs: Invocation["recordRefs"] = {};
          const taskId = typeof data?.task_id === "string" ? data.task_id : typeof args.task_id === "string" && args.task_id.length <= 128 ? args.task_id : null;
          if (taskId && repos.tasks.get(taskId)) refs.taskId = taskId;
          const baseline = before ?? after;
          if (after.eventId > baseline.eventId) refs.eventIds = Array.from({ length: Math.min(256, after.eventId - baseline.eventId) }, (_, i) => baseline.eventId + 1 + i);
          if (after.ownershipEventId > baseline.ownershipEventId) refs.ownershipEventIds = Array.from({ length: Math.min(256, after.ownershipEventId - baseline.ownershipEventId) }, (_, i) => baseline.ownershipEventId + 1 + i);
          if (typeof data?.update_id === "number") refs.updateId = data.update_id;
          if (typeof data?.handoff_id === "number") refs.handoffId = data.handoff_id;
          if (typeof data?.message_id === "string") refs.messageIds = [data.message_id];
          if (Array.isArray(data?.messages)) refs.messageIds = data.messages.map(message => (message as { messageId: string }).messageId);
          if (typeof data?.endpoint_id === "string") refs.endpointId = data.endpoint_id;
          store.appendInvocation(invocationSchema.parse({ invocationId: randomUUID(), version: "archeagent.invocation.v1", sourceInstanceId: identity.sourceInstanceId, captureRunId: identity.captureRunId, serverInstanceId, actorId, tool: name, taskId, startedAt, finishedAt: new Date().toISOString(), outcome, recordRefs: refs, sourceRevision: after, provenance: identity.provenance }));
        }
      } catch {
        result = { isError: true, content: [{ type: "text", text: "Local capture ledger is unavailable. The operation may have committed; capture is incomplete." }], structuredContent: { acquisition_status: "incomplete", outcome, ledger_status: "unavailable" } };
      } finally { release?.(); }
      return result;
    });
  }

  function privateInspection(result: Result, args: Record<string, unknown>): Result {
    const data = result.structuredContent as Record<string, unknown> | undefined;
    if (!data) return result;
    if (typeof args.agent_id === "string" && args.agent_id !== actorId) {
      const peer = repos.agents.get(args.agent_id);
      const tasks = repos.tasks.list().filter(task => task.agentId === args.agent_id || task.assignedAgentId === args.agent_id).slice(0, 256).map(task => ({ task_id: task.taskId, status: task.status, version: task.version, owner_agent_id: task.agentId }));
      const outbox = repos.agentMessages.listByAgent(args.agent_id).filter(message => message.senderAgentId === args.agent_id).slice(0, 100).map(message => ({ messageId: message.messageId, taskId: message.taskId, senderAgentId: message.senderAgentId, recipientAgentId: message.recipientAgentId, status: message.status, createdAt: message.createdAt, deliveredAt: message.deliveredAt }));
      return { content: [{ type: "text", text: "Peer work-state metadata; private inbox omitted." }], structuredContent: { scope: "agent", agentId: args.agent_id, presence: peer ? { agentId: peer.agentId, kind: peer.kind, status: peer.status, lastSeen: peer.lastSeen } : null, tasks, outbox, inboxAccess: "denied" } };
    }
    // A task selector is peer-visible, but its communication bodies belong only
    // to participants. Workspace communication summaries are metadata already.
    if (Array.isArray(data.messages)) return { ...result, structuredContent: { ...data, messages: data.messages.filter(message => { const entry = message as { senderAgentId: string; recipientAgentId: string }; return entry.senderAgentId === actorId || entry.recipientAgentId === actorId; }) } };
    return result;
  }

  // Capture raw arguments before the SDK's schema parser can strip root/actor
  // selectors. The handler remains the genuine upstream SDK/tool handler.
  const setHandler = server.server.setRequestHandler.bind(server.server);
  server.server.setRequestHandler = ((schema, handler) => {
    setHandler(schema, async (request, extra) => {
      const raw = request as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      if (raw.method === "tools/call") return dispatch(raw.params?.name ?? "", raw.params?.arguments ?? {}, async () => await handler(request, extra));
      if (raw.method === "resources/read") validateLocalPaths(paths);
      return handler(request, extra);
    });
  }) as typeof server.server.setRequestHandler;

  const notifyChanged = registerWorkStateResource(server, repos, fixedSelector);
  registerWorkflowTools(server, repos, () => { wrote = true; }, fixedSelector, { agentId: actorId, kind: "codex", origin: "operator" }, undefined, dispatcher);
  server.registerTool("register_pull_endpoint", { title: "Refresh own pull endpoint", description: "Register or refresh the bound actor's 90-second pull-only endpoint; no alternate actor or endpoint is accepted.", inputSchema: {} }, () => {
    validateLocalPaths(paths); pullOnly(repos);
    registerPullEndpoint(repos, actorId, "codex", Date.now(), { transport: "pull", reach: ["busy"], operations: ["pull"] }); wrote = true;
    const endpoint = repos.agentEndpoints.getByAgent(actorId)!;
    return { content: [{ type: "text", text: "Own pull endpoint refreshed." }], structuredContent: { agent_id: actorId, endpoint_id: endpoint.endpointId, expires_at: endpoint.expiresAt, delivery: "pull" } } satisfies CallToolResult;
  });
  server.registerTool("drain_own_inbox", { title: "Drain own inbox", description: "Deliver at most 100 pending messages to the bound actor and refresh its pull endpoint. Bodies remain private to this actor.", inputSchema: {} }, () => {
    validateLocalPaths(paths); pullOnly(repos);
    const pending = repos.db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(content AS BLOB))),0) AS bytes FROM agent_messages WHERE recipient_agent_id=? AND status='pending'").get(actorId) as { count: number; bytes: number };
    if (pending.count > 100 || pending.bytes > 262_144) throw new LocalStateError();
    const messages = drainInbox(repos, actorId, "codex", { transport: "pull", reach: ["busy"], operations: ["pull"] }); wrote = true;
    return { content: [{ type: "text", text: `${messages.length} own message(s) delivered.` }], structuredContent: { agent_id: actorId, messages, delivery: "pull" } } satisfies CallToolResult;
  });
  return { server, serverInstanceId };
}
