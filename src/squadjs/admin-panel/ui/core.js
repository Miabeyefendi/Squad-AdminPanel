// What every page shares: safe markup, the signed in user, the live state, the network and the dialogs.
// Player names, chat and plugin texts come from outside. Everything goes through html``, which escapes.
import { LOCALE, plural, t, tAction } from './i18n.js';

export { LOCALE, plural, t, tAction };
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(esc).join('')
  : v === null || v === undefined || v === false ? '' : String(v).replace(/[&<>"']/g, (c) => ENT[c]));
// false prints nothing, except in an aria attribute, where "false" is the value
const slot = (before, v) => (typeof v === 'boolean' && /aria-[a-z]+="$/.test(before) ? String(v) : esc(v));
export const html = (parts, ...values) => new Safe(parts.reduce((out, p, i) => out + p + (i < values.length ? slot(p, values[i]) : ''), ''));
// for markup this code builds itself, such as the flag drawings; never for anything from outside
export const trusted = (markup) => new Safe(markup);

const cache = new WeakMap();
export const put = (el, content) => {
  if (!el) return;
  el.innerHTML = esc(content);
  cache.delete(el);
};
// attributes that name the same control before and after a redraw
const STABLE = ['data-check', 'data-all', 'data-sort', 'data-player', 'data-act', 'data-reply', 'data-go', 'data-key', 'id'];
const keyOf = (node) => {
  const name = STABLE.find((a) => node.hasAttribute?.(a));
  return name ? `${node.tagName}[${name}="${CSS.escape(node.getAttribute(name))}"]` : null;
};
// redraws only when the markup changed, and keeps focus and scroll through the live updates
export const draw = (el, content) => {
  if (!el) return false;
  const s = esc(content);
  if (cache.get(el) === s) return false;
  const active = el.contains(document.activeElement) ? keyOf(document.activeElement) : null;
  const scrolled = $$('[data-keep-scroll]', el).map((x) => [x.dataset.keepScroll, x.scrollTop, x.scrollLeft]);
  cache.set(el, s);
  el.innerHTML = s;
  for (const [name, top, left] of scrolled) {
    const box = $(`[data-keep-scroll="${name}"]`, el);
    if (box) Object.assign(box, { scrollTop: top, scrollLeft: left });
  }
  if (active) $(active, el)?.focus({ preventScroll: true });
  return true;
};

export const LOG_KINDS = ['admin', 'tk', 'kills', 'chat', 'conn'];
export const S = {
  me: null,
  state: null,
  view: 'overview',
  logs: Object.fromEntries(LOG_KINDS.map((k) => [k, []])),
  // pictures the server owner put in the data folder
  assets: { maps: [], screens: [], factions: [] }
};
// app.js fills these in; pages call them without importing it
export const app = { show: () => {}, signedOut: () => {}, mustChange: () => {}, afterAction: () => {}, render: () => {} };

// "ban" means any kind of ban, "staff" any right to look after accounts
const ANY = { ban: ['ban.short', 'ban.long', 'ban.perm'], staff: ['staff.admins', 'staff.manage', 'perm.grant'],
  message: ['broadcast', 'message.group'], records: ['notes.view', 'data.manage'],
  server: ['messages.schedule', 'server.settings', 'server.password', 'notify.manage'],
  // the heading over Staff, Ranks and Server
  access: ['staff.admins', 'staff.manage', 'perm.grant', 'ranks.edit', 'messages.schedule', 'server.settings', 'server.password', 'notify.manage'] };
export const may = (what) => !!S.me && (ANY[what] || [what]).some((id) => S.me.can.includes(id));
// a teamkill reads "(squad) Name tk (squad) Name", the names in their team's colour
export const fighter = (id, name, team, squad) => {
  const cls = `tkname ${Number(team) === 1 || Number(team) === 2 ? `tx${Number(team)}` : ''}`;
  return html`<span class="tkwho"><span class="sqn ${squad ? '' : html`none`}" title="${squad ? t('Squad {n}', { n: squad }) : t('No squad')}">${squad || '-'}</span>${id ? html`<button type="button" class="linkbtn ${cls}" data-player="${id}">${name}</button>` : html`<b class="${cls}">${name}</b>`}</span>`;
};
export const tkLine = (r) => html`<span class="tkline">${fighter(r.id, r.attacker, r.team, r.squad)}<i class="tkword">tk</i>${fighter(r.victimId, r.victim || t('Unknown'), r.victimTeam, r.victimSquad)}</span>`;
export const gate = (root) => $$('[data-need]', root).forEach((el) => { el.hidden = !may(el.dataset.need); });

// ---------- network ----------
export async function api(path, body) {
  const res = await fetch(path, body === undefined ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SA': '1' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') app.signedOut();
  if (data.mustChange && res.status === 403) app.mustChange(S.me?.name || '');
  if (!res.ok) throw new Error(data.error ? t(data.error) : t('Request failed ({status}).', { status: res.status }));
  return data;
}
export const post = (name, body = {}) => api(`/api/action/${name}`, body);

export function toast(text, bad = false) {
  const el = document.createElement('div');
  el.className = bad ? 'toast bad' : 'toast';
  el.setAttribute('role', bad ? 'alert' : 'status');
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), bad ? 8000 : 3500);
}
export const guard = (fn) => async (...args) => {
  try { await fn(...args); } catch (err) { toast(err.message, true); }
};

// ---------- words and numbers ----------
export const clock = (at) => new Date(at).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const stamp = (at) => new Date(at).toLocaleString(LOCALE, { year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const dayName = (at) => {
  const day = new Date(at).toDateString();
  if (day === new Date().toDateString()) return t('Today');
  if (day === new Date(Date.now() - 86400000).toDateString()) return t('Yesterday');
  return new Date(at).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
};
export const entries = (n) => plural(n, 'entry');
export function elapsed() {
  const start = S.state?.server.matchStart;
  if (!start) return '';
  const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// entries of the match that is running; everything when its start is not known
export const thisMatch = (list) => list.filter((e) => e.at >= (S.state?.server.matchStart || 0));

// ---------- the live state ----------
export const byId = (id) => S.state?.players.find((p) => p.id === id);
export const teamName = (team) => S.state?.server.teams[team - 1] || t('Team {n}', { n: team });
export const squadOf = (p) => S.state.squads.find((s) => s.team === p.team && s.id === p.squad);
export const squadText = (p) => (p.squad === null ? t('no squad') : `${t('squad {n}', { n: p.squad })} ${squadOf(p)?.name || ''}`.trim());
export const kd = (p) => p.kills / Math.max(p.deaths, 1);
export const commanderOf = (team) => S.state.players.find((p) => p.team === team && p.commander);
export const hasLeaderKit = (p) => /(^|[_ ])SL/.test(p.role);
// "sl1", "sq 1" or "squad1" find a squad by its number, anything else a name or an ID
export function matches(p, query) {
  if (!query) return true;
  const squad = /^(?:sl|sq|squad)\s*(\d{1,2})$/.exec(query);
  if (squad) return p.squad === Number(squad[1]) && (!query.startsWith('sl') || p.leader);
  return p.name.toLowerCase().includes(query) || p.id.includes(query) || (p.steamID || '').includes(query);
}

export const mark = (team) => html`<span class="tm ${team === 1 ? 't1' : 't2'}" aria-hidden="true"></span>`;
// commander yellow, squad leader green; the badge says it too, so colour is not the only sign
export const rankBadge = (p) => (p.commander ? html`<span class="cmd" title="${t('Commander')}">CMD</span>` : p.leader ? html`<span class="sl" title="${t('Squad leader')}">SL</span>` : '');
export const nameClass = (p) => (p.commander ? 'n-cmd' : p.leader ? 'n-sl' : '');
export const squadTag = (p) => (p.squad === null ? html`<span class="sqn none" title="${t('No squad')}">-</span>` : html`<span class="sqn" title="${squadText(p)}">${p.squad}</span>`);

const ICONS = {
  warn: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>',
  reply: '<path d="M9 7L4 12l5 5M4 12h10a6 6 0 016 6v1"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>'
};
export const icon = (name, size = 16) => new Safe(`<svg class="ic" aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`);

// ---------- dialog ----------
export const textField = (name, label, presets, required = true) => html`<label>${label}<input class="field" name="${name}" maxlength="300" ${required ? html`required` : ''} autocomplete="off">${presets ? html`<span class="chips">${presets.map((p) => html`<button type="button" class="chip" data-fill="${name}" data-value="${p}" aria-pressed="false">${p}</button>`)}</span>` : ''}</label>`;
export const passwordField = (name, label, autocomplete = 'current-password') => html`<label>${label}<input class="field" type="password" name="${name}" autocomplete="${autocomplete}" maxlength="200" required></label>`;
// asked again for changes that a stolen session alone must not be able to make
export const confirmField = () => passwordField('confirmPassword', t('Your password'));
// a row of choices that fills a hidden field
export const choiceField = (name, label, choices, value) => html`<div class="choice"><span class="lbl">${label}</span><div class="chips">${choices.map(([v, n]) => html`<button type="button" class="chip" data-choose="${name}" data-value="${v}" aria-pressed="${v === value}">${n}</button>`)}</div><input type="hidden" name="${name}" value="${value}"></div>`;

let dialog = null;
// onChoose(name, value, label) may return { text, ok } to change the dialog with the choice
export function ask({ title, text = '', fields = '', body = '', ok = t('Confirm'), danger = false, run, onChoose = null }) {
  dialog = { run, onChoose };
  $('#dlg-act').classList.toggle('risk', danger);
  $('#act-title').textContent = title;
  $('#act-text').textContent = text;
  put($('#act-body'), body);
  put($('#act-fields'), fields);
  $('#act-err').textContent = '';
  $('#act-ok').textContent = ok;
  $('#act-ok').disabled = false;
  $('#dlg-act').showModal();
  // the first text box, so a chip does not look picked and Enter does not press Cancel
  ($('#act-fields input:not([type=hidden])') || $('#act-cancel')).focus();
}
export function wireDialog() {
  $('#act-cancel').addEventListener('click', () => $('#dlg-act').close());
  $('#actform').addEventListener('click', (e) => {
    const fill = e.target.closest('[data-fill]');
    if (fill) { e.preventDefault(); $(`#actform [name="${fill.dataset.fill}"]`).value = fill.dataset.value; }
    const choice = e.target.closest('[data-choose]');
    if (!choice) return;
    $$(`#actform [data-choose="${choice.dataset.choose}"]`).forEach((x) => x.setAttribute('aria-pressed', x === choice));
    $(`#actform [name="${choice.dataset.choose}"]`).value = choice.dataset.value;
    const change = dialog.onChoose?.(choice.dataset.choose, choice.dataset.value, choice.textContent);
    if (change?.text !== undefined) $('#act-text').textContent = change.text;
    if (change?.ok !== undefined) $('#act-ok').textContent = change.ok;
  });
  $('#actform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const missing = $$('[required]', form).find((x) => !x.value.trim());
    if (missing) { $('#act-err').textContent = t('Fill in the empty field.'); missing.focus(); return; }
    $('#act-ok').disabled = true;
    try {
      const result = await dialog.run(Object.fromEntries(new FormData(form)));
      $('#dlg-act').close();
      if (result?.failed?.length) toast(`${t('{done} done, {failed} failed.', { done: result.done, failed: result.failed.length })} ${result.failed[0]}`, true);
      else toast(t('Done.'));
    } catch (err) {
      $('#act-err').textContent = err.message;
      $('#act-ok').disabled = false;
    }
  });
}

// ---------- messages ----------
const RECIPIENTS = [['everyone', t('Everyone'), 'broadcast'], ['team1', t('Team {n}', { n: 1 }), 'message.group'], ['team2', t('Team {n}', { n: 2 }), 'message.group'], ['admins', t('Admins'), 'message.group']];
export const recipients = () => RECIPIENTS.filter(([, , need]) => may(need));
export const recipientName = (to) => RECIPIENTS.find(([v]) => v === to)?.[1] || to;
const TEAM_TEXT = t('Each player of the team gets it on screen as a warning-style message. It is not counted as a warning.');
export const HOW = {
  everyone: t('Everyone sees it at the top of the screen.'), team1: TEAM_TEXT, team2: TEAM_TEXT,
  admins: t('Each admin in the game gets it on screen.'),
  player: t('Only this player sees it, as a warning-style message on screen. It is not counted as a warning.')
};
export const deliverMessage = (to, message) => (to === 'everyone' ? post('broadcast', { message }) : post('messageGroup', { group: to, message }));
export function sendMessage() {
  const list = recipients();
  if (!list.length) return;
  const first = list[0][0];
  ask({ title: t('Send a message'), text: HOW[first], ok: t('Send'), fields: html`${choiceField('to', t('To'), list, first)}${textField('message', t('Message'))}`,
    onChoose: (_, to) => ({ text: HOW[to] }), run: (v) => deliverMessage(v.to, v.message) });
}
// a message to one fixed group, with a text ready to send
export function messageTo(group, title, count, suggestion = '') {
  ask({ title, text: t('Shown on screen to {count}. It is not counted as a warning.', { count: plural(count, 'player') }), ok: t('Send'),
    fields: textField('message', t('Message')), run: (v) => post('messageGroup', { group, message: v.message }) });
  $('#actform [name="message"]').value = suggestion;
}
export function messagePlayer(id) {
  ask({ title: t('Message {who}', { who: byId(id)?.name || t('this player') }), text: HOW.player, ok: t('Send'), fields: textField('message', t('Message')),
    run: (v) => post('messagePlayer', { id, message: v.message }) });
}

// ---------- actions on players ----------
const PRESETS = {
  warn: [t('Follow your squad leader.'), t('No teamkilling. Next one is a kick.'), t('Join a squad within 5 minutes.'), t('Keep the chat clean.')],
  kick: [t('Teamkilling'), t('Toxic chat'), t('Not following the squad leader'), t('Squadless too long')],
  ban: [t('Teamkilling'), t('Toxic chat'), t('Cheating'), t('Ban evasion')]
};
export const BAN_CHOICES = [['1h', t('1 hour')], ['1d', t('1 day')], ['7d', t('7 days')], ['30d', t('30 days')], ['0', t('Permanent')]];
const BAN_NEEDS = { '1h': 'ban.short', '1d': 'ban.short', '7d': 'ban.long', '30d': 'ban.long', 0: 'ban.perm' };
const banWords = (value, label) => (value === '0' ? t('Ban permanently') : t('Ban for {length}', { length: label }));

export function playerAction(action, ids, knownName) {
  if (!ids.length) return;
  const who = ids.length === 1 ? byId(ids[0])?.name || knownName || t('this player') : plural(ids.length, 'player');
  const names = ids.length > 1 ? ids.map((id) => byId(id)?.name || id).join(', ') : '';
  const after = (promise) => promise.then((r) => { app.afterAction(); return r; });
  if (action === 'warn') ask({ title: t('Warn {who}', { who }), text: names || t('Shown on the screen and kept on the player record.'), fields: textField('message', t('Warning'), PRESETS.warn), ok: t('Send warning'), run: (v) => after(post('warn', { ids, message: v.message })) });
  else if (action === 'kick') ask({ title: t('Kick {who}', { who }), text: names, fields: textField('reason', t('Reason (shown to the player)'), PRESETS.kick), ok: t('Kick'), run: (v) => after(post('kick', { ids, reason: v.reason })) });
  else if (action === 'ban') {
    const choices = BAN_CHOICES.filter(([v]) => may(BAN_NEEDS[v]));
    if (!choices.length) return;
    // one day when allowed, otherwise the shortest length there is
    const [first, firstName] = choices.find(([v]) => v === '1d') || choices[0];
    ask({ title: t('Ban {who}', { who }), text: names, ok: banWords(first, firstName), onChoose: (_, value, label) => ({ ok: banWords(value, label) }),
      fields: html`${choiceField('length', t('Length'), choices, first)}${textField('reason', t('Reason (shown to the player)'), PRESETS.ban)}${textField('note', t('Evidence or note (admins only)'), null, false)}`,
      run: (v) => after(post('ban', { ids, length: v.length, reason: v.reason, note: v.note })) });
  } else if (action === 'moveTeam') ask({ title: t('Move {who} to the other team?', { who }), text: names || t('This runs on the live server right away.'), ok: t('Move'), run: () => after(post('moveTeam', { ids })) });
  else if (action === 'removeFromSquad') ask({ title: t('Remove {who} from the squad?', { who }), text: names || t('This runs on the live server right away.'), ok: t('Remove'), run: () => after(post('removeFromSquad', { ids })) });
  else if (action === 'demoteCommander') ask({ title: t('Demote commander {who}?', { who }), text: t('This runs on the live server right away.'), ok: t('Demote'), danger: true, run: () => after(post('demoteCommander', { id: ids[0] })) });
}

export function disbandSquad(team, squad, name) {
  ask({ title: t('Disband squad {n} ({name})?', { n: squad, name }), text: t('Everyone in it is left without a squad. This runs on the live server right away.'), ok: t('Disband'), danger: true, run: () => post('disbandSquad', { team, squad }) });
}

const SHUFFLE_TEXT = { now: [t('Shuffle the teams when this round ends?'), t('Shuffle')], cancel: [t('Cancel the shuffle for this round?'), t('Cancel shuffle')], unlock: [t('Unlock the teams for this round?'), t('Unlock')] };
export function shuffleCommand(command) {
  const [title, ok] = SHUFFLE_TEXT[command] || [t('Run "{command}"?', { command }), t('Run')];
  ask({ title, ok, run: () => post('shuffle', { command }) });
}

// ---------- periods (records, logs and deletion) ----------
export const DAY = 86400000;
const startOfToday = () => new Date().setHours(0, 0, 0, 0);
// "from" is included, "to" is not; a null end is open
export function periodOf(id, start, end) {
  if (id === 'today') return { from: startOfToday(), to: null };
  if (id === '7d') return { from: startOfToday() - 6 * DAY, to: null };
  if (id === '30d') return { from: startOfToday() - 29 * DAY, to: null };
  if (id === 'custom') {
    const at = (text) => (text ? new Date(`${text}T00:00:00`).getTime() : null);
    const from = at(start);
    const last = at(end);
    if (from === null && last === null) return null;
    if (from !== null && last !== null && last < from) throw new Error(t('The end date is before the start date.'));
    return { from, to: last === null ? null : last + DAY };
  }
  return { from: null, to: null };
}
export const periodQuery = ({ from, to }) => `${from === null ? '' : `&from=${from}`}${to === null ? '' : `&to=${to}`}`;
// entries newest first, under one heading per day
export function byDay(entries, row) {
  let last = null;
  return entries.map((e) => {
    const day = dayName(e.at);
    const head = day === last ? '' : html`<li class="dayhead">${day}</li>`;
    last = day;
    return html`${head}${row(e)}`;
  });
}
export function downloadCsv(name, rows) {
  // a leading = + - @ would run as a formula in a spreadsheet
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map((line) => line.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
