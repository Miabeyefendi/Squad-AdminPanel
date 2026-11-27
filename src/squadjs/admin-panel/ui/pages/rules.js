// Automatic rules. Each one says in plain words what it will do with the values as they are.
import { $, BAN_CHOICES, api, ask, gate, guard, html, may, plural, put } from '../core.js';

let rules = null;
let overlap = [];
const open = new Set();

const minutes = (n) => plural(n, 'minute');
const banText = (v) => (v === '0' ? 'permanent' : BAN_CHOICES.find(([id]) => id === v)?.[1] || v);
const countSteps = (r, unit) => [r.warnAt > 0 && ['Warn', `at ${r.warnAt} ${unit}`], r.kickAt > 0 && ['Kick', `at ${r.kickAt}`], r.banAt > 0 && [`Ban ${banText(r.banLength)}`, `at ${r.banAt}`]].filter(Boolean);

// title, what it watches, the steps it takes with these values, and the values to edit
const INFO = {
  teamkill: { group: 'Behaviour', title: 'Teamkill limit', watches: (r) => `Counts each player's teamkills over ${minutes(r.windowMinutes)}.`,
    steps: (r) => countSteps(r, r.warnAt === 1 ? 'teamkill' : 'teamkills'),
    fields: [['windowMinutes', 'Count over (minutes)'], ['warnAt', 'Warn at (teamkills)'], ['kickAt', 'Kick at'], ['banAt', 'Ban at'], ['banLength', 'Ban length'], ['warnMessage', 'Warning message']] },
  squadless: { group: 'Behaviour', title: 'Players without a squad', watches: (r) => `Only while at least ${r.minPlayers} players are on.`,
    steps: (r) => [r.warnAfterMinutes > 0 && ['Warn', `after ${minutes(r.warnAfterMinutes)}`], r.kickAfterMinutes > 0 && ['Kick', `after ${minutes(r.kickAfterMinutes)}`]].filter(Boolean),
    fields: [['minPlayers', 'Only from this many players'], ['warnAfterMinutes', 'Warn after (minutes)'], ['kickAfterMinutes', 'Kick after (minutes)'], ['warnMessage', 'Warning message']] },
  slKit: { group: 'Behaviour', title: 'Squad leader without the SL kit', watches: (r) => `Squad leaders only, while at least ${r.minPlayers} players are on.`,
    steps: (r) => [['Warn', r.warnAfterMinutes ? `after ${minutes(r.warnAfterMinutes)}` : 'at once'], r.removeAfterMinutes > 0 && ['Remove from squad', `after ${minutes(r.removeAfterMinutes)}`]].filter(Boolean),
    fields: [['minPlayers', 'Only from this many players'], ['warnAfterMinutes', 'Warn after (minutes)'], ['removeAfterMinutes', 'Remove from squad after (minutes)'], ['warnMessage', 'Warning message']] },
  lockedSquad: { group: 'Behaviour', title: 'Small locked squads', watches: (r) => `Locked squads with fewer than ${r.minMembers} players, while at least ${r.minPlayers} are on. The commander's squad is left alone.`,
    steps: (r) => [['Warn the leader', r.warnAfterMinutes ? `after ${minutes(r.warnAfterMinutes)}` : 'at once'], r.disbandAfterMinutes > 0 && ['Disband', `after ${minutes(r.disbandAfterMinutes)}`]].filter(Boolean),
    untested: 'Disbanding has not been tried on a real server.',
    fields: [['minPlayers', 'Only from this many players'], ['minMembers', 'A locked squad needs (players)'], ['warnAfterMinutes', 'Warn after (minutes)'], ['disbandAfterMinutes', 'Disband after (minutes)'], ['warnMessage', 'Warning message']] },
  chatFilter: { group: 'Chat and names', title: 'Chat filter', watches: (r) => `${r.words.length ? plural(r.words.length, 'blocked word') : 'No blocked words yet'}, matched as whole words in every chat but admin chat.`,
    steps: (r) => [['Warn', 'first time'], r.kickAt > 0 && ['Kick', `at ${r.kickAt}`], r.banAt > 0 && [`Ban ${banText(r.banLength)}`, `at ${r.banAt}`]].filter(Boolean),
    fields: [['words', 'Blocked words, one per line'], ['kickAt', 'Kick at (hits)'], ['banAt', 'Ban at (hits)'], ['banLength', 'Ban length'], ['warnMessage', 'Warning message']] },
  nameFilter: { group: 'Chat and names', title: 'Name filter', watches: (r) => `${r.patterns.length ? plural(r.patterns.length, 'blocked text') : 'No blocked texts yet'}, looked for anywhere in a player name.`,
    steps: (r) => [['Warn', 'on joining'], ['Kick', r.kickAfterMinutes ? `after ${minutes(r.kickAfterMinutes)}` : 'at the next check']],
    fields: [['patterns', 'Blocked texts, one per line'], ['kickAfterMinutes', 'Kick after (minutes)'], ['warnMessage', 'Warning message']] }
};
const SQUADJS = { AutoTKWarn: 'teamkill', AutoKickUnassigned: 'squadless' };

function control(name, key, label, value, off) {
  const id = `r-${name}-${key}`;
  if (Array.isArray(value)) return html`<label class="wide" for="${id}">${label}<textarea class="field" id="${id}" name="${key}" data-kind="list" ${off}>${value.join('\n')}</textarea></label>`;
  if (key === 'banLength') return html`<label for="${id}">${label}<select class="field" id="${id}" name="${key}" ${off}>${BAN_CHOICES.map(([v, n]) => html`<option value="${v}" ${v === value ? html`selected` : ''}>${n}</option>`)}</select></label>`;
  if (typeof value === 'number') return html`<label for="${id}">${label}<input class="field mono" id="${id}" type="number" min="0" name="${key}" data-kind="number" value="${value}" ${off}></label>`;
  return html`<label class="wide" for="${id}">${label}<input class="field" id="${id}" name="${key}" value="${value}" maxlength="300" ${off}></label>`;
}
function card(name) {
  const info = INFO[name];
  const r = rules[name];
  const off = may('rules.edit') ? '' : html`disabled`;
  const steps = info.steps(r);
  const doubled = overlap.filter((p) => SQUADJS[p] === name);
  return html`<article class="rulecard ${r.enabled ? 'live-rule' : ''}">
    <div class="rulehead"><div class="stack2 grow"><div class="line"><h3>${info.title}</h3><span class="tag mini ${r.enabled ? 'solid' : ''}">${r.enabled ? 'On' : 'Off'}</span></div><span class="sub">${info.watches(r)}</span></div><button type="button" class="sw" role="switch" aria-checked="${r.enabled}" aria-label="${info.title}" data-rulesw="${name}" ${off}></button></div>
    <ol class="steps">${steps.length ? steps.map(([what, when]) => html`<li><b>${what}</b><span class="sub xs">${when}</span></li>`) : html`<li><span class="sub">Every step is switched off.</span></li>`}</ol>
    ${doubled.length ? html`<span class="tag warnish wrapany">The SquadJS plugin ${doubled.join(', ')} is on and watches the same thing. Players would be warned twice.</span>` : ''}
    ${info.untested ? html`<span class="sub xs">${info.untested}</span>` : ''}
    <details data-rule-open="${name}" ${open.has(name) ? html`open` : ''}><summary class="btn small">${may('rules.edit') ? 'Edit' : 'See values'}</summary>
      <form data-rule="${name}" class="ruleform">${info.fields.map(([key, label]) => control(name, key, label, r[key], off))}<div class="wide line"><button class="btn pri" ${off}>Save</button><span class="sub xs">0 switches that step off.</span></div></form></details>
  </article>`;
}
function render() {
  if (!rules) return;
  const names = Object.keys(INFO).filter((n) => rules[n]);
  const on = names.filter((n) => rules[n].enabled).length;
  put($('#rl-summary'), html`<span class="cap">Switched on</span><span class="kpiv">${on}<small> / ${names.length}</small></span>`);
  put($('#rl-list'), [...new Set(names.map((n) => INFO[n].group))].map((g) => html`<section class="rulegroup"><h2>${g}</h2><div class="rulegrid">${names.filter((n) => INFO[n].group === g).map(card)}</div></section>`));
  gate($('#view-rules'));
}
const load = async () => {
  rules = await api('/api/rules');
  overlap = [];
  // only the owner may read the plugin list; others simply get no overlap note
  if (may('plugins')) overlap = (await api('/api/plugins')).plugins.filter((p) => p.enabled && SQUADJS[p.name]).map((p) => p.name);
  render();
};
const save = async (name, values) => {
  await api('/api/rules', { [name]: values });
  await load();
};

export default {
  id: 'rules',
  title: 'Rules',
  shell: () => html`<div class="tile intro"><div class="stack2 grow"><h2>What these rules are</h2><span class="sub">The panel watches the game and acts by itself, the same way an admin would with a warning or a kick. Every rule starts off, server admins are never touched, and every action it takes is written to the admin log. Try a new rule with only the warning step first.</span></div><div class="kpi" id="rl-summary"></div></div><div class="stackcol" id="rl-list"><span class="empty">Loading…</span></div>`,
  wire(root) {
    root.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-rulesw]');
      if (!sw || sw.disabled) return;
      const name = sw.dataset.rulesw;
      const enable = sw.getAttribute('aria-checked') !== 'true';
      const steps = INFO[name].steps(rules[name]).map(([what, when]) => `${what} ${when}`).join(', ');
      ask({ title: `Switch ${INFO[name].title} ${enable ? 'on' : 'off'}?`, text: enable ? `The panel will act on players by itself: ${steps || 'no step is set'}. Unsaved field changes are not included.` : '', ok: enable ? 'Switch on' : 'Switch off', run: () => save(name, { enabled: enable }) });
    });
    // which cards are open survives a save
    root.addEventListener('toggle', (e) => {
      const name = e.target.dataset?.ruleOpen;
      if (!name) return;
      if (e.target.open) open.add(name);
      else open.delete(name);
    }, true);
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const values = {};
      form.querySelectorAll('input[name],select[name],textarea[name]').forEach((el) => {
        values[el.name] = el.dataset.kind === 'list' ? el.value.split('\n').map((s) => s.trim()).filter(Boolean) : el.dataset.kind === 'number' ? Number(el.value) : el.value;
      });
      ask({ title: `Save ${INFO[form.dataset.rule].title}?`, ok: 'Save', run: () => save(form.dataset.rule, values) });
    });
  },
  open: guard(load),
  render() {},
  log() {},
  reload() {},
  reset() { rules = null; overlap = []; open.clear(); }
};
