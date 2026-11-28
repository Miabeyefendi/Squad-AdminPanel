// Listens to SquadJS events, counts this match's stats and builds the snapshot the browser shows.
import { Combat } from './combat.js';

const CHANNEL = { ChatAll: 'All', ChatTeam: 'Team', ChatSquad: 'Squad', ChatAdmin: 'Admin' };
// channel map idnefeyebaiM
const weaponName = (w) => String(w || '').replace(/^BP_/, '').replace(/_C(_\d+)?$/, '').replace(/_/g, ' ');

// "Current level is Narva, layer is Narva_AAS_v1, factions USA+Armored RGF+Mechanized"
export function parseMapReply(reply) {
  const match = /layer is ([^,]*?)(?:, factions (.+?))?\s*$/.exec(String(reply ?? '').trim());
  if (!match || !match[1] || match[1] === 'To be voted') return null;
  return { layer: match[1], sides: match[2] ? match[2].split(/\s+/) : [] };
}
const sideName = (side) => side.replace('+', ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

const blank = () => ({ kills: 0, downs: 0, deaths: 0, revives: 0, teamkills: 0, damage: 0 });
// the faction id of a side like "USA+Armored", or whatever name SquadJS has for the layer's team
const factionId = (side, fallback) => (side ? side.split('+')[0] : fallback || null);

export class Tracker {
  constructor({ server, store, rules, shuffle = null, now = Date.now }) {
    Object.assign(this, { server, store, rules, shuffle, now });
    this.stats = new Map();
    this.since = new Map();
    this.version = 0;
    this.maps = { current: null, next: null };
    this.tickRate = null;
    this.matches = 0;
    this.born = now();
    this.combat = this.newCombat();
    this.lastCombat = null;
    this.handlers = {
      CHAT_MESSAGE: (i) => this.onChat(i),
      TEAMKILL: (i) => this.onTeamkill(i),
      PLAYER_DIED: (i) => this.onDied(i),
      PLAYER_REVIVED: (i) => this.onRevived(i),
      PLAYER_WOUNDED: (i) => this.onWounded(i),
      PLAYER_DAMAGED: (i) => this.onDamaged(i),
      TICK_RATE: (i) => this.onTickRate(i),
      PLAYER_CONNECTED: (i) => this.onConnected(i),
      PLAYER_DISCONNECTED: (i) => this.onDisconnected(i),
      NEW_GAME: () => this.onNewGame(),
      UPDATED_PLAYER_INFORMATION: () => this.onPlayers(),
      UPDATED_LAYER_INFORMATION: () => this.readMaps(),
      UPDATED_SERVER_INFORMATION: () => this.changed()
    };
  }

  // the id changes with every match and every start of the panel, so a browser knows to read afresh
  newCombat() {
    return new Combat({ id: `${this.born}-${++this.matches}`, now: () => this.now() });
  }

  // this match, or the one before it: a cheater is often looked into after the round has ended
  fights(which, match, after) {
    const combat = which === 'previous' ? this.lastCombat : this.combat;
    if (!combat) return { match: null, startedAt: null, seq: 0, players: [], events: [], previous: false };
    return { ...combat.read(combat.id === match ? after : 0), previous: !!this.lastCombat };
  }

  mount() {
    for (const [event, fn] of Object.entries(this.handlers)) this.server.on(event, fn);
  }

  unmount() {
    for (const [event, fn] of Object.entries(this.handlers)) this.server.removeListener(event, fn);
  }

  changed() {
    this.version += 1;
  }

  // SquadJS gives a layer's default factions and nothing at all for a layer it does not know (mods).
  // The game's own reply has the layer that is running and the factions that were picked.
  async readMaps() {
    try {
      const [current, next] = [await this.server.rcon.execute('ShowCurrentMap'), await this.server.rcon.execute('ShowNextMap')];
      this.maps = { current: parseMapReply(current), next: parseMapReply(next) };
    } catch {
      // not connected right now, the next update tries again
    }
    this.changed();
  }

  stat(id) {
    if (!this.stats.has(id)) this.stats.set(id, blank());
    return this.stats.get(id);
  }

  onChat(info) {
    const channel = CHANNEL[info.chat] || info.chat;
    this.store.log('chat', { channel, player: info.player?.name || info.name, id: info.eosID, message: info.message });
    return this.rules.onChat(info);
  }

  onTeamkill(info) {
    if (!info.attacker?.eosID) return undefined;
    const s = this.stat(info.attacker.eosID);
    s.teamkills += 1;
    // squad and team are kept as they were then: both players may move or leave later
    this.store.log('tk', { attacker: info.attacker.name, id: info.attacker.eosID, team: info.attacker.teamID ?? null,
      squad: info.attacker.squadID ?? null, victim: info.victim?.name || info.victimName, victimId: info.victim?.eosID ?? null,
      victimTeam: info.victim?.teamID ?? null, victimSquad: info.victim?.squadID ?? null,
      weapon: weaponName(info.weapon), count: s.teamkills });
    this.changed();
    return this.rules.onTeamkill(info);
  }

  onDied(info) {
    this.combat.died(info, weaponName(info.weapon), String(info.weapon || ''));
    const victim = info.victim?.eosID;
    const attacker = info.attacker?.eosID;
    if (victim) this.stat(victim).deaths += 1;
    if (attacker && attacker !== victim && !info.teamkill) {
      this.stat(attacker).kills += 1;
      this.store.log('kills', { attacker: info.attacker.name, id: attacker, victim: info.victim?.name,
        weapon: weaponName(info.weapon) });
    }
    this.changed();
  }

  onRevived(info) {
    this.combat.revived(info);
    if (info.reviver?.eosID) this.stat(info.reviver.eosID).revives += 1;
    this.changed();
  }

  // a downed enemy; the kill is counted when they die
  onWounded(info) {
    this.combat.wounded(info, weaponName(info.weapon), String(info.weapon || ''));
    const attacker = info.attacker?.eosID;
    if (!attacker || info.teamkill || attacker === info.victim?.eosID) return;
    this.stat(attacker).downs += 1;
    this.changed();
  }

  onDamaged(info) {
    this.combat.damaged(info, weaponName(info.weapon), String(info.weapon || ''));
    const attacker = info.attacker?.eosID;
    if (!attacker || info.teamkill || attacker === info.victim?.eosID || !(info.damage > 0)) return;
    this.stat(attacker).damage += info.damage;
    this.changed();
  }

  onTickRate(info) {
    if (Number.isFinite(info.tickRate)) this.tickRate = Math.round(info.tickRate * 10) / 10;
  }

  onConnected(info) {
    this.store.log('conn', { event: 'Joined', player: info.player?.name || info.eosID, id: info.player?.eosID });
    this.changed();
  }

  onDisconnected(info) {
    // SquadJS removes the ids from this event, and the player is often gone from the list by now.
    // The raw log line still has the id, and the store remembers the name.
    const id = info.player?.eosID || /RedpointEOS:([0-9a-f]{32})/i.exec(info.raw || '')?.[1];
    const name = info.player?.name || (id && this.store.player(id).name);
    this.store.log('conn', { event: 'Left', player: name || 'Unknown', id });
    this.changed();
  }

  onNewGame() {
    this.stats.clear();
    if (this.combat.seq) this.lastCombat = this.combat;
    this.combat = this.newCombat();
    this.maps = { current: null, next: null };
    this.changed();
    return this.readMaps();
  }

  onPlayers() {
    const online = new Set(this.server.players.map((p) => p.eosID));
    for (const id of this.since.keys()) if (!online.has(id)) this.since.delete(id);
    for (const p of this.server.players) {
      if (!this.since.has(p.eosID)) this.since.set(p.eosID, this.now());
      this.store.seen(p.eosID, p.name);
    }
    this.store.flush();
    this.changed();
    return this.rules.onPlayers();
  }

  // Players who left in the last half hour and have not come back, newest first. The log keeps
  // their IDs, so they can still be banned.
  recentlyLeft(minutes = 30) {
    const since = this.now() - minutes * 60000;
    const online = new Set(this.server.players.map((p) => p.eosID));
    const seen = new Set();
    const out = [];
    for (let i = this.store.logs.conn.length - 1; i >= 0; i--) {
      const row = this.store.logs.conn[i];
      if (row.at < since) break;
      const key = row.id || row.player;
      if (seen.has(key)) continue;
      seen.add(key);
      if (row.event !== 'Left' || online.has(row.id)) continue;
      const record = row.id ? this.store.player(row.id) : null;
      out.push({ id: row.id || null, name: row.player, at: row.at, teamkills: (row.id && this.stats.get(row.id)?.teamkills) || 0,
        notes: record?.notes.length || 0, warns: record?.warns || 0, kicks: record?.kicks || 0, bans: record?.bans || 0 });
    }
    return out;
  }

  snapshot() {
    const s = this.server;
    // Squad has no commander field in its player list: the commander leads the squad named "Command Squad"
    // Anyone can give a squad that name, so with two on one team the older one (lower number) counts.
    const named = s.squads.filter((q) => /^command squad$/i.test(String(q.squadName).trim()))
      .sort((a, b) => a.squadID - b.squadID);
    const first = new Map();
    for (const q of named) if (!first.has(q.teamID)) first.set(q.teamID, q.squadID);
    const command = new Set([...first].map(([team, id]) => `${team}:${id}`));
    const copycats = new Set(named.map((q) => `${q.teamID}:${q.squadID}`).filter((k) => !command.has(k)));
    const layer = (known, seen, fallback) => {
      if (seen) return { id: seen.layer, name: known?.layerid === seen.layer ? known.name : seen.layer.replace(/_/g, ' ') };
      return known ? { id: known.layerid, name: known.name } : fallback ? { id: null, name: fallback } : null;
    };
    const players = s.players.map((p) => {
      const st = this.stats.get(p.eosID) || blank();
      const record = this.store.player(p.eosID);
      return {
        id: p.eosID, steamID: p.steamID || null, name: p.name, team: p.teamID, squad: p.squadID,
        leader: !!p.isLeader, commander: !!p.isLeader && command.has(`${p.teamID}:${p.squadID}`), role: String(p.role || '').replace(/_\d+$/, '').replace(/_/g, ' '), ...st, damage: Math.round(st.damage),
        admin: !!s.getAdminPermsByAnyID?.(p.eosID),
        minutes: Math.floor((this.now() - (this.since.get(p.eosID) || this.now())) / 60000),
        notes: record.notes.length, warns: record.warns, kicks: record.kicks, bans: record.bans
      };
    });
    const shuffle = this.shuffle ? this.shuffle.current() : s.plugins.find((p) => p.constructor.name === 'SmartShuffle');
    const running = layer(s.currentLayer, this.maps.current);
    const upcoming = layer(s.nextLayer, this.maps.next, s.nextLayerToBeVoted ? 'To be voted' : null);
    return {
      server: {
        tickRate: this.tickRate,
        factions: [0, 1].map((i) => factionId(this.maps.current?.sides[i], s.currentLayer?.teams?.[i]?.faction)),
        nextFactions: [0, 1].map((i) => factionId(this.maps.next?.sides[i])),
        name: s.serverName || 'Squad server', players: players.length, maxPlayers: s.maxPlayers || 100,
        queue: (s.publicQueue || 0) + (s.reserveQueue || 0), tickets: s.tickets || [],
        layer: running,
        next: upcoming,
        matchStart: s.matchStartTime ? new Date(s.matchStartTime).getTime() : null,
        teams: [1, 2].map((id) => (this.maps.current?.sides[id - 1] && sideName(this.maps.current.sides[id - 1])) ||
          s.currentLayer?.teams?.[id - 1]?.faction ||
          s.squads.find((q) => q.teamID === id)?.teamName || null)
      },
      players,
      squads: s.squads.map((q) => ({ team: q.teamID, id: q.squadID, name: q.squadName, locked: q.locked === 'True',
        command: command.has(`${q.teamID}:${q.squadID}`), copycat: copycats.has(`${q.teamID}:${q.squadID}`) })),
      shuffleStatus: this.shuffle?.status() || null,
      shuffle: shuffle
        ? { auto: !!shuffle.auto, locking: !!shuffle.locking, friends: !!shuffle.friends,
          history: !!shuffle.historyOn, tokens: !!shuffle.tokens, pending: !!shuffle.pendingNow,
          lockedNow: !!shuffle.lock, last: shuffle.last ? { moved: shuffle.last.moved, failed: shuffle.last.failed } : null }
        : null,
      at: this.now()
    };
  }
}
