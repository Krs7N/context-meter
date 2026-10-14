# context-meter — a Claude Code mod

See your context window fill up as you work, without typing `/context`. A live band
above the prompt shows an animated fill bar, the token count, headroom before
auto-compaction, the usage trend, session cost and rate limits. It also has a one-click
effort picker and Clawd, who blinks, trots while Claude works and naps when you're idle.

![context-meter above the Claude Code prompt, with the details row and the effort picker open](docs/context-meter.png)

## Install

Requires Claude Code 2.1.296 or later. Type this at the prompt of a terminal session:

```
/plugin install context-meter --marketplace Krs7N/context-meter
```

1. Answer `y` to **Add marketplace?** (`github:Krs7N/context-meter`).
2. Press Enter to keep the **user** scope, so the mod loads in every session.
3. Claude Code prints `Installed context-meter. Plugin is now active.` The band appears above the prompt right away.

**Update** to a newer version with `/plugin update context-meter`. **Remove** the mod with `/plugin uninstall context-meter`.

### Run it from a clone instead

```
git clone https://github.com/Krs7N/context-meter
claude --plugin-dir ./context-meter
```

To load it in every session without a marketplace, add the clone's path to the `env` block in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:/path/to/context-meter" } }
```

On Windows, separate several paths with `;`. On macOS and Linux, use `:`.

## What it shows

| Row | Content | Source |
| --- | --- | --- |
| 1 | `Context` + fill bar + percent + `tokens / window`; effort badge on the right | `$.session.usage().context` (`tokens`, `window`, `percent`); effort: see below |
| 2 | `┊ auto-compact at 167.0k (83.0k left)` (the same `┊` as on the bar); growth of the last turn (`last turn +3.2k`); fill trend `trend ▁▂▃▅▇ 12→42%` (the last 8 readings, scaled to the values shown, then start→current %) | `context.breakdown.autoCompactThreshold`; difference between readings; `history` state |
| 3 | session duration, session cost, rate-limit windows (`5h`, `7d`, `spend`), model | `startedAt`, `cost.usd`, `rateLimits`, `breakdown.model` |
| 4 (optional) | the 5 largest used categories, as `/context` splits them | `breakdown.categories` (kind `used`) — toggled by the **details** button |

- Bar color: Claude orange (`claude` theme key); `warning` from 60 %, `error` from 80 % (`fillColor`).
- The bar fills in eighth-block steps (`▏▎▍▌▋▊▉█`), so it moves smoothly. It is up to 40 cells wide.
- A `┊` mark on the empty part shows where auto-compaction runs.
- When a reading raises the fill, the newly added part is drawn bold blue (`suggestion`) for about 5 s. The percent then shows `▲` (or `▼` after a compaction).
- **Change highlight:** every number that changed since the last reading is drawn bold blue for about 7 s (`HIGHLIGHT_TICKS` × 0.7 s). This covers tokens, tokens left before compaction, last-turn growth, percent, cost and each rate-limit percent. Unchanged numbers stay dim.
- **Count-up:** a changed number does not jump to its new value. It counts there from the old one over 3 s with an ease-out (`TWEEN_STEPS` × `TWEEN_MS`), and the bar grows with it. A newer reading restarts the count.
- Below 72 terminal columns only row 1 is drawn, without frame and mascot.
- Before the first reply of a session (or right after compaction) the token count shows "waiting for the first reply".

## Effort badge

The badge grows louder with the effort level:

| Effort | Drawn as |
| --- | --- |
| `low` | `· low`, dimmed |
| `medium` | `○ medium` |
| `high` | `● high`, bold orange |
| `xhigh` | `◆ xhigh`, bold `warning` |
| `max` | ` ▲ MAX `, filled `error` badge |
| ultracode | ` ✦ ULTRACODE · <LEVEL> `, filled orange badge (beats every level) |
| token budget | `effort 32.0k budget` |

**Click it** to open a picker column around the badge, in the order `low medium high xhigh max ultracode`: lower levels stack above the badge, higher ones and ultracode below it. Click the badge again to close it. The **details**/**hide** toggle sits at the end of row 3, away from the picker. A pick runs `/effort <choice>` exactly as if you typed it (`$.command.run`), so Claude Code's own setting changes. Whether it is saved as the default follows `/effort`'s own rules. If `/effort` reports nothing the mod understands, a toast shows its output.

The level comes from these sources:

- `command.run` on `/effort` (typed, or picked from the badge): the mod reads the output: "Set effort level to …", "Ultracode on/off", "Effort stays …". This is the only source for ultracode.
- `turn.step` on the main thread (no `agentId`): the effort the request actually sends, after any downgrade for the model.
- A `/config` row named `effort…`, when this build has one: a starting value before the first request.
- Saved settings, polled every 1.4 s: `modelSettings[<model>].effortLevel`, else `effortLevel`. This catches Claude Code's own `/effort` panel, which no hook sees. It applies only when the saved value changes.

Ultracode starts off in every session (it is per session). A prompt that only mentions the word "ultracode" does not turn the badge on.

## The mascot (Clawd)

Clawd as the Claude Code welcome banner draws him, in the frame's left corner.

- Idle: blinks for one tick (0.7 s) about every 4.2 s (every 6th tick). Legs stand still.
- While Claude works (`isWorking`): he trots. Legs move in diagonal pairs, half a cell at a time, through a 4-frame cycle (`CLAWD.walk`). Every leg stays in its own column (2, 3, 5, 6) under the body.
- Asleep: after 3 minutes without activity (`SLEEP_AFTER_TICKS`), his eyes close and "zZzZ" grows out from the top-left of his head, in an extra row above him. A prompt, a model request or a new reading wakes him (`markActive`).
- Frames live in the `CLAWD` constant in `hooks/register.tsx`; the timing in
  `TICK_MS` (tick length) and `BLINK_EVERY` (ticks between blinks).

## The timer

All animation (mascot frames, count-up) runs on one `$.clock.every(100 ms)` interval (`startTicker`). Work that a hook starts with `sleep` loops dies when that hook's dispatch ends, because each hook has a time budget and sleeps count against it. An engine interval runs until it is cancelled or the module reloads. `session.start` starts the interval. `session.measure`, `prompt.submit` and `/effort` restart it if it is missing, because a `/clear` fires no new `session.start`. `session.end` stops it, except on a `/clear`.

Every `/effort` writes a line to the debug log (`claude --debug`): `context-meter: /effort <args> → "<output>" (applied: …)`. If `/effort` was given a level and the mod could not read its output, the line also goes to the transcript.

## When it refreshes

| Event | What happens |
| --- | --- |
| `session.start` | first reading; starts the mascot's animation loop |
| `session.measure` | new reading after every main-thread turn and whenever a rate-limit window moves |
| `session.end` | stops the animation loop |
| `turn.step` | stores the main thread's effort level |
| `prompt.submit` | wakes Clawd |
| `command.run` (`effort`) | reads the level and ultracode state back from `/effort`'s output |
| `ui.render` (`AbovePrompt`) | draws the band from the stored state; yields to surveys (`hasSurvey`) |

Each reading calls `$.session.usage({ breakdown: 'summary' })`. A `summary`
breakdown is estimated locally — no token-count API calls, no cost. (`'full'`
would count with the API, as `/context` does.)

## Files

| File | Purpose |
| --- | --- |
| `.claude-plugin/plugin.json` | manifest (name, version, description, `types`) |
| `hooks/hooks.json` | points to the hooks module |
| `hooks/register.tsx` | all logic: refresh, animation, rendering, formatting helpers |
| `types/index.d.ts` | state contract: `snap`, `history`, `frame`, `showDetails` under `context-meter` |
| `tests/meter.test.ts` | formatting, band contents and redraw, narrow layout, blink timing |
| `README.md` | this document |

## Common edits

- **Change the colors** — the `fill` thresholds and `color="claude"` props in the `ui.render` hook. Any theme key works (`success`, `warning`, `error`, `subtle`, `permission`, …).
- **Bar width** — `const width = Math.max(10, Math.min(32, …))` in the render hook.
- **Narrow-mode cut-off** — `const isCompact = columns < 72`.
- **Trend length** — `HISTORY_LEN`.
- **Add a metric** — add a field to `Snapshot` in `types/index.d.ts`, fill it in `toSnapshot`, print it in `line2` / `line3`.
- **More categories in details** — `.slice(0, 5)` in `toSnapshot`.

## Working on it

Run from the folder that holds the clone:

```
claude plugin validate context-meter
claude plugin test context-meter
```

Type-check: once Claude Code has loaded the mod (`claude --plugin-dir ./context-meter`), `.claude-plugin/types/` holds the engine's types (gitignored) and `npx -p typescript tsc -p context-meter` works.

Releasing: bump `version` in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, add a `CHANGELOG.md` entry, then commit and push. Installed copies pick it up with `/plugin update context-meter`.
