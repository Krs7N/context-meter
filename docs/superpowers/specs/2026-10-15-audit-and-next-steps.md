# context-meter: audit of 0.3.0, the bug-fix design, and what comes next

Written 2026-10-15, on Claude Code 2.1.299. This is the spec for the bug batch and the guide for the decision after it. The step-by-step work is in [the implementation plan](../plans/2026-10-15-audit-bug-fixes.md).

## 1. Where things stand

- **Released:** v0.3.0 (tag `v0.3.0`) on `main`. This batch does **not** bump the version: the user names the version when the batch is released.
- **Branch:** `fix/audit-bugs` holds the batch: the failing tests, this spec, the plan and `handoff.md`.
- **Agreed order:** fix every bug in section 4 first. Then the user decides between some of the upgrades and the subagent panel (section 9).
- **Stage:** TDD red. `tests/meter.test.ts` has 35 tests: 15 pass (all behaviour that already worked) and 20 fail, each on an assertion about the bug it targets. No production code has changed yet.

## 2. How the meter gets its numbers (engine facts, 2.1.299)

These facts come from the plugin API's declaration file, the one the plugin-authoring skill writes. They explain most of the bugs.

- **`session.measure` fires rarely.** Its doc: "Fires when the engine measures the session and a unit moved: after each main-thread turn, and when a rate-limit window moves a whole point." It does not fire per model request, on `/model`, on `/compact` or on `/clear`. The meter only re-read its numbers there and in `session.start`.
- **`$.session.usage()`** answers `{ startedAt, context, rateLimits, cost }`. `context.tokens` is the last API response's input side (uncached + cache read + cache write). `context.window` is the session model's window. `context.percent` is "0 to 100": capped, so a context bigger than the window reads 100. `tokens` and `percent` are absent "until the first response of the live window: a fresh session, or one just compacted".
- **The breakdown** (`usage({ breakdown: 'summary' })`) adds `autoCompactThreshold`, `isAutoCompactEnabled`, `rawMaxTokens` (may be smaller than the window), `model` ("as /model shows it") and the categories. A plain `usage()` is free; `summary` estimates locally.
- **`turn.step`** is one model request. Its input has `model`, `effort` ("absent for a model without effort") and `agentId` (absent on the main loop). After `yield* next(e)`, the result has `usage` (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`, `model`), or `null` when no response arrived.
- **`session.end`** reasons: `clear`, `resume`, `logout`, `prompt_input_exit`, `other`. After `clear`, "the process goes on under a new session id, and no `session.start` fires for it".
- **`session.compact`** fires for `/compact` (`manual`), the threshold (`auto`), a plugin, and `precompute`. `agentId` is set for a subagent's own compaction. The result carries `tokensBefore` and `tokensAfter` when core recorded them, or `skip`.
- **`AbovePrompt` props:** `maxRows` ("in fullscreen, what the bottom slot has left above the prompt; otherwise the terminal's height", the slot "capped at half the terminal's rows, the prompt's included"), `bodyColumns`, `isWorking`, `hasSurvey`, `scroll`, and `view.agentId` (which agent's transcript is on screen).
- **Timers:** `$.clock.every` and `$.clock.after` run until cancelled or until the module reloads. A reload runs `register` and `session.start` again; `$.state` survives, module variables do not.
- **Test kit:** a test's `$.session.compact` takes the raw event input `{ trigger, messages }`, and a compaction must keep at least one message. `$.turn.step(input)` is a stream: read it to its end, then `await stream.result`. Events a test does not answer throw at the bottom (`config.list` and `settings.read` included).

## 3. The user's example: switching from a 1M model to a 200K one

What 0.3.0 does:

1. The badge updates within 1.4 s (the model poll), but the meter keeps the 1M window, bar, `┊` mark and headroom until the next turn ends. `refreshModel` only updates the model name.
2. When the context is bigger than the new window, the engine caps `percent` at 100. The meter shows `100%` and `0 left`, with no warning. With auto-compact off, the next send fails without warning.
3. The percent counts up from the old value with a ▲ highlight. It reads as "this turn used 59%"; the real cause is the smaller window.
4. The trend stores percents of whatever window was current, so it shows a fake spike (`trend ▁▁▁▁█ 14→90%`).
5. On a model without effort, `turn.step` carries no `effort`, the hook skips it, and the old badge and outfit stay.
6. The saved-effort lookup uses the breakdown's model name, stale after a switch and possibly in display form (`Opus 5.5`) while `modelSettings` keys by id (`claude-opus-5-5`).
7. The picker cannot change the window within one model. This one is **left out** of the batch (section 5).

## 4. Bugs and their fixes

Locations are in `hooks/register.tsx` as of v0.3.0. Every fix has a failing test named in the plan.

| # | Severity | Bug | Cause | Fix |
|---|---|---|---|---|
| 1 | High | Meter stale after `/model` (window, mark, headroom) | `refreshModel` (`:485`) only sets the name | On a change of `modelLabel`, a full refresh with breakdown, then `pollSavedEffort` |
| 2 | High | Meter frozen during a turn | `session.measure` only after a turn | A live reading after each main-loop request (`turn.step`), from that request's usage |
| 3 | High | `/clear` and `/resume` keep the old numbers, then diff against them (`last turn −125.0k`, ▼, trend across conversations); `/resume` also stops the ticker (`:742`) | No `session.start` after them; `toSnapshot` diffs against the old snapshot | Keep the ticker; 300 ms later start over: empty trend, a reading with no previous snapshot; retry from the ticker while there is none |
| 4 | High | Manual `/compact` leaves the old fill | Not a turn, so no measure | A `session.compact` hook: record before/after, refresh, show `~after` until the next reply |
| 5 | Medium | No warning when the context is bigger than the window | Engine caps `percent` | Row 2 starts with `! 150.0k over the 200.0k window: next send compacts` (or `/compact before sending` when auto-compact is off); compact layout colours tokens `error` |
| 6 | Medium | Window change animates like growth | `changedKeys` treats it as a percent change | Window change is its own event: no ▲, no count-up, chip `window 1.00M → 200.0k` |
| 7 | Medium | Trend fakes a spike after a window change | History stores percents | Store tokens (`trend`), compute percents against the current window |
| 8 | Medium | Stale effort badge on a model without effort | `turn.step` hook skips undefined effort (`:695`) | Take the level from every main-loop request; undefined means `isUnsupported`, badge `– no effort` |
| 9 | Medium | `maxRows` ignored; tall band scrolls and cuts Clawd in a short fullscreen slot | Layout chosen by width only (`:773`) | Compact layout also when the full layout is taller than `maxRows` |
| 10 | Low | Saved effort read for the wrong model | Lookup by stale `snap.model` (`:397`) and by exact key only | Use the polled model; match `modelSettings` keys by `modelLabel` too |
| 11 | Low | `Opus 4.20250514`; `[1m]` dropped | Version regex (`:473`) | Version right after the family, minor of 1–2 digits; ` · 1M` suffix |
| 12 | Low | A reload during the 6 s count-up freezes numbers mid-count | `countStep` resets, the `tweenStep` atom does not | `session.start` ends any count-up |
| 13 | Low | Session clock frozen between readings; `76h 12m` | Uses the reading's time (`:955`); no days | Render reads `$.clock.now()`; `1d 2h` from 24 h |
| 14 | Low | Bar colour ignores a smaller compaction point | Thresholds are % of window (`:209`) | Colour by distance to `compactAt` when known |
| 15 | Low | Wasted work: `$.config.list()` and a breakdown on every measure; state round trips before every request | `:688`, `:694` | Breakdown only at a turn end; config only while the level is unknown; request-path work not awaited before sending |
| 16 | Low | `/model` toast advises typing a command that also fails | `:505` | `Claude Code kept <label>: /model <alias> did not switch` |
| 17 | Trivial | Comment says the highlight lasts about 5 s | `:779` | About 10 s |

### Data model changes (`types/index.d.ts`)

- `Snapshot` gains:
  - `turnBase?: number`: tokens at the last turn end, or at a fresh reading. "This turn" counts from it.
  - `windowFrom?: number`: the window before the last window change, for the chip.
  - `isAutoCompact?: boolean`: from the breakdown.
  - `compaction?: { before?: number; after?: number }`: the last main-conversation compaction, kept until a turn end computes a real `lastDelta`.
- `Snapshot.lastDelta` now means the growth of the last completed turn (it meant "since the previous reading").
- `Effort` gains `isUnsupported?: boolean`: the model takes no effort.
- The `history` atom (percents) is replaced by `trend` (tokens at each turn end, last 16).

### Reading rules (`toSnapshot`)

- A reading with no previous snapshot is fresh: no highlights, `turnBase` = its tokens.
- A reading without a breakdown, in an unchanged window, keeps `compactAt`, `isAutoCompact`, `model` and `categories` from the previous snapshot.
- A window change: `changed` holds `window` (plus `tokens`/`headroom` if tokens moved), never `percent`; `windowFrom` = the old window.
- A turn end (`session.measure` with `context` in `changed`) with tokens: `lastDelta = tokens − turnBase` when `turnBase` is known (then `compaction` is cleared), else undefined; then `turnBase = tokens`. Only then the `delta` highlight.
- Live readings (after a main-loop request) are not turn ends; they never set `lastDelta` or push the trend.
- The trend is pushed at fresh readings and turn ends when the tokens differ from its last entry.

### Row 2 (full layout), in order

1. Over the window: `! 150.0k over the 200.0k window: next send compacts` (or `: /compact before sending`), in `error`. The auto-compact segment is left out then.
2. While the window change is fresh: `window 1.00M → 200.0k`, highlighted.
3. `┊ auto-compact at 167.0k (83.0k left)`, as now.
4. One of: `compacted 182.0k → 31.0k` (while `compaction` is set); `this turn +36.0k` (while working and `turnBase` is known); `last turn ±X`.
5. `trend ▁▃▅█ 70→90%`.

`Seg` gains `color?: string` for the warning. After a compaction, while tokens are unknown, the meter row draws the bar at `after / window` and the tokens as `~31.0k / 200.0k tokens`.

## 5. Left out on purpose

- **Marking a typed `/effort` as unconfirmed.** A typed `/effort` is applied as soon as it is submitted, because the `command.run` hook never saw typed `/effort` in a live session. A refused level is corrected at the next request; ultracode never is. A marker would show `?` on every typed `/effort` until the next request. A visual call for the user.
- **Slower frames in deep sleep.** It would also slow Clawd's typing during long tool runs. The 0.7 s redraw stays.
- **1M variants in the model picker** (`opus[1m]`). Not confirmed that this build accepts the alias. Belongs with upgrade 2.

## 6. Assumptions to check by eye

The tests cannot prove these; check them in a real session (section 8) and use the fallback if one fails.

| Assumption | How to check | Fallback |
|---|---|---|
| A render hook may call `$.clock.now()` | Session clock advances; no `ui.render … refused` line | Keep a `clock` value in `$.state`, written by the ticker every 10 s |
| A `$.clock.after` timer set in `session.end` fires after `/clear`, and `$.session.usage()` then reads the new conversation | Run `/clear`: the meter empties within a second | Start over on the first `prompt.submit` after a clear |
| A request's usage equals the engine's `context.tokens` | `--debug`: log both at a turn end | The turn-end measure already overwrites the live value |
| An in-process `/resume` raises `session.end` with `resume` | Run `/resume`: numbers switch, Clawd keeps animating | Treat any `session.end` the process survives the same way |
| `$.state` after `/clear` is kept or reset | Either way the band must show the new conversation | Covered by the start-over design |
| `$.session.model()` names the 1M variant (`[1m]` or "1M context") | Badge reads `Opus 5.5 · 1M` on a 1M model | Harmless if it never does |

## 7. The open `/model` bug (outside the batch)

- `/model sonnet`, typed or run by the picker, answers "Kept model as `Opus 5.5`". The user saw it again on 2026-10-15.
- `~/.claude/settings.json` has `"model": "opus"` (line 2) and `"switchModelsOnFlag": false` (line 84). `switchModelsOnFlag` is not in the public settings schema, so its meaning is unknown.
- Tests not yet run: `/model sonnet` in a fresh session (almost no context); then the same after removing `switchModelsOnFlag` and restarting. Changing settings is the user's call.
- The batch only fixes the misleading toast (bug 16).

## 8. How to verify

From `K:\repos` (or wherever the repo's parent is):

```
claude plugin validate context-meter
claude plugin test context-meter
npx -y -p typescript@5.6.3 tsc -p context-meter
```

- `tsc -p` needs `.claude-plugin/types/`, which the engine writes the first time it loads the mod from the repo (`claude --plugin-dir .`). Until then, type-check with a tsconfig kept outside the repo: the compilerOptions from the header of the plugin-authoring skill's `types/claude-code.d.ts` (`target`/`lib` `es2023`, `types []`, `module esnext`, `moduleResolution bundler`, `strict`, `noUncheckedIndexedAccess`, `noEmit`, `skipLibCheck`, `jsx react`, `jsxFactory h`, `jsxFragmentFactory Fragment`) and `include` = that d.ts plus the repo's `hooks`, `types` and `tests`.
- **By eye**, in a real terminal:
  1. Delete the old hot-reload copy (`~/.claude/dev-mods/450e8183-…/context-meter`), and disable or uninstall the installed `context-meter@context-meter`, so only one meter draws.
  2. `cd` into the repo and run `claude --plugin-dir .`.
  3. Check: the meter moves during a long turn; `/model` to a smaller window; `/compact`; `/clear`; `/resume`; a short terminal in fullscreen; outfits and pickers look as before.

## 9. After the batch: deciding what comes next

### Option A: upgrades

Each builds on data this batch adds. Sizes are rough.

| # | Upgrade | What the user gets | Size | Notes |
|---|---|---|---|---|
| 1 | Turns-to-compact forecast | `≈ 6 turns to auto-compact`, from the recent turns' growth | Small | Needs the token trend from this batch |
| 2 | Window and fit in the model picker | `◇ Sonnet 5.5 · 200k · needs compact` before switching | Medium | Learn each model's window in `$.store`; answers the 1M-variant question |
| 3 | Cache-cold warning | After idling past the prompt-cache lifetime: `next send re-caches 412k`; cache-hit % per request | Small–medium | The cache lifetime is not in the API; make it an option |
| 4 | Compaction count | Number of compactions this session, beside the chip this batch adds | Small | |
| 5 | Rate-limit reset countdown | `5h 72% · resets 1h20m`; one notification each at 80% and 95% | Small | `resetsAt` is already stored |
| 6 | Settings in `/config` (`userConfig`) | Animation off, hide Clawd, sleep timeout, colour thresholds | Medium | Touches many places |
| 7 | `/context` grid pane | `details` opens a pane drawing the breakdown's grid as one `Raster` | Medium | Docked only in fullscreen |
| 8 | Session summary toast | On `/clear` or exit: time, cost, peak %, compactions | Small | |

### Option B: the subagent panel

**Feasible on 2.1.299.** Every piece of data per agent is reachable:

- `agent.spawn`: id, description, type, model, background flag, parent agent.
- `$.agent.list()`: status (`pending`, `running`, `waiting`, `idle`, `completed`, `failed`, `killed`) and parent id for nesting; poll it on the existing ticker.
- `turn.step` with `agentId`: model and effort; after each request, its usage gives that agent's context fill.
- `tool.call` with `agentId`: what it is doing (`Grep "atom("`, `Read register.tsx`).
- `turn.complete` and `session.compact` with `agentId`: done, aborted, compacted.
- `props.view.agentId` on the band and on panes: which agent's transcript the person has open.

**Gaps:**
- No window size per agent: use the main window if it is the same model, else a window learned for that model id (upgrade 2), else 200k shown with `~`.
- Workflow agents and the engine's own forks (compaction, memory) carry ids `$.agent.list()` does not list: filter them out.
- A teammate in its own terminal pane runs no loop here: status only.

**Screen space:** a real side panel exists only in the fullscreen layout, from 110 columns (144 when the mod opens it unasked). Outside fullscreen a pane sits above the prompt, stacked on the band. In fullscreen the band is capped at half the terminal's rows.

**Layouts:**

A. In the band; the meter shrinks to one row while agents run. Works in every mode:
```
╭──────────────────────────────────────────────────────────────────────────────╮
│ ▐▛███▜▌ Context ██████████▌░░░░░░░░┊░ 41% 412k/1.00M  ◇ Opus 5.5 ▾  ● high ▾ │
│ ▐▛█▜▌ Explore · haiku   ▓▓▓▓▓░░░ 34%  68k/200k   Grep "atom("          1m12s │
│ ▐▛█▜▌ Plan · opus       ▓░░░░░░░ 12% 120k/1.00M  Read register.tsx       40s │
│ ▐▛█▜▌ review · sonnet   ▓▓▓▓▓▓▓░ 88% 176k/200k   ! compacts soon       3m05s │
╰──────────────────────────────────────────────────────────────────────────────╯
```

B. A side column inside the band. About 150+ columns, no extra height:
```
╭────────────────────────────────────────────────────────────────────────────────────────────╮
│    ▄▄▄     Context ███████▌░░░░┊░ 41% 412k/1.00M  ◇ Opus 5.5 ▾ │  ▐▛███▜▌  Explore · haiku │
│  ▟█████▙   ┊ compact at 835k (423k left) · +18.2k   ● high ▾   │ ▗▜█████▛▘ ▓▓▓▓░ 34% Grep  │
│  ▐▛███▜▌   session 1h02m · $3.12 · 5h 41% · details            │  ▐▛███▜▌  Plan · opus     │
│ ▝▜█████▛▘                                                      │ ▝▜█████▛▖ ▓░░░░ 12% Read  │
│ ▀ ▀▀▀▀▀ ▀                                                      │ +1 more · ✓ 1 done        │
╰────────────────────────────────────────────────────────────────────────────────────────────╯
```

C. A docked `Agents` pane. Fullscreen only, 110+ columns:
```
● Reading hooks/register.tsx …          ╭─ Agents 3 ────────────────────╮
                                        │  ▐▛███▜▌  Explore · haiku     │
  transcript as today                   │ ▗▜█████▛▘ ▓▓▓▓▓░░░ 34% 68k    │
                                        │           Grep "atom(" 1m12s  │
                                        │  ▐▛███▜▌  Plan · opus · xhigh │
                                        │ ▝▜█████▛▖ ▓░░░░░░░ 12% 120k   │
                                        │           Read register.tsx   │
╭ meter band as today ╮                 │ ✓ review · done in 3m05s      │
> prompt                                ╰───────────────────────────────╯
```

D. The band follows the open transcript: when the person opens an agent from the tasks list, the band shows that agent's meter and Clawd. No extra space.

**Clawd per agent:** the banner Clawd without the keyboard (2 rows × 9 cells), each agent in its own colour, with an outfit for its own effort. Arms typing while it responds or runs tools, eyes shut while thinking, zZ while waiting, ✓ when done, ✗ in red when failed. Layout A shows only his head `▐▛█▜▌`.

**Risks:** `turn.step` and `tool.call` run before every request and tool call, so these hooks must never wait on anything before passing them on. Five agents in parallel would write state constantly: collect updates and write them once per ticker tick. `tool.call` can block calls, so that hook must always pass the call on.

**Phases:** (1) an agent registry in `$.state` fed by the hooks above; (2) layout A with the meter shrinking; (3) layout D; (4) layout B for wide terminals; (5) layout C for fullscreen. Phases 1–3 are roughly 300–400 lines plus tests.

### How to decide

Questions for the user:
1. How often do you run subagents or workflows? Often means the panel pays off sooner.
2. Do you use the fullscreen layout, and how wide and tall is your terminal usually? That decides whether layouts B and C are worth building.
3. What hurts more today: surprise compactions and cost (upgrades 1–3), or not seeing what agents do (the panel)?
4. Release the bug batch first, with a new screenshot, or keep going on the branch?

Recommendation: release the bug batch first (the user names the version). Then a short batch of upgrades 1, 4 and 5, which are small and use this batch's data, plus 2 if model switching matters. Then the subagent panel, layouts A and D first. If subagents are an everyday tool, swap the last two.

### Release steps (when the user names the version)

1. Bump `version` in `.claude-plugin/plugin.json` **and** `.claude-plugin/marketplace.json`.
2. Add a `CHANGELOG.md` section and update the README.
3. Commit (end the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), merge to `main`, push. Ask before pushing: the repo is public.
4. `git tag vX.Y.Z && git push origin vX.Y.Z`
5. `gh release create vX.Y.Z --notes-file <that changelog section>`

Users update with `/plugin update context-meter`.
