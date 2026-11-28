// Both teams side by side. Columns have fixed widths and the order is held while it is read.
import { $, $$, S, byId, commanderOf, draw, gate, html, kd, mark, matches, nameClass, playerAction, plural, rankBadge, squadTag, t, teamName, thisMatch } from '../core.js';
import { flag } from '../art.js';

// [key, head, width in px, what it means]
const COLUMNS = [
  ['kills', 'K', 50, t('Kills')], ['downs', t('Down'), 52, t('Enemies downed')], ['deaths', 'D', 40, t('Deaths')],
  ['kd', 'K/D', 50, t('Kills per death')], ['revives', t('Rev'), 46, t('Revives')], ['teamkills', 'TK', 36, t('Teamkills')],
  ['damage', t('DMG'), 56, t('Damage done')], ['minutes', t('Min'), 54, t('Minutes on the server')]
];
const sort = { key: 'kills', dir: -1 };
// the row order of each team, taken when the sort is chosen; later joiners go to the end
const order = new Map();
export const selected = new Set();

const value = (p, key) => (key === 'kd' ? kd(p) : key === 'name' ? p.name.toLowerCase()
  : key === 'squad' ? (p.squad ?? 999) * 10 + (p.commander ? 0 : p.leader ? 1 : 2) : p[key]);
const compare = (a, b) => (value(a, sort.key) > value(b, sort.key) ? sort.dir : value(a, sort.key) < value(b, sort.key) ? -sort.dir : a.name.localeCompare(b.name));
const query = () => $('#sc-q').value.trim().toLowerCase();

function teamRows(team) {
  const members = S.state.players.filter((p) => p.team === team);
  const held = order.get(team);
  // the first draw with players sets the order
  if (!held?.length) order.set(team, [...members].sort(compare).map((p) => p.id));
  else {
    const known = new Set(held);
    held.push(...members.filter((p) => !known.has(p.id)).map((p) => p.id));
  }
  const here = new Map(members.map((p) => [p.id, p]));
  return order.get(team).map((id) => here.get(id)).filter((p) => p && matches(p, query()));
}
// is the held order still what the sort would give now?
const stale = () => [1, 2].some((team) => {
  const shown = teamRows(team);
  return shown.some((p, i) => i > 0 && compare(shown[i - 1], p) > 0);
});

const head = (key, label, title, cls = 'n') => html`<th class="${cls}" ${sort.key === key ? html`aria-sort="${sort.dir < 0 ? 'descending' : 'ascending'}"` : ''}><button data-sort="${key}" title="${title}">${label}<span class="arrow">${sort.key === key ? (sort.dir < 0 ? '↓' : '↑') : ''}</span></button></th>`;

export function commanderStrip(team) {
  const c = commanderOf(team);
  const copies = S.state.squads.filter((s) => s.team === team && s.copycat);
  return html`<div class="cmdstrip ${c ? '' : 'empty-cmd'}"><span class="cmd">CMD</span>${c
    ? html`<button class="linkbtn n-cmd" data-player="${c.id}">${c.name}</button><span class="sub xs">${t('squad {n}', { n: c.squad })} · ${c.role}</span>`
    : html`<span class="sub">${t('No commander')}</span>`}${copies.length ? html`<span class="tag warnish" title="${t('Anyone can give a squad this name')}">${t('also named Command Squad: {list}', { list: copies.map((s) => t('squad {n}', { n: s.id })).join(', ') })}</span>` : ''}</div>`;
}
export const teamHead = (team) => {
  const members = S.state.players.filter((p) => p.team === team);
  return html`<div class="teamhead"><span class="flagline">${flag(S.state.server.factions[team - 1] || teamName(team), 'lg')}<span class="stack2"><h2 class="tx${team}">${t('Team {n}', { n: team })} · ${teamName(team)}</h2><span class="sub xs">${plural(members.length, 'player')} · ${plural(S.state.squads.filter((s) => s.team === team).length, 'squad')}</span></span></span><span class="tickets tx${team}" title="${t('Tickets')}">${S.state.server.tickets[team - 1] ?? '-'}</span></div>`;
};

function teamTable(team) {
  const rows = teamRows(team);
  const all = rows.length > 0 && rows.every((p) => selected.has(p.id));
  return html`${teamHead(team)}${commanderStrip(team)}
  <div class="tbox" data-keep-scroll="t${team}"><table class="sbt"><colgroup><col style="width:34px"><col style="width:40px"><col>${COLUMNS.map(([, , w]) => html`<col style="width:${w}px">`)}</colgroup>
  <thead><tr><th><input type="checkbox" data-all="${team}" aria-label="${t('Select team {n}', { n: team })}" ${all ? html`checked` : ''}></th>${head('squad', 'SQ', t('Squad number'), 'c')}${head('name', t('Player'), t('Name'), '')}${COLUMNS.map(([k, n, , meaning]) => head(k, n, meaning))}</tr></thead>
  <tbody>${rows.length ? rows.map((p) => html`<tr data-player="${p.id}" class="${selected.has(p.id) ? 'sel' : ''}"><td class="check"><input type="checkbox" data-check="${p.id}" aria-label="${t('Select {name}', { name: p.name })}" ${selected.has(p.id) ? html`checked` : ''}></td><td class="c">${squadTag(p)}</td><td class="who"><span class="pname">${rankBadge(p)}<button class="linkbtn ${nameClass(p)}" data-player="${p.id}" title="${p.name}">${p.name}</button>${p.notes ? html`<span class="tag mini" title="${t('Notes on record')}">${p.notes}</span>` : ''}</span><span class="meta2">${p.role}</span></td>${COLUMNS.map(([k]) => html`<td class="n ${k === 'teamkills' && p.teamkills ? 'hot' : ''}">${k === 'kd' ? kd(p).toFixed(2) : p[k]}</td>`)}</tr>`) : html`<tr><td colspan="${COLUMNS.length + 3}" class="empty">${query() ? t('Nobody in this team matches.') : t('No players.')}</td></tr>`}</tbody></table></div>`;
}

function tops() {
  const { players, server } = S.state;
  const best = (key) => players.reduce((a, p) => (p[key] > (a?.[key] || 0) ? p : a), null);
  const player = (label, key, unit) => {
    const p = best(key);
    return html`<div class="kpi"><span class="cap">${label}</span>${p ? html`<button class="linkbtn kpiname" data-player="${p.id}">${p.name}</button>` : html`<span class="kpiname">-</span>`}<span class="sub xs">${p ? html`${mark(p.team)} ${plural(p[key], unit)} · ${t('squad {n}', { n: p.squad ?? '-' })}` : t('Nothing counted yet')}</span></div>`;
  };
  const kills = thisMatch(S.logs.tk).length;
  return html`${player(t('Most kills'), 'kills', 'kill')}${player(t('Most revives'), 'revives', 'revive')}
    <div class="kpi"><span class="cap">${t('Server tick rate')}</span><span class="kpiv">${server.tickRate ?? '-'}</span><span class="sub xs">${server.tickRate === null ? t('Waiting for the server log') : t('Latest reading from the log')}</span></div>
    <div class="kpi"><span class="cap">${t('Teamkills this match')}</span><span class="kpiv">${kills}</span><span class="sub xs">${kills ? html`<button class="linkbtn" data-golog="tk">${t('See who')}</button>` : t('None so far')}</span></div>`;
}

export default {
  id: 'score',
  title: t('Scoreboard'),
  shell: () => html`<div class="tile kpis" id="sc-tops"></div>
    <div class="toolbar">
      <label class="sr" for="sc-q">${t('Search both teams')}</label><input id="sc-q" class="field search" type="search" placeholder="${t('Name, ID or squad (sl1, sq3)')}">
      <span class="sub xs" id="sc-count"></span>
      <button class="btn small" id="sc-resort" hidden>${t('Sort again')}</button>
      <span class="sub xs grow right-text">${t('The game sends no score or ping. Numbers are counted from the server log while the panel runs.')}</span>
    </div>
    <div class="bulk" id="sc-bulk"><b id="sc-bulkn"></b>
      <button class="btn" data-bulk="warn" data-need="warn">${t('Warn')}</button><button class="btn" data-bulk="moveTeam" data-need="team.move">${t('Move team')}</button><button class="btn" data-bulk="removeFromSquad" data-need="squad.remove">${t('Remove from squad')}</button><button class="btn danger" data-bulk="kick" data-need="kick">${t('Kick')}</button><button class="btn pri" data-bulk="ban" data-need="ban">${t('Ban')}</button><button class="btn ghost" id="sc-clear">${t('Clear')}</button></div>
    <div class="board"><div class="tile team1" id="sc-t1"></div><div class="tile team2" id="sc-t2"></div></div>`,
  wire(root) {
    root.addEventListener('change', (e) => {
      const { check, all } = e.target.dataset;
      if (check) { if (e.target.checked) selected.add(check); else selected.delete(check); } else if (all) {
        teamRows(Number(all)).forEach((p) => (e.target.checked ? selected.add(p.id) : selected.delete(p.id)));
      } else return;
      this.render();
    });
    root.addEventListener('click', (e) => {
      const header = e.target.closest('[data-sort]');
      if (header) {
        const key = header.dataset.sort;
        sort.dir = sort.key === key ? -sort.dir : key === 'name' || key === 'squad' ? 1 : -1;
        sort.key = key;
        order.clear();
        this.render();
      }
      if (e.target.closest('#sc-resort')) { order.clear(); this.render(); }
      if (e.target.closest('#sc-clear')) { selected.clear(); this.render(); }
      const bulk = e.target.closest('[data-bulk]');
      if (bulk) playerAction(bulk.dataset.bulk, [...selected]);
    });
    root.addEventListener('input', (e) => { if (e.target.id === 'sc-q') this.render(); });
  },
  open() { order.clear(); this.render(); },
  render() {
    if (!S.state) return;
    for (const id of selected) if (!byId(id)) selected.delete(id);
    draw($('#sc-tops'), tops());
    [1, 2].forEach((t) => draw($(`#sc-t${t}`), teamTable(t)));
    const q = query();
    $('#sc-count').textContent = plural(S.state.players.filter((p) => matches(p, q)).length, 'player');
    $('#sc-resort').hidden = !stale();
    $('#sc-bulk').classList.toggle('on', selected.size > 0);
    $('#sc-bulkn').textContent = t('{n} selected', { n: selected.size });
    gate($('#view-score'));
    // a box that was ticked on screen stays ticked even when the markup did not change
    $$('#view-score [data-check]').forEach((x) => { x.checked = selected.has(x.dataset.check); });
  },
  log(entry) { if (entry.kind === 'tk') this.render(); },
  reload() { this.render(); },
  reset() { selected.clear(); order.clear(); Object.assign(sort, { key: 'kills', dir: -1 }); }
};
