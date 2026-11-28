// Logs (one entry per line, one file per day), player records (history, notes, counts), rule
// settings and retention. All encrypted. Player records are kept apart from the logs, so a warning
// from months ago is still there after any restart, whatever happens to the logs.
import fs from 'node:fs';
import path from 'node:path';

import { PanelError, has } from './errors.js';

export const LOG_KINDS = ['admin', 'tk', 'kills', 'chat', 'conn'];
// what can be deleted from player records
export const RECORD_KINDS = ['history', 'notes'];
export const ALL_KINDS = [...LOG_KINDS, ...RECORD_KINDS];
const DAY = 86400000;
// Zvnorlrsraqv
const LOG_FILE = /^log-(\d{4}-\d{2}-\d{2})\.enc$/;
const COUNTS = { warn: 'warns', kick: 'kicks', ban: 'bans' };
const empty = () => ({ notes: [], history: [], warns: 0, kicks: 0, bans: 0, firstSeen: null });
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);

export function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// ref Mia / beyefendi
export class Store {
  constructor(vault, { retentionDays = 90, keep = 500, now = Date.now } = {}) {
    Object.assign(this, { vault, dataDir: vault.dataDir, keep, now });
    // no prototype, so no key from outside can reach one
    this.players = Object.assign(Object.create(null), vault.readJson('players.enc', 'players', {}));
    this.logs = Object.fromEntries(LOG_KINDS.map((k) => [k, []]));
    this.listeners = new Set();
    this.day = null;
    this.damaged = 0;
    // days to keep each kind, 0 keeps it for ever; player records are kept unless someone says otherwise
    const defaults = Object.fromEntries(ALL_KINDS.map((k) => [k, LOG_KINDS.includes(k) ? retentionDays : 0]));
    this.retention = { ...defaults, ...vault.readJson('settings.enc', 'settings', {}).retention };
    this.prune();
    this.loadRecent();
  }

  // ---------- log files ----------
  logFiles() {
    return fs.readdirSync(this.dataDir).filter((f) => LOG_FILE.test(f)).sort();
  }

  readFile(name) {
    const entries = [];
    let damaged = 0;
    for (const line of fs.readFileSync(path.join(this.dataDir, name), 'utf8').split('\n')) {
      if (!line) continue;
      try {
        entries.push({ line, entry: JSON.parse(this.vault.open(line, 'log')) });
      } catch {
        damaged += 1; // cut short by a crash, or changed by hand
      }
    }
    return { entries, damaged };
  }

  // Newest days first, until every kind has its page or there is nothing older.
  loadRecent() {
    const found = Object.fromEntries(LOG_KINDS.map((k) => [k, []]));
    for (const file of this.logFiles().reverse()) {
      const { entries, damaged } = this.readFile(file);
      this.damaged += damaged;
      for (const kind of LOG_KINDS) {
        if (found[kind].length >= this.keep) continue;
        found[kind] = [...entries.filter((x) => x.entry.kind === kind).map((x) => x.entry), ...found[kind]];
      }
      if (LOG_KINDS.every((k) => found[k].length >= this.keep)) break;
    }
    for (const kind of LOG_KINDS) this.logs[kind] = found[kind].slice(-this.keep);
  }

  months() {
    return [...new Set(this.logFiles().map((f) => LOG_FILE.exec(f)[1].slice(0, 7)))].reverse();
  }

  // One kind between two times, read back from disk: the newest "limit" entries.
  range(kind, from, to, limit = 5000) {
    if (!LOG_KINDS.includes(kind) || !(from >= 0) || !(to > from)) throw new PanelError('Unknown log or period.');
    let out = [];
    for (const file of this.logFiles().reverse()) {
      const start = Date.parse(`${LOG_FILE.exec(file)[1]}T00:00:00Z`);
      if (start + DAY <= from || start >= to) continue;
      out = [...this.readFile(file).entries.map((x) => x.entry).filter((e) => e.kind === kind && e.at >= from && e.at < to), ...out];
      if (out.length >= limit) break;
    }
    return out.slice(-limit);
  }

  // Every warning, kick, ban and note between two times, newest first.
  timeline({ from = 0, to = Infinity, query = '', limit = 500 } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const out = [];
    for (const [id, p] of Object.entries(this.players)) {
      const name = p.name || id;
      const mine = !q || name.toLowerCase().includes(q) || id.toLowerCase().includes(q);
      const rows = [...(p.history || []), ...(p.notes || []).map((n) => ({ at: n.at, type: 'note', by: n.by, reason: n.text }))];
      for (const e of rows) {
        if (e.at < from || e.at >= to) continue;
        if (mine || `${e.by} ${e.reason}`.toLowerCase().includes(q)) out.push({ ...e, id, name });
      }
    }
    out.sort((a, b) => b.at - a.at);
    return { total: out.length, entries: out.slice(0, limit) };
  }

  // One month of one kind, read back from disk.
  month(kind, month, limit = 5000) {
    if (!LOG_KINDS.includes(kind) || !/^\d{4}-\d{2}$/.test(String(month))) throw new PanelError('Unknown log or month.');
    const out = [];
    for (const file of this.logFiles().filter((f) => LOG_FILE.exec(f)[1].startsWith(month))) {
      for (const { entry } of this.readFile(file).entries) if (entry.kind === kind) out.push(entry);
    }
    return out.slice(-limit);
  }

  remember(entry) {
    if (!LOG_KINDS.includes(entry.kind)) return;
    const list = this.logs[entry.kind];
    list.push(entry);
    if (list.length > this.keep) list.splice(0, list.length - this.keep);
  }

  log(kind, data) {
    const entry = { ...data, kind, at: this.now() };
    const day = dayOf(entry.at);
    if (day !== this.day) {
      this.day = day;
      this.prune();
    }
    fs.appendFileSync(path.join(this.dataDir, `log-${day}.enc`), `${this.vault.seal(JSON.stringify(entry), 'log')}\n`, { mode: 0o600 });
    this.remember(entry);
    for (const fn of this.listeners) fn(entry);
    return entry;
  }

  // ---------- deleting ----------
  // Deletes entries of the given kinds from "from" up to but not including "to" (times in ms).
  // With dryRun nothing changes and the counts say what would go.
  purge({ kinds, from = 0, to = Infinity, dryRun = false, days = null }) {
    // "days", when given, is filled with how many entries fall on each day
    const tally = (at) => { if (days) days[dayOf(at)] = (days[dayOf(at)] || 0) + 1; };
    const counts = Object.fromEntries(kinds.map((k) => [k, 0]));
    const logKinds = kinds.filter((k) => LOG_KINDS.includes(k));
    const inside = (at) => at >= from && at < to;
    if (logKinds.length) {
      for (const file of this.logFiles()) {
        const start = Date.parse(`${LOG_FILE.exec(file)[1]}T00:00:00Z`);
        if (start + DAY <= from || start >= to) continue;
        const { entries, damaged } = this.readFile(file);
        const keep = entries.filter(({ entry }) => {
          const gone = logKinds.includes(entry.kind) && inside(entry.at);
          if (gone) { counts[entry.kind] += 1; tally(entry.at); }
          return !gone;
        });
        if (dryRun || (keep.length === entries.length && !damaged)) continue;
        const full = path.join(this.dataDir, file);
        if (!keep.length) fs.unlinkSync(full);
        else {
          fs.writeFileSync(`${full}.tmp`, keep.map((x) => `${x.line}\n`).join(''), { mode: 0o600 });
          fs.renameSync(`${full}.tmp`, full);
        }
      }
      if (!dryRun) for (const k of logKinds) this.logs[k] = this.logs[k].filter((e) => !inside(e.at));
    }
    for (const kind of kinds.filter((k) => RECORD_KINDS.includes(k))) {
      for (const record of Object.values(this.players)) {
        const list = record[kind] || [];
        const gone = list.filter((e) => inside(e.at));
        counts[kind] += gone.length;
        for (const e of gone) tally(e.at);
        // "everything" also clears counts that have no history line behind them (from 0.3)
        const all = kind === 'history' && from === 0 && to === Infinity;
        if (dryRun || (!gone.length && !all)) continue;
        record[kind] = list.filter((e) => !inside(e.at));
        if (kind === 'history') {
          for (const e of gone) if (COUNTS[e.type]) record[COUNTS[e.type]] = Math.max(0, record[COUNTS[e.type]] - 1);
          if (all) Object.assign(record, { warns: 0, kicks: 0, bans: 0 });
        }
        this.dirty = true;
      }
    }
    if (!dryRun) this.flush();
    return counts;
  }

  // Applies the retention rules.
  prune() {
    for (const kind of ALL_KINDS) {
      const days = this.retention[kind];
      if (days > 0) this.purge({ kinds: [kind], to: Date.parse(`${dayOf(this.now() - days * DAY)}T00:00:00Z`) });
    }
  }

  setRetention(changes) {
    for (const [kind, days] of Object.entries(changes || {})) {
      if (!ALL_KINDS.includes(kind) || !has(changes, kind)) throw new PanelError('Unknown record type.');
      if (!Number.isInteger(days) || days < 0 || days > 36500) throw new PanelError('Days must be a whole number, 0 keeps for ever.');
    }
    this.retention = { ...this.retention, ...changes };
    this.vault.writeJson('settings.enc', 'settings', { retention: this.retention });
    this.prune();
    return this.retention;
  }

  overview() {
    const files = this.logFiles();
    const records = Object.values(this.players);
    return {
      retention: this.retention,
      months: this.months(),
      oldestLog: files.length ? LOG_FILE.exec(files[0])[1] : null,
      logDays: files.length,
      bytes: [...files, 'players.enc'].reduce((n, f) => {
        try {
          return n + fs.statSync(path.join(this.dataDir, f)).size;
        } catch {
          return n;
        }
      }, 0),
      players: records.length,
      history: records.reduce((n, p) => n + (p.history?.length || 0), 0),
      notes: records.reduce((n, p) => n + (p.notes?.length || 0), 0)
    };
  }

  // ---------- player records ----------
  player(id) {
    return this.players[id] ? { ...empty(), ...this.players[id] } : empty();
  }

  touch(id, patch) {
    this.players[id] = { ...this.player(id), ...patch };
    this.dirty = true;
  }

  seen(id, name) {
    const p = this.player(id);
    if (!p.firstSeen || p.name !== name) this.touch(id, { name, firstSeen: p.firstSeen || this.now() });
    this.players[id].lastSeen = this.now();
  }

  // A warning, kick or ban: kept with the player, with who, when and why. Written to disk at once.
  record(id, type, { by, reason = '', detail = '', name }) {
    const p = this.player(id);
    const entry = { at: this.now(), type, by, reason, detail };
    this.touch(id, {
      history: [...p.history, entry].slice(-1000),
      [COUNTS[type]]: p[COUNTS[type]] + 1,
      name: p.name || name,
      firstSeen: p.firstSeen || this.now()
    });
    this.flush();
  }

  addNote(id, by, text) {
    this.touch(id, { notes: [...this.player(id).notes, { by, text, at: this.now() }].slice(-500) });
    this.flush();
  }

  // Players with something on record, or matching a search, newest activity first.
  search(query, limit = 100) {
    const q = String(query || '').trim().toLowerCase();
    return Object.entries(this.players)
      .map(([id, p]) => {
        const full = { ...empty(), ...p };
        const last = Math.max(0, ...full.history.map((e) => e.at), ...full.notes.map((e) => e.at));
        return { id, name: full.name || id, warns: full.warns, kicks: full.kicks, bans: full.bans, notes: full.notes.length, last, lastSeen: full.lastSeen || null };
      })
      .filter((p) => (q ? p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) : p.last > 0))
      .sort((a, b) => b.last - a.last || (b.lastSeen || 0) - (a.lastSeen || 0))
      .slice(0, limit);
  }

  flush() {
    if (!this.dirty) return;
    this.vault.writeJson('players.enc', 'players', this.players);
    this.dirty = false;
  }

  // ---------- rules ----------
  loadRules(defaults) {
    const saved = this.vault.readJson('rules.enc', 'rules', {});
    return Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, { ...v, ...saved[k] }]));
  }

  saveRules(rules) {
    this.vault.writeJson('rules.enc', 'rules', rules);
  }
}
