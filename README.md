# dsh-lazy-tools

**On-demand tool groups for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**
Hide heavy tool sets from every request; bring them back with one call when you actually need them.

> 鎶娿€屽緢閲嶄絾骞虫椂涓嶇敤銆嶇殑宸ュ叿缁勪粠涓婁笅鏂囬噷鏀惰捣鏉ワ紝闇€瑕佹椂涓€鏉″懡浠ゅ紑鍥炴潵銆?> 闆惰繍琛屾椂渚濊禆銆侀浂浠ｇ悊杩涚▼銆佺湡瀹炶皟鐢ㄤ繚鎸佸師鐢熴€?
**Status:** `0.4.0` 鈥?running daily on one DSH installation; the config surface may still change.
Issues and PRs are welcome, but maintenance is **best-effort**: if you need something guaranteed,
fork it. If DSH ships native on-demand tool loading, this project should retire (see [DESIGN.md](DESIGN.md)).

---

## Why

Every tool schema is tokens in *every* request. A desktop-automation plugin can carry 50+ tools,
a browser plugin 30+, a vision plugin a dozen 鈥?hundreds of tool definitions that the model reads
on each turn even when the task never needs them.

Measured on one machine: **197 tools 鈫?95 visible**, 102 hidden, 鈮?**22k tokens per request** saved
(鈮?20 tokens/tool, extrapolated from a 140-tool / 31.1k-token sample).

## How it differs from a proxy or an embedding router

| Approach | What it costs |
|---|---|
| MCP proxy (`search_tools` + `execute_tool`) | every real call goes through a generic wrapper 鈥?you lose the native schema validation of arguments |
| Embedding router (intent 鈫?tool) | ~90 MB encoder, one retrieval per turn, and a mis-route silently hides the tool you needed |
| **This plugin** | one `restrict({deny})` call on the agent's own scope 鈥?no process, no extra hop, no model, no dependency |

The trick is simply **gating at the registry-scope layer instead of at the transport or
serialization layer**. If your host exposes a per-agent "hide these global tools" primitive, use it.
Details + trade-offs: [DESIGN.md](DESIGN.md).

## Install

DeepSeek Harness loads plugins from its profile's `cordis.patch.yml`. Add one row:

```yaml
- insert:
    - id: lazy-tools
      name: file:///absolute/path/to/dsh-lazy-tools/lib/index.js
      config:
        groups:
          - id: browser-heavy
            match: ['re:^dsh_browser_(?!open$|content$|a11y$|click$|type$|wait$)']
            keep: [dsh_browser_open, dsh_browser_content, dsh_browser_a11y, dsh_browser_click, dsh_browser_type, dsh_browser_wait]
            title: 娴忚鍣烽噸
            defaultOn: false
            expect: 28
          - id: desktop
            match: ['cua_driver_native__*']
            title: 妗岄潰鑷姩鍖?            defaultOn: false
```

A fuller example lives in [examples/profile-patch.snippet.yml](examples/profile-patch.snippet.yml).
Config changes apply on reload; **code changes need a process restart**.

## Config reference (per group)

| Field | Meaning |
|---|---|
| `id` | group id, used by every tool call |
| `match` | array of patterns. Plain strings are globs (`*` wildcard, anchored). Prefix with `re:` for a raw regular expression. |
| `keep` | tool names that must never be treated as "stray" 鈥?the ones you deliberately leave visible |
| `expect` | expected number of tools in the group. A mismatch shows up as a `warnings[]` entry in `lazy_tools_health` |
| `defaultOn` | `false` = hidden unless enabled (default behaviour you almost certainly want) |
| `title`, `hint` | free-form labels shown by `lazy_tools_status` |

## Tools

| Tool | What it does |
|---|---|
| `lazy_tools_status` | per group: `on`, `mode` (`hide` / `only` / `all`), `matched`, `visible`, `expect*` |
| `lazy_tools_enable {group \| groups, only?}` | show a group; `only: ['name']` shows exactly those tools and keeps the rest hidden; `groups: [...]` for batches |
| `lazy_tools_disable {group \| groups}` | hide it again (also clears any `only` allow-list) |
| `lazy_tools_list {group?}` | tool names in a group 鈥?including currently hidden ones, flagged by `visible` |
| `lazy_tools_resolve {name, apply?}` | **one step**: find the group that owns a tool (exact name or fragment) and reveal just that one. Meant to be called right after an `unknown tool` error |
| `lazy_tools_scan` | every visible tool bucketed by name prefix, to help you write new group patterns |
| `lazy_tools_health` | contract self-check (`register` / `schemas` / `restrict` / `agent/created`), `healthy`, `warnings`, `stray`, `usage`, recent errors |

`healthy: true` means: four contracts OK **and** no errors **and** no warnings.

## What it protects you from

- **Stray tools** 鈥?a plugin upgrade adds `vendor__new_tool`; if no group matches it, it silently
  becomes visible again and quietly burns tokens. `stray` derives each group's name-family prefix
  and reports visible tools that look like family members but are matched by nothing (`keep` excluded).
- **Count drift** 鈥?`expect` turns "28 hidden" into a checked assertion.
- **Zone races** 鈥?a sub-agent can be disposed while a `tools/change` handler is mid-flight; that
  restriction failure is recorded as `agent 宸查攢姣乣 and does **not** count as a failure.
- **Reload orphans** 鈥?restriction disposers are owned through `ctx.effect`, so a hot reload lifts
  them instead of leaving an orphan that makes `enable` silently succeed while nothing comes back.

## Tests

```bash
node test/smoke.mjs   # 22 assertions against a fake host, no DSH required
```

The fake host implements exactly the four contracts this plugin depends on, so a contract change
breaks the test before it breaks your session.

## Limitations (please read)

1. **Global tools only.** Tools registered inside an agent scope (some plugin families do this)
   cannot be hidden 鈥?the host rejects it.
2. **Name-based grouping.** DSH's `ToolSchema` has no tags, so groups are globs/regexes over names.
3. **Toggling invalidates the prompt cache.** Enable once and leave it; prefer `only:` over
   whole-group enables when you keep switching.
4. **No TTL / auto-hide.** `usage` only records counts and timestamps so *you* can decide later.
5. **Failure mode is fail-open**: if a contract breaks, tools come back and you spend tokens 鈥?it
   will not lock you out.

## Exit criteria

If DSH ever ships native on-demand tool loading (it already carries `deferLoading` and
tool-addition messages), this plugin should retire rather than compete.

## Prior art & acknowledgements

Nothing here is a new idea. These are the projects and papers that shaped it 鈥?I read 1鈥? closely,
4鈥? mostly from their READMEs. If I've mischaracterised yours, open an issue and I'll fix it.

| Project | Layer it works at | What I took / why I diverged |
|---|---|---|
| [tool-attention](https://github.com/asadani/tool-attention) 鈥?[arXiv:2604.21816](https://arxiv.org/abs/2604.21816) | per-turn intent routing over embeddings + two-phase schema loading | established the size of the "tools tax"; I skipped embeddings because a mis-route silently hides a tool you needed, and the encoder is a large dependency for a token saving |
| [mcp-lazy-load](https://github.com/PeterCha90/mcp-lazy-load) | MCP proxy exposing `search_tools` / `execute_tool` | shows how far reduction can go; I kept real calls native rather than routing them through a generic executor |
| [dsh-mcp-loader](https://github.com/MikotoMyWife/dsh-mcp-loader) | DSH plugin: per-server loaders + per-agent `restrict` masks | same mechanism layer as this repo (it also documents that `restrict` only accepts globally registered names); mine is namespace-agnostic and adds `only:` |
| [lazy-mcp](https://github.com/voicetreelab/lazy-mcp) | proxy layer, tree per server | vocabulary for grouping servers/tools |
| [opencode-lazy-loading](https://github.com/omarwaly-ai/opencode-lazy-loading) | request-layer stripping | reference for the large-reduction claim |
| [dsh-sieve](https://github.com/Sev7eEn7/dsh-sieve) | DSH context filtering with a judge model | the reason I avoided model-in-the-loop gating |
| [microsoft/agent-framework 鈥?progressive disclosure sample](https://github.com/microsoft/agent-framework/blob/e39a8a2e/python/samples/02-agents/mcp/mcp_progressive_disclosure.py) | on-demand MCP tool disclosure | terminology reference |

## What this is not

- **Not a proxy, gateway, or MCP client.** It does not touch transport and adds no hop.
- **Not an auto-router.** It never guesses which tool you meant; you ask, explicitly.
- **Not a security boundary.** A hidden tool is only hidden from the model's tool list 鈥?nothing here
  sandboxes or denies execution. Use the host's permission system for that.

## License

MIT 鈥?see [LICENSE](LICENSE).

