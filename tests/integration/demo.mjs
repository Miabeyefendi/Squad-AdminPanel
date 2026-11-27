// The panel on a fake server, for looking at it in a browser.
// By default it is a real first run: sign in with admin / admin (the panel warns until it is changed).
// With --ranks (or SA_DEMO_RANKS=1) it has one account per rank instead: demo (owner), ada, sam and
// jim, all with the password demo-panel-password. Test values for this local demo only.
// --art=<folder> (or SA_DEMO_ART) shows the pictures of that folder's maps/, screens/ and factions/ subfolders.
// All names and numbers are made up. The data is thrown away when the demo stops.
// Attack strings are not shown here; they are in security.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

import { DEMO_LAYERS } from '../mock_data/demo-layers.mjs';
import { fakeServer } from '../mock_data/fake-server.mjs';
import { install } from './install.mjs';

const { root, AdminPanel, addUsers } = await install({ layers: DEMO_LAYERS });
const dataDir = path.join(root, 'admin-panel-data');
if (process.env.SA_DEMO_RANKS === '1' || process.argv.includes('--ranks')) {
  await addUsers(dataDir, [['demo', 'owner'], ['ada', 'admin'], ['sam', 'senior'], ['jim', 'junior']]
    .map(([name, rank]) => ({ name, rank, password: 'demo-panel-password' })));
}

const art = process.argv.find((a) => a.startsWith('--art='))?.slice(6) || process.env.SA_DEMO_ART;
for (const kind of ['maps', 'screens', 'factions']) {
  const from = art && path.join(art, kind);
  if (from && fs.existsSync(from)) fs.cpSync(from, path.join(dataDir, 'art', kind), { recursive: true });
}

const server = fakeServer({ perTeam: 43 });
server.on('error', () => {});

// make the sample look like a real match
const animals = ['Falcon', 'Badger', 'Viper', 'Raven', 'Wolf', 'Lynx', 'Otter', 'Bison', 'Cobra', 'Heron', 'Moose', 'Shark', 'Hawk', 'Panther', 'Fox', 'Bear', 'Crow', 'Mantis', 'Boar', 'Puma', 'Eagle', 'Marten'];
const endings = ['', ' TR', '_07', ' Actual'];
const KITS = ['Medic', 'Rifleman', 'LAT', 'Rifleman', 'Medic', 'Automatic Rifleman', 'Grenadier', 'HAT', 'Marksman', 'Combat Engineer'];
server.players.forEach((p, i) => {
  p.name = `${animals[i % animals.length]}${endings[Math.floor(i / animals.length) % endings.length]}`;
  const faction = p.teamID === 1 ? 'RGF' : 'USA';
  p.role = `${faction}_${(p.isLeader ? 'SL' : KITS[(i * 7) % KITS.length]).replace(/ /g, '_')}_01`;
});
for (const squad of server.squads) {
  if (squad.squadName === 'Defense') squad.squadName = 'Command Squad';
  squad.teamName = squad.teamID === 1 ? 'RGF Mechanized' : 'US Army Armored';
}

// a plugin list as long as a real server's: SquadJS plugin names with made up option lists
const PLUGINS = {
  AdminPanel: ['Web admin panel', {}],
  AutoKickUnassigned: ['Kicks players who stay unassigned', { warningMessage: ['Join a squad, or you will be kicked.', 'Text'], frequencyOfWarnings: [30000, 'Milliseconds between warnings'], unassignedTimer: [360000, 'Milliseconds before the kick'], playerThreshold: [93, 'Only from this many players'], ignoreAdmins: [false, 'Leave admins alone'] }],
  AutoTKWarn: ['Warns players who teamkill', { attackerMessage: ['Please apologise for the teamkill.', 'Text for the attacker'] }],
  ChatCommands: ['Answers chat commands', { commands: [[{ command: 'squadjs', type: 'warn', response: 'This server is running SquadJS.' }], 'Command list'] }],
  DBLog: ['Writes matches and players to a database', { overrideServerID: ['', 'Server ID'] }],
  DiscordChat: ['Chat to Discord', { channelID: ['', 'Channel'], ignoreChats: [['ChatSquad'], 'Chat types to leave out'] }],
  IntervalledBroadcasts: ['Repeats messages on screen', { broadcasts: [['Welcome to the server, read the rules.', 'Join our Discord.'], 'Messages in turn'], interval: [300000, 'Milliseconds between messages'] }],
  SeedingMode: ['Seeding broadcasts', { interval: [150000, 'Milliseconds between broadcasts'], seedingThreshold: [50, 'Players below this means seeding'], seedingMessage: ['Seeding rules active!', 'Text'], liveEnabled: [true, 'Announce when the match goes live'] }]
};
const spec = (options) => JSON.stringify(Object.fromEntries(Object.entries(options).map(([k, [value, description]]) => [k, { default: value, description }])));
fs.writeFileSync(path.join(root, 'squad-server', 'plugins', 'index.js'), `export default { getPlugins: async () => ({
${Object.entries(PLUGINS).map(([name, [description, options]]) => `  ${name}: class { static description = ${JSON.stringify(description)}; static optionsSpecification = ${spec(options)}; }`).join(',\n')}
}) };\n`);
const on = ['AdminPanel', 'ChatCommands', 'IntervalledBroadcasts', 'SeedingMode'];
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ server: {}, connectors: {},
  plugins: ['SeedingMode', 'IntervalledBroadcasts', 'ChatCommands', 'AutoTKWarn', 'AutoKickUnassigned', 'DiscordChat', 'AdminPanel']
    .map((plugin) => ({ plugin, enabled: on.includes(plugin) })) }, null, 2));

server.matchStartTime = new Date(Date.now() - 24 * 60000);
process.argv[2] = path.join(root, 'config.json');
const panel = new AdminPanel(server, { port: 8171, dataDir, configFile: process.argv[2] });
await panel.mount();

// records from the last weeks, so the Records page and the player cards have something in them
const day = 86400000;
const old = (n, entry, ago) => {
  const p = server.players[n];
  panel.store.record(p.eosID, entry.type, { by: entry.by, reason: entry.reason, detail: entry.detail || '', name: p.name });
  panel.store.players[p.eosID].history.at(-1).at = Date.now() - ago * day;
};
old(2, { type: 'warn', by: 'ada', reason: 'Teamkill with the mortar, apologise in chat.' }, 34);
old(2, { type: 'warn', by: 'sam', reason: 'Solo armor without a crew.' }, 6);
old(47, { type: 'kick', by: 'ada', reason: 'Not following the squad leader' }, 19);
old(47, { type: 'ban', by: 'demo', reason: 'Toxic chat', detail: '1d' }, 12);
old(12, { type: 'warn', by: 'jim', reason: 'Join a squad within 5 minutes.' }, 3);
old(61, { type: 'warn', by: 'sam', reason: 'Keep the chat clean.' }, 3);
old(23, { type: 'kick', by: 'sam', reason: 'Teamkilling' }, 1);
old(70, { type: 'ban', by: 'ada', reason: 'Wasting vehicles on purpose', detail: '7d' }, 1);
old(31, { type: 'warn', by: 'ada', reason: 'Squad leaders have to take the squad leader kit.' }, 0);
panel.store.addNote(server.players[2].eosID, 'ada', 'Friendly after the talk. Watch the mortar.');
panel.store.addNote(server.players[70].eosID, 'demo', 'Second vehicle ban this month.');
panel.store.flush();

const find = (team, n) => server.players.filter((p) => p.teamID === team)[n];
const [a, b, c, d, e] = [find(1, 0), find(1, 6), find(2, 0), find(2, 9), find(2, 4)];
server.players.forEach((p, i) => panel.tracker.since.set(p.eosID, Date.now() - (7 + ((i * 17) % 55)) * 60000));
for (const [chat, player, message] of [
  ['ChatAll', a, 'good luck, have fun'], ['ChatTeam', c, 'need a medic at the east compound'],
  ['ChatSquad', b, 'rally is up behind the church'], ['ChatTeam', e, 'logi coming to the north FOB, 2 minutes'],
  ['ChatAdmin', d, 'someone is wasting the helicopter'], ['ChatAll', b, 'sorry about that grenade'],
  ['ChatTeam', a, 'commander: UAV is up, check the map']
]) server.emit('CHAT_MESSAGE', { chat, player, eosID: player.eosID, message });
server.emit('PLAYER_CONNECTED', { player: d });
// an uneven match: every player gets their own numbers, always the same ones
const side = (team) => server.players.filter((p) => p.teamID === team);
const WEAPONS = ['BP_AK74M_C_1', 'BP_M4A1_C_1', 'BP_PKM_C_1', 'BP_RPG7_C_1', 'BP_M249_C_1'];
server.players.forEach((attacker, i) => {
  const enemies = side(3 - attacker.teamID);
  const kills = ((i * 7 + 3) % 11) + (i % 9 === 0 ? 6 : 0);
  for (let j = 0; j < kills + (i % 4); j++) {
    const victim = enemies[(i * 5 + j * 11) % enemies.length];
    server.emit('PLAYER_DAMAGED', { attacker, victim, teamkill: false, damage: 62 + ((i + j * 13) % 38) });
    server.emit('PLAYER_WOUNDED', { attacker, victim, teamkill: false });
    if (j < kills) server.emit('PLAYER_DIED', { attacker, victim, teamkill: false, weapon: WEAPONS[(i + j) % WEAPONS.length] });
  }
  const revives = /Medic/.test(attacker.role) ? 3 + ((i * 3) % 12) : i % 5 === 0 ? 1 : 0;
  for (let j = 0; j < revives; j++) server.emit('PLAYER_REVIVED', { reviver: attacker, victim: side(attacker.teamID)[(i + j) % 43] });
});
for (const [by, action, target, reason] of [
  ['ada', 'Warn', find(1, 8).name, 'Follow your squad leader.'], ['sam', 'Message', 'Team 2', 'Radios up before the push.'],
  ['ada', 'Next layer', 'Yehorivka_RAAS_v2', ''], ['jim', 'Warn', find(2, 17).name, 'Keep the chat clean.'],
  ['sam', 'Kick', 'Marten Actual', 'Teamkilling']
]) panel.store.log('admin', { by, action, target, reason });
server.emit('TICK_RATE', { tickRate: 38.4 });
// one squad leader without the kit, and someone calling an admin about it
const lazy = find(1, 1);
lazy.role = 'RGF_Rifleman_01';
server.emit('CHAT_MESSAGE', { chat: 'ChatAll', player: find(1, 20), eosID: find(1, 20).eosID, message: `!admin SL${lazy.squadID} doesnt have kit` });
server.admins.add(find(2, 9).eosID);
server.emit('TEAMKILL', { attacker: find(1, 12), victim: find(1, 3), weapon: 'BP_RPG7_C' });
server.emit('TEAMKILL', { attacker: find(1, 12), victim: find(1, 3), weapon: 'BP_Grad_C' });
server.emit('UPDATED_PLAYER_INFORMATION');
console.log('Demo ready. RCON commands are printed here and not sent anywhere.');
let shown = 0;
setInterval(() => { for (; shown < server.sent.length; shown++) console.log(`RCON> ${server.sent[shown]}`); }, 500);
