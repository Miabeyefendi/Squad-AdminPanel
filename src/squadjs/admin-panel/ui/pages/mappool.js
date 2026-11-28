// Smart Map Pool: the vote pools on the left, the chosen one on the right. One pool is in use at a
// time, because the game reads fixed file names; the seeding list goes on top of it.
import { $, $$, api, ask, confirmField, guard, html, may, put, stamp, t } from '../core.js';

let data = null;
let chosen = null; // the pool shown on the right
let week = 0; // the week of it that is shown

const pool = (id) => data.pools.find((p) => p.id === id);
const mainId = () => data.active?.main?.id || null;
const seedId = () => data.active?.seed || null;
const inUse = (p) => p.id === mainId() || p.id === seedId();
const spaced = (name) => name.replace(/([a-z])([A-Z])/g, '$1 $2');

// "AlBasrah_RAAS_v1" lines of one file, gathered by map
function byMap(layers) {
  const maps = new Map();
  for (const id of layers) {
    const [map, ...rest] = id.split('_');
    if (!maps.has(map)) maps.set(map, []);
    maps.get(map).push(rest.join(' '));
  }
  return [...maps];
}

function statusBar() {
  const main = mainId() && pool(mainId());
  const state = data.active.main;
  const warn = [];
  if (data.voteMode && !data.voteMode.ok) warn.push(t('Server.cfg needs MapRotationMode=LayerList_Vote and UseVoteLayer=true, or the vote lists are not used. The panel does not change Server.cfg.'));
  if (data.active.edited.length) warn.push(t('Changed by hand since the panel wrote them: {files}', { files: data.active.edited.join(', ') }));
  if (state?.stopped) warn.push(`${t('The weekly change stopped:')} ${t(state.stopped)}`);
  return html`<span class="cap">${t('In use')}</span>
    <b>${main ? main.name : t('Your own files')}</b>
    ${main && main.weeks.length > 1 ? html`<span class="pill">${t('Week {n} of {total}', { n: state.week + 1, total: main.weeks.length })}</span><span class="sub xs">${state.auto ? t('Next week: {time}', { time: stamp(state.nextAt) }) : t('The weekly change is off')}</span>` : ''}
    ${seedId() ? html`<span class="pill">+ ${pool(seedId())?.name}</span>` : ''}
    <span class="grow"></span>
    ${may('mappool.manage') && (mainId() || seedId()) ? html`<button class="btn" data-restore>${t('Put my own files back')}</button>` : ''}
    ${warn.map((w) => html`<span class="tag warnish wrapany poolwarn" role="alert">${w}</span>`)}`;
}

function sideList() {
  put($('#mp-list'), data.groups.map(([title, ids]) => html`<span class="cap listhead">${t(title)}</span>${ids.map(pool).filter(Boolean).map((p) => html`<button type="button" role="tab" class="sideitem" data-pick="${p.id}" aria-selected="${p.id === chosen}"><span class="dot ${inUse(p) ? 'on' : ''}" aria-hidden="true"></span><span class="grow">${p.name}</span>${inUse(p) ? html`<span class="sub xs">${t('In use')}</span>` : ''}</button>`)}`));
}

// lower is better for the first two: the popular maps come back less often
const figure = (label, value, base, unit = '%') => html`<div class="meter"><span class="sub xs">${label}</span><b class="mono">${value}${unit}</b><span class="sub xs">${t('Default server: {value}', { value: `${base}${unit}` })}</span></div>`;

function weekControls(p) {
  const state = data.active.main;
  const mine = p.id === mainId();
  const local = (at) => new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return html`<div class="stack8"><div class="line" role="tablist" aria-label="${t('Week')}"><span class="chips">${p.weeks.map((_, i) => html`<button type="button" role="tab" class="chip" data-week="${i}" aria-selected="${i === week}" aria-pressed="${i === week}">${t('Week {n}', { n: i + 1 })}${mine && state.week === i ? html`<span class="dot on" title="${t('In use')}"></span>` : ''}</button>`)}</span>
      ${mine && may('mappool.manage') && state.week !== week ? html`<button type="button" class="btn small" data-useweek="${week}">${t('Switch to week {n} now', { n: week + 1 })}</button>` : ''}</div>
    ${mine && may('mappool.manage') ? html`<form class="line poolauto" data-auto><label class="tick"><input type="checkbox" name="on" ${state.auto ? html`checked` : ''}>${t('Change the week by itself, every 7 days')}</label>
      <label class="line nowrap"><span class="sub xs">${t('Next change')}</span><input class="field" type="datetime-local" name="nextAt" value="${local(state.nextAt || Date.now() + 7 * 86400000)}"></label><button class="btn">${t('Save')}</button></form>` : html`<span class="sub xs">${t('A weekly pool: the panel can change the week by itself while SquadJS runs.')}</span>`}</div>`;
}

function detail() {
  const p = pool(chosen);
  if (!p) return html``;
  const manage = may('mappool.manage') && data.status === 'ready';
  const files = p.weeks[Math.min(week, p.weeks.length - 1)];
  const action = !manage ? '' : p.id === seedId() ? html`<button type="button" class="btn tall" data-unseed>${t('Remove the seeding list')}</button>`
    : p.id === mainId() ? html`<span class="tag solid">${t('In use')}</span>`
      : html`<button type="button" class="btn pri tall" data-apply="${p.id}">${p.seed ? t('Add this seeding list') : t('Use this pool')}</button>`;
  return html`<div class="tile"><div class="rulehead"><div class="stack2 grow"><h2>${p.name}</h2><span class="sub">${t(p.what, { n: p.n })}</span></div>${action}</div>
    ${p.seed ? html`<span class="sub xs">${t('Used while the player count is low. It goes on top of the pool in use and changes no vote rules.')}</span>` : html`<div class="meters poolmeters">${figure(t('Narva, Mutaha, Fallujah: share of rounds'), p.sim.top3, data.baseline.top3)}${figure(t('One of them again within 3 rounds'), p.sim.top3In3, data.baseline.top3In3)}${figure(t('Different maps per day'), p.sim.mapsDay, data.baseline.mapsDay, '')}</div><span class="sub xs">${t('These numbers come from a simulation, not from a live server.')}</span>`}
    ${p.unknown.length ? html`<span class="tag warnish wrapany">${t("Not in this server's layer list: {layers}", { layers: p.unknown.join(', ') })}</span>` : ''}
    ${p.weeks.length > 1 ? weekControls(p) : ''}</div>
    ${files.map((f) => html`<div class="tile"><div class="th"><h3 class="mono">${f.name}</h3><span class="sub xs">${t('{n} layers', { n: f.layers.length })}</span></div>
      <div class="poolmaps">${byMap(f.layers).map(([map, layers]) => html`<div class="poolmap"><b>${spaced(map)}</b><span class="sub xs">${layers.join(', ')}</span></div>`)}</div></div>`)}
    ${Object.keys(p.vote).length ? html`<div class="tile"><div class="stack2"><h3>${t('Lines set in VoteConfig.cfg')}</h3><span class="sub xs">${t('Every other line stays as it is.')}${p.vote.NightTime ? ` ${t('NightTime is an example: set it to your own busy hours.')}` : ''}</span></div><div class="chips">${Object.entries(p.vote).map(([k, v]) => html`<code class="poolline">${k}=${v}</code>`)}</div></div>` : ''}`;
}

// Author: Miabeyefendi
function notice() {
  if (data.status === 'missing') return html`<div class="tile"><p class="empty">${t('Smart Map Pool is not installed: the map-pool folder is missing.')}</p></div>`;
  if (data.status !== 'nofolder') return html``;
  return html`<div class="tile warnbox"><h3>${t('The ServerConfig folder of the game server was not found')}</h3>
    <span class="sub">${t('The panel can show the pools, but not put one in use. It has to reach the folder itself: add this to the AdminPanel line of config.json and restart SquadJS. A rented server that SquadJS reads over FTP or SFTP is not supported yet.')}</span>
    <code class="poolline">"serverConfigDir": "C:/SquadServer/SquadGame/ServerConfig"</code></div>`;
}

function render() {
  if (!data) return;
  put($('#mp-notice'), notice());
  const there = data.status !== 'missing';
  $('#mp-main').hidden = !there;
  $('#mp-status').hidden = data.status !== 'ready';
  if (!there) return;
  if (!pool(chosen)) { chosen = mainId() || data.groups[0][1][0]; week = chosen === mainId() ? data.active.main.week : 0; }
  if (data.status === 'ready') put($('#mp-status'), statusBar());
  sideList();
  put($('#mp-detail'), detail());
}

const load = async () => {
  data = await api('/api/mappool');
  render();
};

// every change asks for the account password; files changed by hand are only written over when told so
function change(title, text, body, ok) {
  const edited = data.active.edited.length;
  ask({ title, ok, danger: !!edited,
    text: edited ? `${t('Changed by hand since the panel wrote them: {files}', { files: data.active.edited.join(', ') })}. ${t('They are written over. A copy is kept in the data folder.')} ${text}` : text,
    fields: confirmField(),
    run: async (v) => {
      data = await api('/api/mappool', { ...body, force: !!edited, confirmPassword: v.confirmPassword });
      render();
    } });
}
const restartNote = () => t('Squad may read these files only when the game server starts. This has not been tried on a live server: restart it to be sure.');

export default {
  id: 'mappool',
  title: 'Smart Map Pool',
  shell: () => html`<div id="mp-notice"></div><div class="tile statusrow" id="mp-status" hidden></div>
    <div class="navsplit wide-list" id="mp-main"><div class="stackcol listcol"><div class="sidelist scrolls" id="mp-list" role="tablist" aria-label="Smart Map Pool" data-keep-scroll="pools"><span class="empty">${t('Loading…')}</span></div>
      <p class="sub xs rulehelp"><a class="promo" href="https://github.com/Miabeyefendi/Squad-MapPool" target="_blank" rel="noopener noreferrer">Squad-MapPool</a></p></div>
    <div class="stackcol" id="mp-detail"></div></div>`,
  wire(root) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || !data) return;
      const d = b.dataset;
      if (d.pick) {
        chosen = d.pick;
        week = chosen === mainId() ? data.active.main.week : 0;
        $$('#mp-list [data-pick]').forEach((x) => x.setAttribute('aria-selected', x === b));
        put($('#mp-detail'), detail());
        if (window.matchMedia('(max-width:1000px)').matches) $('#mp-detail').scrollIntoView({ block: 'start' });
      } else if (d.week !== undefined) {
        week = Number(d.week);
        put($('#mp-detail'), detail());
      } else if (d.apply) {
        const p = pool(d.apply);
        const names = [...new Set(p.weeks[0].map((f) => f.name))].concat(Object.keys(p.vote).length ? ['VoteConfig.cfg'] : []).join(', ');
        const other = !p.seed && mainId() ? ` ${t('{name} is no longer used.', { name: pool(mainId()).name })}` : '';
        change(t('Use {name}?', { name: p.name }), `${t('Written on the game server: {files}. What is there now is remembered.', { files: names })}${other} ${restartNote()}`, { op: 'apply', id: p.id }, t('Write the files'));
      } else if (d.restore !== undefined) {
        change(t('Put your own files back?'), `${t('Every file the panel changed gets back what it held before. No pool is in use afterwards.')} ${restartNote()}`, { op: 'restore' }, t('Put back'));
      } else if (d.unseed !== undefined) {
        change(t('Remove the seeding list?'), `${t('The seeding file gets back what it held before.')} ${restartNote()}`, { op: 'removeSeed' }, t('Remove'));
      } else if (d.useweek !== undefined) {
        const n = Number(d.useweek);
        change(t('Switch to week {n} now?', { n: n + 1 }), restartNote(), { op: 'week', week: n }, t('Write the files'));
      }
    });
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      if (form.dataset.auto === undefined) return;
      const on = form.elements.on.checked;
      const nextAt = new Date(form.elements.nextAt.value).getTime();
      ask({ title: t('Save the weekly change?'), fields: confirmField(), ok: t('Save'), run: async (v) => {
        data = await api('/api/mappool', { op: 'auto', on, nextAt: on ? nextAt : null, confirmPassword: v.confirmPassword });
        render();
      } });
    });
  },
  open: guard(load),
  render() {},
  log(entry) { if (entry.kind === 'admin' && entry.action === 'Map pool' && entry.by.startsWith('Auto')) guard(load)(); },
  reload() {},
  reset() { data = null; chosen = null; week = 0; }
};
