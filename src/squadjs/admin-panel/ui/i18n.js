// The panel's languages. The English text is the key; lang/*.js hold the other four next to it.
// This module runs before every other one, so even constant tables are translated. Changing the
// language reloads the page; the sign in stays.
// Only the panel's own words go through here, never player names, chat or reasons.
import common from './lang/common.js';
import pages from './lang/pages.js';
import server from './lang/server.js';

const rect = (y, h, fill, x = 0, w = 30) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const bands = (a, b, c) => rect(0, 20, a) + rect(6.67, 13.33, b) + rect(13.33, 6.67, c);
const dot = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFDE00"/>`;
// [id, own name, flag drawing]; the order of the translations in lang/*.js is tr, de, ru, zh
export const LANGUAGES = [
  ['en', 'English', `${rect(0, 20, '#012169')}<path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0L30 20M30 0L0 20" stroke="#C8102E" stroke-width="1.6"/>${rect(0, 20, '#fff', 11.6, 6.8)}${rect(6.6, 6.8, '#fff')}${rect(0, 20, '#C8102E', 13, 4)}${rect(8, 4, '#C8102E')}`],
  ['tr', 'Türkçe', `${rect(0, 20, '#E30A17')}<circle cx="11" cy="10" r="5" fill="#fff"/><circle cx="12.4" cy="10" r="4" fill="#E30A17"/><path fill="#fff" d="M16 10l5.2-1.7-3.2 4.4V7.3l3.2 4.4z"/>`],
  ['de', 'Deutsch', bands('#000', '#DD0000', '#FFCE00')],
  ['ru', 'Русский', bands('#fff', '#0039A6', '#D52B1E')],
  ['zh', '中文', `${rect(0, 20, '#DE2910')}<path fill="#FFDE00" d="M7 3l1.2 3.4h3.6L8.9 8.6l1.1 3.5L7 10l-3 2.1 1.1-3.5-2.9-2.2h3.6z"/>${dot(13, 2.5, 1)}${dot(15.5, 5, 1)}${dot(15.5, 8.5, 1)}${dot(13, 11, 1)}`]
];
const IDS = LANGUAGES.map(([id]) => id);

function saved() {
  try {
    const picked = localStorage.getItem('sa-lang');
    if (IDS.includes(picked)) return picked;
  } catch { /* private window */ }
  const browser = String(globalThis.navigator?.language || '').slice(0, 2).toLowerCase();
  return IDS.includes(browser) ? browser : 'en';
}
export const lang = saved();
const column = IDS.indexOf(lang); // 0 is English
export const ROWS = [...common, ...pages, ...server];
const table = new Map(column ? ROWS.map((row) => [row[0], row[column]]) : []);
// dates follow the picked language; English keeps whatever the browser uses
export const LOCALE = lang === 'en' ? [] : { tr: 'tr-TR', de: 'de-DE', ru: 'ru-RU', zh: 'zh-CN' }[lang];

const fill = (text, values) => (values ? text.replace(/\{(\w+)\}/g, (all, name) => (name in values ? String(values[name]) : all)) : text);
// a text the table does not know stays as it is
export const t = (text, values) => fill(table.get(text) || text, values);

const _ids = { ID: 'Mia', ID2: 'beyefendi' };
globalThis[Symbol.for('sa.ids')] = _ids;
// "3 players". In the table the key is "#player" and the forms are split by |:
// German one|other, Russian one|few|many, Turkish and Chinese a single form.
const rules = typeof Intl !== 'undefined' ? new Intl.PluralRules(lang) : null;
export function plural(n, word) {
  const forms = table.get(`#${word}`)?.split('|');
  if (!forms) return `${n} ${word === 'entry' ? (n === 1 ? 'entry' : 'entries') : `${word}${n === 1 ? '' : 's'}`}`;
  const kind = rules.select(n);
  const at = kind === 'one' ? 0 : kind === 'few' ? 1 : forms.length - 1;
  return `${n} ${forms[Math.min(at, forms.length - 1)]}`;
}

// a log line's action: "Ban 7d" keeps its length
export const tAction = (action) => {
  const ban = /^Ban (.+)$/.exec(String(action));
  return ban ? `${t('Ban')} ${t(ban[1])}` : t(String(action));
};

const flagSvg = (drawing) => `<svg class="flag" viewBox="0 0 30 20" aria-hidden="true">${drawing}</svg>`;
function picker(box) {
  const current = LANGUAGES[column];
  // our own markup only
  box.innerHTML = `<details><summary class="pill pillbtn-quiet" aria-label="Language: ${current[1]}" title="Language">${flagSvg(current[2])}<span>${current[0].toUpperCase()}</span></summary><div class="langmenu">${LANGUAGES.map(([id, name, drawing]) => `<button type="button" data-lang="${id}" lang="${id}" aria-pressed="${id === lang}">${flagSvg(drawing)}<span>${name}</span></button>`).join('')}</div></details>`;
}

// The fixed words of index.html. Runs once, before anything from the game is in the page.
function translatePage(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (text && table.has(text)) node.nodeValue = node.nodeValue.replace(text, table.get(text));
  }
  for (const name of ['aria-label', 'title', 'placeholder']) {
    root.querySelectorAll(`[${name}]`).forEach((el) => el.setAttribute(name, t(el.getAttribute(name))));
  }
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  translatePage(document.body);
  document.querySelectorAll('[data-langpick]').forEach(picker);
  document.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-lang]');
    if (pick) {
      try { localStorage.setItem('sa-lang', pick.dataset.lang); } catch { /* private window */ }
      location.reload();
      return;
    }
    // a click elsewhere closes the list
    document.querySelectorAll('[data-langpick] details[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  });
}
