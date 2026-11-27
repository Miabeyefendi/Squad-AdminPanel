import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { Actions, cleanText } from '../../src/squadjs/admin-panel/actions.js';
import { effective } from '../../src/squadjs/admin-panel/permissions.js';
import { ConfigFile } from '../../src/squadjs/admin-panel/config-file.js';
import { RULE_DEFAULTS, Rules, mergeRules, wordHit } from '../../src/squadjs/admin-panel/rules.js';
import { Tracker, parseMapReply } from '../../src/squadjs/admin-panel/state.js';
import { Store } from '../../src/squadjs/admin-panel/store.js';
import { openVault } from '../../src/squadjs/admin-panel/vault.js';
import { LAYERS, eos, fakeServer } from '../mock_data/fake-server.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sa-'));
const admin = { name: 'a', perms: effective({ rank: 'admin' }) };
const mod = { name: 'm', perms: effective({ rank: 'senior' }) };

function setup(now) {
  const server = fakeServer();
  const store = new Store(openVault(tmp()), now ? { now } : {});
  return { server, store, actions: new Actions({ server, store }) };
}

test('text sent to RCON stays on one line', () => {
  assert.equal(cleanText('hi\nAdminBan "x" 0 y'), "hi AdminBan 'x' 0 y");
  assert.equal(cleanText('a\u2028b\u0000c'), 'a b c');
  assert.equal(cleanText('x'.repeat(500)).length, 300);
});

test('actions validate input before RCON', async () => {
  const { server, actions, store } = setup();
  const id = server.players[0].eosID;
  await assert.rejects(actions.run(mod, 'ban', { ids: [id], length: '0', reason: 'x' }), /permission/);
  await assert.rejects(actions.run(admin, 'ban', { ids: [id], length: '0 extra', reason: 'x' }), /length/);
  await assert.rejects(actions.run(admin, 'kick', { ids: ['" ; AdminEndMatch'], reason: 'x' }), /Invalid player/);
  await assert.rejects(actions.run(admin, 'nextLayer', { layer: 'Narva_AAS_v1 USA\nAdminEndMatch' }), /layer/);
  await assert.rejects(actions.run(admin, 'nextLayer', { layer: 'Narva_AAS_v1', team2: 'USA' }), /team 1/);
  await assert.rejects(actions.run(admin, 'shuffle', { command: 'now' }), /not running/);
  await assert.rejects(actions.run(admin, 'toString', {}), /Unknown action/);
  await assert.rejects(actions.run(admin, 'warn', { ids: [id], message: '  ' }), /empty/);
  assert.deepEqual(server.sent, []);

  await actions.run(admin, 'ban', { ids: [id], length: '7d', reason: 'tk', note: 'clip' });
  server.mapReplies.ShowNextMap = 'Next level is Narva, layer is Narva_AAS_v1, factions USA+Armored RGF';
  await actions.run(admin, 'nextLayer', { layer: 'Narva_AAS_v1', team1: 'USA+Armored', team2: 'RGF' });
  await actions.run(mod, 'removeFromSquad', { ids: [id] });
  assert.deepEqual(server.sent, [`AdminBan "${id}" 7d tk`, 'AdminSetNextLayer Narva_AAS_v1 USA+Armored RGF', 'AdminRemovePlayerFromSquadById 1']);
  assert.equal(store.player(id).bans, 1);
  assert.deepEqual(store.player(id).history.map((e) => [e.type, e.reason, e.detail]), [['ban', 'tk', '7d · clip']]);
  assert.equal(store.logs.admin.length, 3);
});

test('kick works for a player who left, move does not; partial failures are reported', async () => {
  const { server, actions } = setup();
  const gone = eos(999);
  await actions.run(mod, 'kick', { ids: [gone], reason: 'left early' });
  assert.equal(server.sent[0], `AdminKick "${gone}" left early`);
  await assert.rejects(actions.run(admin, 'moveTeam', { ids: [gone] }), /not on the server/);
  const result = await actions.run(admin, 'moveTeam', { ids: [server.players[0].eosID, gone] });
  assert.equal(result.done, 1);
  assert.equal(result.failed.length, 1);
});

test('a refused command is an error and is not counted or logged', async () => {
  const { server, actions, store } = setup();
  const id = server.players[0].eosID;
  server.rcon.execute = async () => `ERROR: Unable to find player with name or id (${id})`;
  server.rcon.warn = async () => `Could not find player ${id}`;
  server.rcon.ban = server.rcon.execute;
  for (const [name, body] of [['kick', { ids: [id], reason: 'x' }], ['ban', { ids: [id], length: '1d', reason: 'x' }],
    ['warn', { ids: [id], message: 'x' }], ['endMatch', {}]]) {
    await assert.rejects(actions.run(admin, name, body), /game refused|Unable to find|Could not find/);
  }
  server.rcon.execute = async () => 'Player Id is incorrect';
  await assert.rejects(actions.run(admin, 'removeFromSquad', { ids: [id] }), /incorrect/);
  assert.deepEqual([store.player(id).kicks, store.player(id).bans, store.player(id).warns], [0, 0, 0]);
  assert.equal(store.logs.admin.length, 0);
  const rules = new Rules({ server, store });
  rules.update({ teamkill: { enabled: true } });
  await rules.onTeamkill({ attacker: server.players[0] });
  assert.equal(store.logs.admin[0].action, 'Failed');
});

test('faction picks are checked and the next layer is read back', async () => {
  const { server, store } = setup();
  let shown = 'Next level is Narva, layer is Narva_AAS_v1, factions USA+Armored RGF';
  server.rcon.execute = async (command) => {
    server.sent.push(command);
    return command === 'ShowNextMap' ? shown : 'Set next layer to x';
  };
  const actions = new Actions({ server, store, getLayers: async () => LAYERS });
  const pick = (team1, team2) => actions.run(admin, 'nextLayer', { layer: 'Narva_AAS_v1', team1, team2 });
  await assert.rejects(pick('NOPE', 'RGF'), /no faction NOPE/);
  await assert.rejects(pick('USA+NoSuchUnit', 'RGF'), /no NoSuchUnit unit/);
  await assert.rejects(pick('USA', 'WPMC'), /for team 2/);
  assert.deepEqual(server.sent, []);
  await pick('USA+Armored', 'RGF');
  assert.equal(store.logs.admin.length, 1);
  shown = 'Next level is Narva, layer is Narva_AAS_v1, factions BAF RGF';
  await assert.rejects(pick('USA+CombinedArms', 'RGF'), /shows something else/);
});

test('message to a team warns each player of that team only', async () => {
  const { server, actions } = setup();
  const result = await actions.run(mod, 'messageGroup', { group: 'team2', message: 'push' });
  assert.equal(result.done, 20);
  assert.equal(server.sent.length, 20);
});

test('rules are off by default and reject bad values', async () => {
  const { server, store } = setup();
  const rules = new Rules({ server, store });
  await rules.onTeamkill({ attacker: server.players[0] });
  assert.deepEqual(server.sent, []);
  assert.throws(() => mergeRules(RULE_DEFAULTS, { teamkill: { kickAt: -1 } }), /number/);
  assert.throws(() => mergeRules(RULE_DEFAULTS, { teamkill: { enabled: 'yes' } }), /on or off/);
  assert.throws(() => mergeRules(RULE_DEFAULTS, { nope: {} }), /Unknown rule/);
  assert.throws(() => mergeRules(RULE_DEFAULTS, { chatFilter: { banLength: '99y' } }), /ban length/);
});

test('teamkill steps warn, then kick; admins are exempt; window expires', async () => {
  let time = 0;
  const { server, store } = setup(() => 1700000000000 + time);
  const rules = new Rules({ server, store, now: () => time });
  rules.update({ teamkill: { enabled: true, warnAt: 1, kickAt: 3 } });
  const player = server.players[0];
  for (let i = 0; i < 3; i++) await rules.onTeamkill({ attacker: player });
  assert.deepEqual(server.sent.map((c) => c.split(' ')[0]), ['AdminWarn', 'AdminWarn', 'AdminKick']);
  time += 11 * 60000;
  server.sent.length = 0;
  await rules.onTeamkill({ attacker: player });
  assert.match(server.sent[0], /^AdminWarn/);
  server.sent.length = 0;
  server.admins.add(player.eosID);
  await rules.onTeamkill({ attacker: player });
  assert.deepEqual(server.sent, []);
});

test('chat filter matches whole words, also non-ASCII', () => {
  assert.equal(wordHit('you are a noob!', ['noob']), 'noob');
  assert.equal(wordHit('noobie', ['noob']), undefined);
  assert.equal(wordHit('çok şık', ['şık']), 'şık');
  assert.equal(wordHit('a.b', ['.']), undefined);
});

test('squadless players are warned, then kicked once', async () => {
  let time = 0;
  const { server, store } = setup();
  const rules = new Rules({ server, store, now: () => time });
  rules.update({ squadless: { enabled: true, minPlayers: 10, warnAfterMinutes: 5, kickAfterMinutes: 10 } });
  const loose = server.players.filter((p) => p.squadID === null).length;
  for (const minute of [0, 5, 6, 10, 11]) {
    time = minute * 60000;
    await rules.onPlayers();
  }
  assert.equal(server.sent.filter((c) => c.startsWith('AdminWarn')).length, loose);
  assert.equal(server.sent.filter((c) => c.startsWith('AdminKick')).length, loose);
});

test('tracker counts kills, deaths, revives and teamkills and resets on a new game', async () => {
  const { server, store } = setup();
  const tracker = new Tracker({ server, store, rules: new Rules({ server, store }) });
  tracker.mount();
  const [a, b] = server.players;
  server.emit('PLAYER_DIED', { attacker: a, victim: b, teamkill: false, weapon: 'BP_AK74_C_12' });
  server.emit('PLAYER_REVIVED', { reviver: b, victim: a });
  server.emit('TEAMKILL', { attacker: a, victim: b, weapon: 'BP_Grad_C' });
  server.emit('CHAT_MESSAGE', { chat: 'ChatTeam', player: a, eosID: a.eosID, message: 'hi' });
  const row = (id) => tracker.snapshot().players.find((p) => p.id === id);
  assert.deepEqual([row(a.eosID).kills, row(a.eosID).teamkills, row(b.eosID).deaths, row(b.eosID).revives], [1, 1, 1, 1]);
  assert.equal(store.logs.kills[0].weapon, 'AK74');
  assert.equal(store.logs.chat[0].channel, 'Team');
  server.emit('NEW_GAME', {});
  assert.equal(row(a.eosID).kills, 0);
  tracker.unmount();
  assert.equal(server.listenerCount('PLAYER_DIED'), 0);
});

test('layer and factions come from the game reply, also for a layer SquadJS does not know', async () => {
  assert.equal(parseMapReply('Next level is , layer is '), null);
  assert.equal(parseMapReply('Next level is , layer is To be voted'), null);
  const { server, store } = setup();
  server.currentLayer = null;
  server.mapReplies.ShowCurrentMap = 'Current level is Sumari Bala, layer is ModLoader_v1, factions RGF USA+AirAssault';
  const tracker = new Tracker({ server, store, rules: new Rules({ server, store }) });
  await tracker.readMaps();
  const snapshot = tracker.snapshot().server;
  assert.deepEqual(snapshot.layer, { id: 'ModLoader_v1', name: 'ModLoader v1' });
  assert.deepEqual(snapshot.teams, ['RGF', 'USA Air Assault']);
});

test('a player who already left the list is still named in the leave log', () => {
  const { server, store } = setup();
  const tracker = new Tracker({ server, store, rules: new Rules({ server, store }) });
  const gone = eos(77);
  store.seen(gone, 'Leaver');
  tracker.onDisconnected({ player: null, raw: `LogNet: UChannel::Close: ... UniqueId: RedpointEOS:${gone}` });
  assert.deepEqual([store.logs.conn[0].player, store.logs.conn[0].id], ['Leaver', gone]);
});

test('logs survive a restart, old files are removed', () => {
  const dir = tmp();
  const day = 86400000;
  let time = Date.parse('2026-01-01T12:00:00Z');
  const first = new Store(openVault(dir), { retentionDays: 5, now: () => time });
  first.log('admin', { action: 'old' });
  time += 10 * day;
  first.log('admin', { action: 'new' });
  fs.appendFileSync(path.join(dir, 'log-2026-01-11.enc'), '{broken');
  const second = new Store(openVault(dir), { retentionDays: 5, now: () => time });
  assert.deepEqual(second.logs.admin.map((e) => e.action), ['new']);
  assert.deepEqual(second.logFiles(), ['log-2026-01-11.enc']);
});

class Demo {
  static description = 'demo';
  static optionsSpecification = {
    interval: { default: 100 },
    message: { default: 'hello' },
    on: { default: true },
    list: { default: [] },
    tokenStart: { default: 2 },
    mySquadStatsToken: { default: '' },
    tokenFile: { default: './t.json' },
    discordClient: { connector: 'discord', default: 'discord' }
  };
}
class AdminPanel {
  static description = 'panel';
  static optionsSpecification = { port: { default: 1 } };
}

test('config editor hides secrets and server settings, and writes safely', async () => {
  const file = path.join(tmp(), 'config.json');
  const config = { server: { rconPassword: 'RCONSECRET' }, connectors: { discord: 'DISCORDSECRET' },
    plugins: [{ plugin: 'Demo', enabled: false, mySquadStatsToken: 'MSSSECRET' }, { plugin: 'AdminPanel', enabled: true }] };
  fs.writeFileSync(file, JSON.stringify(config));
  const editor = new ConfigFile(file, async () => ({ Demo, AdminPanel }));
  const listed = await editor.list();
  assert.doesNotMatch(JSON.stringify(listed), /SECRET/);
  const names = listed.plugins[0].options.map((o) => [o.name, o.lock]);
  assert.deepEqual(names.filter(([, lock]) => lock), [['mySquadStatsToken', 'secret'], ['tokenFile', 'fixed']]);
  assert.ok(!names.some(([n]) => n === 'discordClient'));

  const save = (extra) => editor.save({ index: 0, name: 'Demo', ...extra });
  await assert.rejects(save({ options: { mySquadStatsToken: 'x' } }), /config.json/);
  await assert.rejects(save({ options: { tokenFile: '../../x' } }), /config.json/);
  await assert.rejects(save({ options: { interval: 'fast' } }), /number/);
  await assert.rejects(save({ options: { discordClient: 'x' } }), /Unknown option/);
  await assert.rejects(editor.save({ index: 1, name: 'AdminPanel', enabled: false }), /itself/);
  await assert.rejects(editor.save({ index: 0, name: 'Other', enabled: true }), /changed/);

  await save({ enabled: true, options: { interval: 250, tokenStart: 3 } });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.server.rconPassword, 'RCONSECRET');
  assert.equal(after.plugins[0].mySquadStatsToken, 'MSSSECRET');
  assert.deepEqual([after.plugins[0].enabled, after.plugins[0].interval, after.plugins[0].tokenStart], [true, 250, 3]);
  assert.ok(fs.existsSync(`${file}.bak`));
});

