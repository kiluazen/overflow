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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function claimText(job) {
  const title = `Overflow: tsk ${job.id.slice(0, 4)} ${job.order.objective.replace(/\s+/g, " ").slice(0, 48)}`;
  return {
    content: [{
      type: "text",
      text:
        `Claimed Overflow task ${job.id}.\n\n` +
        `Requested by: ${job.requesterName}\n\n` +
        `Rename this visible Codex task to: ${title}\n\n` +
        `# Objective\n${job.order.objective}\n\n` +
        `# Context\n${job.order.context || "No additional context supplied."}\n\n` +
        `# Expected artifact\n${job.order.expectedArtifact}\n\n` +
        `# Acceptance test\n${job.order.acceptanceTest}\n\n` +
        "Complete this in the current visible task, then call overflow_return with this exact job ID.",
    }],
    structuredContent: {
      claimed: true,
      jobId: job.id,
      shortId: job.id.slice(0, 4),
      suggestedTitle: title,
      requester: job.requesterName,
      order: job.order,
    },
  };
}

function returnedJobsText(result) {
  const returned = result.jobs.filter((job) => job.status === "completed" || job.status === "failed");
  const text = returned.length
    ? returned.map((job, index) =>
        `## Order ${index + 1}: ${job.order.objective}\n_returned from ${job.workerName || "an Overflow worker"}_\n\n${job.result?.artifact || "No artifact returned."}`,
      ).join("\n\n---\n\n")
    : `Batch ${result.batch} has not returned any work yet.`;
  return { returned, text };
}

function createOverflowServer(env) {
  const server = new McpServer(
    { name: "Overflow", version: "0.4.0" },
    {
      instructions:
        "Overflow is a remote, authenticated task pool. It never launches local executors or background processes. " +
        "Use overflow_delegate to send work, overflow_claim to take one task visibly, and overflow_return to return it.",
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
        content: [{ type: "text", text: `${result.queued} task(s) queued and ${result.claimed} being worked on.` }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "overflow_delegate",
    {
      title: "Delegate work through Overflow",
      description: "Submit one or more self-contained work orders and wait server-side for their results without local polling.",
      inputSchema: {
        orders: z.array(ORDER).min(1).max(8),
        timeoutSeconds: z.number().int().min(30).max(1200).default(1200),
        waitForResult: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { securitySchemes: SECURITY_SCHEMES },
    },
    async ({ orders, timeoutSeconds, waitForResult }) => {
      const actor = identity();
      const submitted = await poolCall(env, "/rpc/submit", actor, { orders });
      if (!waitForResult) {
        return {
          content: [{
            type: "text",
            text: `Delegated ${orders.length} order(s) as batch ${submitted.batch}. Continue other work, then call overflow_collect with this batch ID.`,
          }],
          structuredContent: {
            delegated: true,
            batch: submitted.batch,
            orders: orders.length,
            returned: 0,
            complete: false,
            results: [],
          },
        };
      }
      const deadline = Date.now() + timeoutSeconds * 1000;
      let result;
      do {
        result = await poolCall(env, `/rpc/results?batch=${encodeURIComponent(submitted.batch)}`, actor);
        if (result.complete) break;
        await sleep(2000);
      } while (Date.now() < deadline);

      const { returned, text: returnedText } = returnedJobsText(result);
      const text = returned.length
        ? returnedText
        : `Delegated ${orders.length} order(s) as batch ${submitted.batch}, but none returned within ${timeoutSeconds}s.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          delegated: true,
          batch: submitted.batch,
          orders: orders.length,
          returned: returned.length,
          complete: Boolean(result.complete),
          results: returned,
        },
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
      description: "Wait server-side for one queued task, then claim it for this signed-in worker.",
      inputSchema: {
        timeoutSeconds: z.number().int().min(5).max(3600).default(3600),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { securitySchemes: SECURITY_SCHEMES },
    },
    async ({ timeoutSeconds }) => {
      const actor = identity();
      const deadline = Date.now() + timeoutSeconds * 1000;
      do {
        const job = await poolCall(env, "/rpc/claim", actor, {});
        if (job) return claimText(job);
        await sleep(2000);
      } while (Date.now() < deadline);
      return {
        content: [{ type: "text", text: `No task arrived within ${timeoutSeconds}s. Nothing was claimed.` }],
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
        files: z.array(z.object({
          name: z.string().trim().min(1).max(255),
          url: z.string().url(),
        })).max(4).default([]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: { securitySchemes: SECURITY_SCHEMES },
    },
    async ({ jobId, artifact, status, files }) => {
      const result = await poolCall(env, "/rpc/return", identity(), { jobId, artifact, status, files });
      return {
        content: [{ type: "text", text: `Returned Overflow task ${jobId.slice(0, 4)} to its requester.` }],
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
