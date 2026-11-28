// AdminPanel: a web admin panel for SquadJS. Needs the admin-panel folder next to this file.
// No npm packages beyond what SquadJS already has.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BasePlugin from './base-plugin.js';

import { Actions } from './admin-panel/actions.js';
import { Auth, ensureDefaultAdmin, loadUsers } from './admin-panel/auth.js';
import { ConfigFile } from './admin-panel/config-file.js';
import { createPanelServer, isLoopback } from './admin-panel/http.js';
import { Notifier } from './admin-panel/notify.js';
import { Rules } from './admin-panel/rules.js';
import { Schedule } from './admin-panel/schedule.js';
import { ShuffleHost } from './admin-panel/shuffle.js';
import { Tracker } from './admin-panel/state.js';
import { Store } from './admin-panel/store.js';
import { openVault } from './admin-panel/vault.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default class AdminPanel extends BasePlugin {
  static get description() {
    return 'Web admin panel: live scoreboard and squads, chat, warn/kick/ban, map control, rules, logs and plugin settings.';
  }

  static get defaultEnabled() {
    return false;
  }

  // SquadJS sends plugin options to its ping API, so nothing secret belongs here.
  static get optionsSpecification() {
    return {
      host: { required: false, description: 'Address to listen on. Keep 127.0.0.1 and use an HTTPS reverse proxy for remote access.', default: '127.0.0.1' },
      port: { required: false, description: 'Port of the panel.', default: 8170 },
      allowRemote: { required: false, description: 'Must be on to listen on anything but this machine.', default: false },
      allowedHosts: { required: false, description: 'Host names the panel answers to, besides localhost.', default: [] },
      secureCookie: { required: false, description: 'On when a proxy serves the panel over HTTPS. On by itself when <dataDir>/tls has a certificate.', default: false },
      trustProxy: { required: false, description: 'On when a reverse proxy on this machine sets X-Forwarded-For. Sign in limits then count per visitor.', default: false },
      idleMinutes: { required: false, description: 'Sign out after this long without a request.', default: 60 },
      allowRestart: { required: false, description: 'Lets the owner stop SquadJS from the panel. Only useful when a service manager starts it again.', default: false },
      dataDir: { required: false, description: 'Folder for users, notes, rules and logs, relative to the SquadJS folder.', default: './admin-panel-data' },
      configFile: { required: false, description: 'SquadJS config file the Plugins page edits, relative to the SquadJS folder.', default: './config.json' },
      retentionDays: { required: false, description: 'Days to keep logs until the owner sets it on the Records page. 0 keeps them forever.', default: 90 },
      sessionHours: { required: false, description: 'How long a sign in lasts.', default: 12 },
      refreshSeconds: { required: false, description: 'Player and squad refresh while someone has the panel open. 0 leaves the SquadJS default.', default: 5 }
    };
  }

  async mount() {
    const o = this.options;
    const dataDir = path.resolve(ROOT, o.dataDir);
    const tls = this.loadTls(dataDir);
    if (!isLoopback(o.host) && !(o.allowRemote && tls)) {
      this.verbose(1, `Not started: host ${o.host} is open to the network. That needs allowRemote and a certificate in ` +
        `${path.join(o.dataDir, 'tls')} (cert.pem, key.pem). Plain HTTP over a network would send passwords unencrypted.`);
      return;
    }

    let vault;
    try {
      vault = openVault(dataDir);
      loadUsers(vault);
      this.store = new Store(vault, { retentionDays: +o.retentionDays || 0 });
      this.schedule = new Schedule({ server: this.server, vault, store: this.store });
      this.notifier = new Notifier({ vault, serverName: () => this.server.serverName || 'Squad server' });
    } catch (err) {
      // never start over data that cannot be read: it would be overwritten
      this.verbose(1, `Not started: ${err.message}`);
      return;
    }
    if (this.store.damaged) this.verbose(1, `${this.store.damaged} log lines could not be read and were skipped.`);
    await ensureDefaultAdmin(vault);
    if (loadUsers(vault).some((u) => u.defaultAccount)) {
      this.verbose(1, 'The panel still has the first password (name: admin, password: admin). It works from this machine ' +
        'only. Change it before any proxy or tunnel is put in front of the panel.');
    }

    this.rules = new Rules({ server: this.server, store: this.store });
    this.shuffle = new ShuffleHost({ server: this.server, vault, onError: (err) => this.verbose(1, err.message) });
    await this.shuffle.mount();
    this.tracker = new Tracker({ server: this.server, store: this.store, rules: this.rules, shuffle: this.shuffle });
    const getPlugins = async () => (await import('./index.js')).default.getPlugins();
    this.web = createPanelServer({
      auth: new Auth({ vault, sessionHours: +o.sessionHours || 12, idleMinutes: +o.idleMinutes || 60 }),
      tls,
      actions: new Actions({ server: this.server, store: this.store, shuffle: this.shuffle, getLayers: () => this.layerList(),
        rconVerbosity: () => this.rconVerbosity() }),
      schedule: this.schedule,
      notifier: this.notifier,
      shuffle: this.shuffle,
      tracker: this.tracker,
      store: this.store,
      rules: this.rules,
      // an env "config" string has no file to write back to
      configFile: new ConfigFile(process.env.config ? null : path.resolve(ROOT, process.argv[2] || o.configFile), getPlugins),
      getLayers: () => this.layerList(),
      restart: () => setTimeout(() => process.exit(1), 500),
      options: o,
      uiDir: new URL('./admin-panel/ui/', import.meta.url),
      onError: (err) => this.verbose(2, `Request failed: ${err.message}`)
    });

    this.tracker.mount();
    this.tracker.onPlayers();
    await this.tracker.readMaps();
    this.store.listeners.add((entry) => this.web.broadcast('log', entry));
    this.store.listeners.add((entry) => this.notifier.onLog(entry));
    this.newGame = () => this.schedule.onNewGame();
    this.server.on('NEW_GAME', this.newGame);
    this.scheduleTimer = setInterval(() => this.schedule.tick().catch((err) => this.verbose(1, err.message)), 15000);

    let sent = -1;
    let beat = 0;
    this.pushTimer = setInterval(() => {
      beat += 1;
      if (this.tracker.version === sent && beat % 15) return;
      sent = this.tracker.version;
      if (this.web.clients()) this.web.broadcast('state', this.tracker.snapshot());
    }, 1000);

    const every = +o.refreshSeconds || 0;
    if (every > 0) {
      this.refreshTimer = setInterval(() => {
        if (!this.web.clients()) return;
        this.server.updateSquadList().then(() => this.server.updatePlayerList()).catch(() => {});
      }, Math.max(every, 3) * 1000);
    }

    await new Promise((resolve, reject) => {
      this.web.server.once('error', reject);
      this.web.server.listen(+o.port, o.host, resolve);
    }).then(
      () => this.verbose(1, `Admin panel on ${tls ? 'https' : 'http'}://${o.host}:${o.port}`),
      (err) => this.verbose(1, `Could not listen on ${o.host}:${o.port}: ${err.message}`)
    );
  }

  // How much SquadJS prints about RCON, from its own logger; null when it cannot be read.
  async rconVerbosity() {
    try {
      const { default: logger } = await import('core/logger');
      return logger.verboseness.RCON || 1;
    } catch {
      return null;
    }
  }

  loadTls(dataDir) {
    const [cert, key] = ['cert.pem', 'key.pem'].map((f) => path.join(dataDir, 'tls', f));
    if (!fs.existsSync(cert) || !fs.existsSync(key)) return null;
    return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
  }

  async layerList() {
    const { Layers } = await import('../layers/index.js');
    await Layers.pull();
    return Layers.layers.map((l) => ({
      id: l.layerid, map: l.map?.name || l.layerid.split('_')[0], mode: l.gamemode, version: l.version,
      factions: (l.factions || []).map((f) => ({ id: f.factionId, types: f.types || [], teams: f.availableOnTeams || [1, 2] }))
    }));
  }

  async unmount() {
    clearInterval(this.pushTimer);
    clearInterval(this.refreshTimer);
    clearInterval(this.scheduleTimer);
    if (this.newGame) this.server.removeListener('NEW_GAME', this.newGame);
    this.notifier?.close();
    this.tracker?.unmount();
    await this.shuffle?.unmount();
    this.store?.flush();
    this.store?.listeners.clear();
    if (this.web?.server.listening) await this.web.close();
  }
}

// Author: Miabeyefendi (made by miabeyefendi)
