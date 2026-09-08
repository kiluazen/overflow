export class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
  }

  async get(key) {
    return structuredClone(this.values.get(key));
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

  async setAlarm(at) {
    this.alarmAt = Number(at);
  }

  async getAlarm() {
    return this.alarmAt;
  }

  async deleteAlarm() {
    this.alarmAt = null;
  }
}

export class MemoryState {
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

export class MemoryBucket {
  constructor() {
    this.objects = new Map();
  }

  async put(key, body, options = {}) {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    if (options.sha256) {
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
      if (hash !== options.sha256) throw new Error("R2 checksum mismatch");
    }
    this.objects.set(key, {
      bytes,
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    });
  }

  async delete(key) { this.objects.delete(key); }

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

export function actorRequest(path, userId, displayName, body) {
  return new Request(`https://overflow.internal${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-overflow-user-id": userId,
      "x-overflow-display-name": encodeURIComponent(displayName),
      "x-overflow-presence": "codex",
      "x-overflow-email": `${userId}@example.com`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function remote(pool, path, userId, displayName, body) {
  const request = actorRequest(path, userId, displayName, body);
  return pool.handleRemote(request, new URL(request.url));
}
