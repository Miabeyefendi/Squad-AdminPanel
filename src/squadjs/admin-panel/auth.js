// Accounts, passwords, sessions and roles. Users live encrypted in <dataDir>/users.enc, never in
// config.json, because SquadJS sends plugin options to its ping API.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { promisify } from 'node:util';

import { fail } from './errors.js';
import { Limiter } from './limiter.js';
import {
  EDITABLE_RANKS, PERMISSIONS, RANKS, RANK_DEFAULTS, accountBlock, assignable, creatableRanks, effective,
  eligible, isPermission, isRank, rankSet, tickBlock
} from './permissions.js';

const scrypt = promisify(crypto.scrypt);

// The first account, admin / admin. It may be kept, but while it has that password it only works
// from this machine, and the panel keeps saying so.
export const DEFAULT_NAME = 'admin';
export const DEFAULT_PASSWORD = 'admin';

// ---------- passwords ----------
// scrypt, one of the OWASP settings (N=2^15, r=8, p=3). Runs off the main thread, so a sign in does
// not stall SquadJS.
const COST = { N: 32768, r: 8, p: 3 };
const MAXMEM = 96 * 1024 * 1024;

export async function hashPassword(password, salt = crypto.randomBytes(16)) {
  const key = await scrypt(String(password), salt, 32, { ...COST, maxmem: MAXMEM });
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hex] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !/^[0-9a-f]{64}$/.test(hex || '')) return false;
  try {
    const got = await scrypt(String(password), Buffer.from(salt, 'hex'), 32, { N: +N, r: +r, p: +p, maxmem: MAXMEM });
    return crypto.timingSafeEqual(got, Buffer.from(hex, 'hex'));
  } catch {
    return false;
  }
}

const COMMON = ['password', 'qwerty', '123456', 'admin', 'squad', 'letmein', 'welcome', 'iloveyou', 'parola', 'sifre'];
export function passwordProblem(password, name) {
  const text = String(password ?? '');
  const low = text.toLowerCase();
  if (text.length < 10) return 'The password must be at least 10 characters.';
  if (text.length > 200) return 'The password is too long.';
  if (name && low.includes(String(name).toLowerCase())) return 'The password must not contain the user name.';
  if (new Set(text).size < 5) return 'The password repeats too few characters.';
  // a common word padded with digits or signs is the first thing a guessing tool tries
  const core = low.replace(/[^a-z]/g, '');
  if (COMMON.includes(core) || /^\d+$/.test(text) || '01234567890123456789'.includes(low)) return 'That password is too easy to guess.';
  return null;
}
const NAME = /^[A-Za-z0-9_.-]{3,32}$/;
function checkName(name) {
  if (!NAME.test(String(name))) fail('The name needs 3 to 32 letters, digits, dots, dashes or underscores.');
  return String(name);
}
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

// ---------- user and rank files ----------
const FILE = 'users.enc';
const cache = new WeakMap();

// Accounts written by 0.2 had a "role": the first owner stays owner, other owners become admins,
// moderators become junior mods.
function upgrade(list) {
  let owner = list.some((u) => u.rank === 'owner');
  return list.map(({ role, ...u }) => {
    if (u.rank) return u;
    let rank = role === 'moderator' ? 'junior' : role;
    if (rank === 'owner') {
      if (owner) rank = 'admin';
      owner = true;
    }
    return { ...u, rank };
  });
}

export function loadUsers(vault) {
  let stamp;
  try {
    const s = fs.statSync(vault.file(FILE));
    stamp = `${s.mtimeMs}:${s.size}:${s.ino}`;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const hit = cache.get(vault);
  if (hit?.stamp === stamp) return structuredClone(hit.users);
  const users = upgrade(vault.readJson(FILE, 'users', []).filter((u) => u && u.name && u.hash))
    .filter((u) => isRank(u.rank))
    .map((u) => ({ ...u, grants: (u.grants || []).filter(isPermission), denies: (u.denies || []).filter(isPermission) }));
  cache.set(vault, { stamp, users });
  return structuredClone(users);
}

export function saveUsers(vault, users) {
  vault.writeJson(FILE, 'users', users);
  cache.delete(vault);
}

const rankCache = new WeakMap();
export function loadRanks(vault) {
  let hit = rankCache.get(vault);
  if (!hit) {
    const saved = vault.readJson('ranks.enc', 'ranks', {});
    hit = Object.fromEntries(EDITABLE_RANKS.map((rank) => [rank, [...rankSet(rank, { ...RANK_DEFAULTS, ...saved })]]));
    rankCache.set(vault, hit);
  }
  return structuredClone(hit);
}
export function saveRanks(vault, ranks) {
  vault.writeJson('ranks.enc', 'ranks', ranks);
  rankCache.delete(vault);
}

export async function ensureDefaultAdmin(vault) {
  if (loadUsers(vault).length) return false;
  saveUsers(vault, [{ name: DEFAULT_NAME, rank: 'owner', hash: await hashPassword(DEFAULT_PASSWORD), defaultAccount: true }]);
  return true;
}

// drops personal ticks that say nothing (same as the rank) or that the rank may not hold
function tidy(user, ranks) {
  const base = rankSet(user.rank, ranks);
  user.grants = (user.grants || []).filter((id) => assignable(id) && eligible(user.rank, id) && !base.has(id));
  user.denies = (user.denies || []).filter((id) => assignable(id) && eligible(user.rank, id) && base.has(id));
}

// Author: Miabeyefendi
// ---------- sign in and accounts ----------
export class Auth {
  constructor({ vault, sessionHours = 12, idleMinutes = 60, now = Date.now, maxSessions = 5, maxHashing = 4 }) {
    Object.assign(this, { vault, now, maxSessions, maxHashing });
    this.sessionMs = sessionHours * 3600000;
    this.idleMs = idleMinutes * 60000;
    this.sessions = new Map();
    this.byIp = new Limiter({ limit: 5, now });
    this.byName = new Limiter({ limit: 15, now });
    this.everyone = new Limiter({ limit: 60, lockMs: 30000, maxLockMs: 300000, forgetMs: 60000, now });
    // addresses that signed in as a user before: an attacker elsewhere cannot lock that user out
    this.known = new Set();
    this.hashing = 0;
    this.queue = Promise.resolve();
    this.dummy = hashPassword(crypto.randomBytes(16).toString('hex'));
  }

  // changes to the user file run one after another
  exclusive(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  // Counts a try, checks it, and takes the count back when the password was right.
  async guess(name, password, ip) {
    const key = String(name).toLowerCase().slice(0, 64);
    const trusted = this.known.has(`${ip}|${key}`);
    if (this.byIp.blocked(ip) || (!trusted && (this.byName.blocked(key) || this.everyone.blocked('all')))) {
      return { error: 'locked' };
    }
    if (this.hashing >= this.maxHashing) return { error: 'busy' };
    this.byIp.hit(ip);
    if (!trusted) {
      this.byName.hit(key);
      this.everyone.hit('all');
    }
    this.hashing += 1;
    try {
      const user = loadUsers(this.vault).find((u) => sameName(u.name, key));
      // an unknown name costs the same time as a wrong password
      const ok = await verifyPassword(password, user ? user.hash : await this.dummy);
      if (!user || !ok || String(password).length > 200) return { error: 'bad' };
      this.byIp.clear(ip);
      if (!trusted) {
        this.byName.clear(key);
        this.everyone.undo('all');
      }
      this.known.add(`${ip}|${key}`);
      if (this.known.size > 2000) this.known.delete(this.known.values().next().value);
      return { user };
    } finally {
      this.hashing -= 1;
    }
  }

  async login(name, password, ip, { local = false } = {}) {
    const result = await this.guess(name, password, ip);
    if (result.error) return result;
    const { user } = result;
    // the well known first password never works over a network or through a proxy
    if (user.defaultAccount && !local) return { error: 'localOnly' };
    return this.open(user);
  }

  open(user) {
    const mine = [...this.sessions].filter(([, s]) => s.name === user.name);
    for (const [id] of mine.slice(0, Math.max(0, mine.length - this.maxSessions + 1))) this.sessions.delete(id);
    const id = crypto.randomBytes(32).toString('hex');
    this.sessions.set(id, { name: user.name, hash: user.hash, until: this.now() + this.sessionMs, seen: this.now() });
    return { id, ...this.describe(user) };
  }

  describe(user) {
    // temporary passwords given by an admin must be changed; the first account only gets a warning
    return { name: user.name, rank: user.rank, mustChange: !!user.mustChange && !user.defaultAccount,
      defaultPassword: !!user.defaultAccount, perms: effective(user, loadRanks(this.vault)) };
  }

  // touch is false for the background event stream: only real requests keep a session alive.
  // Rank and permissions are read fresh, so a change applies to open sessions at once.
  session(id, { touch = true } = {}) {
    const s = this.sessions.get(id);
    if (!s) return null;
    // a removed user or a new password ends the session
    const user = loadUsers(this.vault).find((u) => u.name === s.name);
    if (this.now() > s.until || this.now() - s.seen > this.idleMs || !user || user.hash !== s.hash) {
      this.sessions.delete(id);
      return null;
    }
    if (touch) s.seen = this.now();
    return this.describe(user);
  }

  logout(id) {
    this.sessions.delete(id);
  }

  // The password again, for changes that must not be possible with a stolen session alone.
  async confirm(session, password, ip) {
    const result = await this.guess(session.name, String(password ?? ''), ip);
    if (result.error === 'bad') fail('Your current password is wrong.', 403);
    if (result.error) fail('Too many tries. Wait a while.', 429);
    return result.user;
  }

  // Own name and password. Returns a new session; every other session of this user ends.
  async changeOwn(session, { currentPassword, name, newPassword }, ip) {
    await this.confirm(session, currentPassword, ip);
    return this.exclusive(async () => {
      const users = loadUsers(this.vault);
      const user = users.find((u) => u.name === session.name) || fail('Your account no longer exists.', 401);
      const nextName = name && name !== user.name ? checkName(name) : user.name;
      if (users.some((u) => u !== user && sameName(u.name, nextName))) fail('That name is taken.', 409);
      if (!newPassword && user.mustChange) fail('Pick a new password.');
      if (!newPassword && nextName === user.name) fail('Nothing to change.');
      if (newPassword) {
        const problem = passwordProblem(newPassword, nextName);
        if (problem) fail(problem);
        if (await verifyPassword(newPassword, user.hash)) fail('The new password must differ from the old one.');
        user.hash = await hashPassword(newPassword);
        delete user.mustChange;
        delete user.defaultAccount;
      }
      user.name = nextName;
      saveUsers(this.vault, users);
      for (const [id, s] of this.sessions) if (s.name === session.name) this.sessions.delete(id);
      return this.open(user);
    });
  }

  actorAndTarget(users, session, name) {
    const ranks = loadRanks(this.vault);
    const find = (n) => users.find((u) => u.name === n);
    // read again inside the queue: the actor may have lost rights since the request started
    const me = find(session.name) || fail('Your account no longer exists.', 401);
    const user = name === undefined ? null : find(name) || fail('No such account.', 404);
    const view = (u) => u && { name: u.name, rank: u.rank, perms: effective(u, ranks) };
    return { ranks, me, user, actor: view(me), target: view(user) };
  }

  // The staff page: every account with each tick, where it comes from and why it is locked.
  staff(session) {
    const users = loadUsers(this.vault);
    const { ranks, actor } = this.actorAndTarget(users, session);
    const online = (name) => [...this.sessions.values()].some((s) => s.name === name && this.now() <= s.until && this.now() - s.seen <= this.idleMs);
    return {
      create: creatableRanks(actor),
      accounts: users.map((u) => {
        const target = { name: u.name, rank: u.rank, perms: effective(u, ranks) };
        const base = rankSet(u.rank, ranks);
        return {
          name: u.name, rank: u.rank, mustChange: !!u.mustChange, online: online(u.name),
          blocked: Object.fromEntries(['reset', 'remove', 'rank', 'transfer'].map((op) => [op, accountBlock(actor, target, op)])),
          ticks: Object.values(PERMISSIONS).map((p) => ({
            id: p.id, on: target.perms.has(p.id),
            source: u.rank !== 'owner' && u.grants.includes(p.id) ? 'added' : u.rank !== 'owner' && u.denies.includes(p.id) ? 'removed' : base.has(p.id) ? 'rank' : '',
            locked: tickBlock(actor, target, p.id)
          }))
        };
      })
    };
  }

  // Registers an account. The password given here is temporary.
  addUser(session, { name, rank, password }) {
    return this.exclusive(async () => {
      const hash = await this.newPassword(password, checkName(name));
      const users = loadUsers(this.vault);
      const { ranks, actor } = this.actorAndTarget(users, session);
      if (!creatableRanks(actor).includes(rank)) fail('You cannot register an account of that rank.', 403);
      if (users.some((u) => sameName(u.name, name))) fail('That name is taken.', 409);
      if (users.length >= 200) fail('Too many accounts.');
      // whoever registers an account knows its first password: it starts with nothing they lack
      const denies = [...rankSet(rank, ranks)].filter((id) => !actor.perms.has(id));
      saveUsers(this.vault, [...users, { name, rank, hash, mustChange: true, grants: [], denies }]);
      return { held: denies };
    });
  }

  async newPassword(password, name) {
    const problem = passwordProblem(password, name);
    if (problem) fail(problem);
    return hashPassword(password);
  }

  resetPassword(session, name, password) {
    return this.exclusive(async () => {
      const hash = await this.newPassword(password, String(name));
      const users = loadUsers(this.vault);
      const { user, actor, target } = this.actorAndTarget(users, session, String(name));
      const no = accountBlock(actor, target, 'reset');
      if (no) fail(no, 403);
      Object.assign(user, { hash, mustChange: true });
      delete user.defaultAccount;
      saveUsers(this.vault, users);
    });
  }

  removeUser(session, name) {
    return this.exclusive(async () => {
      const users = loadUsers(this.vault);
      const { actor, target } = this.actorAndTarget(users, session, String(name));
      const no = accountBlock(actor, target, 'remove');
      if (no) fail(no, 403);
      saveUsers(this.vault, users.filter((u) => u.name !== target.name));
    });
  }

  setRank(session, name, rank) {
    return this.exclusive(async () => {
      const users = loadUsers(this.vault);
      const { ranks, user, actor, target } = this.actorAndTarget(users, session, String(name));
      const no = accountBlock(actor, target, 'rank');
      if (no) fail(no, 403);
      // there is exactly one server owner; that rank only moves by handing it over
      if (!EDITABLE_RANKS.includes(rank)) fail('Pick admin, senior mod or junior mod.');
      user.rank = rank;
      tidy(user, ranks);
      saveUsers(this.vault, users);
    });
  }

  transferOwner(session, name) {
    return this.exclusive(async () => {
      const users = loadUsers(this.vault);
      const { me, user, actor, target } = this.actorAndTarget(users, session, String(name));
      const no = accountBlock(actor, target, 'transfer');
      if (no) fail(no, 403);
      if (user.rank !== 'admin') fail('Ownership can only go to an admin.');
      if (user.mustChange || user.defaultAccount) fail('That admin has not set their own password yet.');
      Object.assign(user, { rank: 'owner', grants: [], denies: [] });
      Object.assign(me, { rank: 'admin', grants: [], denies: [] });
      saveUsers(this.vault, users);
    });
  }

  // changes is { permission: true | false }. All of them are allowed, or none is applied.
  setTicks(session, name, changes) {
    return this.exclusive(async () => {
      const list = changes && typeof changes === 'object' && !Array.isArray(changes) ? Object.entries(changes) : [];
      if (!list.length || list.length > 100) fail('Nothing to change.');
      const users = loadUsers(this.vault);
      const { ranks, user, actor, target } = this.actorAndTarget(users, session, String(name));
      const base = rankSet(user.rank, ranks);
      for (const [id, on] of list) {
        if (typeof on !== 'boolean') fail('A tick is on or off.');
        const no = tickBlock(actor, target, id);
        if (no) fail(`${isPermission(id) ? PERMISSIONS[id].label : 'Permission'}: ${no}`, 403);
        user.grants = user.grants.filter((x) => x !== id);
        user.denies = user.denies.filter((x) => x !== id);
        if (on && !base.has(id)) user.grants.push(id);
        if (!on && base.has(id)) user.denies.push(id);
      }
      saveUsers(this.vault, users);
    });
  }

  // Removes personal ticks, as far as the actor is allowed to change each of them.
  resetTicks(session, name) {
    return this.exclusive(async () => {
      const users = loadUsers(this.vault);
      const { user, actor, target } = this.actorAndTarget(users, session, String(name));
      const personal = [...user.grants, ...user.denies];
      if (!personal.length) fail('This account has no personal ticks.');
      for (const id of personal) {
        const no = tickBlock(actor, target, id);
        if (no) fail(`${PERMISSIONS[id].label}: ${no}`, 403);
      }
      Object.assign(user, { grants: [], denies: [] });
      saveUsers(this.vault, users);
    });
  }

  ranks() {
    const current = loadRanks(this.vault);
    return EDITABLE_RANKS.map((rank) => ({
      rank, name: RANKS[rank].name,
      ticks: Object.values(PERMISSIONS).map((p) => ({ id: p.id, on: current[rank].includes(p.id) || p.class === 'A',
        locked: !eligible(rank, p.id) ? 'Not available to this rank.' : !assignable(p.id) ? 'Fixed.' : null }))
    }));
  }

  // The server owner changes what a rank gets by default.
  setRankDefaults(session, rank, changes) {
    return this.exclusive(async () => {
      const users = loadUsers(this.vault);
      const { ranks, actor } = this.actorAndTarget(users, session);
      if (actor.rank !== 'owner') fail('Only the server owner changes rank defaults.', 403);
      if (!EDITABLE_RANKS.includes(rank)) fail('Unknown rank.');
      const list = changes && typeof changes === 'object' && !Array.isArray(changes) ? Object.entries(changes) : [];
      if (!list.length || list.length > 100) fail('Nothing to change.');
      const set = new Set(ranks[rank]);
      for (const [id, on] of list) {
        if (typeof on !== 'boolean' || !assignable(id) || !eligible(rank, id)) fail('That tick cannot be set for this rank.');
        if (on) set.add(id);
        else set.delete(id);
      }
      saveRanks(this.vault, { ...ranks, [rank]: [...set] });
      for (const user of users) if (user.rank !== 'owner') tidy(user, loadRanks(this.vault));
      saveUsers(this.vault, users);
    });
  }
}
