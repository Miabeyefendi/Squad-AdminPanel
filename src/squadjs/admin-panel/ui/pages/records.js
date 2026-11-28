// Records and logs read the same way: first the period, then the filters, then a wide list by day.
// Deleting is a separate place that says it is dangerous and shows what would go before it goes.
import { $, $$, DAY, S, api, app, ask, byDay, clock, confirmField, dayName, downloadCsv, draw, entries, gate, guard, html, icon, may, periodOf, periodQuery, plural, put, stamp, t, tAction, toast } from '../core.js';
import { kindTag } from './players.js';

const PERIODS = [['today', t('Today')], ['7d', t('7 days')], ['30d', t('30 days')], ['all', t('Everything')], ['custom', t('Pick dates')]];
// a period bar; "state" is { id, start, end }
export const periodBar = (state, choices = PERIODS) => html`<div class="periodbar"><span class="cap">${t('Period')}</span><div class="seg" role="group" aria-label="${t('Period')}">${choices.map(([v, n]) => html`<button type="button" data-period="${v}" data-key="p${v}" aria-pressed="${state.id === v}">${n}</button>`)}</div>
  <span class="dates" ${state.id === 'custom' ? '' : html`hidden`}><label>${t('From')}<input class="field" type="date" data-date="start" value="${state.start}"></label><label>${t('To (included)')}<input class="field" type="date" data-date="end" value="${state.end}"></label></span></div>`;

// ---------- records ----------
const KIND_LABEL = { admin: t('Admin actions'), tk: t('Teamkills'), kills: t('Kills'), chat: t('Chat'), conn: t('Joins and leaves'), history: t('Warns, kicks and bans on players'), notes: t('Player notes') };
const KEEP_CHOICES = [[0, t('For ever')], [7, t('7 days')], [30, t('30 days')], [90, t('90 days')], [180, t('6 months')], [365, t('1 year')], [730, t('2 years')]];
const TYPES = [['warn', t('Warnings')], ['kick', t('Kicks')], ['ban', t('Bans')], ['note', t('Notes')]];
const rec = { tab: 'timeline', period: { id: '30d', start: '', end: '' }, types: new Set(), timeline: null, players: null, overview: null, plan: null };
const recQuery = () => $('#rec-q').value.trim();
const shownEntries = () => (rec.timeline?.entries || []).filter((e) => !rec.types.size || rec.types.has(e.type));

function results() {
  if (rec.tab === 'players') {
    const rows = rec.players || [];
    return html`<div class="tbox"><table class="wide-table"><thead><tr><th>${t('Player')}</th><th class="n">${t('Warns')}</th><th class="n">${t('Kicks')}</th><th class="n">${t('Bans')}</th><th class="n">${t('Notes')}</th><th>${t('Last entry')}</th></tr></thead><tbody>${rows.length ? rows.map((p) => html`<tr data-player="${p.id}"><td><button class="linkbtn" data-player="${p.id}">${p.name}</button></td><td class="n">${p.warns}</td><td class="n">${p.kicks}</td><td class="n">${p.bans}</td><td class="n">${p.notes}</td><td class="sub">${p.last ? stamp(p.last) : '-'}</td></tr>`) : html`<tr><td colspan="6" class="empty">${recQuery() ? t('No player found.') : t('No player has anything on record yet.')}</td></tr>`}</tbody></table></div>`;
  }
  if (!rec.timeline) return html`<span class="empty">${t('Loading…')}</span>`;
  const rows = shownEntries();
  if (!rows.length) return html`<span class="empty">${rec.types.size || recQuery() ? t('Nothing on record in this period with this filter.') : t('Nothing on record in this period.')}</span>`;
  return html`<ul class="chrono">${byDay(rows, (e) => html`<li><span class="mono sub xs">${clock(e.at)}</span><span>${kindTag(e.type)}</span><button class="linkbtn clip" data-player="${e.id}" title="${e.name}">${e.name}</button><span class="wrapany">${e.reason}${e.detail ? html` <span class="sub">(${e.detail})</span>` : ''}</span><span class="sub xs by">${t('by {name}', { name: e.by })}</span></li>`)}</ul>
    ${rec.timeline.total > rec.timeline.entries.length ? html`<p class="foot">${t('The newest {shown} of {total}. Choose a shorter period to see the rest.', { shown: rec.timeline.entries.length, total: rec.timeline.total })}</p>` : ''}`;
}
function counts() {
  const all = rec.timeline?.entries || [];
  return TYPES.map(([v, n]) => html`<button class="countbox" data-type="${v}" data-key="t${v}" aria-pressed="${rec.types.has(v)}"><span class="kpiv">${all.filter((e) => e.type === v).length}</span><span class="cap">${n}</span></button>`);
}
function renderRecords() {
  if (!may('notes.view') && !may('data.manage')) return;
  const danger = rec.tab === 'danger';
  draw($('#rec-tabs'), html`${may('notes.view') ? html`<button role="tab" data-rectab="timeline" aria-selected="${rec.tab === 'timeline'}">${t('What happened')}</button><button role="tab" data-rectab="players" aria-selected="${rec.tab === 'players'}">${t('By player')}</button>` : ''}${may('data.manage') ? html`<button role="tab" class="risktab" data-rectab="danger" aria-selected="${danger}">${icon('warn')}${t('Delete and keep')}</button>` : ''}`);
  $('#rec-read').hidden = danger;
  $('#rec-danger').hidden = !danger;
  if (danger) return;
  draw($('#rec-period'), periodBar(rec.period));
  $('#rec-period').hidden = rec.tab === 'players';
  $('#rec-counts').hidden = rec.tab === 'players';
  draw($('#rec-counts'), counts());
  draw($('#rec-list'), results());
}
async function loadRecords() {
  if (!may('notes.view')) { rec.tab = 'danger'; renderRecords(); await loadDanger(); return; }
  renderRecords();
  if (rec.tab === 'danger') { await loadDanger(); return; }
  if (rec.tab === 'players') rec.players = await api(`/api/records/players?q=${encodeURIComponent(recQuery())}`);
  else {
    const period = periodOf(rec.period.id, rec.period.start, rec.period.end);
    if (!period) return; // dates not picked yet
    rec.timeline = await api(`/api/records/timeline?q=${encodeURIComponent(recQuery())}${periodQuery(period)}`);
  }
  renderRecords();
}

// ---------- deleting and keeping ----------
const planForm = () => $('#rec-delete');
function deleteRequest() {
  const f = planForm().elements;
  const kinds = $$('input[name=kind]:checked', planForm()).map((x) => x.value);
  if (!kinds.length) throw new Error(t('Pick what to delete.'));
  const mode = f.mode.value;
  if (mode === 'all') return { kinds, from: null, to: null, words: t('everything of the chosen kinds') };
  if (mode === 'older') {
    const days = Number(f.days.value);
    if (!(days >= 1)) throw new Error(t('Give a number of days.'));
    return { kinds, from: null, to: Date.now() - days * DAY, words: t('older than {time}', { time: plural(days, 'day') }) };
  }
  const at = (text) => Date.parse(`${text}T00:00:00Z`);
  if (mode === 'month') {
    if (!f.month.value) throw new Error(t('There is no month with logs yet.'));
    const [y, m] = f.month.value.split('-').map(Number);
    return { kinds, from: Date.UTC(y, m - 1, 1), to: Date.UTC(y, m, 1), words: t('of the month {month}', { month: f.month.value }) };
  }
  if (!f.start.value || !f.end.value || f.end.value < f.start.value) throw new Error(t('Pick a start date and an end date.'));
  return { kinds, from: at(f.start.value), to: at(f.end.value) + DAY, words: t('from {from} to {to}', { from: f.start.value, to: f.end.value }) };
}
const listed = (found) => Object.entries(found).filter(([, n]) => n);
function planView() {
  if (!rec.plan) return html`<span class="sub">${t('Nothing is deleted yet. Choose above and press "Show what would be deleted".')}</span>`;
  const days = Object.entries(rec.plan.days).sort();
  const total = Object.values(rec.plan.counts).reduce((a, b) => a + b, 0);
  if (!total) return html`<span>${t('Nothing matches. There is nothing to delete.')}</span>`;
  return html`<div class="plan"><h3>${t('Would be deleted: {count} ({period})', { count: entries(total), period: rec.plan.request.words })}</h3>
    <div class="line">${listed(rec.plan.counts).map(([k, n]) => html`<span class="tag">${KIND_LABEL[k]}: <b>${n}</b></span>`)}</div>
    <span class="sub xs">${t('{count} affected, {from} to {to} (UTC days)', { count: plural(days.length, 'day'), from: days[0][0], to: days.at(-1)[0] })}</span>
    <ul class="daylist" data-keep-scroll="days">${days.map(([day, n]) => html`<li><span class="mono">${day}</span><span class="sub">${entries(n)}</span></li>`)}</ul>
    <button type="button" class="btn riskbtn tall" data-reallydelete>${icon('warn')}${t('Delete these {n} for good…', { n: total })}</button></div>`;
}
const dangerShell = () => html`<div class="riskbanner">${icon('warn', 28)}<div class="stack2"><h2>${t('Careful: what is deleted here is gone')}</h2><span>${t('There is no bin and no undo. Only the fact that something was deleted stays in the admin log.')}</span></div></div>
  <div class="tile risk"><div class="stack2"><h2>${t('Delete now')}</h2><span class="sub">${t('1. Choose the period. 2. Choose what. 3. Look at what would go. Only then can you delete.')}</span></div>
    <form id="rec-delete" class="stack16"></form><div id="rec-plan"></div></div>
  <div class="tile"><div class="stack2"><h2>${t('Stored now')}</h2><span class="sub" id="rec-size"></span></div><div class="kpis flat" id="rec-store"></div></div>
  <form class="tile risk" id="rec-keep"></form>`;
function deleteForm() {
  const o = rec.overview;
  return html`<fieldset><legend>${t('1. Which period')}</legend><div class="rowline">
      <label class="stack">${t('Which entries')}<select class="field" name="mode"><option value="older">${t('Older than…')}</option><option value="month">${t('One month')}</option><option value="between">${t('Between two dates')}</option><option value="all">${t('Everything')}</option></select></label>
      <label class="stack" data-mode="older">${t('Days')}<input class="field mono short" type="number" name="days" min="1" value="30"></label>
      <label class="stack" data-mode="month" hidden>${t('Month')}<select class="field" name="month">${o.months.map((m) => html`<option value="${m}">${m}</option>`)}</select></label>
      <label class="stack" data-mode="between" hidden>${t('From')}<input class="field" type="date" name="start"></label>
      <label class="stack" data-mode="between" hidden>${t('To (included)')}<input class="field" type="date" name="end"></label></div></fieldset>
    <fieldset><legend>${t('2. What')}</legend><div class="kinds">${Object.entries(KIND_LABEL).map(([k, n]) => html`<label><input type="checkbox" name="kind" value="${k}">${n}</label>`)}</div></fieldset>
    <div><button class="btn">${t('3. Show what would be deleted')}</button></div>`;
}
function keepForm() {
  const o = rec.overview;
  const choices = (days) => (KEEP_CHOICES.some(([v]) => v === days) ? KEEP_CHOICES : [...KEEP_CHOICES, [days, plural(days, 'day')]]);
  return html`<div class="stack2"><h2>${t('How long to keep')}</h2><span class="sub">${t('Anything older than the limit is deleted by itself, also at the moment you save a shorter limit. Player history and notes are kept for ever unless you change it.')}</span></div>
    <div class="keepgrid">${Object.entries(KIND_LABEL).map(([k, n]) => html`<label class="set"><span class="lbl">${n}</span><select class="field" name="${k}">${choices(o.retention[k]).map(([v, label]) => html`<option value="${v}" ${v === o.retention[k] ? html`selected` : ''}>${label}</option>`)}</select></label>`)}</div>
    <div><button class="btn">${t('Save limits…')}</button></div>`;
}
async function loadDanger(overview) {
  if (!may('data.manage')) return;
  rec.overview = overview || (await api('/api/records'));
  rec.plan = null;
  const o = rec.overview;
  put($('#rec-delete'), deleteForm());
  put($('#rec-plan'), planView());
  put($('#rec-keep'), keepForm());
  $('#rec-size').textContent = `${t('{size} MB, encrypted', { size: (o.bytes / 1048576).toFixed(2) })}${o.oldestLog ? ` · ${t('oldest log {date}', { date: o.oldestLog })}` : ''}`;
  put($('#rec-store'), [[t('Players known'), o.players], [t('History entries'), o.history], [t('Notes'), o.notes], [t('Days of logs'), o.logDays]].map(([n, v]) => html`<div class="kpi"><span class="cap">${n}</span><span class="kpiv">${v}</span></div>`));
}
function confirmDelete() {
  const { request, counts: found, days } = rec.plan;
  const total = Object.values(found).reduce((a, b) => a + b, 0);
  const dates = Object.keys(days).sort();
  const { words, ...body } = request;
  ask({ title: t('Delete for good: {count}?', { count: entries(total) }), danger: true, ok: t('Delete for good'),
    text: t('Check this one more time. It cannot be undone.'),
    body: html`<dl class="facts"><dt>${t('Period')}</dt><dd>${words}</dd><dt>${t('Days')}</dt><dd>${dates.length === 1 ? dates[0] : `${dates[0]} - ${dates.at(-1)} (${plural(dates.length, 'day')})`}</dd><dt>${t('What')}</dt><dd>${listed(found).map(([k, n]) => html`<span class="block">${KIND_LABEL[k]}: ${n}</span>`)}</dd></dl>`,
    fields: html`<label>${t('Type DELETE to go on')}<input class="field mono" name="word" autocomplete="off" required></label>${confirmField()}`,
    run: async (v) => {
      if (v.word !== 'DELETE') throw new Error(t('Type DELETE in capital letters.'));
      await loadDanger((await api('/api/records', { op: 'delete', ...body, confirmPassword: v.confirmPassword })).overview);
      rec.timeline = null;
    } });
}

let typing = null;
export const records = {
  id: 'records',
  title: t('Records'),
  shell: () => html`<div class="seg" role="tablist" aria-label="${t('Records')}" id="rec-tabs"></div>
    <div class="stackcol" id="rec-read">
      <div class="tile filters"><div id="rec-period"></div><div class="rowline"><label class="sr" for="rec-q">${t('Search')}</label><input id="rec-q" class="field search" type="search" placeholder="${t('Player name, ID, admin or reason')}"><div class="countrow" id="rec-counts" role="group" aria-label="${t('Show only')}"></div></div></div>
      <div class="tile" id="rec-list"></div>
    </div>
    <div class="stackcol" id="rec-danger" hidden>${dangerShell()}</div>`,
  wire(root) {
    root.addEventListener('click', guard(async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.rectab) { rec.tab = d.rectab; await loadRecords(); }
      else if (d.period) { rec.period.id = d.period; renderRecords(); await loadRecords(); }
      else if (d.type) { if (rec.types.has(d.type)) rec.types.delete(d.type); else rec.types.add(d.type); renderRecords(); }
      else if (d.reallydelete !== undefined) confirmDelete();
    }));
    root.addEventListener('change', guard(async (e) => {
      if (e.target.dataset.date) { rec.period[e.target.dataset.date] = e.target.value; await loadRecords(); return; }
      if (e.target.name === 'mode') $$('#rec-delete [data-mode]').forEach((x) => { x.hidden = x.dataset.mode !== e.target.value; });
      // a changed choice throws the old preview away, so the button never deletes something else
      if (e.target.form?.id === 'rec-delete') { rec.plan = null; put($('#rec-plan'), planView()); }
    }));
    root.addEventListener('input', (e) => {
      if (e.target.id !== 'rec-q') return;
      clearTimeout(typing);
      typing = setTimeout(guard(loadRecords), 250);
    });
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      guard(async () => {
        if (e.target.id === 'rec-delete') {
          const request = deleteRequest();
          const { words, ...body } = request;
          const found = await api('/api/records', { op: 'preview', ...body });
          rec.plan = { request, ...found };
          put($('#rec-plan'), planView());
          $('#rec-plan').scrollIntoView({ block: 'nearest' });
          return;
        }
        const retention = {};
        $$('select', e.target).forEach((x) => { if (Number(x.value) !== rec.overview.retention[x.name]) retention[x.name] = Number(x.value); });
        if (!Object.keys(retention).length) { toast(t('Nothing changed.')); return; }
        ask({ title: t('Change how long records are kept?'), danger: true, text: t('Anything already older than a new, shorter limit is deleted at once.'), ok: t('Save limits'),
          body: html`<dl class="facts">${Object.entries(retention).map(([k, days]) => html`<dt>${KIND_LABEL[k]}</dt><dd>${days ? plural(days, 'day') : t('for ever')}</dd>`)}</dl>`,
          fields: confirmField(),
          run: async (v) => loadDanger((await api('/api/records', { op: 'retention', retention, confirmPassword: v.confirmPassword })).overview) });
      })();
    });
  },
  open: guard(loadRecords),
  render() {},
  log() {},
  reload: guard(loadRecords),
  reset() { Object.assign(rec, { tab: 'timeline', period: { id: '30d', start: '', end: '' }, timeline: null, players: null, overview: null, plan: null }); rec.types.clear(); },
  openDanger() { rec.tab = 'danger'; app.show('records'); }
};

// ---------- logs ----------
const LOG_TABS = [['admin', t('Admin actions'), [[t('By'), 'by', 130], [t('Action'), 'action', 150], [t('Target'), 'target', 180], [t('Reason'), 'reason']]],
  ['tk', t('Teamkills'), [[t('Attacker'), 'attacker', 200], [t('Victim'), 'victim', 200], [t('Weapon'), 'weapon'], [t('Count'), 'count', 80]]],
  ['kills', t('Kills'), [[t('Attacker'), 'attacker', 200], [t('Victim'), 'victim', 200], [t('Weapon'), 'weapon']]],
  ['chat', t('Chat'), [[t('Channel'), 'channel', 90], [t('Player'), 'player', 190], [t('Message'), 'message']]],
  ['conn', t('Joins & leaves'), [[t('Event'), 'event', 110], [t('Player'), 'player']]]];
// how a stored value reads on screen; the CSV file keeps what is stored
const shown = (r, key) => (key === 'action' ? tAction(r.action) : key === 'event' || key === 'channel' ? t(r[key]) : key === 'reason' && r.note ? `${r.reason} (${r.note})` : r[key]);
const LOG_NEEDS = { admin: ['log.admin', 'log.ip'], tk: ['kills.view'], kills: ['kills.view'], chat: ['chat.view'], conn: ['view.live'] };
const LOG_PERIODS = [['latest', t('Latest')], ...PERIODS.filter(([v]) => v !== 'all')];
const log = { tab: 'admin', period: { id: 'latest', start: '', end: '' }, rows: null }; // rows: a read period, or null for the latest

const allowedTabs = () => LOG_TABS.filter(([k]) => LOG_NEEDS[k].some(may));
const logView = () => {
  const cols = LOG_TABS.find((t) => t[0] === log.tab)[2];
  const q = $('#lg-q').value.trim().toLowerCase();
  const rows = [...(log.rows ?? S.logs[log.tab])].reverse().filter((r) => !q || cols.some(([, k]) => String(shown(r, k) ?? '').toLowerCase().includes(q)));
  return { cols, rows };
};
function logTable() {
  const { cols, rows } = logView();
  if (!rows.length) return html`<span class="empty">${$('#lg-q').value ? t('No entries with this filter.') : log.period.id === 'latest' ? t('No entries yet.') : t('No entries in this period.')}</span>`;
  const player = (r, key) => (['player', 'attacker'].includes(key) && r.id ? html`<button class="linkbtn clip" data-player="${r.id}" title="${r[key]}">${r[key]}</button>` : shown(r, key));
  let day = null;
  return html`<div class="tbox"><table class="logtable"><colgroup><col style="width:70px">${cols.map(([, , w]) => html`<col ${w ? html`style="width:${w}px"` : ''}>`)}</colgroup><thead><tr><th>${t('Time')}</th>${cols.map(([n]) => html`<th>${n}</th>`)}</tr></thead><tbody>${rows.slice(0, 1000).map((r) => {
    const label = new Date(r.at).toDateString();
    const head = label === day ? '' : html`<tr class="dayrow"><th colspan="${cols.length + 1}">${dayName(r.at)}</th></tr>`;
    day = label;
    return html`${head}<tr><td class="mono sub">${clock(r.at)}</td>${cols.map(([, k]) => html`<td>${player(r, k)}</td>`)}</tr>`;
  })}</tbody></table></div>${rows.length > 1000 ? html`<p class="foot">${t('The newest 1000 of {total} are shown. The CSV file has them all.', { total: rows.length })}</p>` : ''}`;
}
function renderLogs() {
  const tabs = allowedTabs();
  if (!tabs.some(([k]) => k === log.tab)) log.tab = tabs[0]?.[0] || 'conn';
  draw($('#lg-period'), periodBar(log.period, LOG_PERIODS));
  draw($('#lg-tabs'), tabs.map(([k, n]) => html`<button role="tab" data-log="${k}" data-key="l${k}" aria-selected="${k === log.tab}">${n}</button>`));
  draw($('#lg-list'), logTable());
  $('#lg-count').textContent = entries(logView().rows.length);
  gate($('#view-logs'));
}
async function loadLogPage() {
  renderLogs();
  const period = log.period.id === 'latest' ? null : periodOf(log.period.id, log.period.start, log.period.end);
  if (log.period.id === 'latest' || !period) log.rows = null;
  else log.rows = await api(`/api/logs?kind=${log.tab}${periodQuery({ from: period.from ?? 0, to: period.to })}`);
  renderLogs();
}

export const logs = {
  id: 'logs',
  title: t('Logs'),
  shell: () => html`<div class="tile filters"><div id="lg-period"></div><div class="rowline"><div class="seg" role="tablist" aria-label="${t('Log type')}" id="lg-tabs"></div></div><div class="rowline"><label class="sr" for="lg-q">${t('Filter')}</label><input id="lg-q" class="field search" type="search" placeholder="${t('Filter by name or text')}"><span class="sub xs" id="lg-count"></span><span class="grow"></span><button class="btn" data-csv>${t('Export CSV')}</button><button class="btn ghost riskink" data-danger data-need="data.manage">${icon('warn')}${t('Delete records…')}</button></div></div>
    <div class="tile" id="lg-list"></div>`,
  wire(root) {
    root.addEventListener('click', guard(async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.log) { log.tab = b.dataset.log; log.rows = null; await loadLogPage(); }
      else if (b.dataset.period) { log.period.id = b.dataset.period; log.rows = null; await loadLogPage(); }
      else if (b.dataset.csv !== undefined) {
        const { cols, rows } = logView();
        downloadCsv(`squad-${log.tab}.csv`, [[t('Time'), ...cols.map(([n]) => n)], ...rows.map((r) => [new Date(r.at).toISOString(), ...cols.map(([, k]) => (k === 'reason' ? shown(r, k) : r[k]))])]);
      } else if (b.dataset.danger !== undefined) records.openDanger();
    }));
    root.addEventListener('change', guard(async (e) => {
      if (!e.target.dataset.date) return;
      log.period[e.target.dataset.date] = e.target.value;
      await loadLogPage();
    }));
    root.addEventListener('input', (e) => { if (e.target.id === 'lg-q') renderLogs(); });
  },
  open: guard(loadLogPage),
  render() {},
  log(entry) {
    // a period that reaches into the present grows with it
    if (log.rows && entry.kind === log.tab) {
      const period = periodOf(log.period.id, log.period.start, log.period.end);
      if (period && entry.at >= (period.from ?? 0) && (period.to === null || entry.at < period.to)) log.rows.push(entry);
    }
    renderLogs();
  },
  reload: guard(loadLogPage),
  reset() { Object.assign(log, { tab: 'admin', period: { id: 'latest', start: '', end: '' }, rows: null }); },
  showKind(kind) { log.tab = kind; log.period.id = 'latest'; log.rows = null; app.show('logs'); }
};
