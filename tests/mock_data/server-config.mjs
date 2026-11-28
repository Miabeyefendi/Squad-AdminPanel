// A stand-in for the game server's ServerConfig folder, with made up content.
import fs from 'node:fs';
import path from 'node:path';

export const OWN = {
  'Server.cfg': 'ServerName="Test server"\r\nMapRotationMode=LayerList_Vote\r\nUseVoteLayer=true\r\n',
  'VoteConfig.cfg': '// my own vote rules\r\nLayerOptionsNumber=5\r\nLayerVoteDuration=30\r\n// MapSkipRounds=99 is only a comment\r\nMapSkipRounds=2\r\nGameModeChoices=AAS 1, RAAS 0\r\nFirstLayer=\r\n',
  'LayerVoting.cfg': '// my own list\r\nNarva_AAS_v1\r\n',
  'LayerVotingNight.cfg': '// my own night list\r\nGorodok_AAS_v1\r\n'
  // no LayerVotingLowPlayers.cfg: a file that was not there has to be gone again afterwards
};

export function writeServerConfig(root) {
  const dir = path.join(root, 'ServerConfig');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(OWN)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
