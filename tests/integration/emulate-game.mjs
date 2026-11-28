// An emulated Squad server: real SquadJS and the real panel talk to a fake RCON server and read a fake
// game log. Line formats follow SquadJS's own parsers. It proves the chain SquadJS -> panel -> RCON
// command; it cannot prove how the real game reacts or words its replies.
//
//   SQUADJS_DIR=<SquadJS folder> node tests/integration/emulate-game.mjs
//
// The plugin is copied into that folder for the run and removed afterwards. SquadJS's ping is switched off.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SQUADJS = process.env.SQUADJS_DIR;
if (!SQUADJS) throw new Error('Set SQUADJS_DIR to a SquadJS folder.');
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/squadjs');
const RCON_PORT = 21999;
const PANEL = 'http://127.0.0.1:8180';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- the fake game ----------
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-game-'));
const logFile = path.join(logDir, 'SquadGame.log');
fs.writeFileSync(logFile, '');
let chain = 10;
const stamp = () => new Date().toISOString().replace(/-/g, '.').replace('T', '-').replace(/:/g, '.').replace(/\.(\d{3})Z$/, ':$1');
const logLine = (text, id = ++chain) => fs.appendFileSync(logFile, `[${stamp()}][${String(id).padStart(3)}]${text}\n`);

const players = [];
const makePlayer = (n, team, squad, leader = false, name = `Bot ${n}`) => ({
  n, name, team, squad, leader, role: `${team === 1 ? 'USA' : 'RGF'}_${leader ? 'SL' : 'Rifleman'}_01`,
  eos: n.toString(16).padStart(32, 'a'), steam: `7656119900000${String(n).padStart(4, '0')}`,
  pc: `BP_PlayerController_C_${1000 + n}`
});
for (let n = 1; n <= 12; n++) {
  const team = n <= 6 ? 1 : 2;
  players.push(makePlayer(n, team, n === 6 || n === 12 ? null : 1, n === 1 || n === 7));
}
const ids = (p) => `EOS: ${p.eos} steam: ${p.steam}`;
const commands = [];
const clients = new Set();

const packet = (type, id, count, body) => {
  const text = Buffer.from(body, 'utf8');
  const out = Buffer.alloc(text.length + 14);
  out.writeUInt32LE(text.length + 10, 0);
  out.writeUInt8(id, 4);
  out.writeUInt16LE(count, 6);
  out.writeUInt32LE(type, 8);
  text.copy(out, 12);
  return out;
};
const push = (text) => { for (const socket of clients) socket.write(packet(1, 0, 0, text)); };
const chat = (channel, p, message) => push(`[${channel}] [Online IDs:${ids(p)}] ${p.name} : ${message}`);

function connectLines(p) {
  const id = ++chain;
  logLine(`LogSquad: PostLogin: NewPlayer: /Game/BP_PlayerController_C /Game/Maps/Test.Test:PersistentLevel.${p.pc} (IP: 127.0.0.1 | Online IDs: ${ids(p)})`, id);
  logLine(`LogNet: Join succeeded: ${p.name}`, id);
}
function leave(p) {
  players.splice(players.indexOf(p), 1);
  logLine(`LogNet: UChannel::Close: Sending CloseBunch. ChIndex == 0. [UNetConnection] RemoteAddr: 127.0.0.1:7777, Name: x, IsServer: YES, PC: ${p.pc}, Owner: ${p.pc}, UniqueId: RedpointEOS:${p.eos}`);
}
const combat = (kind, attacker, victim, weapon = 'BP_AK74M') =>
  logLine(`LogSquadTrace: [DedicatedServer]${kind}(): Player:${victim.name} KillingDamage=100.000000 from ${attacker.pc} (Online IDs: ${ids(attacker)}| ${kind === 'Die' ? 'Contoller' : 'Controller'} ID: ${attacker.pc}) caused by ${weapon}_C`);
const revive = (reviver, victim) =>
  logLine(`LogSquad: ${reviver.name} (Online IDs: ${ids(reviver)}) has revived ${victim.name} (Online IDs: ${ids(victim)}).`);

function answer(command) {
  const [verb] = command.split(' ');
  const quoted = /^\S+ "([^"]+)"\s*(.*)$/.exec(command);
  const target = quoted && players.find((p) => p.eos === quoted[1] || p.steam === quoted[1]);
  if (verb === 'ListPlayers') {
    return ['----- Active Players -----', ...players.map((p) => `ID: ${p.n} | Online IDs: ${ids(p)} | Name: ${p.name} | Team ID: ${p.team} | Squad ID: ${p.squad ?? 'N/A'} | Is Leader: ${p.leader ? 'True' : 'False'} | Role: ${p.role}`)].join('\n');
  }
  if (verb === 'ListSquads') {
    const out = ['----- Active Squads -----'];
    for (const team of [1, 2]) {
      out.push(`Team ID: ${team} (${team === 1 ? '1st Infantry Division' : '49th Combined Arms Army'}) - Tickets: 100`);
      const members = players.filter((p) => p.team === team && p.squad === 1);
      if (members.length) out.push(`ID: 1 | Name: Alpha | Size: ${members.length} | Locked: False | Creator Name: ${members[0].name} | Creator Online IDs: ${ids(members[0])}`);
    }
    return out.join('\n');
  }
  if (verb === 'ShowCurrentMap') return 'Current level is Narva, layer is Narva_AAS_v1, factions USA RGF';
  if (verb === 'ShowNextMap') return 'Next level is , layer is ';
  if (verb === 'ShowServerInfo') {
    return JSON.stringify({ ServerName_s: 'Emulated game', MaxPlayers: 100, PlayerCount_I: String(players.length), PublicQueue_I: '0', ReservedQueue_I: '0', PlayerReserveCount_I: '0', PublicQueueLimit_I: '25', MapName_s: 'Narva_AAS_v1', PLAYTIME_I: '60', MatchTimeout_d: 120, GameVersion_s: 'emulated', TeamOne_s: 'USA', TeamTwo_s: 'RGF', NextLayer_s: '' });
  }
  commands.push(command);
  if (verb === 'AdminRemovePlayerFromSquadById') {
    const p = players.find((x) => x.n === Number(command.split(' ')[1]));
    if (!p) return 'Player Id is incorrect';
    p.squad = null;
    p.leader = false;
    return 'Player removed';
  }
  if (['AdminWarn', 'AdminKick', 'AdminBan', 'AdminForceTeamChange'].includes(verb)) {
    if (!target) return `ERROR: Unable to find player with name or id (${quoted?.[1]})`;
    if (verb === 'AdminForceTeamChange') {
      Object.assign(target, { team: 3 - target.team, squad: null, leader: false });
      return 'Forced team change';
    }
    if (verb === 'AdminWarn') {
      push(`Remote admin has warned player ${target.name}. Message was "${quoted[2]}"`);
      return 'Remote admin has warned player';
    }
    leave(target);
    push(verb === 'AdminKick' ? `Kicked player ${target.n}. [Online IDs= ${ids(target)}] ${target.name}`
      : `Banned player ${target.n}. [Online IDs= ${ids(target)}] ${target.name} for interval ${quoted[2].split(' ')[0]}`);
    return verb === 'AdminKick' ? 'Kicked player' : 'Banned player';
  }
  return 'Done';
}

const rcon = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  clients.add(socket);
  socket.on('error', () => {});
  socket.on('close', () => clients.delete(socket));
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
      const size = buffer.readUInt32LE(0) + 4;
      const [id, count, type] = [buffer.readUInt8(4), buffer.readUInt16LE(6), buffer.readUInt32LE(8)];
      const body = buffer.toString('utf8', 12, size - 2);
      buffer = buffer.slice(size);
      if (type === 3) socket.write(Buffer.concat([packet(0, 2, count, ''), packet(2, 2, count, '')]));
      else if (id === 2) socket.write(packet(0, 2, count, ''));
      else socket.write(packet(0, 1, count, answer(body)));
    }
  });
});

// ---------- install into SquadJS and start it ----------
const plugins = path.join(SQUADJS, 'squad-server', 'plugins');
const added = [path.join(plugins, 'admin-panel.js'), path.join(plugins, 'admin-panel'), path.join(SQUADJS, 'sa-emu-run.mjs'), path.join(SQUADJS, 'sa-emu-data')];
for (const p of added) if (fs.existsSync(p)) throw new Error(`Already there, not touching it: ${p}`);

let squadjs;
let squadjsLog = '';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  [${detail}]`}`);
};

try {
  await new Promise((resolve) => rcon.listen(RCON_PORT, '127.0.0.1', resolve));
  fs.copyFileSync(path.join(SRC, 'admin-panel.js'), added[0]);
  fs.cpSync(path.join(SRC, 'admin-panel'), added[1], { recursive: true });
  fs.mkdirSync(added[3]);
  const { hashPassword, saveUsers } = await import(pathToFileURL(path.join(SRC, 'admin-panel', 'auth.js')));
  const { openVault } = await import(pathToFileURL(path.join(SRC, 'admin-panel', 'vault.js')));
  const password = crypto.randomBytes(18).toString('hex');
  saveUsers(openVault(added[3]), [{ name: 'emu', rank: 'owner', hash: await hashPassword(password) }]);

  const logger = JSON.parse(fs.readFileSync(path.join(SQUADJS, 'config.json'), 'utf8')).logger;
  const config = { logger, connectors: {},
    server: { id: 99, host: '127.0.0.1', queryPort: 1, rconPort: RCON_PORT, rconPassword: 'emulated', logReaderMode: 'tail', logDir, adminLists: [] },
    plugins: [{ plugin: 'AdminPanel', enabled: true, port: 8180, dataDir: './sa-emu-data', configFile: './sa-emu-data/none.json' }] };
  fs.writeFileSync(added[2], `import Factory from 'squad-server/factory';
const server = await Factory.buildFromConfig(${JSON.stringify(config)});
server.pingSquadJSAPI = async () => {}; // an emulated server must not be reported anywhere
await server.watch();
await Promise.all(server.plugins.map((plugin) => plugin.mount()));
`);
  squadjs = spawn(process.execPath, [added[2]], { cwd: SQUADJS });
  squadjs.stdout.on('data', (d) => { squadjsLog += d; });
  squadjs.stderr.on('data', (d) => { squadjsLog += d; });
  for (let i = 0; i < 90 && !squadjsLog.includes('Admin panel on'); i++) await sleep(1000);
  if (!squadjsLog.includes('Admin panel on')) throw new Error('SquadJS did not start.');
  await sleep(3000);

  // ---------- drive the panel ----------
  const headers = { 'Content-Type': 'application/json', 'X-SA': '1' };
  const login = await fetch(`${PANEL}/api/login`, { method: 'POST', headers, body: JSON.stringify({ name: 'emu', password }) });
  headers.Cookie = login.headers.get('set-cookie').split(';')[0];
  const get = async (url) => (await fetch(PANEL + url, { headers })).json();
  const post = async (url, body) => {
    const res = await fetch(PANEL + url, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: res.status, ...(await res.json()) };
  };
  const act = (name, body) => post(`/api/action/${name}`, body);
  const state = () => get('/api/state');
  const row = async (p) => (await state()).players.find((x) => x.id === p.eos);
  const logOf = (kind) => get(`/api/logs?kind=${kind}`);
  const until = async (fn, seconds = 25) => {
    for (let i = 0; i < seconds * 2; i++) {
      if (await fn()) return true;
      await sleep(500);
    }
    return false;
  };
  // an open event stream, so the panel refreshes the player list every 5 seconds
  const stream = new AbortController();
  fetch(`${PANEL}/api/events`, { headers, signal: stream.signal }).then(async (res) => { for await (const _ of res.body) { /* drain */ } }).catch(() => {});

  const bot = (n) => players.find((p) => p.n === n);
  const [a, b, c, d, e, loose, enemy, medic] = [1, 2, 3, 4, 5, 6, 7, 8].map(bot);

  const first = await state();
  check('player list: 12 players, squads, leader, role', first.players.length === 12 && first.squads.length === 2 && first.players.find((p) => p.id === a.eos)?.leader === true && first.players.find((p) => p.id === loose.eos)?.squad === null, JSON.stringify([first.players.length, first.squads.length]));

  chat('ChatTeam', c, 'need logi');
  check('chat arrives with its channel', await until(async () => (await logOf('chat')).some((m) => m.message === 'need logi' && m.channel === 'Team' && m.player === c.name)));

  combat('Wound', a, enemy);
  combat('Die', a, enemy);
  revive(medic, enemy);
  check('kill, death and revive are counted', await until(async () => (await row(a))?.kills === 1 && (await row(enemy))?.deaths === 1 && (await row(medic))?.revives === 1), JSON.stringify([await row(a), await row(medic)]));

  logLine('LogSquad: USQGameState: Server Tick Rate: 39.50');
  const tickRate = async () => (await state()).server.tickRate;
  check('down and server tick rate are read by SquadJS', await until(async () => (await row(a))?.downs === 1 && (await tickRate()) === 39.5), JSON.stringify(await row(a)));

  combat('Wound', b, c, 'BP_Grad');
  check('teamkill is counted and logged', await until(async () => (await row(b))?.teamkills === 1 && (await logOf('tk')).some((t) => t.attacker === b.name && t.victim === c.name)));

  const newcomer = makePlayer(20, 2, null, false, 'Bot Newcomer');
  players.push(newcomer);
  connectLines(newcomer);
  check('join is logged', await until(async () => (await logOf('conn')).some((x) => x.event === 'Joined' && x.id === newcomer.eos)));
  leave(newcomer);
  check('leave is logged', await until(async () => (await logOf('conn')).some((x) => x.event === 'Left' && x.id === newcomer.eos)), JSON.stringify((await logOf('conn')).slice(-2)));

  const sent = (text) => commands.some((x) => x.startsWith(text));

  // the built-in Smart Shuffle, loaded by the panel inside real SquadJS
  const tab = await get('/api/shuffle');
  check('built-in Smart Shuffle runs inside real SquadJS', tab.status === 'on' && tab.groups.length >= 8 && tab.presets.length === 11, JSON.stringify([tab.status, tab.error]));
  const applied = await post('/api/shuffle', { op: 'settings', changes: { minPlayers: 1, maxPartySize: 6 } });
  check('Smart Shuffle settings apply without a restart', applied.status === 'on' && (await state()).shuffle !== null, JSON.stringify(applied.error));
  push(`[ChatAdmin] [Online IDs:${ids(a)}] ${a.name} : !smartshuffle status`);
  check('its admin chat command answers in the game', await until(async () => commands.some((x) => x.startsWith(`AdminWarn "${a.eos}" Smart Shuffle`))), JSON.stringify(commands.slice(-3)));
  let r = await act('warn', { ids: [c.eos], message: 'follow your SL' });
  check('warn reaches the game', r.status === 200 && sent(`AdminWarn "${c.eos}" follow your SL`), JSON.stringify(r));
  r = await act('messageGroup', { group: 'team2', message: 'push' });
  check('team message warns that team only', r.status === 200 && commands.filter((x) => x.endsWith(' push')).length === players.filter((p) => p.team === 2).length, JSON.stringify(r));
  r = await act('moveTeam', { ids: [d.eos] });
  check('move team changes the team on the panel', r.status === 200 && await until(async () => (await row(d))?.team === 2), JSON.stringify(r));
  r = await act('removeFromSquad', { ids: [e.eos] });
  check('remove from squad shows on the panel', r.status === 200 && sent(`AdminRemovePlayerFromSquadById ${e.n}`) && await until(async () => (await row(e))?.squad === null), JSON.stringify(r));
  const victim = bot(9);
  r = await act('kick', { ids: [victim.eos], reason: 'toxic chat' });
  check('kick removes the player', r.status === 200 && await until(async () => !(await row(victim))), JSON.stringify(r));
  for (const [n, length] of [[10, '1h'], [11, '0']]) {
    const p = bot(n);
    r = await act('ban', { ids: [p.eos], length, reason: 'cheating', note: 'clip' });
    check(`ban ${length} sends the right command and counts it`, r.status === 200 && sent(`AdminBan "${p.eos}" ${length} cheating`) && (await get(`/api/player?id=${p.eos}`)).bans === 1, JSON.stringify(r));
  }

  // ---------- automatic rules ----------
  const warned = (p, text = '') => commands.some((x) => x.startsWith(`AdminWarn "${p.eos}" ${text}`));
  const kicked = (p) => sent(`AdminKick "${p.eos}"`);
  await post('/api/rules', { teamkill: { enabled: true, warnAt: 1, kickAt: 2 } });
  combat('Wound', medic, enemy, 'BP_Frag');
  check('rule teamkill: first one warns', await until(async () => warned(medic, 'No teamkilling')) && !kicked(medic));
  combat('Wound', medic, bot(12), 'BP_Frag');
  check('rule teamkill: second one kicks', await until(async () => kicked(medic)));
  await post('/api/rules', { teamkill: { enabled: false }, chatFilter: { enabled: true, words: ['badword'], kickAt: 2, banAt: 0 } });
  chat('ChatAll', c, 'you badword');
  check('rule chat filter: first hit warns', await until(async () => warned(c, 'Keep the chat clean')) && !kicked(c));
  chat('ChatAll', c, 'badword again');
  check('rule chat filter: second hit kicks', await until(async () => kicked(c)));
  const rude = makePlayer(30, 1, 1, false, 'xX_badname_Xx');
  players.push(rude);
  await post('/api/rules', { chatFilter: { enabled: false }, nameFilter: { enabled: true, patterns: ['badname'], kickAfterMinutes: 0.1 } });
  check('rule name filter: warns', await until(async () => warned(rude, 'Your name'), 40));
  check('rule name filter: kicks if the name stays', await until(async () => kicked(rude), 40));
  await post('/api/rules', { nameFilter: { enabled: false }, squadless: { enabled: true, warnAfterMinutes: 0.05, kickAfterMinutes: 0.25, minPlayers: 1 } });
  check('rule squadless: warns', await until(async () => warned(loose, 'Join a squad'), 40));
  check('rule squadless: kicks later, squad members are left alone', await until(async () => kicked(loose), 60) && !kicked(a));
  await post('/api/rules', { squadless: { enabled: false } });

  // ---------- 1.1.0 ----------
  const left = await get('/api/recent');
  check('players who left are listed with their IDs', left.some((x) => x.id === victim.eos && x.kicks === 1), JSON.stringify(left));
  r = await act('disbandSquad', { team: 1, squad: 1 });
  check('disband squad sends the team and squad number', r.status === 200 && commands.includes('AdminDisbandSquad 1 1'), JSON.stringify(r));
  r = await act('maxPlayers', { value: 90 });
  const q = await act('queueLimit', { value: -1 });
  check('player and queue limits reach the game', r.status === 200 && q.status === 200 && commands.includes('AdminSetMaxNumPlayers 90') && commands.includes('AdminSetPublicQueueLimit -1'), JSON.stringify([r, q]));
  const page = await get('/api/server');
  check('the real SquadJS logger is readable, so the password is allowed', page.password?.blocked === null, JSON.stringify(page.password));
  const secret = `Emu-${crypto.randomBytes(6).toString('hex')}`;
  r = await post('/api/server', { op: 'password', password: secret, confirmPassword: password });
  await sleep(1500);
  check('server password reaches the game and not the SquadJS console', r.status === 200 && commands.includes(`AdminSetServerPassword ${secret}`) && !squadjsLog.includes(secret), JSON.stringify([r.status, r.error]));
  check('nor the panel logs', !JSON.stringify(await logOf('admin')).includes(secret));

  const audit = await logOf('admin');
  check('audit log has the admin and the rule actions', audit.some((x) => x.by === 'emu' && x.action === 'Kick') && audit.some((x) => x.by === 'Auto: Teamkill limit' && x.action === 'Kick') && !audit.some((x) => x.action === 'Failed'), JSON.stringify(audit.filter((x) => x.action === 'Failed')));
  stream.abort();
} catch (err) {
  check('run', false, err.message);
  console.log(squadjsLog.split('\n').filter((l) => !/Loading (plugin|parser) file/.test(l)).slice(-25).join('\n'));
} finally {
  squadjs?.kill();
  await sleep(1000);
  for (const p of added) fs.rmSync(p, { recursive: true, force: true });
  fs.rmSync(logDir, { recursive: true, force: true });
  for (const socket of clients) socket.destroy();
  rcon.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed. Added files removed: ${added.every((p) => !fs.existsSync(p))}`);
process.exit(results.every(Boolean) ? 0 : 1);
