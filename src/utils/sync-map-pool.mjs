// Copies the vote pools of the sibling Squad-MapPool project into the panel, as one file.
//   node src/utils/sync-map-pool.mjs [path to the Squad-MapPool project]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const to = path.join(here, '../squadjs/admin-panel/map-pool/pools.json');

// key -> [name, what it does]; the weekly families below take the number of weeks
const INFO = {
  '03-day-night': ['Recommended Day / Evening', 'Narva and Gorodok in the day, Mutaha, Fallujah and Yehorivka in the evening. All other maps all day.'],
  '01-weekly-plan-4w': ['Weekly 4 Weeks', 'One big map per week, all other maps every week.'],
  '02-weekly-plan-5w': ['Weekly 5 Weeks', 'Same as the 4 week plan, but Gorodok and Yehorivka get their own week.'],
  '04-all-best': ['All Maps Best', 'Every map with its most played RAAS and Invasion layer.'],
  '05-raas-best': ['Only RAAS', 'Most played RAAS layer of every map. No Invasion.'],
  '06-invasion-best': ['Only Invasion', 'Most played Invasion layer of every map. No RAAS.'],
  '07-size-large': ['Big Maps', 'Only maps of 4 km and more.'],
  '08-size-medium': ['Medium Maps', 'Only Narva, Mutaha, Fallujah and Anvil. 4 vote options.'],
  '09-size-small': ['Small Maps', 'Only Sumari, Logar, Fools Road, Mestia and Kokan. 4 vote options.'],
  '13-seed-low-players': ['Seed (low player count)', 'Small, fast RAAS maps while the server fills up. Goes on top of any other pool.'],
  '14-biome-balanced': ['Biome Balanced', 'Desert and forest maps about half and half.'],
  '15-rising': ['Rising Maps', 'More layers for maps that grew lately.'],
  '16-discovery': ['Discovery', 'The less played half of the maps with all their layers, popular maps with one layer.'],
  '00-today': ['Default All Layers', 'Every RAAS and Invasion layer, like a default vote server. The baseline.']
};
const FAMILIES = {
  '10-cycle-variety-': ['Variety {n} Weeks', 'The 9 most played maps are spread over {n} weeks, small maps every week.'],
  '11-cycle-favorites-': ['Favorites {n} Weeks', 'The 9 most played maps every week, small maps spread over {n} weeks.'],
  '12-cycle-low-variety-': ['Low Variety {n} Weeks', 'Only 8 maps per week, Narva, Mutaha and Fallujah always in. For tests: it shows what a too small pool does.']
};
const family = (prefix) => [2, 3, 4, 5, 6, 7].map((n) => `${prefix}${n}w`);
const GROUPS = [
  ['Recommended', ['03-day-night']],
  ['Weekly plans', ['01-weekly-plan-4w', '02-weekly-plan-5w']],
  ['One pool all the time', ['04-all-best', '05-raas-best', '06-invasion-best', '14-biome-balanced', '15-rising', '16-discovery', '00-today']],
  ['By map size', ['07-size-large', '08-size-medium', '09-size-small']],
  ['Weekly cycles: variety', family('10-cycle-variety-')],
  ['Weekly cycles: favorites', family('11-cycle-favorites-')],
  ['Weekly cycles: low variety', family('12-cycle-low-variety-')],
  ['Seeding add-on', ['13-seed-low-players']]
];

function info(key) {
  if (INFO[key]) return { name: INFO[key][0], what: INFO[key][1] };
  const [prefix, [name, what]] = Object.entries(FAMILIES).find(([p]) => key.startsWith(p));
  const n = Number(key.slice(prefix.length, -1));
  return { name: name.replace('{n}', n), what, n };
}

const text = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const keys = (source) => Object.fromEntries(source.split('\n').map((l) => /^\s*([A-Za-z]+)\s*=(.*)$/.exec(l))
  .filter(Boolean).map((m) => [m[1], m[2].trim()]));

export function build(from) {
  const root = path.join(from, 'src/configs');
  const sim = JSON.parse(text(path.join(root, 'results.json')));
  const numbers = (k) => ({ top3: Math.round(sim[k].top3), top3In3: Math.round(sim[k].top3_in3), mapsDay: Math.round(sim[k].maps_day * 10) / 10 });
  const pools = GROUPS.flatMap(([, ids]) => ids).map((id) => {
    const dir = path.join(root, 'pools', id);
    const files = (folder) => Object.fromEntries(fs.readdirSync(folder).filter((f) => /^LayerVoting\w*\.cfg$/.test(f)).sort()
      .map((f) => [f, text(path.join(folder, f))]));
    const weeks = fs.readdirSync(dir).filter((f) => /^week-\d+$/.test(f)).sort((a, b) => a.slice(5) - b.slice(5));
    const list = weeks.length ? weeks.map((w) => files(path.join(dir, w))) : [files(dir)];
    // the seeding list goes on top of another pool, so it must not change that pool's vote rules
    const seed = Object.keys(list[0]).join() === 'LayerVotingLowPlayers.cfg';
    return { id, ...info(id), seed, weeks: list, vote: seed ? {} : keys(text(path.join(dir, 'VoteConfig.cfg'))), sim: numbers(id) };
  });
  return { project: 'https://github.com/Miabeyefendi/Squad-MapPool', baseline: numbers('00-today'), groups: GROUPS, pools };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const data = build(path.resolve(process.argv[2] || path.join(here, '../../../Squad-MapPool')));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, `${JSON.stringify(data, null, 1)}\n`);
  console.log(`Synced ${data.pools.length} map pools`);
}
