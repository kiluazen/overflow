import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const POOL = "global";
const SECURITY_SCHEMES = [{ type: "oauth2", scopes: ["overflow:connect"] }];
const ORDER = z.object({
  objective: z.string().trim().min(1).max(20_000),
  context: z.string().max(200_000).default(""),
  expectedArtifact: z.string().trim().min(1).max(20_000),
  acceptanceTest: z.string().trim().min(1).max(20_000),
});

function identity() {
  const props = getMcpAuthContext()?.props;
  if (!props?.userId || !props?.email || !props?.displayName) {
    throw new Error("Sign in to Overflow before using the pool.");
  }
  return props;
}

async function poolCall(env, path, actor, body) {
  const id = env.POOL.idFromName(POOL);
  const pool = env.POOL.get(id);
  const response = await pool.fetch(`https://overflow.internal${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-overflow-user-id": actor.userId,
      "x-overflow-display-name": actor.displayName,
      "x-overflow-email": actor.email,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Overflow returned ${response.status}.`);
  return result;
}

function claimText(job) {
  const title = `Overflow: tsk ${job.id.slice(0, 4)} ${job.order.objective.replace(/\s+/g, " ").slice(0, 48)}`;
  const workspace = `~/Overflow earn/${job.id.slice(0, 4)}`;
  return {
    content: [{
      type: "text",
      text:
        `Claimed Overflow task ${job.id}.\n\n` +
        `Requested by: ${job.requesterName}\n\n` +
        `Rename this visible Codex task to: ${title}\n\n` +
        `Workspace: ${workspace}\n\n` +
        `# Objective\n${job.order.objective}\n\n` +
        `# Context\n${job.order.context || "No additional context supplied."}\n\n` +
        `# Expected artifact\n${job.order.expectedArtifact}\n\n` +
        `# Acceptance test\n${job.order.acceptanceTest}\n\n` +
        `Do all local work inside ${workspace}. Do not inspect or modify any other local folder. ` +
        "Complete this in the current visible task, upload files from that workspace, then call " +
        "overflow_return with this exact job ID.",
    }],
    structuredContent: {
      claimed: true,
      jobId: job.id,
      shortId: job.id.slice(0, 4),
      suggestedTitle: title,
      workspace,
      credits: Number(job.creditCost || 0),
      requester: job.requesterName,
      order: job.order,
    },
  };
}

function returnedJobsText(result) {
  const returned = result.jobs.filter((job) => job.status === "completed" || job.status === "failed");
  const text = returned.length
    ? returned.map((job, index) =>
        `## Order ${index + 1}: ${job.order.objective}\n_returned from ${job.workerName || "an Overflow worker"}_\n\n` +
        `${job.result?.artifact || "No artifact returned."}` +
        ((job.result?.files || []).length
          ? `\n\n${job.result.files.map((file) => file.url
              ? `- [${file.name}](${file.url})`
              : `- ${file.name} — unavailable; the worker must upload it again`
            ).join("\n")}`
          : "") +
        (job.result?.artifactTruncated ? "\n\n_Result preview truncated; call overflow_collect with this batch ID for the full text._" : ""),
      ).join("\n\n---\n\n")
    : `Batch ${result.batch} has not returned any work yet.`;
  return { returned, text };
}

function inboxText(result) {
  if (!result.batches.length) return "Your Overflow inbox is empty.";
  return result.batches.map((batch) => {
    const { text } = returnedJobsText(batch);
    const state = batch.complete ? "complete" : "in progress";
    return `# Batch ${batch.batch} (${state})\n\n${text}`;
  }).join("\n\n---\n\n");
}

function createOverflowServer(env) {
  const server = new McpServer(
    { name: "Overflow", version: "0.6.2" },
    {
      instructions:
        "Overflow is a remote, authenticated task pool. It never launches local executors or background processes. " +
        "Use overflow_delegate once to send work and end the requester turn without polling. " +
        "Use overflow_inbox to recover returned work without a batch ID. " +
        "Workers use overflow_claim, work only inside ~/Overflow earn, overflow_prepare_upload for every file, and overflow_return. " +
        "A claim lasts 90 minutes; abandoned work is automatically offered to another worker and refunded after two expired claims.",
    },
  );

  server.registerTool(
    "overflow_pool",
    {
      title: "Check the Overflow pool",
      description: "Show queued and currently claimed Overflow work.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { securitySchemes: SECURITY_SCHEMES },
    },
    async () => {
      const result = await poolCall(env, "/rpc/status", identity());
      return {
        content: [{
          type: "text",
          text:
            `${result.queued} task(s) queued and ${result.claimed} being worked on. ` +
            `You have ${result.account.balance} available credits and ${result.account.reserved} reserved.`,
        }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "overflow_balance",
    {
      title: "Check your Overflow credits",
      description: "Show the signed-in account's available, reserved, earned, and spent Overflow credits.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { securitySchemes: SECURITY_SCHEMES },
    },
    async () => {
      const result = await poolCall(env, "/rpc/account", identity());
      const account = result.account;
      return {
        content: [{
          type: "text",
          text:
            `${account.balance} credits available · ${account.reserved} reserved · ` +
            `${account.earned} earned · ${account.spent} spent.`,
        }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "overflow_delegate",
    {
      title: "Delegate work through Overflow",
      description: "Submit one or more self-contained work orders and immediately return a durable batch ID.",
      inputSchema: {
        orders: z.array(ORDER).min(1).max(8),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { securitySchemes: SECURITY_SCHEMES },
    },
    async ({ orders }) => {
      const actor = identity();
      const submitted = await poolCall(env, "/rpc/submit", actor, { orders });
      return {
        content: [{
          type: "text",
          text:
            `Delegated ${orders.length} order(s) as batch ${submitted.batch}. ` +
            `${submitted.creditsReserved} credits are reserved; ${submitted.balance} remain available. ` +
            "The batch is durable; use overflow_inbox to recover it later even if this task closes.",
        }],
        structuredContent: {
          delegated: true,
          batch: submitted.batch,
          orders: orders.length,
          returned: 0,
          complete: false,
          results: [],
          creditsReserved: submitted.creditsReserved,
          balance: submitted.balance,
          reserved: submitted.reserved,
        },
      };
    },
  );

  server.registerTool(
    "overflow_inbox",
    {
      title: "Open your Overflow inbox",
      description: "Recover recent delegated batches and returned artifacts for the signed-in requester, without needing a saved batch ID.",
      inputSchema: { limit: z.number().int().min(1).max(10).default(5) },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { securitySchemes: SECURITY_SCHEMES },
    },
    async ({ limit }) => {
      const result = await poolCall(env, `/rpc/inbox?limit=${limit}`, identity());
      return {
        content: [{ type: "text", text: inboxText(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "overflow_prepare_upload",
    {
      title: "Prepare an Overflow file upload",
      description: "Create a short-lived upload URL for a local artifact produced for a claimed Overflow task.",
      inputSchema: {
        jobId: z.string().uuid(),
        name: z.string().trim().min(1).max(255),
        contentType: z.string().trim().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i)
          .default("application/octet-stream"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { securitySchemes: SECURITY_SCHEMES },
    },
    async ({ jobId, name, contentType }) => {
      const result = await poolCall(env, "/rpc/uploads", identity(), { jobId, name, contentType });
      return {
        content: [{
          type: "text",
          text:
            `Upload ${name} with: curl --fail --request PUT --upload-file '<local-path>' ` +
            `'${result.uploadUrl}'\n\nThen pass artifactId ${result.artifactId} to overflow_return.`,
        }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "overflow_collect",
    {
      title: "Collect delegated Overflow work",
      description: "Read the current result of a previously delegated batch without resubmitting it.",
      inputSchema: { batch: z.string().uuid() },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { securitySchemes: SECURITY_SCHEMES },
    },
    async ({ batch }) => {
      const result = await poolCall(env, `/rpc/results?batch=${encodeURIComponent(batch)}`, identity());
      const { returned, text } = returnedJobsText(result);
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          batch,
          returned: returned.length,
          complete: Boolean(result.complete),
          results: returned,
        },
      };
    },
  );

  server.registerTool(
    "overflow_claim",
    {
      title: "Take one Overflow task",
      description: "Claim one currently queued task for this signed-in worker.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { securitySchemes: SECURITY_SCHEMES },
    },
    async () => {
      const job = await poolCall(env, "/rpc/claim", identity(), {});
      if (job) return claimText(job);
      return {
        content: [{ type: "text", text: "No Overflow task is queued right now. Nothing was claimed." }],
        structuredContent: { claimed: false },
      };
    },
  );

  server.registerTool(
    "overflow_return",
    {
      title: "Return completed Overflow work",
      description: "Return the completed artifact for a task claimed by this signed-in worker.",
      inputSchema: {
        jobId: z.string().uuid(),
        artifact: z.string().trim().min(1).max(600_000),
        status: z.enum(["completed", "failed"]).default("completed"),
        files: z.array(z.object({ artifactId: z.string().uuid() })).max(4).default([]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: { securitySchemes: SECURITY_SCHEMES },
    },
    async ({ jobId, artifact, status, files }) => {
      const result = await poolCall(env, "/rpc/return", identity(), { jobId, artifact, status, files });
      return {
        content: [{
          type: "text",
          text: result.alreadyStored
            ? `Overflow task ${jobId.slice(0, 4)} was already stored. Your balance remains ${result.workerBalance}.`
            : `Stored Overflow task ${jobId.slice(0, 4)} for its requester. ` +
              (result.status === "completed"
                ? `You earned ${result.creditsEarned} credits and now have ${result.workerBalance}.`
                : "The requester's reserved credits were refunded."),
        }],
        structuredContent: result,
      };
    },
  );

  return server;
}

export function createOverflowMcpHandler(env, route, schedule) {
  return createMcpHandler(() => createOverflowServer(env), {
    route,
    legacy: "stateless",
    schedule,
  });
}
