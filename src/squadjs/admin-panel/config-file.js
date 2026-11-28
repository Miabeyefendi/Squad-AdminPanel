// Reads and writes the plugin entries of SquadJS config.json. Server settings, connectors and
// secret values never leave the machine.
import fs from 'node:fs';

import { PanelError, has } from './errors.js';
import { writeJsonAtomic } from './store.js';

const SELF = 'AdminPanel';
const isSecret = (name) => /(password|secret|webhook|api_?key)/i.test(name) || /token$/i.test(name);
// Options that name a file or an address. Editing them from a browser could point the server anywhere.
const isFixed = (name, value) => typeof value === 'string' && /(file|path|dir|url|host)$/i.test(name);
const kindOf = (v) => (Array.isArray(v) ? 'json' : v === null ? 'json' : typeof v === 'object' ? 'json' : typeof v);

// Miabeyefendi
export class ConfigFile {
  constructor(file, getPlugins) {
    this.file = file;
    this.getPlugins = getPlugins;
    this.changed = new Set();
  }

  read() {
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  available() {
    return !!this.file && fs.existsSync(this.file);
  }

  async list() {
    if (!this.available()) return { available: false, plugins: [], missing: [], pending: [] };
    const classes = await this.getPlugins();
    const plugins = this.read().plugins.map((entry, index) => {
      const Plugin = has(classes, entry.plugin) ? classes[entry.plugin] : null;
      const spec = Plugin ? Plugin.optionsSpecification : {};
      const options = Object.entries(spec)
        .filter(([, o]) => !o.connector)
        .map(([name, o]) => {
          const value = name in entry ? entry[name] : o.default;
          const kind = kindOf(o.default === undefined ? value : o.default);
          const lock = isSecret(name) ? 'secret' : isFixed(name, value) ? 'fixed' : null;
          return { name, kind, lock, description: o.description || '', required: !!o.required, set: name in entry,
            value: lock === 'secret' ? null : value, default: lock === 'secret' ? null : o.default ?? null };
        });
      return {
        index, name: entry.plugin, enabled: !!entry.enabled, installed: !!Plugin, self: entry.plugin === SELF,
        description: Plugin ? Plugin.description : 'The plugin file is missing.',
        options: entry.plugin === SELF ? [] : options
      };
    });
    // installed in SquadJS but without a line in config.json
    const used = new Set(plugins.map((p) => p.name));
    const missing = Object.keys(classes).filter((name) => !used.has(name) && name !== SELF).sort()
      .map((name) => ({ name, description: classes[name].description || '' }));
    return { available: true, plugins, missing, pending: [...this.changed] };
  }

  // Adds a switched off entry for an installed plugin; its settings stay at their defaults.
  async add(name) {
    if (!this.available()) throw new PanelError('There is no config file to write.');
    const classes = await this.getPlugins();
    if (name === SELF || typeof name !== 'string' || !has(classes, name)) throw new PanelError('That plugin is not installed.');
    const config = this.read();
    if (config.plugins.some((p) => p.plugin === name)) throw new PanelError(`${name} is in config.json already.`);
    config.plugins.push({ plugin: name, enabled: false });
    this.write(config);
    this.changed.add(name);
    return this.list();
  }

  write(config) {
    fs.copyFileSync(this.file, `${this.file}.bak`);
    writeJsonAtomic(this.file, config);
  }

  async save({ index, name, enabled, options = {} }) {
    if (!this.available()) throw new PanelError('There is no config file to write.');
    const config = this.read();
    const entry = config.plugins[index];
    if (!entry || entry.plugin !== name) throw new PanelError('The config file changed. Reload the page.');
    if (name === SELF) throw new PanelError('The admin panel cannot edit itself.');
    const classes = await this.getPlugins();
    const Plugin = has(classes, name) ? classes[name] : null;
    if (!Plugin) throw new PanelError('The plugin file is missing.');

    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') throw new PanelError('enabled must be on or off.');
      if (enabled) {
        for (const [option, o] of Object.entries(Plugin.optionsSpecification)) {
          if (o.connector && !(config.connectors && config.connectors[entry[option] ?? o.default]))
            throw new PanelError(`${name} needs the connector for "${option}". Add it to config.json first.`);
          if (o.required && !o.connector && (entry[option] === undefined || entry[option] === o.default))
            throw new PanelError(`Set "${option}" before switching ${name} on.`);
        }
      }
      entry.enabled = enabled;
    }

    for (const [option, value] of Object.entries(options)) {
      const o = has(Plugin.optionsSpecification, option) ? Plugin.optionsSpecification[option] : null;
      if (!o || o.connector) throw new PanelError(`Unknown option ${String(option).slice(0, 40)}.`);
      const current = option in entry ? entry[option] : o.default;
      if (isSecret(option) || isFixed(option, current)) throw new PanelError(`${option} can only be changed in config.json.`);
      const want = kindOf(o.default === undefined ? current : o.default);
      if (want !== 'json' && typeof value !== want) throw new PanelError(`${option} must be a ${want}.`);
      if (want === 'number' && !Number.isFinite(value)) throw new PanelError(`${option} must be a number.`);
      if (want === 'json') {
        const shape = (v) => (v === null ? 'null' : Array.isArray(v) ? 'list' : typeof v);
        if (current !== null && current !== undefined && shape(value) !== shape(current))
          throw new PanelError(`${option} must stay a ${shape(current)}.`);
        if (!['null', 'list', 'object'].includes(shape(value))) throw new PanelError(`${option} must be a list or an object.`);
      }
      entry[option] = value;
    }

    this.write(config);
    this.changed.add(name);
    return this.list();
  }
}
