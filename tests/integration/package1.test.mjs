// 1.1.0: the new buttons, players who left, announcements, Discord notices, server settings and the
// languages. No real Discord request is made: the panel's fetch is replaced.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { eos, fakeServer } from '../mock_data/fake-server.mjs';
import { install } from './install.mjs';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/squadjs/admin-panel/ui');
const PW = 'Mavi-Kedi-42-Pencere';
const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_SECRET-TAIL';
const running = [];
let nextPort = 21500 + Math.floor(Math.random() * 300);
after(async () => {
  for (const p of running) await p.unmount();
});

async function panel() {
  const installed = await install();
  const dataDir = path.join(installed.root, 'admin-panel-data');
  await installed.addUsers(dataDir, [['root', 'owner'], ['ada', 'admin'], ['sam', 'senior'], ['jim', 'junior']].map(([name, rank]) => ({ name, rank, password: PW })));
  const server = fakeServer({ perTeam: 6 });
  const port = nextPort++;
  const plugin = new installed.AdminPanel(server, { port, dataDir, configFile: path.join(installed.root, 'config.json') });
  await plugin.mount();
  running.push(plugin);
  const base = `http://127.0.0.1:${port}`;
  const session = async (name) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SA': '1' }, body: JSON.stringify({ name, password: PW }) });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const read = async (r) => ({ status: r.status, text: await r.clone().text(), data: await r.json() });
    return {
      get: async (url) => read(await fetch(base + url, { headers: { Cookie: cookie } })),
      post: async (url, body) => read(await fetch(base + url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-SA': '1', Cookie: cookie } }))
    };
  };
  return { plugin, server, dataDir, session };
}

// everything the panel wrote to disk, read back in the clear
const everyLog = (plugin) => plugin.store.logFiles().flatMap((f) => plugin.store.readFile(f).entries.map((x) => JSON.stringify(x.entry))).join('\n');

// a Notifier whose requests are recorded; timers run only when the test says so
function fakeDiscord(notifier, reply = () => ({ ok: true, status: 204 })) {
  const sent = [];
  const timers = [];
  notifier.fetchFn = async (url, options) => {
    sent.push({ url, options, body: JSON.parse(options.body) });
    return reply(sent.length);
  };
  notifier.wait = (fn, ms) => { timers.push({ fn, ms }); return null; };
  const settle = () => new Promise((r) => setImmediate(r));
  const next = async () => { const timer = timers.shift(); timer?.fn(); await settle(); return timer?.ms; };
  return { sent, timers, next, settle };
}

test('commander and squad buttons: permission, only real targets', async () => {
  const { server, session } = await panel();
  const [sam, jim] = [await session('sam'), await session('jim')];
  const commander = server.players.find((p) => p.teamID === 1 && p.isLeader && p.squadID === 1);
  server.squads.find((s) => s.teamID === 1 && s.squadID === 1).squadName = 'Command Squad';
  const other = server.players.find((p) => p.teamID === 1 && p.isLeader && p.squadID === 2);
  assert.equal((await jim.post('/api/action/demoteCommander', { id: commander.eosID })).status, 403);
  assert.equal((await jim.post('/api/action/disbandSquad', { team: 1, squad: 2 })).status, 403);
  assert.equal((await sam.post('/api/action/demoteCommander', { id: other.eosID })).status, 409);
  assert.equal((await sam.post('/api/action/disbandSquad', { team: 1, squad: '2' })).status, 404);
  assert.equal((await sam.post('/api/action/disbandSquad', { team: 1, squad: 99 })).status, 404);
  assert.deepEqual(server.sent, []);
  assert.equal((await sam.post('/api/action/demoteCommander', { id: commander.eosID })).status, 200);
  assert.equal((await sam.post('/api/action/disbandSquad', { team: 1, squad: 2 })).status, 200);
  assert.deepEqual(server.sent, [`AdminDemoteCommanderById ${commander.playerID}`, 'AdminDisbandSquad 1 2']);
});

test('players who left: only those still gone, counts only for who may see them', async () => {
  const { plugin, server, session } = await panel();
  const [gone, back] = server.players;
  plugin.store.record(gone.eosID, 'kick', { by: 'ada', reason: 'x', name: gone.name });
  plugin.tracker.stat(gone.eosID).teamkills = 2;
  for (const p of [gone, back]) server.emit('PLAYER_DISCONNECTED', { player: { name: p.name }, raw: `UniqueNetId: RedpointEOS:${p.eosID}` });
  server.players = server.players.filter((p) => p !== gone);
  const list = (await (await session('root')).get('/api/recent')).data;
  assert.deepEqual(list.map((r) => [r.id, r.teamkills, r.kicks]), [[gone.eosID, 2, 1]]);
  const blind = (await (await session('jim')).get('/api/recent')).data;
  assert.equal(blind.length, 1);
  const time = Date.now();
  plugin.tracker.now = () => time + 31 * 60000;
  assert.deepEqual(plugin.tracker.recentlyLeft(), []);
});

test('announcements: checked, gapped, skipped when the server is too empty', async () => {
  const { plugin, server, session } = await panel();
  const [root, sam] = [await session('root'), await session('sam')];
  const item = { text: 'Rules are on Discord', when: 'every', minutes: 5, minPlayers: 1, enabled: true };
  assert.equal((await sam.post('/api/server', { op: 'schedule', items: [item] })).status, 403);
  assert.equal((await sam.get('/api/server')).status, 403);
  for (const bad of [{ minutes: 4 }, { text: '  ' }, { when: 'sometimes' }, { minPlayers: 0 }]) {
    assert.equal((await root.post('/api/server', { op: 'schedule', items: [{ ...item, ...bad }] })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await root.post('/api/server', { op: 'schedule', items: Array(21).fill(item) })).status, 400);
  const schedule = plugin.schedule;
  let time = Date.now();
  schedule.now = () => time;
  const saved = await root.post('/api/server', { op: 'schedule', items: [item, { ...item, text: 'Second\nAdminKick "x" y' }, { ...item, text: 'Welcome', when: 'matchStart', minutes: 2 }] });
  assert.equal(saved.status, 200);
  const said = () => server.sent.filter((c) => c.startsWith('AdminBroadcast'));
  await schedule.tick();
  assert.deepEqual(said(), [], 'nothing at once');
  time += 5 * 60000;
  await schedule.tick();
  await schedule.tick();
  assert.deepEqual(said(), ['AdminBroadcast Rules are on Discord'], 'one per minute');
  time += 61000;
  await schedule.tick();
  assert.equal(said().at(-1), "AdminBroadcast Second AdminKick 'x' y", 'one line, one command');
  server.emit('NEW_GAME', {});
  time += 2 * 60000;
  await schedule.tick();
  assert.equal(said().at(-1), 'AdminBroadcast Welcome');
  time += 61000;
  await schedule.tick();
  assert.equal(said().length, 3, 'a match start message is sent once');
  // too few players: the turn is lost, not sent later in a burst
  server.sent.length = 0;
  schedule.items.forEach((i) => { i.minPlayers = 50; });
  time += 6 * 60000;
  await schedule.tick();
  schedule.items.forEach((i) => { i.minPlayers = 1; });
  time += 61000;
  await schedule.tick();
  assert.deepEqual(said(), []);
});

test('the webhook: only Discord, only the owner, never shown or written', async () => {
  const { plugin, session } = await panel();
  const [root, ada] = [await session('root'), await session('ada')];
  const discord = fakeDiscord(plugin.notifier);
  const save = (who, change, confirmPassword = PW) => who.post('/api/server', { op: 'notify', change, confirmPassword });
  assert.equal((await save(ada, { url: HOOK, enabled: true })).status, 403);
  assert.equal((await ada.post('/api/server', { op: 'notifyTest' })).status, 403);
  assert.equal((await save(root, { url: HOOK }, 'wrong-password-1')).status, 403);
  for (const url of ['http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwx', 'https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwx',
    'https://discord.com.evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwx', `${HOOK}/../../x`, 'https://127.0.0.1/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwx']) {
    assert.equal((await save(root, { url })).status, 400, url);
  }
  assert.equal((await save(root, { enabled: true })).status, 400, 'no address yet');
  const saved = await save(root, { url: HOOK, enabled: true });
  assert.equal(saved.status, 200);
  const page = await root.get('/api/server');
  for (const text of [saved.text, page.text, everyLog(plugin)]) assert.doesNotMatch(text, /abcdefghij|123456789012345678/);
  assert.equal(page.data.notify.tail, 'TAIL');
  assert.doesNotMatch(fs.readFileSync(path.join(plugin.store.dataDir, 'notify.enc'), 'utf8'), /webhooks/);
  assert.equal((await root.post('/api/server', { op: 'notifyTest' })).status, 200);
  assert.equal(discord.sent[0].url, HOOK);
  assert.equal(discord.sent[0].options.redirect, 'error');
});

test('notices: nothing can ping, admin notes stay home, chat only for !admin', async () => {
  const { plugin, server, session } = await panel();
  const root = await session('root');
  const discord = fakeDiscord(plugin.notifier);
  plugin.notifier.save({ url: HOOK, enabled: true });
  const [bad, caller] = server.players;
  bad.name = '@everyone **[x](https://evil.example)** <@&999999>';
  await root.post('/api/action/ban', { ids: [bad.eosID], length: '1d', reason: '@here cheating', note: 'PRIVATE-EVIDENCE' });
  await discord.settle();
  assert.equal(discord.sent.length, 1);
  assert.deepEqual(discord.sent[0].body.allowed_mentions, { parse: [] });
  assert.doesNotMatch(discord.sent[0].body.content, /PRIVATE-EVIDENCE|https:\/\/evil/);
  assert.match(discord.sent[0].body.content, /Ban 1d/);
  assert.equal(plugin.store.logs.admin.at(-1).note, 'PRIVATE-EVIDENCE', 'admins still see it in the panel');
  await discord.next();
  server.emit('CHAT_MESSAGE', { chat: 'ChatAll', player: caller, eosID: caller.eosID, message: 'just talking' });
  plugin.store.log('admin', { by: 'root', action: 'Login', target: '10.0.0.9' });
  await discord.settle();
  assert.equal(discord.sent.length, 1);
  plugin.notifier.save({ roleId: '555555555555' });
  server.emit('CHAT_MESSAGE', { chat: 'ChatAll', player: caller, eosID: caller.eosID, message: '!admin @everyone help' });
  server.emit('CHAT_MESSAGE', { chat: 'ChatAll', player: caller, eosID: caller.eosID, message: '!admin again' });
  await discord.settle();
  assert.equal(discord.sent.length, 2, 'one call a minute per player');
  assert.deepEqual(discord.sent[1].body.allowed_mentions, { parse: [], roles: ['555555555555'] });
});

test('Discord trouble never piles up: waits on 429, stops on a dead webhook, queue is capped', async () => {
  const { plugin } = await panel();
  const notifier = plugin.notifier;
  let status = 429;
  const discord = fakeDiscord(notifier, () => ({ ok: status === 204, status, json: async () => ({ retry_after: 7 }) }));
  notifier.save({ url: HOOK, enabled: true });
  const kick = () => plugin.store.log('admin', { by: 'a', action: 'Kick', target: 'b', reason: 'c' });
  kick();
  await discord.settle();
  assert.equal(notifier.queue.length, 1, 'kept for later');
  for (let i = 0; i < 150; i++) kick();
  assert.equal(notifier.queue.length, 100);
  assert.ok(notifier.dropped >= 50);
  status = 204;
  assert.equal(await discord.next(), 7000);
  assert.equal(discord.sent.length, 2);
  status = 404;
  await discord.next();
  assert.equal(notifier.queue.length, 0);
  assert.match(notifier.describe().problem, /refused/);
  const before = discord.sent.length;
  kick();
  await discord.settle();
  assert.equal(discord.sent.length, before, 'silent until a new address is saved');
  notifier.fetchFn = async () => { throw new Error(`connect failed ${HOOK}`); };
  notifier.save({ url: HOOK });
  await assert.rejects(notifier.test(), (err) => !err.message.includes('webhooks'));
});

test('server limits and password: ranks, ranges, and the password is never written', async () => {
  const { plugin, server, session } = await panel();
  const [root, ada] = [await session('root'), await session('ada')];
  assert.equal((await ada.post('/api/action/maxPlayers', { value: 80 })).status, 403, 'admins need the tick');
  for (const value of [0, 101, '80', 1.5]) assert.equal((await root.post('/api/action/maxPlayers', { value })).status, 400);
  assert.equal((await root.post('/api/action/queueLimit', { value: -2 })).status, 400);
  assert.equal((await root.post('/api/action/maxPlayers', { value: 80 })).status, 200);
  assert.equal((await root.post('/api/action/queueLimit', { value: -1 })).status, 200);
  assert.deepEqual(server.sent, ['AdminSetMaxNumPlayers 80', 'AdminSetPublicQueueLimit -1']);

  const secret = 'Kapali-Oda.2026';
  const set = (who, password, confirmPassword = PW) => who.post('/api/server', { op: 'password', password, confirmPassword });
  const wrote = [];
  server.rcon.write = async (type, body) => { wrote.push([type, body]); return ''; };
  // the test install has no SquadJS logger, so the panel cannot tell what would be logged
  assert.equal((await set(root, secret)).status, 409);
  plugin.rconVerbosity = async () => 2;
  assert.equal((await set(root, secret)).status, 409);
  plugin.rconVerbosity = async () => 1;
  assert.equal((await set(ada, secret)).status, 403);
  assert.equal((await set(root, secret, 'wrong-password-1')).status, 403);
  for (const bad of ['two words', 'quo"te', 'x'.repeat(33), 'line\nbreak', 7]) assert.equal((await set(root, bad)).status, 400, String(bad));
  assert.deepEqual(wrote, []);
  const done = await set(root, secret);
  assert.equal(done.status, 200);
  assert.deepEqual(wrote, [[2, `AdminSetServerPassword ${secret}`]]);
  assert.equal((await set(root, '')).status, 200);
  assert.equal(wrote.at(-1)[1], 'AdminSetServerPassword ""');
  server.rcon.write = async () => { throw new Error(`failed: AdminSetServerPassword ${secret}`); };
  const failed = await set(root, secret);
  assert.equal(failed.status, 502);
  server.rcon.write = async () => `ERROR: bad ${secret}`;
  const refused = await set(root, secret);
  assert.equal(refused.status, 502);
  for (const text of [done.text, failed.text, refused.text, everyLog(plugin)]) assert.ok(!text.includes(secret));
  assert.ok(server.sent.every((c) => !c.includes(secret)), 'never through the command that logs itself');
});

test('every language has every text, with the same blanks', async () => {
  const load = async (part) => (await import(pathToFileURL(path.join(UI, 'lang', `${part}.js`)))).default;
  const rows = [...await load('common'), ...await load('pages'), ...await load('server')];
  const keys = new Set(rows.map((r) => r[0]));
  assert.equal(keys.size, rows.length, 'no text is listed twice');
  const blanks = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const row of rows) {
    assert.ok(row.length === 5 && row.every(Boolean), row[0]);
    if (!row[0].startsWith('#')) for (const cell of row.slice(1)) assert.equal(blanks(cell), blanks(row[0]), row[0]);
  }
  const files = ['core.js', 'app.js', ...fs.readdirSync(path.join(UI, 'pages')).map((f) => `pages/${f}`)];
  const missing = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(UI, file), 'utf8');
    for (const [, literal] of text.matchAll(/(?<![\w.$])t\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g)) {
      const key = Function(`return ${literal}`)();
      if (!keys.has(key)) missing.push(`${file}: ${key}`);
    }
    for (const [, word] of text.matchAll(/plural\([^;\n]*?, '([a-z ]+)'\)/g)) if (!keys.has(`#${word}`)) missing.push(`${file}: #${word}`);
  }
  // the permission table arrives in English from the server
  const { PERMISSIONS, RANKS } = await import(pathToFileURL(path.join(UI, '..', 'permissions.js')));
  for (const p of Object.values(PERMISSIONS)) for (const key of [p.label, p.group]) if (!keys.has(key)) missing.push(`permission: ${key}`);
  for (const r of Object.values(RANKS)) if (!keys.has(r.name)) missing.push(`rank: ${r.name}`);
  assert.deepEqual(missing, []);
});
