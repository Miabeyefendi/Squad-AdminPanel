// Who hit, downed and killed whom, with what, and each player's numbers: for looking into cheaters.
import { $, S, api, downloadCsv, draw, entries, fighter, guard, html, mark, t, teamName } from '../core.js';
import { LOCALE } from '../i18n.js';

const SHOWN = 300;
// a share of one or two downs says nothing, so such players are listed after the others
const ENOUGH = 5;
const SHARES = ['perDown', 'oneHit'];
const EVERY = 2000;
const KINDS = [['main', t('Downs and kills')], ['hits', t('Every hit')], ['tk', t('Teamkills')]];
const NAMES = { hit: t('Hit'), down: t('Downed'), kill: t('Killed') };

const blank = () => ({ match: null, seq: 0, players: [], events: [], previous: false });
const view = { tab: 'feed', which: 'current', kind: 'main', shooter: null };
const sort = { key: 'downs', dir: -1 };
let data = blank();
let timer = null;
let busy = false;
// a redraw between press and release would swallow the click
let held = false;

const second = (at) => new Date(at).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const query = () => $('#kf-q').value.trim().toLowerCase();
const hitsPerDown = (p) => (p.countedDowns ? p.downHits / p.countedDowns : null);
const oneShare = (p) => (p.countedDowns ? p.oneHitDowns / p.countedDowns : null);
const topWeapon = (p) => p.weapons[0]?.name || '';

// [key, head, what it means, width, value, shown]
const COLUMNS = [
  ['kills', 'K', t('Kills'), 52],
  ['downs', t('Down'), t('Enemies downed'), 60],
  ['deaths', 'D', t('Deaths'), 46],
  ['victims', t('Victims'), t('Different enemies downed or killed'), 80],
  ['hits', t('Hits'), t('Hits on enemies'), 60],
  ['perDown', t('Hits / down'), t('Average hits it took to down an enemy'), 104, hitsPerDown, (v) => v.toFixed(1)],
  ['oneHit', t('1-hit downs'), t('Downs that took a single hit'), 110, oneShare, (v, p) => `${Math.round(v * 100)}% (${p.oneHitDowns}/${p.countedDowns})`],
  ['maxHit', t('Top hit'), t('Highest damage of one hit'), 78],
  ['bestMinute', t('In 60 s'), t('Most enemies downed within 60 seconds'), 74],
  ['teamkills', 'TK', t('Teamkills'), 44]
];
const valueOf = (p, key) => {
  if (key === 'name') return String(p.name || '').toLowerCase();
  const column = COLUMNS.find(([k]) => k === key);
  return column[4] ? column[4](p) ?? -1 : p[key];
};
const cellOf = (p, [key, , , , value, shown]) => {
  if (!value) return p[key];
  const v = value(p);
  return v === null ? '-' : shown(v, p);
};

const shooters = () => {
  const q = query();
  // someone who only died has nothing to look into
  return data.players.filter((p) => (p.hits || p.downs || p.kills || p.teamkills)
    && (!q || String(p.name).toLowerCase().includes(q) || p.id.includes(q) || p.weapons.some((w) => w.name.toLowerCase().includes(q))))
    .sort((a, b) => {
      const few = (p) => (SHARES.includes(sort.key) && p.countedDowns < ENOUGH ? 1 : 0);
      if (few(a) !== few(b)) return few(a) - few(b);
      const [x, y] = [valueOf(a, sort.key), valueOf(b, sort.key)];
      return x > y ? sort.dir : x < y ? -sort.dir : String(a.name).localeCompare(String(b.name));
    });
};

const feed = () => {
  const q = query();
  const wanted = (e) => (view.kind === 'tk' ? e.tk && e.type !== 'hit' : view.kind === 'hits' || e.type !== 'hit');
  const found = (e) => !q || [e.a.name, e.v.name, e.weapon, e.a.id, e.v.id].some((v) => String(v || '').toLowerCase().includes(q));
  const out = [];
  for (let i = data.events.length - 1; i >= 0; i--) {
    const e = data.events[i];
    if (wanted(e) && found(e) && (!view.shooter || e.a.id === view.shooter)) out.push(e);
  }
  return out;
};

const who = (x) => fighter(x.id, x.name || t('Unknown'), x.team, x.squad);
const kindTag = (e) => html`<span class="line nowrap"><span class="tag ${e.type === 'kill' ? 'solid' : ''}">${NAMES[e.type]}</span>${e.tk ? html`<span class="tag tkmark">TK</span>` : ''}</span>`;

function feedTable() {
  const rows = feed();
  if (!rows.length) return html`<span class="empty">${data.events.length ? t('No entries with this filter.') : t('No fights recorded yet. They come from the server log while the panel runs.')}</span>`;
  return html`<div class="tbox" data-keep-scroll="kf"><table class="logtable kftable"><colgroup><col style="width:104px"><col><col style="width:150px"><col><col style="width:24%"><col style="width:80px"><col style="width:96px"></colgroup>
    <thead><tr><th>${t('Time')}</th><th>${t('Attacker')}</th><th>${t('Event')}</th><th>${t('Victim')}</th><th>${t('Weapon')}</th><th class="n">${t('Damage')}</th><th class="n" title="${t('Hits this attacker needed to down the victim')}">${t('Hits')}</th></tr></thead>
    <tbody>${rows.slice(0, SHOWN).map((e) => html`<tr class="${e.tk ? 'tkrow' : ''}" data-shooter="${e.a.id}"><td class="mono sub">${second(e.at)}</td><td>${who(e.a)}</td><td>${kindTag(e)}</td><td>${who(e.v)}</td><td class="wrapany" title="${e.raw}">${e.weapon || '-'}</td><td class="n">${e.damage ?? ''}</td><td class="n ${e.hits === 1 ? 'one' : ''}">${e.type === 'down' ? e.hits ?? '-' : ''}</td></tr>`)}</tbody></table></div>
    ${rows.length > SHOWN ? html`<p class="foot">${t('The newest {shown} of {total} are shown. The CSV file has them all.', { shown: SHOWN, total: rows.length })}</p>` : ''}`;
}

function playerTable() {
  const rows = shooters();
  if (!rows.length) return html`<span class="empty">${data.players.length ? t('No entries with this filter.') : t('No fights recorded yet. They come from the server log while the panel runs.')}</span>`;
  const head = (key, label, title, cls) => html`<th class="${cls}" ${sort.key === key ? html`aria-sort="${sort.dir < 0 ? 'descending' : 'ascending'}"` : ''}><button data-sort="${key}" data-key="s${key}" title="${SHARES.includes(key) ? `${title}. ${t('Fewer than 5 downs sort last')}` : title}">${label}<span class="arrow">${sort.key === key ? (sort.dir < 0 ? '↓' : '↑') : ''}</span></button></th>`;
  return html`<div class="tbox" data-keep-scroll="kf"><table class="sbt kfplayers"><colgroup><col>${COLUMNS.map(([, , , w]) => html`<col style="width:${w}px">`)}<col style="width:18%"></colgroup>
    <thead><tr>${head('name', t('Player'), t('Name'), '')}${COLUMNS.map(([k, n, meaning]) => head(k, n, meaning, 'n'))}<th>${t('Main weapon')}</th></tr></thead>
    <tbody>${rows.map((p) => html`<tr data-shooter="${p.id}" class="${view.shooter === p.id ? 'sel' : ''}"><td class="who">${who(p)}</td>${COLUMNS.map((c) => html`<td class="n ${c[0] === 'teamkills' && p.teamkills ? 'hot' : ''}">${cellOf(p, c)}</td>`)}<td title="${topWeapon(p)}">${topWeapon(p) || '-'}</td></tr>`)}</tbody></table></div>`;
}

function shooterCard() {
  const p = data.players.find((x) => x.id === view.shooter);
  if (!p) return html``;
  const figure = (key) => {
    const column = COLUMNS.find(([k]) => k === key);
    return html`<div class="kffig" title="${column[2]}"><span class="cap">${column[1]}</span><span class="kpiv">${cellOf(p, column)}</span></div>`;
  };
  return html`<div class="th"><span class="line">${mark(p.team)}${who(p)}<span class="sub xs">${t('Team {n}', { n: p.team })} · ${teamName(p.team)}</span></span><span class="line"><button class="btn small" data-player="${p.id}">${t('Player card')}</button><button class="btn small ghost" data-close>${t('Show everyone')}</button></span></div>
    <div class="kffigs">${COLUMNS.map(([k]) => figure(k))}</div>
    <div class="tbox"><table class="logtable"><thead><tr><th>${t('Weapon')}</th><th class="n">${t('Hits')}</th><th class="n">${t('Down')}</th><th class="n">${t('Kills')}</th><th class="n">${t('Damage')}</th><th class="n">${t('Average hit')}</th></tr></thead>
    <tbody>${p.weapons.map((w) => html`<tr><td class="wrapany">${w.name || '-'}</td><td class="n">${w.hits}</td><td class="n">${w.downs}</td><td class="n">${w.kills}</td><td class="n">${w.damage}</td><td class="n">${w.hits ? Math.round(w.damage / w.hits) : '-'}</td></tr>`)}</tbody></table></div>`;
}

function show() {
  if (held) return;
  const pressed = (list, current, attr) => list.map(([v, n]) => html`<button role="tab" ${attr === 'tab' ? html`data-tab="${v}"` : html`data-kind="${v}"`} data-key="${attr}${v}" aria-selected="${v === current}">${n}</button>`);
  draw($('#kf-tabs'), pressed([['feed', t('Feed')], ['players', t('Players')]], view.tab, 'tab'));
  draw($('#kf-kinds'), pressed(KINDS, view.kind, 'kind'));
  $('#kf-kinds').hidden = view.tab !== 'feed';
  const card = shooterCard();
  draw($('#kf-shooter'), card);
  $('#kf-shooter').hidden = !data.players.some((x) => x.id === view.shooter);
  draw($('#kf-list'), view.tab === 'feed' ? feedTable() : playerTable());
  $('#kf-count').textContent = view.tab === 'feed' ? entries(feed().length) : t('{n} players', { n: shooters().length });
  $('#kf-match option[value="previous"]').disabled = !data.previous && view.which !== 'previous';
}

// reads only what is new; a new match or another one starts from nothing
async function load() {
  if (busy) return;
  busy = true;
  const asked = view.which;
  try {
    const next = await api(`/api/combat?which=${asked}&match=${data.match || ''}&after=${data.seq}`);
    if (asked !== view.which || !S.me) return;
    if (next.match !== data.match) {
      data = next;
    } else {
      data = { ...next, events: [...data.events, ...next.events].slice(-10000) };
    }
    show();
  } finally {
    busy = false;
  }
}
const stop = () => { clearInterval(timer); timer = null; };

function csv() {
  if (view.tab === 'feed') {
    downloadCsv('squad-killfeed.csv', [['Time', 'Event', 'Teamkill', 'Attacker', 'Attacker ID', 'Attacker team', 'Attacker squad', 'Victim', 'Victim ID', 'Victim team', 'Victim squad', 'Weapon', 'Damage', 'Hits'],
      ...feed().map((e) => [new Date(e.at).toISOString(), e.type, e.tk ? 'yes' : '', e.a.name, e.a.id, e.a.team, e.a.squad, e.v.name, e.v.id, e.v.team, e.v.squad, e.raw, e.damage, e.hits])]);
  } else {
    downloadCsv('squad-killfeed-players.csv', [['Player', 'ID', 'Team', ...COLUMNS.map(([k]) => k), 'Main weapon'],
      ...shooters().map((p) => [p.name, p.id, p.team, ...COLUMNS.map((c) => cellOf(p, c)), topWeapon(p)])]);
  }
}

export default {
  id: 'killfeed',
  title: t('Kill Feed'),
  shell: () => html`<div class="tile filters"><div class="seg" role="tablist" aria-label="${t('View')}" id="kf-tabs"></div>
      <label class="sr" for="kf-match">${t('Match')}</label><select class="field" id="kf-match"><option value="current">${t('This match')}</option><option value="previous">${t('Last match')}</option></select>
      <div class="seg" role="tablist" aria-label="${t('Event')}" id="kf-kinds"></div>
      <label class="sr" for="kf-q">${t('Filter')}</label><input id="kf-q" class="field search" type="search" placeholder="${t('Player or weapon')}">
      <span class="sub xs" id="kf-count"></span><button class="btn" data-csv>${t('Export CSV')}</button></div>
    <div class="tile" id="kf-shooter" hidden></div>
    <div class="tile" id="kf-list"></div>
    <p class="foot">${t('The server log has every hit, but no shots fired or missed, no hit place and no distance, so accuracy cannot be shown. These numbers are clues, not proof: check a recording before you ban.')}</p>`,
  wire(root) {
    root.addEventListener('pointerdown', () => { held = true; });
    for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => { held = false; });
    root.addEventListener('click', guard(async (e) => {
      held = false;
      const b = e.target.closest('button');
      if (b?.dataset.tab) view.tab = b.dataset.tab;
      else if (b?.dataset.kind) view.kind = b.dataset.kind;
      else if (b?.dataset.sort) {
        sort.dir = sort.key === b.dataset.sort ? -sort.dir : b.dataset.sort === 'name' || b.dataset.sort === 'perDown' ? 1 : -1;
        sort.key = b.dataset.sort;
      } else if (b?.dataset.close !== undefined) view.shooter = null;
      else if (b?.dataset.csv !== undefined) { csv(); return; }
      else {
        // a name opens the player card; the rest of the row shows that attacker's fights
        const row = e.target.closest('[data-shooter]');
        if (!row || e.target.closest('[data-player]')) return;
        view.shooter = row.dataset.shooter;
        view.tab = 'feed';
        window.scrollTo(0, 0);
      }
      show();
    }));
    root.addEventListener('change', guard(async (e) => {
      if (e.target.id !== 'kf-match') return;
      view.which = e.target.value;
      view.shooter = null;
      data = { ...blank(), previous: data.previous };
      show();
      await load();
    }));
    root.addEventListener('input', (e) => { if (e.target.id === 'kf-q') show(); });
  },
  open() {
    $('#kf-match').value = view.which;
    held = false;
    show();
    guard(load)();
    stop();
    timer = setInterval(() => {
      if (S.view !== 'killfeed' || !S.me) stop();
      else if (!document.hidden) load().catch(() => {});
    }, EVERY);
  },
  render() {},
  log() {},
  reload() { data = blank(); guard(load)(); },
  reset() {
    stop();
    data = blank();
    Object.assign(view, { tab: 'feed', which: 'current', kind: 'main', shooter: null });
    Object.assign(sort, { key: 'downs', dir: -1 });
  }
};
