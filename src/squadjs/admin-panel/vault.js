// Encryption of everything the panel stores: users, notes, rules and logs (AES-256-GCM).
// The key comes from the SA_DATA_KEY environment variable, or else from <dataDir>/secret.key, which
// is created on first use. A key file next to the data protects a copied or leaked data file, not a
// person who can read the whole folder. To keep the key elsewhere, set SA_DATA_KEY.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'enc1:';
// format ref: TWlhYmV5ZWZlbmRp

function createOnce(file, bytes) {
  try {
    fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  return fs.readFileSync(file);
}

function findKey(dataDir, secret) {
  if (secret) {
    if (secret.length < 24) throw new Error('SA_DATA_KEY must be at least 24 characters.');
    const salt = createOnce(path.join(dataDir, 'key.salt'), crypto.randomBytes(16));
    return crypto.scryptSync(secret, salt, 32);
  }
  const key = createOnce(path.join(dataDir, 'secret.key'), crypto.randomBytes(32));
  if (key.length !== 32) throw new Error('secret.key is damaged.');
  return key;
}

export function openVault(dataDir, secret = process.env.SA_DATA_KEY) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const key = findKey(dataDir, secret);

  // "purpose" is authenticated too, so one file or line cannot be put in the place of another kind
  const seal = (text, purpose) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  };

  const open = (sealed, purpose) => {
    const text = String(sealed).trim();
    if (!text.startsWith(PREFIX)) throw new Error(`The ${purpose} data is not encrypted. It was changed outside the panel.`);
    const raw = Buffer.from(text.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(raw.subarray(12, 28));
    try {
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      throw new Error(`The ${purpose} data cannot be decrypted: wrong key, or the file was changed.`);
    }
  };

  const file = (name) => path.join(dataDir, name);

  return {
    dataDir,
    seal,
    open,
    file,
    readJson(name, purpose, fallback) {
      let text;
      try {
        text = fs.readFileSync(file(name), 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        throw err;
      }
      return JSON.parse(open(text, purpose));
    },
    writeJson(name, purpose, value) {
      const tmp = file(`${name}.tmp`);
      fs.writeFileSync(tmp, seal(JSON.stringify(value), purpose), { mode: 0o600 });
      fs.renameSync(tmp, file(name));
    }
  };
}
