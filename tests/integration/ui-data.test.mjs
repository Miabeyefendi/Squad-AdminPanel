// What the pages read and send: served UI files, match numbers, one-player messages, periods, art and new rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { eos, fakeServer } from '../mock_data/fake-server.mjs';
import { install } from './install.mjs';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/squadjs/admin-panel/ui');
const PW = 'Mavi-Kedi-42-Pencere';
const running = [];
let nextPort = 20500 + Math.floor(Math.random() * 300);
after(async () => {
  for (const p of running) await p.unmount();
});

async function panel() {
  const installed = await install();
  const dataDir = path.join(installed.root, 'admin-panel-data');
  await installed.addUsers(dataDir, [['root', 'owner'], ['jim', 'junior']].map(([name, rank]) => ({ name, rank, password: PW })));
  const server = fakeServer({ perTeam: 6 });
  const port = nextPort++;
  const plugin = new installed.AdminPanel(server, { port, dataDir, configFile: path.join(installed.root, 'config.json') });
  await plugin.mount();
  running.push(plugin);
  const base = `http://127.0.0.1:${port}`;
  const session = async (name) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SA': '1' }, body: JSON.stringify({ name, password: PW }) });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const read = async (r) => ({ status: r.status, data: await r.json() });
    return {
      raw: (url, extra = {}) => fetch(base + url, { headers: { Cookie: cookie, ...extra } }),
      get: async (url) => read(await fetch(base + url, { headers: { Cookie: cookie } })),
      post: async (url, body) => read(await fetch(base + url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-SA': '1', Cookie: cookie } }))
    };
  };
  return { plugin, server, dataDir, base, root: installed.root, session };
}

test('every UI module is served, and every import points at a served file', async () => {
  const { base } = await panel();
  const files = ['app.js', 'core.js', 'art.js', ...fs.readdirSync(path.join(UI, 'pages')).map((f) => `pages/${f}`)];
  for (const file of files) {
    const res = await fetch(`${base}/${file}`);
    assert.equal(res.status, 200, file);
    const text = await res.text();
    for (const [, target] of text.matchAll(/from '(\.[^']+)'/g)) {
      const resolved = path.posix.join(path.posix.dirname(file), target);
      assert.ok(files.includes(resolved), `${file} imports ${target}`);
    }
  }
  for (const sneaky of ['/pages/../auth.js', '/auth.js', '/pages/', '/%2e%2e/auth.js']) {
    assert.notEqual((await fetch(base + sneaky)).status, 200, sneaky);
  }
});

test('downs, damage, tick rate, admins and a second Command Squad reach the screen', async () => {
  const { server, session } = await panel();
  const [a, b] = [server.players.find((p) => p.teamID === 1), server.players.find((p) => p.teamID === 2)];
  server.squads.filter((s) => s.teamID === 1).slice(1, 3).forEach((s) => { s.squadName = 'Command Squad'; });
  server.admins.add(b.eosID);
  server.emit('PLAYER_DAMAGED', { attacker: a, victim: b, damage: 61.4, teamkill: false });
  server.emit('PLAYER_DAMAGED', { attacker: a, victim: b, damage: 30, teamkill: true });
  server.emit('PLAYER_WOUNDED', { attacker: a, victim: b, teamkill: false });
  server.emit('PLAYER_WOUNDED', { attacker: a, victim: a, teamkill: false });
  server.emit('TICK_RATE', { tickRate: 38.44 });
  const { data } = await (await session('root')).get('/api/state');
  const seen = data.players.find((p) => p.id === a.eosID);
  assert.deepEqual([seen.downs, seen.damage], [1, 61]);
  assert.equal(data.server.tickRate, 38.4);
  assert.equal(data.players.find((p) => p.id === b.eosID).admin, true);
  assert.deepEqual(data.server.factions, ['RGF', 'USA']);
  const own = data.squads.filter((s) => s.team === 1);
  assert.deepEqual(own.filter((s) => s.command).map((s) => s.id), [2], 'the older squad counts');
  assert.deepEqual(own.filter((s) => s.copycat).map((s) => s.id), [3]);
});

test('a message to one player is not a warning, and needs its permission', async () => {
  const { server, plugin, session } = await panel();
  const [root, jim] = [await session('root'), await session('jim')];
  const target = server.players[0];
  const sent = await root.post('/api/action/messagePlayer', { id: target.eosID, message: 'Take your kit\nAdminKick "x"' });
  assert.equal(sent.status, 200);
  assert.deepEqual(server.sent.filter((c) => c.startsWith('Admin')), [`AdminWarn "${target.eosID}" Take your kit AdminKick 'x'`]);
  assert.equal(plugin.store.player(target.eosID).warns, 0);
  assert.equal(plugin.store.logs.admin.at(-1).action, 'Message');
  assert.equal((await jim.post('/api/action/messagePlayer', { id: target.eosID, message: 'hi' })).status, 403);
  assert.equal((await root.post('/api/action/messagePlayer', { id: eos(999), message: 'hi' })).status, 404);
});

test('records and logs are read by period, and the delete preview names the days', async () => {
  const { plugin, session } = await panel();
  const root = await session('root');
  plugin.store.record(eos(1), 'ban', { by: 'ada', reason: 'Cheating', name: 'Falcon' });
  plugin.store.addNote(eos(1), 'ada', 'Watch this one');
  const now = Date.now();
  const all = await root.get(`/api/records/timeline?from=${now - 86400000}`);
  assert.deepEqual(all.data.entries.map((e) => e.type).sort(), ['ban', 'note']);
  assert.equal((await root.get('/api/records/timeline?q=cheat')).data.total, 1);
  assert.equal((await root.get(`/api/records/timeline?to=${now - 86400000}`)).data.total, 0);
  assert.equal((await root.get('/api/records/timeline?from=abc')).status, 400);
  plugin.store.log('chat', { message: 'hello' });
  assert.deepEqual((await root.get(`/api/logs?kind=chat&from=${now - 1000}`)).data.map((e) => e.message), ['hello']);
  assert.equal((await root.get(`/api/logs?kind=chat&from=${now}&to=${now - 1}`)).status, 400);
  const preview = await root.post('/api/records', { op: 'preview', kinds: ['history', 'notes'], from: null, to: null });
  assert.deepEqual(preview.data.days, { [new Date().toISOString().slice(0, 10)]: 2 });
  assert.equal(plugin.store.player(eos(1)).bans, 1, 'a preview deletes nothing');
});

test('pictures from the data folder: only listed names, only signed in', async () => {
  const { base, dataDir, session } = await panel();
  fs.mkdirSync(path.join(dataDir, 'art', 'maps'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'art', 'maps', 'Narva.png'), 'png');
  fs.mkdirSync(path.join(dataDir, 'art', 'screens'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'art', 'screens', 'Narva.jpg'), 'jpg');
  fs.writeFileSync(path.join(dataDir, 'art', 'maps', 'notes.txt'), 'x');
  const root = await session('root');
  assert.deepEqual((await root.get('/api/assets')).data, { maps: ['Narva.png'], screens: ['Narva.jpg'], factions: [] });
  assert.equal((await root.raw('/art/screens/Narva.jpg')).headers.get('content-type'), 'image/jpeg');
  const picture = await root.raw('/art/maps/Narva.png');
  assert.equal(picture.status, 200);
  assert.equal(picture.headers.get('content-type'), 'image/png');
  const tag = picture.headers.get('etag');
  assert.equal(picture.headers.get('cache-control'), 'private, no-cache');
  assert.equal((await root.raw('/art/maps/Narva.png', { 'If-None-Match': tag })).status, 304);
  fs.writeFileSync(path.join(dataDir, 'art', 'maps', 'Narva.png'), 'replaced');
  assert.equal(await (await root.raw('/art/maps/Narva.png', { 'If-None-Match': tag })).text(), 'replaced');
  for (const bad of ['/art/maps/notes.txt', '/art/maps/..%2F..%2Fsecret.key', '/art/other/Narva.png']) {
    assert.equal((await root.raw(bad)).status, 404, bad);
  }
  assert.equal((await fetch(`${base}/art/maps/Narva.png`)).status, 401);
});

test('SL kit and locked squad rules warn first, then act, and stay off by default', async () => {
  const { server, plugin } = await panel();
  const rules = plugin.rules;
  assert.equal(rules.config.slKit.enabled, false);
  assert.equal(rules.config.lockedSquad.enabled, false);
  let time = Date.now();
  rules.now = () => time;
  const leader = server.players.find((p) => p.teamID === 1 && p.isLeader && p.squadID === 2);
  leader.role = 'USA_Rifleman_01';
  for (const other of server.players.filter((p) => p.isLeader && p !== leader)) other.role = 'USA_SLCrewman_01';
  rules.update({ slKit: { enabled: true, minPlayers: 0, warnAfterMinutes: 1, removeAfterMinutes: 2 } });
  await rules.onPlayers();
  assert.equal(server.sent.length, 0);
  time += 61000;
  await rules.onPlayers();
  await rules.onPlayers();
  assert.equal(server.sent.length, 1, 'warned once');
  time += 61000;
  await rules.onPlayers();
  assert.equal(server.sent.at(-1), `AdminRemovePlayerFromSquadById ${leader.playerID}`);
  assert.equal(plugin.store.player(leader.eosID).history.length, 1, 'leaving a squad is not on the record');

  rules.update({ slKit: { enabled: false }, lockedSquad: { enabled: true, minPlayers: 0, minMembers: 20, warnAfterMinutes: 0, disbandAfterMinutes: 1 } });
  server.sent.length = 0;
  await rules.onPlayers();
  assert.equal(server.sent.length, 2, 'one warning per locked squad');
  time += 61000;
  await rules.onPlayers();
  assert.deepEqual(server.sent.slice(2), ['AdminDisbandSquad 1 1', 'AdminDisbandSquad 2 1']);
});

test('an installed plugin without a config line can be added, switched off', async () => {
  const { root: dir, session } = await panel();
  const owner = await session('root');
  const file = path.join(dir, 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.plugins = config.plugins.filter((p) => p.plugin !== 'SeedingMode');
  fs.writeFileSync(file, JSON.stringify(config));
  const before = await owner.get('/api/plugins');
  assert.deepEqual(before.data.missing.map((p) => p.name), ['SeedingMode']);
  assert.equal((await owner.post('/api/plugins', { op: 'add', name: 'SeedingMode', confirmPassword: 'wrong-password-1' })).status, 403);
  const added = await owner.post('/api/plugins', { op: 'add', name: 'SeedingMode', confirmPassword: PW });
  assert.equal(added.status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).plugins.at(-1), { plugin: 'SeedingMode', enabled: false });
  assert.equal((await owner.post('/api/plugins', { op: 'add', name: '__proto__', confirmPassword: PW })).status, 400);
  const option = added.data.plugins.find((p) => p.name === 'SeedingMode').options.find((o) => o.name === 'interval');
  assert.deepEqual([option.default, option.set], [150000, false]);
});
