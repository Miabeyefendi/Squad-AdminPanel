// Smart Shuffle, built into the panel. The plugin lives in ./smart-shuffle/ and is run by the panel,
// not by SquadJS's plugin loader, so:
//   - removing that folder breaks nothing: the Smart Shuffle tab says it is not installed,
//   - settings are changed in the panel and apply at once, without a SquadJS restart,
//   - its settings (and its MySquadStats token) stay out of config.json and SquadJS's ping.
// A SmartShuffle that config.json already runs is left in charge, so it never runs twice.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PanelError, has } from './errors.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'smart-shuffle');
const PROJECT = 'https://github.com/Miabeyefendi/Squad-SmartShuffle';
// what a running instance knows about the current match; kept when settings are applied
const RUNTIME = ['lock', 'lockAligned', 'round', 'pendingNow', 'requester', 'history', 'stats', 'inMatch', 'matchStart',
  'lastTick', 'alerted', 'queue', 'streak', 'lastWinners', 'last', 'layerClass', 'moveMs', 'outside', 'roundCounts', 'dump'];
const SECRET = ['mySquadStatsToken'];
// never set from a browser: it names a file on the server
const FIXED = ['tokenFile'];

// The order and the names shown in the panel. An option missing here is shown under "Other".
const LAYOUT = [
  ['When to shuffle', [['autoShuffle', 'Shuffle automatically'], ['minPlayers', 'Only from this many players'], ['shuffleTicketGap', 'Only after a ticket gap of (0 = every round)'], ['shuffleWinStreak', 'Only after a win streak of (0 = off)'], ['skipLayers', 'Skip layers containing'], ['announceMinutes', 'Announce a coming shuffle every (minutes, 0 = off)']]],
  ['Balance', [['maxPartySize', 'Largest party kept together (0 = no limit)'], ['keepParties', 'Keep parties together'], ['moveSquads', 'Move whole squads'], ['fewerMoves', 'Move fewer players (0 = off)'], ['historyRounds', 'Rounds of history used (0 = off)'], ['historyHours', 'History is valid for (hours)'], ['lockedSquadMaxSize', 'Locked squads kept up to this size']]],
  ['Team lock and switching', [['lockMode', 'Lock after a shuffle (0 off, 1 lock, 2 lock with parties)'], ['lockCheckSeconds', 'Check the lock every (seconds, 0 = off)'], ['switchCommand', 'Switch command in chat (off, or a word)'], ['switchMaxDiff', 'Largest team difference a switch may make'], ['switchQueueMinutes', 'Switch queue lasts (minutes, 0 = no queue)']]],
  ['Switch tokens', [['switchTokens', 'Switch tokens'], ['tokenStart', 'Tokens a new player has'], ['tokenMax', 'Most tokens (0 = no limit)'], ['tokenRefillHours', 'Refill after (hours, 0 = never)'], ['tokenSeedMinutes', 'Seeding rewards at (minutes)'], ['tokenSeedPlayers', 'Counts as seeding below (players)'], ['tokenDecayDays', 'Extra tokens expire after (days away, 0 = never)'], ['tokenCommand', 'Token command in chat']]],
  ['Messages', [['broadcastResult', 'Tell the server the result'], ['warnMovedPlayers', 'Tell moved players'], ['announceLockStart', 'Say when teams are locked'], ['announceLockEnd', 'Say when the lock ends'], ['tokenMessages', 'Token messages']]],
  ['Admins', [['command', 'Admin chat command'], ['adminReport', 'Report after a shuffle'], ['reportSkips', 'Report skipped shuffles'], ['imbalanceAlertMinutes', 'Warn about uneven teams after (minutes, 0 = off)'], ['imbalanceAlertGap', 'Uneven from a score gap of (percent)']]],
  ['Player roles and timing', [['kitMedic', 'Medic kit names (pattern)'], ['kitLogistics', 'Logistics kit names (pattern)'], ['kitCrew', 'Crew kit names (pattern)'], ['shuffleDelaySeconds', 'Wait after round end (seconds)'], ['shuffleDeadlineSeconds', 'Stop moving after (seconds)']]],
  ['MySquadStats', [['useMySquadStats', 'Use MySquadStats ratings'], ['mySquadStatsToken', 'Access token'], ['mySquadStatsWeight', 'Weight of the rating (0 to 1)'], ['mySquadStatsDlc', 'Rating set']]],
  ['Scoreboard dump', [['useScoreboardDump', 'Read the ModLoader scoreboard dump'], ['dumpWaitSeconds', 'Wait for the dump (seconds)']]]
];

export class ShuffleHost {
  constructor({ server, vault, dir = DIR, onError = () => {} }) {
    Object.assign(this, { server, vault, dir, onError });
    this.instance = null;
    this.Plugin = null;
    this.error = null;
    this.presets = [];
    this.queue = Promise.resolve();
    const saved = vault.readJson('shuffle.enc', 'shuffle', {});
    this.enabled = saved.enabled !== false;
    this.options = saved.options || {};
  }

  external() {
    return this.server.plugins.find((p) => p.constructor.name === 'SmartShuffle') || null;
  }

  // the instance that is doing the work, whoever started it
  current() {
    return this.external() || this.instance;
  }

  status() {
    if (this.external()) return 'external';
    if (!this.Plugin) return this.error ? 'error' : 'missing';
    return this.instance ? 'on' : this.error ? 'error' : 'off';
  }

  async load() {
    const file = path.join(this.dir, 'plugin.js');
    if (!fs.existsSync(file)) return;
    try {
      this.Plugin = (await import(pathToFileURL(file))).default;
      const presets = path.join(this.dir, 'presets.json');
      this.presets = fs.existsSync(presets) ? JSON.parse(fs.readFileSync(presets, 'utf8')) : [];
    } catch (err) {
      this.error = `Smart Shuffle could not be loaded: ${err.message}`;
      this.onError(err);
    }
  }

  async mount() {
    await this.load();
    if (this.Plugin && this.enabled && !this.external()) await this.start(null);
  }

  async start(previous) {
    try {
      const instance = new this.Plugin(this.server, {
        plugin: 'SmartShuffle', enabled: true, ...this.options,
        tokenFile: path.join(this.vault.dataDir, 'smart-shuffle-tokens.json')
      }, {});
      await instance.prepareToMount();
      await instance.mount();
      if (previous) for (const key of RUNTIME) if (previous[key] !== undefined) instance[key] = previous[key];
      this.instance = instance;
      this.error = null;
    } catch (err) {
      this.instance = null;
      this.error = `Smart Shuffle did not start: ${err.message}`;
      this.onError(err);
    }
  }

  async stop() {
    const old = this.instance;
    this.instance = null;
    if (old) await old.unmount();
    return old;
  }

  async unmount() {
    await this.stop();
  }

  value(name) {
    return has(this.options, name) ? this.options[name] : this.Plugin.optionsSpecification[name].default;
  }

  // everything the Smart Shuffle tab needs
  describe(withSettings) {
    const status = this.status();
    const base = { status, error: this.error, project: PROJECT, groups: [], presets: [] };
    if (!withSettings || !this.Plugin || status === 'external') return base;
    const spec = this.Plugin.optionsSpecification;
    const listed = new Set(LAYOUT.flatMap(([, items]) => items.map(([name]) => name)));
    const rest = Object.keys(spec).filter((n) => !listed.has(n) && !FIXED.includes(n)).map((n) => [n, n]);
    const field = ([name, label]) => {
      const kind = this.kind(name);
      const secret = SECRET.includes(name);
      let value = this.value(name);
      if (name === 'keepParties' && value === null) value = Number(this.value('lockMode')) === 2;
      return { name, label, kind, help: spec[name].description || '', secret,
        set: secret ? !!value : undefined, value: secret ? '' : value, changed: has(this.options, name) };
    };
    return { ...base,
      groups: [...LAYOUT, ...(rest.length ? [['Other', rest]] : [])]
        .map(([title, items]) => ({ title, fields: items.filter(([name]) => has(spec, name)).map(field) })),
      presets: this.presets };
  }

  kind(name) {
    const dflt = this.Plugin.optionsSpecification[name].default;
    if (name === 'keepParties') return 'boolean';
    return Array.isArray(dflt) ? 'list' : typeof dflt;
  }

  check(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new PanelError('Nothing to change.');
    const out = {};
    for (const [name, value] of Object.entries(changes)) {
      if (!has(this.Plugin.optionsSpecification, name) || FIXED.includes(name)) {
        throw new PanelError(`Unknown setting ${String(name).slice(0, 40)}.`);
      }
      const kind = this.kind(name);
      if (kind === 'boolean') {
        if (typeof value !== 'boolean') throw new PanelError(`${name} must be on or off.`);
        out[name] = value;
      } else if (kind === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) {
          throw new PanelError(`${name} must be a number from 0 to 100000.`);
        }
        out[name] = value;
      } else if (kind === 'list') {
        if (!Array.isArray(value) || value.length > 100 ||
            value.some((v) => !['string', 'number'].includes(typeof v) || String(v).length > 60)) {
          throw new PanelError(`${name} must be a short list.`);
        }
        out[name] = name === 'tokenSeedMinutes' ? value.map(Number).filter((n) => n > 0) : value.map(String);
      } else {
        if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f]/.test(value)) {
          throw new PanelError(`${name} must be one line of text.`);
        }
        if (/^kit/.test(name)) {
          try {
            new RegExp(value);
          } catch {
            throw new PanelError(`${name} is not a valid pattern.`);
          }
        }
        // chat command words
        if (/command$/i.test(name) && !/^!?[a-z0-9_-]{1,30}$/i.test(value)) {
          throw new PanelError(`${name} must be a single word, or off.`);
        }
        out[name] = value;
      }
    }
    if (!Object.keys(out).length) throw new PanelError('Nothing to change.');
    return out;
  }

  save() {
    this.vault.writeJson('shuffle.enc', 'shuffle', { enabled: this.enabled, options: this.options });
  }

  // one change at a time
  exclusive(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  ready() {
    if (this.external()) throw new PanelError('Smart Shuffle runs from config.json here. Remove it there to manage it in the panel.', 409);
    if (!this.Plugin) throw new PanelError('Smart Shuffle is not installed.', 409);
    if (this.instance?.busy) throw new PanelError('A shuffle is running right now. Try again in a minute.', 409);
  }

  // Applies settings at once. replace drops every earlier setting first (used by presets).
  apply(changes, { replace = false } = {}) {
    return this.exclusive(async () => {
      this.ready();
      const checked = this.check(changes);
      const keep = replace ? Object.fromEntries(SECRET.filter((n) => has(this.options, n)).map((n) => [n, this.options[n]])) : this.options;
      this.options = { ...keep, ...checked };
      this.save();
      if (this.enabled) await this.start(await this.stop());
    });
  }

  preset(id) {
    const preset = this.presets.find((p) => p.id === id);
    if (!preset) throw new PanelError('Unknown preset.');
    return this.apply(preset.options, { replace: true });
  }

  setEnabled(on) {
    return this.exclusive(async () => {
      this.ready();
      this.enabled = !!on;
      this.save();
      if (this.enabled && !this.instance) await this.start(null);
      if (!this.enabled) await this.stop();
    });
  }

  // A quick switch was used: keep it, so it survives a restart. The instance already has it.
  remember(command) {
    if (this.external() || !this.instance) return;
    const [word, arg] = command.split(' ');
    const changes = word === 'auto' ? { autoShuffle: arg === 'on' }
      : word === 'friends' ? { keepParties: arg === 'on' }
        : word === 'lock' ? { lockMode: Number(arg), keepParties: this.instance.friends }
          : word === 'tokens' ? { switchTokens: arg === 'on' } : null;
    if (!changes) return;
    this.options = { ...this.options, ...changes };
    this.save();
  }
}
