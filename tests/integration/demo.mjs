// The panel on a fake server, for looking at it in a browser.
// By default it is a real first run: sign in with admin / admin and set your own name and password.
// With --ranks (or SA_DEMO_RANKS=1) it has one account per rank instead: demo (owner), ada, sam and
// jim, all with the password demo-panel-password. Test values for this local demo only.
// --art=<folder> (or SA_DEMO_ART) shows the pictures of that folder's maps/ and factions/ subfolders.
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
if (art) fs.cpSync(art, path.join(dataDir, 'art'), { recursive: true });

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

process.argv[2] = path.join(root, 'config.json');
const panel = new AdminPanel(server, { port: 8171, dataDir, configFile: process.argv[2] });
await panel.mount();

// a record from weeks ago, so the history on a player card has something in it
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
panel.store.addNote(server.players[2].eosID, 'ada', 'Friendly after the talk. Watch the mortar.');
panel.store.flush();

const find = (team, n) => server.players.filter((p) => p.teamID === team)[n];
const [a, b, c, d, e] = [find(1, 0), find(1, 6), find(2, 0), find(2, 9), find(2, 4)];
for (const [chat, player, message] of [
  ['ChatAll', a, 'good luck, have fun'], ['ChatTeam', c, 'need a medic at the east compound'],
  ['ChatSquad', b, 'rally is up behind the church'], ['ChatTeam', e, 'logi coming to the north FOB, 2 minutes'],
  ['ChatAdmin', d, 'someone is wasting the helicopter'], ['ChatAll', b, 'sorry about that grenade'],
  ['ChatTeam', a, 'commander: UAV is up, check the map']
]) server.emit('CHAT_MESSAGE', { chat, player, eosID: player.eosID, message });
server.emit('PLAYER_CONNECTED', { player: d });
for (let i = 0; i < 160; i++) {
  const attacker = server.players[(i * 7) % 86];
  const victim = server.players[(i * 11 + 43) % 86];
  if (attacker.teamID !== victim.teamID) server.emit('PLAYER_DIED', { attacker, victim, teamkill: false, weapon: 'BP_AK74M_C_1' });
  if (i % 3 === 0) server.emit('PLAYER_REVIVED', { reviver: server.players[(i * 5) % 86], victim });
}
for (let i = 0; i < 400; i++) {
  const attacker = server.players[(i * 13) % 86];
  const victim = server.players[(i * 17 + 43) % 86];
  if (attacker.teamID === victim.teamID) continue;
  server.emit('PLAYER_DAMAGED', { attacker, victim, teamkill: false, damage: 20 + (i % 60) });
  if (i % 2 === 0) server.emit('PLAYER_WOUNDED', { attacker, victim, teamkill: false });
}
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
