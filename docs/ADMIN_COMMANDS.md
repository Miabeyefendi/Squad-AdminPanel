# Squad admin commands

A short reference to the admin commands of a Squad server: what each one does, its syntax, the permission it needs in `Admins.cfg`, and whether you can do the same with a button in [Squad Admin Panel](../README.md).

**English** · [Türkçe](./ADMIN_KOMUTLARI_TR.md)

Syntax and access levels follow the [Server Administration](https://squad.fandom.com/wiki/Server_Administration) page of the Squad Wiki. The game changes between updates: type `ListCommands 1` in your console to see the commands of your version.

## How to run admin commands

- **In game:** open the console and type the command. You need the matching permission in `Admins.cfg`.
- **Over RCON:** send the command from an RCON tool. RCON has full rights, so keep its password private.
- **From the browser:** with the panel, press the button listed below. It sends the command for you through SquadJS.

`<Id>` is the player number shown by `ListPlayers`. `<NameOrSteamId>` takes the player name or the SteamID64.

## Kick, ban and warn

| Command | What it does | Permission | In the panel |
|---|---|---|---|
| `AdminKick <NameOrSteamId> <Reason>` | Kicks a player | `kick` | Player card, **Kick** |
| `AdminKickById <Id> <Reason>` | Kicks by player number | `kick` | same |
| `AdminBan <NameOrSteamId> <Length> <Reason>` | Bans a player. Length: `0` permanent, `1d` one day, `1M` one month | `ban` | Player card, **Ban** (1 hour, 1 day, 7 days, 30 days or permanent) |
| `AdminBanById <Id> <Length> <Reason>` | Bans by player number | `ban` | same |
| `AdminWarn <NameOrSteamId> <Reason>` | Shows a warning on the player's screen | `kick` | Player card, **Warn** or **Message** |
| `AdminWarnById <Id> <Reason>` | Warns by player number | `kick` | same |
| `AdminListDisconnectedPlayers` | Lists players who left recently | `kick` | **Players & squads**, Recently left (from the panel's own log, not this command) |

## Squads, teams and commander

| Command | What it does | Permission | In the panel |
|---|---|---|---|
| `AdminForceTeamChange <NameOrSteamId>` | Moves a player to the other team | `forceteamchange` | **Move team** |
| `AdminForceTeamChangeById <Id>` | Moves by player number | `forceteamchange` | same |
| `AdminRemovePlayerFromSquad <Name>` | Removes a player from the squad | `kick` | **Remove from squad** |
| `AdminRemovePlayerFromSquadById <Id>` | Removes by player number | `kick` | same |
| `AdminDisbandSquad <1 or 2> <SquadIndex>` | Disbands a squad of that team | `kick` | squad header, **Disband**, and the locked squad rule; not yet tried on a real server |
| `AdminDemoteCommander <Name>` | Removes the commander | `kick` | Commander's player card, **Demote commander** (sends the `ById` form, not yet tried on a real server) |

## Messages

| Command | What it does | Permission | In the panel |
|---|---|---|---|
| `AdminBroadcast <Message>` | Message to everyone | `chat` | **Send message**, Everyone |
| `ChatToAdmin <Message>` | Admin chat (in game only) | `chat` | admin chat is shown in the live chat |

## Change map and match control

| Command | What it does | Permission | In the panel |
|---|---|---|---|
| `AdminChangeLayer <LayerName>` | Changes the layer right now | `changemap` | **Map**, Change now |
| `AdminSetNextLayer <LayerName>` | Sets the next layer | `changemap` | **Map**, Set as next |
| `AdminEndMatch` | Ends the match | `pause` | **End match** |
| `AdminRestartMatch` | Restarts the match | `pause` | **Restart match** |
| `AdminPauseMatch` / `AdminUnpauseMatch` | Pauses and resumes | `pause` | not in the panel |

A layer name is the map, mode and version together, such as `Narva_RAAS_v1`. On current versions factions can follow it; the panel's map picker builds that line for you.

## Server settings

| Command | What it does | Permission | In the panel |
|---|---|---|---|
| `AdminSetMaxNumPlayers <Number>` | Player limit | `config` | **Server**, Player limits |
| `AdminSetPublicQueueLimit <Number>` | Public queue limit; `-1` is no limit | `config` | **Server**, Player limits |
| `AdminSetServerPassword <Password>` | Sets or, with `""`, removes the server password | `private` | **Server**, Server password |
| `AdminSlomo <Speed>` | Game speed, `1` is normal | `cheat` | not in the panel |

## Useful commands without a permission

| Command | What it shows |
|---|---|
| `ListPlayers` | Players with their numbers and IDs |
| `ListSquads` | Squads with their index numbers |
| `ShowNextMap` | The next map |
| `ListCommands 1` | Every command of your game version |
| `ListPermittedCommands 1` | The commands you may use |

## Admins.cfg: how to add an admin

The file is `SquadGame/ServerConfig/Admins.cfg`. Make a group with its permissions, then add each admin by SteamID64:

```
Group=Admin:changemap,balance,chat,kick,ban,cameraman,pause
Group=Moderator:changemap,chat,kick,ban

Admin=<SteamID64>:Admin
Admin=<SteamID64>:Moderator
```

The panel's own accounts and permissions are separate: they decide what someone may do in the browser, and the panel does not edit `Admins.cfg`.

## Admin camera controls

The admin camera is part of the game and needs the `cameraman` permission. The panel has no camera.

| Key | Action |
|---|---|
| `Shift` + `P` | Camera on or off |
| `W` `A` `S` `D`, mouse | Move and look |
| `Space` / `Ctrl` | Up / down |
| `1`, `2`, `3` with the scroll wheel | Fly speed, field of view, deceleration |
| `5` to `9` | Overlays: FOBs and rallies, capture zones, player outlines, player markers, name tags |

---

**Squad Admin Panel** is a free, open source SquadJS plugin that puts the daily commands above behind buttons, with a live scoreboard, squads and chat, logs and staff permissions. [Install it](./SETUP.md) · [Repository](https://github.com/Miabeyefendi/Squad-AdminPanel)

This is an unofficial page, not affiliated with Offworld Industries.
