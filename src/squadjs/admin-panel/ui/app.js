// The shell: sign in, navigation, the header, the live stream and what an account may see.
import { $, $$, LOG_KINDS, S, api, app, ask, elapsed, gate, guard, html, may, messagePlayer, passwordField, playerAction, post, put, sendMessage, t, thisMatch, toast, wireDialog } from './core.js';
import overview from './pages/overview.js';
import score, { selected } from './pages/score.js';
import killfeed from './pages/killfeed.js';
import players, { openPlayer, wireCard } from './pages/players.js';
import map from './pages/map.js';
import shuffle from './pages/shuffle.js';
import rules from './pages/rules.js';
import plugins from './pages/plugins.js';
import { logs, records } from './pages/records.js';
import { ranksPage, staffPage } from './pages/staff.js';
import serverPage from './pages/server.js';

// build tag
Object.defineProperty(window, Symbol.for('sa.build'), { value: String.fromCharCode(77, 105, 97, 98, 101, 121, 101, 102, 101, 110, 100, 105) });

const PAGES = Object.fromEntries([overview, score, killfeed, players, map, shuffle, rules, plugins, serverPage, records, logs, staffPage, ranksPage]
  .map((p) => [p.id, p]));
// pages that need a permission; the others are for everyone who is signed in
const NEEDS = { killfeed: 'kills.view', rules: 'rules.view', plugins: 'plugins', staff: 'staff', ranks: 'ranks.edit', records: 'records', server: 'server' };
let events = null;

const page = () => PAGES[S.view];
// empties every page: nothing read for one account or permission stays in the document
function rebuild() {
  for (const p of Object.values(PAGES)) {
    p.reset();
    put($(`#view-${p.id}`), p.shell());
  }
}

// ---------- header ----------
function renderHeader() {
  if (!S.state) return;
  const { server } = S.state;
  $('#subtitle').textContent = [server.name, server.layer?.name || t('Unknown layer'), elapsed()].filter(Boolean).join(' · ');
  $('#pcount').textContent = `${server.players} / ${server.maxPlayers}`;
  $('#pqueue').textContent = t('Queue {n}', { n: server.queue });
  const teamkills = thisMatch(S.logs.tk).length;
  $('#tkcount').hidden = !teamkills;
  $('#tkcount').textContent = `${teamkills} TK`;
}
setInterval(() => {
  renderHeader();
  const time = $('#ov-time');
  if (time && S.state) time.textContent = elapsed() || t('Match time unknown');
}, 1000);

// A redraw between press and release would swallow the click, so it waits for the release.
let pressed = false;
let stale = false;
function render() {
  if (!S.state) return;
  if (pressed) { stale = true; return; }
  renderHeader();
  page().render();
}
function release() {
  if (!pressed) return;
  pressed = false;
  if (stale) { stale = false; setTimeout(render, 0); }
}
document.addEventListener('pointerdown', () => { pressed = true; }, true);
for (const type of ['pointerup', 'pointercancel', 'dragend']) document.addEventListener(type, release, true);
window.addEventListener('blur', release);

// ---------- navigation ----------
function allowed(view) {
  if (view === 'logs') return true;
  return !NEEDS[view] || may(NEEDS[view]);
}
function show(view) {
  S.view = PAGES[view] && allowed(view) ? view : 'overview';
  $$('.nb').forEach((x) => (x.dataset.view === S.view ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current')));
  $$('.view').forEach((x) => x.classList.toggle('on', x.id === `view-${S.view}`));
  $('#vtitle').textContent = page().title;
  window.scrollTo(0, 0);
  renderHeader();
  page().open();
  gate($(`#view-${S.view}`));
}

// ---------- clicks that mean the same everywhere ----------
function wireGlobal() {
  $$('.nb').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) show(go.dataset.go);
    const golog = e.target.closest('[data-golog]');
    if (golog) logs.showKind(golog.dataset.golog);
    // a tick box or a button of its own inside a row is not a click on the player
    const open = e.target.closest('[data-player]');
    if (open && !e.target.closest('input, .check, [data-reply]')) guard(openPlayer)(open.dataset.player);
    const act = e.target.closest('[data-act]');
    if (!act || act.disabled) return;
    const name = act.dataset.act;
    if (name === 'message') sendMessage();
    else if (name === 'messagePlayer') messagePlayer(act.dataset.id);
    else if (name === 'endMatch') ask({ title: t('End the match now?'), text: t('The round ends for everyone.'), ok: t('End match'), danger: true, run: () => post('endMatch') });
    else if (name === 'restartMatch') ask({ title: t('Restart the match now?'), text: t('Everyone starts this layer again.'), ok: t('Restart match'), danger: true, run: () => post('restartMatch') });
    else playerAction(name, [act.dataset.id]);
  });
}

// ---------- theme ----------
function applyTheme(t) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  $$('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.themeSet === t));
  try { localStorage.setItem('sa-theme', t); } catch { /* private window */ }
}
function wireTheme() {
  let saved = 'system';
  try { saved = localStorage.getItem('sa-theme') || 'system'; } catch { /* private window */ }
  applyTheme(saved);
  $$('[data-theme-set]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeSet)));
}

// ---------- what this account may see ----------
function showMe() {
  $('#me-name').textContent = S.me.name;
  $('#me-role').textContent = t(S.me.rankName);
  $('#firstpw').hidden = !S.me.defaultPassword;
}
function applyAccess() {
  gate($('#app'));
  if (!allowed(S.view)) S.view = 'overview';
}
async function loadLogs() {
  const loaded = await Promise.all(LOG_KINDS.map((k) => api(`/api/logs?kind=${k}`)));
  LOG_KINDS.forEach((k, i) => { S.logs[k] = loaded[i]; });
}
// a higher rank changed what this account can do while the page was open
async function accessChanged(user) {
  S.me = user;
  $$('dialog[open]').forEach((d) => d.close());
  $('#playercard').textContent = '';
  showMe();
  rebuild();
  applyAccess();
  await loadLogs();
  show(S.view);
  toast(t('Your permissions changed.'));
}

// Author: Miabeyefendi
// ---------- live data ----------
function setLive(on) {
  $('#livedot').classList.toggle('off', !on);
  $('#livetext').textContent = on ? t('Live') : t('Reconnecting');
}
function connect() {
  events?.close();
  events = new EventSource('/api/events');
  events.addEventListener('state', (e) => { S.state = JSON.parse(e.data); setLive(true); render(); });
  events.addEventListener('me', (e) => guard(accessChanged)(JSON.parse(e.data)));
  events.addEventListener('reload', guard(async () => {
    await loadLogs();
    renderHeader();
    page().reload();
  }));
  events.addEventListener('log', (e) => {
    const entry = JSON.parse(e.data);
    S.logs[entry.kind].push(entry);
    if (S.logs[entry.kind].length > 500) S.logs[entry.kind].shift();
    renderHeader();
    page().log(entry);
  });
  events.onopen = () => setLive(true);
  events.onerror = () => {
    setLive(false);
    // the browser retries by itself; this only checks whether the session is still valid
    api('/api/me').catch(() => {});
  };
}

// ---------- sign in ----------
function closeStream() {
  events?.close();
  events = null;
}
function showSetup(name) {
  closeStream();
  $$('dialog[open]').forEach((d) => d.close());
  $('#app').hidden = true;
  $('#login').hidden = true;
  $('#setup').hidden = false;
  $('#setupform').elements.name.value = name;
}
function signedOut() {
  closeStream();
  S.me = null;
  S.state = null;
  S.view = 'overview';
  S.assets = { maps: [], screens: [], factions: [] };
  LOG_KINDS.forEach((k) => { S.logs[k] = []; });
  // nothing of the last user stays in the page
  rebuild();
  $$('dialog[open]').forEach((d) => d.close());
  ['#playercard', '#act-body', '#act-fields', '#toasts', '#subtitle', '#me-name', '#me-role'].forEach((s) => { $(s).textContent = ''; });
  document.title = t('Sign in');
  $('#setup').hidden = true;
  $('#app').hidden = true;
  $('#login').hidden = false;
}
async function start(user) {
  S.me = user;
  if (user.mustChange) { showSetup(user.name); return; }
  document.title = 'Squad Admin Panel';
  $('#login').hidden = true;
  $('#setup').hidden = true;
  $('#app').hidden = false;
  showMe();
  rebuild();
  applyAccess();
  await loadLogs();
  S.assets = await api('/api/assets').catch(() => S.assets);
  S.state = await api('/api/state');
  connect();
  show(S.view);
}
function wireAccount() {
  $('#setupform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = form.elements;
    $('#setuperr').textContent = '';
    if (f.newPassword.value !== f.repeat.value) { $('#setuperr').textContent = t('The two new passwords differ.'); return; }
    try {
      const user = await api('/api/account', { name: f.name.value, currentPassword: f.currentPassword.value, newPassword: f.newPassword.value });
      form.reset();
      await start(user);
    } catch (err) {
      $('#setuperr').textContent = t(err.message);
    }
  });
  $('#loginform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    $('#loginerr').textContent = '';
    try {
      const user = await api('/api/login', { name: form.name.value, password: form.password.value });
      form.reset();
      await start(user);
    } catch (err) {
      $('#loginerr').textContent = err.message;
    }
  });
  const signOut = guard(async () => { await api('/api/logout', {}); signedOut(); });
  $('#signout').addEventListener('click', signOut);
  $('#setupout').addEventListener('click', signOut);
  $('#firstpw-change').addEventListener('click', () => $('#myaccount').click());
  $('#myaccount').addEventListener('click', () => ask({ title: t('My account'), text: t('Change your user name, your password or both. Other places where you are signed in are signed out.'), ok: t('Save'),
    fields: html`<label>${t('User name')}<input class="field" name="name" maxlength="32" autocomplete="username" value="${S.me.name}" required></label>${passwordField('currentPassword', t('Current password'))}<label>${t('New password (empty keeps the old one)')}<input class="field" type="password" name="newPassword" autocomplete="new-password" maxlength="200"></label><label>${t('New password again')}<input class="field" type="password" name="repeat" autocomplete="new-password" maxlength="200"></label>`,
    run: async (v) => {
      if (v.newPassword !== v.repeat) throw new Error(t('The two new passwords differ.'));
      S.me = await api('/api/account', { name: v.name, currentPassword: v.currentPassword, newPassword: v.newPassword });
      showMe();
      connect(); // the old session is gone, the stream has to use the new one
    } }));
}

Object.assign(app, {
  show,
  render,
  signedOut,
  mustChange: showSetup,
  afterAction: () => { selected.clear(); render(); }
});
wireTheme();
wireDialog();
wireGlobal();
wireAccount();
wireCard();
for (const p of Object.values(PAGES)) {
  put($(`#view-${p.id}`), p.shell());
  p.wire($(`#view-${p.id}`));
}
api('/api/me').then(start).catch(signedOut);
