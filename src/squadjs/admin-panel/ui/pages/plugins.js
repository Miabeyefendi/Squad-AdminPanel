// Any plugin SquadJS knows: the list on the left, the chosen one with a box for every setting on the right.
// Nothing here knows a plugin by name; the boxes come from the plugin's own option list.
import { $, api, ask, confirmField, draw, gate, guard, html, may, plural, put, t, toast } from '../core.js';

let data = null;
let chosen = null; // plugin name
let filter = 'all';
// unsaved boxes per plugin, kept while another one is looked at: name -> Map(option -> raw box value)
const drafts = new Map();

const FILTERS = [['all', t('All')], ['on', t('On')], ['off', t('Off')], ['missing', t('Not in config')]];
const pretty = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = (list) => Array.isArray(list) && list.every((v) => typeof v === 'string' || typeof v === 'number');
// which box an option gets
function shape(o) {
  if (o.kind !== 'json') return o.kind;
  const sample = [o.default, o.value].find((v) => Array.isArray(v) && v.length);
  return sample && plain(o.value ?? []) && plain(sample) ? 'lines' : 'json';
}
const asText = (o, value) => (shape(o) === 'lines' ? (value || []).join('\n') : shape(o) === 'json' ? JSON.stringify(value, null, 2) : value === null || value === undefined ? '' : String(value));
// the value a box stands for; throws when it cannot be read
function read(o, raw) {
  const kind = shape(o);
  if (kind === 'boolean') return raw;
  if (kind === 'number') {
    if (String(raw).trim() === '' || !Number.isFinite(Number(raw))) throw new Error(t('Needs a number.'));
    return Number(raw);
  }
  if (kind === 'lines') {
    const items = String(raw).split('\n').map((x) => x.trim()).filter(Boolean);
    const numbers = [o.default, o.value].some((v) => Array.isArray(v) && v.length && v.every((x) => typeof x === 'number'));
    if (numbers && items.some((x) => Number.isNaN(Number(x)))) throw new Error(t('One number per line.'));
    return numbers ? items.map(Number) : items;
  }
  if (kind === 'json') {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(t('This is not valid JSON.'));
    }
  }
  return String(raw);
}
const current = () => data?.plugins.find((p) => p.name === chosen);
const draftOf = (name) => drafts.get(name) || new Map();
function setDraft(plugin, o, raw) {
  const draft = draftOf(plugin.name);
  let unchanged = false;
  try { unchanged = same(read(o, raw), o.value); } catch { /* kept, and shown as wrong */ }
  if (unchanged) draft.delete(o.name);
  else draft.set(o.name, raw);
  if (draft.size) drafts.set(plugin.name, draft);
  else drafts.delete(plugin.name);
}
const problem = (o, raw) => { try { read(o, raw); return ''; } catch (err) { return err.message; } };

function stats() {
  const list = data.plugins;
  const box = (label, value, note) => html`<div class="kpi"><span class="cap">${label}</span><span class="kpiv">${value}</span><span class="sub xs">${note}</span></div>`;
  return html`${box(t('Switched on'), list.filter((p) => p.enabled).length, t('of {n} in config.json', { n: list.length }))}
    ${box(t('Not in config.json'), data.missing.length, t('installed, never set up'))}
    ${box(t('File missing'), list.filter((p) => !p.installed).length, t('in config, plugin not found'))}
    ${box(t('Waiting for restart'), data.pending.length, data.pending.join(', ') || t('Nothing changed'))}
    <div class="kpi act"><button class="btn danger" data-restart data-need="restart">${t('Restart SquadJS')}</button><span class="sub xs">${t('SquadJS reads config.json when it starts.')}</span></div>`;
}
function entries() {
  const q = $('#pg-q').value.trim().toLowerCase();
  const all = [...data.plugins.map((p) => ({ ...p, state: p.enabled ? 'on' : 'off' })), ...data.missing.map((p) => ({ ...p, state: 'missing', installed: true }))];
  return all.filter((p) => (filter === 'all' || p.state === filter) && (!q || `${p.name} ${p.description}`.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function list() {
  const rows = entries();
  if (!rows.length) return html`<span class="empty">${t('No plugin matches.')}</span>`;
  const mark = { on: t('On'), off: t('Off'), missing: t('Add') };
  return rows.map((p) => html`<button class="sideitem plug" data-plugin="${p.name}" data-key="${p.name}" aria-pressed="${p.name === chosen}"><span class="dot ${p.state}" aria-hidden="true"></span><span class="grow clip">${p.name}</span>${drafts.has(p.name) ? html`<span class="tag mini solid">${t('unsaved')}</span>` : ''}${!p.installed ? html`<span class="tag mini warnish">${t('file missing')}</span>` : ''}<span class="sub xs">${mark[p.state]}</span></button>`);
}

function box(plugin, o) {
  const draft = draftOf(plugin.name);
  const has = draft.has(o.name);
  const raw = has ? draft.get(o.name) : o.kind === 'boolean' ? !!o.value : asText(o, o.value);
  const kind = shape(o);
  if (o.lock === 'secret') return html`<span class="tag">${t('Hidden. Change it in config.json.')}</span>`;
  if (o.lock === 'fixed') return html`<code class="wrapany">${o.value}</code><span class="sub xs">${t('Paths and addresses are changed in config.json only.')}</span>`;
  const label = pretty(o.name);
  if (kind === 'boolean') return html`<button type="button" class="sw" role="switch" aria-checked="${raw}" aria-label="${label}" data-opt="${o.name}" data-key="${o.name}"></button>`;
  const wrong = has ? problem(o, raw) : '';
  const invalid = wrong ? html`aria-invalid="true"` : '';
  let control;
  if (kind === 'number') control = html`<input class="field mono short" type="number" step="any" aria-label="${label}" data-opt="${o.name}" data-key="${o.name}" value="${raw}" ${invalid}>`;
  else if (kind === 'string' && String(raw).length <= 60 && !String(raw).includes('\n')) control = html`<input class="field full" aria-label="${label}" data-opt="${o.name}" data-key="${o.name}" value="${raw}">`;
  else control = html`<textarea class="field full ${kind === 'json' ? 'mono' : ''}" rows="${Math.min(12, Math.max(3, String(raw).split('\n').length + 1))}" aria-label="${label}" data-opt="${o.name}" data-key="${o.name}" spellcheck="false" ${invalid}>${raw}</textarea>`;
  return html`${control}${kind === 'lines' ? html`<span class="sub xs">${t('One per line.')}</span>` : kind === 'json' ? html`<span class="sub xs">${Array.isArray(o.value ?? o.default) ? t('JSON list.') : t('JSON object.')}</span>` : ''}<span class="err opterr">${wrong}</span>`;
}
function optionRow(plugin, o) {
  const wide = !['boolean', 'number'].includes(shape(o)) || !!o.lock;
  const changed = draftOf(plugin.name).has(o.name);
  const dflt = o.lock ? null : o.kind === 'boolean' ? (o.default ? t('On') : t('Off')) : asText(o, o.default).replace(/\s+/g, ' ');
  const differs = !o.lock && o.default !== null && !same(o.value, o.default);
  return html`<div class="optrow ${wide ? 'wide' : ''} ${changed ? 'changed' : ''}" data-row="${o.name}"><div class="optlabel"><b>${pretty(o.name)}</b>${o.required ? html`<span class="tag mini">${t('required')}</span>` : ''}<code class="sub xs">${o.name}</code><span class="sub xs">${o.description}</span>${dflt !== null && dflt !== '' && dflt !== 'null' ? html`<span class="sub xs clip" title="${dflt}">${t('Default: {value}', { value: dflt.slice(0, 80) })}</span>` : ''}${differs ? html`<button class="linkbtn xs" data-default="${o.name}">${t('Use the default')}</button>` : ''}</div><div class="optctl">${box(plugin, o)}</div></div>`;
}
function detail() {
  const added = data.missing.find((p) => p.name === chosen);
  if (added) return html`<div class="plughead"><div class="stack2 grow"><h2>${added.name}</h2><span class="sub">${added.description}</span></div></div><div class="stack8"><span>${t('This plugin is installed in SquadJS but has no line in config.json, so it does not run.')}</span><span><button class="btn pri" data-add="${added.name}">${t('Add to config.json')}</button></span><span class="sub xs">${t('It is added switched off, with default settings.')}</span></div>`;
  const p = current();
  if (!p) return html`<div class="pickempty"><h2>${t('Pick a plugin')}</h2><span class="sub">${t('Its settings show up here.')}</span></div>`;
  const draft = draftOf(p.name);
  return html`<div class="plughead"><div class="stack2 grow"><div class="line"><h2 class="wrapany">${p.name}</h2><span class="tag mini ${p.enabled ? 'solid' : ''}">${p.enabled ? t('On') : t('Off')}</span>${data.pending.includes(p.name) ? html`<span class="tag mini warnish">${t('restart needed')}</span>` : ''}</div><span class="sub">${p.description}</span></div>
      ${p.self ? html`<span class="tag solid">${t('this panel')}</span>` : html`<button class="sw" role="switch" aria-checked="${p.enabled}" aria-label="${t('Switch {name} on or off', { name: p.name })}" data-power ${p.installed ? '' : html`disabled`}></button>`}</div>
    ${p.self ? html`<span class="sub">${t('The panel cannot change its own settings. Edit its line in config.json.')}</span>` : p.options.length ? html`<div class="options">${p.options.map((o) => optionRow(p, o))}</div><div class="savebar sticky-bottom ${draft.size ? 'on' : ''}"><span class="grow" id="pg-count">${draft.size ? plural(draft.size, 'unsaved change') : t('No unsaved changes')}</span><button class="btn" data-undo ${draft.size ? '' : html`disabled`}>${t('Undo')}</button><button class="btn pri" data-save ${draft.size ? '' : html`disabled`}>${t('Save')}</button></div>` : html`<span class="sub">${p.installed ? t('This plugin has no settings.') : t('Copy the plugin file back into squad-server/plugins and restart SquadJS.')}</span>`}`;
}

function render() {
  if (!may('plugins')) return;
  if (!data) return;
  if (!data.available) {
    put($('#pg-detail'), html`<span class="sub">${t('SquadJS was started without a config file, so there is nothing to edit here.')}</span>`);
    return;
  }
  const names = [...data.plugins.map((p) => p.name), ...data.missing.map((p) => p.name)];
  if (!names.includes(chosen)) chosen = [...data.plugins].filter((p) => !p.self).sort((a, b) => a.name.localeCompare(b.name))[0]?.name || names[0] || null;
  put($('#pg-stats'), stats());
  draw($('#pg-filters'), FILTERS.map(([v, n]) => html`<button class="chip" data-filter="${v}" data-key="f${v}" aria-pressed="${v === filter}">${n}</button>`));
  draw($('#pg-list'), list());
  put($('#pg-detail'), detail());
  gate($('#view-plugins'));
}
// typing must not rebuild the box that is typed in
function marks(plugin, o, raw) {
  const draft = draftOf(plugin.name);
  const row = $(`#pg-detail [data-row="${o.name}"]`);
  row.classList.toggle('changed', draft.has(o.name));
  const error = row.querySelector('.opterr');
  if (error) {
    const wrong = draft.has(o.name) ? problem(o, raw) : '';
    error.textContent = wrong;
    row.querySelector('[data-opt]').setAttribute('aria-invalid', !!wrong);
  }
  const bar = $('#pg-detail .savebar');
  bar.classList.toggle('on', draft.size > 0);
  $('#pg-count').textContent = draft.size ? plural(draft.size, 'unsaved change') : t('No unsaved changes');
  bar.querySelectorAll('button').forEach((b) => { b.disabled = !draft.size; });
  draw($('#pg-list'), list());
}
const load = async (fresh) => {
  data = fresh || (await api('/api/plugins'));
  render();
};

function save(plugin) {
  const options = {};
  for (const [name, raw] of draftOf(plugin.name)) {
    const o = plugin.options.find((x) => x.name === name);
    const wrong = problem(o, raw);
    if (wrong) {
      toast(`${pretty(name)}: ${wrong}`, true);
      $(`#pg-detail [data-opt="${name}"]`)?.focus();
      return;
    }
    // only what changed is written, so defaults stay out of config.json
    options[name] = read(o, raw);
  }
  ask({ title: t('Save {name} settings?', { name: plugin.name }), text: t('Changed: {list}. Takes effect after SquadJS restarts.', { list: Object.keys(options).join(', ') }), fields: confirmField(), ok: t('Save'), run: async (v) => {
    const fresh = await api('/api/plugins', { index: plugin.index, name: plugin.name, options, confirmPassword: v.confirmPassword });
    drafts.delete(plugin.name);
    await load(fresh);
  } });
}

export default {
  id: 'plugins',
  title: t('Plugins'),
  shell: () => html`<div class="tile kpis five" id="pg-stats"></div>
    <div class="navsplit wide-list">
      <div class="stackcol listcol"><label class="sr" for="pg-q">${t('Search plugins')}</label><input id="pg-q" class="field full" type="search" placeholder="${t('Search a plugin')}"><div class="chips small" id="pg-filters" role="group" aria-label="${t('Filter plugins')}"></div><div class="sidelist scrolls" id="pg-list" data-keep-scroll="plugins"></div></div>
      <div class="tile" id="pg-detail"><span class="empty">${t('Loading…')}</span></div>
    </div>`,
  wire(root) {
    root.addEventListener('input', (e) => {
      if (e.target.id === 'pg-q') { if (data) draw($('#pg-list'), list()); return; }
      const el = e.target.closest('[data-opt]');
      if (!el || el.tagName === 'BUTTON') return;
      const p = current();
      const o = p.options.find((x) => x.name === el.dataset.opt);
      setDraft(p, o, el.value);
      marks(p, o, el.value);
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const d = b.dataset;
      const p = current();
      if (d.filter) { filter = d.filter; render(); return; }
      if (d.plugin) {
        chosen = d.plugin;
        render();
        if (window.matchMedia('(max-width:1000px)').matches) $('#pg-detail').scrollIntoView({ block: 'start' });
        return;
      }
      if (d.restart !== undefined) ask({ title: t('Restart SquadJS now?'), text: t('SquadJS stops. It comes back only if a service manager such as pm2 starts it again.'), fields: confirmField(), ok: t('Restart'), danger: true, run: (v) => api('/api/restart', { confirmPassword: v.confirmPassword }) });
      else if (d.add) ask({ title: t('Add {name} to config.json?', { name: d.add }), text: t('It is added switched off. A copy of the old file is kept as config.json.bak.'), fields: confirmField(), ok: t('Add'), run: async (v) => load(await api('/api/plugins', { op: 'add', name: d.add, confirmPassword: v.confirmPassword })) });
      else if (d.opt) {
        const on = b.getAttribute('aria-checked') !== 'true';
        setDraft(p, p.options.find((o) => o.name === d.opt), on);
        render();
      } else if (d.default) {
        const o = p.options.find((x) => x.name === d.default);
        setDraft(p, o, o.kind === 'boolean' ? !!o.default : asText(o, o.default));
        render();
      } else if (d.undo !== undefined) { drafts.delete(p.name); render(); }
      else if (d.save !== undefined) save(p);
      else if (d.power !== undefined) {
        const enabled = !p.enabled;
        ask({ title: enabled ? t('Switch {name} on?', { name: p.name }) : t('Switch {name} off?', { name: p.name }), text: t('Takes effect after SquadJS restarts.'), fields: confirmField(), ok: enabled ? t('Switch on') : t('Switch off'), run: async (v) => load(await api('/api/plugins', { index: p.index, name: p.name, enabled, confirmPassword: v.confirmPassword })) });
      }
    });
  },
  open: guard(load),
  render() {},
  log() {},
  reload() {},
  reset() { data = null; chosen = null; filter = 'all'; drafts.clear(); }
};
