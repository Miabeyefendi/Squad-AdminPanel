// Pick a layer: the maps as pictures on the left, the choice built up on the right.
import { $, S, api, ask, draw, gate, guard, html, may, plural, post } from '../core.js';
import { factionName, flag, mapArt, mapKey } from '../art.js';

let layers = null;
let mode = ''; // filter of the map list
const sel = { map: null, mode: null, ver: null, f: [null, null], u: [null, null] };
const uniq = (list) => [...new Set(list)];
const spaced = (t) => t.replace(/([a-z])([A-Z])/g, '$1 $2');
const matching = () => layers.filter((l) => l.map === sel.map && l.mode === sel.mode && l.version === sel.ver);
const chosen = () => (sel.map && sel.mode && sel.ver ? matching()[0] : null);
const factionsFor = (team) => (chosen()?.factions || []).filter((f) => f.teams.includes(team + 1));
const resetSides = () => { sel.f = [null, null]; sel.u = [null, null]; };
const keyOfMap = (name) => mapKey(layers.find((l) => l.map === name)?.id || name);

function layerArgs() {
  const side = (i) => (sel.f[i] ? `${sel.f[i]}${sel.u[i] ? `+${sel.u[i]}` : ''}` : '');
  const body = { layer: chosen().id, team1: side(0), team2: side(1) };
  return { body, text: [body.layer, body.team1, body.team2].filter(Boolean).join(' ') };
}
function pickMode(name) {
  sel.mode = name;
  sel.ver = uniq(layers.filter((l) => l.map === sel.map && l.mode === name).map((l) => l.version)).sort()[0];
  resetSides();
}
function pickMap(name) {
  sel.map = name;
  const modes = uniq(layers.filter((l) => l.map === name).map((l) => l.mode)).sort();
  // the filtered mode if the map has it, so one click gets as far as it can
  pickMode(modes.includes(mode) ? mode : modes.includes('RAAS') ? 'RAAS' : modes[0]);
}

function nowBar() {
  const { server } = S.state;
  const one = (label, layer, factions) => html`<div class="nowone">${layer ? mapArt(mapKey(layer.id || layer.name)) : ''}<span class="stack2 over"><span class="cap">${label}</span><b>${layer ? layer.name : 'Not set'}</b><span class="line">${factions.map((f) => (f ? flag(f) : ''))}</span></span></div>`;
  return html`${one('Now playing', server.layer, server.factions)}${one('Next layer', server.next, server.nextFactions)}
    ${may('match.control') ? html`<div class="nowacts"><button class="btn" data-act="endMatch">End match</button><button class="btn" data-act="restartMatch">Restart match</button></div>` : ''}`;
}

function cards() {
  const q = $('#mp-q').value.trim().toLowerCase();
  const inMode = mode ? layers.filter((l) => l.mode === mode) : layers;
  const maps = uniq(inMode.map((l) => l.map)).sort().filter((m) => m.toLowerCase().includes(q));
  $('#mp-count').textContent = `${plural(maps.length, 'map')} · ${plural(inMode.filter((l) => maps.includes(l.map)).length, 'layer')}`;
  if (!maps.length) return html`<span class="empty">No map matches.</span>`;
  return maps.map((m) => {
    const own = inMode.filter((l) => l.map === m);
    return html`<button class="mapcard" data-map="${m}" data-key="${m}" aria-pressed="${sel.map === m}">${mapArt(keyOfMap(m))}<span class="over"><b>${m}</b><span class="xs">${plural(uniq(own.map((l) => l.mode)).length, 'mode')} · ${plural(own.length, 'layer')}</span></span></button>`;
  });
}
const filterChips = () => [['', 'All modes'], ...uniq(layers.map((l) => l.mode)).sort().map((m) => [m, m])]
  .map(([v, n]) => html`<button class="chip" data-filter="${v}" data-key="f${v}" aria-pressed="${v === mode}">${n}</button>`);

function faction(i) {
  const list = factionsFor(i);
  const current = list.find((f) => f.id === sel.f[i]);
  const t = i + 1;
  return html`<fieldset class="side-pick t${t}"><legend>Team ${t} faction</legend>
    ${list.length ? html`<div class="chips"><button class="chip" data-fac="${i}" data-id="" data-key="fac${i}" aria-pressed="${!sel.f[i]}">Layer default</button>${list.map((f) => html`<button class="chip flagchip" data-fac="${i}" data-id="${f.id}" data-key="fac${i}${f.id}" aria-pressed="${sel.f[i] === f.id}" title="${factionName(f.id)}">${flag(f.id)}${f.id}</button>`)}</div>` : html`<span class="sub">This layer lists no factions, the layer's own are used.</span>`}
    ${current ? html`<span class="sub xs">${factionName(current.id)} · unit type</span><div class="chips">${current.types.map((u) => html`<button class="chip" data-unit="${i}" data-id="${u}" data-key="unit${i}${u}" aria-pressed="${sel.u[i] === u}">${spaced(u)}</button>`)}</div>` : ''}</fieldset>`;
}
function panel() {
  if (!sel.map) return html`<div class="pickempty"><h2>Pick a map</h2><span class="sub">Then choose the mode, version and, if you want, the factions. Nothing is sent until you press a button below.</span></div>`;
  const inMap = layers.filter((l) => l.map === sel.map);
  const layer = chosen();
  const half = !sel.f[0] && !!sel.f[1];
  return html`<div class="preview">${mapArt(keyOfMap(sel.map))}<span class="over"><span class="cap">Your pick</span><b class="layer">${sel.map}</b><span class="mono xs">${layer ? layer.id : ''}</span></span></div>
    <fieldset><legend>Mode</legend><div class="chips">${uniq(inMap.map((l) => l.mode)).sort().map((m) => html`<button class="chip" data-mode="${m}" data-key="m${m}" aria-pressed="${sel.mode === m}">${m}</button>`)}</div></fieldset>
    <fieldset><legend>Version</legend><div class="chips">${uniq(inMap.filter((l) => l.mode === sel.mode).map((l) => l.version)).sort().map((v) => html`<button class="chip mono" data-ver="${v}" data-key="v${v}" aria-pressed="${sel.ver === v}">${String(v).toUpperCase()}</button>`)}</div></fieldset>
    ${faction(0)}${faction(1)}
    <div class="sendbar"><code>${layer ? layerArgs().text : ''}</code>${half ? html`<span class="err">Pick the team 1 faction too: the game reads the factions in order.</span>` : ''}
      <div class="line">${may('map.next') ? html`<button class="btn pri tall grow" data-send="next" ${!layer || half ? html`disabled` : ''}>Set as next</button>` : ''}${may('map.now') ? html`<button class="btn danger tall" data-send="now" ${!layer || half ? html`disabled` : ''}>Change now</button>` : ''}</div>
      ${!may('map.next') && !may('map.now') ? html`<span class="sub xs">You can look at the layers. Changing them needs a higher permission.</span>` : ''}</div>`;
}

const page = {
  id: 'map',
  title: 'Map',
  shell: () => html`<div class="tile nowbar" id="mp-now"></div>
    <div class="mapsplit">
      <div class="stackcol">
        <div class="toolbar"><label class="sr" for="mp-q">Search maps</label><input id="mp-q" class="field search" type="search" placeholder="Search a map"><span class="sub xs" id="mp-count"></span></div>
        <div class="chips" id="mp-modes" role="group" aria-label="Show maps with this mode"></div>
        <div class="mapgrid" id="mp-maps"><span class="empty">Loading the layer list…</span></div>
      </div>
      <aside class="tile pick" id="mp-pick" aria-label="Chosen layer" data-keep-scroll="pick"></aside>
    </div>`,
  wire(root) {
    root.addEventListener('input', (e) => { if (e.target.id === 'mp-q' && layers) this.render(); });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !layers) return;
      const d = b.dataset;
      if (d.filter !== undefined) mode = d.filter;
      else if (d.map) {
        pickMap(d.map);
        this.render();
        // on a narrow screen the choice is below the list
        if (window.matchMedia('(max-width:1000px)').matches) $('#mp-pick').scrollIntoView({ block: 'start' });
        return;
      } else if (d.mode) pickMode(d.mode);
      else if (d.ver) { sel.ver = d.ver; resetSides(); }
      else if (d.fac !== undefined) { sel.f[+d.fac] = d.id || null; sel.u[+d.fac] = null; }
      else if (d.unit !== undefined) sel.u[+d.unit] = sel.u[+d.unit] === d.id ? null : d.id;
      else if (d.send) {
        const { body, text } = layerArgs();
        const now = d.send === 'now';
        ask({ title: now ? 'Change the match now?' : 'Set this layer as next?', text: now ? `Everyone leaves the current match. ${text}` : text, danger: now, ok: now ? 'Yes, change now' : 'Set as next', run: () => post(now ? 'changeLayer' : 'nextLayer', body) });
        return;
      } else return;
      this.render();
    });
  },
  open: guard(async () => {
    page.render();
    if (!layers) layers = await api('/api/layers');
    page.render();
  }),
  render() {
    if (!S.state) return;
    draw($('#mp-now'), nowBar());
    if (!layers) return;
    if (!layers.length) { draw($('#mp-maps'), html`<span class="empty">SquadJS gave no layer list.</span>`); return; }
    draw($('#mp-modes'), filterChips());
    draw($('#mp-maps'), cards());
    draw($('#mp-pick'), panel());
    gate($('#view-map'));
  },
  log() {},
  reload() {},
  reset() { layers = null; mode = ''; Object.assign(sel, { map: null, mode: null, ver: null }); resetSides(); }
};
export default page;
