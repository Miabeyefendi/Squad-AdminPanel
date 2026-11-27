// Accounts and their ticks (staff), and the default ticks of each rank (ranks). Both use one table
// layout with the groups in the same order.
import { $, S, api, app, ask, confirmField, draw, gate, guard, html, may, passwordField, plural } from '../core.js';

const GROUPS = ['Basics', 'Players', 'Bans', 'Map and match', 'Smart Shuffle', 'Rules', 'Logs', 'Management', 'Server owner only'];
// the permissions by group, the weaker ones first
const grouped = (catalog) => [...GROUPS, ...new Set(catalog.map((p) => p.group).filter((g) => !GROUPS.includes(g)))]
  .map((g) => [g, catalog.filter((p) => p.group === g).sort((a, b) => a.power - b.power)])
  .filter(([, list]) => list.length);

// ---------- staff ----------
let staff = null;
let chosen = null;
let rankFilter = '';
const edits = new Map(); // ticks changed on screen but not saved
const rankName = (id) => staff?.ranks[id]?.name || id;
const rankSelect = (ids, value) => html`<label>Rank<select class="field" name="rank">${ids.map((id) => html`<option value="${id}" ${id === value ? html`selected` : ''}>${rankName(id)}</option>`)}</select></label>`;

function accounts() {
  const q = $('#st-q').value.trim().toLowerCase();
  const order = Object.keys(staff.ranks);
  const rows = staff.accounts.filter((u) => (!rankFilter || u.rank === rankFilter) && u.name.toLowerCase().includes(q))
    .sort((a, b) => order.indexOf(a.rank) - order.indexOf(b.rank) || a.name.localeCompare(b.name));
  if (!rows.length) return html`<span class="empty">No account matches.</span>`;
  return order.filter((r) => rows.some((u) => u.rank === r)).map((r) => html`<span class="cap listhead">${rankName(r)}</span>${rows.filter((u) => u.rank === r).map((u) => html`<button class="sideitem" data-account="${u.name}" data-key="${u.name}" aria-pressed="${u.name === chosen}"><span class="dot ${u.online ? 'on' : 'off'}" title="${u.online ? 'Signed in now' : 'Not signed in'}"></span><span class="grow clip">${u.name}${u.name === S.me.name ? ' (you)' : ''}</span>${u.mustChange ? html`<span class="tag mini">temporary password</span>` : ''}</button>`)}`);
}
const rankChips = () => [['', 'All'], ...Object.entries(staff.ranks).filter(([id]) => staff.accounts.some((u) => u.rank === id)).map(([id, r]) => [id, r.name])]
  .map(([v, n]) => html`<button class="chip" data-rankfilter="${v}" data-key="rf${v}" aria-pressed="${v === rankFilter}">${n}</button>`);

function detail() {
  const u = staff.accounts.find((x) => x.name === chosen);
  if (!u) return html`<div class="pickempty"><h2>Pick an account</h2></div>`;
  const self = u.name === S.me.name;
  const op = (name, label, cls = '') => (u.blocked[name] === null ? html`<button class="btn small ${cls}" data-staffop="${name}">${label}</button>` : '');
  const personal = u.ticks.some((t) => t.source === 'added' || t.source === 'removed');
  const closed = u.blocked.rank !== null && u.blocked.reset !== null && u.blocked.remove !== null && u.ticks.every((t) => t.locked);
  const row = (p) => {
    const t = u.ticks.find((x) => x.id === p.id);
    const unsaved = edits.has(p.id);
    const on = unsaved ? edits.get(p.id) : t.on;
    const from = unsaved ? 'not saved' : t.source === 'added' ? 'added for this account' : t.source === 'removed' ? 'removed for this account' : '';
    const why = t.locked && !self ? t.locked : '';
    return html`<tr class="${unsaved ? 'changed' : ''} ${t.locked ? 'locked' : ''}"><td class="allow"><input type="checkbox" id="tk-${p.id}" data-tick="${p.id}" data-key="${p.id}" ${on ? html`checked` : ''} ${t.locked ? html`disabled` : ''}></td><td class="pname-cell"><label for="tk-${p.id}">${p.label}</label></td><td class="c pw">${p.power}</td><td class="note-cell">${from ? html`<span class="tag mini ${unsaved ? 'solid' : ''}">${from}</span>` : why ? html`<span class="sub xs">${why}</span>` : ''}</td></tr>`;
  };
  return html`<div class="accounthead"><div class="stack2 grow"><div class="line"><h2 class="wrapany">${u.name}</h2><span class="tag">${rankName(u.rank)}</span><span class="tag mono">power ${staff.ranks[u.rank].power}</span><span class="tag">${plural(u.ticks.filter((t) => t.on).length, 'permission')}</span></div>
      <span class="sub xs">${self ? 'These are your own permissions. Nobody can change their own; use "My account" for your name and password.' : closed ? u.blocked.remove : 'Tick what this account may do, then save.'}</span></div>
      <div class="line">${op('rank', 'Change rank')}${op('reset', 'Reset password')}${u.rank === 'admin' && !u.mustChange ? op('transfer', 'Make server owner') : ''}${op('remove', 'Remove', 'danger')}</div></div>
    <div class="savebar ${edits.size ? 'on' : ''}"><span class="grow">${edits.size ? html`<b>${plural(edits.size, 'unsaved change')}</b>` : 'No unsaved changes'}</span>${personal && !self ? html`<button class="btn" data-staffop="resetTicks">Back to rank defaults</button>` : ''}<button class="btn" data-undo ${edits.size ? '' : html`disabled`}>Undo</button><button class="btn pri" data-save ${edits.size ? '' : html`disabled`}>Save</button></div>
    <div class="tbox"><table class="permtable"><colgroup><col style="width:70px"><col><col style="width:70px"><col style="width:34%"></colgroup><thead><tr><th>Allowed</th><th>Permission</th><th class="c">Power</th><th>Note</th></tr></thead>
      ${grouped(staff.catalog).map(([g, perms]) => html`<tbody><tr class="grouprow"><th colspan="4">${g}</th></tr>${perms.map(row)}</tbody>`)}</table></div>`;
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
  if (op === 'rank') ask({ title: `Change the rank of ${name}`, text: 'Personal ticks the new rank cannot hold are removed.', ok: 'Change rank', fields: html`${rankSelect(['admin', 'senior', 'junior'], user.rank)}${confirmField()}`, run });
  if (op === 'reset') ask({ title: `New temporary password for ${name}`, text: 'The old password and open sessions stop working.', ok: 'Reset password', fields: html`${passwordField('password', 'Temporary password', 'new-password')}${confirmField()}`, run });
  if (op === 'remove') ask({ title: `Remove ${name}?`, text: 'This account is signed out at once.', ok: 'Remove', danger: true, fields: confirmField(), run });
  if (op === 'transfer') ask({ title: `Make ${name} the server owner?`, text: 'There is one server owner. You become an admin and only the new owner can give it back.', ok: 'Hand over', danger: true, fields: confirmField(), run });
  if (op === 'resetTicks') ask({ title: `Put ${name} back to the rank defaults?`, ok: 'Reset ticks', fields: confirmField(), run });
}

export const staffPage = {
  id: 'staff',
  title: 'Staff',
  shell: () => html`<div class="navsplit">
    <div class="stackcol listcol"><button class="btn pri" id="st-add" data-register hidden>Register an account</button><label class="sr" for="st-q">Search accounts</label><input id="st-q" class="field full" type="search" placeholder="Search a name"><div class="chips small" id="st-filters" role="group" aria-label="Show rank"></div><div class="sidelist scrolls" id="st-list" data-keep-scroll="accounts"></div></div>
    <div class="tile" id="st-detail"><span class="empty">Loading…</span></div>
  </div>`,
  wire(root) {
    root.addEventListener('input', (e) => { if (e.target.id === 'st-q' && staff) renderStaff(); });
    root.addEventListener('change', (e) => {
      const id = e.target.dataset.tick;
      if (!id) return;
      const saved = staff.accounts.find((x) => x.name === chosen).ticks.find((t) => t.id === id).on;
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
        ask({ title: `Change what ${name} can do?`, body: html`<ul class="plainlist">${[...edits].map(([id, on]) => html`<li><span class="tag mini ${on ? 'solid' : ''}">${on ? 'Give' : 'Take'}</span> ${staff.catalog.find((p) => p.id === id).label}</li>`)}</ul>`, fields: confirmField(), ok: 'Save', run: (v) => change({ op: 'ticks', name, changes, confirmPassword: v.confirmPassword }) });
      } else if (d.staffop) staffOp(d.staffop);
      else if (d.register !== undefined) {
        ask({ title: 'Register an account', text: 'The account starts with its rank defaults, never with a permission you do not have.', ok: 'Register',
          fields: html`<label>User name<input class="field" name="name" maxlength="32" autocomplete="off" required></label>${rankSelect(staff.create, staff.create.at(-1))}${passwordField('password', 'Temporary password (10 characters or more)', 'new-password')}${confirmField()}`,
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
    const t = r.ticks.find((x) => x.id === p.id);
    const key = `${r.rank}|${p.id}`;
    const on = rankEdits.has(key) ? rankEdits.get(key) : t.on;
    if (t.locked === 'Not available to this rank.') return html`<td class="c"><span class="sub" title="${t.locked}" aria-label="${r.name}: not available">✕</span></td>`;
    return html`<td class="c ${rankEdits.has(key) ? 'changed-cell' : ''}"><input type="checkbox" data-rank="${key}" data-key="${key}" aria-label="${r.name}: ${p.label}" ${on ? html`checked` : ''} ${t.locked ? html`disabled` : ''}></td>`;
  };
  return html`<table class="permtable matrix"><colgroup><col><col style="width:70px">${data.ranks.map(() => html`<col style="width:112px">`)}</colgroup><thead><tr><th>Permission</th><th class="c">Power</th>${data.ranks.map((r) => html`<th class="c">${r.name}</th>`)}</tr></thead>
    ${grouped(data.catalog).filter(([g]) => g !== 'Server owner only').map(([g, perms]) => html`<tbody><tr class="grouprow"><th colspan="${columns}">${g}</th></tr>${perms.map((p) => html`<tr><td class="pname-cell">${p.label}</td><td class="c pw">${p.power}</td>${data.ranks.map((r) => cell(p, r))}</tr>`)}</tbody>`)}</table>`;
}
function renderRanks() {
  if (!data) return;
  draw($('#rk-table'), matrix());
  const bar = $('#view-ranks .savebar');
  bar.classList.toggle('on', rankEdits.size > 0);
  $('#rk-count').textContent = rankEdits.size ? plural(rankEdits.size, 'unsaved change') : 'No unsaved changes';
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
  title: 'Ranks',
  shell: () => html`<div class="tile intro"><div class="stack2 grow"><h2>Rank defaults</h2><span class="sub">What a new account of each rank can do. Personal ticks on the Staff page stay on top of these. Only the server owner sees this page, and the owner can always do everything.</span></div></div>
    <div class="savebar sticky-top"><span class="grow" id="rk-count">No unsaved changes</span><button class="btn" data-undo disabled>Undo</button><button class="btn pri" data-save disabled>Save changes</button></div>
    <div class="tile"><div class="tbox" id="rk-table"><span class="empty">Loading…</span></div></div>`,
  wire(root) {
    root.addEventListener('change', (e) => {
      const key = e.target.dataset.rank;
      if (!key) return;
      const [rank, id] = key.split('|');
      const saved = data.ranks.find((r) => r.rank === rank).ticks.find((t) => t.id === id).on;
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
          return html`<li><span class="tag mini ${on ? 'solid' : ''}">${on ? 'Give' : 'Take'}</span> ${data.ranks.find((r) => r.rank === rank).name}: ${data.catalog.find((p) => p.id === id).label}</li>`;
        });
        ask({ title: 'Save the rank defaults?', text: 'Every account of the changed ranks gets this at once.', body: html`<ul class="plainlist">${lines}</ul>`, fields: confirmField(), ok: 'Save', run: async (v) => {
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
