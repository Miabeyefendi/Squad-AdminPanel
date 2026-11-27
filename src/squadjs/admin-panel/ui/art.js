// Faction flags and map pictures. The flags are simple drawings made for this panel. The map picture is
// drawn from the map's name. A server owner can replace them with own files (png, jpg or webp, named after
// the map or faction ID): <dataDir>/art/maps for the map seen from above (map picker), art/screens for
// scenery such as a loading picture (the running and the next match), art/factions for flags.
import { S, html, trusted } from './core.js';

const NAMES = {
  ADF: 'Australian Defence Force', AFU: 'Armed Forces of Ukraine', BAF: 'British Armed Forces', CAF: 'Canadian Armed Forces',
  CRF: 'CRF', GFI: 'Ground Forces of Iran', IMF: 'Irregular Militia Forces', MEI: 'Middle Eastern Insurgents',
  PLA: "People's Liberation Army", PLAAGF: 'PLA Amphibious Ground Forces', PLANMC: 'PLA Navy Marine Corps',
  RGF: 'Russian Ground Forces', TLF: 'Turkish Land Forces', USA: 'US Army', USMC: 'US Marine Corps',
  VDV: 'Russian Airborne Forces', WPMC: 'Western Private Military Contractors'
};
// SquadJS sometimes knows a team only by its long name
const BY_NAME = [[/navy marine/i, 'PLANMC'], [/amphibious ground/i, 'PLAAGF'], [/liberation army/i, 'PLA'],
  [/us marine|marine corps/i, 'USMC'], [/us army|united states/i, 'USA'], [/airborne/i, 'VDV'], [/russia/i, 'RGF'],
  [/british/i, 'BAF'], [/canad/i, 'CAF'], [/australia/i, 'ADF'], [/turk/i, 'TLF'], [/ukrain/i, 'AFU'], [/iran/i, 'GFI'],
  [/insurgent/i, 'MEI'], [/militia/i, 'IMF'], [/private military/i, 'WPMC']];

export function factionId(text) {
  const raw = String(text || '').trim();
  const first = raw.split(/[+ ]/)[0].toUpperCase();
  if (NAMES[first]) return first;
  return BY_NAME.find(([pattern]) => pattern.test(raw))?.[1] || null;
}
export const factionName = (id) => NAMES[id] || id;

const rect = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const bands = (...colors) => colors.map((c, i) => rect(0, (i * 20) / colors.length, 30, 20 / colors.length, c)).join('');
function star(cx, cy, r, fill, points = 5) {
  const at = Array.from({ length: points * 2 }, (_, i) => {
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const radius = i % 2 ? r * 0.42 : r;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  });
  return `<polygon points="${at.join(' ')}" fill="${fill}"/>`;
}
const union = (w, h) => `${rect(0, 0, w, h, '#012169')}<path d="M0 0L${w} ${h}M${w} 0L0 ${h}" stroke="#fff" stroke-width="${h * 0.2}"/><path d="M0 0L${w} ${h}M${w} 0L0 ${h}" stroke="#C8102E" stroke-width="${h * 0.08}"/>${rect(w / 2 - h * 0.17, 0, h * 0.34, h, '#fff')}${rect(0, h * 0.33, w, h * 0.34, '#fff')}${rect(w / 2 - h * 0.1, 0, h * 0.2, h, '#C8102E')}${rect(0, h * 0.4, w, h * 0.2, '#C8102E')}`;
const usa = `${bands(...Array.from({ length: 13 }, (_, i) => (i % 2 ? '#fff' : '#B22234')))}${rect(0, 0, 13, 10.8, '#3C3B6E')}${[2.5, 6.5, 10.5].map((x) => [2.7, 5.4, 8.1].map((y) => star(x, y, 1.1, '#fff')).join('')).join('')}`;
const russia = bands('#fff', '#0039A6', '#D52B1E');
const china = `${rect(0, 0, 30, 20, '#DE2910')}${star(7, 7, 4, '#FFDE00')}${[[13, 2.5], [15.5, 5], [15.5, 8.5], [13, 11]].map(([x, y]) => star(x, y, 1.3, '#FFDE00')).join('')}`;
const FLAGS = {
  USA: usa, USMC: usa, RGF: russia, VDV: russia, PLA: china, PLAAGF: china, PLANMC: china,
  BAF: union(30, 20),
  CAF: `${rect(0, 0, 30, 20, '#fff')}${rect(0, 0, 7.5, 20, '#D80621')}${rect(22.5, 0, 7.5, 20, '#D80621')}<path d="M15 4l1.3 2.6 1.6-.8-.6 3.6 1.9-1.7.4 1.2 2-.4-.8 2.5.9.5-3.2 2.7.4 1.2-3.4-.5V18h-1v-3.1l-3.4.5.4-1.2-3.2-2.7.9-.5-.8-2.5 2 .4.4-1.2 1.9 1.7-.6-3.6 1.6.8z" fill="#D80621"/>`,
  ADF: `${rect(0, 0, 30, 20, '#012169')}${union(15, 10)}${star(7.5, 15, 2.6, '#fff', 7)}${[[22.5, 4], [19.5, 9], [25.5, 8], [22.5, 16]].map(([x, y]) => star(x, y, 1.4, '#fff', 7)).join('')}`,
  TLF: `${rect(0, 0, 30, 20, '#E30A17')}<circle cx="11" cy="10" r="5" fill="#fff"/><circle cx="12.4" cy="10" r="4" fill="#E30A17"/>${star(18.3, 10, 2.5, '#fff')}`,
  AFU: bands('#0057B7', '#FFD700'),
  GFI: `${bands('#239F40', '#fff', '#DA0000')}<circle cx="15" cy="10" r="2" fill="none" stroke="#DA0000" stroke-width="1"/>`
};
// groups that belong to no country get a neutral emblem with their short name
const emblem = (id) => `${rect(0, 0, 30, 20, '#52525B')}<path d="M15 2l8 3v5c0 4-3.4 6.8-8 8-4.600-1.200-8-4-8-8V5z" fill="#27272A" stroke="#A1A1AA" stroke-width=".8"/><text x="15" y="12.400" text-anchor="middle" font-family="sans-serif" font-size="${id.length > 3 ? 4.6 : 5.6}" font-weight="700" fill="#FAFAFA">${id.replace(/[^A-Z0-9]/g, '')}</text>`;

const own = (kind, key) => {
  const flat = (s) => String(s).toLowerCase().replace(/\.(png|jpe?g|webp)$/, '').replace(/[^a-z0-9]/g, '');
  const file = S.assets[kind].find((f) => flat(f) === flat(key));
  return file ? `/art/${kind}/${encodeURIComponent(file)}` : null;
};

export function flag(text, size = '') {
  const id = factionId(text);
  if (!id) return '';
  const picture = own('factions', id);
  const title = factionName(id);
  if (picture) return html`<img class="flag ${size}" src="${picture}" alt="${title}" title="${title}">`;
  return trusted(`<svg class="flag ${size}" viewBox="0 0 30 20" role="img" aria-label="${title.replace(/"/g, '&quot;')}">${FLAGS[id] || emblem(id)}</svg>`);
}

// the same name always gives the same drawing: height lines around a few hills
function drawing(key) {
  let seed = [...key].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const hills = Array.from({ length: 3 }, (_, h) => {
    const [x, y] = [40 + random() * 240, 20 + random() * 140];
    const shape = Array.from({ length: 10 }, () => 0.65 + random() * 0.7);
    return Array.from({ length: 5 - h }, (_, ring) => {
      const size = 14 + ring * 17;
      const at = shape.map((s, i) => {
        const angle = (Math.PI * 2 * i) / shape.length;
        return [x + Math.cos(angle) * size * s * 1.5, y + Math.sin(angle) * size * s];
      });
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2].map((n) => n.toFixed(1)).join(' ');
      const path = at.map((p, i) => `Q${p.map((n) => n.toFixed(1)).join(' ')} ${mid(p, at[(i + 1) % at.length])}`).join('');
      return `<path d="M${mid(at.at(-1), at[0])}${path}Z" opacity="${(0.62 - ring * 0.09).toFixed(2)}"/>`;
    }).join('');
  }).join('');
  const shade = 22 + Math.floor(random() * 16);
  return `<svg class="art" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="320" height="180" fill="rgb(${shade},${shade},${shade + 4})"/><g fill="none" stroke="#D4D4D8" stroke-width="1">${hills}</g></svg>`;
}

// "Narva_AAS_v1" and "Black Coast" both find their own picture
export const mapKey = (layerOrMap) => String(layerOrMap || '').split(/[_]/)[0].replace(/[^A-Za-z0-9]/g, '');
const art = (kind, key) => {
  const picture = own(kind, key);
  if (picture) return html`<img class="art" src="${picture}" alt="" loading="lazy">`;
  return trusted(drawing(mapKey(key).toLowerCase() || 'unknown'));
};
export const mapArt = (key) => art('maps', key);
// never the view from above: without a scenery file this is the drawing
export const sceneArt = (key) => art('screens', key);
