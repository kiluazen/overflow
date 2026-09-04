import { expect, test } from "vitest";

import { Pool } from "../src/index.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key);
  }

  async put(key, value) {
    this.values.set(key, structuredClone(value));
  }

  async delete(key) {
    this.values.delete(key);
  }

  async list({ prefix }) {
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)));
  }
}

class MemoryState {
  constructor() {
    this.storage = new MemoryStorage();
    this.ready = Promise.resolve();
  }

  blockConcurrencyWhile(callback) {
    this.ready = callback();
    return this.ready;
  }

  getWebSockets() {
    return [];
  }
}

class MemoryBucket {
  constructor() {
    this.objects = new Map();
  }

  async put(key, body, options = {}) {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, {
      bytes,
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    });
  }

  async get(key) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      body: stored.bytes,
      size: stored.bytes.byteLength,
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
      writeHttpMetadata(headers) {
        if (stored.httpMetadata.contentType) {
          headers.set("content-type", stored.httpMetadata.contentType);
        }
      },
    };
  }
}

function actorRequest(path, userId, displayName, body) {
  return new Request(`https://overflow.internal${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-overflow-user-id": userId,
      "x-overflow-display-name": displayName,
      "x-overflow-email": `${userId}@example.com`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function remote(pool, path, userId, displayName, body) {
  const request = actorRequest(path, userId, displayName, body);
  return pool.handleRemote(request, new URL(request.url));
}

test("account initialization issues 1,000 credits exactly once", async () => {
  const state = new MemoryState();
  const pool = new Pool(state, {});
  await state.ready;
  const first = await (await remote(pool, "/rpc/account-init", "member-1", "Kushal", {})).json();
  const second = await (await remote(pool, "/rpc/account-init", "member-1", "Kushal", {})).json();
  expect(first.account).toMatchObject({ balance: 1000, reserved: 0, earned: 0, spent: 0 });
  expect(second.account).toMatchObject({ balance: 1000, reserved: 0, earned: 0, spent: 0 });
  const activity = await (await pool.fetch(new Request("https://overflow.internal/api/activity"))).json();
  expect(activity.totals.accounts).toBe(1);
  expect(activity.events.filter((event) => event.type === "joined")).toHaveLength(1);
});

test("remote requester, worker, and result complete one durable round trip", async () => {
  const state = new MemoryState();
  const pool = new Pool(state, { ARTIFACTS: new MemoryBucket() });
  await state.ready;

  const order = {
    objective: "Find the strongest current adoption evidence",
    context: "Use primary sources.",
    expectedArtifact: "A compact sourced memo",
    acceptanceTest: "Every material claim has a source",
  };
  const submittedResponse = await remote(pool, "/rpc/submit", "requester-1", "Kushal", { orders: [order] });
  expect(submittedResponse.status).toBe(200);
  const submitted = await submittedResponse.json();
  expect(submitted.batch).toMatch(/^[0-9a-f-]{36}$/);
  expect(submitted.jobs).toHaveLength(1);
  expect(submitted).toMatchObject({ creditsReserved: 100, balance: 900, reserved: 100 });

  // A legacy websocket worker cannot steal an OAuth-backed queued job.
  expect(pool.takeNextJob()).toBeNull();
  expect(pool.queue).toHaveLength(1);

  const claimResponse = await remote(pool, "/rpc/claim", "worker-1", "Aparna", {});
  expect(claimResponse.status).toBe(200);
  const claimed = await claimResponse.json();
  expect(claimed.id).toBe(submitted.jobs[0]);
  expect(claimed.workerName).toBe("Aparna");
  expect(claimed.order).toEqual(order);

  const wrongReturn = await remote(pool, "/rpc/return", "requester-1", "Kushal", {
    jobId: claimed.id,
    artifact: "Not the worker",
  });
  expect(wrongReturn.status).toBe(403);

  const uploadTicketResponse = await remote(pool, "/rpc/uploads", "worker-1", "Aparna", {
    jobId: claimed.id,
    name: "memo.md",
    contentType: "text/markdown",
  });
  expect(uploadTicketResponse.status).toBe(200);
  const uploadTicket = await uploadTicketResponse.json();
  expect(uploadTicket.artifactId).toMatch(/^[0-9a-f-]{36}$/);

  const fileBytes = new TextEncoder().encode("# The sourced memo\n\nEvidence.");
  const uploadUrl = new URL(uploadTicket.uploadUrl);
  const uploadResponse = await pool.fetch(new Request(`https://overflow.internal${uploadUrl.pathname}`, {
    method: "PUT",
    headers: {
      "content-length": String(fileBytes.byteLength),
      "content-type": "text/markdown",
    },
    body: fileBytes,
  }));
  expect(uploadResponse.status).toBe(201);
  expect((await pool.fetch(new Request(`https://overflow.internal${uploadUrl.pathname}`, {
    method: "PUT",
    headers: { "content-length": String(fileBytes.byteLength) },
    body: fileBytes,
  }))).status).toBe(404);

  const returnResponse = await remote(pool, "/rpc/return", "worker-1", "Aparna", {
    jobId: claimed.id,
    artifact: "The sourced memo.",
    status: "completed",
    files: [{ artifactId: uploadTicket.artifactId }],
  });
  expect(returnResponse.status).toBe(200);
  expect(await returnResponse.json()).toMatchObject({
    creditsEarned: 100,
    workerBalance: 1100,
    requesterBalance: 900,
    requesterReserved: 0,
  });

  const requesterAccount = await (await remote(pool, "/rpc/account", "requester-1", "Kushal")).json();
  expect(requesterAccount.account).toMatchObject({ balance: 900, reserved: 0, spent: 100 });
  const workerAccount = await (await remote(pool, "/rpc/account", "worker-1", "Aparna")).json();
  expect(workerAccount.account).toMatchObject({ balance: 1100, earned: 100, completed: 1 });
  const repeatedReturn = await remote(pool, "/rpc/return", "worker-1", "Aparna", {
    jobId: claimed.id,
    artifact: "The sourced memo.",
    status: "completed",
    files: [],
  });
  expect(await repeatedReturn.json()).toMatchObject({ alreadyStored: true, creditsEarned: 0, workerBalance: 1100 });
  const workerAfterRepeat = await (await remote(pool, "/rpc/account", "worker-1", "Aparna")).json();
  expect(workerAfterRepeat.account).toMatchObject({ balance: 1100, earned: 100, completed: 1 });

  // The requester lost the original tool call and its batch UUID. OAuth
  // identity alone must recover every result and its actual file bytes.
  const inboxResponse = await remote(pool, "/rpc/inbox", "requester-1", "Kushal");
  expect(inboxResponse.status).toBe(200);
  const inbox = await inboxResponse.json();
  expect(inbox.batches).toHaveLength(1);
  expect(inbox.batches[0].batch).toBe(submitted.batch);
  expect(inbox.batches[0].jobs[0].result.files[0]).toMatchObject({
    name: "memo.md",
    contentType: "text/markdown",
    size: fileBytes.byteLength,
  });
  expect(inbox.batches[0].jobs[0].result.files[0].url).toMatch(
    /^https:\/\/overflow\.kushalsm\.com\/api\/artifacts\//,
  );

  const secondInbox = await (await remote(pool, "/rpc/inbox", "requester-1", "Kushal")).json();
  expect(secondInbox.batches[0].jobs[0].result.files[0].url).toBe(
    inbox.batches[0].jobs[0].result.files[0].url,
  );

  const downloadUrl = new URL(inbox.batches[0].jobs[0].result.files[0].url);
  const downloadResponse = await pool.fetch(new Request(`https://overflow.internal${downloadUrl.pathname}`));
  expect(downloadResponse.status).toBe(200);
  expect(new Uint8Array(await downloadResponse.arrayBuffer())).toEqual(fileBytes);
  expect(downloadResponse.headers.get("content-disposition")).toContain('filename="memo.md"');

  const strangerInboxResponse = await remote(pool, "/rpc/inbox", "stranger-1", "Stranger");
  expect(strangerInboxResponse.status).toBe(200);
  expect((await strangerInboxResponse.json()).batches).toEqual([]);

  const resultResponse = await remote(
    pool,
    `/rpc/results?batch=${encodeURIComponent(submitted.batch)}`,
    "requester-1",
    "Kushal",
  );
  expect(resultResponse.status).toBe(200);
  const result = await resultResponse.json();
  expect(result.complete).toBe(true);
  expect(result.jobs[0].result.artifact).toBe("The sourced memo.");
  expect(result.jobs[0].workerName).toBe("Aparna");
  expect(result.jobs[0].result.files[0].url).toMatch(
    /^https:\/\/overflow\.kushalsm\.com\/api\/artifacts\//,
  );

  const strangerResult = await remote(
    pool,
    `/rpc/results?batch=${encodeURIComponent(submitted.batch)}`,
    "stranger-1",
    "Stranger",
  );
  expect(strangerResult.status).toBe(403);
});

test("public activity includes OAuth-backed queued and claimed work", async () => {
  const state = new MemoryState();
  const pool = new Pool(state, {});
  await state.ready;

  const order = {
    objective: "Produce a deck",
    context: "Nine slides.",
    expectedArtifact: "PPTX",
    acceptanceTest: "Opens and cites sources",
  };
  await remote(pool, "/rpc/submit", "requester-1", "Kushal", { orders: [order] });
  let activity = await (await pool.fetch(new Request("https://overflow.internal/api/activity"))).json();
  expect(activity.totals).toMatchObject({ accounts: 1, jobs: 1, queued: 1, claimed: 0 });
  expect(activity.credits).toMatchObject({ starting: 1000, perOrder: 100, available: 900, reserved: 100 });
  expect(activity.jobs[0]).toMatchObject({ requester: "Kushal", status: "queued", credits: 100 });

  await remote(pool, "/rpc/claim", "worker-1", "Aparna", {});
  activity = await (await pool.fetch(new Request("https://overflow.internal/api/activity"))).json();
  expect(activity.totals).toMatchObject({ accounts: 2, queued: 0, claimed: 1 });
  expect(activity.jobs[0]).toMatchObject({ status: "claimed", worker: "Aparna" });
  expect(activity.accounts.map((account) => account.name).sort()).toEqual(["Aparna", "Kushal"]);
  expect(JSON.stringify(activity)).not.toContain("@example.com");
  expect(JSON.stringify(activity)).not.toContain("requester-1");
  expect(JSON.stringify(activity)).not.toContain("worker-1");
});

test("failed work refunds the requester and does not pay the worker", async () => {
  const state = new MemoryState();
  const pool = new Pool(state, {});
  await state.ready;
  const order = {
    objective: "Attempt bounded work",
    context: "",
    expectedArtifact: "A result",
    acceptanceTest: "Return an explicit outcome",
  };
  await remote(pool, "/rpc/submit", "requester-1", "Kushal", { orders: [order] });
  const claimed = await (await remote(pool, "/rpc/claim", "worker-1", "Aparna", {})).json();
  const failed = await remote(pool, "/rpc/return", "worker-1", "Aparna", {
    jobId: claimed.id,
    artifact: "Required input was unavailable.",
    status: "failed",
    files: [],
  });
  expect(await failed.json()).toMatchObject({ creditsEarned: 0, requesterBalance: 1000, requesterReserved: 0 });
  const requester = await (await remote(pool, "/rpc/account", "requester-1", "Kushal")).json();
  expect(requester.account).toMatchObject({ balance: 1000, reserved: 0, spent: 0 });
  const worker = await (await remote(pool, "/rpc/account", "worker-1", "Aparna")).json();
  expect(worker.account).toMatchObject({ balance: 1000, earned: 0, completed: 0 });
});

test("delegation cannot reserve more credits than the requester owns", async () => {
  const state = new MemoryState();
  const pool = new Pool(state, {});
  await state.ready;
  const order = {
    objective: "One bounded task",
    context: "",
    expectedArtifact: "A result",
    acceptanceTest: "Done",
  };
  expect((await remote(pool, "/rpc/submit", "requester-1", "Kushal", { orders: Array(8).fill(order) })).status).toBe(200);
  expect((await remote(pool, "/rpc/submit", "requester-1", "Kushal", { orders: Array(2).fill(order) })).status).toBe(200);
  const overdraw = await remote(pool, "/rpc/submit", "requester-1", "Kushal", { orders: [order] });
  expect(overdraw.status).toBe(402);
  expect((await overdraw.json()).error).toContain("not enough credits");
});

test("public activity never exposes private artifact URLs", async () => {
  const state = new MemoryState();
  const pool = new Pool(state, { ARTIFACTS: new MemoryBucket() });
  await state.ready;

  const order = {
    objective: "Produce a deck",
    context: "Nine slides.",
    expectedArtifact: "PPTX",
    acceptanceTest: "Opens and cites sources",
  };
  const submitted = await (await remote(
    pool,
    "/rpc/submit",
    "requester-1",
    "Kushal",
    { orders: [order] },
  )).json();
  const claimed = await (await remote(pool, "/rpc/claim", "worker-1", "Aparna", {})).json();
  const ticket = await (await remote(pool, "/rpc/uploads", "worker-1", "Aparna", {
    jobId: claimed.id,
    name: "deck.pptx",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  })).json();
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const uploadPath = new URL(ticket.uploadUrl).pathname;
  expect((await pool.fetch(new Request(`https://overflow.internal${uploadPath}`, {
    method: "PUT",
    headers: { "content-length": String(bytes.byteLength) },
    body: bytes,
  }))).status).toBe(201);
  expect((await remote(pool, "/rpc/return", "worker-1", "Aparna", {
    jobId: claimed.id,
    artifact: "Deck complete.",
    files: [{ artifactId: ticket.artifactId }],
  })).status).toBe(200);

  const activity = await (await pool.fetch(new Request("https://overflow.internal/api/activity"))).json();
  const returned = activity.events.find((event) => event.jobId === submitted.jobs[0] && event.type === "returned");
  expect(returned.files).toEqual(["deck.pptx"]);
  expect(JSON.stringify(activity)).not.toContain("/api/artifacts/");
  expect(JSON.stringify(activity)).not.toContain("remote-artifacts/");
});

test("legacy local file paths are reported as unavailable instead of linked", async () => {
  const state = new MemoryState();
  const pool = new Pool(state, { ARTIFACTS: new MemoryBucket() });
  await state.ready;

  await state.storage.put("remote-job:legacy", {
    id: "legacy",
    batch: "legacy-batch",
    index: 0,
    requesterUserId: "requester-1",
    requesterName: "Kushal",
    workerName: "Old worker",
    status: "completed",
    createdAt: 1,
    order: { objective: "Return a deck", expectedArtifact: "PPTX" },
    result: {
      artifact: "Deck complete.",
      files: [{ name: "deck.pptx", url: "file:///Users/worker/deck.pptx" }],
    },
  });
  await state.storage.put("remote-batch:legacy-batch", ["legacy"]);

  const inbox = await (await remote(pool, "/rpc/inbox", "requester-1", "Kushal")).json();
  expect(inbox.batches[0].jobs[0].result.files[0]).toMatchObject({
    name: "deck.pptx",
    unavailable: true,
  });
  expect(inbox.batches[0].jobs[0].result.files[0].url).toBeUndefined();
});
