# Tool Drawer · dsh-tool-drawer

[中文](README.md) | **English**

> You installed a pile of plugins; the tool list keeps growing, and every request pays tokens for
> tools this task will never touch. **Tool Drawer** keeps heavy groups collapsed, leaves the ones you
> actually use on the bench, lets stale ones sink on their own — and brings a tool back with one call,
> one keyword, or a guard that catches the call and reopens it.

**Status:** `0.14.x` — used daily on one DSH installation; the config surface may still change.
Issues and PRs are welcome, but maintenance is **best-effort**. If DSH ships native on-demand tool
loading, this project should retire (see *Exit criteria*).

---

## Works out of the box

The defaults are the whole feature set. **No settings page, no config file, nothing to write:**

- Four groups ship ready (desktop·read / desktop·act / browser·heavy / vision·heavy), and they collapse by recent use;
- A collapsed tool **comes back the moment you call it** (a guard catches the call and reopens it) — you never need to know which group it belongs to;
- Saying "screenshot" or "look at that window" opens the matching group on its own;
- To look around: `lazy_tools_status`; to bring everything back: `lazy_tools_enable` or the settings-page button.

Install it, keep working.

## If you want to tune it

Lightest first — all four places are plain text:

| What you want | Where to change it |
|---|---|
| Level / idle days / dock visibility / classification nudge | the settings page, or `~/.dsh/lazy-tools.policy.json` |
| Groups for tools with a shared prefix (`dsh_browser_*` …) | `groups` in the package `cordis.patch.yml`, or config `extraGroups` (**appends**, never replaces the defaults) |
| Tools with no shared prefix (`click`, `type_text` …) | `~/.dsh/lazy-tools.groups.json`; or let the agent run `lazy_tools_classify` then `lazy_tools_save_groups` |
| Read-only inspection | `lazy_tools_status` / `lazy_tools_scan` / `lazy_tools_list` / `lazy_tools_health` |
| `lazy_tools_classify` | Lists unnamed, ungrouped tools with their descriptions so the agent can decide how to group them |
| `lazy_tools_save_groups` | Writes the chosen groups to `~/.dsh/lazy-tools.groups.json`; takes effect next session unless `applyNow: true` |

Match patterns accept `*` globs and `re:` regexes; each group may carry `keep` (never collapse), `expect` (count assertion) and `autoHints` (keywords that open it).

**Three red lines** (this project holds itself to them too): never change the tool table mid-session · recovery tools never go into a group · failures must be reported. Details in [DESIGN.md](DESIGN.md).

---

## How much it saves

**Measured** (2026-10-28, 168 registered tools on one machine):

```
all tool definitions   178,702 chars   # only tools this session can actually see
collapsed (48 tools)    94,792 chars   (53%)
visible  (101 tools)    83,910 chars
not mounted (19 tools)  23,637 chars   # never entered context — not counted as savings
```

> 19 tools here (`cua_driver_native__*`) are never mounted into the session by the host, so they
> never cost a token; they are listed separately instead of being folded into "how much it saves".
> On a machine where every tool mounts, that row is 0 and the figures become
> "collapsed 67 / 118,429 chars / 58%".
> Another 34 **core tools** (`read` / `write` / `pwsh` / `glob` / `web_fetch`, …) come straight from
> the host rather than the tool registry — they are outside this table and are never collapsed.

Convert to tokens with your own provider's tokenizer — only character counts are reported here, because description density differs too much between languages for a fixed ratio to be honest.

Reproduce it anytime with `lazy_tools_bench`; every number in this README comes from that command.

## Why

Every tool schema is tokens in *every* request. A desktop-automation plugin can carry 50+ tools, a
browser plugin 30+, a vision plugin a dozen — hundreds of definitions the model reads on each turn,
even when the task never needs them.

Measured on one machine: **181 tools, 92 hidden by four groups** — roughly **20k tokens per request**
avoided (≈220 tokens/tool, extrapolated from a 140-tool / 31.1k-token sample).

## How it differs from a proxy or an embedding router

| Approach | What it costs |
|---|---|
| MCP proxy (`search_tools` + `execute_tool`) | every real call goes through a generic wrapper — you lose the native schema validation of arguments |
| Embedding router (intent → tool) | ~90 MB encoder, one retrieval per turn, and a mis-route silently hides the tool you needed |
| **This plugin** | one `restrict({deny})` call on the agent's own scope — no process, no extra hop, no model, no third-party package (the only import is the host's own `@deepseek-ai/schemastery`, used to render the settings form, resolved at runtime and optional) |

The trick is simply **gating at the registry-scope layer instead of at the transport or
serialization layer**. If your host exposes a per-agent "hide these global tools" primitive, use it.
Details and trade-offs: [DESIGN.md](DESIGN.md).

## Install

This package is a **bundle** (host half + a `settings.section` client panel). Three ways to install,
pick one — and do not hand-edit `cordis.patch.yml`:

**Straight from GitHub (the command the plugin directory shows):**

```
dsh plugin --profile web add github:kmyy350234-dz/dsh-tool-drawer
```

**Or use the prebuilt tarball attached to the release (no npm account needed):**

```
dsh plugin --profile web add https://github.com/kmyy350234-dz/dsh-tool-drawer/releases/download/v0.14.5/dsh-tool-drawer-0.14.5.tgz
```

**Or clone it anywhere and install with the plugin manager:**

```
plugin_manager install_bundle  target: /absolute/path/to/dsh-tool-drawer
```

That links the checkout into the profile, selects the bundle, and starts the client half. The bundle
patch already ships four groups (desktop-read 19, desktop-input 37, browser-heavy 28, vision-heavy 8)
with `keep` lists and `autoHints`; edit `cordis.patch.yml` in the checkout (or override the row in the
profile patch) to change members.

Config changes apply on reload; **host code changes need a process restart**. The settings page is
drawn by the client half and talks to the host over a loopback route.

## Auto groups

The more plugins you install, the more unmanaged tools appear and keep paying tokens every request.
`autoGroups` recognises tool families by **name prefix** and groups them for you:

The directory listing notes that the shipped groups only cover `cua_driver_native` / `dsh_browser` /
`vision`, and that every other family has to be added by hand. **`autoGroups` closes exactly that
gap**: the remaining families are recognised and grouped for you — drop back to the config only when
you want to change the pattern or add a `keep` list.

| Mode | Behaviour |
|---|---|
| `off` | Do nothing |
| `suggest` (default) | Only report suggestions in `lazy_tools_scan`; change nothing |
| `on` | Create the groups and collapse them by the usual rules |

The rules are fixed in code, not guessed:

- Split on `__` or `_`; **descend only when child families cover ≥80%** of the parent, otherwise keep
  the whole family (`mnemon`'s 17 tools are not split into two groups of 3);
- A prefix needs ≥ `minTools` (default 3) tools;
- Prefixes already ≥80% covered by existing groups are skipped;
- **Core tools are never grouped** (`read`, `write`, `edit`, `pwsh`, `grep`, `glob`, `skill`,
  `todo_write`, `lazy_tools_*` …);
- Computed once at session start and frozen for the session (never breaks the prefix cache);
- Auto groups are prefixed `auto-`, visible in `lazy_tools_status`, and removable with
  `lazy_tools_disable auto-xxx`.

**Built-in tools are out of scope**: `read`, `schedule`, `job` and friends are not in the plugin
registry, so auto grouping never touches them.

Custom match patterns or `keep` lists still go in the config — see the next section.

A manual `cordis.patch.yml` row is still possible (see
[examples/profile-patch.snippet.yml](examples/profile-patch.snippet.yml)) but it gets you only the
host half — no settings page.

## Config reference (per group)

| Field | Meaning |
|---|---|
| `id` | group id, used by every tool call |
| `match` | array of patterns. Plain strings are globs (`*` wildcard, anchored); prefix `re:` for a raw regular expression |
| `keep` | tool names that must never be treated as "stray" — the ones you deliberately leave visible |
| `expect` | expected number of tools in the group; a mismatch shows up as a `warnings[]` entry in `lazy_tools_health` |
| `defaultOn` | `false` = hidden unless enabled (almost always what you want) |
| `autoHints` | optional phrases; when a user message contains one, the group is revealed before the model reads it (substring, case-insensitive). List the variants people actually type — `截图` does **not** match `截个图` |
| `title`, `hint` | free-form labels shown by `lazy_tools_status` |

## Tools

| Tool | What it does |
|---|---|
| `lazy_tools_status` | per group: `on`, `mode` (`hide`/`only`/`all`), `matched`, `visible`, `expect*`, `hot`, `lastUsed` |
| `lazy_tools_enable {group \| groups, only?}` | show a group; `only: ['name']` shows exactly those tools; `groups: [...]` for batches |
| `lazy_tools_disable {group \| groups}` | hide it again (clears any `only` allow-list) |
| `lazy_tools_list {group?}` | tool names in a group, including currently hidden ones |
| `lazy_tools_resolve {name, apply?}` | **one step**: find the owning group and reveal just that tool; meant to be used right after an `unknown tool` error |
| `lazy_tools_mode {level?, idleDays?, reset?, collapse?}` | **this session only**: change the threshold and recompute which groups start open (`reset` → global policy, `collapse` → clear this conversation) |
| `lazy_tools_scan` | every visible tool bucketed by name prefix, to help author new group patterns |
| `lazy_tools_health` | contract self-check, `healthy`, `warnings`, `stray`, `usage`, `autoOpened`, `selfHealed`, recent errors |

`healthy: true` means: four contracts OK **and** no errors **and** no warnings.

## Settings

The settings page is drawn by the client half and talks to the host half over a **loopback route**
(`127.0.0.1`); it never connects to an external address. The plugin directory's capability scan
labels such calls as "connects to servers" — that label refers to this local HTTP call, not to any
upload.

`lib/config.js` exports a `Config` schema, so DSH renders these fields in its own settings page:

| Field | Default | Meaning |
|---|---|---|
| `level` | `medium` | collapse aggressiveness: `low` 14 d / `medium` 7 d / `high` 3 d |
| `presets` | `{14,7,3}` | days per level — change them to your own pace |
| `idleDays` | follows `level` | override the day threshold (`0` = never collapse by time) |
| `minTools` | `3` | don't bother collapsing groups smaller than this |
| `showDock` | `false` | show the level control above the composer |
| `showClear` | `false` | show the independent "clear now" button above the composer |

Both composer toggles are independent; the drawer control is mounted per conversation, so it appears
after switching conversations (or reloading). The panel is bilingual and follows the host locale
service.

Group definitions stay in the bundle patch — written once, rarely touched. The schema is resolved at
runtime by scanning `%USERPROFILE%\.dsh\profiles\*\` for `@deepseek-ai/schemastery` (a package DSH
already ships), using Node built-ins only; if it can't be found, `Config` is `undefined` — **no
settings page, plugin unaffected**. The panel writes `~/.dsh/lazy-tools.policy.json`, which overrides
the YAML defaults; delete that file to fall back.

## Why it *feels* automatic (without a model in the loop)

Most people install a pile of plugins and use each of them rarely — but when the moment comes, the
tool has to be there. Three deterministic mechanisms cover that, and none of them guesses:

0. **Usage ledger + session-start decision** — every real call is recorded in
   `~/.dsh/lazy-tools.usage.json` (timestamps only). When a session starts, a group stays open if it
   was used within `idleDays` or has `defaultOn: true`; everything else starts collapsed. The decision
   happens **once, at the session boundary**, so it never invalidates an active prompt cache.
1. **`autoHints`** — the host emits `agent/inbox/inserted` when a user message arrives; if the text
   contains a configured phrase, the group is revealed *before the model reads the message*. It never
   auto-hides, and every auto-open is counted (`autoOpened`) so you can audit false positives.
2. **`lazy_tools_resolve` / self-heal** — on an `unknown tool` error, `resolve` finds the owning group
   and reveals just that tool; a dispatch guard also tries to reveal it *before* the call is rejected,
   and the model simply retries (`selfHealed` counts both).

No embeddings, no judge model, no proxy: the "intelligence" is just **acting on evidence the host
already gives you** (a message, an error) instead of asking the model to remember.

## What it protects you from

- **Stray tools** — a plugin upgrade adds `vendor__new_tool`; if no group matches it, it silently
  becomes visible and burns tokens. `stray` reports visible tools that look like a group's family but
  are matched by nothing (`keep` excluded).
- **Count drift** — `expect` turns "28 hidden" into a checked assertion.
- **Client half not mounted** — `health.client` records the last report from the browser side (`seen` / `at` / `agoSeconds` / which panels). A healthy host does not imply the settings page mounted: on 2026-10-24 all four host contracts were green while the client entry failed to load and the Web UI dropped into recovery mode. This field turns that class of failure into a readable number instead of something you only discover on restart.
- **Zone races** — a sub-agent disposed mid-flight is recorded as `agent 已销毁` and does **not**
  count as a failure.
- **Reload orphans** — restriction disposers are owned through `ctx.effect`, so a hot reload lifts
  them instead of leaving an orphan that makes `enable` silently succeed.

## Tests

```bash
node test/smoke.mjs   # 32 assertions against a fake host, no DSH required
```

The fake host implements exactly the four contracts this plugin depends on, so a contract change
breaks the test before it breaks your session.

> Changing this plugin? Read [MAINTAINING.md](MAINTAINING.md) first: any client-side change requires a cold boot, and recovery mode leaves the user unable to operate the UI.

## Limitations (please read)

1. **Global tools only.** Tools registered inside an agent scope cannot be hidden — the host rejects it.
2. **Name-based grouping.** DSH's `ToolSchema` has no tags, so groups are globs/regexes over names.
3. **Toggling invalidates the prompt cache.** Enable once and leave it; prefer `only:` when you keep switching.
4. **Auto-collapse only at session start.** It never re-shuffles a running session, because that would
   invalidate the prompt cache mid-task.
5. **Failure mode is fail-open**: if a contract breaks, tools come back and you spend tokens — it will
   not lock you out.
6. **Self-heal only covers tools that exist but are hidden.** A misspelled or not-yet-loaded name
   cannot be repaired; use `lazy_tools_resolve` with a fragment.
7. **UI is bilingual, tool descriptions are not.** The settings panel and the composer row follow the
   host locale service; model-facing tool descriptions are registered once at boot and stay in
   Chinese, because the host process has no view of the UI language.

## Exit criteria

If DSH ever ships native on-demand tool loading (it already carries `deferLoading` and tool-addition
messages), this plugin should retire rather than compete.

## Prior art & acknowledgements

Nothing here is a new idea. These are the projects that shaped it — I read 1–3 closely, 4–7 mostly
from their READMEs. If I've mischaracterised yours, open an issue and I'll fix it.

| Project | Layer | What I took / why I diverged |
|---|---|---|
| [tool-attention](https://github.com/asadani/tool-attention) — [arXiv:2604.21816](https://arxiv.org/abs/2604.21816) | per-turn intent routing over embeddings + two-phase schema loading | established the size of the "tools tax"; I skipped embeddings because a mis-route silently hides a needed tool and the encoder is a large dependency for a token saving |
| [mcp-lazy-load](https://github.com/PeterCha90/mcp-lazy-load) | MCP proxy with `search_tools` / `execute_tool` | shows how far reduction can go; I kept real calls native instead of routing them through a generic executor |
| [dsh-mcp-loader](https://github.com/MikotoMyWife/dsh-mcp-loader) | DSH plugin: per-server loaders + per-agent `restrict` masks | same mechanism layer (it also documents that `restrict` only accepts globally registered names); mine is namespace-agnostic and adds `only:` |
| [lazy-mcp](https://github.com/voicetreelab/lazy-mcp) | proxy layer, tree per server | vocabulary for grouping |
| [opencode-lazy-loading](https://github.com/omarwaly-ai/opencode-lazy-loading) | request-layer stripping | reference for the large-reduction claim |
| [dsh-sieve](https://github.com/Sev7eEn7/dsh-sieve) | DSH context filtering with a judge model | the reason I avoided model-in-the-loop gating |
| [microsoft/agent-framework — progressive disclosure](https://github.com/microsoft/agent-framework/blob/e39a8a2e/python/samples/02-agents/mcp/mcp_progressive_disclosure.py) | on-demand MCP disclosure | terminology reference |

## What this is not

- **Not a proxy, gateway, or MCP client.** It does not touch transport and adds no hop.
- **Not an auto-router.** It never guesses which tool you meant; you ask, explicitly.
- **Not a security boundary.** A hidden tool is only hidden from the model's tool list — nothing here
  sandboxes or denies execution. Use the host's permission system for that.

## License

MIT — see [LICENSE](LICENSE).
