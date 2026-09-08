const BASE = "https://overflow.kushalsm.com";
const UPLOAD_MS = 15 * 60 * 1000;
const DOWNLOAD_MS = 60 * 60 * 1000;
const ORPHAN_MS = 24 * 60 * 60 * 1000;
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_ORDER_INPUT_BYTES = 200 * 1024 * 1024;
export const MAX_INPUT_FILES = 10;

export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function fileName(value) {
  return String(value || "input").replace(/[\x00-\x1f\x7f"\\/]/g, "_").trim().slice(0, 255) || "input";
}

export class InputAttachments {
  constructor(pool) { this.pool = pool; this.storage = pool.state.storage; this.uploadLock = Promise.resolve(); }
  key(id) { return `input:${id}`; }

  async prepare(actor, body) {
    if (!this.pool.env.ARTIFACTS) throw new InputError("input storage is unavailable", 503);
    const size = Number(body.size);
    const sha256 = String(body.sha256 || "").toLowerCase();
    const contentType = String(body.contentType || "application/octet-stream");
    if (!Number.isInteger(size) || size < 1 || size > MAX_INPUT_BYTES) throw new InputError("input files must be between 1 byte and 50 MiB", 413);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new InputError("supply the file's SHA-256 checksum");
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(contentType)) throw new InputError("invalid content type");
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 255) throw new InputError("supply a filename of at most 255 characters");
    const artifactId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const name = fileName(body.name);
    const createdAt = Date.now();
    await this.storage.put(this.key(artifactId), {
      artifactId, ownerUserId: actor.userId, originalName: body.name, name, size, sha256, contentType,
      objectKey: `inputs/${artifactId}/${name}`, createdAt,
    });
    await this.storage.put(`input-upload:${token}`, { artifactId, expiresAt: createdAt + UPLOAD_MS });
    await this.pool.scheduleNextRemoteLease();
    return { artifactId, name, size, sha256, uploadUrl: `${BASE}/api/input-uploads/${token}`, expiresInSeconds: UPLOAD_MS / 1000 };
  }

  async upload(request) {
    // Serialize streams, not the pool: a large upload must not hold up claims
    // or the board, and parallel attachments must not consume the DO heap.
    const previous = this.uploadLock;
    let release;
    this.uploadLock = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await this.uploadUnlocked(request); } finally { release(); }
  }

  async uploadUnlocked(request) {
    if (request.method !== "PUT") throw new InputError("Method not allowed", 405);
    const token = new URL(request.url).pathname.split("/").pop();
    const key = `input-upload:${token}`;
    const ticket = await this.storage.get(key);
    if (!ticket) throw new InputError("unknown input upload", 404);
    if (ticket.expiresAt <= Date.now()) throw new InputError("input upload expired", 410);
    const file = await this.storage.get(this.key(ticket.artifactId));
    if (!file || file.uploadedAt) throw new InputError("input upload already used", 409);
    const length = request.headers.get("content-length");
    if (length !== null && Number(length) !== file.size) throw new InputError("input size does not match the upload", 413);
    if (!request.body) throw new InputError("input file is empty", 413);
    const stream = new FixedLengthStream(file.size);
    const abort = new AbortController();
    let received = 0;
    const checked = new TransformStream({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > file.size) throw new InputError("input size exceeds the declared bytes", 422);
        controller.enqueue(chunk);
      },
      flush() {
        if (received !== file.size) throw new InputError("input size is shorter than the declared bytes", 422);
      },
    });
    const transfer = request.body.pipeThrough(checked).pipeTo(stream.writable, { signal: abort.signal });
    // R2 verifies the SHA-256 while receiving the stream. No whole-file buffer
    // or model token payload is needed, even for the 50 MiB limit.
    const stored = this.pool.env.ARTIFACTS.put(file.objectKey, stream.readable, {
      sha256: file.sha256, httpMetadata: { contentType: file.contentType },
    }).catch((error) => { abort.abort(error); throw error; });
    try { await Promise.all([transfer, stored]); }
    catch (error) {
      abort.abort(error);
      await Promise.allSettled([transfer, stored]);
      await this.pool.env.ARTIFACTS.delete(file.objectKey);
      const invalid = /checksum|digest|length|bytes|size/i.test(String(error));
      throw new InputError(invalid ? "input size or checksum does not match" : "input could not be stored; try the upload again", invalid ? 422 : 503);
    }
    return this.pool.withRemoteLock(async () => {
      const current = await this.storage.get(key);
      if (!current || current.expiresAt <= Date.now()) {
        await this.pool.env.ARTIFACTS.delete(file.objectKey);
        throw new InputError("input upload expired or already used", 410);
      }
      await this.storage.put(this.key(file.artifactId), { ...file, uploadedAt: Date.now() });
      await this.storage.delete(key);
      await this.pool.scheduleNextRemoteLease();
      return Response.json({ uploaded: true, artifactId: file.artifactId, size: file.size, sha256: file.sha256 }, { status: 201 });
    });
  }

  async validateOrders(orders, actor) {
    const seen = new Set();
    const groups = [];
    for (const order of orders) {
      const ids = order.inputArtifactIds || [];
      if (!Array.isArray(ids) || ids.length > MAX_INPUT_FILES) throw new InputError("at most 10 input files per order");
      const files = [];
      let size = 0;
      for (const id of ids) {
        if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id) || seen.has(id)) throw new InputError("input files must be unique within a delegation");
        seen.add(id);
        const file = await this.storage.get(this.key(id));
        if (!file || file.ownerUserId !== actor.userId) throw new InputError("input file does not belong to this requester", 403);
        if (!file.uploadedAt) throw new InputError("finish uploading every input before delegating", 409);
        if (file.jobId) throw new InputError("input file is already attached to an order; upload it again for new work", 409);
        if (file.uploadedAt + ORPHAN_MS <= Date.now()) throw new InputError("unattached input expired; upload it again", 410);
        size += file.size;
        if (size > MAX_ORDER_INPUT_BYTES) throw new InputError("an order can contain at most 200 MiB of input files", 413);
        files.push(file);
      }
      groups.push(files);
    }
    return groups;
  }

  async attach(files, jobId) {
    for (const file of files) await this.storage.put(this.key(file.artifactId), { ...file, jobId });
  }

  async manifest(job, actorUserId) {
    const requester = job.requesterUserId === actorUserId;
    if (!requester && !(job.workerUserId === actorUserId && job.status === "claimed" && job.leaseExpiresAt > Date.now())) {
      throw new InputError("only the requester or current claiming worker can retrieve inputs", 403);
    }
    const files = [];
    for (const id of job.order?.inputArtifactIds || []) {
      const file = await this.storage.get(this.key(id));
      if (!file || file.jobId !== job.id || !file.uploadedAt) throw new InputError("an input file is no longer available", 410);
      if (["completed", "failed"].includes(job.status) && job.completedAt + RETAIN_MS <= Date.now()) {
        throw new InputError("input retention period ended", 410);
      }
      const token = crypto.randomUUID();
      const expiresAt = Math.min(Date.now() + DOWNLOAD_MS, requester ? Infinity : job.leaseExpiresAt,
        ["completed", "failed"].includes(job.status) ? job.completedAt + RETAIN_MS : Infinity);
      await this.storage.put(`input-download:${token}`, {
        artifactId: id, jobId: job.id, actorUserId, requester, attempt: Number(job.attempts || 0), expiresAt,
      });
      files.push({ artifactId: id, name: file.name, originalName: file.originalName,
        size: file.size, contentType: file.contentType, sha256: file.sha256,
        url: `${BASE}/api/input-files/${token}`, expiresInSeconds: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) });
    }
    if (files.length) await this.pool.scheduleNextRemoteLease();
    return files;
  }

  async download(request) {
    if (request.method !== "GET") throw new InputError("Method not allowed", 405);
    const token = new URL(request.url).pathname.split("/").pop();
    const grant = await this.storage.get(`input-download:${token}`);
    if (!grant) throw new InputError("unknown input download", 404);
    if (grant.expiresAt <= Date.now()) throw new InputError("input link expired; refresh the job inputs", 410);
    const job = await this.storage.get(this.pool.remoteJobKey(grant.jobId));
    if (!job || (grant.requester ? job.requesterUserId !== grant.actorUserId
      : job.workerUserId !== grant.actorUserId || job.status !== "claimed" || job.leaseExpiresAt <= Date.now() || Number(job.attempts || 0) !== grant.attempt)) {
      throw new InputError("this claim no longer has access to the inputs", 403);
    }
    const file = await this.storage.get(this.key(grant.artifactId));
    if (!file || file.jobId !== job.id) throw new InputError("input file is no longer available", 410);
    const object = await this.pool.env.ARTIFACTS.get(file.objectKey);
    if (!object) throw new InputError("input file is no longer available", 410);
    const asciiName = file.name.replace(/[^\x20-\x7e]/g, "_");
    return new Response(object.body, { headers: {
      "content-type": file.contentType, "content-length": String(file.size), "cache-control": "private, no-store",
      "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
      "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, "%27")}`,
    } });
  }

  async fileExpiry(file) {
    if (!file.uploadedAt) return file.createdAt + UPLOAD_MS;
    if (!file.jobId) return file.uploadedAt + ORPHAN_MS;
    const job = await this.storage.get(this.pool.remoteJobKey(file.jobId));
    if (!job) return file.uploadedAt + ORPHAN_MS;
    return ["completed", "failed"].includes(job.status) ? job.completedAt + RETAIN_MS : Infinity;
  }

  async deadlines() {
    const times = [];
    for (const prefix of ["input-upload:", "input-download:"]) {
      for (const value of (await this.storage.list({ prefix })).values()) times.push(value.expiresAt);
    }
    for (const file of (await this.storage.list({ prefix: "input:" })).values()) times.push(await this.fileExpiry(file));
    return times.filter(Number.isFinite);
  }

  async cleanup() {
    const now = Date.now();
    for (const prefix of ["input-upload:", "input-download:"]) {
      for (const [key, value] of await this.storage.list({ prefix })) if (value.expiresAt <= now) await this.storage.delete(key);
    }
    for (const [key, file] of await this.storage.list({ prefix: "input:" })) {
      if (await this.fileExpiry(file) <= now) {
        await this.pool.env.ARTIFACTS?.delete(file.objectKey);
        await this.storage.delete(key);
      }
    }
  }
}
