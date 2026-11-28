// Smart Map Pool: what it writes into ServerConfig, and above all what it leaves alone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { LAYER_FILES, MapPool, WEEK, findConfigDir, readKey, writeKey } from '../../src/squadjs/admin-panel/mappool.js';
import { openVault } from '../../src/squadjs/admin-panel/vault.js';
import { build } from '../../src/utils/sync-map-pool.mjs';
import { fakeServer } from '../mock_data/fake-server.mjs';
import { OWN, writeServerConfig } from '../mock_data/server-config.mjs';
import { install } from './install.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sa-pool-'));
const setup = () => {
  const dir = writeServerConfig(tmp());
  const dataDir = tmp();
  const clock = { at: Date.parse('2026-03-02T10:00:00Z') };
  const vault = openVault(dataDir);
  const host = new MapPool({ vault, dir, now: () => clock.at });
  const read = (name) => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : null);
  const untouched = () => {
    for (const name of [...LAYER_FILES, 'VoteConfig.cfg', 'Server.cfg']) assert.equal(read(name), OWN[name] ?? null, name);
  };
  return { dir, dataDir, vault, host, clock, read, untouched };
};

test('a key is changed on its own line; comments and every other line stay', () => {
  const text = OWN['VoteConfig.cfg'];
  assert.equal(readKey(text, 'MapSkipRounds'), '2');
  assert.equal(writeKey(text, 'MapSkipRounds', '3'), text.replace('\r\nMapSkipRounds=2', '\r\nMapSkipRounds=3'));
  const added = writeKey(text, 'UniqueMap', 'true');
  assert.equal(added, `${text}UniqueMap=true\r\n`);
  assert.equal(writeKey(added, 'UniqueMap', null), text);
});

test('one pool at a time: the next one replaces it, and the own files come back as they were', () => {
  const { host, read, untouched, dataDir } = setup();
  host.apply('03-day-night');
  const day = read('LayerVoting.cfg');
  assert.match(day, /Narva_RAAS_v1/);
  assert.match(read('LayerVotingNight.cfg'), /Mutaha_RAAS_v1/);
  assert.equal(readKey(read('VoteConfig.cfg'), 'NightTime'), '19:00-06:00');
  assert.equal(readKey(read('VoteConfig.cfg'), 'MapSkipRounds'), '3');
  assert.equal(readKey(read('VoteConfig.cfg'), 'LayerVoteDuration'), '30');
  assert.equal(read('LayerVotingLowPlayers.cfg'), null);

  // the next pool has no night list and no NightTime: both go back to what they were
  host.apply('05-raas-best');
  assert.notEqual(read('LayerVoting.cfg'), day);
  assert.doesNotMatch(read('LayerVoting.cfg'), /Invasion_v/);
  assert.equal(read('LayerVotingNight.cfg'), OWN['LayerVotingNight.cfg']);
  assert.equal(readKey(read('VoteConfig.cfg'), 'NightTime'), null);
  assert.equal(host.describe().active.main.id, '05-raas-best');

  // a line the pools never set can be edited meanwhile and is kept
  fs.writeFileSync(path.join(host.dir, 'VoteConfig.cfg'), read('VoteConfig.cfg').replace('LayerVoteDuration=30', 'LayerVoteDuration=45'));
  host.restore();
  assert.equal(readKey(read('VoteConfig.cfg'), 'LayerVoteDuration'), '45');
  fs.writeFileSync(path.join(host.dir, 'VoteConfig.cfg'), read('VoteConfig.cfg').replace('LayerVoteDuration=45', 'LayerVoteDuration=30'));
  untouched();
  assert.equal(fs.readFileSync(path.join(dataDir, 'map-pool-backup', 'before-panel', 'LayerVoting.cfg'), 'utf8'), OWN['LayerVoting.cfg']);
});

test('the seeding list goes on top of a pool and leaves its vote rules alone', () => {
  const { host, read, untouched } = setup();
  host.apply('04-all-best');
  const rules = read('VoteConfig.cfg');
  host.apply('13-seed-low-players');
  assert.match(read('LayerVotingLowPlayers.cfg'), /Sumari_RAAS_v1/);
  assert.equal(read('VoteConfig.cfg'), rules);
  assert.deepEqual([host.state.main.id, host.state.seed], ['04-all-best', '13-seed-low-players']);
  host.apply('05-raas-best');
  assert.ok(read('LayerVotingLowPlayers.cfg'), 'another pool keeps the seeding list');
  host.removeSeed();
  assert.equal(read('LayerVotingLowPlayers.cfg'), null, 'a file that was not there is gone again');
  host.restore();
  untouched();
});

test('files changed by hand are not written over unless told to, and a copy is kept', () => {
  const { host, read, dataDir } = setup();
  host.apply('04-all-best');
  const mine = 'Harju_RAAS_v1\n';
  fs.writeFileSync(path.join(host.dir, 'LayerVoting.cfg'), mine);
  assert.deepEqual(host.describe().active.edited, ['LayerVoting.cfg']);
  assert.throws(() => host.apply('05-raas-best'), /changed by hand/);
  assert.throws(() => host.restore(), /changed by hand/);
  assert.equal(read('LayerVoting.cfg'), mine);
  host.apply('05-raas-best', { force: true });
  const folder = fs.readdirSync(path.join(dataDir, 'map-pool-backup')).find((f) => f.startsWith('edited-'));
  assert.equal(fs.readFileSync(path.join(dataDir, 'map-pool-backup', folder, 'LayerVoting.cfg'), 'utf8'), mine);
  // only the line ends changed: that is not an edit
  fs.writeFileSync(path.join(host.dir, 'LayerVoting.cfg'), read('LayerVoting.cfg').replace(/\n/g, '\r\n'));
  assert.deepEqual(host.describe().active.edited, []);
});

test('a weekly pool moves on by itself, catches up, survives a restart and stops at a hand edit', () => {
  const { host, read, vault, dir, clock } = setup();
  host.apply('01-weekly-plan-4w');
  const first = read('LayerVoting.cfg');
  assert.equal(host.tick(), null);
  clock.at += WEEK;
  assert.deepEqual(host.tick(), { pool: 'Weekly 4 Weeks', week: 2 });
  assert.notEqual(read('LayerVoting.cfg'), first);
  assert.equal(host.tick(), null, 'only once');
  // the panel was off for three weeks: week 2 + 3 is week 1 again
  const later = new MapPool({ vault, dir, now: () => clock.at });
  clock.at += 3 * WEEK;
  assert.equal(later.tick().week, 1);
  assert.equal(read('LayerVoting.cfg'), first);
  assert.ok(later.state.main.nextAt > clock.at && later.state.main.nextAt <= clock.at + WEEK);
  later.setWeek(2);
  assert.equal(later.state.main.week, 2);
  assert.throws(() => later.setWeek(9), /Unknown week/);
  assert.throws(() => later.setAuto(true, clock.at - 1), /five weeks/);
  fs.writeFileSync(path.join(dir, 'LayerVoting.cfg'), 'Harju_RAAS_v1\n');
  clock.at += 2 * WEEK;
  assert.match(later.tick().error, /changed by hand/);
  assert.equal(read('LayerVoting.cfg'), 'Harju_RAAS_v1\n');
  assert.equal(later.state.main.auto, false);
  assert.equal(later.tick(), null);
});

test('without a folder nothing is written, and the folder is found next to the game log', () => {
  const root = tmp();
  const dir = writeServerConfig(path.join(root, 'SquadGame'));
  const logDir = path.join(root, 'SquadGame', 'Saved', 'Logs');
  assert.equal(findConfigDir({ option: '', server: { options: { logReaderMode: 'tail', logDir } }, root }), dir);
  assert.equal(findConfigDir({ option: '', server: { options: { logReaderMode: 'ftp', logDir } }, root }), null);
  assert.equal(findConfigDir({ option: 'nowhere', server: {}, root }), null);
  assert.equal(findConfigDir({ option: 'SquadGame/ServerConfig', server: {}, root }), dir);
  const none = new MapPool({ vault: openVault(tmp()) });
  assert.equal(none.describe().status, 'nofolder');
  assert.equal(none.describe().pools.length, 32);
  assert.throws(() => none.apply('04-all-best'), /not found/);
});

const running = [];
after(async () => { for (const p of running) await p.unmount(); });

test('through the web: the right, the password and the log; without the folder the page says so', async () => {
  const installed = await install();
  const dataDir = path.join(installed.root, 'admin-panel-data');
  const dir = writeServerConfig(installed.root);
  const PW = 'Mavi-Kedi-42-Pencere';
  await installed.addUsers(dataDir, [['root', 'owner'], ['sam', 'senior'], ['jim', 'junior']].map(([name, rank]) => ({ name, rank, password: PW })));
  const port = 20600 + Math.floor(Math.random() * 300);
  const plugin = new installed.AdminPanel(fakeServer({ perTeam: 4 }), { port, dataDir, configFile: path.join(installed.root, 'config.json'), serverConfigDir: dir });
  await plugin.mount();
  running.push(plugin);
  const base = `http://127.0.0.1:${port}`;
  const session = async (name) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SA': '1' }, body: JSON.stringify({ name, password: PW }) });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const out = async (r) => ({ status: r.status, data: await r.json() });
    return {
      get: async () => out(await fetch(`${base}/api/mappool`, { headers: { Cookie: cookie } })),
      post: async (body) => out(await fetch(`${base}/api/mappool`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-SA': '1', Cookie: cookie } }))
    };
  };
  const [root, sam, jim] = [await session('root'), await session('sam'), await session('jim')];
  assert.equal((await jim.get()).status, 403);
  const seen = (await sam.get()).data;
  assert.deepEqual([seen.status, seen.pools.length, seen.folder, seen.voteMode.ok], ['ready', 32, null, true]);
  assert.equal((await sam.post({ op: 'apply', id: '04-all-best', confirmPassword: PW })).status, 403);
  assert.notEqual((await root.post({ op: 'apply', id: '04-all-best', confirmPassword: 'wrong' })).status, 200);
  assert.equal((await root.post({ op: 'apply', id: '04-all-best' })).status === 200, false);
  assert.equal(fs.readFileSync(path.join(dir, 'LayerVoting.cfg'), 'utf8'), OWN['LayerVoting.cfg']);
  assert.equal((await root.post({ op: 'apply', id: '../../x', confirmPassword: PW })).status, 400);
  const done = await root.post({ op: 'apply', id: '04-all-best', confirmPassword: PW });
  assert.deepEqual([done.status, done.data.active.main.id, done.data.folder], [200, '04-all-best', dir]);
  // some of the pool's layers are not in this small test list
  assert.ok(done.data.pools.find((p) => p.id === '04-all-best').unknown.length > 0);
  assert.ok(plugin.store.logs.admin.some((e) => e.action === 'Map pool' && e.target === 'All Maps Best' && e.by === 'root'));
  assert.equal((await root.post({ op: 'restore', confirmPassword: PW })).status, 200);
  assert.equal(fs.readFileSync(path.join(dir, 'LayerVoting.cfg'), 'utf8'), OWN['LayerVoting.cfg']);
});

const sibling = path.join(HERE, '../../../Squad-MapPool');
test('the built-in map pools are the current ones', { skip: !fs.existsSync(sibling) && 'the Squad-MapPool project is not here' }, () => {
  const copy = JSON.parse(fs.readFileSync(path.join(HERE, '../../src/squadjs/admin-panel/map-pool/pools.json'), 'utf8'));
  assert.deepEqual(copy, JSON.parse(JSON.stringify(build(sibling))), 'run: node src/utils/sync-map-pool.mjs');
});
