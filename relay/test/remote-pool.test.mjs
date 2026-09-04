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

test("remote requester, worker, and result complete one durable round trip", async () => {
  const state = new MemoryState();
  const pool = new Pool(state, {});
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

  const returnResponse = await remote(pool, "/rpc/return", "worker-1", "Aparna", {
    jobId: claimed.id,
    artifact: "The sourced memo.",
    status: "completed",
    files: [{ name: "memo.md", url: "https://example.com/memo.md" }],
  });
  expect(returnResponse.status).toBe(200);

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
  expect(activity.queued).toBe(1);
  expect(activity.waiting[0].requester).toBe("Kushal");

  await remote(pool, "/rpc/claim", "worker-1", "Aparna", {});
  activity = await (await pool.fetch(new Request("https://overflow.internal/api/activity"))).json();
  expect(activity.queued).toBe(0);
  expect(activity.inFlight).toHaveLength(1);
  expect(activity.inFlight[0].worker).toBe("Aparna");
});
