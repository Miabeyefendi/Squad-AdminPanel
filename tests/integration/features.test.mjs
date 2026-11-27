// Player records that outlive restarts, deleting records, the built-in Smart Shuffle, the commander.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Store } from '../../src/squadjs/admin-panel/store.js';
import { openVault } from '../../src/squadjs/admin-panel/vault.js';
import { adapt } from '../../src/utils/sync-smart-shuffle.mjs';
import { eos, fakeServer } from '../mock_data/fake-server.mjs';
import { install } from './install.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PW = 'Mavi-Kedi-42-Pencere';
const DAY = 86400000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sa-f-'));
const running = [];
let nextPort = 20100 + Math.floor(Math.random() * 300);
after(async () => {
  for (const p of running) await p.unmount();
});

async function panel(users = [['root', 'owner']], { prepare, server = fakeServer({ perTeam: 6 }) } = {}) {
  const installed = await install();
  const dataDir = path.join(installed.root, 'admin-panel-data');
  await installed.addUsers(dataDir, users.map(([name, rank]) => ({ name, rank, password: PW })));
  prepare?.(installed.root);
  const port = nextPort++;
  const plugin = new installed.AdminPanel(server, { port, dataDir, configFile: path.join(installed.root, 'config.json') });
  await plugin.mount();
  running.push(plugin);
  const base = `http://127.0.0.1:${port}`;
  const session = async (name) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SA': '1' }, body: JSON.stringify({ name, password: PW }) });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const read = async (r) => ({ status: r.status, data: await r.json() });
    return {
      get: async (url) => read(await fetch(base + url, { headers: { Cookie: cookie } })),
      post: async (url, body) => read(await fetch(base + url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-SA': '1', Cookie: cookie } }))
    };
  };
  return { plugin, server, dataDir, root: installed.root, session };
}

test('a warning is still there, with its reason, a month and a restart later', () => {
  const dir = tmp();
  let time = Date.parse('2026-01-10T12:00:00Z');
  const first = new Store(openVault(dir), { retentionDays: 30, now: () => time });
  first.record(eos(1), 'warn', { by: 'ada', reason: 'Mortar teamkill', name: 'Falcon' });
  first.log('chat', { message: 'old chat' });
  time += 40 * DAY;
  // a new process: only the files are left
  const second = new Store(openVault(dir), { retentionDays: 30, now: () => time });
  second.record(eos(1), 'warn', { by: 'sam', reason: 'Again', name: 'Falcon' });
  const player = second.player(eos(1));
  assert.equal(player.warns, 2);
  assert.deepEqual(player.history.map((e) => [e.by, e.reason]), [['ada', 'Mortar teamkill'], ['sam', 'Again']]);
  assert.equal(second.logs.chat.length, 0, 'logs follow their own retention');
  assert.deepEqual(second.search('falc').map((p) => [p.name, p.warns]), [['Falcon', 2]]);
});

test('older log days are read back after a restart, and a past month on request', () => {
  const dir = tmp();
  let time = Date.parse('2026-01-05T10:00:00Z');
  const first = new Store(openVault(dir), { retentionDays: 0, now: () => time });
  for (let i = 0; i < 6; i++) {
    first.log('chat', { message: `day ${i}` });
    time += 9 * DAY;
  }
  const second = new Store(openVault(dir), { retentionDays: 0, now: () => time });
  assert.deepEqual(second.logs.chat.map((e) => e.message), ['day 0', 'day 1', 'day 2', 'day 3', 'day 4', 'day 5']);
  assert.deepEqual(second.months(), ['2026-02', '2026-01']);
  assert.deepEqual(second.month('chat', '2026-01').map((e) => e.message), ['day 0', 'day 1', 'day 2']);
  assert.throws(() => second.month('chat', '../..'), /Unknown/);
});

test('deleting: a preview changes nothing, a period deletes only itself', () => {
  const dir = tmp();
  let time = Date.parse('2026-01-15T10:00:00Z');
  const store = new Store(openVault(dir), { retentionDays: 0, now: () => time });
  store.log('chat', { message: 'january' });
  store.log('admin', { action: 'Kick' });
  store.record(eos(2), 'kick', { by: 'a', reason: 'jan' });
  store.addNote(eos(2), 'a', 'jan note');
  time = Date.parse('2026-02-15T10:00:00Z');
  store.log('chat', { message: 'february' });
  store.record(eos(2), 'ban', { by: 'a', reason: 'feb' });
  const january = { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 1, 1) };
  assert.deepEqual(store.purge({ kinds: ['chat', 'history', 'notes'], ...january, dryRun: true }), { chat: 1, history: 1, notes: 1 });
  assert.equal(store.month('chat', '2026-01').length, 1);
  assert.deepEqual(store.purge({ kinds: ['chat', 'history'], ...january }), { chat: 1, history: 1 });
  assert.equal(store.month('chat', '2026-01').length, 0);
  assert.equal(store.month('admin', '2026-01').length, 1, 'a kind that was not picked stays');
  assert.deepEqual([store.player(eos(2)).kicks, store.player(eos(2)).bans, store.player(eos(2)).notes.length], [0, 1, 1]);
  assert.deepEqual(store.logs.chat.map((e) => e.message), ['february']);
  store.purge({ kinds: ['history', 'notes'] });
  const again = new Store(openVault(dir), { retentionDays: 0, now: () => time });
  assert.deepEqual([again.player(eos(2)).bans, again.player(eos(2)).history.length, again.player(eos(2)).notes.length], [0, 0, 0]);
});

test('retention set by the owner is kept and applied at once', () => {
  const dir = tmp();
  let time = Date.parse('2026-03-01T10:00:00Z');
  const store = new Store(openVault(dir), { retentionDays: 90, now: () => time });
  assert.equal(store.retention.history, 0, 'player records are kept for ever unless someone says otherwise');
  store.log('chat', { message: 'x' });
  time += 10 * DAY;
  assert.throws(() => store.setRetention({ chat: -1 }), /whole number/);
  assert.throws(() => store.setRetention(JSON.parse('{"__proto__":1}')), /Unknown/);
  store.setRetention({ chat: 7 });
  assert.equal(store.logFiles().length, 0);
  assert.equal(new Store(openVault(dir), { retentionDays: 90, now: () => time }).retention.chat, 7);
});

test('only the server owner deletes records, with the password, and the deletion stays on record', async () => {
  const p = await panel([['root', 'owner'], ['ada', 'admin']]);
  const [root, ada] = [await p.session('root'), await p.session('ada')];
  const id = p.server.players[0].eosID;
  await ada.post('/api/action/warn', { ids: [id], message: 'first warning' });
  assert.equal((await ada.get('/api/records')).status, 403);
  assert.equal((await ada.post('/api/records', { op: 'delete', kinds: ['admin'], confirmPassword: PW })).status, 403);
  assert.equal((await ada.get('/api/records/players?q=')).status, 200, 'reading player records is a note permission');
  assert.equal((await root.post('/api/records', { op: 'delete', kinds: ['admin', 'history'] })).status, 403, 'password needed');
  assert.equal((await root.post('/api/records', { op: 'delete', kinds: ['everything'], confirmPassword: PW })).status, 400);
  assert.equal((await root.post('/api/records', { op: 'delete', kinds: ['chat'], from: 5, to: 1, confirmPassword: PW })).status, 400);
  const preview = await root.post('/api/records', { op: 'preview', kinds: ['admin', 'history'] });
  assert.equal(preview.data.counts.history, 1);
  const done = await root.post('/api/records', { op: 'delete', kinds: ['admin', 'history'], confirmPassword: PW });
  assert.equal(done.status, 200);
  assert.equal(done.data.counts.history, 1);
  const left = (await root.get('/api/logs?kind=admin')).data;
  assert.deepEqual(left.map((e) => e.action), ['Records deleted']);
  assert.equal((await root.get(`/api/player?id=${id}`)).data.warns, 0);
  assert.equal((await root.post('/api/records', { op: 'retention', retention: { chat: 30 }, confirmPassword: PW })).status, 200);
});

test('messages have one name in the log, whoever they go to', async () => {
  const p = await panel();
  const root = await p.session('root');
  await root.post('/api/action/broadcast', { message: 'hello' });
  await root.post('/api/action/messageGroup', { group: 'team2', message: 'push' });
  const log = (await root.get('/api/logs?kind=admin')).data.filter((e) => e.action === 'Message');
  assert.deepEqual(log.map((e) => e.target), ['Everyone', 'Team 2']);
});

test('the commander is the leader of the Command Squad', async () => {
  const server = fakeServer({ perTeam: 6 });
  server.squads.find((q) => q.teamID === 2 && q.squadID === 3).squadName = 'Command Squad';
  const p = await panel(undefined, { server });
  const state = (await (await p.session('root')).get('/api/state')).data;
  const commanders = state.players.filter((x) => x.commander);
  assert.deepEqual(commanders.map((x) => [x.team, x.squad, x.leader]), [[2, 3, true]]);
  assert.equal(state.squads.filter((q) => q.command).length, 1);
});

test('Smart Shuffle comes with the panel and its settings apply at once', async () => {
  const p = await panel([['root', 'owner'], ['sam', 'senior']]);
  const [root, sam] = [await p.session('root'), await p.session('sam')];
  const host = p.plugin.shuffle;
  assert.equal(host.status(), 'on');
  assert.equal(p.server.plugins.length, 0, 'it is not a SquadJS plugin entry, so nothing of it goes to the ping');
  assert.equal(p.server.listenerCount('CHAT_COMMAND:smartshuffle'), 1);
  let page = (await root.get('/api/shuffle')).data;
  assert.equal(page.status, 'on');
  assert.equal(page.presets.length, 11);
  const names = page.groups.flatMap((g) => g.fields.map((f) => f.name));
  assert.equal(names.length, Object.keys(host.Plugin.optionsSpecification).length - 1, 'every option but the token file path');
  assert.ok(!names.includes('tokenFile'));
  assert.deepEqual((await sam.get('/api/shuffle')).data.groups, [], 'no settings without the permission');
  assert.equal((await sam.post('/api/shuffle', { op: 'settings', changes: { autoShuffle: true } })).status, 403);

  host.instance.pendingNow = true;
  const before = host.instance;
  const saved = await root.post('/api/shuffle', { op: 'settings', changes: { maxPartySize: 6, autoShuffle: true, mySquadStatsToken: 'TOPSECRETTOKEN', skipLayers: ['seed'] } });
  assert.equal(saved.status, 200);
  assert.notEqual(host.instance, before);
  assert.deepEqual([host.instance.options.maxPartySize, host.instance.auto, host.instance.pendingNow], [6, true, true], 'what was known about the match is kept');
  assert.equal(p.server.listenerCount('CHAT_COMMAND:smartshuffle'), 1, 'the old instance let go');
  assert.doesNotMatch(JSON.stringify(saved.data), /TOPSECRETTOKEN/);
  assert.doesNotMatch(JSON.stringify((await root.get('/api/logs?kind=admin')).data), /TOPSECRETTOKEN/);
  assert.doesNotMatch(fs.readFileSync(path.join(p.dataDir, 'shuffle.enc'), 'utf8'), /TOPSECRETTOKEN|maxPartySize/);
  assert.doesNotMatch(fs.readFileSync(path.join(p.root, 'config.json'), 'utf8'), /SmartShuffle|TOPSECRETTOKEN/);

  for (const changes of [{ tokenFile: '../../x' }, { nonsense: 1 }, JSON.parse('{"__proto__":{"x":1}}'), { constructor: 1 }, { maxPartySize: 'six' }, { maxPartySize: -1 }, { kitCrew: '(' }, { command: 'two words' }, { skipLayers: 'seed' }, { autoShuffle: 'yes' }, {}]) {
    assert.equal((await root.post('/api/shuffle', { op: 'settings', changes })).status, 400, JSON.stringify(changes));
  }
  assert.equal({}.x, undefined);

  // a quick switch is kept across restarts
  assert.equal((await root.post('/api/action/shuffle', { command: 'auto off' })).status, 200);
  assert.equal(host.options.autoShuffle, false);

  assert.equal((await root.post('/api/shuffle', { op: 'preset', id: 'light' })).status, 200);
  assert.deepEqual([host.options.maxPartySize, host.options.mySquadStatsToken], [0, 'TOPSECRETTOKEN'], 'a preset replaces the settings but keeps the token');
  assert.equal((await root.post('/api/shuffle', { op: 'enabled', on: false })).status, 200);
  assert.equal(host.status(), 'off');
  assert.equal(p.server.listenerCount('CHAT_COMMAND:smartshuffle'), 0);
  assert.equal((await root.post('/api/action/shuffle', { command: 'now' })).status, 409);
  await root.post('/api/shuffle', { op: 'enabled', on: true });
  page = (await root.get('/api/shuffle')).data;
  assert.equal(page.status, 'on');
});

test('without the Smart Shuffle folder everything else works and the tab says so', async () => {
  const p = await panel(undefined, { prepare: (root) => fs.rmSync(path.join(root, 'squad-server', 'plugins', 'admin-panel', 'smart-shuffle'), { recursive: true }) });
  const root = await p.session('root');
  assert.equal((await root.get('/api/state')).data.shuffleStatus, 'missing');
  assert.equal((await root.get('/api/state')).data.shuffle, null);
  assert.deepEqual((await root.get('/api/shuffle')).data.groups, []);
  const refused = await root.post('/api/shuffle', { op: 'enabled', on: true });
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /not installed/);
  assert.equal((await root.post('/api/action/broadcast', { message: 'still works' })).status, 200);
});

test('a Smart Shuffle run by config.json stays in charge: never two at once', async () => {
  class SmartShuffle { auto = true; async onCommand() {} }
  const server = fakeServer({ perTeam: 6 });
  server.plugins.push(new SmartShuffle());
  const p = await panel(undefined, { server });
  const root = await p.session('root');
  assert.equal(p.plugin.shuffle.status(), 'external');
  assert.equal(p.plugin.shuffle.instance, null);
  assert.equal((await root.post('/api/shuffle', { op: 'settings', changes: { maxPartySize: 3 } })).status, 409);
});

const sibling = path.join(HERE, '../../../Mod - Squad-ShuffleTeams/src/squadjs/smart-shuffle.js');
test('the built-in Smart Shuffle is the current one', { skip: !fs.existsSync(sibling) && 'the Smart Shuffle project is not here' }, () => {
  const copy = fs.readFileSync(path.join(HERE, '../../src/squadjs/admin-panel/smart-shuffle/plugin.js'), 'utf8');
  assert.equal(copy, adapt(fs.readFileSync(sibling, 'utf8')), 'run: node src/utils/sync-smart-shuffle.mjs');
});
