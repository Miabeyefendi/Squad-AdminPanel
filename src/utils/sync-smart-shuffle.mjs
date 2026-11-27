// Copies Smart Shuffle and its presets from the sibling project into the panel.
//   node src/utils/sync-smart-shuffle.mjs [path to the Smart Shuffle project]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(process.argv[2] || path.join(here, '../../../Mod - Squad-ShuffleTeams'));
const to = path.join(here, '../squadjs/admin-panel/smart-shuffle');

export const adapt = (source) => source.replace("from './base-plugin.js';", "from '../../base-plugin.js';");

// preset name, then from the simulation: lopsided matches %, players moved %, parties kept whole %
const PRESETS = [['default', 'Default', 11.2, 50, 84], ['strict', 'Strict', 10.7, 33, 42], ['tight', 'Tight', 11.7, 22, 65],
  ['balanced', 'Balanced', 12.5, 18, 85], ['steady', 'Steady', 13.1, 15, 86], ['calm', 'Calm', 14.2, 13, 86],
  ['squads', 'Squads', 14.6, 12, 89], ['relaxed', 'Relaxed', 16.6, 11, 90], ['easy', 'Easy', 19.0, 9, 90],
  ['together', 'Together', 21.7, 9, 99], ['light', 'Light', 24.0, 8, 99]];

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const squadjs = path.join(from, 'src/squadjs');
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, 'plugin.js'), adapt(fs.readFileSync(path.join(squadjs, 'smart-shuffle.js'), 'utf8')));
  const presets = PRESETS.map(([file, name, stomped, moved, kept]) => {
    const { plugin, enabled, ...options } = JSON.parse(fs.readFileSync(path.join(squadjs, 'presets', `${file}.json`), 'utf8'));
    return { id: file, name, stomped, moved, kept, options };
  });
  fs.writeFileSync(path.join(to, 'presets.json'), `${JSON.stringify(presets, null, 1)}\n`);
  console.log(`Synced Smart Shuffle and ${presets.length} presets from ${from}`);
}
