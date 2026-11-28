// Accounts and their ticks (staff), and the default ticks of each rank (ranks). Both use one table
// layout with the groups in the same order.
import { $, S, api, app, ask, confirmField, draw, gate, guard, html, may, passwordField, plural, t } from '../core.js';

const GROUPS = ['Basics', 'Players', 'Bans', 'Map and match', 'Smart Shuffle', 'Server', 'Rules', 'Logs', 'Management', 'Server owner only'];
// the permissions by group, the weaker ones first
const grouped = (catalog) => [...GROUPS, ...new Set(catalog.map((p) => p.group).filter((g) => !GROUPS.includes(g)))]
  .map((g) => [g, catalog.filter((p) => p.group === g).sort((a, b) => a.power - b.power)])
  .filter(([, list]) => list.length);

// ---------- staff ----------
let staff = null;
let chosen = null;
let rankFilter = '';
const edits = new Map(); // ticks changed on screen but not saved
const rankName = (id) => t(staff?.ranks[id]?.name || id);
const rankSelect = (ids, value) => html`<label>${t('Rank')}<select class="field" name="rank">${ids.map((id) => html`<option value="${id}" ${id === value ? html`selected` : ''}>${rankName(id)}</option>`)}</select></label>`;

function accounts() {
  const q = $('#st-q').value.trim().toLowerCase();
  const order = Object.keys(staff.ranks);
  const rows = staff.accounts.filter((u) => (!rankFilter || u.rank === rankFilter) && u.name.toLowerCase().includes(q))
    .sort((a, b) => order.indexOf(a.rank) - order.indexOf(b.rank) || a.name.localeCompare(b.name));
  if (!rows.length) return html`<span class="empty">${t('No account matches.')}</span>`;
  return order.filter((r) => rows.some((u) => u.rank === r)).map((r) => html`<span class="cap listhead">${rankName(r)}</span>${rows.filter((u) => u.rank === r).map((u) => html`<button class="sideitem" data-account="${u.name}" data-key="${u.name}" aria-pressed="${u.name === chosen}"><span class="dot ${u.online ? 'on' : 'off'}" title="${u.online ? t('Signed in now') : t('Not signed in')}"></span><span class="grow clip">${u.name}${u.name === S.me.name ? ` ${t('(you)')}` : ''}</span>${u.mustChange ? html`<span class="tag mini">${t('temporary password')}</span>` : ''}</button>`)}`);
}
const rankChips = () => [['', t('All')], ...Object.entries(staff.ranks).filter(([id]) => staff.accounts.some((u) => u.rank === id)).map(([id, r]) => [id, t(r.name)])]
  .map(([v, n]) => html`<button class="chip" data-rankfilter="${v}" data-key="rf${v}" aria-pressed="${v === rankFilter}">${n}</button>`);

function detail() {
  const u = staff.accounts.find((x) => x.name === chosen);
  if (!u) return html`<div class="pickempty"><h2>${t('Pick an account')}</h2></div>`;
  const self = u.name === S.me.name;
  const op = (name, label, cls = '') => (u.blocked[name] === null ? html`<button class="btn small ${cls}" data-staffop="${name}">${label}</button>` : '');
  const personal = u.ticks.some((x) => x.source === 'added' || x.source === 'removed');
  const closed = u.blocked.rank !== null && u.blocked.reset !== null && u.blocked.remove !== null && u.ticks.every((x) => x.locked);
  const row = (p) => {
    const tick = u.ticks.find((x) => x.id === p.id);
    const unsaved = edits.has(p.id);
    const on = unsaved ? edits.get(p.id) : tick.on;
    const from = unsaved ? t('not saved') : tick.source === 'added' ? t('added for this account') : tick.source === 'removed' ? t('removed for this account') : '';
    const why = tick.locked && !self ? t(tick.locked) : '';
    return html`<tr class="${unsaved ? 'changed' : ''} ${tick.locked ? 'locked' : ''}"><td class="allow"><input type="checkbox" id="tk-${p.id}" data-tick="${p.id}" data-key="${p.id}" ${on ? html`checked` : ''} ${tick.locked ? html`disabled` : ''}></td><td class="pname-cell"><label for="tk-${p.id}">${t(p.label)}</label></td><td class="c pw">${p.power}</td><td class="note-cell">${from ? html`<span class="tag mini ${unsaved ? 'solid' : ''}">${from}</span>` : why ? html`<span class="sub xs">${why}</span>` : ''}</td></tr>`;
  };
  return html`<div class="accounthead"><div class="stack2 grow"><div class="line"><h2 class="wrapany">${u.name}</h2><span class="tag">${rankName(u.rank)}</span><span class="tag mono">${t('power {n}', { n: staff.ranks[u.rank].power })}</span><span class="tag">${plural(u.ticks.filter((x) => x.on).length, 'permission')}</span></div>
      <span class="sub xs">${self ? t('These are your own permissions. Nobody can change their own; use "My account" for your name and password.') : closed ? t(u.blocked.remove) : t('Tick what this account may do, then save.')}</span></div>
      <div class="line">${op('rank', t('Change rank'))}${op('reset', t('Reset password'))}${u.rank === 'admin' && !u.mustChange ? op('transfer', t('Make server owner')) : ''}${op('remove', t('Remove'), 'danger')}</div></div>
    <div class="savebar ${edits.size ? 'on' : ''}"><span class="grow">${edits.size ? html`<b>${plural(edits.size, 'unsaved change')}</b>` : t('No unsaved changes')}</span>${personal && !self ? html`<button class="btn" data-staffop="resetTicks">${t('Back to rank defaults')}</button>` : ''}<button class="btn" data-undo ${edits.size ? '' : html`disabled`}>${t('Undo')}</button><button class="btn pri" data-save ${edits.size ? '' : html`disabled`}>${t('Save')}</button></div>
    <div class="tbox"><table class="permtable"><colgroup><col style="width:104px"><col><col style="width:70px"><col style="width:34%"></colgroup><thead><tr><th>${t('Allowed')}</th><th>${t('Permission')}</th><th class="c">${t('Power')}</th><th>${t('Note')}</th></tr></thead>
      ${grouped(staff.catalog).map(([g, perms]) => html`<tbody><tr class="grouprow"><th colspan="4">${t(g)}</th></tr>${perms.map(row)}</tbody>`)}</table></div>`;
}
function renderStaff() {
  if (!staff) return;
  draw($('#st-filters'), rankChips());
  draw($('#st-list'), accounts());
  draw($('#st-detail'), detail());
  $('#st-add').hidden = !staff.create.length;
  gate($('#view-staff'));
}
async function loadStaff(data) {
  if (!may('staff')) return;
  staff = data || (await api('/api/staff'));
  if (!staff.accounts.some((u) => u.name === chosen)) {
    chosen = (staff.accounts.find((u) => u.name !== S.me.name && u.blocked.remove === null) || staff.accounts[0])?.name;
  }
  edits.clear();
  renderStaff();
}
const change = async (body) => {
  const result = await api('/api/staff', body);
  if (result.gone) { app.show('overview'); return; }
  await loadStaff(result);
};
function staffOp(op) {
  const name = chosen;
  const user = staff.accounts.find((x) => x.name === name);
  const run = (v) => change({ op, name, ...v });
  if (op === 'rank') ask({ title: t('Change the rank of {name}', { name }), text: t('Personal ticks the new rank cannot hold are removed.'), ok: t('Change rank'), fields: html`${rankSelect(['admin', 'senior', 'junior'], user.rank)}${confirmField()}`, run });
  if (op === 'reset') ask({ title: t('New temporary password for {name}', { name }), text: t('The old password and open sessions stop working.'), ok: t('Reset password'), fields: html`${passwordField('password', t('Temporary password'), 'new-password')}${confirmField()}`, run });
  if (op === 'remove') ask({ title: t('Remove {name}?', { name }), text: t('This account is signed out at once.'), ok: t('Remove'), danger: true, fields: confirmField(), run });
  if (op === 'transfer') ask({ title: t('Make {name} the server owner?', { name }), text: t('There is one server owner. You become an admin and only the new owner can give it back.'), ok: t('Hand over'), danger: true, fields: confirmField(), run });
  if (op === 'resetTicks') ask({ title: t('Put {name} back to the rank defaults?', { name }), ok: t('Reset ticks'), fields: confirmField(), run });
}

export const staffPage = {
  id: 'staff',
  title: t('Staff'),
  shell: () => html`<div class="navsplit">
    <div class="stackcol listcol"><button class="btn pri" id="st-add" data-register hidden>${t('Register an account')}</button><label class="sr" for="st-q">${t('Search accounts')}</label><input id="st-q" class="field full" type="search" placeholder="${t('Search a name')}"><div class="chips small" id="st-filters" role="group" aria-label="${t('Show rank')}"></div><div class="sidelist scrolls" id="st-list" data-keep-scroll="accounts"></div></div>
    <div class="tile" id="st-detail"><span class="empty">${t('Loading…')}</span></div>
  </div>`,
  wire(root) {
    root.addEventListener('input', (e) => { if (e.target.id === 'st-q' && staff) renderStaff(); });
    root.addEventListener('change', (e) => {
      const id = e.target.dataset.tick;
      if (!id) return;
      const saved = staff.accounts.find((x) => x.name === chosen).ticks.find((x) => x.id === id).on;
      if (e.target.checked === saved) edits.delete(id);
      else edits.set(id, e.target.checked);
      renderStaff();
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || !staff) return;
      const d = b.dataset;
      if (d.account) {
        chosen = d.account;
        edits.clear();
        renderStaff();
        if (window.matchMedia('(max-width:1000px)').matches) $('#st-detail').scrollIntoView({ block: 'start' });
      } else if (d.rankfilter !== undefined) { rankFilter = d.rankfilter; renderStaff(); }
      else if (d.undo !== undefined) { edits.clear(); renderStaff(); }
      else if (d.save !== undefined) {
        const name = chosen;
        const changes = Object.fromEntries(edits);
        ask({ title: t('Change what {name} can do?', { name }), body: html`<ul class="plainlist">${[...edits].map(([id, on]) => html`<li><span class="tag mini ${on ? 'solid' : ''}">${on ? t('Give') : t('Take')}</span> ${t(staff.catalog.find((p) => p.id === id).label)}</li>`)}</ul>`, fields: confirmField(), ok: t('Save'), run: (v) => change({ op: 'ticks', name, changes, confirmPassword: v.confirmPassword }) });
      } else if (d.staffop) staffOp(d.staffop);
      else if (d.register !== undefined) {
        ask({ title: t('Register an account'), text: t('The account starts with its rank defaults, never with a permission you do not have.'), ok: t('Register'),
          fields: html`<label>${t('User name')}<input class="field" name="name" maxlength="32" autocomplete="off" required></label>${rankSelect(staff.create, staff.create.at(-1))}${passwordField('password', t('Temporary password (10 characters or more)'), 'new-password')}${confirmField()}`,
          run: async (v) => { chosen = v.name; rankFilter = ''; await change({ op: 'add', ...v }); } });
      }
    });
  },
  open: guard(() => loadStaff()),
  render() {},
  log() {},
  reload() {},
  reset() { staff = null; chosen = null; rankFilter = ''; edits.clear(); }
};

// ---------- ranks ----------
let data = null;
const rankEdits = new Map(); // "rank|permission" -> on

function matrix() {
  const columns = data.ranks.length + 2;
  const cell = (p, r) => {
    const tick = r.ticks.find((x) => x.id === p.id);
    const key = `${r.rank}|${p.id}`;
    const on = rankEdits.has(key) ? rankEdits.get(key) : tick.on;
    if (tick.locked === 'Not available to this rank.') return html`<td class="c"><span class="sub" title="${t(tick.locked)}" aria-label="${t(r.name)}: ${t('not available')}">✕</span></td>`;
    return html`<td class="c ${rankEdits.has(key) ? 'changed-cell' : ''}"><input type="checkbox" data-rank="${key}" data-key="${key}" aria-label="${t(r.name)}: ${t(p.label)}" ${on ? html`checked` : ''} ${tick.locked ? html`disabled` : ''}></td>`;
  };
  return html`<table class="permtable matrix"><colgroup><col><col style="width:70px">${data.ranks.map(() => html`<col style="width:112px">`)}</colgroup><thead><tr><th>${t('Permission')}</th><th class="c">${t('Power')}</th>${data.ranks.map((r) => html`<th class="c">${t(r.name)}</th>`)}</tr></thead>
    ${grouped(data.catalog).filter(([g]) => g !== 'Server owner only').map(([g, perms]) => html`<tbody><tr class="grouprow"><th colspan="${columns}">${t(g)}</th></tr>${perms.map((p) => html`<tr><td class="pname-cell">${t(p.label)}</td><td class="c pw">${p.power}</td>${data.ranks.map((r) => cell(p, r))}</tr>`)}</tbody>`)}</table>`;
}
function renderRanks() {
  if (!data) return;
  draw($('#rk-table'), matrix());
  const bar = $('#view-ranks .savebar');
  bar.classList.toggle('on', rankEdits.size > 0);
  $('#rk-count').textContent = rankEdits.size ? plural(rankEdits.size, 'unsaved change') : t('No unsaved changes');
  bar.querySelectorAll('button').forEach((b) => { b.disabled = !rankEdits.size; });
}
async function loadRanks(fresh) {
  if (!may('ranks.edit')) return;
  data = fresh || (await api('/api/ranks'));
  rankEdits.clear();
  renderRanks();
}

export const ranksPage = {
  id: 'ranks',
  title: t('Ranks'),
  shell: () => html`<div class="tile intro"><div class="stack2 grow"><h2>${t('Rank defaults')}</h2><span class="sub">${t('What a new account of each rank can do. Personal ticks on the Staff page stay on top of these. Only the server owner sees this page, and the owner can always do everything.')}</span></div></div>
    <div class="savebar sticky-top"><span class="grow" id="rk-count">${t('No unsaved changes')}</span><button class="btn" data-undo disabled>${t('Undo')}</button><button class="btn pri" data-save disabled>${t('Save changes')}</button></div>
    <div class="tile"><div class="tbox" id="rk-table"><span class="empty">${t('Loading…')}</span></div></div>`,
  wire(root) {
    root.addEventListener('change', (e) => {
      const key = e.target.dataset.rank;
      if (!key) return;
      const [rank, id] = key.split('|');
      const saved = data.ranks.find((r) => r.rank === rank).ticks.find((x) => x.id === id).on;
      if (e.target.checked === saved) rankEdits.delete(key);
      else rankEdits.set(key, e.target.checked);
      renderRanks();
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.undo !== undefined) { rankEdits.clear(); renderRanks(); }
      if (b.dataset.save !== undefined) {
        const lines = [...rankEdits].map(([key, on]) => {
          const [rank, id] = key.split('|');
          return html`<li><span class="tag mini ${on ? 'solid' : ''}">${on ? t('Give') : t('Take')}</span> ${t(data.ranks.find((r) => r.rank === rank).name)}: ${t(data.catalog.find((p) => p.id === id).label)}</li>`;
        });
        ask({ title: t('Save the rank defaults?'), text: t('Every account of the changed ranks gets this at once.'), body: html`<ul class="plainlist">${lines}</ul>`, fields: confirmField(), ok: t('Save'), run: async (v) => {
          const byRank = {};
          for (const [key, on] of rankEdits) { const [rank, id] = key.split('|'); (byRank[rank] ||= {})[id] = on; }
          let fresh;
          for (const [rank, changes] of Object.entries(byRank)) fresh = await api('/api/ranks', { rank, changes, confirmPassword: v.confirmPassword });
          await loadRanks(fresh);
        } });
      }
    });
  },
  open: guard(() => loadRanks()),
  render() {},
  log() {},
  reload() {},
  reset() { data = null; rankEdits.clear(); }
};
