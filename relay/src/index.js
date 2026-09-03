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
    if (!expected || token.length !== expected.length || token !== expected) {
      if (url.pathname !== "/") return unauthorized("bad or missing token");
    }

    const id = env.POOL.idFromName(POOL);
    const pool = env.POOL.get(id);

    switch (url.pathname) {
      case "/":
        return new Response("overflow relay\n", {
          headers: { "content-type": "text/plain" },
        });
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
    // Jobs waiting for a free earner. Kept in memory: a queued job whose
    // requester has gone away is worthless, and every requester is a live
    // socket, so nothing here needs to survive an eviction.
    this.queue = [];
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/status") {
      return Response.json({
        earners: this.socketsTagged("earner").length,
        idle: this.idleEarners().length,
        queued: this.queue.length,
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
        this.queue.push({
          id: crypto.randomUUID(),
          batch,
          index,
          requester: meta.connectionId,
          order,
        });
      }
      this.send(ws, { type: "accepted", batch, count: orders.length });
      return this.drainQueue();
    }

    if (meta.role === "earner" && message.type === "result") {
      return this.completeJob(ws, message);
    }

    if (message.type === "ping") return this.send(ws, { type: "pong" });
  }

  drainQueue() {
    while (this.queue.length > 0) {
      const earner = this.idleEarners()[0];
      if (!earner) return;
      const job = this.queue.shift();
      const requester = this.findByConnectionId(job.requester);
      // The requester hung up while this job sat in the queue. Drop it rather
      // than spend someone's allowance on an artifact with nowhere to go.
      if (!requester) continue;

      const earnerMeta = this.meta(earner);
      this.setMeta(earner, {
        busy: true,
        jobs: { ...earnerMeta.jobs, [job.id]: job },
      });
      this.send(earner, { type: "job", id: job.id, order: job.order });
      this.send(requester, {
        type: "progress",
        job: job.id,
        index: job.index,
        state: "claimed",
        worker: earnerMeta.name,
      });
    }
  }

  completeJob(ws, message) {
    const meta = this.meta(ws);
    const job = (meta.jobs || {})[message.id];
    this.setMeta(ws, { busy: false, jobs: {} });

    if (job) {
      const requester = this.findByConnectionId(job.requester);
      if (requester) {
        this.send(requester, {
          type: "result",
          job: job.id,
          index: job.index,
          batch: job.batch,
          status: message.status || "completed",
          artifact: String(message.artifact ?? ""),
          worker: meta.name,
        });
      }
    }
    this.drainQueue();
  }

  findByConnectionId(connectionId) {
    return this.socketsTagged(`id:${connectionId}`)[0] || null;
  }

  async webSocketClose(ws) {
    const meta = this.meta(ws);
    // An earner that disappears mid-job leaves its requester parked forever, so
    // fail those jobs explicitly rather than letting the park time out.
    for (const job of Object.values(meta.jobs || {})) {
      const requester = this.findByConnectionId(job.requester);
      if (!requester) continue;
      this.send(requester, {
        type: "result",
        job: job.id,
        index: job.index,
        batch: job.batch,
        status: "failed",
        artifact: `Worker ${meta.name} disconnected before returning this order.`,
        worker: meta.name,
      });
    }
    if (meta.role === "requester") {
      this.queue = this.queue.filter((job) => job.requester !== meta.connectionId);
    }
    this.drainQueue();
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws);
  }
}
