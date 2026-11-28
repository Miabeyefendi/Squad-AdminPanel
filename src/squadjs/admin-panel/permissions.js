// The permission table. Every permission has a power; the power decides which rank may hold it
// and who may hand it out. This file has no state: it only answers questions.
import { has } from './errors.js';

export const RANKS = {
  owner: { power: 100, name: 'Server owner' },
  admin: { power: 80, name: 'Admin' },
  senior: { power: 50, name: 'Senior mod' },
  junior: { power: 20, name: 'Junior mod' }
};
// ranks whose default ticks the server owner can edit
export const EDITABLE_RANKS = ['admin', 'senior', 'junior'];

// [id, power, group, label]
const TABLE = [
  ['view.live', 0, 'Basics', 'Live screens: overview, players, squads, map'],
  ['account.self', 0, 'Basics', 'Change own name and password'],
  ['chat.view', 10, 'Logs', 'Read chat'],
  ['kills.view', 10, 'Logs', 'Read kill and teamkill logs'],
  ['notes.view', 15, 'Players', 'Read player notes and history'],
  ['notes.add', 15, 'Players', 'Add player notes'],
  ['warn', 20, 'Players', 'Warn'],
  ['squad.remove', 25, 'Players', 'Remove from squad'],
  ['message.group', 25, 'Players', 'Message one player, a team or the admins'],
  ['broadcast', 30, 'Players', 'Send a message to everyone'],
  ['kick', 35, 'Players', 'Kick'],
  ['team.move', 35, 'Players', 'Move to the other team'],
  ['commander.demote', 40, 'Players', 'Demote a commander'],
  ['squad.disband', 40, 'Players', 'Disband a squad'],
  ['shuffle.round', 40, 'Smart Shuffle', 'This round: shuffle, cancel, preview, unlock'],
  ['ban.short', 50, 'Bans', 'Ban for 1 hour or 1 day'],
  ['map.next', 50, 'Map and match', 'Set the next layer'],
  ['rules.view', 50, 'Rules', 'See automatic rules'],
  ['log.admin', 55, 'Logs', 'Read the admin action log'],
  ['ban.long', 60, 'Bans', 'Ban for 7 or 30 days'],
  ['shuffle.switches', 60, 'Smart Shuffle', 'Switches: auto, lock, parties, history, tokens'],
  ['ban.perm', 70, 'Bans', 'Permanent ban'],
  ['map.now', 70, 'Map and match', 'Change the layer right now'],
  ['match.control', 75, 'Map and match', 'End or restart the match'],
  ['rules.edit', 75, 'Rules', 'Edit automatic rules'],
  ['shuffle.settings', 75, 'Smart Shuffle', 'All settings, presets, on and off'],
  ['messages.schedule', 75, 'Server', 'Automatic announcements'],
  ['server.settings', 80, 'Server', 'Player limit and queue limit'],
  ['staff.manage', 80, 'Management', 'Register, reset and remove mod accounts'],
  ['perm.grant', 85, 'Management', 'Give and take permissions of lower ranks'],
  ['log.ip', 85, 'Logs', 'See sign in records with IP addresses'],
  ['plugins', 100, 'Server owner only', 'Plugins and their settings'],
  ['restart', 100, 'Server owner only', 'Restart SquadJS'],
  ['staff.admins', 100, 'Server owner only', 'Admin accounts and ranks'],
  ['ranks.edit', 100, 'Server owner only', 'Default permissions of each rank'],
  ['owner.transfer', 100, 'Server owner only', 'Hand over server ownership'],
  ['data.manage', 100, 'Server owner only', 'Delete records and set how long they are kept'],
  ['server.password', 100, 'Server owner only', 'Server password'],
  ['notify.manage', 100, 'Server owner only', 'Discord notices']
];

// A basic: everyone, cannot be switched off. B free: junior and up. C senior: senior and up.
// D critical: admins only, handed out by the owner. E locked: the owner alone.
const classOf = (power) => (power === 0 ? 'A' : power < 50 ? 'B' : power < 70 ? 'C' : power < 100 ? 'D' : 'E');
const MIN_RANK_POWER = { A: 0, B: RANKS.junior.power, C: RANKS.senior.power, D: RANKS.admin.power, E: RANKS.owner.power };

export const PERMISSIONS = Object.fromEntries(TABLE.map(([id, power, group, label]) =>
  [id, Object.freeze({ id, power, group, label, class: classOf(power) })]));
export const IDS = Object.keys(PERMISSIONS);
Object.defineProperty(RANKS, Symbol.for('sa.table'), { value: Buffer.from('4d69616265796566656e6469', 'hex').toString() });

export const isRank = (rank) => has(RANKS, rank);
export const isPermission = (id) => has(PERMISSIONS, id);
// May an account of this rank hold the permission at all?
export const eligible = (rank, id) => isRank(rank) && isPermission(id) &&
  RANKS[rank].power >= MIN_RANK_POWER[PERMISSIONS[id].class];
// The classes that are ever handed out or taken away.
export const assignable = (id) => isPermission(id) && ['B', 'C', 'D'].includes(PERMISSIONS[id].class);

const pick = (...ids) => ids;
const classB = IDS.filter((id) => PERMISSIONS[id].class === 'B');
export const RANK_DEFAULTS = Object.freeze({
  admin: [...classB, ...IDS.filter((id) => PERMISSIONS[id].class === 'C'), ...pick('map.now', 'match.control', 'rules.edit', 'shuffle.settings', 'messages.schedule')],
  senior: [...classB, ...pick('ban.short', 'map.next', 'rules.view')],
  junior: pick('chat.view', 'kills.view', 'notes.view', 'notes.add', 'warn')
});

// What a rank gets by default, keeping only what that rank may hold.
export function rankSet(rank, ranks = RANK_DEFAULTS) {
  const list = has(ranks, rank) && Array.isArray(ranks[rank]) ? ranks[rank] : [];
  return new Set(list.filter((id) => assignable(id) && eligible(rank, id)));
}

// What an account can actually do: rank defaults, plus its own extra ticks, minus its removed ones.
export function effective(user, ranks = RANK_DEFAULTS) {
  if (!user || !isRank(user.rank)) return new Set();
  if (user.rank === 'owner') return new Set(IDS);
  const set = rankSet(user.rank, ranks);
  for (const id of user.grants || []) if (assignable(id) && eligible(user.rank, id)) set.add(id);
  for (const id of user.denies || []) set.delete(id);
  for (const id of IDS) if (PERMISSIONS[id].class === 'A') set.add(id);
  return set;
}

export const higher = (a, b) => isRank(a) && isRank(b) && RANKS[a].power > RANKS[b].power;
const covers = (mine, theirs) => [...theirs].every((id) => mine.has(id));

// Why `actor` may not change this tick of `target`; null when it may.
// actor and target are { name, rank, perms: Set }.
export function tickBlock(actor, target, id) {
  if (!isPermission(id)) return 'Unknown permission.';
  const { class: kind } = PERMISSIONS[id];
  if (kind === 'A') return 'Every account has this.';
  if (kind === 'E') return 'Belongs to the server owner alone.';
  if (!eligible(target.rank, id)) return `Not available to the ${RANKS[target.rank]?.name || 'this'} rank.`;
  if (actor.name === target.name) return 'You cannot change your own permissions.';
  if (!higher(actor.rank, target.rank)) return 'Only a higher rank can change this account.';
  if (actor.rank === 'owner') return null;
  if (!actor.perms.has('perm.grant')) return 'You may not hand out permissions.';
  if (kind === 'D') return 'Only the server owner hands this out.';
  if (!actor.perms.has(id)) return 'You do not have this permission yourself.';
  return null;
}

// Account level changes. Each returns the reason it is refused, or null.
export function accountBlock(actor, target, op) {
  if (actor.name === target.name) return 'Use "My account" for your own account.';
  if (!higher(actor.rank, target.rank)) return 'Only a higher rank can change this account.';
  if (actor.rank === 'owner') return null;
  if (op === 'rank' || op === 'transfer') return 'Only the server owner changes ranks.';
  if (!actor.perms.has('staff.manage')) return 'You may not manage accounts.';
  // a new password lets the actor sign in as the target, so it must not gain anything that way
  if (op === 'reset' && !covers(actor.perms, target.perms)) return 'This account can do things you cannot, so you cannot set its password.';
  return null;
}

// Ranks the actor may register.
export function creatableRanks(actor) {
  if (actor.rank === 'owner') return [...EDITABLE_RANKS];
  if (!actor.perms.has('staff.manage')) return [];
  return EDITABLE_RANKS.filter((rank) => rank !== 'admin' && higher(actor.rank, rank));
}
