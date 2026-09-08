import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { BOARD_HTML } from "./board.js";
import { legalResponse } from "./legal.js";
import { compareJobs } from "./board-model.js";
import { BG_JPEG_BASE64 } from "./bg.js";
import { SHORELINE_JPEG_BASE64 } from "./shoreline.js";
import { HOOKS_PNG_BASE64 } from "./hooks-screenshot.js";
import { acceptDashboardHandoff, browserHeartbeat } from "./browser-presence.js";
import { InputAttachments, InputError } from "./input-attachments.js";
import { createOverflowMcpHandler } from "./mcp.js";
import {
  handleAuthorize,
  handleGoogleCallback,
  handleGoogleStart,
  handleComplete,
  handleProtectedResource,
  profilePicture,
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
const STARTING_CREDITS = 10_000;
const PLUGIN_ACTIVE_MS = 2 * 60 * 1000;
const BROWSER_ACTIVE_MS = 90 * 1000;
const ORDER_CREDITS = 100;
// A claimed job cannot disappear forever with a friend's closed laptop. The
// worker gets long enough for a substantial Codex task, then the order is
// offered to somebody else. Two abandoned claims end the order and release
// the requester's held credits.
const REMOTE_CLAIM_TTL_MS = 90 * 60 * 1000;
const MAX_REMOTE_CLAIM_ATTEMPTS = 2;
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#f5f5ef"/><path d="M10 23c9-11 15 11 22 0s13 11 22 0M10 39c9-11 15 11 22 0s13 11 22 0" fill="none" stroke="#376451" stroke-width="5" stroke-linecap="round"/></svg>`;

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

export const defaultHandler = {
  async fetch(request, env) {
    const legal = legalResponse(request);
    if (legal) return legal;
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
    if (url.pathname === "/auth/complete") return handleComplete(request, env);
    if (url.pathname.startsWith("/presence/connect/")) return acceptDashboardHandoff(request, env);
    if (url.pathname === "/api/presence") return browserHeartbeat(request, env);
    if (url.pathname === "/auth/dashboard/start") return Response.redirect(`${url.origin}/`, 302);
    if (url.pathname === "/api/account" || url.pathname === "/auth/dashboard/logout") return new Response("Not found", { status: 404 });

    // The board and its activity feed are public so friends can watch the
    // experiment. Every route that moves an order requires either the old
    // dogfood invite code or an OAuth bearer handled by the MCP provider.
    const publicPaths = new Set(["/", "/board", "/favicon.svg", "/bg.jpg", "/shoreline-v2.jpg", "/setup-hooks-v1.png", "/api/activity"]);
    const capabilityPath = url.pathname.startsWith("/api/uploads/") ||
      url.pathname.startsWith("/api/artifacts/") || url.pathname.startsWith("/api/input-uploads/") ||
      url.pathname.startsWith("/api/input-files/");
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
      case "/favicon.svg":
        return new Response(FAVICON_SVG, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
      case "/bg.jpg":
      case "/shoreline-v2.jpg":
      case "/setup-hooks-v1.png": {
        const binary = atob(url.pathname === "/setup-hooks-v1.png" ? HOOKS_PNG_BASE64 : url.pathname === "/bg.jpg" ? BG_JPEG_BASE64 : SHORELINE_JPEG_BASE64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return new Response(bytes, {
          headers: {
            "content-type": url.pathname.endsWith(".png") ? "image/png" : "image/jpeg",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }
      case "/api/activity":
      case "/api/reset":
      case "/api/jobs/delete":
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
    // Durable Objects are single-location, but async request handlers can still
    // overlap. Serialize account/job transitions so two claims or duplicate
    // returns cannot observe the same pre-mutation state.
    this.remoteLock = Promise.resolve();
    this.inputs = new InputAttachments(this);
    this.state.blockConcurrencyWhile(async () => {
      this.queue = (await this.state.storage.get("queue")) || [];
      for (const account of await this.accounts()) await this.migrateAccount(account);
    });
  }

  async withRemoteLock(action) {
    const prior = this.remoteLock;
    let release;
    this.remoteLock = new Promise((resolve) => { release = resolve; });
    await prior;
    try {
      return await action();
    } finally {
      release();
    }
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
    const displayName = request.headers.get("x-overflow-display-name") || "";
    return {
      userId: request.headers.get("x-overflow-user-id") || "",
      displayName: (() => { try { return decodeURIComponent(displayName); } catch { return displayName; } })(),
      email: request.headers.get("x-overflow-email") || "",
      picture: profilePicture(request.headers.get("x-overflow-picture") || ""),
    };
  }

  async migrateAccount(account) {
    if (account.startingGrant === STARTING_CREDITS && account.publicId) return account;
    account.balance = Number(account.balance || 0) + Math.max(0, STARTING_CREDITS - Number(account.startingGrant || 1000));
    account.startingGrant = STARTING_CREDITS;
    account.publicId ||= crypto.randomUUID();
    await this.saveAccount(account);
    return account;
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
      startingGrant: STARTING_CREDITS,
      publicId: crypto.randomUUID(),
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
    if (actor.picture) account.picture = actor.picture;
    await this.migrateAccount(account);
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
      refunded: Number(account.refunded || 0),
      delegated: Number(account.delegated || 0),
      completed: Number(account.completed || 0),
      createdAt: Number(account.createdAt || 0),
    };
  }

  async recordPresence(userId, browser) {
    const key = `presence:${userId}`;
    const value = await this.state.storage.get(key) || { pluginAt: 0, browserAt: 0, pages: {} };
    const now = Date.now();
    value.pages = Object.fromEntries(Object.entries(value.pages || {})
      .filter(([, at]) => at > now - BROWSER_ACTIVE_MS).sort((a, b) => b[1] - a[1]).slice(0, 20));
    if (browser) {
      if (browser.visible) { value.pages[browser.sessionId] = now; value.browserAt = now; }
      else delete value.pages[browser.sessionId];
    } else value.pluginAt = now;
    await this.state.storage.put(key, value);
  }

  async publicMember(account, now = Date.now()) {
    const presence = await this.state.storage.get(`presence:${account.userId}`) || {};
    const pluginAt = Number(presence.pluginAt || presence.codexAt || 0);
    const pluginActive = pluginAt > now - PLUGIN_ACTIVE_MS;
    const browserActive = Object.values(presence.pages || {}).some((at) => at > now - BROWSER_ACTIVE_MS);
    return {
      id: account.publicId, name: account.displayName || "someone", picture: profilePicture(account.picture),
      balance: Number(account.balance || 0),
      lastActiveAt: Math.floor(Math.max(pluginAt, Number(presence.browserAt || 0)) / 1000) * 1000,
      activeSource: pluginActive ? "plugin" : browserActive ? "browser" : null,
      activeUntil: pluginActive ? pluginAt + PLUGIN_ACTIVE_MS
        : browserActive ? Math.max(...Object.values(presence.pages)) + BROWSER_ACTIVE_MS : 0,
    };
  }

  publicJob(job, accountById = new Map()) {
    return {
      id: job.id,
      batch: job.batch,
      status: job.status,
      objective: String(job.order?.objective || ""),
      expectedArtifact: String(job.order?.expectedArtifact || ""),
      requester: job.requesterName || "someone",
      worker: job.workerName || "",
      requesterMemberId: accountById.get(job.requesterUserId)?.publicId || "",
      workerMemberId: accountById.get(job.workerUserId)?.publicId || "",
      credits: Number(job.creditCost || 0),
      createdAt: Number(job.createdAt || 0),
      claimedAt: Number(job.claimedAt || 0),
      leaseExpiresAt: Number(job.leaseExpiresAt || 0),
      attempts: Number(job.attempts || 0),
      completedAt: Number(job.completedAt || 0),
      artifactChars: String(job.result?.artifact || "").length,
      files: (job.result?.files || []).map((file) => safeFileName(file?.name)),
      inputCount: (job.order?.inputArtifactIds || []).length,
    };
  }

  publicEvent(event) {
    // Explicit allowlist: private result data and account identifiers never
    // belong on the public board. Public credit balances come from members.
    const fields = ["at", "type", "jobId", "objective", "requester", "worker", "member",
      "attempts", "leaseExpiresAt", "artifactChars", "files"];
    return Object.fromEntries(fields.filter((key) => key in event)
      .map((key) => [key, key === "files" ? (event.files || []).map((file) => safeFileName(typeof file === "string" ? file : file.name)) : event[key]]));
  }

  async remoteJobs() {
    const entries = await this.state.storage.list({ prefix: "remote-job:" });
    return [...entries.values()];
  }

  async scheduleNextRemoteLease(jobs) {
    if (typeof this.state.storage.setAlarm !== "function") return;
    const active = (jobs || await this.remoteJobs())
      .filter((job) => job.status === "claimed")
      .map((job) => Number(job.leaseExpiresAt || (Number(job.claimedAt || 0) + REMOTE_CLAIM_TTL_MS)))
      .filter((at) => at > 0)
      .concat(await this.inputs.deadlines(), [...(await this.state.storage.list({ prefix: "once:" })).values()].map((value) => value.expiresAt))
      .filter((at) => Number.isFinite(at) && at > 0)
      .sort((left, right) => left - right);
    if (active.length) {
      await this.state.storage.setAlarm(active[0]);
    } else if (typeof this.state.storage.deleteAlarm === "function") {
      await this.state.storage.deleteAlarm();
    }
  }

  async refundRemoteJob(job) {
    const creditCost = Number(job.creditCost || 0);
    const requester = await this.ensureAccount({
      userId: job.requesterUserId,
      displayName: job.requesterName,
      email: job.requesterEmail,
    });
    requester.reserved = Math.max(0, Number(requester.reserved || 0) - creditCost);
    requester.balance = Number(requester.balance || 0) + creditCost;
    requester.refunded = Number(requester.refunded || 0) + creditCost;
    await this.saveAccount(requester);
    return requester;
  }

  async reconcileRemoteClaims(now = Date.now()) {
    const jobs = await this.remoteJobs();
    const expired = jobs.filter((job) => {
      if (job.status !== "claimed") return false;
      const expiresAt = Number(job.leaseExpiresAt || (Number(job.claimedAt || 0) + REMOTE_CLAIM_TTL_MS));
      return expiresAt > 0 && expiresAt <= now;
    });

    if (!expired.length) {
      await this.scheduleNextRemoteLease(jobs);
      return { requeued: 0, failed: 0 };
    }

    let requeued = 0;
    let failed = 0;
    for (const job of expired) {
      // Remove a stale copy before either requeueing or closing the job.
      this.queue = this.queue.filter((queued) => queued.id !== job.id);
      const attempts = Math.max(1, Number(job.attempts || 1));
      if (attempts >= MAX_REMOTE_CLAIM_ATTEMPTS) {
        await this.refundRemoteJob(job);
        const closed = {
          ...job,
          status: "failed",
          completedAt: now,
          leaseExpiresAt: undefined,
          result: {
            artifact: `Overflow closed this order after ${attempts} workers claimed it without returning a result.`,
            files: [],
          },
        };
        await this.state.storage.put(this.remoteJobKey(job.id), closed);
        await this.recordEvent({
          type: "expired",
          jobId: job.id,
          objective: String(job.order?.objective || ""),
          requester: job.requesterName,
          worker: job.workerName,
          credits: Number(job.creditCost || 0),
          creditState: "refunded",
        });
        failed += 1;
        continue;
      }

      const queued = {
        ...job,
        status: "queued",
        workerUserId: undefined,
        workerName: undefined,
        workerEmail: undefined,
        claimedAt: undefined,
        leaseExpiresAt: undefined,
        lastExpiredAt: now,
      };
      await this.state.storage.put(this.remoteJobKey(job.id), queued);
      this.queue.push(queued);
      await this.recordEvent({
        type: "requeued",
        jobId: job.id,
        objective: String(job.order?.objective || ""),
        requester: job.requesterName,
        worker: job.workerName,
        credits: Number(job.creditCost || 0),
        creditState: "reserved",
      });
      requeued += 1;
    }
    await this.saveQueue();
    await this.scheduleNextRemoteLease();
    return { requeued, failed };
  }

  async alarm() {
    await this.withRemoteLock(async () => {
      await this.reconcileRemoteClaims();
      await this.inputs.cleanup();
      await this.cleanupExpiredCapabilities();
      await this.scheduleNextRemoteLease();
    });
  }

  async cleanupExpiredCapabilities() {
    const now = Date.now();
    for (const prefix of ["upload:", "download:", "once:"]) {
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
    try { return await this.withRemoteLock(() => this.handleRemoteUnlocked(request, url)); }
    catch (error) {
      if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }

  async handleRemoteUnlocked(request, url) {
    const actor = this.actor(request);
    if (!actor.userId) return Response.json({ error: "missing authenticated actor" }, { status: 401 });
    if (url.pathname === "/rpc/consume-once") {
      const body = await request.json();
      if (!["oauth", "presence"].includes(body.namespace) || !/^[a-f0-9-]{36,64}$/.test(body.id || "") ||
          !(body.expiresAt > Date.now() && body.expiresAt <= Date.now() + 11 * 60 * 1000)) {
        return Response.json({ error: "invalid handoff" }, { status: 400 });
      }
      const key = `once:${body.namespace}:${body.id}`;
      if (await this.state.storage.get(key)) return Response.json({ error: "already used" }, { status: 409 });
      await this.state.storage.put(key, { expiresAt: body.expiresAt });
      await this.scheduleNextRemoteLease();
      return Response.json({ consumed: true });
    }
    if (url.pathname === "/rpc/browser-presence") {
      if (!await this.state.storage.get(this.accountKey(actor.userId))) return new Response(null, { status: 404 });
      const body = await request.json();
      if (typeof body.visible !== "boolean" || !/^[a-f0-9:.-]{1,120}$/.test(body.sessionId || "")) {
        return Response.json({ error: "invalid presence event" }, { status: 400 });
      }
      await this.recordPresence(actor.userId, body);
      return new Response(null, { status: 204 });
    }
    await this.reconcileRemoteClaims();
    const actorAccount = await this.ensureAccount(actor);
    if (["plugin", "codex"].includes(request.headers.get("x-overflow-presence")) || url.pathname === "/rpc/presence") {
      await this.recordPresence(actor.userId);
    }

    if (url.pathname === "/rpc/presence") return Response.json({ recorded: true });

    if (url.pathname === "/rpc/input-uploads") return Response.json(await this.inputs.prepare(actor, await request.json()));
    if (url.pathname === "/rpc/inputs") {
      const job = await this.state.storage.get(this.remoteJobKey(url.searchParams.get("jobId") || ""));
      if (!job) return Response.json({ error: "unknown job" }, { status: 404 });
      return Response.json({ jobId: job.id, files: await this.inputs.manifest(job, actor.userId) });
    }

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
      const inputGroups = await this.inputs.validateOrders(orders, actor);
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
        await this.inputs.attach(inputGroups[index], id);
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
      await this.scheduleNextRemoteLease();
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
        leaseExpiresAt: Date.now() + REMOTE_CLAIM_TTL_MS,
        attempts: Number(job.attempts || 0) + 1,
      };
      await this.saveQueue();
      await this.state.storage.put(this.remoteJobKey(job.id), claimed);
      await this.scheduleNextRemoteLease();
      await this.recordEvent({
        type: "claimed",
        jobId: job.id,
        objective: String(job.order?.objective || ""),
        requester: job.requesterName,
        worker: actor.displayName,
        credits: Number(job.creditCost || 0),
        creditState: "reserved",
      });
      return Response.json({ ...claimed, inputs: await this.inputs.manifest(claimed, actor.userId) });
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
      await this.scheduleNextRemoteLease();
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
    if (url.pathname.startsWith("/api/input-uploads/") || url.pathname.startsWith("/api/input-files/")) {
      try {
        return await (url.pathname.startsWith("/api/input-uploads/") ? this.inputs.upload(request) : this.inputs.download(request));
      } catch (error) {
        if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.status });
        throw error;
      }
    }

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

    if (url.pathname === "/api/jobs/delete") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const ids = [...new Set((await request.json().catch(() => ({}))).ids || [])]
        .filter((id) => /^[a-f0-9-]{36}$/.test(id));
      if (!ids.length || ids.length > 100) return Response.json({ error: "provide 1 to 100 job ids" }, { status: 400 });
      const jobs = await Promise.all(ids.map((id) => this.state.storage.get(this.remoteJobKey(id))));
      if (jobs.some((job) => job && !["completed", "failed"].includes(job.status))) {
        return Response.json({ error: "only finished jobs can be deleted" }, { status: 409 });
      }
      const deleted = ids.filter((id, index) => Boolean(jobs[index]));
      await Promise.all(deleted.map((id) => this.state.storage.delete(this.remoteJobKey(id))));
      const deletedSet = new Set(deleted);
      const events = (await this.state.storage.get("events")) || [];
      await this.state.storage.put("events", events.filter((event) => !deletedSet.has(event.jobId)));
      return Response.json({ deleted });
    }

    if (url.pathname === "/api/activity") {
      await this.withRemoteLock(() => this.reconcileRemoteClaims());
      const events = (await this.state.storage.get("events")) || [];
      const remoteJobs = (await this.remoteJobs())
        .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
      // OAuth account initialization used to be best-effort after the grant was
      // issued. Rebuild any missing member from authenticated job history so a
      // transient callback failure cannot erase a real participant from Credits.
      const knownAccounts = new Map((await this.accounts()).map((account) => [account.userId, account]));
      for (const job of remoteJobs) {
        for (const actor of [
          { userId: job.requesterUserId, displayName: job.requesterName, email: job.requesterEmail },
          { userId: job.workerUserId, displayName: job.workerName, email: job.workerEmail },
        ]) {
          if (actor.userId?.startsWith("google-") && !knownAccounts.has(actor.userId)) {
            knownAccounts.set(actor.userId, await this.ensureAccount(actor));
          }
        }
      }
      const accounts = [...knownAccounts.values()]
        .sort((left, right) => String(left.displayName || "").localeCompare(String(right.displayName || "")));
      const accountById = new Map(accounts.map((account) => [account.userId, account]));
      const now = Date.now();
      const members = await Promise.all(accounts.map((account) => this.publicMember(account, now)));
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
      return Response.json(
        {
          now,
          totals: {
            accounts: accounts.length,
            jobs: visibleJobs.length,
            queued,
            claimed,
            completed,
            failed,
          },
          members,
          jobs: visibleJobs.sort(compareJobs).slice(0, 100).map((job) => this.publicJob(job, accountById)),
          machines: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
          online: sockets.length,
          idle: sockets.filter((s) => !s.busy).length,
          events: events.map((event) => this.publicEvent(event)),
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
