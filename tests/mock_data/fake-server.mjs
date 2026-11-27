// A stand-in for the SquadJS server object: sample players and an RCON that only records commands.
import { EventEmitter } from 'node:events';

export const eos = (n) => n.toString(16).padStart(32, '0');

export function fakeServer({ perTeam = 20 } = {}) {
  const server = new EventEmitter();
  const sent = [];
  const record = (command) => {
    sent.push(command);
    return Promise.resolve('');
  };
  server.sent = sent;
  server.mapReplies = {
    ShowCurrentMap: 'Current level is Narva, layer is Narva_AAS_v1, factions RGF+Mechanized USA+Armored',
    ShowNextMap: 'Next level is Yehorivka, layer is Yehorivka_RAAS_v2'
  };
  server.rcon = {
    execute: (command) => (command in server.mapReplies ? Promise.resolve(server.mapReplies[command]) : record(command)),
    warn: (id, text) => record(`AdminWarn "${id}" ${text}`),
    ban: (id, length, text) => record(`AdminBan "${id}" ${length} ${text}`),
    broadcast: (text) => record(`AdminBroadcast ${text}`),
    switchTeam: (id) => record(`AdminForceTeamChange "${id}"`)
  };
  const names = ['Alpha', 'Armor', 'Infantry', 'Logi', 'Defense', 'Mortars', 'FOB', 'Heli'];
  const squadNames = names.slice(0, Math.max(4, Math.ceil((perTeam - 2) / 9)));
  const count = squadNames.length;
  const roles = ['USA_SL_01', 'USA_Medic_01', 'USA_Rifleman_02', 'USA_LAT_01'];
  server.players = [];
  server.squads = [];
  let n = 1;
  for (const team of [1, 2]) {
    squadNames.forEach((squadName, s) => server.squads.push({ teamID: team, squadID: s + 1, squadName, locked: s === 0 ? 'True' : 'False', teamName: team === 1 ? 'RGF Mechanized' : 'US Army Armored' }));
    for (let i = 0; i < perTeam; i++, n++) {
      const squad = i < perTeam - 2 ? (i % count) + 1 : null;
      server.players.push({ eosID: eos(n), steamID: `7656119800000${String(n).padStart(4, '0')}`, playerID: n, name: `Player ${n}`, teamID: team, squadID: squad, isLeader: squad !== null && i < count, role: roles[i < count ? 0 : 1 + (i % 3)] });
    }
  }
  server.tickets = [312, 287];
  server.serverName = 'Test server';
  server.maxPlayers = 100;
  server.publicQueue = 2;
  server.reserveQueue = 0;
  server.matchStartTime = new Date(Date.now() - 600000);
  server.currentLayer = { layerid: 'Narva_AAS_v1', name: 'Narva AAS v1', teams: [{ faction: 'RGF' }, { faction: 'USA' }] };
  server.nextLayer = { layerid: 'Yehorivka_RAAS_v2', name: 'Yehorivka RAAS v2' };
  server.admins = new Set();
  server.getAdminPermsByAnyID = (id) => (server.admins.has(id) ? { kick: true } : undefined);
  server.plugins = [];
  server.logParser = { getRules: () => [] };
  server.updatePlayerList = async () => {};
  server.updateSquadList = async () => {};
  return server;
}

export const LAYERS = ['AAS_v1', 'AAS_v2', 'RAAS_v1', 'Invasion_v1'].flatMap((end) => ['Narva', 'Yehorivka', 'Gorodok'].map((map) => {
  const [mode, version] = end.split('_');
  return { id: `${map}_${end}`, map, mode, version, factions: [
    { id: 'USA', types: ['Armored', 'Mechanized'], teams: [1, 2] },
    { id: 'RGF', types: ['Mechanized', 'Support'], teams: [1, 2] },
    { id: 'WPMC', types: ['AirAssault'], teams: [1] }] };
}));
