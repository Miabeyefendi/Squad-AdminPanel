// Attacks on the running panel.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { after, test } from 'node:test';

import { Auth, passwordProblem } from '../../src/squadjs/admin-panel/auth.js';
import { Limiter } from '../../src/squadjs/admin-panel/limiter.js';
import { openVault } from '../../src/squadjs/admin-panel/vault.js';
import { fakeServer } from '../mock_data/fake-server.mjs';
import { install } from './install.mjs';

const GOOD = 'Mavi-Kedi-42-Pencere';
const running = [];
let nextPort = 19200 + Math.floor(Math.random() * 500);

async function panel(options = {}, users) {
  const installed = await install();
  const dataDir = path.join(installed.root, 'admin-panel-data');
  if (users) await installed.addUsers(dataDir, users);
  options.prepare?.(dataDir);
  const server = fakeServer({ perTeam: 6 });
  const port = nextPort++;
  const plugin = new installed.AdminPanel(server, { port, dataDir, configFile: path.join(installed.root, 'config.json'), ...options });
  await plugin.mount();
  running.push(plugin);
  const base = `http://127.0.0.1:${port}`;
  const req = (url, { method = 'GET', body, cookie, headers = {} } = {}) => fetch(base + url, { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-SA': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  const post = (url, body, cookie, headers) => req(url, { method: 'POST', body, cookie, headers });
  const login = async (name, password, headers) => {
    const res = await post('/api/login', { name, password }, undefined, headers);
    const data = await res.json();
    return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  // fetch cannot set Host or User-Agent freely
  const raw = (url, headers = {}, method = 'GET', body = '') => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    r.on('error', reject);
    r.end(body);
  });
  return { plugin, server, dataDir, port, base, req, post, login, raw, installed };
}
after(async () => {
  for (const p of running) await p.unmount();
});

test('search engines and crawlers are kept out', async () => {
  const p = await panel({}, [{ name: 'boss', rank: 'owner', password: GOOD }]);
  const robots = await p.req('/robots.txt');
  assert.match(await robots.text(), /User-agent: \*\nDisallow: \//);
  const page = await p.req('/');
  for (const res of [robots, page, await p.req('/app.js'), await p.req('/api/state')]) {
    assert.match(res.headers.get('x-robots-tag'), /noindex, nofollow, noarchive, nosnippet/);
  }
  const html = await page.text();
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, /<title>Sign in<\/title>/);
  assert.doesNotMatch(html.split('id="app"')[0], /Squad/i);
  for (const agent of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; bingbot/2.0)',
    'Mozilla/5.0 (compatible; YandexBot/3.0)', 'CensysInspect/1.1', 'Mozilla/5.0 zgrab/0.x', 'GPTBot/1.0', 'Baiduspider', 'facebookexternalhit/1.1']) {
    assert.equal((await p.raw('/', { 'User-Agent': agent })).status, 403, agent);
  }
  assert.equal((await p.raw('/robots.txt', { 'User-Agent': 'Googlebot' })).status, 200);
  const browser = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  assert.equal((await p.raw('/', { 'User-Agent': browser })).status, 200);
});

test('the first account is admin/admin: forced change before anything else', async () => {
  const p = await panel();
  const first = await p.login('admin', 'admin');
  assert.equal(first.status, 200);
  assert.equal(first.data.mustChange, true);
  for (const url of ['/api/state', '/api/logs?kind=chat', '/api/staff', '/api/ranks', '/api/plugins', '/api/events', '/api/layers', '/api/rules']) {
    const res = await p.req(url, { cookie: first.cookie });
    assert.equal(res.status, 403, url);
  }
  assert.equal((await p.post('/api/action/endMatch', {}, first.cookie)).status, 403);
  assert.equal((await p.post('/api/rules', { teamkill: { enabled: true } }, first.cookie)).status, 403);
  assert.deepEqual(p.server.sent, []);

  const change = (body) => p.post('/api/account', body, first.cookie);
  for (const bad of ['admin', 'short1', 'adminadminadmin', 'password123456', '1234567890123', 'aaaaaaaaaaaa', 'my-admin-secret-77']) {
    assert.equal((await change({ currentPassword: 'admin', name: 'admin', newPassword: bad })).status, 400, bad);
  }
  assert.equal((await change({ currentPassword: 'wrong', name: 'boss', newPassword: GOOD })).status, 403);
  assert.equal((await change({ currentPassword: 'admin', name: 'boss' })).status, 400);
  const done = await change({ currentPassword: 'admin', name: 'boss', newPassword: GOOD });
  assert.equal(done.status, 200);
  const cookie = done.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookie, first.cookie);
  assert.equal((await p.req('/api/state', { cookie })).status, 200);
  assert.equal((await p.req('/api/me', { cookie: first.cookie })).status, 401);
  assert.equal((await p.login('admin', 'admin')).status, 401);
  assert.equal((await p.login('boss', GOOD)).status, 200);
});

test('admin/admin does not work through a proxy or under another host name', async () => {
  const p = await panel({ allowedHosts: ['panel.example.org'] });
  assert.equal((await p.login('admin', 'admin', { 'X-Forwarded-For': '203.0.113.9' })).status, 401);
  assert.equal((await p.login('admin', 'admin', { 'X-Real-IP': '203.0.113.9' })).status, 401);
  const body = JSON.stringify({ name: 'admin', password: 'admin' });
  const viaName = await p.raw('/api/login', { Host: 'panel.example.org', 'Content-Type': 'application/json', 'X-SA': '1' }, 'POST', body);
  assert.equal(viaName.status, 401);
  assert.match(viaName.text, /Wrong name or password/);
  const proxied = await panel({ trustProxy: true });
  assert.equal((await proxied.login('admin', 'admin')).status, 401);
});

test('brute force: locked after five tries, also when sent all at once, and a forged address does not help', async () => {
  const p = await panel({}, [{ name: 'boss', rank: 'owner', password: GOOD }]);
  const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => p.login('boss', `guess-${i}`, { 'X-Forwarded-For': `198.51.100.${i}` })));
  let checked = burst.filter((r) => r.status === 401).length;
  assert.ok(checked <= 4, `only four passwords are checked at a time: ${checked}`);
  assert.equal(burst.filter((r) => r.status === 429).length, 40 - checked);
  for (let i = 0; i < 20; i++) if ((await p.login('boss', `more-${i}`, { 'X-Forwarded-For': `203.0.113.${i}` })).status === 401) checked += 1;
  assert.equal(checked, 5, 'five wrong passwords in total, whatever address is claimed');
  assert.equal((await p.login('boss', GOOD)).status, 429);
});

test('brute force from many addresses locks the name, not the admin who is known', async () => {
  const vault = openVault(fs.mkdtempSync(path.join((await install()).root, 'v-')));
  const { saveUsers, hashPassword } = await import('../../src/squadjs/admin-panel/auth.js');
  saveUsers(vault, [{ name: 'boss', rank: 'owner', hash: await hashPassword(GOOD) }]);
  let time = 1000000;
  const auth = new Auth({ vault, now: () => time });
  assert.ok((await auth.login('boss', GOOD, 'home')).id);
  let checked = 0;
  for (let i = 0; i < 40; i++) if ((await auth.login('boss', 'nope', `attacker-${i}`)).error === 'bad') checked += 1;
  assert.equal(checked, 15);
  assert.equal((await auth.login('boss', GOOD, 'someone-new')).error, 'locked');
  assert.ok((await auth.login('boss', GOOD, 'home')).id);
});

test('lock time doubles', () => {
  let time = 0;
  const limit = new Limiter({ limit: 3, lockMs: 1000, now: () => time });
  const waits = [];
  for (let i = 0; i < 6; i++) {
    time += 100000;
    limit.hit('x');
    let wait = 0;
    while (limit.blocked('x')) { wait += 500; time += 500; }
    waits.push(wait);
  }
  assert.deepEqual(waits, [0, 0, 1000, 2000, 4000, 8000]);
});

test('sessions expire when idle and are limited per user', async () => {
  const root = (await install()).root;
  const vault = openVault(path.join(root, 'v'));
  const { saveUsers, hashPassword } = await import('../../src/squadjs/admin-panel/auth.js');
  saveUsers(vault, [{ name: 'boss', rank: 'owner', hash: await hashPassword(GOOD) }]);
  let time = 5000000;
  const auth = new Auth({ vault, idleMinutes: 30, now: () => time, maxSessions: 3 });
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await auth.login('boss', GOOD, 'home')).id);
  assert.deepEqual(ids.map((id) => !!auth.session(id)), [false, false, true, true, true]);
  time += 29 * 60000;
  assert.ok(auth.session(ids[4]));
  assert.ok(auth.session(ids[3], { touch: false }));
  time += 2 * 60000;
  assert.ok(auth.session(ids[4]), 'a used session stays');
  assert.equal(auth.session(ids[3]), null, 'the stream alone does not keep a session');
});

test('registering an account: only with the right, the password again and valid values', async () => {
  const p = await panel({}, [{ name: 'boss', rank: 'owner', password: GOOD }, { name: 'helper', rank: 'admin', password: GOOD }]);
  const helper = (await p.login('helper', GOOD)).cookie;
  const boss = (await p.login('boss', GOOD)).cookie;
  const add = { op: 'add', name: 'newmod', rank: 'junior', password: 'Gecici-Anahtar-91', confirmPassword: GOOD };
  assert.equal((await p.req('/api/staff', { cookie: helper })).status, 403);
  assert.equal((await p.post('/api/staff', add, helper)).status, 403);
  assert.equal((await p.post('/api/staff', { ...add, confirmPassword: 'wrong' }, boss)).status, 403);
  assert.equal((await p.post('/api/staff', { ...add, confirmPassword: undefined }, boss)).status, 403);
  assert.equal((await p.post('/api/staff', { ...add, password: 'weak' }, boss)).status, 400);
  assert.equal((await p.post('/api/staff', { ...add, rank: 'superuser' }, boss)).status, 403);
  assert.equal((await p.post('/api/staff', { ...add, name: '<script>' }, boss)).status, 400);
  const added = await p.post('/api/staff', add, boss);
  assert.equal(added.status, 200);
  assert.doesNotMatch(await added.text(), /scrypt|"hash"/);
  assert.equal((await p.post('/api/staff', { ...add, name: 'NEWMOD' }, boss)).status, 409);

  const mod = await p.login('newmod', 'Gecici-Anahtar-91');
  assert.equal(mod.data.mustChange, true);
  assert.equal((await p.req('/api/state', { cookie: mod.cookie })).status, 403);
  assert.equal((await p.post('/api/staff', { op: 'remove', name: 'newmod', confirmPassword: GOOD }, boss)).status, 200);
  assert.equal((await p.req('/api/me', { cookie: mod.cookie })).status, 401);
});

test('sign in records with addresses are for the main admin only', async () => {
  const p = await panel({}, [{ name: 'boss', rank: 'owner', password: GOOD }, { name: 'helper', rank: 'junior', password: GOOD }]);
  const boss = (await p.login('boss', GOOD)).cookie;
  const helper = (await p.login('helper', GOOD)).cookie;
  assert.match(await (await p.req('/api/logs?kind=admin', { cookie: boss })).text(), /"Login"/);
  assert.doesNotMatch(await (await p.req('/api/logs?kind=admin', { cookie: helper })).text(), /"Login"/);
});

test('injection through the API: prototype keys, RCON lines, shapes and paths', async () => {
  const p = await panel({}, [{ name: 'boss', rank: 'owner', password: GOOD }]);
  const cookie = (await p.login('boss', GOOD)).cookie;
  const untouched = [Object.prototype.toString, Object.prototype.hasOwnProperty, Object.keys(Object.prototype).length];
  for (const body of ['{"__proto__":{"toString":"x"}}', '{"constructor":{"name":"x"}}', '{"teamkill":{"__proto__":1}}', '{"teamkill":{"constructor":"x"}}', '{"teamkill":null}']) {
    assert.equal((await p.post('/api/rules', body, cookie)).status, 400, body);
  }
  for (const body of [`{"index":0,"name":"SeedingMode","confirmPassword":"${GOOD}","options":{"__proto__":{"polluted":1}}}`,
    `{"index":0,"name":"SeedingMode","confirmPassword":"${GOOD}","options":{"constructor":"x"}}`,
    `{"index":0,"name":"SeedingMode","confirmPassword":"${GOOD}","options":{"seedingMessage":{"a":1}}}`,
    `{"index":"__proto__","name":"SeedingMode","confirmPassword":"${GOOD}","enabled":true}`]) {
    assert.equal((await p.post('/api/plugins', body, cookie)).status, 400, body);
  }
  assert.deepEqual([Object.prototype.toString, Object.prototype.hasOwnProperty, Object.keys(Object.prototype).length], untouched);
  assert.equal({}.polluted, undefined);
  for (const name of ['__proto__', 'constructor', 'toString', 'do_warn', 'audit', 'run', 'each', '../warn']) {
    assert.equal((await p.post(`/api/action/${name}`, {}, cookie)).status, 404, name);
  }
  const id = p.server.players[0].eosID;
  for (const [name, body] of [['warn', { ids: [[id]], message: 'x' }], ['warn', { ids: [{ toString: 'x' }], message: 'x' }],
    ['kick', { ids: [`${id}" ; AdminEndMatch`], reason: 'x' }], ['ban', { ids: [id], length: '1d\nAdminEndMatch', reason: 'x' }],
    ['nextLayer', { layer: ['Narva_AAS_v1'] }], ['nextLayer', { layer: 'Narva_AAS_v1', team1: 'USA\nAdminEndMatch' }],
    ['shuffle', { command: 'now\nunlock' }], ['messageGroup', { group: '__proto__', message: 'x' }]]) {
    assert.ok((await p.post(`/api/action/${name}`, body, cookie)).status >= 400, `${name} ${JSON.stringify(body)}`);
  }
  assert.deepEqual(p.server.sent, []);
  await p.post('/api/action/broadcast', { message: 'hi\r\nAdminKick "x" y\u0000\u202egnp.exe\u200b"' }, cookie);
  assert.deepEqual(p.server.sent, ["AdminBroadcast hi AdminKick 'x' y gnp.exe'"]);
  for (const url of ['/../admin-panel.js', '/%2e%2e/admin-panel.js', '/..%2fadmin-panel-data/secret.key', '/secret.key', '/users.enc', '/__proto__', '/constructor']) {
    const res = await p.raw(url, { Cookie: cookie });
    assert.equal(res.status, 404, url);
  }
});

test('internal errors do not leak paths', async () => {
  const p = await panel({}, [{ name: 'boss', rank: 'owner', password: GOOD }]);
  const cookie = (await p.login('boss', GOOD)).cookie;
  fs.writeFileSync(path.join(p.installed.root, 'config.json'), '{broken');
  const res = await p.req('/api/plugins', { cookie });
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /config\.json|sa-install|JSON|position/);
});

test('requests from other sites, floods and slow clients', async () => {
  const p = await panel({}, [{ name: 'boss', rank: 'owner', password: GOOD }]);
  const cookie = (await p.login('boss', GOOD)).cookie;
  assert.equal((await p.raw('/api/state', { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await p.raw('/api/state', { Cookie: cookie, Host: 'attacker.example' })).status, 421);
  let limited = 0;
  for (let i = 0; i < 140; i++) if ((await p.post('/api/action/nothing', {}, cookie)).status === 429) limited += 1;
  assert.ok(limited >= 15, `limited ${limited}`);
  const closedAfter = await new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect(p.port, '127.0.0.1', () => socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n'));
    socket.on('data', () => {});
    socket.on('close', () => resolve(Date.now() - started));
    socket.setTimeout(30000, () => socket.destroy());
  });
  assert.ok(closedAfter < 17000, `an unfinished request was held for ${closedAfter} ms`);
});

test('too many live streams: the oldest one of a session is closed', async () => {
  const p = await panel({}, [{ name: 'boss', rank: 'owner', password: GOOD }]);
  const cookie = (await p.login('boss', GOOD)).cookie;
  const aborts = [];
  for (let i = 0; i < 6; i++) {
    const abort = new AbortController();
    aborts.push(abort);
    await fetch(`${p.base}/api/events`, { headers: { Cookie: cookie }, signal: abort.signal });
  }
  assert.ok(p.plugin.web.clients() <= 3);
  for (const a of aborts) a.abort();
});

test('everything on disk is encrypted; tampering and a wrong key are refused', async () => {
  const p = await panel({}, [{ name: 'boss', rank: 'owner', password: GOOD }]);
  const cookie = (await p.login('boss', GOOD)).cookie;
  const target = p.server.players[0];
  await p.post('/api/action/ban', { ids: [target.eosID], length: '1d', reason: 'SECRETREASON', note: 'SECRETNOTE' }, cookie);
  await p.post('/api/rules', { chatFilter: { words: ['SECRETWORD'] } }, cookie);
  p.server.emit('CHAT_MESSAGE', { chat: 'ChatAll', player: target, eosID: target.eosID, message: 'SECRETCHAT' });
  const files = fs.readdirSync(p.dataDir);
  for (const name of ['users.enc', 'players.enc', 'rules.enc', 'secret.key']) assert.ok(files.includes(name), name);
  for (const name of files) {
    const text = fs.readFileSync(path.join(p.dataDir, name)).toString('latin1');
    assert.doesNotMatch(text, /SECRET|boss|owner|scrypt|Player 1|127\.0\.0\.1/, name);
  }
  const vault = openVault(p.dataDir);
  const users = fs.readFileSync(path.join(p.dataDir, 'users.enc'), 'utf8');
  const flipped = users.slice(0, -6) + (users.at(-6) === 'A' ? 'B' : 'A') + users.slice(-5);
  assert.throws(() => vault.open(flipped, 'users'), /cannot be decrypted/);
  assert.throws(() => vault.open(users, 'rules'), /cannot be decrypted/);
  assert.throws(() => vault.open('[{"name":"evil","role":"owner"}]', 'users'), /not encrypted/);
  assert.throws(() => openVault(p.dataDir, 'another-key-of-sufficient-length').open(users, 'users'), /cannot be decrypted/);
  assert.throws(() => openVault(p.dataDir, 'tooshort'), /at least 24/);
  fs.writeFileSync(path.join(p.dataDir, 'users.enc'), '[]');
  assert.equal((await p.req('/api/state', { cookie })).status, 500, 'a replaced user file lets nobody in');
});

test('plain HTTP is never opened to the network', async () => {
  const p = await panel({ host: '0.0.0.0', allowRemote: true }, [{ name: 'boss', rank: 'owner', password: GOOD }]);
  assert.equal(p.plugin.web, undefined);
});

const openssl = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe'].find((bin) => {
  try { execFileSync(bin, ['version'], { stdio: 'ignore' }); return true; } catch { return false; }
});
test('with a certificate the panel speaks HTTPS and uses a __Host- cookie', { skip: !openssl && 'openssl not found' }, async () => {
  const p = await panel({ prepare: (dataDir) => {
    fs.mkdirSync(path.join(dataDir, 'tls'), { recursive: true });
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-keyout', path.join(dataDir, 'tls', 'key.pem'), '-out', path.join(dataDir, 'tls', 'cert.pem')], { stdio: 'ignore' });
  } }, [{ name: 'boss', rank: 'owner', password: GOOD }]);
  const res = await new Promise((resolve, reject) => {
    const r = https.request({ host: '127.0.0.1', port: p.port, path: '/api/login', method: 'POST', rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', 'X-SA': '1' } }, (response) => { response.resume(); resolve(response); });
    r.on('error', reject);
    r.end(JSON.stringify({ name: 'boss', password: GOOD }));
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['set-cookie'][0], /^__Host-sa_session=.*; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure$/);
  assert.match(res.headers['strict-transport-security'], /max-age/);
  await assert.rejects(p.raw('/'));
});

test('password rules', () => {
  assert.equal(passwordProblem(GOOD, 'boss'), null);
  for (const bad of ['', 'admin', 'Password!!2026', 'qwerty-qwerty'.slice(0, 9), 'boss-is-here-123']) assert.ok(passwordProblem(bad, 'boss'), bad);
});
