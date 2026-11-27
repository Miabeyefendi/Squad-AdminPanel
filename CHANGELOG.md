# Changelog

All notable changes to **Squad-AdminPanel** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[README](./README.md) · [Tutorial](./docs/SETUP.md)

---

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

[1.0.0]: https://github.com/Miabeyefendi/Squad-AdminPanel/releases/tag/v1.0.0
