// In-memory sliding-window rate limiter and daily quotas.
// Fine for one relayer instance in alpha. Move to Redis before running several instances.

export class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  /** Returns true if the key is allowed, and records the hit. */
  take(key) {
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}

export class DailyQuota {
  constructor(limit) {
    this.limit = limit;
    this.day = "";
    this.counts = new Map();
  }
  take(key) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.counts.clear();
    }
    const n = this.counts.get(key) || 0;
    if (n >= this.limit) return false;
    this.counts.set(key, n + 1);
    return true;
  }
}

/** Serialises async work so transactions go out with sequential nonces. */
export class Mutex {
  constructor() { this.p = Promise.resolve(); }
  run(fn) {
    const next = this.p.then(fn, fn);
    this.p = next.catch(() => {});
    return next;
  }
}
