// Smart Shuffle in two tabs: what is done during a match, and the settings, one group at a time.
import { $, S, api, ask, draw, gate, guard, html, may, plural, post, put, shuffleCommand } from '../core.js';

const PROJECT = 'https://github.com/Miabeyefendi/Squad-SmartShuffle';
let sh = null; // what the server says about Smart Shuffle
const edits = new Map();
let tab = 'control';
let group = null;
let statusSeen = null;
let previewText = '';

const promo = () => html`<a class="promo" href="${sh?.project || PROJECT}" target="_blank" rel="noopener noreferrer">Smart Shuffle by Miabeyefendi</a>`;
const status = () => S.state.shuffleStatus || (S.state.shuffle ? 'on' : 'missing');
const missing = () => ['missing', 'error'].includes(status());
const fields = () => sh.groups.flatMap((g) => g.fields);
const field = (name) => fields().find((f) => f.name === name);
const editable = () => may('shuffle.settings') && sh && sh.status !== 'external' && !missing();

const SWITCHES = [
  ['auto', 'Shuffle automatically', 'Decides at the end of each round whether the teams need a shuffle.', 'auto on', 'auto off'],
  ['locking', 'Team lock', 'Players cannot change teams while it is locked.', 'lock 1', 'lock 0'],
  ['friends', 'Keep parties together', 'Friends who play together stay on the same team.', 'friends on', 'friends off'],
  ['history', 'Match history', 'Uses earlier matches to rate players.', 'history on', 'history off'],
  ['tokens', 'Switch tokens', 'Limits how often a player may switch teams.', 'tokens on', 'tokens off']
];

function statusTile() {
  const s = S.state.shuffle;
  return html`<div class="stack2 grow"><span class="cap">Smart Shuffle</span><span class="layer">${s ? (s.pending ? 'Shuffle at round end' : s.auto ? 'Automatic' : 'On, manual') : 'Switched off'}</span><span class="xs">${s ? `${s.lockedNow ? 'Teams are locked' : 'Teams are open'}${s.last ? ` · last shuffle moved ${s.last.moved}` : ''}` : 'Nothing is shuffled while it is off.'}</span><span class="xs">${promo()}</span></div>
    ${editable() ? html`<button class="btn" data-power>${sh.status === 'off' ? 'Switch Smart Shuffle on' : 'Switch Smart Shuffle off'}</button>` : ''}`;
}
function control() {
  const s = S.state.shuffle;
  if (!s) return '';
  const can = may('shuffle.switches');
  return html`<div class="stackcol">
      <div class="tile roundbar" ${may('shuffle.round') ? '' : html`hidden`}><div class="stack2"><h2>This round</h2><span class="sub xs">Only the match that is running.</span></div>
        <div class="roundacts"><button class="btn pri tall" data-round="now">Shuffle at round end</button><button class="btn tall" data-round="cancel">Cancel shuffle</button><button class="btn tall" data-round="preview">Preview shuffle</button><button class="btn tall" data-round="unlock">Unlock teams</button></div>
        ${previewText ? html`<p class="preview-text">${previewText}</p>` : ''}</div>
      <div class="tile"><h2>Switches</h2><div>${SWITCHES.map(([key, name, help, on, off]) => html`<div class="set"><span class="lbl"><b>${name}</b><span class="sub xs">${help}</span></span><button class="sw" role="switch" aria-checked="${!!s[key]}" aria-label="${name}" data-switch="${s[key] ? off : on}" data-key="${key}" ${can ? '' : html`disabled`}></button></div>`)}</div></div>
    </div>`;
}
function presets() {
  if (!editable() || !sh.presets.length) return '';
  const meter = (label, n) => html`<span class="meter"><span class="sub xs">${label}</span><b class="mono">${n}%</b><span class="bar"><i style="width:${Math.min(100, Number(n) || 0)}%"></i></span></span>`;
  return html`<div class="stack2"><h2>Presets</h2><span class="sub xs">Measured in a simulation. Fewer lopsided matches costs more moved players. Applying one resets every setting first.</span></div>
    <div class="presets">${sh.presets.map((p) => html`<article class="presetcard"><h3>${p.name}</h3>${meter('Lopsided matches', p.stomped)}${meter('Players moved', p.moved)}${meter('Parties kept', p.kept)}<button class="btn" data-preset="${p.id}">Apply</button></article>`)}</div>`;
}

function input(f) {
  const value = edits.has(f.name) ? edits.get(f.name) : f.value;
  if (f.kind === 'boolean') return html`<button type="button" class="sw" role="switch" aria-checked="${!!value}" aria-label="${f.label}" data-sf="${f.name}"></button>`;
  if (f.secret) return html`<input class="field" type="password" autocomplete="new-password" aria-label="${f.label}" data-sf="${f.name}" placeholder="${f.set ? 'saved, type to replace' : 'not set'}" value="${edits.get(f.name) || ''}">`;
  const text = f.kind === 'list' ? [].concat(value || []).join(', ') : value;
  return html`<input class="field ${f.kind === 'number' ? 'mono short' : ''}" ${f.kind === 'number' ? html`type="number" step="any" min="0"` : ''} aria-label="${f.label}" data-sf="${f.name}" value="${text}">`;
}
function settings() {
  if (!sh) return html`<span class="empty">Loading…</span>`;
  if (sh.status === 'external') return html`<div class="tile"><h2>Settings</h2><span class="sub">This server runs Smart Shuffle from its own line in config.json, so its settings are changed on the Plugins page. Remove that line and restart SquadJS to change everything here, with no more restarts.</span></div>`;
  if (!may('shuffle.settings')) return html`<div class="tile"><h2>Settings</h2><span class="sub">You do not have permission to change Smart Shuffle settings.</span></div>`;
  if (!sh.groups.some((g) => g.title === group)) group = sh.groups[0]?.title;
  const current = sh.groups.find((g) => g.title === group);
  const changed = (g) => g.fields.filter((f) => edits.has(f.name)).length;
  return html`<div class="savebar ${edits.size ? 'on' : ''}"><span class="grow">${edits.size ? html`<b>${plural(edits.size, 'unsaved change')}</b>` : html`<span class="sub">Settings apply at once when saved. No restart, and nothing is written to config.json.</span>`}</span><button class="btn" data-undo ${edits.size ? '' : html`disabled`}>Undo</button><button class="btn pri" data-save ${edits.size ? '' : html`disabled`}>Save and apply</button></div>
    <div class="navsplit">
      <div class="sidelist" role="tablist" aria-label="Setting groups">${sh.groups.map((g) => html`<button role="tab" class="sideitem" data-group="${g.title}" data-key="${g.title}" aria-selected="${g.title === group}"><span class="grow">${g.title}</span>${changed(g) ? html`<span class="tag solid mini">${changed(g)}</span>` : html`<span class="sub xs">${g.fields.length}</span>`}</button>`)}</div>
      <div class="tile"><h2>${current.title}</h2><div>${current.fields.map((f) => html`<div class="optrow ${f.kind === 'list' || f.kind === 'string' || f.secret ? 'wide' : ''} ${edits.has(f.name) ? 'changed' : ''}"><div class="optlabel"><b>${f.label}</b><span class="sub xs">${f.help}</span></div><div class="optctl">${input(f)}</div></div>`)}</div></div>
    </div>`;
}
// the list keeps its boxes while one is typed in: only the marks around them change
function dirty() {
  const root = $('#view-shuffle');
  const bar = root.querySelector('.savebar');
  bar.classList.toggle('on', edits.size > 0);
  put(bar.firstElementChild, edits.size ? html`<b>${plural(edits.size, 'unsaved change')}</b>` : html`<span class="sub">No unsaved changes.</span>`);
  bar.querySelectorAll('button').forEach((b) => { b.disabled = !edits.size; });
  root.querySelectorAll('[data-sf]').forEach((el) => el.closest('.optrow').classList.toggle('changed', edits.has(el.dataset.sf)));
}
function noteEdit(name, value) {
  const f = field(name);
  const same = f.secret ? !value : JSON.stringify(value) === JSON.stringify(f.value);
  if (same) edits.delete(name);
  else edits.set(name, value);
}
function typed(el) {
  const f = field(el.dataset.sf);
  if (f.kind === 'number') return el.value === '' ? f.value : Number(el.value);
  if (f.kind !== 'list') return el.value;
  const numbers = f.value.every((v) => typeof v === 'number');
  return el.value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (numbers && !Number.isNaN(Number(x)) ? Number(x) : x));
}

const load = async (data) => {
  sh = data || (await api('/api/shuffle'));
  edits.clear();
  page.render();
  redrawSettings();
};
const redrawSettings = () => put($('#sh-settings'), settings());
const change = async (body) => load(await api('/api/shuffle', body));

const page = {
  id: 'shuffle',
  title: 'Smart Shuffle',
  shell: () => html`<div class="tile warnbox" id="sh-missing" hidden></div>
    <div class="tile inv statusrow" id="sh-status"></div>
    <div class="seg" role="tablist" aria-label="Smart Shuffle" id="sh-tabs"><button role="tab" data-tab="control" aria-selected="true">Control</button><button role="tab" data-tab="settings" aria-selected="false">Settings</button></div>
    <div class="stackcol" id="sh-control"><div id="sh-round"></div><div class="tile" id="sh-presets"></div></div>
    <div class="stackcol" id="sh-settings" hidden></div>`,
  wire(root) {
    root.addEventListener('click', guard(async (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const d = b.dataset;
      if (d.tab) {
        tab = d.tab;
        page.render();
        if (tab === 'settings') redrawSettings();
      } else if (d.round === 'preview') {
        previewText = 'Working…';
        page.render();
        previewText = (await post('shuffle', { command: 'preview' })).text;
        page.render();
      } else if (d.round) shuffleCommand(d.round);
      else if (d.switch) shuffleCommand(d.switch);
      else if (d.preset) {
        const p = sh.presets.find((x) => x.id === d.preset);
        ask({ title: `Apply the ${p.name} preset?`, text: 'Every setting goes back to its default, then the preset is applied. A saved MySquadStats token is kept.', ok: 'Apply preset', run: () => change({ op: 'preset', id: p.id }) });
      } else if (d.power !== undefined) {
        const on = sh.status === 'off';
        ask({ title: on ? 'Switch Smart Shuffle on?' : 'Switch Smart Shuffle off?', text: on ? '' : 'No shuffle, no team lock and no chat commands until it is switched on again.', ok: on ? 'Switch on' : 'Switch off', run: () => change({ op: 'enabled', on }) });
      } else if (d.group) {
        group = d.group;
        redrawSettings();
      } else if (d.sf) {
        const on = b.getAttribute('aria-checked') !== 'true';
        b.setAttribute('aria-checked', on);
        noteEdit(d.sf, on);
        dirty();
      } else if (d.undo !== undefined) { edits.clear(); redrawSettings(); }
      else if (d.save !== undefined) {
        const names = [...edits.keys()].map((n) => field(n).label);
        ask({ title: 'Save Smart Shuffle settings?', text: names.join(' · '), ok: 'Save and apply', run: () => change({ op: 'settings', changes: Object.fromEntries(edits) }) });
      }
    }));
    root.addEventListener('input', (e) => {
      const el = e.target.closest('input[data-sf]');
      if (!el) return;
      noteEdit(el.dataset.sf, typed(el));
      dirty();
    });
  },
  open: guard(async () => {
    previewText = '';
    page.render();
    await load();
  }),
  render() {
    if (!S.state) return;
    const now = status();
    // it was installed, removed or switched while this page was open
    if (statusSeen !== now) {
      const first = statusSeen === null;
      statusSeen = now;
      if (!first && S.view === 'shuffle') guard(load)();
    }
    const gone = missing();
    $('#sh-missing').hidden = !gone;
    $('#sh-status').hidden = gone;
    $('#sh-tabs').hidden = gone;
    $('#sh-control').hidden = gone || tab !== 'control';
    $('#sh-settings').hidden = gone || tab !== 'settings';
    document.querySelectorAll('#sh-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
    if (gone) {
      draw($('#sh-missing'), html`<h2>Smart Shuffle is not installed</h2><span class="sub">${now === 'error' && sh?.error ? sh.error : 'The smart-shuffle folder of the admin panel is missing. Everything else works. Copy the folder back and restart SquadJS to get it again.'}</span><span>${promo()}</span>`);
      return;
    }
    draw($('#sh-status'), statusTile());
    draw($('#sh-round'), control());
    const cards = presets();
    $('#sh-presets').hidden = !cards;
    draw($('#sh-presets'), cards);
    gate($('#view-shuffle'));
  },
  log() {},
  reload() {},
  reset() { sh = null; edits.clear(); tab = 'control'; group = null; statusSeen = null; previewText = ''; }
};
export default page;
