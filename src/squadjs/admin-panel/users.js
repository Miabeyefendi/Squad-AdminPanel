// Recovery tool, run on the server itself. Day to day admins are managed in the panel.
//   node squad-server/plugins/admin-panel/users.js <dataDir> list
//   node squad-server/plugins/admin-panel/users.js <dataDir> set <name> <owner|admin|senior|junior>
//   node squad-server/plugins/admin-panel/users.js <dataDir> remove <name>
// "set" adds the user or gives a new password. It is read from the terminal (hidden) or from the
// SA_PASSWORD environment variable. SA_DATA_KEY must be the same as for SquadJS, if it is used.
import readline from 'node:readline';

import { hashPassword, loadUsers, passwordProblem, saveUsers } from './auth.js';
import { isRank } from './permissions.js';
import { openVault } from './vault.js';

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let hide = false;
    rl._writeToOutput = (s) => {
      if (!hide) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    hide = true;
  });
}

const stop = (text) => {
  console.log(text);
  process.exit(1);
};
const [dataDir, cmd, name, rank] = process.argv.slice(2);
const usage = 'Usage: users.js <dataDir> list | set <name> <owner|admin|senior|junior> | remove <name>';
if (!dataDir || !cmd) stop(usage);

const vault = openVault(dataDir);
const users = loadUsers(vault);

if (cmd === 'list') {
  for (const u of users) console.log(`${u.name}\t${u.rank}`);
} else if (cmd === 'remove' && name) {
  const rest = users.filter((u) => u.name !== name);
  if (!rest.some((u) => u.rank === 'owner')) stop('There must be a server owner.');
  saveUsers(vault, rest);
  console.log(`Removed ${name}.`);
} else if (cmd === 'set' && name && isRank(rank)) {
  if (rank !== 'owner' && users.some((u) => u.name === name && u.rank === 'owner')) stop('Make another account the owner first.');
  const password = process.env.SA_PASSWORD || (await ask('Password (min 10 characters): '));
  const problem = passwordProblem(password, name);
  if (problem) stop(problem);
  // one server owner: a new one turns the old one into an admin
  const rest = users.filter((u) => u.name !== name)
    .map((u) => (rank === 'owner' && u.rank === 'owner' ? { ...u, rank: 'admin', grants: [], denies: [] } : u));
  saveUsers(vault, [...rest, { name, rank, hash: await hashPassword(password), grants: [], denies: [] }]);
  console.log(`Saved ${name} (${rank}).`);
} else stop(usage);
