// One way notices to a Discord webhook. Nothing ever comes back from Discord into the game.
// The webhook address is a secret: stored encrypted, never sent to a browser, never written to a log.
import { cleanText } from './actions.js';
import { fail, has } from './errors.js';

export const EVENTS = ['ban', 'kick', 'call', 'warn', 'teamkill', 'match'];
const DEFAULTS = { enabled: false, url: '', roleId: '', tkAt: 3,
  events: { ban: true, kick: true, call: true, warn: false, teamkill: false, match: false } };
// only Discord itself: the panel cannot be pointed at any other address
const WEBHOOK = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d{5,25}\/[A-Za-z0-9_-]{20,200}$/;
const MATCH = new Set(['Change layer', 'End match', 'Restart match']);
const MAX_QUEUE = 100;
const PACE = 500; // between two messages
const CALL_WAIT = 60000; // between two admin calls of one player

// player names and chat must stay plain text in Discord
const plain = (value) => cleanText(value).replace(/[\\*_~`|<>[\]()#]/g, '\\$&').replace(/:\/\//g, ':\u200b//');

const Author = Object.freeze({ Author: 'Miabeyefendi', madeBy: 'miabeyefendi' });
globalThis[Symbol.for('sa.author')] = Author;
export class Notifier {
  constructor({ vault, serverName = () => 'Squad server', fetchFn = fetch, now = Date.now, wait = setTimeout }) {
    Object.assign(this, { vault, serverName, fetchFn, now, wait });
    const saved = vault.readJson('notify.enc', 'notify', {});
    this.config = { ...DEFAULTS, ...saved, events: { ...DEFAULTS.events, ...saved.events } };
    this.queue = [];
    this.calls = new Map();
    this.sending = false;
    this.stopped = false;
    this.timer = null;
    this.problem = '';
    this.dropped = 0;
    this.lastSent = null;
  }

  // what a browser may see
  describe() {
    const { url, ...rest } = this.config;
    return { ...rest, set: !!url, tail: url ? url.slice(-4) : '', problem: this.problem, dropped: this.dropped, lastSent: this.lastSent };
  }

  // url left out keeps the old one, an empty url removes it
  save(change = {}) {
    const next = structuredClone(this.config);
    if (change.url !== undefined) {
      const url = String(change.url).trim();
      if (url && !WEBHOOK.test(url)) fail('That is not a Discord webhook address (https://discord.com/api/webhooks/...).');
      next.url = url;
    }
    if (change.roleId !== undefined) {
      const roleId = String(change.roleId).trim();
      if (roleId && !/^\d{5,25}$/.test(roleId)) fail('A role ID is a number.');
      next.roleId = roleId;
    }
    if (change.tkAt !== undefined) {
      if (!Number.isInteger(change.tkAt) || change.tkAt < 1 || change.tkAt > 100) fail('Teamkills must be a whole number from 1 to 100.');
      next.tkAt = change.tkAt;
    }
    for (const [name, on] of Object.entries(change.events || {})) {
      if (!EVENTS.includes(name) || !has(change.events, name) || typeof on !== 'boolean') fail('Unknown notice.');
      next.events[name] = on;
    }
    if (change.enabled !== undefined) next.enabled = change.enabled === true;
    if (next.enabled && !next.url) fail('Add the webhook address first.');
    this.vault.writeJson('notify.enc', 'notify', next);
    this.config = next;
    this.problem = '';
    this.stopped = false;
    if (!next.enabled) this.queue = [];
    return this.describe();
  }

  // The text for one log line, or null when it is not to be sent.
  message(entry) {
    const { events, tkAt, roleId } = this.config;
    if (entry.kind === 'chat') {
      if (!events.call || !/^!admin\b/i.test(entry.message || '')) return null;
      const key = entry.id || entry.player;
      if (this.now() - (this.calls.get(key) || 0) < CALL_WAIT) return null;
      this.calls.set(key, this.now());
      if (this.calls.size > 500) this.calls.delete(this.calls.keys().next().value);
      return { text: `🆘 **Admin call** from ${plain(entry.player)}: ${plain(entry.message)}`, role: roleId };
    }
    if (entry.kind === 'tk') {
      // once, when the count reaches the limit
      if (!events.teamkill || entry.count !== tkAt) return null;
      return { text: `⚠️ **Teamkills**: ${plain(entry.attacker)} reached ${tkAt} this match` };
    }
    if (entry.kind !== 'admin') return null;
    const action = String(entry.action);
    const type = action === 'Kick' ? 'kick' : /^Ban (permanent|\d+[hd])$/.test(action) ? 'ban' : action === 'Warn' ? 'warn' : MATCH.has(action) ? 'match' : null;
    if (!type || !events[type]) return null;
    // entry.note (evidence for admins) is deliberately left out
    const reason = entry.reason ? ` - ${plain(entry.reason)}` : '';
    return { text: `${type === 'ban' ? '⛔' : type === 'kick' ? '👢' : type === 'warn' ? '❗' : '🗺️'} **${plain(action)}**: ${plain(entry.target)}${reason} (by ${plain(entry.by)})` };
  }

  onLog(entry) {
    if (!this.config.enabled || !this.config.url || this.stopped) return;
    const notice = this.message(entry);
    if (notice) this.push(notice);
  }

  body({ text, role }) {
    const ping = role ? `<@&${role}> ` : '';
    return {
      content: `${ping}\`${cleanText(this.serverName(), 60).replace(/`/g, "'")}\` ${text}`.slice(0, 2000),
      // no name or chat line can ping anyone; only the one role picked for admin calls
      allowed_mentions: role ? { parse: [], roles: [role] } : { parse: [] }
    };
  }

  push(notice) {
    this.queue.push(notice);
    if (this.queue.length > MAX_QUEUE) {
      this.queue.shift();
      this.dropped += 1;
    }
    this.pump();
  }

  async post(notice) {
    return this.fetchFn(this.config.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.body(notice)), redirect: 'error', signal: AbortSignal.timeout(5000) });
  }

  later(ms) {
    this.timer = this.wait(() => {
      this.sending = false;
      this.pump();
    }, ms);
    this.timer?.unref?.();
  }

  // One at a time, in the background: the game never waits for Discord.
  async pump() {
    if (this.sending || this.stopped || !this.queue.length) return;
    this.sending = true;
    const notice = this.queue[0];
    let res = null;
    try {
      res = await this.post(notice);
    } catch {
      // the error text could hold the address, so it is not kept
    }
    if (res?.status === 429) {
      const body = await res.json().catch(() => ({}));
      const seconds = Number(body.retry_after ?? res.headers?.get?.('retry-after')) || 5;
      this.later(Math.min(Math.max(seconds, 1), 600) * 1000);
      return;
    }
    if (this.queue[0] === notice) this.queue.shift();
    if (res?.ok) {
      this.lastSent = this.now();
      this.problem = '';
    } else if (res && [401, 403, 404].includes(res.status)) {
      this.stopped = true;
      this.queue = [];
      this.problem = 'Discord refused the webhook. It may have been deleted. Save a new address.';
    } else {
      this.dropped += 1;
      this.problem = res ? `Discord answered ${res.status}.` : 'Discord could not be reached.';
    }
    this.later(PACE);
  }

  async test() {
    if (!this.config.url) fail('Add the webhook address first.');
    const res = await this.post({ text: '✅ Test message from Squad Admin Panel' }).catch(() => null);
    if (!res?.ok) fail(res ? `Discord answered ${res.status}.` : 'Discord could not be reached.', 502);
    this.lastSent = this.now();
    this.problem = '';
    this.stopped = false;
  }

  close() {
    clearTimeout(this.timer);
    this.queue = [];
    this.stopped = true;
  }
}
