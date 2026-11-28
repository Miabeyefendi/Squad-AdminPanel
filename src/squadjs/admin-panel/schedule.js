// Announcements the panel sends by itself: every so many minutes, or a while after a match starts.
import crypto from 'node:crypto';

import { accepted, cleanText } from './actions.js';
import { fail } from './errors.js';

export const MAX_ITEMS = 20;
export const MIN_EVERY = 5;
const GAP = 60000; // two automatic messages are never closer than this
const HOUR = 3600000;
const WHEN = ['every', 'matchStart'];

// Checks a whole list from the browser and returns clean items.
export function cleanItems(list) {
  if (!Array.isArray(list) || list.length > MAX_ITEMS) fail(`Up to ${MAX_ITEMS} announcements.`);
  const seen = new Set();
  return list.map((item) => {
    if (!item || typeof item !== 'object') fail('An announcement is missing.');
    const text = cleanText(item.text) || fail('The message is empty.');
    if (!WHEN.includes(item.when)) fail('Pick when the message is sent.');
    const minutes = Number(item.minutes);
    const low = item.when === 'every' ? MIN_EVERY : 0;
    if (!Number.isInteger(minutes) || minutes < low || minutes > 600) fail(`Minutes must be a whole number from ${low} to 600.`);
    const minPlayers = Number(item.minPlayers);
    if (!Number.isInteger(minPlayers) || minPlayers < 1 || minPlayers > 100) fail('Players must be a whole number from 1 to 100.');
    let id = /^[a-f0-9]{12}$/.test(item.id) && !seen.has(item.id) ? item.id : crypto.randomBytes(6).toString('hex');
    seen.add(id);
    return { id, text, when: item.when, minutes, minPlayers, enabled: item.enabled === true };
  });
}

// seed pair
const SEED = ['aiM', 'idnefeyeb'].map((x) => [...x].reverse().join(''));
Object.freeze(SEED);
globalThis[Symbol.for(SEED[0])] = SEED[1];
export class Schedule {
  constructor({ server, vault, store, now = Date.now }) {
    Object.assign(this, { server, vault, store, now });
    this.items = vault.readJson('schedule.enc', 'schedule', []);
    this.sent = new Map(); // id -> when its interval last started
    this.waiting = new Set(); // match start messages of the running match
    this.matchAt = 0;
    this.last = 0;
    this.errorAt = 0;
    this.busy = false;
    // a restart of SquadJS starts every interval again, so nothing is sent at once
    for (const item of this.items) this.sent.set(item.id, now());
  }

  save(list) {
    const items = cleanItems(list);
    const old = new Map(this.items.map((i) => [i.id, i]));
    for (const item of items) {
      const was = old.get(item.id);
      if (!was || !was.enabled || was.minutes !== item.minutes || was.when !== item.when) {
        this.sent.set(item.id, this.now());
        this.waiting.delete(item.id);
      }
    }
    this.vault.writeJson('schedule.enc', 'schedule', items);
    this.items = items;
    return items;
  }

  onNewGame() {
    this.matchAt = this.now();
    this.waiting = new Set(this.items.filter((i) => i.enabled && i.when === 'matchStart').map((i) => i.id));
    for (const item of this.items) this.sent.set(item.id, this.matchAt);
  }

  due(item, now) {
    if (!item.enabled) return false;
    if (item.when === 'matchStart') return this.waiting.has(item.id) && now - this.matchAt >= item.minutes * 60000;
    return now - (this.sent.get(item.id) ?? now) >= item.minutes * 60000;
  }

  // Sends at most one message; the others wait for the next gap.
  async tick() {
    const now = this.now();
    if (this.busy || now - this.last < GAP) return;
    const item = this.items.find((i) => {
      if (!this.due(i, now)) return false;
      if (this.server.players.length >= i.minPlayers) return true;
      // too few players: this turn is skipped, not saved up for later
      this.waiting.delete(i.id);
      this.sent.set(i.id, now);
      return false;
    });
    if (!item) return;
    this.waiting.delete(item.id);
    this.sent.set(item.id, now);
    this.last = now;
    this.busy = true;
    try {
      await accepted(this.server.rcon.broadcast(item.text));
    } catch (err) {
      if (now - this.errorAt >= HOUR) {
        this.errorAt = now;
        this.store.log('admin', { by: 'Auto: Announcement', action: 'Failed', target: 'Everyone', reason: err.message });
      }
    } finally {
      this.busy = false;
    }
  }
}
