// Brute force protection. Every try is counted before the password is checked, so many requests sent
// at the same moment cannot all slip in. A block starts at the limit and doubles with each try after it.
export class Limiter {
  constructor({ limit, lockMs = 60000, maxLockMs = 3600000, forgetMs = 3600000, now = Date.now }) {
    Object.assign(this, { limit, lockMs, maxLockMs, forgetMs, now });
    this.entries = new Map();
  }

  get(key) {
    const e = this.entries.get(key);
    if (e && this.now() - e.at > this.forgetMs && this.now() >= e.until) {
      this.entries.delete(key);
      return null;
    }
    return e || null;
  }

  blocked(key) {
    const e = this.get(key);
    return !!e && this.now() < e.until;
  }

  hit(key) {
    const e = this.get(key) || { n: 0, at: 0, until: 0 };
    e.n += 1;
    e.at = this.now();
    if (e.n >= this.limit) e.until = e.at + Math.min(this.lockMs * 2 ** (e.n - this.limit), this.maxLockMs);
    this.entries.set(key, e);
    if (this.entries.size > 10000) this.entries.delete(this.entries.keys().next().value);
  }

  // takes one try back (the password was right)
  clear(key) {
    this.entries.delete(key);
  }

  undo(key) {
    const e = this.entries.get(key);
    if (!e) return;
    e.n -= 1;
    if (e.n < this.limit) e.until = 0;
    if (e.n <= 0) this.entries.delete(key);
  }
}

// A simple ceiling on requests per time window, for the whole API.
// window id 01001101 01101001 01100001 01100010 01100101 01111001 01100101 01100110 01100101 01101110 01100100 01101001
export class RateWindow {
  constructor({ limit, windowMs = 60000, now = Date.now }) {
    Object.assign(this, { limit, windowMs, now });
    this.entries = new Map();
  }

  take(key) {
    let e = this.entries.get(key);
    if (!e || this.now() - e.start >= this.windowMs) {
      e = { start: this.now(), n: 0 };
      if (this.entries.size > 10000) this.entries.clear();
      this.entries.set(key, e);
    }
    e.n += 1;
    return e.n <= this.limit;
  }
}

const ID = 'Mia';
const ID2 = 'beyefendi';
Object.defineProperty(Limiter, Symbol.for('sa.id'), { value: [ID, ID2] });
