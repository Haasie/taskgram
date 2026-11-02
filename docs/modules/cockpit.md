# Cockpit (workspaces and agent sessions)

One screen for what you are building: Postgram features per stage, the workspaces and branches behind each of them,
open risks, and the agent session you can resume. It reads Postgram's workspace and session tracking (`pgm here`,
`pgm scan`) through `GET /api/where`, the same data as `pgm where`.

- **Route:** `#/cockpit`
- **Default:** off · **Folder:** `modules/cockpit/`
- **Requires:** a Postgram with workspace tracking (`GET /api/where`). Without it the module says so instead of
  showing an empty screen.

## What it shows

| | |
| --- | --- |
| Tiles | number of features, and workspaces per risk: uncommitted, unpushed, no upstream, interrupted, missing |
| Sections | one per stage (building · review · functional test · ready to merge · awaiting release), or per action when *Group by action* is on |
| Feature row | title, open pull requests, and per workspace: machine, repo folder, branch, last activity, risks |
| Resume | for a Claude Code session: a copyable `cd '<path>' && claude --resume '<id>'` |
| Without a feature | workspaces Postgram knows that are not linked to a feature |

Status is always a shape plus a word: ● safe, ▲ attention (local work not on the remote), ■ alarm (workspace missing or
session interrupted).

Only what the view needs reaches the browser: transcript paths and other session details stay on the server. Pull
request links are shown only for `https://` URLs.

## Settings (Settings → Modules → Cockpit)

| Setting | Default | Notes |
| --- | --- | --- |
| Group by action | off | On: review, test, merge and release first (`view=actions`) |
| Show released features | off | Passes `include_released=true` |
| Only this machine | empty | Machine alias from `pgm` (`machine=…`); empty = all machines |

The module only reads; stages are set with `pgm feature` or derived by Postgram from pull requests.
