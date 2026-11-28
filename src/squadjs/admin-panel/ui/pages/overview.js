// What is happening now and what needs an admin, from top to bottom.
import { $, S, api, app, byId, clock, commanderOf, draw, elapsed, gate, hasLeaderKit, html, icon, mark, may, messagePlayer, nameClass, plural, rankBadge, shuffleCommand, squadText, t, tAction, teamName, thisMatch } from '../core.js';
import { flag, mapKey, sceneArt } from '../art.js';

const layerName = (l) => l?.name || t('Unknown');
const section = (title, body, aside = '') => html`<div class="th"><h2>${title}</h2>${aside}</div>${body}`;

function hero() {
  const { server } = S.state;
  const side = (n) => html`<div class="side${n}"><span class="flagline">${flag(server.factions[n - 1] || teamName(n), 'lg')}<span class="stack2"><span class="cap">${mark(n)}${t('Team {n}', { n })}</span><span class="fname">${teamName(n)}</span></span></span><span class="tickets tx${n}" title="${t('Tickets')}">${server.tickets[n - 1] ?? '-'}</span></div>`;
  return html`${sceneArt(mapKey(server.layer?.id || server.layer?.name))}<div class="heroin">
    <div class="herotop"><div class="stack2"><span class="cap">${t('Now playing')}</span><span class="layer">${layerName(server.layer)}</span></div><span class="pill mono" id="ov-time">${elapsed() || t('Match time unknown')}</span></div>
    <div class="versus">${side(1)}<span class="vsx">vs</span>${side(2)}</div>
    <div class="herofoot"><span class="stack2"><span class="cap">${t('Next layer')}</span><span class="flagline"><b>${server.next ? server.next.name : t('Not set')}</b>${server.nextFactions.map((f) => (f ? flag(f) : ''))}</span></span><button class="btn" data-go="map">${may('map.next') || may('map.now') ? t('Change map') : t('See maps')}</button></div>
  </div>`;
}

function stats() {
  const { server, players, shuffle, shuffleStatus } = S.state;
  const split = [1, 2].map((n) => players.filter((p) => p.team === n).length);
  const admins = players.filter((p) => p.admin);
  const cell = (label, value, note, extra = '') => html`<div class="kpi"><span class="cap">${label}</span><span class="kpiv">${value}</span>${extra}<span class="sub xs">${note}</span></div>`;
  return html`${cell(t('Players'), html`${server.players}<small> / ${server.maxPlayers}</small>`, `${split[0]} vs ${split[1]} · ${t('{n} in queue', { n: server.queue })}`, html`<span class="bar"><i style="width:${Math.min(100, (100 * server.players) / server.maxPlayers)}%"></i></span>`)}
    ${cell(t('Server tick rate'), server.tickRate ?? '-', server.tickRate === null ? t('Waiting for the server log') : server.tickRate >= 35 ? t('Running well') : server.tickRate >= 20 ? t('Under load') : t('Struggling'))}
    ${cell(t('Admins in game'), admins.length, admins.map((a) => a.name).slice(0, 3).join(', ') || t('Nobody'))}
    ${cell('Smart Shuffle', shuffle ? (shuffle.pending ? t('At round end') : shuffle.auto ? t('Auto') : t('Manual')) : shuffleStatus === 'missing' ? t('Not installed') : t('Off'), shuffle ? (shuffle.lockedNow ? t('Teams locked') : t('Teams open')) : t('Nothing is shuffled'))}`;
}

// everything an admin may want to act on, most urgent first
function attention() {
  const { players, squads } = S.state;
  const items = [];
  const who = (p) => html`<button class="linkbtn ${nameClass(p)}" data-player="${p.id}">${p.name}</button>`;
  const where = (p) => html`<span class="sub xs">${mark(p.team)} ${t('Team {n}', { n: p.team })} · ${squadText(p)}</span>`;
  const calls = thisMatch(S.logs.chat).filter((m) => /^!admin\b/i.test(m.message)).slice(-6).reverse();
  for (const call of calls) {
    const p = byId(call.id);
    items.push({ kind: t('Admin call'), strong: true,
      body: html`<span class="line">${p ? who(p) : html`<button class="linkbtn" data-player="${call.id}">${call.player}</button>`}${p ? where(p) : html`<span class="sub xs">${t('left the server')}</span>`}</span><span class="quote">${call.message}</span>`,
      side: html`<span class="sub xs mono">${clock(call.at)}</span>${p && may('message.group') ? html`<button class="btn small" data-reply="${p.id}">${icon('reply')}${t('Reply')}</button>` : ''}` });
  }
  const killers = new Map();
  for (const t of thisMatch(S.logs.tk)) killers.set(t.id, [...(killers.get(t.id) || []), t]);
  for (const [id, list] of [...killers].filter(([, l]) => l.length > 1).sort((a, b) => b[1].length - a[1].length).slice(0, 4)) {
    const p = byId(id);
    items.push({ kind: t('Teamkills'), strong: true,
      body: html`<span class="line">${p ? who(p) : html`<button class="linkbtn" data-player="${id}">${list[0].attacker}</button>`}${p ? where(p) : html`<span class="sub xs">${t('left the server')}</span>`}</span><span class="sub xs">${t('{count} this match, last with {weapon}', { count: plural(list.length, 'teamkill'), weapon: list.at(-1).weapon })}</span>`,
      side: html`<button class="btn small" data-player="${id}">${t('Open')}</button>` });
  }
  for (const s of squads.filter((q) => q.copycat)) {
    items.push({ kind: t('Check squad'), body: html`<span class="line"><b>${t('Two squads are named Command Squad on team {n}', { n: s.team })}</b></span><span class="sub xs">${t("Squad {n} is the newer one. The panel treats the other as the commander's squad.", { n: s.id })}</span>`, side: html`<button class="btn small" data-go="players">${t('Squads')}</button>` });
  }
  const noKit = players.filter((p) => p.leader && p.role && !hasLeaderKit(p));
  if (noKit.length) {
    items.push({ kind: t('No SL kit'), body: html`<span class="line">${noKit.slice(0, 6).map((p) => html`<button class="chipbtn" data-player="${p.id}">${mark(p.team)}SQ ${p.squad} ${p.name}</button>`)}${noKit.length > 6 ? html`<span class="sub xs">${t('+{n} more', { n: noKit.length - 6 })}</span>` : ''}</span><span class="sub xs">${t('{count} without the squad leader kit', { count: plural(noKit.length, 'squad leader') })}</span>`, side: '' });
  }
  const loose = players.filter((p) => p.squad === null);
  if (loose.length) items.push({ kind: t('No squad'), body: html`<span class="line"><b>${t('{count} without a squad', { count: plural(loose.length, 'player') })}</b></span>`, side: html`<button class="btn small" data-go="players">${t('Show')}</button>` });
  return section(t('Needs attention'), items.length
    ? html`<ul class="attention">${items.map((i) => html`<li><span class="tag ${i.strong ? 'solid' : ''}">${i.kind}</span><span class="what">${i.body}</span><span class="act">${i.side}</span></li>`)}</ul>`
    : html`<p class="calm">${icon('check', 20)}${t('Nothing needs you right now. Admin calls in chat, repeated teamkills and squad problems show up here.')}</p>`);
}

function commanders() {
  return section(t('Commanders'), [1, 2].map((n) => {
    const c = commanderOf(n);
    return html`<div class="cmdline2 t${n}">${flag(S.state.server.factions[n - 1] || teamName(n))}<span class="stack2"><span class="sub xs">${t('Team {n}', { n })} · ${teamName(n)}</span>${c ? html`<span class="line">${rankBadge(c)}<button class="linkbtn n-cmd" data-player="${c.id}">${c.name}</button></span>` : html`<span class="sub">${t('No commander')}</span>`}</span></div>`;
  }));
}

function recentAdmin() {
  const rows = S.logs.admin.filter((r) => !/^Login/.test(r.action)).slice(-7).reverse();
  return section(t('Recent admin actions'), html`<ul class="feed">${rows.length ? rows.map((r) => html`<li><span class="sub xs mono">${clock(r.at)}</span><span class="tag ${/Kick|Ban/.test(r.action) ? 'solid' : ''}">${tAction(r.action)}</span><span class="grow"><b>${r.target}</b>${r.reason ? html` <span class="sub">${r.reason}</span>` : ''}</span><span class="sub xs">${r.by}</span></li>`) : html`<li class="empty">${t('Nothing yet.')}</li>`}</ul>`, html`<button class="btn ghost small" data-golog="admin">${t('Open log')}</button>`);
}

function recentTeamkills() {
  const rows = thisMatch(S.logs.tk).slice(-7).reverse();
  return section(t('Teamkills this match'), html`<ul class="feed">${rows.length ? rows.map((r) => html`<li><span class="sub xs mono">${clock(r.at)}</span><span class="grow"><button class="linkbtn" data-player="${r.id}">${r.attacker}</button> <span class="sub">${t('killed')}</span> ${r.victim}</span><span class="sub xs">${r.weapon}</span></li>`) : html`<li class="empty">${t('No teamkills.')}</li>`}</ul>`, html`<button class="btn ghost small" data-golog="tk">${t('All teamkills')}</button>`);
}

export default {
  id: 'overview',
  title: t('Overview'),
  shell: () => html`<div class="hero" id="ov-hero"></div>
    <div class="tile kpis" id="ov-stats"></div>
    <div class="split">
      <div class="stackcol main-col">
        <div class="tile" id="ov-attention"></div>
        <div class="tile" id="ov-admin" data-need="log.admin"></div>
        <div class="tile" id="ov-tk" data-need="kills.view"></div>
      </div>
      <div class="stackcol">
        <div class="tile" id="ov-commanders"></div>
        <div class="tile" id="ov-quick"><h2>${t('Quick actions')}</h2><div class="quick">
          <button class="btn tall" data-act="message" data-need="message">${t('Send message')}</button>
          <button class="btn tall" data-go="map" data-need="map.next">${t('Set next layer')}</button>
          <button class="btn tall" data-quick="now" data-need="shuffle.round">${t('Shuffle at round end')}</button>
          <button class="btn tall" data-quick="unlock" data-need="shuffle.round">${t('Unlock teams')}</button>
          <button class="btn tall danger" data-act="endMatch" data-need="match.control">${t('End match')}</button>
        </div></div>
      </div>
    </div>`,
  wire(root) {
    root.addEventListener('click', (e) => {
      const quick = e.target.closest('[data-quick]');
      if (quick) shuffleCommand(quick.dataset.quick);
      const reply = e.target.closest('[data-reply]');
      if (reply) messagePlayer(reply.dataset.reply);
    });
  },
  open() { this.render(); },
  render() {
    if (!S.state) return;
    draw($('#ov-hero'), hero());
    draw($('#ov-stats'), stats());
    draw($('#ov-attention'), attention());
    draw($('#ov-commanders'), commanders());
    draw($('#ov-admin'), recentAdmin());
    draw($('#ov-tk'), recentTeamkills());
    gate($('#view-overview'));
    // an account with none of these gets no empty box
    $('#ov-quick').hidden = ![...$('#ov-quick').querySelectorAll('button')].some((b) => !b.hidden);
    if (!may('log.admin') && may('log.ip')) $('#ov-admin').hidden = false;
  },
  log() { this.render(); },
  reload() { this.render(); },
  reset() {}
};
