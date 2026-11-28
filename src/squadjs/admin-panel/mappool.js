// Smart Map Pool: writes one of the bundled vote pools into the game server's ServerConfig folder.
// The game reads fixed file names, so choosing a pool replaces the one before it. Only these files
// are ever written: the three layer vote lists, and in VoteConfig.cfg only the lines a pool sets.
// What was there before is remembered and put back when a pool no longer needs it.
//   - removing the ./map-pool/ folder breaks nothing: the page says it is not installed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PanelError, has } from './errors.js';

export const VOTE = 'VoteConfig.cfg';
export const LAYER_FILES = ['LayerVoting.cfg', 'LayerVotingNight.cfg', 'LayerVotingLowPlayers.cfg'];
export const WEEK = 7 * 86400000;
const BUNDLE = new URL('./map-pool/pools.json', import.meta.url);

// line ends differ between machines and editors; they do not make a file "changed"
const sha = (text) => (text === null ? null : crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex'));
const lineFor = (key) => new RegExp(`^[ \\t]*${key}[ \\t]*=`);

export function readKey(text, key) {
  // the game takes the last line when a key is there twice
  const line = text.split(/\r?\n/).filter((l) => lineFor(key).test(l)).at(-1);
  return line === undefined ? null : line.slice(line.indexOf('=') + 1).trim();
}
// changes (or with null removes) one key and leaves every other line as it is
export function writeKey(text, key, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const at = lines.map((l, i) => (lineFor(key).test(l) ? i : -1)).filter((i) => i >= 0);
  if (value === null) return lines.filter((_, i) => !at.includes(i)).join(eol);
  if (!at.length) {
    const end = lines.at(-1) === '' ? lines.length - 1 : lines.length;
    lines.splice(end, 0, `${key}=${value}`);
  } else for (const i of at) lines[i] = `${key}=${value}`;
  return lines.join(eol);
}

export const layerIds = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).map((l) => l.split('|')[0]);

// The ServerConfig folder: the plugin option, or next to the game log SquadJS reads on this machine.
export function findConfigDir({ option, server, root }) {
  const options = server.options || {};
  const guess = option ? path.resolve(root, option)
    : options.logReaderMode === 'tail' && options.logDir ? path.resolve(root, options.logDir, '../../ServerConfig') : null;
  if (!guess) return null;
  return [VOTE, 'Server.cfg'].every((f) => fs.existsSync(path.join(guess, f))) ? guess : null;
}

// made by miabeyefendi
export class MapPool {
  constructor({ vault, dir = null, now = Date.now, bundle = BUNDLE }) {
    Object.assign(this, { vault, dir, now });
    try {
      this.data = JSON.parse(fs.readFileSync(bundle, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = null;
    }
    // original: what each file held before a pool took it over. written: what the panel put there.
    this.state = { main: null, seed: null, original: {}, written: {}, voteOriginal: {}, voteWritten: {},
      ...vault.readJson('mappool.enc', 'mappool', {}) };
  }

  save() {
    this.vault.writeJson('mappool.enc', 'mappool', this.state);
  }

  status() {
    return !this.data ? 'missing' : !this.dir ? 'nofolder' : 'ready';
  }

  pool(id) {
    return this.data?.pools.find((p) => p.id === id) || null;
  }

  ready() {
    if (this.status() === 'missing') throw new PanelError('Smart Map Pool is not installed.', 409);
    if (!this.dir) throw new PanelError('The ServerConfig folder of the game server was not found.', 409);
  }

  read(name) {
    try {
      return fs.readFileSync(path.join(this.dir, name), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw new PanelError(`${name} could not be read.`, 500);
    }
  }

  write(name, text) {
    const file = path.join(this.dir, name);
    try {
      if (text === null) fs.rmSync(file, { force: true });
      else {
        fs.writeFileSync(`${file}.panel-tmp`, text);
        fs.renameSync(`${file}.panel-tmp`, file);
      }
    } catch {
      throw new PanelError(`${name} could not be written. Check that SquadJS may write to the ServerConfig folder.`, 500);
    }
  }

  // a plain copy in the panel's data folder, so files can be put back by hand without the panel
  copy(folder, name, text) {
    if (text === null) return;
    const to = path.join(this.vault.dataDir, 'map-pool-backup', folder);
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(to, name), text);
  }

  // what the panel wrote and somebody changed since
  changedByHand() {
    if (!this.dir) return [];
    const files = Object.keys(this.state.written).filter((f) => sha(this.read(f)) !== this.state.written[f]);
    const vote = this.read(VOTE) ?? '';
    const keys = Object.entries(this.state.voteWritten).filter(([k, v]) => readKey(vote, k) !== v).map(([k]) => k);
    return keys.length ? [...files, `${VOTE} (${keys.join(', ')})`] : files;
  }

  // Makes the files match the pool in the main slot and the seeding list. Anything neither of them
  // needs any more gets back what it held before.
  sync(next, { force = false } = {}) {
    this.ready();
    const main = next.main && this.pool(next.main.id);
    const seed = next.seed && this.pool(next.seed);
    const files = { ...(seed ? seed.weeks[0] : {}), ...(main ? main.weeks[next.main.week] : {}) };
    const keys = main ? main.vote : {};
    const edited = this.changedByHand();
    if (edited.length && !force) throw new PanelError('Files were changed by hand since the panel wrote them.', 409);

    const state = this.state;
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    for (const name of edited.filter((f) => LAYER_FILES.includes(f))) this.copy(`edited-${stamp}`, name, this.read(name));
    if (edited.some((f) => f.startsWith(VOTE))) this.copy(`edited-${stamp}`, VOTE, this.read(VOTE));

    try {
      for (const name of LAYER_FILES) {
        const wanted = has(files, name) ? files[name] : null;
        const ours = has(state.written, name);
        if (wanted === null && !ours) continue;
        if (!ours) {
          state.original[name] = this.read(name);
          this.copy('before-panel', name, state.original[name]);
        }
        // remembered before writing: a crash in between must not lose what was there
        if (wanted !== null) {
          state.written[name] = sha(wanted);
          this.save();
          this.write(name, wanted);
        } else {
          this.write(name, state.original[name]);
          delete state.written[name];
          delete state.original[name];
        }
      }
      const all = [...new Set([...Object.keys(state.voteWritten), ...Object.keys(keys)])];
      if (all.length) {
        const before = this.read(VOTE);
        if (before === null) throw new PanelError(`${VOTE} could not be read.`, 500);
        if (!Object.keys(state.voteWritten).length) this.copy('before-panel', VOTE, before);
        let text = before;
        for (const key of all) {
          if (!has(state.voteWritten, key)) state.voteOriginal[key] = readKey(text, key);
          if (has(keys, key)) {
            text = writeKey(text, key, keys[key]);
            state.voteWritten[key] = keys[key];
          } else {
            text = writeKey(text, key, state.voteOriginal[key]);
            delete state.voteWritten[key];
            delete state.voteOriginal[key];
          }
        }
        this.save();
        if (text !== before) this.write(VOTE, text);
      }
      state.main = next.main || null;
      state.seed = next.seed || null;
    } finally {
      this.save();
    }
  }

  // Chooses a pool. A seeding list goes on top of the main pool; anything else replaces the main pool.
  apply(id, options) {
    this.ready();
    const pool = this.pool(id) || (() => { throw new PanelError('Unknown map pool.'); })();
    if (pool.seed) this.sync({ main: this.state.main, seed: id }, options);
    else {
      const weekly = pool.weeks.length > 1;
      this.sync({ main: { id, week: 0, since: this.now(), auto: weekly, nextAt: weekly ? this.now() + WEEK : null }, seed: this.state.seed }, options);
    }
    return pool;
  }

  // gives every file back what it held before
  restore(options) {
    this.sync({ main: null, seed: null }, options);
  }

  removeSeed(options) {
    this.sync({ main: this.state.main, seed: null }, options);
  }

  weekly() {
    const main = this.state.main;
    const pool = main && this.pool(main.id);
    return pool && pool.weeks.length > 1 ? { main, pool } : null;
  }

  setWeek(week, options) {
    const { main, pool } = this.weekly() || (() => { throw new PanelError('The pool in use has no weeks.', 409); })();
    if (!Number.isInteger(week) || week < 0 || week >= pool.weeks.length) throw new PanelError('Unknown week.');
    this.sync({ main: { ...main, week }, seed: this.state.seed }, options);
    return pool;
  }

  // switches the weekly change on or off, with the time of the next one
  setAuto(on, nextAt) {
    const { main } = this.weekly() || (() => { throw new PanelError('The pool in use has no weeks.', 409); })();
    if (on && !(Number.isFinite(nextAt) && nextAt > this.now() && nextAt < this.now() + 5 * WEEK)) {
      throw new PanelError('Pick a time within the next five weeks.');
    }
    Object.assign(main, { auto: !!on, nextAt: on ? nextAt : null, stopped: null });
    this.save();
  }

  // Called every few seconds. Moves a weekly pool on when its time has come, also after the panel
  // was off for a while. It never writes over a file changed by hand: it stops and says so.
  tick() {
    const weekly = this.status() === 'ready' && this.weekly();
    if (!weekly || !weekly.main.auto || !(this.now() >= weekly.main.nextAt)) return null;
    const { main, pool } = weekly;
    const passed = Math.floor((this.now() - main.nextAt) / WEEK) + 1;
    const week = (main.week + passed) % pool.weeks.length;
    try {
      this.sync({ main: { ...main, week, nextAt: main.nextAt + passed * WEEK }, seed: this.state.seed });
    } catch (err) {
      Object.assign(this.state.main, { auto: false, nextAt: null, stopped: err.message });
      this.save();
      return { pool: pool.name, error: err.message };
    }
    return { pool: pool.name, week: week + 1 };
  }

  // Server.cfg is only read, and only these two lines of it
  voteMode() {
    const text = this.read('Server.cfg') ?? '';
    return { mode: readKey(text, 'MapRotationMode'), voteLayer: readKey(text, 'UseVoteLayer') };
  }

  // everything the page needs; "layers" is the server's own layer list, to spot ids it does not know
  describe({ layers = [], folder = false } = {}) {
    const status = this.status();
    if (status === 'missing') return { status, pools: [], groups: [] };
    const known = new Set(layers.map((l) => l.id.toLowerCase()));
    const mode = status === 'ready' ? this.voteMode() : null;
    return {
      status,
      project: this.data.project,
      baseline: this.data.baseline,
      groups: this.data.groups,
      folder: folder ? this.dir : null,
      voteMode: mode && { ...mode, ok: /^LayerList_Vote$/i.test(mode.mode || '') && /^true$/i.test(mode.voteLayer || '') },
      pools: this.data.pools.map((p) => {
        const weeks = p.weeks.map((files) => Object.entries(files).map(([name, text]) => ({ name, layers: layerIds(text) })));
        const ids = weeks.flat().flatMap((f) => f.layers);
        return { id: p.id, name: p.name, what: p.what, n: p.n, seed: p.seed, weeks, vote: p.vote, sim: p.sim,
          unknown: known.size ? [...new Set(ids.filter((id) => !known.has(id.toLowerCase())))] : [] };
      }),
      active: { main: this.state.main, seed: this.state.seed, edited: this.changedByHand() }
    };
  }
}
