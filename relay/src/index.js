import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { BOARD_HTML } from "./board.js";
import { BG_JPEG_BASE64 } from "./bg.js";
import { createOverflowMcpHandler } from "./mcp.js";
import {
  handleAuthorize,
  handleGoogleCallback,
  handleGoogleStart,
  handleProtectedResource,
} from "./oauth.js";

// Overflow relay: one Durable Object holding the job board. The authenticated
// MCP transport uses short HTTP RPCs. Legacy invite-code clients still use the
// WebSocket routes near the bottom of this file.

const POOL = "global";
const ACTIVITY_LIMIT = 60;
const ARTIFACT_PREVIEW_CHARS = 1200;
const PUBLIC_BASE = "https://overflow.kushalsm.com";
const UPLOAD_TTL_MS = 15 * 60 * 1000;
const DOWNLOAD_TTL_MS = 60 * 60 * 1000;
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const INBOX_ARTIFACT_CHARS = 20_000;
const MAX_USER_BATCHES = 50;
const STARTING_CREDITS = 1_000;
const ORDER_CREDITS = 100;

function safeFileName(value) {
  const name = String(value || "artifact").replace(/[\r\n"\\/]/g, "_").trim();
  return name.slice(0, 255) || "artifact";
}

function unauthorized(reason) {
  return new Response(JSON.stringify({ error: reason }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate":
        'Bearer resource_metadata="https://overflow.kushalsm.com/.well-known/oauth-protected-resource/mcp", scope="overflow:connect"',
    },
  });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  if (!left || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function poolIdentity(token, env, requestedName) {
  const legacy = env.OVERFLOW_TOKEN || "";
  if (legacy && constantTimeEqual(token, legacy)) {
    return {
      userId: "legacy-friends-pool",
      displayName: requestedName || "friend",
      deviceName: requestedName || "friend",
      legacy: true,
    };
  }
  if (!token.startsWith("ovf_")) return null;
  const raw = await env.OAUTH_KV.get(`device:${await sha256(token)}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const defaultHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";

    const protectedResource = handleProtectedResource(request);
    if (protectedResource) return protectedResource;
    if (url.pathname === "/.well-known/openid-configuration") {
      return Response.redirect(`${url.origin}/.well-known/oauth-authorization-server`, 302);
    }
    if (url.pathname === "/authorize" || url.pathname.startsWith("/authorize/")) {
      return handleAuthorize(request, env);
    }
    if (url.pathname === "/auth/google/start") return handleGoogleStart(request, env);
    if (url.pathname === "/auth/google/callback") return handleGoogleCallback(request, env);

    // The board and its activity feed are public so friends can watch the
    // experiment. Every route that moves an order requires either the old
    // dogfood invite code or an OAuth bearer handled by the MCP provider.
    const publicPaths = new Set(["/", "/board", "/bg.jpg", "/api/activity"]);
    const capabilityPath = url.pathname.startsWith("/api/uploads/") ||
      url.pathname.startsWith("/api/artifacts/");
    let identity = null;
    if (!publicPaths.has(url.pathname) && !capabilityPath) {
      identity = await poolIdentity(token, env, url.searchParams.get("name") || "");
      if (!identity) return unauthorized("bad or missing Overflow token");
    }

    const id = env.POOL.idFromName(POOL);
    const pool = env.POOL.get(id);

    if (capabilityPath) return pool.fetch(request);

    switch (url.pathname) {
      case "/":
      case "/board":
        return new Response(BOARD_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      case "/bg.jpg": {
        const binary = atob(BG_JPEG_BASE64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return new Response(bytes, {
          headers: {
            "content-type": "image/jpeg",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }
      case "/api/activity":
      case "/api/reset":
      case "/earn":
      case "/delegate":
      case "/status":
        if (identity) {
          url.searchParams.set("name", identity.deviceName || identity.displayName || "friend");
          const headers = new Headers(request.headers);
          headers.set("x-overflow-user-id", identity.userId || "");
          headers.set("x-overflow-display-name", identity.displayName || "");
          headers.set("x-overflow-device-name", identity.deviceName || "");
          return pool.fetch(new Request(url.toString(), { method: request.method, headers, body: request.body }));
        }
        return pool.fetch(request);
      default:
        return new Response("not found", { status: 404 });
    }
  },
};

export class Pool {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Jobs waiting for a free earner. This MUST be durable. Hibernation is the
    // whole reason an idle pool is cheap, and the DO hibernates precisely when
    // it is most likely to be holding a queue: every worker busy, nothing
    // arriving. An in-memory queue silently lost every order waiting behind a
    // busy worker, which looked like orders that were submitted and simply
    // never ran.
    this.queue = [];
    this.state.blockConcurrencyWhile(async () => {
      this.queue = (await this.state.storage.get("queue")) || [];
    });
  }

  // A bounded log of what the relay already sees pass through it: an order
  // queued, claimed, returned. Nothing is measured or derived that the relay
  // did not already handle -- this only keeps the last of them so the board has
  // something to show between bursts.
  async recordEvent(event) {
    const events = (await this.state.storage.get("events")) || [];
    events.unshift({ at: Date.now(), ...event });
    await this.state.storage.put("events", events.slice(0, ACTIVITY_LIMIT));
  }

  async saveQueue() {
    await this.state.storage.put("queue", this.queue);
  }

  // In-flight jobs are kept whole (order included) in storage, not in the
  // socket attachment, which is capped at 2 KB. Keeping the order is what makes
  // it possible to hand the job to somebody else when a laptop closes.
  inFlightKey(id) {
    return `job:${id}`;
  }

  remoteJobKey(id) {
    return `remote-job:${id}`;
  }

  remoteBatchKey(id) {
    return `remote-batch:${id}`;
  }

  remoteUserBatchesKey(userId) {
    return `remote-user-batches:${userId}`;
  }

  accountKey(userId) {
    return `account:${userId}`;
  }

  uploadKey(token) {
    return `upload:${token}`;
  }

  fileKey(id) {
    return `file:${id}`;
  }

  downloadKey(token) {
    return `download:${token}`;
  }

  downloadGrantKey(id) {
    return `download-grant:${id}`;
  }

  actor(request) {
    return {
      userId: request.headers.get("x-overflow-user-id") || "",
      displayName: request.headers.get("x-overflow-display-name") || "someone",
      email: request.headers.get("x-overflow-email") || "",
    };
  }

  async ensureAccount(actor) {
    if (!actor?.userId) return null;
    const key = this.accountKey(actor.userId);
    const existing = await this.state.storage.get(key);
    const now = Date.now();
    const account = existing || {
      userId: actor.userId,
      displayName: actor.displayName || "someone",
      email: actor.email || "",
      balance: STARTING_CREDITS,
      reserved: 0,
      earned: 0,
      spent: 0,
      delegated: 0,
      completed: 0,
      refunded: 0,
      createdAt: now,
    };
    account.displayName = actor.displayName || account.displayName || "someone";
    account.email = actor.email || account.email || "";
    account.lastSeenAt = now;
    await this.state.storage.put(key, account);
    if (!existing) {
      await this.recordEvent({
        type: "joined",
        member: account.displayName,
        credits: STARTING_CREDITS,
        creditState: "issued",
      });
    }
    return account;
  }

  async saveAccount(account) {
    await this.state.storage.put(this.accountKey(account.userId), account);
  }

  async accounts() {
    const entries = await this.state.storage.list({ prefix: "account:" });
    return [...entries.values()];
  }

  publicAccount(account) {
    return {
      name: account.displayName || "someone",
      balance: Number(account.balance || 0),
      reserved: Number(account.reserved || 0),
      earned: Number(account.earned || 0),
      spent: Number(account.spent || 0),
      delegated: Number(account.delegated || 0),
      completed: Number(account.completed || 0),
      createdAt: Number(account.createdAt || 0),
      lastSeenAt: Number(account.lastSeenAt || 0),
    };
  }

  publicJob(job) {
    return {
      id: job.id,
      batch: job.batch,
      status: job.status,
      objective: String(job.order?.objective || ""),
      expectedArtifact: String(job.order?.expectedArtifact || ""),
      requester: job.requesterName || "someone",
      worker: job.workerName || "",
      credits: Number(job.creditCost || 0),
      createdAt: Number(job.createdAt || 0),
      claimedAt: Number(job.claimedAt || 0),
      completedAt: Number(job.completedAt || 0),
      artifact: String(job.result?.artifact || "").slice(0, ARTIFACT_PREVIEW_CHARS),
      artifactChars: String(job.result?.artifact || "").length,
      files: (job.result?.files || []).map((file) => safeFileName(file?.name)),
    };
  }

  async remoteJobs() {
    const entries = await this.state.storage.list({ prefix: "remote-job:" });
    return [...entries.values()];
  }

  async cleanupExpiredCapabilities() {
    const now = Date.now();
    for (const prefix of ["upload:", "download:"]) {
      const entries = await this.state.storage.list({ prefix });
      const expired = [...entries.entries()]
        .filter(([, value]) => Number(value?.expiresAt || 0) <= now)
        .map(([key]) => key);
      await Promise.all(expired.map((key) => this.state.storage.delete(key)));
    }
  }

  async presentFile(file) {
    if (file?.objectKey) {
      const name = safeFileName(file.name);
      const contentType = file.contentType || "application/octet-stream";
      const existing = await this.state.storage.get(this.downloadGrantKey(file.artifactId));
      let token = existing?.token;
      let expiresAt = Number(existing?.expiresAt || 0);
      if (!token || expiresAt <= Date.now()) {
        if (token) await this.state.storage.delete(this.downloadKey(token));
        token = crypto.randomUUID();
        expiresAt = Date.now() + DOWNLOAD_TTL_MS;
        const ticket = { objectKey: file.objectKey, name, contentType, expiresAt };
        await Promise.all([
          this.state.storage.put(this.downloadKey(token), ticket),
          this.state.storage.put(this.downloadGrantKey(file.artifactId), { token, expiresAt }),
        ]);
      }
      return {
        artifactId: file.artifactId,
        name,
        contentType,
        size: Number(file.size || 0),
        url: `${PUBLIC_BASE}/api/artifacts/${token}`,
        expiresInSeconds: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
      };
    }

    // Results returned before Overflow-owned uploads existed may already point
    // at a shareable HTTPS file. Preserve that path so old completed work can
    // still be recovered through the private requester inbox.
    if (file?.url && /^https:\/\//i.test(String(file.url))) {
      return {
        name: safeFileName(file.name),
        url: String(file.url),
        legacy: true,
      };
    }
    return {
      name: safeFileName(file?.name),
      unavailable: true,
      reason: "This legacy worker returned a local or non-HTTPS path instead of uploading file bytes.",
    };
  }

  async presentJob(job, compact = false) {
    const result = job.result
      ? {
          artifact: String(job.result.artifact || "").slice(0, compact ? INBOX_ARTIFACT_CHARS : undefined),
          artifactTruncated: compact && String(job.result.artifact || "").length > INBOX_ARTIFACT_CHARS,
          files: await Promise.all((job.result.files || []).map((file) => this.presentFile(file))),
        }
      : undefined;
    return {
      id: job.id,
      batch: job.batch,
      index: job.index,
      order: compact
        ? {
            objective: job.order?.objective,
            expectedArtifact: job.order?.expectedArtifact,
          }
        : job.order,
      status: job.status,
      createdAt: job.createdAt,
      claimedAt: job.claimedAt,
      completedAt: job.completedAt,
      requesterName: job.requesterName,
      workerName: job.workerName,
      result,
    };
  }

  async handleRemote(request, url) {
    const actor = this.actor(request);
    if (!actor.userId) return Response.json({ error: "missing authenticated actor" }, { status: 401 });
    const actorAccount = await this.ensureAccount(actor);

    if (url.pathname === "/rpc/account-init" || url.pathname === "/rpc/account") {
      return Response.json({
        account: this.publicAccount(actorAccount),
        credits: { starting: STARTING_CREDITS, perOrder: ORDER_CREDITS },
      });
    }

    if (url.pathname === "/rpc/status") {
      const jobs = await this.remoteJobs();
      return Response.json({
        queued: jobs.filter((job) => job.status === "queued").length,
        claimed: jobs.filter((job) => job.status === "claimed").length,
        completed: jobs.filter((job) => job.status === "completed").length,
        failed: jobs.filter((job) => job.status === "failed").length,
        account: this.publicAccount(actorAccount),
        credits: { starting: STARTING_CREDITS, perOrder: ORDER_CREDITS },
      });
    }

    if (url.pathname === "/rpc/submit") {
      const body = await request.json();
      const orders = Array.isArray(body.orders) ? body.orders : [];
      if (!orders.length) return Response.json({ error: "no orders" }, { status: 400 });
      if (orders.length > 8) return Response.json({ error: "at most 8 orders may be delegated at once" }, { status: 400 });
      const reserve = orders.length * ORDER_CREDITS;
      if (Number(actorAccount.balance || 0) < reserve) {
        return Response.json({
          error: `not enough credits: ${reserve} required, ${Number(actorAccount.balance || 0)} available`,
        }, { status: 402 });
      }
      actorAccount.balance -= reserve;
      actorAccount.reserved = Number(actorAccount.reserved || 0) + reserve;
      actorAccount.delegated = Number(actorAccount.delegated || 0) + orders.length;
      await this.saveAccount(actorAccount);
      const batch = crypto.randomUUID();
      const ids = [];
      for (const [index, order] of orders.entries()) {
        const id = crypto.randomUUID();
        const job = {
          id,
          batch,
          index,
          transport: "remote",
          requesterUserId: actor.userId,
          requesterName: actor.displayName,
          requesterEmail: actor.email,
          order,
          creditCost: ORDER_CREDITS,
          status: "queued",
          createdAt: Date.now(),
        };
        ids.push(id);
        this.queue.push(job);
        await this.state.storage.put(this.remoteJobKey(id), job);
        await this.recordEvent({
          type: "queued",
          jobId: id,
          objective: String(order?.objective || ""),
          requester: actor.displayName,
          credits: ORDER_CREDITS,
          creditState: "reserved",
        });
      }
      await this.state.storage.put(this.remoteBatchKey(batch), ids);
      let userBatches = await this.state.storage.get(this.remoteUserBatchesKey(actor.userId));
      if (!Array.isArray(userBatches)) {
        const existingJobs = (await this.remoteJobs()).filter((job) => job.requesterUserId === actor.userId);
        userBatches = [...new Set(existingJobs
          .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
          .map((job) => job.batch)
          .filter(Boolean))];
      }
      userBatches = [batch, ...userBatches.filter((item) => item !== batch)].slice(0, MAX_USER_BATCHES);
      await this.state.storage.put(this.remoteUserBatchesKey(actor.userId), userBatches);
      await this.saveQueue();
      return Response.json({
        batch,
        jobs: ids,
        creditsReserved: reserve,
        balance: actorAccount.balance,
        reserved: actorAccount.reserved,
      });
    }

    if (url.pathname === "/rpc/claim") {
      const index = this.queue.findIndex((job) => job.transport === "remote" && job.status === "queued");
      if (index < 0) return new Response(null, { status: 204 });
      const [job] = this.queue.splice(index, 1);
      const claimed = {
        ...job,
        status: "claimed",
        workerUserId: actor.userId,
        workerName: actor.displayName,
        workerEmail: actor.email,
        claimedAt: Date.now(),
      };
      await this.saveQueue();
      await this.state.storage.put(this.remoteJobKey(job.id), claimed);
      await this.recordEvent({
        type: "claimed",
        jobId: job.id,
        objective: String(job.order?.objective || ""),
        requester: job.requesterName,
        worker: actor.displayName,
        credits: Number(job.creditCost || 0),
        creditState: "reserved",
      });
      return Response.json(claimed);
    }

    if (url.pathname === "/rpc/uploads") {
      await this.cleanupExpiredCapabilities();
      const body = await request.json();
      const job = await this.state.storage.get(this.remoteJobKey(body.jobId || ""));
      if (!job) return Response.json({ error: "unknown job" }, { status: 404 });
      if (job.workerUserId !== actor.userId) {
        return Response.json({ error: "this account did not claim that job" }, { status: 403 });
      }
      if (job.status !== "claimed") return Response.json({ error: "job is not claimed" }, { status: 409 });
      const artifactId = crypto.randomUUID();
      const uploadToken = crypto.randomUUID();
      const name = safeFileName(body.name);
      const contentType = String(body.contentType || "application/octet-stream").slice(0, 255);
      const objectKey = `remote-artifacts/${job.requesterUserId}/${job.id}/${artifactId}/${name}`;
      await this.state.storage.put(this.uploadKey(uploadToken), {
        artifactId,
        objectKey,
        jobId: job.id,
        workerUserId: actor.userId,
        name,
        contentType,
        expiresAt: Date.now() + UPLOAD_TTL_MS,
      });
      return Response.json({
        artifactId,
        name,
        uploadUrl: `${PUBLIC_BASE}/api/uploads/${uploadToken}`,
        expiresInSeconds: UPLOAD_TTL_MS / 1000,
        maxBytes: MAX_ARTIFACT_BYTES,
      });
    }

    if (url.pathname === "/rpc/return") {
      const body = await request.json();
      const job = await this.state.storage.get(this.remoteJobKey(body.jobId || ""));
      if (!job) return Response.json({ error: "unknown job" }, { status: 404 });
      if (job.workerUserId !== actor.userId) {
        return Response.json({ error: "this account did not claim that job" }, { status: 403 });
      }
      if (job.status === "completed" || job.status === "failed") {
        return Response.json({
          returned: true,
          stored: true,
          alreadyStored: true,
          jobId: job.id,
          status: job.status,
          creditsEarned: 0,
          workerBalance: actorAccount.balance,
        });
      }
      if (job.status !== "claimed") return Response.json({ error: "job is not claimed" }, { status: 409 });
      const fileRefs = Array.isArray(body.files) ? body.files.slice(0, 4) : [];
      const files = [];
      for (const ref of fileRefs) {
        if (ref?.artifactId) {
          const file = await this.state.storage.get(this.fileKey(ref.artifactId));
          if (!file || file.jobId !== job.id || file.workerUserId !== actor.userId) {
            return Response.json({ error: "uploaded artifact does not belong to this job" }, { status: 403 });
          }
          files.push(file);
          continue;
        }
        if (ref?.url && /^https:\/\//i.test(String(ref.url))) {
          files.push({ name: safeFileName(ref.name), url: String(ref.url) });
          continue;
        }
        return Response.json({ error: "files must be uploaded through Overflow first" }, { status: 400 });
      }
      const status = body.status === "failed" ? "failed" : "completed";
      const creditCost = Number(job.creditCost || 0);
      let requesterAccount = await this.ensureAccount({
        userId: job.requesterUserId,
        displayName: job.requesterName,
        email: job.requesterEmail,
      });
      let workerAccount = actorAccount;
      if (requesterAccount.userId === workerAccount.userId) {
        workerAccount = requesterAccount;
      }
      requesterAccount.reserved = Math.max(0, Number(requesterAccount.reserved || 0) - creditCost);
      if (status === "completed") {
        requesterAccount.spent = Number(requesterAccount.spent || 0) + creditCost;
        workerAccount.balance = Number(workerAccount.balance || 0) + creditCost;
        workerAccount.earned = Number(workerAccount.earned || 0) + creditCost;
        workerAccount.completed = Number(workerAccount.completed || 0) + 1;
      } else {
        requesterAccount.balance = Number(requesterAccount.balance || 0) + creditCost;
        requesterAccount.refunded = Number(requesterAccount.refunded || 0) + creditCost;
      }
      await this.saveAccount(requesterAccount);
      if (workerAccount.userId !== requesterAccount.userId) await this.saveAccount(workerAccount);
      const completed = {
        ...job,
        status,
        completedAt: Date.now(),
        result: {
          artifact: String(body.artifact || ""),
          files,
        },
      };
      await this.state.storage.put(this.remoteJobKey(job.id), completed);
      await this.recordEvent({
        type: status === "failed" ? "failed" : "returned",
        jobId: job.id,
        objective: String(job.order?.objective || ""),
        requester: job.requesterName,
        worker: actor.displayName,
        stored: true,
        artifactChars: completed.result.artifact.length,
        artifact: completed.result.artifact.slice(0, ARTIFACT_PREVIEW_CHARS),
        files: completed.result.files.map((file) => file.name || "file"),
        credits: creditCost,
        creditState: status === "failed" ? "refunded" : "transferred",
      });
      return Response.json({
        returned: true,
        stored: true,
        jobId: job.id,
        status,
        creditsEarned: status === "completed" ? creditCost : 0,
        workerBalance: workerAccount.balance,
        requesterBalance: requesterAccount.balance,
        requesterReserved: requesterAccount.reserved,
      });
    }

    if (url.pathname === "/rpc/results") {
      const batch = url.searchParams.get("batch") || "";
      const ids = await this.state.storage.get(this.remoteBatchKey(batch));
      if (!Array.isArray(ids)) return Response.json({ error: "unknown batch" }, { status: 404 });
      const jobs = (await Promise.all(ids.map((id) => this.state.storage.get(this.remoteJobKey(id))))).filter(Boolean);
      if (jobs.some((job) => job.requesterUserId !== actor.userId)) {
        return Response.json({ error: "this account did not create that batch" }, { status: 403 });
      }
      return Response.json({
        batch,
        complete: jobs.length === ids.length && jobs.every((job) => job.status === "completed" || job.status === "failed"),
        jobs: await Promise.all(jobs.map((job) => this.presentJob(job))),
      });
    }

    if (url.pathname === "/rpc/inbox") {
      await this.cleanupExpiredCapabilities();
      const requestedLimit = Number(url.searchParams.get("limit") || 5);
      const limit = Number.isInteger(requestedLimit) ? Math.min(10, Math.max(1, requestedLimit)) : 5;
      let batchIds = await this.state.storage.get(this.remoteUserBatchesKey(actor.userId));
      if (!Array.isArray(batchIds)) {
        const jobs = (await this.remoteJobs())
          .filter((job) => job.requesterUserId === actor.userId)
          .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
        batchIds = [...new Set(jobs.map((job) => job.batch).filter(Boolean))].slice(0, MAX_USER_BATCHES);
        await this.state.storage.put(this.remoteUserBatchesKey(actor.userId), batchIds);
      }
      const batches = [];
      for (const batch of batchIds.slice(0, limit)) {
        const ids = await this.state.storage.get(this.remoteBatchKey(batch));
        if (!Array.isArray(ids)) continue;
        const batchJobs = (await Promise.all(
          ids.map((id) => this.state.storage.get(this.remoteJobKey(id))),
        )).filter((job) => job?.requesterUserId === actor.userId);
        if (!batchJobs.length) continue;
        batches.push({
          batch,
          complete: batchJobs.every((job) => job.status === "completed" || job.status === "failed"),
          createdAt: Math.min(...batchJobs.map((job) => Number(job.createdAt || 0))),
          jobs: await Promise.all(
            batchJobs.sort((a, b) => a.index - b.index).map((job) => this.presentJob(job, true)),
          ),
        });
      }
      return Response.json({ batches });
    }

    return Response.json({ error: "unknown rpc route" }, { status: 404 });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/rpc/")) return this.handleRemote(request, url);

    if (url.pathname.startsWith("/api/uploads/")) {
      if (request.method !== "PUT") return new Response("method not allowed", { status: 405 });
      if (!this.env.ARTIFACTS) return new Response("artifact storage unavailable", { status: 503 });
      const token = url.pathname.slice("/api/uploads/".length);
      const ticket = await this.state.storage.get(this.uploadKey(token));
      if (!ticket) return new Response("unknown upload", { status: 404 });
      if (Number(ticket.expiresAt || 0) < Date.now()) {
        await this.state.storage.delete(this.uploadKey(token));
        return new Response("upload expired", { status: 410 });
      }
      const size = Number(request.headers.get("content-length") || 0);
      if (!Number.isInteger(size) || size <= 0 || size > MAX_ARTIFACT_BYTES || !request.body) {
        return new Response(`artifact must be between 1 and ${MAX_ARTIFACT_BYTES} bytes`, { status: 413 });
      }
      await this.env.ARTIFACTS.put(ticket.objectKey, request.body, {
        httpMetadata: { contentType: ticket.contentType },
        customMetadata: { jobId: ticket.jobId, workerUserId: ticket.workerUserId },
      });
      const file = {
        artifactId: ticket.artifactId,
        objectKey: ticket.objectKey,
        jobId: ticket.jobId,
        workerUserId: ticket.workerUserId,
        name: ticket.name,
        contentType: ticket.contentType,
        size,
        uploadedAt: Date.now(),
      };
      await this.state.storage.put(this.fileKey(ticket.artifactId), file);
      await this.state.storage.delete(this.uploadKey(token));
      return Response.json({ uploaded: true, artifactId: ticket.artifactId, name: ticket.name, size }, { status: 201 });
    }

    if (url.pathname.startsWith("/api/artifacts/")) {
      if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
      if (!this.env.ARTIFACTS) return new Response("artifact storage unavailable", { status: 503 });
      const token = url.pathname.slice("/api/artifacts/".length);
      const ticket = await this.state.storage.get(this.downloadKey(token));
      if (!ticket) return new Response("unknown artifact", { status: 404 });
      if (Number(ticket.expiresAt || 0) < Date.now()) {
        await this.state.storage.delete(this.downloadKey(token));
        return new Response("artifact link expired", { status: 410 });
      }
      const object = await this.env.ARTIFACTS.get(ticket.objectKey);
      if (!object) return new Response("artifact missing", { status: 404 });
      const headers = new Headers({
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${safeFileName(ticket.name)}"`,
      });
      if (typeof object.writeHttpMetadata === "function") object.writeHttpMetadata(headers);
      else headers.set("content-type", ticket.contentType || "application/octet-stream");
      return new Response(object.body, { headers });
    }

    // Wipe the ledger. Token-gated, because it is the one thing here that
    // destroys something.
    if (url.pathname === "/api/reset") {
      await this.state.storage.delete("events");
      return Response.json({ cleared: true });
    }

    if (url.pathname === "/api/activity") {
      const events = (await this.state.storage.get("events")) || [];
      const remoteJobs = (await this.remoteJobs())
        .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
      const accounts = (await this.accounts())
        .sort((left, right) => Number(right.lastSeenAt || 0) - Number(left.lastSeenAt || 0));
      const sockets = this.socketsTagged("earner").map((ws) => {
        const meta = this.meta(ws);
        return { name: meta.name || "anon", busy: Boolean(meta.busy) };
      });
      const byName = new Map();
      for (const socket of sockets) {
        const entry = byName.get(socket.name) || { name: socket.name, sessions: 0, busy: 0 };
        entry.sessions += 1;
        entry.busy += socket.busy ? 1 : 0;
        byName.set(socket.name, entry);
      }
      const legacyJobs = this.queue
        .filter((job) => job.transport !== "remote")
        .map((job) => ({ ...job, status: "queued", creditCost: 0, createdAt: job.createdAt || 0 }));
      for (const ws of this.socketsTagged("earner")) {
        const meta = this.meta(ws);
        if (!meta.job) continue;
        const stored = await this.state.storage.get(this.inFlightKey(meta.job.id));
        legacyJobs.push({
          ...(stored || meta.job),
          status: "claimed",
          workerName: meta.name || "anon",
          creditCost: 0,
        });
      }
      const visibleJobs = [...remoteJobs, ...legacyJobs]
        .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
      const queued = visibleJobs.filter((job) => job.status === "queued").length;
      const claimed = visibleJobs.filter((job) => job.status === "claimed").length;
      const completed = visibleJobs.filter((job) => job.status === "completed").length;
      const failed = visibleJobs.filter((job) => job.status === "failed").length;
      const availableCredits = accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
      const reservedCredits = accounts.reduce((sum, account) => sum + Number(account.reserved || 0), 0);
      const transferredCredits = accounts.reduce((sum, account) => sum + Number(account.earned || 0), 0);
      return Response.json(
        {
          now: Date.now(),
          credits: {
            starting: STARTING_CREDITS,
            perOrder: ORDER_CREDITS,
            issued: accounts.length * STARTING_CREDITS,
            available: availableCredits,
            reserved: reservedCredits,
            transferred: transferredCredits,
          },
          totals: {
            accounts: accounts.length,
            jobs: visibleJobs.length,
            queued,
            claimed,
            completed,
            failed,
          },
          accounts: accounts.map((account) => this.publicAccount(account)),
          jobs: visibleJobs.slice(0, 100).map((job) => this.publicJob(job)),
          machines: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
          online: sockets.length,
          idle: sockets.filter((s) => !s.busy).length,
          events,
        },
        { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } },
      );
    }

    if (url.pathname === "/status") {
      const sockets = this.socketsTagged("earner").map((ws) => {
        const meta = this.meta(ws);
        return { name: meta.name || "anon", busy: Boolean(meta.busy) };
      });
      // One person with three Codex windows is three sockets but one machine,
      // and listing the same name three times reads like a bug. Group them.
      const byName = new Map();
      for (const socket of sockets) {
        const entry = byName.get(socket.name) || { name: socket.name, sessions: 0, busy: 0 };
        entry.sessions += 1;
        entry.busy += socket.busy ? 1 : 0;
        byName.set(socket.name, entry);
      }
      const workers = [...byName.values()]
        .map((w) => ({ ...w, busy: w.busy > 0 && w.busy === w.sessions }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return Response.json({
        earners: sockets.length,
        machines: workers.length,
        idle: sockets.filter((s) => !s.busy).length,
        queued: this.queue.length,
        workers,
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const role = url.pathname === "/earn" ? "earner" : "requester";
    const name = request.headers.get("x-overflow-device-name") || url.searchParams.get("name") || "anon";
    const userId = request.headers.get("x-overflow-user-id") || "legacy-friends-pool";
    const displayName = request.headers.get("x-overflow-display-name") || name;
    const connectionId = crypto.randomUUID();

    // Tags are the only state that survives hibernation, so identity and role
    // both have to live in them.
    this.state.acceptWebSocket(server, [role, `id:${connectionId}`]);
    server.serializeAttachment({ role, name, userId, displayName, connectionId, busy: false, jobs: {} });

    if (role === "earner") this.drainQueue();
    else this.send(server, { type: "hello", idle: this.idleEarners().length });

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- socket helpers -----------------------------------------------------

  socketsTagged(tag) {
    return this.state.getWebSockets(tag);
  }

  meta(ws) {
    return ws.deserializeAttachment() || {};
  }

  setMeta(ws, patch) {
    ws.serializeAttachment({ ...this.meta(ws), ...patch });
  }

  send(ws, message) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // A socket that died between our check and this send is handled by the
      // close handler; losing this particular message is not worth a throw.
    }
  }

  idleEarners() {
    return this.socketsTagged("earner").filter((ws) => !this.meta(ws).busy);
  }

  // --- job routing --------------------------------------------------------

  async webSocketMessage(ws, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return this.send(ws, { type: "error", error: "malformed json" });
    }
    const meta = this.meta(ws);

    if (meta.role === "requester" && message.type === "submit") {
      const orders = Array.isArray(message.orders) ? message.orders : [];
      if (orders.length === 0) {
        return this.send(ws, { type: "error", error: "no orders" });
      }
      const batch = crypto.randomUUID();
      for (const [index, order] of orders.entries()) {
        const id = crypto.randomUUID();
        const requesterName = meta.name || "someone";
        this.queue.push({
          id,
          batch,
          index,
          requester: meta.connectionId,
          requesterName,
          order,
        });
        await this.recordEvent({
          type: "queued",
          jobId: id,
          objective: String(order?.objective ?? ""),
          requester: requesterName,
        });
      }
      await this.saveQueue();
      this.send(ws, { type: "accepted", batch, count: orders.length });
      return this.drainQueue();
    }

    if (meta.role === "earner" && message.type === "result") {
      return this.completeJob(ws, message);
    }

    if (message.type === "ping") return this.send(ws, { type: "pong" });
  }

  // How many jobs each requester currently has running. Derived from the
  // earners rather than tracked separately, so it cannot drift.
  inFlightByRequester() {
    const counts = new Map();
    for (const ws of this.socketsTagged("earner")) {
      const job = this.meta(ws).job;
      if (job) counts.set(job.requester, (counts.get(job.requester) || 0) + 1);
    }
    return counts;
  }

  // Take the next job from whoever has the least work running. Strict FIFO let
  // one person's eight-order batch occupy every worker while a second person,
  // equally out of allowance, waited for all of it -- and two friends being dry
  // on the same evening is the normal case, not the edge case.
  takeNextJob() {
    const counts = this.inFlightByRequester();
    let bestIndex = -1;
    let bestCount = Infinity;
    for (let i = 0; i < this.queue.length; i += 1) {
      // OAuth-backed jobs are explicitly claimed through /rpc/claim. A legacy
      // websocket earner must never consume one and strand its result.
      if (this.queue[i].transport === "remote") continue;
      const count = counts.get(this.queue[i].requester) || 0;
      if (count < bestCount) {
        bestCount = count;
        bestIndex = i;
        if (count === 0) break;
      }
    }
    if (bestIndex < 0) return null;
    return this.queue.splice(bestIndex, 1)[0];
  }

  async drainQueue() {
    const before = this.queue.length;
    while (true) {
      const earner = this.idleEarners()[0];
      if (!earner) break;
      const job = this.takeNextJob();
      if (!job) break;
      const requester = this.findByConnectionId(job.requester);
      // The requester hung up while this job sat in the queue. Drop it rather
      // than spend someone's allowance on an artifact with nowhere to go.
      if (!requester) continue;


      const earnerMeta = this.meta(earner);
      // Only the routing fields go into the attachment. A socket attachment is
      // capped at 2 KB, and an order's context is routinely larger than that --
      // storing the whole job made serializeAttachment throw on real work and
      // tore down every socket on the DO, which surfaced to the requester as
      // "the relay closed the connection". The order itself is already on its
      // way to the earner and is never needed here again.
      this.setMeta(earner, {
        busy: true,
        job: {
          id: job.id,
          batch: job.batch,
          index: job.index,
          requester: job.requester,
          requesterName: job.requesterName || "someone",
        },
      });
      await this.state.storage.put(this.inFlightKey(job.id), job);
      this.send(earner, {
        type: "job",
        id: job.id,
        requester: job.requesterName || "someone",
        order: job.order,
      });
      this.send(requester, {
        type: "progress",
        job: job.id,
        index: job.index,
        state: "claimed",
        worker: earnerMeta.name,
      });
      await this.recordEvent({
        type: "claimed",
        jobId: job.id,
        objective: String(job.order?.objective ?? ""),
        requester: job.requesterName || "someone",
        worker: earnerMeta.name,
      });
    }
    if (this.queue.length !== before) await this.saveQueue();
  }

  async completeJob(ws, message) {
    const meta = this.meta(ws);
    const job = meta.job && meta.job.id === message.id ? meta.job : null;
    if (!job) {
      this.send(ws, {
        type: "error",
        error: "this earning session does not hold that job",
      });
      return;
    }
    this.setMeta(ws, { busy: false, job: null });
    // The socket attachment only carries routing fields; the order itself lives
    // in storage, so read it before deleting or the activity feed has nothing to
    // show but a blank line.
    const stored = await this.state.storage.get(this.inFlightKey(job.id));
    await this.state.storage.delete(this.inFlightKey(job.id));

    const requester = this.findByConnectionId(job.requester);
    if (requester) {
      this.send(requester, {
        type: "result",
        job: job.id,
        index: job.index,
        batch: job.batch,
        status: message.status || "completed",
        artifact: String(message.artifact ?? ""),
        files: Array.isArray(message.files) ? message.files : [],
        worker: meta.name,
      });
    }
    const artifact = String(message.artifact ?? "");
    await this.recordEvent({
      type: message.status === "failed" ? "failed" : "returned",
      jobId: job.id,
      objective: String(stored?.order?.objective ?? job.order?.objective ?? ""),
      requester: stored?.requesterName || job.requesterName || "someone",
      worker: meta.name,
      delivered: Boolean(requester),
      artifactChars: artifact.length,
      artifact: artifact.slice(0, ARTIFACT_PREVIEW_CHARS),
      files: (Array.isArray(message.files) ? message.files : []).map((f) =>
        typeof f === "string" ? f : f?.path || f?.name || "file",
      ),
    });

    // The visible earning task keeps this socket open while it works. Confirm
    // that the relay forwarded the artifact before it closes the task feed.
    this.send(ws, { type: "returned", id: job.id, delivered: Boolean(requester) });
    await this.drainQueue();
  }

  findByConnectionId(connectionId) {
    return this.socketsTagged(`id:${connectionId}`)[0] || null;
  }

  async webSocketClose(ws) {
    const meta = this.meta(ws);
    // A laptop closing mid-job is normal in a pool of friends, and the pool
    // usually still has idle machines. Hand the order to one of them instead of
    // failing it -- the requester is out of allowance and cannot redo it itself.
    // Only give up once an order has been dropped twice.
    const held = meta.job;
    if (held) {
      const stored = await this.state.storage.get(this.inFlightKey(held.id));
      await this.state.storage.delete(this.inFlightKey(held.id));
      const requester = this.findByConnectionId(held.requester);
      const attempts = ((stored && stored.attempts) || 0) + 1;

      if (requester && stored && attempts <= 2) {
        this.queue.unshift({ ...stored, attempts });
        await this.saveQueue();
        this.send(requester, {
          type: "progress",
          job: held.id,
          index: held.index,
          state: "requeued",
          worker: meta.name,
        });
      } else if (requester) {
        this.send(requester, {
          type: "result",
          job: held.id,
          index: held.index,
          batch: held.batch,
          status: "failed",
          artifact:
            `No worker completed this order: ${meta.name} disconnected` +
            (attempts > 2 ? ` and ${attempts - 1} earlier attempts also dropped.` : "."),
          worker: meta.name,
        });
      }
    }
    if (meta.role === "requester") {
      const before = this.queue.length;
      this.queue = this.queue.filter((job) => job.requester !== meta.connectionId);
      if (this.queue.length !== before) await this.saveQueue();
    }
    await this.drainQueue();
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws);
  }
}

const mcpApi = {
  async fetch(request, env, ctx) {
    const route = new URL(request.url).pathname;
    if (route !== "/mcp" && route !== "/mcp/") return new Response("Not found", { status: 404 });
    return createOverflowMcpHandler(env, route, (task) => ctx.waitUntil(task))(request, env, ctx);
  },
};

const BASE = "https://overflow.kushalsm.com";

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": mcpApi,
    "/mcp/": mcpApi,
  },
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["openid", "profile", "email", "overflow:connect"],
  allowPlainPKCE: false,
  resourceMetadata: {
    resource: `${BASE}/mcp`,
    authorization_servers: [BASE],
    scopes_supported: ["openid", "profile", "email", "overflow:connect"],
    bearer_methods_supported: ["header"],
    resource_name: "Overflow",
  },
  resourceMatchOriginOnly: true,
});
