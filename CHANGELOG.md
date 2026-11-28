# Changelog

All notable changes to **Squad-AdminPanel** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[README](./README.md) · [Tutorial](./docs/SETUP.md)

---

## [1.2.0] - 2026-11-28

Checked with automated tests and real SquadJS against an emulated game, not on a live match.

### Added

- Kill Feed page: every hit, down and kill with attacker, victim, weapon and damage; numbers per player (hits per down, one hit downs, top hit, most downs within 60 seconds, weapons), this match and the last one, CSV export.
- Quick actions: message the admins, remind squad leaders without the kit and players without a squad, restart the match, open the Kill Feed.

### Changed

- Quick actions are one row on the overview; End match is red.
- A teamkill reads "(squad) Name tk (squad) Name" with team colours, wherever it appears.
- Rules and Server show a list on the left and the chosen settings on the right. Server moved under Access.
- Larger map cards in at most five columns and a wider choice panel.
- Smart Shuffle has a slim status bar and larger presets.
- Records and Logs filters fit in one row.

## [1.1.0] - 2026-11-28

Not yet tried on a real game server; the demote, disband and offline ban actions need one with players.

### Added

- Panel languages: English, Turkish, German, Russian and Chinese, picked with a flag at the top right.
- Server page: player limit, public queue limit, server password, automatic announcements and one way Discord notices (off by default).
- "Recently left" list on Players and squads.
- Demote commander and disband squad buttons, with new permissions.

### Security

- The Discord webhook address is stored encrypted, only discord.com addresses are accepted, and no message can ping anyone except one role chosen for admin calls.
- The server password is never stored or logged. It is refused when SquadJS would print RCON commands.
- A ban's private note is kept in its own log field and is never sent to Discord.

## [1.0.0] - 2026-11-27

First release. Not yet tested on a live match with players.

### Added

- Web panel that runs as a SquadJS plugin: overview, scoreboard, players and squads with live chat, map control.
- Warn, kick, ban, move team, remove from squad, and messages to one player, a team, the admins or everyone.
- Smart Shuffle built in, with 11 presets and every setting.
- Server owner, admin, senior mod and junior mod ranks with per account permissions.
- Player records, logs by period with CSV export, deletion with preview and retention limits.
- Automatic rules: teamkills, players without a squad, squad leader without the SL kit, small locked squads, chat filter, name filter.
- Manager for other SquadJS plugins and their settings.
- Own flag drawings and map patterns, with optional own pictures from the data folder: scenery for the running match (`art/screens`), maps from above (`art/maps`) and flags (`art/factions`).
- First sign in with `admin` / `admin`, from the server itself only, with a warning until the password is changed.

### Security

- Salted scrypt password hashes, brute force protection, AES-256-GCM encrypted data, strict Content-Security-Policy, cross-site and host name checks, no-index headers.

[1.2.0]: https://github.com/Miabeyefendi/Squad-AdminPanel/releases/tag/v1.2.0
[1.1.0]: https://github.com/Miabeyefendi/Squad-AdminPanel/releases/tag/v1.1.0
[1.0.0]: https://github.com/Miabeyefendi/Squad-AdminPanel/releases/tag/v1.0.0
