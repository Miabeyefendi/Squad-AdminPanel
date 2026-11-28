// The server itself: limits and password, announcements the panel sends, and Discord notices.
// Only the parts the account may change come from the panel; the others are not drawn.
import { $, $$, LOCALE, api, ask, confirmField, guard, html, passwordField, post, put, stamp, t, toast } from '../core.js';

let data = null;
let part = null; // the part shown on the right
let items = []; // announcements as they are on screen

const NOTICES = [['ban', t('Bans')], ['kick', t('Kicks')], ['call', t('!admin calls in chat')], ['warn', t('Warnings')], ['teamkill', t('A player reaching the teamkill limit')], ['match', t('Map changes, match ended or restarted')]];
const WHEN = [['every', t('Every few minutes')], ['matchStart', t('After a match starts')]];

const limitRow = (kind, id, name, help, range) => html`<form class="optrow" data-form="${kind}"><label class="optlabel" for="${id}"><b>${name}</b><span class="sub xs">${help}</span></label><span class="line nowrap"><input id="${id}" class="field mono short" type="number" name="value" ${range} required><button class="btn">${t('Set')}</button></span></form>`;
function limits() {
  const max = data.settings.maxPlayers;
  return html`<div class="tile"><div class="stack2"><h2>${t('Player limits')}</h2><span class="sub xs">${t('Sent to the running server. It may go back to the value in Server.cfg after a restart.')}</span></div>
    <div>${limitRow('maxPlayers', 'sv-max', t('Player limit'), max ? t('Now: {value}', { value: max }) : t('The current value is not known.'), html`min="1" max="100"`)}${limitRow('queueLimit', 'sv-queue', t('Public queue limit'), t('-1 means no limit. The panel cannot read the current value.'), html`min="-1" max="100"`)}</div></div>`;
}

function password() {
  const { blocked } = data.password;
  return html`<div class="tile"><div class="stack2"><h2>${t('Server password')}</h2><span class="sub xs">${t('Players need it to join. The panel does not store, log or show it.')}</span></div>
    ${blocked ? html`<span class="tag warnish wrapany">${t(blocked)}</span>` : html`<div class="line"><button class="btn pri tall" data-password="set">${t('Set a password')}</button><button class="btn tall" data-password="remove">${t('Remove the password')}</button></div>`}</div>`;
}

const row = (item, i) => html`<li class="annrow" data-item="${i}">
    <label class="wide">${t('Message')}<input class="field" name="text" maxlength="300" value="${item.text}"></label>
    <label>${t('When')}<select class="field" name="when">${WHEN.map(([v, n]) => html`<option value="${v}" ${v === item.when ? html`selected` : ''}>${n}</option>`)}</select></label>
    <label>${t('Minutes')}<input class="field mono" type="number" name="minutes" min="0" max="600" value="${item.minutes}"></label>
    <label>${t('Only from this many players')}<input class="field mono" type="number" name="minPlayers" min="1" max="100" value="${item.minPlayers}"></label>
    <span class="annacts"><label class="tick"><input type="checkbox" name="enabled" ${item.enabled ? html`checked` : ''}>${t('On')}</label><button type="button" class="btn ghost small" data-remove="${i}">${t('Remove')}</button></span></li>`;

function announcements() {
  return html`<div class="tile"><div class="stack2"><h2>${t('Automatic announcements')}</h2><span class="sub xs">${t('Shown to everyone at the top of the screen. At least 5 minutes between repeats and 1 minute between two automatic messages. Nothing is sent while fewer players are on.')}</span></div>
    <form data-form="schedule" class="stack16" novalidate><ul class="annlist">${items.length ? items.map(row) : html`<li class="empty">${t('No announcements yet.')}</li>`}</ul>
    <div class="line"><button type="button" class="btn" data-add ${items.length >= 20 ? html`disabled` : ''}>${t('Add an announcement')}</button><button class="btn pri">${t('Save announcements')}</button></div></form></div>`;
}

function discord() {
  const n = data.notify;
  return html`<div class="tile"><div class="stack2"><h2>${t('Discord notices')}</h2><span class="sub xs">${t('One way only: nothing in Discord can control the server. When on, player names and the text of !admin calls go to your Discord channel. IP addresses, sign ins and admin notes are never sent.')}</span></div>
    ${n.problem ? html`<span class="tag warnish wrapany" role="alert">${t(n.problem)}</span>` : ''}
    <form data-form="notify" class="stack16" novalidate autocomplete="off">
      <label class="tick"><input type="checkbox" name="enabled" ${n.enabled ? html`checked` : ''}><b>${t('Send notices to Discord')}</b></label>
      <div class="ruleform">
        <label class="wide">${t('Webhook address')}<input class="field" type="password" name="url" autocomplete="new-password" placeholder="${n.set ? t('Saved, ends in {tail}. Type to replace.', { tail: n.tail }) : 'https://discord.com/api/webhooks/…'}"></label>
        <label>${t('Role ID to ping on !admin (optional)')}<input class="field mono" name="roleId" inputmode="numeric" value="${n.roleId}"></label>
        <label>${t('Teamkill limit for a notice')}<input class="field mono" type="number" name="tkAt" min="1" max="100" value="${n.tkAt}"></label>
      </div>
      <fieldset><legend>${t('What to send')}</legend><div class="picks">${NOTICES.map(([k, label]) => html`<label><input type="checkbox" name="event" value="${k}" ${n.events[k] ? html`checked` : ''}>${label}</label>`)}</div></fieldset>
      <div class="line"><button class="btn pri">${t('Save…')}</button>${n.set ? html`<button type="button" class="btn" data-test>${t('Send a test message')}</button><button type="button" class="btn ghost" data-forget>${t('Delete the address')}</button>` : ''}
        <span class="sub xs">${n.lastSent ? t('Last sent {time}', { time: stamp(n.lastSent) }) : ''}${n.dropped ? ` · ${t('Not delivered: {n}', { n: n.dropped.toLocaleString(LOCALE) })}` : ''}</span></div>
    </form></div>`;
}

// id, name, the data it needs, what it draws and the short state shown in the list
const PARTS = [
  ['limits', t('Player limits'), 'settings', limits, () => data.settings.maxPlayers || ''],
  ['password', t('Server password'), 'password', password, () => ''],
  ['schedule', t('Automatic announcements'), 'schedule', announcements, () => data.schedule.length],
  ['discord', t('Discord notices'), 'notify', discord, () => (data.notify.enabled ? t('On') : t('Off'))]
];
const mine = () => PARTS.filter(([, , key]) => data[key]);
function sideList() {
  if (!mine().some(([id]) => id === part)) part = mine()[0]?.[0] || null;
  put($('#sv-list'), mine().map(([id, name, , , state]) => html`<button type="button" role="tab" class="sideitem" data-part="${id}" aria-selected="${id === part}"><span class="grow">${name}</span><span class="sub xs">${state()}</span></button>`));
  PARTS.forEach(([id]) => { $(`#sv-${id}`).hidden = id !== part; });
}
// every part stays in the page, so what was typed in one is still there after looking at another
function render() {
  if (!data) return;
  PARTS.forEach(([id, , key, view]) => put($(`#sv-${id}`), data[key] ? view() : ''));
  sideList();
}
// what is typed is read back before the list is drawn again
function readItems() {
  $$('#sv-schedule [data-item]').forEach((li) => {
    const get = (name) => li.querySelector(`[name="${name}"]`);
    Object.assign(items[li.dataset.item], { text: get('text').value, when: get('when').value, minutes: Number(get('minutes').value), minPlayers: Number(get('minPlayers').value), enabled: get('enabled').checked });
  });
}
function show(fresh) {
  data = fresh;
  items = (data.schedule || []).map((i) => ({ ...i }));
  render();
}
const change = async (body) => show(await api('/api/server', body));

function notifyChange(form) {
  const url = form.elements.url.value.trim();
  return {
    enabled: form.elements.enabled.checked,
    ...(url ? { url } : {}),
    roleId: form.elements.roleId.value.trim(),
    tkAt: Number(form.elements.tkAt.value),
    events: Object.fromEntries($$('input[name=event]', form).map((x) => [x.value, x.checked]))
  };
}

export default {
  id: 'server',
  title: t('Server'),
  shell: () => html`<div class="navsplit wide-list"><div class="sidelist listcol" id="sv-list" role="tablist" aria-label="${t('Server')}"></div>
    <div class="stackcol"><div id="sv-limits"></div><div id="sv-password"></div><div id="sv-schedule"></div><div id="sv-discord"></div></div></div>`,
  wire(root) {
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const kind = form.dataset.form;
      if (kind === 'schedule') {
        readItems();
        guard(async () => { await change({ op: 'schedule', items }); toast(t('Saved.')); })();
      } else if (kind === 'notify') {
        const body = notifyChange(form);
        ask({ title: t('Save the Discord settings?'), fields: confirmField(), ok: t('Save'), run: (v) => change({ op: 'notify', change: body, confirmPassword: v.confirmPassword }) });
      } else if (kind) {
        const value = Number(form.elements.value.value);
        if (form.elements.value.value === '') return;
        ask({ title: kind === 'maxPlayers' ? t('Set the player limit to {value}?', { value }) : t('Set the queue limit to {value}?', { value }), text: t('This runs on the live server right away.'), ok: t('Set'), run: async () => { await post(kind, { value }); form.reset(); } });
      }
    });
    root.addEventListener('click', guard(async (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const d = b.dataset;
      if (d.part) {
        part = d.part;
        sideList();
      } else if (d.add !== undefined) {
        readItems();
        items.push({ text: '', when: 'every', minutes: 15, minPlayers: 1, enabled: true });
        render();
        $('#sv-schedule li:last-child input[name=text]')?.focus();
      } else if (d.remove !== undefined) {
        readItems();
        items.splice(Number(d.remove), 1);
        render();
      } else if (d.test !== undefined) {
        b.disabled = true;
        try {
          await change({ op: 'notifyTest' });
          toast(t('Test message sent.'));
        } finally {
          b.disabled = false;
        }
      } else if (d.forget !== undefined) {
        ask({ title: t('Delete the webhook address?'), fields: confirmField(), ok: t('Delete'), danger: true, run: (v) => change({ op: 'notify', change: { enabled: false, url: '' }, confirmPassword: v.confirmPassword }) });
      } else if (d.password === 'set') {
        ask({ title: t('Set the server password?'), text: t('No spaces or quotes, up to 32 characters.'), ok: t('Set'),
          fields: html`${passwordField('serverPassword', t('New server password'), 'new-password')}${confirmField()}`,
          run: (v) => change({ op: 'password', password: v.serverPassword, confirmPassword: v.confirmPassword }) });
      } else if (d.password === 'remove') {
        ask({ title: t('Remove the server password?'), text: t('Anyone can then join.'), ok: t('Remove'), danger: true, fields: confirmField(),
          run: (v) => change({ op: 'password', password: '', confirmPassword: v.confirmPassword }) });
      }
    }));
  },
  open: guard(async () => show(await api('/api/server'))),
  render() {},
  log() {},
  reload() {},
  reset() { data = null; items = []; part = null; }
};
