import { BOARD_HTML } from "./board.js";
import { BG_JPEG_BASE64 } from "./bg.js";

// Overflow relay: one Durable Object holding the job board.
//
// Two kinds of socket connect to it and neither side ever polls:
//   /earn      an idle Codex holds a socket open and is pushed jobs
//   /delegate  a session that is nearly out of allowance parks on a socket
//              until its artifacts come back
//
// Both are accepted through the hibernation API, so a laptop can sit in the
// pool for hours without the DO being billed for the wall-clock it spends
// waiting. Hibernation is why "no daemon, but stay available" is affordable.

const POOL = "global";
const ACTIVITY_LIMIT = 60;
const ARTIFACT_PREVIEW_CHARS = 1200;

function unauthorized(reason) {
  return new Response(JSON.stringify({ error: reason }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const expected = env.OVERFLOW_TOKEN || "";

    // One shared invite code separates friends from the internet. Constant work
    // either way so the comparison does not leak length by timing.
    // The board and the feed it reads are deliberately open: this pool is a
    // few friends and the point is being able to watch it work. Everything that
    // moves an order still needs the token.
    const publicPaths = new Set(["/", "/board", "/bg.jpg", "/api/activity"]);
    if (!expected || token.length !== expected.length || token !== expected) {
      if (!publicPaths.has(url.pathname)) return unauthorized("bad or missing token");
    }

    const id = env.POOL.idFromName(POOL);
    const pool = env.POOL.get(id);

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
      case "/earn":
      case "/delegate":
      case "/status":
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

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/activity") {
      const events = (await this.state.storage.get("events")) || [];
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
      const inFlight = [];
      for (const ws of this.socketsTagged("earner")) {
        const meta = this.meta(ws);
        if (meta.job) inFlight.push({ jobId: meta.job.id, worker: meta.name || "anon" });
      }
      return Response.json(
        {
          now: Date.now(),
          machines: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
          online: sockets.length,
          idle: sockets.filter((s) => !s.busy).length,
          queued: this.queue.length,
          waiting: this.queue.map((job) => ({
            jobId: job.id,
            objective: String(job.order?.objective ?? ""),
            attempts: job.attempts || 0,
          })),
          inFlight,
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
    const name = url.searchParams.get("name") || "anon";
    const connectionId = crypto.randomUUID();

    // Tags are the only state that survives hibernation, so identity and role
    // both have to live in them.
    this.state.acceptWebSocket(server, [role, `id:${connectionId}`]);
    server.serializeAttachment({ role, name, connectionId, busy: false, jobs: {} });

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
        this.queue.push({ id, batch, index, requester: meta.connectionId, order });
        await this.recordEvent({
          type: "queued",
          jobId: id,
          objective: String(order?.objective ?? ""),
          from: meta.name || "someone",
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
    let bestIndex = 0;
    let bestCount = Infinity;
    for (let i = 0; i < this.queue.length; i += 1) {
      const count = counts.get(this.queue[i].requester) || 0;
      if (count < bestCount) {
        bestCount = count;
        bestIndex = i;
        if (count === 0) break;
      }
    }
    return this.queue.splice(bestIndex, 1)[0];
  }

  async drainQueue() {
    const before = this.queue.length;
    while (this.queue.length > 0) {
      const earner = this.idleEarners()[0];
      if (!earner) break;
      const job = this.takeNextJob();
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
        },
      });
      await this.state.storage.put(this.inFlightKey(job.id), job);
      this.send(earner, { type: "job", id: job.id, order: job.order });
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
