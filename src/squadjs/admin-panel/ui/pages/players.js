// Squads of both teams on the left, the live chat on the right, and the card of one player.
import { $, HOW, S, api, ask, byId, clock, deliverMessage, draw, guard, html, icon, mark, matches, may, messagePlayer, nameClass, playerAction, plural, post, put, rankBadge, recipientName, recipients, squadText, stamp, teamName, toast } from '../core.js';
import { commanderStrip, teamHead } from './score.js';

// ---------- squads ----------
const playerRow = (p, extra) => html`<li><button class="pr" data-player="${p.id}"><span class="pname">${rankBadge(p)}<span class="${nameClass(p)}">${p.name}</span></span><span class="pr-side"><span class="sub xs">${extra || p.role}</span>${p.notes ? html`<span class="tag mini" title="Notes on record">${p.notes}</span>` : ''}</span></button></li>`;
function teamColumn(t, q) {
  const members = S.state.players.filter((p) => p.team === t);
  const squads = S.state.squads.filter((s) => s.team === t).sort((a, b) => a.id - b.id);
  const cards = squads.map((s) => {
    const inside = members.filter((p) => p.squad === s.id).sort((a, b) => b.commander - a.commander || b.leader - a.leader);
    const shown = inside.filter((p) => matches(p, q));
    if (q && !shown.length) return '';
    return html`<div class="squad s${t}"><div class="sqh"><span class="sqn big-n">${s.id}</span><b class="grow">${s.name}</b>${s.locked ? html`<span class="tag mini">locked</span>` : ''}<span class="sub xs mono">${inside.length}/9</span></div><ul>${shown.map((p) => playerRow(p))}</ul></div>`;
  });
  const loose = members.filter((p) => p.squad === null && matches(p, q));
  return html`<div class="teambox t${t}">${teamHead(t)}${commanderStrip(t)}</div>
    ${cards}${loose.length ? html`<div class="squad s${t}"><div class="sqh"><b class="grow">Not in a squad</b><span class="sub xs">${loose.length}</span></div><ul>${loose.map((p) => playerRow(p, `${p.minutes} min`))}</ul></div>` : ''}`;
}

// ---------- chat ----------
const CHANNELS = [['', 'Everything'], ['All', 'All chat'], ['Team', 'Team'], ['Squad', 'Squad'], ['Admin', 'Admin']];
let channel = '';
let target = null; // one player the next message goes to
// only things that happen in the game or to a player; panel settings stay in the logs page
const IN_GAME = /^(Warn|Kick|Ban|Message|Move|Remove from|Disband|Next|Change layer|End|Restart match|Smart Shuffle$)/;
const EVENT_TEXT = {
  tk: (r) => `Teamkill: ${r.attacker} killed ${r.victim} (${r.weapon})`,
  conn: (r) => `${r.player} ${r.event === 'Joined' ? 'joined' : 'left'}`,
  admin: (r) => `${r.by}: ${r.action} ${r.target}${r.reason ? ` (${r.reason})` : ''}`
};
function chatList() {
  const messages = S.logs.chat.filter((m) => !channel || m.channel === channel);
  const system = channel ? [] : ['tk', 'conn', 'admin'].flatMap((k) => S.logs[k].filter((r) => k !== 'admin' || IN_GAME.test(r.action)));
  const rows = [...messages, ...system].sort((a, b) => a.at - b.at).slice(-200);
  const note = may('chat.view') ? '' : html`<li class="sys"><span>You do not have permission to read chat. Events are still shown.</span></li>`;
  const line = (r) => {
    const p = byId(r.id);
    return html`<li><span class="meta"><span class="mono sub">${clock(r.at)}</span><span class="tag mini ${r.channel === 'Admin' ? 'solid' : ''}">${r.channel}</span><button class="who-n ${p ? nameClass(p) : ''}" data-player="${r.id}">${p ? mark(p.team) : ''} ${r.player}</button>${p ? html`<span class="sub xs">SQ ${p.squad ?? '-'}</span>` : ''}${p && may('message.group') ? html`<button class="replybtn" data-reply="${p.id}" aria-label="Message ${p.name} only" title="Message only this player">${icon('reply', 15)}</button>` : ''}</span><span class="msg ${/^!admin\b/i.test(r.message) ? 'call' : ''}">${r.message}</span></li>`;
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
  if (target && !player) { toast(`${target.name} left the server.`, true); target = null; }
  const groups = recipients();
  $('#chatform').hidden = !groups.length;
  $('#chatone').hidden = !target;
  $('#chatto').hidden = !!target;
  if (target) draw($('#chatone'), html`<span class="tag solid">Only ${target.name}</span><button type="button" class="btn ghost small" data-untarget aria-label="Send to a group instead">Cancel</button>`);
  const value = $('#chatto').value;
  if (draw($('#chatto'), groups.map(([v, n]) => html`<option value="${v}">To: ${n}</option>`)) && value) $('#chatto').value = value;
}
function send(e) {
  e.preventDefault();
  const message = $('#chatmsg').value.trim();
  if (!message) return;
  const one = target;
  const to = $('#chatto').value;
  ask({ title: `Send to ${one ? one.name : recipientName(to)}?`, text: `${message}  ·  ${HOW[one ? 'player' : to]}`, ok: 'Send', run: async () => {
    const result = await (one ? post('messagePlayer', { id: one.id, message }) : deliverMessage(to, message));
    $('#chatmsg').value = '';
    return result;
  } });
}

// ---------- player card ----------
const KIND_NAME = { warn: 'Warning', kick: 'Kick', ban: 'Ban', note: 'Note' };
export const kindTag = (type) => html`<span class="tag ${type === 'ban' || type === 'kick' ? 'solid' : ''}">${KIND_NAME[type] || type}</span>`;
// everything on record, newest first
function timeline(record) {
  const rows = [...(record.history || []), ...record.notes.map((n) => ({ at: n.at, type: 'note', by: n.by, reason: n.text }))].sort((a, b) => b.at - a.at);
  if (!rows.length) return html`<span class="sub">Nothing on record.</span>`;
  return html`<div class="timeline">${rows.map((e) => html`<div class="note"><span class="sub xs">${kindTag(e.type)} ${stamp(e.at)} · ${e.by}${e.detail ? ` · ${e.detail}` : ''}</span><span class="wrapany">${e.reason}</span></div>`)}</div>`;
}
let cardId = null;
export async function openPlayer(id) {
  cardId = id;
  const record = await api(`/api/player?id=${encodeURIComponent(id)}`);
  const p = byId(id);
  const name = p?.name || record.name || id;
  const stats = p ? [['Kills', p.kills], ['Downs', p.downs], ['Deaths', p.deaths], ['Revives', p.revives], ['Teamkills', p.teamkills], ['Damage', p.damage]] : [];
  const NEED = { message: 'message.group', warn: 'warn', moveTeam: 'team.move', removeFromSquad: 'squad.remove', kick: 'kick', ban: 'ban' };
  const button = (label, action, cls = '', online = false) => (may(NEED[action])
    ? html`<button class="btn tall ${cls}" data-card="${action}" ${online && !p ? html`disabled` : ''}>${label}</button>` : '');
  put($('#playercard'), html`
    <div class="cardhead"><div class="stack2"><span class="cap">Player</span><h2 id="pn">${p ? rankBadge(p) : ''}<span class="${p ? nameClass(p) : ''}">${name}</span></h2><div class="idrow"><button class="btn small" data-copy="${id}">Copy EOS ID</button>${p?.steamID ? html`<button class="btn small" data-copy="${p.steamID}">Copy Steam ID</button>` : ''}</div><span class="sub xs">${p ? `Team ${p.team} ${teamName(p.team)} · ${squadText(p)} · ${p.role}` : 'Not on the server. The game may refuse a kick or ban now; you will see its answer.'}</span></div><button class="btn ghost" data-close aria-label="Close" autofocus>Close</button></div>
    ${stats.length ? html`<div class="stats">${stats.map(([a, b]) => html`<div class="stat"><span class="sub xs">${a}</span><span class="mono statv">${b}</span></div>`)}</div>` : ''}
    ${record.hidden ? html`<span class="sub">You do not have permission to read player history and notes.</span>` : html`<div class="line"><span class="tag">${plural(record.warns, 'warning')}</span><span class="tag">${plural(record.kicks, 'kick')}</span><span class="tag">${plural(record.bans, 'ban')}</span>${record.firstSeen ? html`<span class="tag">first seen ${stamp(record.firstSeen)}</span>` : ''}</div>
    <div class="stack8"><h3>History</h3>${timeline(record)}</div>`}
    ${may('notes.add') ? html`<form id="noteform" class="noteform"><label class="sr" for="nt">New note</label><input id="nt" class="field grow" maxlength="300" placeholder="Add a note (admins only)"><button class="btn">Add note</button></form>` : ''}
    <div class="stack8"><h3>Actions</h3><div class="acts">${button('Message', 'message', '', true)}${button('Warn', 'warn', '', true)}${button('Move team', 'moveTeam', '', true)}${button('Remove from squad', 'removeFromSquad', '', true)}${button('Kick', 'kick', 'danger', true)}${button('Ban', 'ban', 'pri')}</div></div>`);
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
      toast('Copied.');
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
  title: 'Players & squads',
  shell: () => html`<div class="playersgrid">
    <div class="stackcol">
      <div class="toolbar"><label class="sr" for="pl-q">Search players</label><input id="pl-q" class="field search" type="search" placeholder="Name, ID or squad (sl1, sq3)"><span class="sub xs">Click a player to open the card</span></div>
      <div class="teamcols"><div class="teamcol" id="team1col"></div><div class="teamcol" id="team2col"></div></div>
    </div>
    <aside class="tile chatcol" aria-label="Live chat">
      <div class="th"><h2>Live chat</h2></div>
      <div class="chips small" role="group" aria-label="Chat channels">${CHANNELS.map(([v, n]) => html`<button type="button" class="chip" data-ch="${v}" aria-pressed="${v === channel}">${n}</button>`)}</div>
      <ul class="chatlog" id="chat" aria-live="polite"></ul>
      <form class="chatin" id="chatform"><div class="chatto"><label class="sr" for="chatto">Send to</label><select class="field" id="chatto"></select><span id="chatone" class="line" hidden></span></div><div class="line nowrap"><label class="sr" for="chatmsg">Message</label><input id="chatmsg" class="field grow" placeholder="Write a message" maxlength="300" autocomplete="off"><button class="btn pri">Send</button></div></form>
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
        target = { id: reply.dataset.reply, name: byId(reply.dataset.reply)?.name || 'this player' };
        renderTarget();
        $('#chatmsg').focus();
      }
      if (e.target.closest('[data-untarget]')) { target = null; renderTarget(); $('#chatmsg').focus(); }
    });
  },
  open() { this.render(); renderChat(true); },
  render() {
    if (!S.state) return;
    const q = $('#pl-q').value.trim().toLowerCase();
    draw($('#team1col'), teamColumn(1, q));
    draw($('#team2col'), teamColumn(2, q));
    renderTarget();
    renderChat();
  },
  log() { renderChat(); },
  reload() { renderChat(true); },
  reset() { channel = ''; target = null; cardId = null; $('#playercard').textContent = ''; }
};
