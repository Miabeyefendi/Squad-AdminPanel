import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { fakeServer } from '../mock_data/fake-server.mjs';
import { install } from './install.mjs';

let base;
let port;
let plugin;
let server;
let root;

before(async () => {
  const installed = await install();
  root = installed.root;
  const dataDir = path.join(root, 'admin-panel-data');
  await installed.addUsers(dataDir, [['owner', 'owner'], ['admin', 'admin'], ['moderator', 'junior']].map(([name, rank]) => ({ name, rank, password: 'a-long-test-password' })));
  server = fakeServer();
  port = 18170 + Math.floor(Math.random() * 1000);
  plugin = new installed.AdminPanel(server, { port, dataDir, configFile: path.join(root, 'config.json') });
  const argv = process.argv[2];
  process.argv[2] = path.join(root, 'config.json');
  await plugin.mount();
  process.argv[2] = argv;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await plugin.unmount();
});

const post = (url, body, cookie, headers = {}) => fetch(base + url, { method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', 'X-SA': '1', ...(cookie ? { Cookie: cookie } : {}), ...headers } });
async function login(name) {
  const res = await post('/api/login', { name, password: 'a-long-test-password' });
  assert.equal(res.status, 200);
  const set = res.headers.get('set-cookie');
  assert.match(set, /HttpOnly; SameSite=Strict/);
  return set.split(';')[0];
}

test('the page loads with a strict script policy, the API needs a session', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self';/);
  for (const file of ['/app.js', '/style.css']) assert.equal((await fetch(base + file)).status, 200);
  for (const url of ['/api/state', '/api/logs?kind=admin', '/api/plugins', '/api/events']) assert.equal((await fetch(base + url)).status, 401);
  assert.equal((await post('/api/action/endMatch', {})).status, 401);
  assert.equal((await fetch(`${base}/../admin-panel.js`)).status, 401);
  assert.deepEqual(server.sent, []);
});

test('unknown host names are refused', async () => {
  const status = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/', headers: { Host: 'evil.example' } }, (res) => resolve(res.statusCode));
  });
  assert.equal(status, 421);
});

test('cross-site posts are blocked', async () => {
  const cookie = await login('owner');
  assert.equal((await post('/api/action/endMatch', {}, cookie, { Origin: 'http://evil.example' })).status, 403);
  assert.equal((await post('/api/action/endMatch', {}, cookie, { 'X-SA': '0' })).status, 403);
  assert.equal((await post('/api/action/endMatch', {}, cookie, { 'Content-Type': 'text/plain' })).status, 403);
  assert.deepEqual(server.sent, []);
});

test('state, layers and an action work end to end', async () => {
  const cookie = await login('admin');
  const state = await (await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).json();
  assert.equal(state.players.length, 40);
  assert.deepEqual(state.server.tickets, [312, 287]);
  assert.deepEqual(state.server.teams, ['RGF Mechanized', 'USA Armored']);
  const layers = await (await fetch(`${base}/api/layers`, { headers: { Cookie: cookie } })).json();
  assert.equal(layers.length, 12);
  const res = await post('/api/action/broadcast', { message: 'hello' }, cookie);
  assert.equal(res.status, 200);
  assert.deepEqual(server.sent, ['AdminBroadcast hello']);
  server.sent.length = 0;
});

test('roles are enforced by the server', async () => {
  const mod = await login('moderator');
  assert.equal((await post('/api/action/ban', { ids: [server.players[0].eosID], length: '1d', reason: 'x' }, mod)).status, 403);
  assert.equal((await post('/api/rules', { teamkill: { enabled: true } }, mod)).status, 403);
  const admin = await login('admin');
  assert.equal((await fetch(`${base}/api/plugins`, { headers: { Cookie: admin } })).status, 403);
  assert.equal((await post('/api/restart', {}, admin)).status, 403);
  const owner = await login('owner');
  assert.equal((await post('/api/restart', {}, owner)).status, 409);
  assert.deepEqual(server.sent, []);
});

test('owner edits plugin settings without seeing server secrets', async () => {
  const owner = await login('owner');
  const text = await (await fetch(`${base}/api/plugins`, { headers: { Cookie: owner } })).text();
  assert.doesNotMatch(text, /RCONSECRET/);
  const res = await post('/api/plugins', { index: 0, name: 'SeedingMode', options: { interval: 60000 }, confirmPassword: 'a-long-test-password' }, owner);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).plugins[0].interval, 60000);
  const on = await post('/api/plugins', { index: 1, name: 'DiscordChat', enabled: true, confirmPassword: 'a-long-test-password' }, owner);
  assert.match((await on.json()).error, /connector/);
});

test('the event stream sends state and new log lines, logout ends the session', async () => {
  const cookie = await login('owner');
  const abort = new AbortController();
  const res = await fetch(`${base}/api/events`, { headers: { Cookie: cookie }, signal: abort.signal });
  const reader = res.body.getReader();
  let seen = '';
  const until = async (text) => {
    while (!seen.includes(text)) seen += new TextDecoder().decode((await reader.read()).value);
  };
  await until('event: state');
  server.emit('CHAT_MESSAGE', { chat: 'ChatAll', player: server.players[0], eosID: server.players[0].eosID, message: 'from game' });
  await until('from game');
  abort.abort();
  assert.equal((await post('/api/logout', {}, cookie)).status, 200);
  assert.equal((await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).status, 401);
});

test('too large or broken bodies are rejected', async () => {
  const cookie = await login('owner');
  const bad = await fetch(`${base}/api/action/broadcast`, { method: 'POST', body: '{oops', headers: { 'Content-Type': 'application/json', 'X-SA': '1', Cookie: cookie } });
  assert.equal(bad.status, 400);
  const big = await post('/api/action/broadcast', { message: 'x'.repeat(300000) }, cookie).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
  assert.deepEqual(server.sent, []);
});
