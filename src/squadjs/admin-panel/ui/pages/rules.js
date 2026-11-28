// Automatic rules. Each one says in plain words what it will do with the values as they are.
import { $, BAN_CHOICES, api, ask, gate, guard, html, may, plural, put, t, tAction } from '../core.js';

let rules = null;
let overlap = [];
const open = new Set();

const minutes = (n) => plural(n, 'minute');
const banText = (v) => (v === '0' ? t('permanent') : BAN_CHOICES.find(([id]) => id === v)?.[1] || v);
const at = (n) => t('at {n}', { n });
const after = (n) => t('after {time}', { time: minutes(n) });
const banStep = (r) => r.banAt > 0 && [`${t('Ban')} ${banText(r.banLength)}`, at(r.banAt)];
const countSteps = (r, unit) => [r.warnAt > 0 && [t('Warn'), t('at {count}', { count: plural(r.warnAt, unit) })], r.kickAt > 0 && [t('Kick'), at(r.kickAt)], banStep(r)].filter(Boolean);

// title, what it watches, the steps it takes with these values, and the values to edit
const INFO = {
  teamkill: { group: t('Behaviour'), title: t('Teamkill limit'), watches: (r) => t("Counts each player's teamkills over {time}.", { time: minutes(r.windowMinutes) }),
    steps: (r) => countSteps(r, 'teamkill'),
    fields: [['windowMinutes', t('Count over (minutes)')], ['warnAt', t('Warn at (teamkills)')], ['kickAt', t('Kick at')], ['banAt', t('Ban at')], ['banLength', t('Ban length')], ['warnMessage', t('Warning message')]] },
  squadless: { group: t('Behaviour'), title: t('Players without a squad'), watches: (r) => t('Only while at least {n} players are on.', { n: r.minPlayers }),
    steps: (r) => [r.warnAfterMinutes > 0 && [t('Warn'), after(r.warnAfterMinutes)], r.kickAfterMinutes > 0 && [t('Kick'), after(r.kickAfterMinutes)]].filter(Boolean),
    fields: [['minPlayers', t('Only from this many players')], ['warnAfterMinutes', t('Warn after (minutes)')], ['kickAfterMinutes', t('Kick after (minutes)')], ['warnMessage', t('Warning message')]] },
  slKit: { group: t('Behaviour'), title: t('Squad leader without the SL kit'), watches: (r) => t('Squad leaders only, while at least {n} players are on.', { n: r.minPlayers }),
    steps: (r) => [[t('Warn'), r.warnAfterMinutes ? after(r.warnAfterMinutes) : t('at once')], r.removeAfterMinutes > 0 && [t('Remove from squad'), after(r.removeAfterMinutes)]].filter(Boolean),
    fields: [['minPlayers', t('Only from this many players')], ['warnAfterMinutes', t('Warn after (minutes)')], ['removeAfterMinutes', t('Remove from squad after (minutes)')], ['warnMessage', t('Warning message')]] },
  lockedSquad: { group: t('Behaviour'), title: t('Small locked squads'), watches: (r) => t("Locked squads with fewer than {members} players, while at least {n} are on. The commander's squad is left alone.", { members: r.minMembers, n: r.minPlayers }),
    steps: (r) => [[t('Warn the leader'), r.warnAfterMinutes ? after(r.warnAfterMinutes) : t('at once')], r.disbandAfterMinutes > 0 && [t('Disband'), after(r.disbandAfterMinutes)]].filter(Boolean),
    untested: t('Disbanding has not been tried on a real server.'),
    fields: [['minPlayers', t('Only from this many players')], ['minMembers', t('A locked squad needs (players)')], ['warnAfterMinutes', t('Warn after (minutes)')], ['disbandAfterMinutes', t('Disband after (minutes)')], ['warnMessage', t('Warning message')]] },
  chatFilter: { group: t('Chat and names'), title: t('Chat filter'), watches: (r) => t('{count}, matched as whole words in every chat but admin chat.', { count: r.words.length ? plural(r.words.length, 'blocked word') : t('No blocked words yet') }),
    steps: (r) => [[t('Warn'), t('first time')], r.kickAt > 0 && [t('Kick'), at(r.kickAt)], banStep(r)].filter(Boolean),
    fields: [['words', t('Blocked words, one per line')], ['kickAt', t('Kick at (hits)')], ['banAt', t('Ban at (hits)')], ['banLength', t('Ban length')], ['warnMessage', t('Warning message')]] },
  nameFilter: { group: t('Chat and names'), title: t('Name filter'), watches: (r) => t('{count}, looked for anywhere in a player name.', { count: r.patterns.length ? plural(r.patterns.length, 'blocked text') : t('No blocked texts yet') }),
    steps: (r) => [[t('Warn'), t('on joining')], [t('Kick'), r.kickAfterMinutes ? after(r.kickAfterMinutes) : t('at the next check')]],
    fields: [['patterns', t('Blocked texts, one per line')], ['kickAfterMinutes', t('Kick after (minutes)')], ['warnMessage', t('Warning message')]] }
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
    <div class="rulehead"><div class="stack2 grow"><div class="line"><h3>${info.title}</h3><span class="tag mini ${r.enabled ? 'solid' : ''}">${r.enabled ? t('On') : t('Off')}</span></div><span class="sub">${info.watches(r)}</span></div><button type="button" class="sw" role="switch" aria-checked="${r.enabled}" aria-label="${info.title}" data-rulesw="${name}" ${off}></button></div>
    <ol class="steps">${steps.length ? steps.map(([what, when]) => html`<li><b>${what}</b><span class="sub xs">${when}</span></li>`) : html`<li><span class="sub">${t('Every step is switched off.')}</span></li>`}</ol>
    ${doubled.length ? html`<span class="tag warnish wrapany">${t('The SquadJS plugin {name} is on and watches the same thing. Players would be warned twice.', { name: doubled.join(', ') })}</span>` : ''}
    ${info.untested ? html`<span class="sub xs">${info.untested}</span>` : ''}
    <details data-rule-open="${name}" ${open.has(name) ? html`open` : ''}><summary class="btn small">${may('rules.edit') ? t('Edit') : t('See values')}</summary>
      <form data-rule="${name}" class="ruleform">${info.fields.map(([key, label]) => control(name, key, label, r[key], off))}<div class="wide line"><button class="btn pri" ${off}>${t('Save')}</button><span class="sub xs">${t('0 switches that step off.')}</span></div></form></details>
  </article>`;
}
function render() {
  if (!rules) return;
  const names = Object.keys(INFO).filter((n) => rules[n]);
  const on = names.filter((n) => rules[n].enabled).length;
  put($('#rl-summary'), html`<span class="cap">${t('Switched on')}</span><span class="kpiv">${on}<small> / ${names.length}</small></span>`);
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
  title: t('Rules'),
  shell: () => html`<div class="tile intro"><div class="stack2 grow"><h2>${t('What these rules are')}</h2><span class="sub">${t('The panel watches the game and acts by itself, the same way an admin would with a warning or a kick. Every rule starts off, server admins are never touched, and every action it takes is written to the admin log. Try a new rule with only the warning step first.')}</span></div><div class="kpi" id="rl-summary"></div></div><div class="stackcol" id="rl-list"><span class="empty">${t('Loading…')}</span></div>`,
  wire(root) {
    root.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-rulesw]');
      if (!sw || sw.disabled) return;
      const name = sw.dataset.rulesw;
      const enable = sw.getAttribute('aria-checked') !== 'true';
      const steps = INFO[name].steps(rules[name]).map(([what, when]) => `${what} ${when}`).join(', ');
      ask({ title: enable ? t('Switch {name} on?', { name: INFO[name].title }) : t('Switch {name} off?', { name: INFO[name].title }), text: enable ? t('The panel will act on players by itself: {steps}. Unsaved field changes are not included.', { steps: steps || t('no step is set') }) : '', ok: enable ? t('Switch on') : t('Switch off'), run: () => save(name, { enabled: enable }) });
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
      ask({ title: t('Save {name}?', { name: INFO[form.dataset.rule].title }), ok: t('Save'), run: () => save(form.dataset.rule, values) });
    });
  },
  open: guard(load),
  render() {},
  log() {},
  reload() {},
  reset() { rules = null; overlap = []; open.clear(); }
};
