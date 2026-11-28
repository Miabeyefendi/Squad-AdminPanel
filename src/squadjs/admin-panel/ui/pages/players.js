// Squads of both teams on the left, the live chat on the right, and the card of one player.
import { $, HOW, S, api, ask, byId, clock, deliverMessage, disbandSquad, draw, guard, html, icon, mark, matches, may, messagePlayer, nameClass, playerAction, plural, post, put, rankBadge, recipientName, recipients, squadText, stamp, t, tAction, teamName, toast, thisMatch, tkLine } from '../core.js';
import { commanderStrip, teamHead } from './score.js';

// ---------- squads ----------
const playerRow = (p, extra) => html`<li><button class="pr" data-player="${p.id}"><span class="pname">${rankBadge(p)}<span class="${nameClass(p)}">${p.name}</span></span><span class="pr-side"><span class="sub xs">${extra || p.role}</span>${p.notes ? html`<span class="tag mini" title="${t('Notes on record')}">${p.notes}</span>` : ''}</span></button></li>`;
function teamColumn(team, q) {
  const members = S.state.players.filter((p) => p.team === team);
  const squads = S.state.squads.filter((s) => s.team === team).sort((a, b) => a.id - b.id);
  const cards = squads.map((s) => {
    const inside = members.filter((p) => p.squad === s.id).sort((a, b) => b.commander - a.commander || b.leader - a.leader);
    const shown = inside.filter((p) => matches(p, q));
    if (q && !shown.length) return '';
    return html`<div class="squad s${team}"><div class="sqh"><span class="sqn big-n">${s.id}</span><b class="grow">${s.name}</b>${s.locked ? html`<span class="tag mini">${t('locked')}</span>` : ''}<span class="sub xs mono">${inside.length}/9</span>${may('squad.disband') ? html`<button class="btn ghost small" data-disband="${team}:${s.id}" data-key="d${team}-${s.id}">${t('Disband')}</button>` : ''}</div><ul>${shown.map((p) => playerRow(p))}</ul></div>`;
  });
  const loose = members.filter((p) => p.squad === null && matches(p, q));
  return html`<div class="teambox t${team}">${teamHead(team)}${commanderStrip(team)}</div>
    ${cards}${loose.length ? html`<div class="squad s${team}"><div class="sqh"><b class="grow">${t('Not in a squad')}</b><span class="sub xs">${loose.length}</span></div><ul>${loose.map((p) => playerRow(p, t('{n} min', { n: p.minutes })))}</ul></div>` : ''}`;
}

// ---------- players who left ----------
let recent = [];
function recentList() {
  return html`<div class="th"><h2>${t('Recently left')}</h2><span class="sub xs">${t('Last 30 minutes. A ban is sent to the game, which may refuse it for a player who is gone.')}</span></div>
    <ul class="feed">${recent.map((r) => html`<li><span class="sub xs mono">${clock(r.at)}</span><span class="grow">${r.id ? html`<button class="linkbtn" data-player="${r.id}">${r.name}</button>` : r.name}
      ${r.teamkills ? html` <span class="tag mini solid">${r.teamkills} TK</span>` : ''}${r.warns || r.kicks || r.bans ? html` <span class="sub xs">${plural(r.warns, 'warning')} · ${plural(r.kicks, 'kick')} · ${plural(r.bans, 'ban')}</span>` : ''}</span>${r.id && may('ban') ? html`<button class="btn small" data-banleft="${r.id}">${t('Ban')}</button>` : ''}</li>`)}</ul>`;
}
const loadRecent = guard(async () => {
  recent = await api('/api/recent');
  renderRecent();
});
function renderRecent() {
  const box = $('#pl-recent');
  box.hidden = !recent.length;
  draw(box, recent.length ? recentList() : '');
}

// ---------- chat ----------
const CHANNELS = [['', t('Everything')], ['All', t('All chat')], ['Team', t('Team')], ['Squad', t('Squad')], ['Admin', t('Admin')]];
let channel = '';
let target = null; // one player the next message goes to
// only things that happen in the game or to a player; panel settings stay in the logs page
const IN_GAME = /^(Warn|Kick|Ban|Message|Move|Remove from|Disband|Demote|Next|Change layer|End|Restart match|Smart Shuffle$)/;
const EVENT_TEXT = {
  tk: (r) => html`${tkLine(r)} <span class="xs">(${r.weapon})</span>`,
  conn: (r) => (r.event === 'Joined' ? t('{player} joined', r) : t('{player} left', r)),
  admin: (r) => `${r.by}: ${tAction(r.action)} ${r.target}${r.reason ? ` (${r.reason})` : ''}`
};
function chatList() {
  const messages = S.logs.chat.filter((m) => !channel || m.channel === channel);
  const system = channel ? [] : ['tk', 'conn', 'admin'].flatMap((k) => S.logs[k].filter((r) => k !== 'admin' || IN_GAME.test(r.action)));
  const rows = [...messages, ...system].sort((a, b) => a.at - b.at).slice(-200);
  const note = may('chat.view') ? '' : html`<li class="sys"><span>${t('You do not have permission to read chat. Events are still shown.')}</span></li>`;
  const line = (r) => {
    const p = byId(r.id);
    return html`<li><span class="meta"><span class="mono sub">${clock(r.at)}</span><span class="tag mini ${r.channel === 'Admin' ? 'solid' : ''}">${t(r.channel)}</span><button class="who-n ${p ? nameClass(p) : ''}" data-player="${r.id}">${p ? mark(p.team) : ''} ${r.player}</button>${p ? html`<span class="sub xs">SQ ${p.squad ?? '-'}</span>` : ''}${p && may('message.group') ? html`<button class="replybtn" data-reply="${p.id}" aria-label="${t('Message {name} only', { name: p.name })}" title="${t('Message only this player')}">${icon('reply', 15)}</button>` : ''}</span><span class="msg ${/^!admin\b/i.test(r.message) ? 'call' : ''}">${r.message}</span></li>`;
  };
  return [note, ...rows.map((r) => (r.kind === 'chat' ? line(r) : html`<li class="sys"><span class="meta"><span class="mono">${clock(r.at)}</span></span><span class="msg">${EVENT_TEXT[r.kind](r)}</span></li>`))];
}
function renderChat(toEnd = false) {
  const box = $('#chat');
  const atEnd = toEnd || box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const changed = draw(box, chatList());
  if ((changed || toEnd) && atEnd) box.scrollTop = box.scrollHeight;
}
// "To" is a short list of groups; one player is picked by pressing reply on their message
function renderTarget() {
  const player = target && byId(target.id);
  if (target && !player) { toast(t('{player} left the server.', { player: target.name }), true); target = null; }
  const groups = recipients();
  $('#chatform').hidden = !groups.length;
  $('#chatone').hidden = !target;
  $('#chatto').hidden = !!target;
  if (target) draw($('#chatone'), html`<span class="tag solid">${t('Only {name}', { name: target.name })}</span><button type="button" class="btn ghost small" data-untarget aria-label="${t('Send to a group instead')}">${t('Cancel')}</button>`);
  const value = $('#chatto').value;
  if (draw($('#chatto'), groups.map(([v, n]) => html`<option value="${v}">${t('To: {name}', { name: n })}</option>`)) && value) $('#chatto').value = value;
}
function send(e) {
  e.preventDefault();
  const message = $('#chatmsg').value.trim();
  if (!message) return;
  const one = target;
  const to = $('#chatto').value;
  ask({ title: t('Send to {name}?', { name: one ? one.name : recipientName(to) }), text: `${message}  ·  ${HOW[one ? 'player' : to]}`, ok: t('Send'), run: async () => {
    const result = await (one ? post('messagePlayer', { id: one.id, message }) : deliverMessage(to, message));
    $('#chatmsg').value = '';
    return result;
  } });
}

// ---------- player card ----------
const KIND_NAME = { warn: t('Warning'), kick: t('Kick'), ban: t('Ban'), note: t('Note') };
export const kindTag = (type) => html`<span class="tag ${type === 'ban' || type === 'kick' ? 'solid' : ''}">${KIND_NAME[type] || type}</span>`;
// everything on record, newest first
function timeline(record) {
  const rows = [...(record.history || []), ...record.notes.map((n) => ({ at: n.at, type: 'note', by: n.by, reason: n.text }))].sort((a, b) => b.at - a.at);
  if (!rows.length) return html`<span class="sub">${t('Nothing on record.')}</span>`;
  return html`<div class="timeline">${rows.map((e) => html`<div class="note"><span class="sub xs">${kindTag(e.type)} ${stamp(e.at)} · ${e.by}${e.detail ? ` · ${e.detail}` : ''}</span><span class="wrapany">${e.reason}</span></div>`)}</div>`;
}
let cardId = null;
// the teamkills of this match the player was on either end of
function teamkillsOf(id) {
  const rows = may('kills.view') ? thisMatch(S.logs.tk).filter((r) => r.id === id || r.victimId === id).slice(-8).reverse() : [];
  return rows.length ? html`<div class="stack8"><h3>${t('Teamkills this match')}</h3><ul class="feed">${rows.map((r) => html`<li><span class="sub xs mono">${clock(r.at)}</span><span class="grow">${tkLine(r)}</span><span class="sub xs">${r.weapon}</span></li>`)}</ul></div>` : '';
}
export async function openPlayer(id) {
  cardId = id;
  const record = await api(`/api/player?id=${encodeURIComponent(id)}`);
  const p = byId(id);
  const name = p?.name || record.name || id;
  const stats = p ? [[t('Kills'), p.kills], [t('Downs'), p.downs], [t('Deaths'), p.deaths], [t('Revives'), p.revives], [t('Teamkills'), p.teamkills], [t('Damage'), p.damage]] : [];
  const NEED = { message: 'message.group', warn: 'warn', moveTeam: 'team.move', removeFromSquad: 'squad.remove', demoteCommander: 'commander.demote', kick: 'kick', ban: 'ban' };
  const button = (label, action, cls = '', online = false) => (may(NEED[action])
    ? html`<button class="btn tall ${cls}" data-card="${action}" ${online && !p ? html`disabled` : ''}>${label}</button>` : '');
  put($('#playercard'), html`
    <div class="cardhead"><div class="stack2"><span class="cap">${t('Player')}</span><h2 id="pn">${p ? rankBadge(p) : ''}<span class="${p ? nameClass(p) : ''}">${name}</span></h2><div class="idrow"><button class="btn small" data-copy="${id}">${t('Copy EOS ID')}</button>${p?.steamID ? html`<button class="btn small" data-copy="${p.steamID}">${t('Copy Steam ID')}</button>` : ''}</div><span class="sub xs">${p ? `${t('Team {n}', { n: p.team })} ${teamName(p.team)} · ${squadText(p)} · ${p.role}` : t('Not on the server. The game may refuse a kick or ban now; you will see its answer.')}</span></div><button class="btn ghost" data-close aria-label="${t('Close')}" autofocus>${t('Close')}</button></div>
    ${stats.length ? html`<div class="stats">${stats.map(([a, b]) => html`<div class="stat"><span class="sub xs">${a}</span><span class="mono statv">${b}</span></div>`)}</div>` : ''}
    ${teamkillsOf(id)}
    ${record.hidden ? html`<span class="sub">${t('You do not have permission to read player history and notes.')}</span>` : html`<div class="line"><span class="tag">${plural(record.warns, 'warning')}</span><span class="tag">${plural(record.kicks, 'kick')}</span><span class="tag">${plural(record.bans, 'ban')}</span>${record.firstSeen ? html`<span class="tag">${t('first seen {time}', { time: stamp(record.firstSeen) })}</span>` : ''}</div>
    <div class="stack8"><h3>${t('History')}</h3>${timeline(record)}</div>`}
    ${may('notes.add') ? html`<form id="noteform" class="noteform"><label class="sr" for="nt">${t('New note')}</label><input id="nt" class="field grow" maxlength="300" placeholder="${t('Add a note (admins only)')}"><button class="btn">${t('Add note')}</button></form>` : ''}
    <div class="stack8"><h3>${t('Actions')}</h3><div class="acts">${button(t('Message'), 'message', '', true)}${button(t('Warn'), 'warn', '', true)}${button(t('Move team'), 'moveTeam', '', true)}${button(t('Remove from squad'), 'removeFromSquad', '', true)}${p?.commander ? button(t('Demote commander'), 'demoteCommander', '', true) : ''}${button(t('Kick'), 'kick', 'danger', true)}${button(t('Ban'), 'ban', 'pri')}</div></div>`);
  if (!$('#dlg-player').open) $('#dlg-player').showModal();
}
export function wireCard() {
  $('#playercard').addEventListener('click', guard(async (e) => {
    if (e.target.closest('[data-close]')) $('#dlg-player').close();
    const action = e.target.closest('[data-card]')?.dataset.card;
    if (action === 'message') messagePlayer(cardId);
    else if (action) playerAction(action, [cardId]);
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      await navigator.clipboard.writeText(copy.dataset.copy);
      toast(t('Copied.'));
    }
  }));
  $('#playercard').addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const text = $('#nt').value.trim();
    if (!text) return;
    await post('note', { id: cardId, text });
    await openPlayer(cardId);
  }));
}

export default {
  id: 'players',
  title: t('Players & squads'),
  shell: () => html`<div class="playersgrid">
    <div class="stackcol">
      <div class="toolbar"><label class="sr" for="pl-q">${t('Search players')}</label><input id="pl-q" class="field search" type="search" placeholder="${t('Name, ID or squad (sl1, sq3)')}"><span class="sub xs">${t('Click a player to open the card')}</span></div>
      <div class="teamcols"><div class="teamcol" id="team1col"></div><div class="teamcol" id="team2col"></div></div>
      <div class="tile" id="pl-recent" hidden></div>
    </div>
    <aside class="tile chatcol" aria-label="${t('Live chat')}">
      <div class="th"><h2>${t('Live chat')}</h2></div>
      <div class="chips small" role="group" aria-label="${t('Chat channels')}">${CHANNELS.map(([v, n]) => html`<button type="button" class="chip" data-ch="${v}" aria-pressed="${v === channel}">${n}</button>`)}</div>
      <ul class="chatlog" id="chat" aria-live="polite"></ul>
      <form class="chatin" id="chatform"><div class="chatto"><label class="sr" for="chatto">${t('Send to')}</label><select class="field" id="chatto"></select><span id="chatone" class="line" hidden></span></div><div class="line nowrap"><label class="sr" for="chatmsg">${t('Message')}</label><input id="chatmsg" class="field grow" placeholder="${t('Write a message')}" maxlength="300" autocomplete="off"><button class="btn pri">${t('Send')}</button></div></form>
    </aside>
  </div>`,
  wire(root) {
    root.addEventListener('input', (e) => { if (e.target.id === 'pl-q') this.render(); });
    root.addEventListener('submit', send);
    root.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-ch]');
      if (tab) {
        channel = tab.dataset.ch;
        root.querySelectorAll('[data-ch]').forEach((x) => x.setAttribute('aria-pressed', x === tab));
        renderChat(true);
      }
      const reply = e.target.closest('[data-reply]');
      if (reply) {
        target = { id: reply.dataset.reply, name: byId(reply.dataset.reply)?.name || t('this player') };
        renderTarget();
        $('#chatmsg').focus();
      }
      if (e.target.closest('[data-untarget]')) { target = null; renderTarget(); $('#chatmsg').focus(); }
      const disband = e.target.closest('[data-disband]');
      if (disband) {
        const [team, squad] = disband.dataset.disband.split(':').map(Number);
        disbandSquad(team, squad, S.state.squads.find((s) => s.team === team && s.id === squad)?.name || '');
      }
      const left = e.target.closest('[data-banleft]');
      if (left) playerAction('ban', [left.dataset.banleft], recent.find((r) => r.id === left.dataset.banleft)?.name);
    });
  },
  open() { this.render(); renderChat(true); renderRecent(); loadRecent(); },
  render() {
    if (!S.state) return;
    const q = $('#pl-q').value.trim().toLowerCase();
    draw($('#team1col'), teamColumn(1, q));
    draw($('#team2col'), teamColumn(2, q));
    renderTarget();
    renderChat();
  },
  log(entry) { renderChat(); if (entry.kind === 'conn') loadRecent(); },
  reload() { renderChat(true); loadRecent(); },
  reset() { channel = ''; target = null; cardId = null; recent = []; $('#playercard').textContent = ''; }
};
