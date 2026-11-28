// The web server: static UI, JSON API and a server-sent event stream.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

import { cleanText } from './actions.js';
import { PanelError, fail, has } from './errors.js';
import { RateWindow } from './limiter.js';
import { PERMISSIONS, RANKS } from './permissions.js';
import { ALL_KINDS, LOG_KINDS } from './store.js';

// the only files of the UI folder that are ever served
const SCRIPTS = ['app.js', 'core.js', 'art.js', 'i18n.js', ...['overview', 'score', 'players', 'map', 'shuffle', 'rules', 'plugins',
  'records', 'staff', 'server'].map((page) => `pages/${page}.js`), ...['common', 'pages', 'server'].map((part) => `lang/${part}.js`)];
const UI = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  ...Object.fromEntries(SCRIPTS.map((file) => [`/${file}`, [file, 'text/javascript; charset=utf-8']]))
};
// pictures the server owner adds under <dataDir>/art: maps (from above), screens (scenery) and factions
const ART_KINDS = ['maps', 'screens', 'factions'];
const ART_FILE = /^[A-Za-z0-9_-]{1,60}\.(png|jpe?g|webp)$/i;
const ART_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // search engines: do not list, follow, copy or preview anything of the panel
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  'Cache-Control': 'no-store'
};
// Search engines, archivers, AI crawlers and internet scanners that say who they are. A name can be
// faked, so this keeps out the honest ones only; the sign in is what protects the panel.
const CRAWLERS = /(bot\b|bot\/|crawl|spider|slurp|mediapartners|facebookexternalhit|embedly|preview|archive\.org|ia_archiver|censys|shodan|zgrab|masscan|nmap|nuclei|nikto|sqlmap|dirbuster|gobuster|internetmeasurement|expanse|netcraft|python-requests|go-http-client|scrapy)/i;
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
const LOOPBACK_IP = /^(127\.|::1$|::ffff:127\.)/;
export const isLoopback = (host) => LOOPBACK.includes(host);
const MAX_STREAMS = 30;
const MAX_STREAMS_PER_SESSION = 3;
const FIRST = ['/api/me', '/api/account', '/api/logout'];

const may = (user, id) => user.perms.has(id);
const SERVER_PAGE = ['messages.schedule', 'server.settings', 'server.password', 'notify.manage'];
const mayStaff = (user) => may(user, 'staff.admins') || may(user, 'staff.manage') || may(user, 'perm.grant');
const whoAmI = (u) => ({ name: u.name, rank: u.rank, rankName: RANKS[u.rank].name, mustChange: u.mustChange,
  defaultPassword: u.defaultPassword, can: [...u.perms] });
const signature = (u) => `${u.rank}:${[...u.perms].sort().join(',')}`;

// What of each log a user may read. Sign in records carry network addresses.
function visibleLog(user, entry) {
  if (entry.kind === 'chat') return may(user, 'chat.view');
  if (entry.kind === 'kills' || entry.kind === 'tk') return may(user, 'kills.view');
  if (entry.kind === 'conn') return may(user, 'view.live');
  return /^Login/.test(entry.action) ? may(user, 'log.ip') : may(user, 'log.admin');
}
// the live picture, without the player history for those who may not read it
function visibleState(user, state) {
  if (may(user, 'notes.view')) return state;
  return { ...state, players: state.players.map((p) => ({ ...p, notes: 0, warns: 0, kicks: 0, bans: 0 })) };
}

function artList(dataDir) {
  return Object.fromEntries(ART_KINDS.map((kind) => {
    try {
      return [kind, fs.readdirSync(path.join(dataDir, 'art', kind)).filter((f) => ART_FILE.test(f))];
    } catch {
      return [kind, []];
    }
  }));
}

export function createPanelServer(deps) {
  const { auth, actions, tracker, store, rules, shuffle, schedule, notifier, configFile, getLayers, restart, options, uiDir, tls } = deps;
  const streams = new Set();
  const secure = !!tls || !!options.secureCookie;
  const cookieName = secure ? '__Host-sa_session' : 'sa_session';
  const requests = new RateWindow({ limit: 900 });
  const posts = new RateWindow({ limit: 120 });
  const hosts = () => [...(isLoopback(options.host) ? LOOPBACK : []), ...(options.allowedHosts || [])]
    .map((h) => String(h).toLowerCase());
  const headers = () => (secure ? { ...HEADERS, 'Strict-Transport-Security': 'max-age=31536000' } : HEADERS);

  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, { ...headers(), 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(body));
  };
  const sendText = (res, status, text, extra = {}) => {
    res.writeHead(status, { ...headers(), 'Content-Type': 'text/plain; charset=utf-8', ...extra });
    res.end(text);
  };
  const cookie = (req) => new RegExp(`(?:^|;\\s*)${cookieName}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.cookie || '')?.[1];
  const setCookie = (id, maxAge) =>
    `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const signedIn = (res, result) => send(res, 200, whoAmI(result),
    { 'Set-Cookie': setCookie(result.id, Math.floor(auth.sessionMs / 1000)) });
  const audit = (by, action, target, reason = '') =>
    store.log('admin', { by: cleanText(by, 40), action, target: cleanText(target, 80), reason: cleanText(reason, 300) });

  // Behind a trusted proxy on this machine, the proxy's last X-Forwarded-For entry is the visitor.
  function clientIp(req) {
    const direct = req.socket.remoteAddress || '';
    if (options.trustProxy && LOOPBACK_IP.test(direct)) {
      const last = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
      if (last) return last.slice(0, 64);
    }
    return direct;
  }
  // "On this machine": used only for the first account. Anything that looks proxied does not count.
  const isLocal = (req, hostName) => !options.trustProxy && LOOPBACK_IP.test(req.socket.remoteAddress || '') &&
    isLoopback(hostName) && !['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'via']
    .some((h) => h in req.headers);

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 262144) {
          reject(new PanelError('Request too large.', 413));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
          resolve(body);
        } catch {
          reject(new PanelError('Invalid JSON.'));
        }
      });
      req.on('error', reject);
    });
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  const write = (stream, event, data) => stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  function deliver(event, data) {
    for (const stream of streams) {
      const user = auth.session(stream.id, { touch: false });
      // a slow or stuck reader is dropped, so unsent data cannot pile up in memory
      if (!user || user.mustChange || stream.res.writableLength > 4 * 1024 * 1024) {
        stream.res.end();
        streams.delete(stream);
        continue;
      }
      if (stream.signature !== signature(user)) {
        stream.signature = signature(user);
        write(stream, 'me', whoAmI(user));
        write(stream, 'state', visibleState(user, tracker.snapshot()));
      }
      if (event === 'state') write(stream, 'state', visibleState(user, data));
      else if (event === 'log' && visibleLog(user, data)) write(stream, 'log', data);
      else if (event === 'reload') write(stream, 'reload', data);
    }
  }
  const broadcast = (event, data) => deliver(event, data);
  // after a change of permissions, open panels hear about it at once
  const refresh = () => deliver('refresh');

  async function staffChange(user, body, ip) {
    await auth.confirm(user, body.confirmPassword, ip);
    const name = String(body.name ?? '').slice(0, 64);
    const op = String(body.op ?? '');
    if (op === 'add') {
      const { held } = await auth.addUser(user, { name, rank: String(body.rank), password: body.password });
      audit(user.name, 'Register account', name, `${body.rank}${held.length ? `; held back: ${held.join(', ')}` : ''}`);
    } else if (op === 'reset') {
      await auth.resetPassword(user, name, body.password ?? '');
      audit(user.name, 'Reset password', name);
    } else if (op === 'remove') {
      await auth.removeUser(user, name);
      audit(user.name, 'Remove account', name);
    } else if (op === 'rank') {
      await auth.setRank(user, name, String(body.rank));
      audit(user.name, 'Change rank', name, String(body.rank));
    } else if (op === 'transfer') {
      await auth.transferOwner(user, name);
      audit(user.name, 'Hand over ownership', name);
    } else if (op === 'ticks') {
      await auth.setTicks(user, name, body.changes);
      audit(user.name, 'Permissions', name, Object.entries(body.changes).map(([k, on]) => `${on ? '+' : '-'}${k}`).join(' '));
    } else if (op === 'resetTicks') {
      await auth.resetTicks(user, name);
      audit(user.name, 'Permissions', name, 'back to rank defaults');
    } else fail('Unknown change.');
    refresh();
  }

  // times arrive as numbers; "to" is not included
  function purgeRequest(body) {
    const kinds = Array.isArray(body.kinds) ? [...new Set(body.kinds)] : [];
    if (!kinds.length || kinds.some((k) => !ALL_KINDS.includes(k))) fail('Pick what to delete.');
    return { kinds, ...period(body.from, body.to) };
  }

  // from and to in milliseconds; a missing end is open
  function period(start, end) {
    const from = start === null || start === undefined ? 0 : start;
    const to = end === null || end === undefined ? Infinity : end;
    if (typeof from !== 'number' || typeof to !== 'number' || !(from >= 0) || !(to > from)) fail('The dates do not make a period.');
    return { from, to };
  }
  const askedPeriod = (url) => period(...['from', 'to'].map((key) => (url.searchParams.get(key) ? Number(url.searchParams.get(key)) : null)));

  async function recordsChange(user, body, ip) {
    const op = String(body.op ?? '');
    if (op === 'preview') {
      const days = {};
      return { counts: store.purge({ ...purgeRequest(body), dryRun: true, days }), days };
    }
    await auth.confirm(user, body.confirmPassword, ip);
    if (op === 'delete') {
      const request = purgeRequest(body);
      const counts = store.purge(request);
      // written after the deletion, so the record of it stays
      audit(user.name, 'Records deleted', Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', '),
        `${request.from ? new Date(request.from).toISOString().slice(0, 10) : 'start'} to ${Number.isFinite(request.to) ? new Date(request.to).toISOString().slice(0, 10) : 'now'}`);
      reload();
      return { counts, overview: store.overview() };
    }
    if (op === 'retention') {
      store.setRetention(body.retention);
      audit(user.name, 'Records retention', Object.entries(body.retention).map(([k, d]) => `${k} ${d || 'for ever'}`).join(', '));
      reload();
      return { overview: store.overview() };
    }
    return fail('Unknown change.');
  }

  // what was on screen may be gone: open panels read the logs again
  const reload = () => deliver('reload', {});

  const shufflePage = (user) => shuffle.describe(may(user, 'shuffle.settings'));

  // only the parts this account may change
  async function serverPage(user) {
    const page = {};
    if (may(user, 'server.settings')) page.settings = { maxPlayers: tracker.server.maxPlayers || null };
    if (may(user, 'server.password')) page.password = { blocked: await actions.passwordBlock() };
    if (may(user, 'messages.schedule')) page.schedule = schedule.items;
    if (may(user, 'notify.manage')) page.notify = notifier.describe();
    return page;
  }

  async function serverChange(user, body, ip) {
    const op = String(body.op ?? '');
    const need = { schedule: 'messages.schedule', notify: 'notify.manage', notifyTest: 'notify.manage', password: 'server.password' };
    if (!has(need, op)) fail('Unknown change.');
    if (!may(user, need[op])) fail('You do not have permission for this.', 403);
    if (op === 'schedule') {
      const items = schedule.save(body.items);
      audit(user.name, 'Announcements', `${items.filter((i) => i.enabled).length} on, ${items.length} saved`);
    } else if (op === 'notify') {
      await auth.confirm(user, body.confirmPassword, ip);
      const saved = notifier.save(body.change);
      // the address itself is never written down
      audit(user.name, 'Discord notices', saved.enabled ? 'on' : 'off', body.change?.url === undefined ? '' : 'address changed');
    } else if (op === 'notifyTest') {
      await notifier.test();
    } else {
      await auth.confirm(user, body.confirmPassword, ip);
      await actions.setPassword(user, body.password);
    }
    return serverPage(user);
  }

  const staffPage = (user) => ({ ...auth.staff(user), catalog: Object.values(PERMISSIONS),
    ranks: Object.fromEntries(Object.entries(RANKS).map(([id, r]) => [id, r])) });

  async function route(req, res) {
    const ip = clientIp(req);
    if (!requests.take(ip)) return sendText(res, 429, 'Too many requests.', { 'Retry-After': '60' });
    const hostName = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
    // stops another website from reaching a local panel through DNS rebinding
    if (!hosts().includes(hostName)) return sendText(res, 421, 'Unknown host name.');
    let url;
    try {
      url = new URL(req.url, 'http://panel');
    } catch {
      return sendText(res, 400, 'Bad request.');
    }
    const where = url.pathname;

    if (where === '/robots.txt') return sendText(res, 200, 'User-agent: *\nDisallow: /\n');
    if (CRAWLERS.test(String(req.headers['user-agent'] || ''))) return sendText(res, 403, 'Forbidden.');

    if (req.method === 'GET' && has(UI, where)) {
      const [file, type] = UI[where];
      res.writeHead(200, { ...headers(), 'Content-Type': type });
      return res.end(fs.readFileSync(new URL(file, uiDir)));
    }

    // browsers say where a request comes from; the API takes none from another site
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return send(res, 403, { error: 'Blocked request.' });

    if (req.method === 'POST') {
      // a custom header and a JSON type cannot be sent cross-site without a CORS preflight, which fails here
      if (req.headers['x-sa'] !== '1' || !String(req.headers['content-type']).startsWith('application/json') ||
          !sameOrigin(req)) return send(res, 403, { error: 'Blocked request.' });
      if (!posts.take(ip)) return send(res, 429, { error: 'Too many requests. Wait a minute.' }, { 'Retry-After': '60' });
    } else if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });

    if (where === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name ?? '').slice(0, 64);
      const result = await auth.login(name, String(body.password ?? ''), ip, { local: isLocal(req, hostName) });
      if (result.error === 'locked' || result.error === 'busy') {
        return send(res, 429, { error: 'Too many tries. Wait a while.' }, { 'Retry-After': '60' });
      }
      if (result.error) {
        // the answer is the same for every reason, so it tells a stranger nothing
        audit(name, 'Login failed', ip, result.error === 'localOnly' ? 'first account used from outside this machine' : '');
        return send(res, 401, { error: 'Wrong name or password.' });
      }
      audit(result.name, 'Login', ip);
      return signedIn(res, result);
    }

    const id = cookie(req);
    const user = id && auth.session(id);
    if (!user) return send(res, 401, { error: 'Sign in first.' });
    // checked on every request, not only at sign in: admin / admin never works from anywhere else
    if (user.defaultPassword && !isLocal(req, hostName)) return send(res, 401, { error: 'Sign in first.' });
    if (user.mustChange && !FIRST.includes(where)) {
      return send(res, 403, { error: 'Change your password first.', mustChange: true });
    }

    if (req.method === 'GET') {
      const denied = () => send(res, 403, { error: 'You do not have permission for this.' });
      if (where === '/api/me') return send(res, 200, whoAmI(user));
      if (where === '/api/state') return send(res, 200, visibleState(user, tracker.snapshot()));
      if (where === '/api/layers') return send(res, 200, await getLayers());
      if (where === '/api/rules') return may(user, 'rules.view') ? send(res, 200, rules.config) : denied();
      if (where === '/api/logs') {
        const kind = url.searchParams.get('kind');
        if (!LOG_KINDS.includes(kind)) return send(res, 400, { error: 'Unknown log.' });
        const month = url.searchParams.get('month');
        let list;
        if (url.searchParams.has('from') || url.searchParams.has('to')) {
          const { from, to } = askedPeriod(url);
          list = store.range(kind, from, to);
        } else list = month ? store.month(kind, month) : store.logs[kind];
        return send(res, 200, list.filter((entry) => visibleLog(user, entry)));
      }
      if (where === '/api/months') return send(res, 200, store.months());
      if (where === '/api/server') {
        return SERVER_PAGE.some((p) => may(user, p)) ? send(res, 200, await serverPage(user)) : denied();
      }
      if (where === '/api/recent') {
        return send(res, 200, tracker.recentlyLeft().map((p) => ({ ...p,
          teamkills: may(user, 'kills.view') ? p.teamkills : 0,
          ...(may(user, 'notes.view') ? {} : { notes: 0, warns: 0, kicks: 0, bans: 0 }) })));
      }
      if (where === '/api/shuffle') return send(res, 200, shufflePage(user));
      if (where === '/api/records') return may(user, 'data.manage') ? send(res, 200, store.overview()) : denied();
      if (where === '/api/records/timeline') {
        return may(user, 'notes.view')
          ? send(res, 200, store.timeline({ ...askedPeriod(url), query: url.searchParams.get('q') })) : denied();
      }
      if (where === '/api/assets') return send(res, 200, artList(store.dataDir));
      if (where.startsWith('/art/')) {
        const [, , kind, name] = where.split('/');
        // only a name that is in the listing is read, so no path can be smuggled in
        if (!ART_KINDS.includes(kind) || !artList(store.dataDir)[kind].includes(name)) return send(res, 404, { error: 'Not found.' });
        const file = path.join(store.dataDir, 'art', kind, name);
        const { size, mtimeMs } = fs.statSync(file);
        // the browser keeps the picture but asks each time, so a replaced file shows at once
        const etag = `"${size}-${Math.round(mtimeMs)}"`;
        const cached = { ...headers(), 'Cache-Control': 'private, no-cache', ETag: etag };
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, cached);
          return res.end();
        }
        res.writeHead(200, { ...cached, 'Content-Type': ART_TYPES[name.split('.').pop().toLowerCase()] });
        return res.end(fs.readFileSync(file));
      }
      if (where === '/api/records/players') {
        return may(user, 'notes.view') ? send(res, 200, store.search(url.searchParams.get('q'))) : denied();
      }
      if (where === '/api/player') {
        const record = store.player(url.searchParams.get('id') || '');
        return send(res, 200, may(user, 'notes.view') ? record
          : { name: record.name, firstSeen: record.firstSeen, notes: [], history: [], hidden: true });
      }
      if (where === '/api/staff') return mayStaff(user) ? send(res, 200, staffPage(user)) : denied();
      if (where === '/api/ranks') {
        return may(user, 'ranks.edit') ? send(res, 200, { ranks: auth.ranks(), catalog: Object.values(PERMISSIONS) }) : denied();
      }
      if (where === '/api/plugins') return may(user, 'plugins') ? send(res, 200, await configFile.list()) : denied();
      if (where === '/api/events') {
        const mine = [...streams].filter((s) => s.id === id);
        for (const old of mine.slice(0, Math.max(0, mine.length - MAX_STREAMS_PER_SESSION + 1))) {
          old.res.end();
          streams.delete(old);
        }
        if (streams.size >= MAX_STREAMS) return send(res, 429, { error: 'Too many open panels.' });
        res.writeHead(200, { ...headers(), 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        const stream = { id, res, signature: signature(user) };
        streams.add(stream);
        write(stream, 'state', visibleState(user, tracker.snapshot()));
        req.on('close', () => streams.delete(stream));
        return undefined;
      }
      return send(res, 404, { error: 'Not found.' });
    }

    const body = await readBody(req);
    if (where === '/api/logout') {
      auth.logout(id);
      return send(res, 200, {}, { 'Set-Cookie': setCookie('', 0) });
    }
    if (where === '/api/account') {
      const result = await auth.changeOwn(user, body, ip);
      audit(result.name, 'Account changed', result.name, user.name === result.name ? '' : `was ${user.name}`);
      return signedIn(res, result);
    }
    const denied = () => send(res, 403, { error: 'You do not have permission for this.' });
    if (where === '/api/records') {
      if (!may(user, 'data.manage')) return denied();
      return send(res, 200, await recordsChange(user, body, ip));
    }
    if (where === '/api/server') return send(res, 200, await serverChange(user, body, ip));
    if (where === '/api/shuffle') {
      if (!may(user, 'shuffle.settings')) return denied();
      const op = String(body.op ?? '');
      if (op === 'settings') {
        await shuffle.apply(body.changes);
        // the value of a secret is never written to the log
        audit(user.name, 'Smart Shuffle settings', Object.keys(body.changes).join(', '));
      } else if (op === 'preset') {
        await shuffle.preset(String(body.id));
        audit(user.name, 'Smart Shuffle preset', String(body.id));
      } else if (op === 'enabled') {
        await shuffle.setEnabled(body.on === true);
        audit(user.name, 'Smart Shuffle', body.on === true ? 'switched on' : 'switched off');
      } else fail('Unknown change.');
      tracker.changed();
      return send(res, 200, shufflePage(user));
    }
    if (where === '/api/staff') {
      if (!mayStaff(user)) return denied();
      await staffChange(user, body, ip);
      // handing over ownership can take the staff page away from the one who did it
      const now = auth.session(id);
      return send(res, 200, now && mayStaff(now) ? staffPage(now) : { gone: true });
    }
    if (where === '/api/ranks') {
      if (!may(user, 'ranks.edit')) return denied();
      await auth.confirm(user, body.confirmPassword, ip);
      await auth.setRankDefaults(user, String(body.rank), body.changes);
      audit(user.name, 'Rank defaults', String(body.rank), Object.entries(body.changes).map(([k, on]) => `${on ? '+' : '-'}${k}`).join(' '));
      refresh();
      return send(res, 200, { ranks: auth.ranks(), catalog: Object.values(PERMISSIONS) });
    }
    if (where.startsWith('/api/action/')) {
      const result = await actions.run(user, where.slice('/api/action/'.length), body);
      tracker.changed();
      return send(res, 200, result);
    }
    if (where === '/api/rules') {
      if (!may(user, 'rules.edit')) return denied();
      const saved = rules.update(body);
      audit(user.name, 'Rules', Object.keys(body).join(', '));
      return send(res, 200, saved);
    }
    if (where === '/api/plugins') {
      if (!may(user, 'plugins')) return denied();
      const { confirmPassword, ...change } = body;
      await auth.confirm(user, confirmPassword, ip);
      const list = change.op === 'add' ? await configFile.add(change.name) : await configFile.save(change);
      audit(user.name, 'Plugin settings', String(change.name),
        [change.op === 'add' ? 'added to config.json' : '', change.enabled === undefined ? '' : change.enabled ? 'switched on' : 'switched off',
          Object.keys(change.options || {}).join(', ')].filter(Boolean).join('; '));
      return send(res, 200, list);
    }
    if (where === '/api/restart') {
      if (!may(user, 'restart')) return denied();
      if (!options.allowRestart) return send(res, 409, { error: 'Restart from the panel is off (allowRestart).' });
      await auth.confirm(user, body.confirmPassword, ip);
      audit(user.name, 'Restart SquadJS', 'SquadJS');
      send(res, 200, {});
      return restart();
    }
    return send(res, 404, { error: 'Not found.' });
  }

  const handle = (req, res) => {
    route(req, res).catch((err) => {
      deps.onError?.(err);
      if (res.headersSent) return res.end();
      // only messages written for the admin are shown; anything else could name files or internals
      const known = err instanceof PanelError;
      return send(res, known ? err.status : 500, { error: known ? String(err.message).slice(0, 300) : 'The request failed. See the SquadJS log.' });
    });
  };
  // limits against slow or flooding clients
  const limits = { headersTimeout: 10000, requestTimeout: 20000, keepAliveTimeout: 5000, maxHeaderSize: 16384, connectionsCheckingInterval: 5000 };
  const server = tls
    ? https.createServer({ ...limits, ...tls, minVersion: 'TLSv1.2' }, handle)
    : http.createServer(limits, handle);
  server.maxConnections = 200;
  server.maxHeadersCount = 60;

  return { server, broadcast, clients: () => streams.size, secure,
    close() {
      for (const s of streams) s.res.end();
      streams.clear();
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(() => resolve()));
    } };
}
