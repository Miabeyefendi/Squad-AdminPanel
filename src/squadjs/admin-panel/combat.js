// What the server log says about the fights of one match: every hit, down and death, and numbers
// per player. The log has no shots fired, misses, hit places or distances, so accuracy cannot be
// worked out. Kept in memory only.
const MAX_EVENTS = 10000;
const MINUTE = 60000;

// the damage a log line carries, when it carries one
const dealt = (info) => (info.damage > 0 ? Math.round(info.damage) : null);

const blank = () => ({ kills: 0, downs: 0, deaths: 0, teamkills: 0, hits: 0, damage: 0, maxHit: 0,
  // downs whose hits were seen, those hits, and how many of the downs took a single one
  countedDowns: 0, downHits: 0, oneHitDowns: 0, bestMinute: 0, recent: [], victims: new Set(), weapons: new Map() });

export class Combat {
  constructor({ id, now = Date.now, limit = MAX_EVENTS }) {
    Object.assign(this, { id, now, limit });
    this.startedAt = now();
    this.seq = 0;
    this.events = [];
    this.stats = new Map();
    // victim -> attacker -> hits since the victim last went down, died or got up
    this.pending = new Map();
  }

  who(player) {
    if (!this.stats.has(player.eosID)) this.stats.set(player.eosID, { ...blank(), id: player.eosID });
    const s = this.stats.get(player.eosID);
    // the last seen name and place: the numbers stay after the player leaves
    Object.assign(s, { name: player.name ?? s.name, team: player.teamID ?? s.team, squad: player.squadID ?? null });
    return s;
  }

  weapon(s, name) {
    if (!s.weapons.has(name)) s.weapons.set(name, { name, hits: 0, downs: 0, kills: 0, damage: 0 });
    return s.weapons.get(name);
  }

  // squad and team are kept as they were at that moment
  add(type, info, extra) {
    const side = (p) => ({ id: p?.eosID ?? null, name: p?.name ?? null, team: p?.teamID ?? null, squad: p?.squadID ?? null });
    this.events.push({ seq: ++this.seq, at: this.now(), type, tk: !!info.teamkill, a: side(info.attacker), v: side(info.victim), ...extra });
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
  }

  // an attacker other than the victim, or nothing to count
  attacker(info) {
    const a = info.attacker;
    return a?.eosID && a.eosID !== info.victim?.eosID ? a : null;
  }

  hitsOn(info) {
    return this.pending.get(info.victim?.eosID)?.get(info.attacker?.eosID) || 0;
  }

  damaged(info, weapon, raw) {
    const attacker = this.attacker(info);
    if (!attacker || !(info.damage > 0)) return;
    const damage = Math.round(info.damage);
    const victim = info.victim?.eosID;
    if (victim) {
      if (!this.pending.has(victim)) this.pending.set(victim, new Map());
      this.pending.get(victim).set(attacker.eosID, this.hitsOn(info) + 1);
    }
    if (!info.teamkill) {
      const s = this.who(attacker);
      s.hits += 1;
      s.damage += info.damage;
      s.maxHit = Math.max(s.maxHit, damage);
      const w = this.weapon(s, weapon);
      w.hits += 1;
      w.damage += info.damage;
    }
    this.add('hit', info, { weapon, raw, damage });
  }

  wounded(info, weapon, raw) {
    const attacker = this.attacker(info);
    if (!attacker) return;
    const hits = this.hitsOn(info) || null;
    this.pending.delete(info.victim?.eosID);
    const s = this.who(attacker);
    if (info.teamkill) s.teamkills += 1;
    else {
      s.downs += 1;
      this.weapon(s, weapon).downs += 1;
      if (info.victim?.eosID) s.victims.add(info.victim.eosID);
      if (hits) {
        s.countedDowns += 1;
        s.downHits += hits;
        if (hits === 1) s.oneHitDowns += 1;
      }
      const at = this.now();
      s.recent = [...s.recent.filter((t) => at - t < MINUTE), at];
      s.bestMinute = Math.max(s.bestMinute, s.recent.length);
    }
    this.add('down', info, { weapon, raw, damage: dealt(info), hits });
  }

  died(info, weapon, raw) {
    if (info.victim?.eosID) {
      this.who(info.victim).deaths += 1;
      this.pending.delete(info.victim.eosID);
    }
    const attacker = this.attacker(info);
    if (!attacker) return;
    if (!info.teamkill) {
      const s = this.who(attacker);
      s.kills += 1;
      this.weapon(s, weapon).kills += 1;
      if (info.victim?.eosID) s.victims.add(info.victim.eosID);
    }
    this.add('kill', info, { weapon, raw, damage: dealt(info) });
  }

  revived(info) {
    this.pending.delete(info.victim?.eosID);
  }

  // The numbers of every player, and the events after "after".
  read(after = 0) {
    const players = [...this.stats.values()].map(({ recent, victims, weapons, damage, ...s }) => ({ ...s,
      damage: Math.round(damage), victims: victims.size,
      weapons: [...weapons.values()].map((w) => ({ ...w, damage: Math.round(w.damage) }))
        .sort((a, b) => b.downs - a.downs || b.kills - a.kills || b.hits - a.hits) }));
    return { match: this.id, startedAt: this.startedAt, seq: this.seq, players,
      events: this.events.filter((e) => e.seq > after) };
  }
}
