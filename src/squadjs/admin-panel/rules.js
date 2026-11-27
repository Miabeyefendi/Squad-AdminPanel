// Automatic rules. All of them are off until an admin switches them on. Server admins are exempt.
import { BAN_LENGTHS, accepted, cleanText } from './actions.js';
import { PanelError, has } from './errors.js';

export const RULE_DEFAULTS = {
  teamkill: { enabled: false, windowMinutes: 10, warnAt: 1, kickAt: 3, banAt: 0, banLength: '1d',
    warnMessage: 'No teamkilling. Apologise in chat.' },
  squadless: { enabled: false, warnAfterMinutes: 5, kickAfterMinutes: 10, minPlayers: 30,
    warnMessage: 'Join a squad or you will be kicked.' },
  chatFilter: { enabled: false, words: [], kickAt: 2, banAt: 3, banLength: '7d',
    warnMessage: 'Keep the chat clean.' },
  nameFilter: { enabled: false, patterns: [], kickAfterMinutes: 2,
    warnMessage: 'Your name is not allowed here. Change it before you are kicked.' },
  slKit: { enabled: false, warnAfterMinutes: 3, removeAfterMinutes: 0, minPlayers: 30,
    warnMessage: 'Squad leaders have to take the squad leader kit.' },
  lockedSquad: { enabled: false, minMembers: 3, warnAfterMinutes: 5, disbandAfterMinutes: 0, minPlayers: 40,
    warnMessage: 'Your locked squad is too small. Unlock it or it will be disbanded.' }
};
// "USA_SL_01", "RGF_SLCrewman_01" and "BAF_SLPilot_01" are squad leader kits
export const isLeaderKit = (role) => /(^|[_ ])SL/.test(String(role));

// Accepts only known fields with the right type. Returns a new rules object.
export function mergeRules(current, patch) {
  const next = structuredClone(current);
  for (const [name, fields] of Object.entries(patch || {})) {
    if (!has(RULE_DEFAULTS, name)) throw new PanelError(`Unknown rule ${String(name).slice(0, 40)}.`);
    if (!fields || typeof fields !== 'object') throw new PanelError('Rule fields are missing.');
    for (const [key, value] of Object.entries(fields)) {
      if (!has(RULE_DEFAULTS[name], key)) throw new PanelError(`Unknown field ${name}.${String(key).slice(0, 40)}.`);
      const dflt = RULE_DEFAULTS[name][key];
      if (Array.isArray(dflt)) {
        if (!Array.isArray(value)) throw new PanelError(`${key} must be a list.`);
        next[name][key] = value.map((v) => String(v).trim()).filter(Boolean).slice(0, 500);
      } else if (typeof dflt === 'number') {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 10000) throw new PanelError(`${key} must be a number from 0 to 10000.`);
        next[name][key] = n;
      } else if (typeof dflt === 'boolean') {
        if (typeof value !== 'boolean') throw new PanelError(`${key} must be on or off.`);
        next[name][key] = value;
      } else {
        if (key === 'banLength' && !BAN_LENGTHS.includes(value)) throw new PanelError('Invalid ban length.');
        next[name][key] = cleanText(value);
      }
    }
  }
  return next;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const wordHit = (message, words) =>
  words.find((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(w)}($|[^\\p{L}\\p{N}])`, 'iu').test(message));

export class Rules {
  constructor({ server, store, now = Date.now }) {
    Object.assign(this, { server, store, now });
    this.config = store.loadRules(RULE_DEFAULTS);
    this.teamkills = new Map();
    this.chatHits = new Map();
    this.squadless = new Map();
    this.badNames = new Map();
    this.noKit = new Map();
    this.locked = new Map();
  }

  update(patch) {
    this.config = mergeRules(this.config, patch);
    this.store.saveRules(this.config);
    return this.config;
  }

  exempt(id) {
    return !!this.server.getAdminPermsByAnyID(id);
  }

  async punish(rule, player, step, reason, length) {
    const id = player.eosID;
    try {
      // the id comes from the game log and the text from settings: both are checked again before RCON
      if (!/^[0-9a-f]{32}$/i.test(String(id))) throw new Error('Invalid player ID.');
      reason = cleanText(reason);
      if (step === 'warn') await accepted(this.server.rcon.warn(id, reason));
      else if (step === 'remove') await accepted(this.server.rcon.execute(`AdminRemovePlayerFromSquadById ${Number(player.playerID)}`));
      else if (step === 'kick') await accepted(this.server.rcon.execute(`AdminKick "${id}" ${reason}`));
      else await accepted(this.server.rcon.ban(id, length, reason));
      // leaving a squad is no punishment on record, it only shows in the log
      if (step !== 'remove') this.store.record(id, step, { by: `Auto: ${rule}`, reason, detail: step === 'ban' ? length : '', name: player.name });
      const action = step === 'ban' ? `Ban ${length === '0' ? 'permanent' : length}` : step === 'kick' ? 'Kick'
        : step === 'remove' ? 'Remove from squad' : 'Warn';
      this.store.log('admin', { by: `Auto: ${rule}`, action, target: player.name, reason });
    } catch (err) {
      this.store.log('admin', { by: `Auto: ${rule}`, action: 'Failed', target: player.name, reason: err.message });
    }
  }

  // The highest step that applies to this count. 0 switches a step off.
  step(count, { kickAt, banAt }, warnAt = 1) {
    if (banAt > 0 && count >= banAt) return 'ban';
    if (kickAt > 0 && count >= kickAt) return 'kick';
    return warnAt > 0 && count >= warnAt ? 'warn' : null;
  }

  async onTeamkill(info) {
    const rule = this.config.teamkill;
    const player = info.attacker;
    if (!rule.enabled || !player?.eosID || this.exempt(player.eosID)) return;
    const since = this.now() - rule.windowMinutes * 60000;
    const times = [...(this.teamkills.get(player.eosID) || []).filter((t) => t >= since), this.now()];
    this.teamkills.set(player.eosID, times);
    const step = this.step(times.length, rule, rule.warnAt);
    if (step) {
      const reason = step === 'warn' ? rule.warnMessage : `Teamkilling (${times.length} in ${rule.windowMinutes} min)`;
      await this.punish('Teamkill limit', player, step, reason, rule.banLength);
    }
  }

  async onChat(info) {
    const rule = this.config.chatFilter;
    const player = info.player;
    if (!rule.enabled || !player?.eosID || info.chat === 'ChatAdmin' || this.exempt(player.eosID)) return;
    if (!wordHit(info.message, rule.words)) return;
    const count = (this.chatHits.get(player.eosID) || 0) + 1;
    this.chatHits.set(player.eosID, count);
    const step = this.step(count, rule);
    await this.punish('Chat filter', player, step, step === 'warn' ? rule.warnMessage : 'Chat rules', rule.banLength);
  }

  // Called after every player list update.
  async onPlayers() {
    const online = new Set(this.server.players.map((p) => p.eosID));
    for (const map of [this.squadless, this.badNames, this.noKit]) for (const id of map.keys()) if (!online.has(id)) map.delete(id);
    for (const player of this.server.players) {
      await this.checkSquadless(player);
      await this.checkName(player);
      await this.checkLeaderKit(player);
    }
    await this.checkLockedSquads();
  }

  async checkLeaderKit(player) {
    const rule = this.config.slKit;
    const id = player.eosID;
    const applies = rule.enabled && player.isLeader && player.squadID !== null && !!player.role &&
      !isLeaderKit(player.role) && this.server.players.length >= rule.minPlayers && !this.exempt(id);
    if (!applies) {
      this.noKit.delete(id);
      return;
    }
    const s = this.noKit.get(id) || { since: this.now(), warned: false, removed: false };
    this.noKit.set(id, s);
    const minutes = (this.now() - s.since) / 60000;
    if (rule.removeAfterMinutes > 0 && minutes >= rule.removeAfterMinutes && !s.removed) {
      s.removed = true;
      await this.punish('Squad leader kit', player, 'remove', 'No squad leader kit');
    } else if (minutes >= rule.warnAfterMinutes && !s.warned) {
      s.warned = true;
      await this.punish('Squad leader kit', player, 'warn', rule.warnMessage);
    }
  }

  async checkLockedSquads() {
    const rule = this.config.lockedSquad;
    const seen = new Set();
    if (rule.enabled && this.server.players.length >= rule.minPlayers) {
      for (const squad of this.server.squads) {
        // the commander's squad is meant to be small
        if (squad.locked !== 'True' || /^command squad$/i.test(String(squad.squadName).trim())) continue;
        const inside = this.server.players.filter((p) => p.teamID === squad.teamID && p.squadID === squad.squadID);
        if (!inside.length || inside.length >= rule.minMembers) continue;
        const leader = inside.find((p) => p.isLeader);
        if (!leader || this.exempt(leader.eosID)) continue;
        const key = `${squad.teamID}:${squad.squadID}:${squad.squadName}`;
        seen.add(key);
        const s = this.locked.get(key) || { since: this.now(), warned: false, done: false };
        this.locked.set(key, s);
        const minutes = (this.now() - s.since) / 60000;
        if (rule.disbandAfterMinutes > 0 && minutes >= rule.disbandAfterMinutes && !s.done) {
          s.done = true;
          await this.disband(squad, leader);
        } else if (minutes >= rule.warnAfterMinutes && !s.warned) {
          s.warned = true;
          await this.punish('Locked squad', leader, 'warn', rule.warnMessage);
        }
      }
    }
    for (const key of this.locked.keys()) if (!seen.has(key)) this.locked.delete(key);
  }

  async disband(squad, leader) {
    const by = 'Auto: Locked squad';
    const target = `Team ${Number(squad.teamID)} squad ${Number(squad.squadID)} (${leader.name})`;
    try {
      await accepted(this.server.rcon.execute(`AdminDisbandSquad ${Number(squad.teamID)} ${Number(squad.squadID)}`));
      this.store.log('admin', { by, action: 'Disband squad', target, reason: 'Locked and too small' });
    } catch (err) {
      this.store.log('admin', { by, action: 'Failed', target, reason: err.message });
    }
  }

  async checkSquadless(player) {
    const rule = this.config.squadless;
    const id = player.eosID;
    const applies = rule.enabled && player.squadID === null && this.server.players.length >= rule.minPlayers &&
      !this.exempt(id);
    if (!applies) {
      this.squadless.delete(id);
      return;
    }
    const s = this.squadless.get(id) || { since: this.now(), warned: false, kicked: false };
    this.squadless.set(id, s);
    const minutes = (this.now() - s.since) / 60000;
    if (rule.kickAfterMinutes > 0 && minutes >= rule.kickAfterMinutes && !s.kicked) {
      s.kicked = true;
      await this.punish('Squadless player', player, 'kick', 'Not in a squad');
    } else if (rule.warnAfterMinutes > 0 && minutes >= rule.warnAfterMinutes && !s.warned) {
      s.warned = true;
      await this.punish('Squadless player', player, 'warn', rule.warnMessage);
    }
  }

  async checkName(player) {
    const rule = this.config.nameFilter;
    const id = player.eosID;
    const name = String(player.name).toLowerCase();
    if (!rule.enabled || this.exempt(id) || !rule.patterns.some((p) => name.includes(p.toLowerCase()))) {
      this.badNames.delete(id);
      return;
    }
    const s = this.badNames.get(id);
    if (!s) {
      this.badNames.set(id, { since: this.now(), kicked: false });
      await this.punish('Name filter', player, 'warn', rule.warnMessage);
    } else if (!s.kicked && this.now() - s.since >= rule.kickAfterMinutes * 60000) {
      s.kicked = true;
      await this.punish('Name filter', player, 'kick', 'Name not allowed');
    }
  }
}
