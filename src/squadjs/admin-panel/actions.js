// Every command the panel can send. All input is validated here before it reaches RCON.
import { PanelError, fail, has } from './errors.js';

export { PanelError as ActionError };

// Squad answers a failed command with a normal reply, so the text has to be read.
// These replies were seen on a v10.6.3 server.
const REFUSED = /^(ERROR\b|Could not find player|Player Id is incorrect|Unknown command)/i;
export async function accepted(command) {
  const reply = String((await command) ?? '').trim();
  if (REFUSED.test(reply)) fail(`The game refused: ${reply.replace(/^ERROR:\s*/i, '').slice(0, 200)}`, 409);
  return reply;
}

export const BAN_LENGTHS = ['1h', '1d', '7d', '30d', '0'];
const ID = /^([0-9a-f]{32}|\d{17})$/i;
const LAYER = /^[A-Za-z0-9_.-]{1,80}$/;
const SIDE = /^[A-Za-z0-9]{1,20}(\+[A-Za-z0-9_]{1,30})?$/;

// One line, no control characters, no quotes: a line break would start a second RCON command.
// Direction overrides and invisible characters, which can disguise a text, are removed.
export function cleanText(value, max = 300) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/"/g, "'")
    .trim();
  // half of a surrogate pair (a cut emoji) is replaced; toWellFormed() would need Node 20, SquadJS runs on 18
  return text.slice(0, max).replace(/\p{Surrogate}/gu, '?');
}
const needText = (value, what) => cleanText(value) || fail(`${what} is empty.`);

// the only things a request can run
const HANDLERS = Object.fromEntries(['warn', 'messagePlayer', 'messageGroup', 'broadcast', 'kick', 'ban', 'moveTeam', 'removeFromSquad',
  'note', 'nextLayer', 'changeLayer', 'endMatch', 'restartMatch', 'shuffle', 'demoteCommander', 'disbandSquad',
  'maxPlayers', 'queueLimit'].map((n) => [n, `do_${n}`]));

const ROUND_COMMANDS = ['now', 'cancel', 'unlock', 'preview'];
// The permission each request needs. Bans and Smart Shuffle depend on what exactly is asked.
const NEEDS = {
  warn: () => 'warn', messagePlayer: () => 'message.group', messageGroup: () => 'message.group', broadcast: () => 'broadcast', kick: () => 'kick',
  ban: ({ length }) => (length === '0' ? 'ban.perm' : length === '7d' || length === '30d' ? 'ban.long' : 'ban.short'),
  moveTeam: () => 'team.move', removeFromSquad: () => 'squad.remove', note: () => 'notes.add',
  nextLayer: () => 'map.next', changeLayer: () => 'map.now', endMatch: () => 'match.control',
  restartMatch: () => 'match.control',
  demoteCommander: () => 'commander.demote', disbandSquad: () => 'squad.disband',
  maxPlayers: () => 'server.settings', queueLimit: () => 'server.settings',
  shuffle: ({ command }) => (ROUND_COMMANDS.includes(command) ? 'shuffle.round' : 'shuffle.switches')
};

// A server password: no spaces or quotes, which would change the command.
const PASSWORD = /^[A-Za-z0-9!#$%&*+.=?@^_-]{1,32}$/;
const wholeNumber = (value, low, high, what) => (Number.isInteger(value) && value >= low && value <= high
  ? value : fail(`${what} must be a whole number from ${low} to ${high}.`));

const GROUP_NAMES = { team1: 'Team 1', team2: 'Team 2', admins: 'Admins', noSquad: 'Players without a squad', noKit: 'Squad leaders without the kit' };

export class Actions {
  // rconVerbosity says how much SquadJS prints about RCON; null when that cannot be told
  constructor({ server, store, shuffle = null, getLayers = async () => [], rconVerbosity = async () => null }) {
    this.rconVerbosity = rconVerbosity;
    this.server = server;
    this.store = store;
    this.shuffle = shuffle;
    this.getLayers = getLayers;
  }

  online(id) {
    if (typeof id !== 'string' || !ID.test(id)) fail('Invalid player ID.');
    return this.server.players.find((p) => p.eosID === id || p.steamID === id) || null;
  }

  // Kick and ban are sent even if the player left; the game decides. The other commands need them online.
  target(id) {
    return this.online(id) || fail('That player is not on the server.', 404);
  }

  nameOf(id) {
    return this.online(id)?.name || this.store.player(id).name || id;
  }

  group(name) {
    const players = this.server.players;
    if (name === 'team1') return players.filter((p) => p.teamID === 1);
    if (name === 'team2') return players.filter((p) => p.teamID === 2);
    if (name === 'admins') return players.filter((p) => this.server.getAdminPermsByAnyID(p.eosID));
    if (name === 'noSquad') return players.filter((p) => p.squadID === null);
    // the same test the panel uses to list them
    if (name === 'noKit') return players.filter((p) => p.isLeader && p.role && !/(^|[_ ])SL/.test(p.role.replace(/_\d+$/, '').replace(/_/g, ' ')));
    return fail('Unknown group.');
  }

  targets(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    if (!list.length || list.length > 100) fail('Pick 1 to 100 players.');
    return [...new Set(list)];
  }

  // Runs one command per player and reports the ones that failed, so one error does not hide the rest.
  async each(ids, fn) {
    const failed = [];
    let done = 0;
    for (const id of ids) {
      try {
        await fn(id);
        done += 1;
      } catch (err) {
        failed.push(`${this.nameOf(ID.test(String(id)) ? id : '')}: ${err.message}`);
      }
    }
    if (!done) fail(failed[0] || 'Nothing was done.', 409);
    return { done, failed };
  }

  async run(user, name, body = {}) {
    const handler = has(HANDLERS, name) && this[HANDLERS[name]];
    if (!handler) fail('Unknown action.', 404);
    if (!user.perms.has(NEEDS[name](body))) fail('You do not have permission for this.', 403);
    return handler.call(this, body, user);
  }

  audit(user, action, target, reason = '', note = '') {
    // a note is for admins only; it has its own field so it is never passed on with the reason
    this.store.log('admin', { by: user.name, action, target, reason, ...(note ? { note } : {}) });
  }

  async do_warn({ ids, message }, user) {
    const text = needText(message, 'The message');
    return this.each(this.targets(ids), async (id) => {
      const { name } = this.target(id);
      await accepted(this.server.rcon.warn(id, text));
      this.store.record(id, 'warn', { by: user.name, reason: text, name });
      this.audit(user, 'Warn', this.nameOf(id), text);
    });
  }

  // the same on-screen text as a warning, but nothing goes on the player's record
  async do_messagePlayer({ id, message }, user) {
    const text = needText(message, 'The message');
    const { name } = this.target(id);
    await accepted(this.server.rcon.warn(id, text));
    this.audit(user, 'Message', name, text);
    return { done: 1 };
  }

  async do_messageGroup({ group, message }, user) {
    const text = needText(message, 'The message');
    const ids = this.group(group).map((p) => p.eosID);
    if (!ids.length) fail('Nobody to send to.', 409);
    const result = await this.each(ids, (id) => accepted(this.server.rcon.warn(id, text)));
    this.audit(user, 'Message', GROUP_NAMES[group], text);
    return result;
  }

  async do_broadcast({ message }, user) {
    const text = needText(message, 'The message');
    await accepted(this.server.rcon.broadcast(text));
    this.audit(user, 'Message', 'Everyone', text);
    return { done: 1 };
  }

  async do_kick({ ids, reason }, user) {
    const text = needText(reason, 'The reason');
    return this.each(this.targets(ids), async (id) => {
      if (typeof id !== 'string' || !ID.test(id)) fail('Invalid player ID.');
      const who = this.nameOf(id);
      await accepted(this.server.rcon.execute(`AdminKick "${id}" ${text}`));
      this.store.record(id, 'kick', { by: user.name, reason: text, name: who });
      this.audit(user, 'Kick', who, text);
    });
  }

  async do_ban({ ids, length, reason, note }, user) {
    if (!BAN_LENGTHS.includes(length)) fail('Invalid ban length.');
    const text = needText(reason, 'The reason');
    const extra = cleanText(note);
    return this.each(this.targets(ids), async (id) => {
      if (typeof id !== 'string' || !ID.test(id)) fail('Invalid player ID.');
      const who = this.nameOf(id);
      await accepted(this.server.rcon.ban(id, length, text));
      this.store.record(id, 'ban', { by: user.name, reason: text, detail: `${length === '0' ? 'permanent' : length}${extra ? ` · ${extra}` : ''}`, name: who });
      this.audit(user, `Ban ${length === '0' ? 'permanent' : length}`, who, text, extra);
    });
  }

  async do_moveTeam({ ids }, user) {
    return this.each(this.targets(ids), async (id) => {
      this.target(id);
      await accepted(this.server.rcon.switchTeam(id));
      this.audit(user, 'Move team', this.nameOf(id));
    });
  }

  async do_removeFromSquad({ ids }, user) {
    return this.each(this.targets(ids), async (id) => {
      const player = this.target(id);
      await accepted(this.server.rcon.execute(`AdminRemovePlayerFromSquadById ${Number(player.playerID)}`));
      this.audit(user, 'Remove from squad', player.name);
    });
  }

  async do_note({ id, text }, user) {
    if (typeof id !== 'string' || !ID.test(id)) fail('Invalid player ID.');
    this.store.addNote(id, user.name, needText(text, 'The note'));
    return { done: 1 };
  }

  layerCommand({ layer, team1, team2 }) {
    if ([layer, team1, team2].some((v) => v && typeof v !== 'string')) fail('Invalid layer.');
    if (!LAYER.test(String(layer))) fail('Invalid layer.');
    const sides = [team1, team2].map((s) => s || '');
    if (sides.some((s) => s && !SIDE.test(s))) fail('Invalid faction.');
    // the factions are positional: team 2 alone would be read as team 1
    if (sides[1] && !sides[0]) fail('Pick the team 1 faction too.');
    return [layer, ...sides.filter(Boolean)].join(' ');
  }

  // The game accepts a unit type that does not exist, and swaps an unknown faction for the default
  // one without an error. So the pick is checked against the layer list before it is sent.
  async checkSides({ layer, team1, team2 }) {
    if (!team1 && !team2) return;
    const list = await this.getLayers().catch(() => []);
    const known = list.find((l) => l.id === layer);
    if (!known?.factions.length) return; // a mod layer, or no list: the game has the last word
    [team1, team2].forEach((side, i) => {
      if (!side) return;
      const [id, unit] = side.split('+');
      const faction = known.factions.find((f) => f.id === id && f.teams.includes(i + 1));
      if (!faction) fail(`${layer} has no faction ${id} for team ${i + 1}.`);
      if (unit && unit !== 'CombinedArms' && !faction.types.includes(unit)) fail(`${id} has no ${unit} unit on ${layer}.`);
    });
  }

  async do_nextLayer(body, user) {
    const args = this.layerCommand(body);
    await this.checkSides(body);
    await accepted(this.server.rcon.execute(`AdminSetNextLayer ${args}`));
    // read back what the game really set
    const now = String((await this.server.rcon.execute('ShowNextMap')) ?? '');
    const match = /layer is ([^,]+?)(?:, factions (.+))?\s*$/.exec(now.trim());
    if (match) {
      const sides = (match[2] || '').split(/\s+/);
      const wanted = [body.team1, body.team2];
      if (match[1] !== body.layer || wanted.some((w, i) => w && sides[i] !== w))
        fail(`The game shows something else: ${match[1]} ${match[2] || ''}`.trim(), 409);
    }
    this.audit(user, 'Next layer', args);
    this.server.updateLayerInformation?.(); // refreshes the panel's next layer right away
    return { done: 1 };
  }

  async do_changeLayer(body, user) {
    const args = this.layerCommand(body);
    await this.checkSides(body);
    await accepted(this.server.rcon.execute(`AdminChangeLayer ${args}`));
    this.audit(user, 'Change layer', args);
    return { done: 1 };
  }

  async do_endMatch(_, user) {
    await accepted(this.server.rcon.execute('AdminEndMatch'));
    this.audit(user, 'End match', 'Server');
    return { done: 1 };
  }

  async do_restartMatch(_, user) {
    await accepted(this.server.rcon.execute('AdminRestartMatch'));
    this.audit(user, 'Restart match', 'Server');
    return { done: 1 };
  }

  async do_demoteCommander({ id }, user) {
    const player = this.target(id);
    const squad = this.server.squads.find((s) => s.teamID === player.teamID && s.squadID === player.squadID);
    if (!player.isLeader || !/^command squad$/i.test(String(squad?.squadName).trim())) fail('That player is not a commander.', 409);
    await accepted(this.server.rcon.execute(`AdminDemoteCommanderById ${Number(player.playerID)}`));
    this.audit(user, 'Demote commander', player.name);
    return { done: 1 };
  }

  // the numbers in the command come from the server's own squad list, not from the request
  async do_disbandSquad({ team, squad }, user) {
    const found = this.server.squads.find((s) => s.teamID === team && s.squadID === squad) || fail('That squad is not on the server.', 404);
    await accepted(this.server.rcon.execute(`AdminDisbandSquad ${Number(found.teamID)} ${Number(found.squadID)}`));
    this.audit(user, 'Disband squad', `Team ${found.teamID} squad ${found.squadID} (${cleanText(found.squadName, 60)})`);
    this.server.updateSquadList?.().then(() => this.server.updatePlayerList?.()).catch(() => {});
    return { done: 1 };
  }

  async do_maxPlayers({ value }, user) {
    wholeNumber(value, 1, 100, 'The player limit');
    await accepted(this.server.rcon.execute(`AdminSetMaxNumPlayers ${value}`));
    this.audit(user, 'Server setting', 'Player limit', String(value));
    this.server.updateServerInformation?.();
    return { done: 1 };
  }

  async do_queueLimit({ value }, user) {
    wholeNumber(value, -1, 100, 'The queue limit');
    await accepted(this.server.rcon.execute(`AdminSetPublicQueueLimit ${value}`));
    this.audit(user, 'Server setting', 'Public queue limit', String(value));
    return { done: 1 };
  }

  // Why the password cannot be set from the panel right now, or null.
  async passwordBlock() {
    if (typeof this.server.rcon?.write !== 'function') return 'This SquadJS version cannot send the command without logging it.';
    const level = await this.rconVerbosity();
    if (level === null) return 'The SquadJS log settings cannot be read, so the password could end up in its log.';
    if (level >= 2) return 'SquadJS logs every RCON command at this level. Set logger.verboseness.RCON to 1 in config.json.';
    return null;
  }

  // Not in HANDLERS: the route asks for the account password first. The server password is never
  // logged, never returned, and no error text of the game or SquadJS is passed on.
  async setPassword(user, password) {
    if (!user.perms.has('server.password')) fail('You do not have permission for this.', 403);
    if (typeof password !== 'string' || (password && !PASSWORD.test(password))) {
      fail('Use 1 to 32 letters, digits or ! # $ % & * + . = ? @ ^ _ - (no spaces or quotes), or leave it empty to remove it.');
    }
    const blocked = await this.passwordBlock();
    if (blocked) fail(blocked, 409);
    let ok = false;
    try {
      // rcon.execute prints the whole command when it fails; write (0x02 = run a command) does not
      await accepted(this.server.rcon.write(0x02, `AdminSetServerPassword ${password || '""'}`));
      ok = true;
    } catch { /* replaced below */ }
    if (!ok) fail('The password was not changed. Check the connection to the game server.', 502);
    this.audit(user, 'Server setting', 'Server password', password ? 'set' : 'removed');
    return { done: 1 };
  }

  smartShuffle() {
    return this.shuffle ? this.shuffle.current() : this.server.plugins.find((p) => p.constructor.name === 'SmartShuffle') || null;
  }

  // Goes through the plugin's own admin chat command, so panel and chat behave the same.
  async do_shuffle({ command }, user) {
    const allowed = ['now', 'cancel', 'unlock', 'preview', 'auto on', 'auto off', 'friends on', 'friends off',
      'lock 0', 'lock 1', 'lock 2', 'history on', 'history off', 'tokens on', 'tokens off'];
    if (!allowed.includes(command)) fail('Unknown Smart Shuffle command.');
    const plugin = this.smartShuffle() || fail('Smart Shuffle is not running.', 409);
    if (command === 'preview') return { done: 1, text: await plugin.preview() };
    await plugin.onCommand({ chat: 'ChatAdmin', message: command });
    this.shuffle?.remember(command);
    this.audit(user, 'Smart Shuffle', command);
    return { done: 1 };
  }
}
