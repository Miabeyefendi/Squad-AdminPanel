// Lays the plugin out the way it is installed in SquadJS, with stubs for the SquadJS files it imports.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { LAYERS } from '../mock_data/fake-server.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/squadjs');

export async function install({ layers: given = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-install-'));
  const plugins = path.join(root, 'squad-server', 'plugins');
  fs.mkdirSync(path.join(root, 'squad-server', 'layers'), { recursive: true });
  fs.cpSync(SRC, plugins, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(plugins, 'base-plugin.js'), `export default class BasePlugin {
  constructor(server, options) {
    this.server = server;
    this.options = {};
    for (const [k, o] of Object.entries(this.constructor.optionsSpecification)) this.options[k] = k in options ? options[k] : o.default;
  }
  async prepareToMount() {}
  verbose(level, text) { if (level <= 1) console.log(text); }
}
`);
  fs.writeFileSync(path.join(plugins, 'index.js'), `export default { getPlugins: async () => ({
  SeedingMode: class { static description = 'Seeding broadcasts'; static optionsSpecification = { interval: { default: 150000, description: 'Milliseconds between broadcasts' }, seedingMessage: { default: 'Seeding rules active', description: 'Text' }, liveEnabled: { default: true, description: 'Announce live' } }; },
  DiscordChat: class { static description = 'Chat to Discord'; static optionsSpecification = { discordClient: { connector: 'discord', default: 'discord' }, channelID: { default: '', required: true, description: 'Channel' } }; },
  AdminPanel: class { static description = 'Web admin panel'; static optionsSpecification = {}; }
}) };
`);
  const layers = given || LAYERS.map((l) => ({ layerid: l.id, map: { name: l.map }, gamemode: l.mode, version: l.version,
    factions: l.factions.map((f) => ({ factionId: f.id, types: f.types, availableOnTeams: f.teams })) }));
  fs.writeFileSync(path.join(root, 'squad-server', 'layers', 'index.js'),
    `export const Layers = { pull: async () => {}, layers: ${JSON.stringify(layers)} };\n`);
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    server: { rconPassword: 'RCONSECRET' }, connectors: {},
    plugins: [{ plugin: 'SeedingMode', enabled: true }, { plugin: 'DiscordChat', enabled: false }, { plugin: 'AdminPanel', enabled: true }]
  }, null, 2));
  const { default: AdminPanel } = await import(pathToFileURL(path.join(plugins, 'admin-panel.js')));
  const load = (file) => import(pathToFileURL(path.join(plugins, 'admin-panel', file)));
  const auth = await load('auth.js');
  const { openVault } = await load('vault.js');
  const addUsers = async (dataDir, users) => {
    const list = await Promise.all(users.map(async ({ password, ...u }) => ({ ...u, hash: await auth.hashPassword(password) })));
    auth.saveUsers(openVault(dataDir), list);
  };
  return { root, AdminPanel, auth, addUsers };
}
