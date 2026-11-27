// Ranks, ticks and every way of getting a permission one should not have.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

import { loadUsers } from '../../src/squadjs/admin-panel/auth.js';
import { IDS, PERMISSIONS, RANK_DEFAULTS, effective, eligible } from '../../src/squadjs/admin-panel/permissions.js';
import { openVault } from '../../src/squadjs/admin-panel/vault.js';
import { fakeServer } from '../mock_data/fake-server.mjs';
import { install } from './install.mjs';

const PW = 'Mavi-Kedi-42-Pencere';
const TEMP = 'Gecici-Anahtar-91';
const running = [];
let nextPort = 19800 + Math.floor(Math.random() * 150);
after(async () => {
  for (const p of running) await p.unmount();
});

async function panel(users) {
  const installed = await install();
  const dataDir = path.join(installed.root, 'admin-panel-data');
  await installed.addUsers(dataDir, users.map(([name, rank]) => ({ name, rank, password: PW })));
  const server = fakeServer({ perTeam: 6 });
  const port = nextPort++;
  const plugin = new installed.AdminPanel(server, { port, dataDir, configFile: path.join(installed.root, 'config.json') });
  await plugin.mount();
  running.push(plugin);
  const base = `http://127.0.0.1:${port}`;
  const session = async (name, password = PW) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SA': '1' }, body: JSON.stringify({ name, password }) });
    assert.equal(res.status, 200, `sign in ${name}`);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const get = async (url) => {
      const r = await fetch(base + url, { headers: { Cookie: cookie } });
      return { status: r.status, data: await r.json() };
    };
    const post = async (url, body) => {
      const r = await fetch(base + url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-SA': '1', Cookie: cookie } });
      return { status: r.status, data: await r.json() };
    };
    const staff = (body) => post('/api/staff', { confirmPassword: password, ...body });
    const ticks = (target, changes) => staff({ op: 'ticks', name: target, changes });
    const ranks = (rank, changes) => post('/api/ranks', { rank, changes, confirmPassword: password });
    const act = (action, body = {}) => post(`/api/action/${action}`, body);
    const can = async () => (await get('/api/me')).data.can;
    return { cookie, get, post, staff, ticks, ranks, act, can };
  };
  return { server, dataDir, base, session, id: server.players[0].eosID };
}

test('the table matches the approved plan', () => {
  const byClass = (c) => IDS.filter((id) => PERMISSIONS[id].class === c);
  assert.deepEqual(byClass('A'), ['view.live', 'account.self']);
  assert.deepEqual(byClass('D'), ['ban.perm', 'map.now', 'match.control', 'rules.edit', 'shuffle.settings', 'staff.manage', 'perm.grant', 'log.ip']);
  assert.deepEqual(byClass('E'), ['plugins', 'restart', 'staff.admins', 'ranks.edit', 'owner.transfer', 'data.manage']);
  assert.deepEqual(RANK_DEFAULTS.junior, ['chat.view', 'kills.view', 'notes.view', 'notes.add', 'warn']);
  for (const [rank, list] of Object.entries(RANK_DEFAULTS)) for (const id of list) assert.ok(eligible(rank, id), `${rank} ${id}`);
  const senior = effective({ rank: 'senior' });
  assert.ok(senior.has('ban.short') && senior.has('map.next') && senior.has('rules.view') && senior.has('kick'));
  assert.ok(!senior.has('ban.long') && !senior.has('log.admin') && !senior.has('shuffle.switches'));
  const admin = effective({ rank: 'admin' });
  for (const id of ['ban.perm', 'staff.manage', 'perm.grant', 'log.ip', 'plugins', 'restart']) assert.ok(!admin.has(id), id);
  assert.ok(admin.has('ban.long') && admin.has('map.now') && admin.has('rules.edit'));
  assert.equal(effective({ rank: 'owner' }).size, IDS.length);
  // ticks the rank may not hold are ignored even if a file says otherwise
  const forged = effective({ rank: 'junior', grants: ['ban.short', 'perm.grant', 'plugins', 'ban.perm', 'nonsense'] });
  assert.ok(['ban.short', 'perm.grant', 'plugins', 'ban.perm'].every((id) => !forged.has(id)));
});

test('each action checks its own permission; ban length decides', async () => {
  const p = await panel([['root', 'owner'], ['sam', 'senior'], ['jim', 'junior'], ['ada', 'admin']]);
  const [sam, jim, ada] = [await p.session('sam'), await p.session('jim'), await p.session('ada')];
  const ban = (who, length) => who.act('ban', { ids: [p.id], length, reason: 'x' });
  for (const length of ['1h', '1d', '7d', '30d', '0']) assert.equal((await ban(jim, length)).status, 403, `junior ${length}`);
  assert.equal((await ban(sam, '1d')).status, 200);
  for (const length of ['7d', '30d', '0']) assert.equal((await ban(sam, length)).status, 403, `senior ${length}`);
  assert.equal((await ban(ada, '30d')).status, 200);
  assert.equal((await ban(ada, '0')).status, 403, 'permanent starts closed for admins');
  assert.equal((await jim.act('warn', { ids: [p.id], message: 'x' })).status, 200);
  for (const [action, body] of [['kick', { ids: [p.id], reason: 'x' }], ['broadcast', { message: 'x' }], ['moveTeam', { ids: [p.id] }],
    ['removeFromSquad', { ids: [p.id] }], ['messageGroup', { group: 'team1', message: 'x' }], ['nextLayer', { layer: 'Narva_AAS_v1' }],
    ['changeLayer', { layer: 'Narva_AAS_v1' }], ['endMatch', {}], ['restartMatch', {}], ['shuffle', { command: 'now' }]]) {
    assert.equal((await jim.act(action, body)).status, 403, `junior ${action}`);
  }
  assert.equal((await sam.act('shuffle', { command: 'lock 0' })).status, 403);
  assert.equal((await sam.act('shuffle', { command: 'now' })).status, 200, 'a round action is allowed');
  assert.equal((await sam.act('changeLayer', { layer: 'Narva_AAS_v1' })).status, 403);
  assert.equal((await sam.post('/api/rules', { teamkill: { enabled: true } })).status, 403);
  assert.equal((await sam.get('/api/rules')).status, 200);
  assert.equal((await jim.get('/api/rules')).status, 403);
  assert.equal((await ada.get('/api/plugins')).status, 403);
  assert.equal((await ada.post('/api/restart', { confirmPassword: PW })).status, 403);
});

test('mods cannot see or touch permissions in any way', async () => {
  const p = await panel([['root', 'owner'], ['sam', 'senior'], ['jim', 'junior']]);
  for (const name of ['sam', 'jim']) {
    const me = await p.session(name);
    assert.equal((await me.get('/api/staff')).status, 403);
    assert.equal((await me.get('/api/ranks')).status, 403);
    for (const body of [{ op: 'ticks', name, changes: { 'ban.perm': true } }, { op: 'ticks', name: 'jim', changes: { warn: false } },
      { op: 'add', name: 'puppet', rank: 'junior', password: TEMP }, { op: 'reset', name: 'root', password: TEMP }, { op: 'remove', name: 'root' },
      { op: 'rank', name, rank: 'admin' }, { op: 'transfer', name }, { op: 'resetTicks', name: 'jim' }]) {
      assert.equal((await me.staff(body)).status, 403, `${name} ${body.op}`);
    }
    assert.equal((await me.ranks('junior', { kick: true })).status, 403);
  }
  assert.deepEqual(loadUsers(openVault(p.dataDir)).map((u) => [u.name, u.rank, u.grants.length]), [['root', 'owner', 0], ['sam', 'senior', 0], ['jim', 'junior', 0]]);
});

test('an admin hands out only what the rules allow', async () => {
  const p = await panel([['root', 'owner'], ['ada', 'admin'], ['alan', 'admin'], ['sam', 'senior'], ['jim', 'junior']]);
  const root = await p.session('root');
  const ada = await p.session('ada');
  const sam = await p.session('sam');
  assert.equal((await ada.get('/api/staff')).status, 403, 'no right to hand out yet');
  assert.equal((await root.ticks('ada', { 'perm.grant': true })).status, 200);
  assert.equal((await ada.get('/api/staff')).status, 200, 'works on the open session');

  const ban7 = () => sam.act('ban', { ids: [p.id], length: '7d', reason: 'x' });
  assert.equal((await ban7()).status, 403);
  assert.equal((await ada.ticks('sam', { 'ban.long': true })).status, 200);
  assert.equal((await ban7()).status, 200, 'the open session has the new tick at once');
  assert.equal((await ada.ticks('sam', { 'ban.long': false })).status, 200);
  assert.equal((await ban7()).status, 403);

  const refused = [
    ['jim', { 'ban.short': true }, 'senior power on a junior'],
    ['jim', { 'ban.perm': true }, 'critical on a junior'],
    ['sam', { 'ban.perm': true }, 'critical on a senior'],
    ['sam', { 'perm.grant': true }, 'the grant right to a mod'],
    ['sam', { plugins: true }, 'a locked permission'],
    ['sam', { 'view.live': false }, 'a basic permission'],
    ['alan', { kick: false }, 'an equal rank'],
    ['ada', { 'ban.perm': true }, 'herself'],
    ['root', { kick: false }, 'the owner'],
    ['sam', { nonsense: true }, 'an unknown permission'],
    ['sam', JSON.parse('{"__proto__":true}'), 'a prototype key'],
    ['sam', { kick: 'yes' }, 'a value that is not on or off']
  ];
  for (const [target, changes, what] of refused) assert.ok([400, 403].includes((await ada.ticks(target, changes)).status), what);
  // one forbidden tick refuses the whole request
  assert.equal((await ada.ticks('sam', { 'log.admin': true, 'ban.perm': true })).status, 403);
  assert.ok(!(await sam.can()).includes('log.admin'));

  // only what the admin holds
  assert.equal((await root.ticks('ada', { 'ban.long': false })).status, 200);
  assert.equal((await ada.ticks('sam', { 'ban.long': true })).status, 403);
  assert.equal((await root.ticks('sam', { 'ban.long': true })).status, 200);
  assert.equal((await ada.ticks('sam', { 'ban.long': false })).status, 403, 'cannot take what she does not hold');
  assert.equal((await ada.staff({ op: 'resetTicks', name: 'sam' })).status, 403);
  // the grant right itself is the owner's to give
  assert.equal((await root.ticks('alan', { 'perm.grant': true })).status, 200);
  assert.equal((await ada.ticks('alan', { 'perm.grant': false })).status, 403);
  // taking the right away works at once, earlier ticks stay
  assert.equal((await root.ticks('ada', { 'perm.grant': false })).status, 200);
  assert.equal((await ada.ticks('sam', { kick: false })).status, 403);
  assert.ok((await sam.can()).includes('ban.long'));
  // password again
  assert.equal((await root.post('/api/staff', { op: 'ticks', name: 'sam', changes: { kick: false }, confirmPassword: 'wrong' })).status, 403);
});

test('managing mod accounts cannot be used to get more', async () => {
  const p = await panel([['root', 'owner'], ['ada', 'admin'], ['sam', 'senior']]);
  const root = await p.session('root');
  assert.equal((await root.ticks('ada', { 'staff.manage': true, 'ban.short': false })).status, 200);
  const ada = await p.session('ada');

  assert.equal((await ada.staff({ op: 'add', name: 'boss2', rank: 'admin', password: TEMP })).status, 403);
  assert.equal((await ada.staff({ op: 'add', name: 'king', rank: 'owner', password: TEMP })).status, 403);
  assert.equal((await ada.staff({ op: 'add', name: 'puppet', rank: 'senior', password: TEMP })).status, 200);
  const puppet = loadUsers(openVault(p.dataDir)).find((u) => u.name === 'puppet');
  assert.deepEqual(puppet.denies, ['ban.short'], 'what ada lacks is held back');
  assert.ok(!effective(puppet).has('ban.short'));

  // sam can ban for a day, ada cannot: she must not be able to become sam
  assert.equal((await ada.staff({ op: 'reset', name: 'sam', password: TEMP })).status, 403);
  assert.equal((await ada.staff({ op: 'reset', name: 'puppet', password: 'Baska-Anahtar-73' })).status, 200);
  assert.equal((await ada.staff({ op: 'reset', name: 'root', password: TEMP })).status, 403);
  assert.equal((await ada.staff({ op: 'rank', name: 'puppet', rank: 'junior' })).status, 403);
  assert.equal((await ada.staff({ op: 'transfer', name: 'puppet' })).status, 403);
  assert.equal((await ada.staff({ op: 'remove', name: 'ada' })).status, 403);
  assert.equal((await ada.staff({ op: 'remove', name: 'puppet' })).status, 200);
});

test('rank defaults, rank changes and handing over ownership belong to the owner', async () => {
  const p = await panel([['root', 'owner'], ['ada', 'admin'], ['sam', 'senior'], ['jim', 'junior']]);
  const root = await p.session('root');
  const jim = await p.session('jim');
  const ada = await p.session('ada');
  assert.equal((await ada.ranks('junior', { kick: true })).status, 403);
  assert.equal((await root.ranks('junior', { 'ban.short': true })).status, 400, 'not available to juniors');
  assert.equal((await root.ranks('owner', { kick: false })).status, 400);
  assert.equal((await root.ranks('junior', { plugins: true })).status, 400);
  assert.equal((await root.ranks('junior', { kick: true })).status, 200);
  assert.ok((await jim.can()).includes('kick'));

  assert.equal((await root.ticks('sam', { 'ban.long': true })).status, 200);
  assert.equal((await root.staff({ op: 'rank', name: 'sam', rank: 'junior' })).status, 200);
  const sam = loadUsers(openVault(p.dataDir)).find((u) => u.name === 'sam');
  assert.deepEqual([sam.rank, sam.grants], ['junior', []], 'ticks a junior cannot hold are gone');
  assert.equal((await root.staff({ op: 'rank', name: 'sam', rank: 'owner' })).status, 400);
  assert.equal((await root.staff({ op: 'transfer', name: 'sam' })).status, 400, 'only to an admin');

  const done = await root.staff({ op: 'transfer', name: 'ada' });
  assert.equal(done.status, 200);
  assert.deepEqual(done.data, { gone: true });
  const users = loadUsers(openVault(p.dataDir));
  assert.deepEqual(users.filter((u) => u.rank === 'owner').map((u) => u.name), ['ada']);
  assert.equal(users.find((u) => u.name === 'root').rank, 'admin');
  assert.equal((await root.ranks('junior', { kick: false })).status, 403);
  assert.equal((await ada.ranks('junior', { kick: false })).status, 200);
});

test('data and the live stream follow the permissions', async () => {
  const p = await panel([['root', 'owner'], ['jim', 'junior']]);
  const root = await p.session('root');
  const jim = await p.session('jim');
  await root.act('warn', { ids: [p.id], message: 'x' });
  await root.act('note', { id: p.id, text: 'NOTETEXT' });
  const chat = (text) => p.server.emit('CHAT_MESSAGE', { chat: 'ChatAll', player: p.server.players[0], eosID: p.id, message: text });

  const abort = new AbortController();
  const stream = await fetch(`${p.base}/api/events`, { headers: { Cookie: jim.cookie }, signal: abort.signal });
  const reader = stream.body.getReader();
  let seen = '';
  const until = async (text) => {
    while (!seen.includes(text)) seen += new TextDecoder().decode((await reader.read()).value);
  };
  chat('FIRSTCHAT');
  await until('FIRSTCHAT');
  await root.act('broadcast', { message: 'ADMINONLY' });
  assert.equal((await jim.get('/api/logs?kind=admin')).data.length, 0);

  assert.equal((await root.ticks('jim', { 'chat.view': false, 'notes.view': false, 'kills.view': false })).status, 200);
  await until('event: me');
  chat('SECONDCHAT');
  p.server.emit('TEAMKILL', { attacker: p.server.players[0], victim: p.server.players[1], weapon: 'BP_SECRETWEAPON_C' });
  p.server.emit('PLAYER_CONNECTED', { player: p.server.players[2] });
  await until('"event":"Joined"');
  assert.doesNotMatch(seen, /SECONDCHAT|SECRETWEAPON|ADMINONLY/);
  abort.abort();

  assert.deepEqual((await jim.get('/api/logs?kind=chat')).data, []);
  assert.deepEqual((await jim.get('/api/logs?kind=tk')).data, []);
  const record = (await jim.get(`/api/player?id=${p.id}`)).data;
  assert.equal(record.hidden, true);
  assert.doesNotMatch(JSON.stringify(record), /NOTETEXT/);
  assert.ok((await jim.get('/api/state')).data.players.every((x) => x.notes === 0 && x.warns === 0));
  assert.ok((await root.get('/api/state')).data.players.some((x) => x.notes === 1));

  // addresses are a permission of their own
  assert.equal((await root.staff({ op: 'rank', name: 'jim', rank: 'admin' })).status, 200);
  const admins = (await jim.get('/api/logs?kind=admin')).data;
  assert.ok(admins.length && admins.every((e) => !/^Login/.test(e.action)));
  assert.equal((await root.ticks('jim', { 'log.ip': true })).status, 200);
  assert.ok((await jim.get('/api/logs?kind=admin')).data.some((e) => e.action === 'Login'));
});

test('every change of permissions is logged with who, whom and what', async () => {
  const p = await panel([['root', 'owner'], ['sam', 'senior']]);
  const root = await p.session('root');
  await root.ticks('sam', { 'ban.long': true, kick: false });
  const log = (await root.get('/api/logs?kind=admin')).data.find((e) => e.action === 'Permissions');
  assert.deepEqual([log.by, log.target, log.reason], ['root', 'sam', '+ban.long -kick']);
});

test('accounts written by the earlier version are carried over with a single owner', async () => {
  const installed = await install();
  const vault = openVault(fs.mkdtempSync(path.join(installed.root, 'old-')));
  vault.writeJson('users.enc', 'users', ['owner', 'owner', 'admin', 'moderator'].map((role, i) => ({ name: `u${i}`, role, hash: 'scrypt$x' })));
  assert.deepEqual(loadUsers(vault).map((u) => u.rank), ['owner', 'admin', 'admin', 'junior']);
});
