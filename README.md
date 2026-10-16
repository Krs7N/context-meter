# context-meter — a Claude Code mod

See your context window fill up as you work, without typing `/context`. A live band
above the prompt shows an animated fill bar, the token count, headroom before
auto-compaction and about how many turns it lasts, the usage trend, the session's length
and cost, how much the prompt cache served and when it has gone cold, and the rate limits
with when each resets, or when the recent pace runs one out first. It also has one-click
model and effort pickers, a compact button once the context runs high, and Clawd, who types
while Claude works, dresses up for the effort level, gets cross as the context fills up and
naps when you're idle.

![context-meter above the Claude Code prompt: Clawd in his xhigh glasses beside the fill bar at 51 %, the auto-compact headroom, this turn's growth and the trend, then the session's length, cost and rate limits](docs/context-meter.png)

## Install

Requires Claude Code 2.1.295 or later. Claude Code Desktop runs its own bundled Claude Code (2.1.295 as of 2026-10-15), whatever version the terminal has. Type this at the prompt of a terminal session:

```
/plugin install context-meter --marketplace Krs7N/context-meter
```

1. Answer `y` to **Add marketplace?** (`github:Krs7N/context-meter`).
2. Press Enter to keep the **user** scope, so the mod loads in every session.
3. Claude Code prints `Installed context-meter. Plugin is now active.` The band appears above the prompt right away.

**Update** to a newer version with `/plugin update context-meter`, then `/reload-plugins` (or restart Claude Code): a session that is already open keeps drawing the old version until then. **Remove** the mod with `/plugin uninstall context-meter`.

### Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `sleepAfterMinutes` ("Clawd naps after (minutes)") | `5` | Minutes without activity before Clawd falls asleep. `0` keeps him awake. |
| `showClawd` ("Show Clawd") | on | Off: no mascot, and the stats take his 15 cells. |
| `reduceMotion` ("Reduce motion") | off | On: numbers land at once instead of counting up, and Clawd neither types, blinks nor shakes (his zZ stops growing). His face and colour still follow the bar. The fast timer never runs. |
| `layout` ("Layout") | `auto` | `auto`: the full band where it fits, else one line. `one-line`: always the one-line meter. |
| `showCost` ("Show the session's cost") | on | The `$` figure in row 3. |
| `showRateLimits` ("Show rate limits") | on | The `5h`, `7d` and `spend` windows in row 3, with their resets and pace. |
| `showCompactButton` ("Show the compact button") | on | The **compact** button once the bar turns amber or red. |
| `warnAt` ("Bar turns amber at …") | `75` | How far toward auto-compact, in percent, the bar turns amber and Clawd gets annoyed. With no auto-compact point known, the way to 80 % of the window. |
| `alertAt` ("Bar turns red at …") | `95` | The same for red, Clawd fuming. Below `warnAt`, both keep their defaults. |
| `cacheLifetime` ("Prompt-cache lifetime") | `auto` | `auto`: learned from your requests ([Cold cache](#cold-cache)). `5m` or `1h`: always that. |
| `models` ("Models in the model picker") | `haiku, sonnet, opus, fable` | The picker's entries as `/model` takes them, separated by commas or spaces, smallest first: a family, `opus[1m]` (1M window), `best`, `opusplan` or a model id. |

Change them in `/config`, where each is a row of its own, or from a shell:

```
echo '{"sleepAfterMinutes":10,"showCost":false}' | claude plugin configure context-meter@context-meter --values-stdin
```

A change reloads the mod with the new values. A value out of range keeps its default.

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
| 1 | `Context` + fill bar + percent + `tokens / window`; model badge and effort badge on the right | `$.session.usage().context` (`tokens`, `window`, `percent`); model and effort: see below |
| 2 | in this order, each only when it applies: `! 150.0k over the 200.0k window: next send compacts` (or `: /compact before sending` with auto-compaction off), in red; `cache cold: next send re-writes 162.0k` in amber (see [Cold cache](#cold-cache)); `window 1.00M → 200.0k` for about 10 s after a model switch; `┊ auto-compact at 167.0k (83.0k left, ~6 turns)` (the same `┊` as on the bar), or with auto-compaction off `window full in ~6 turns`; the turn: `this turn +12.0k` while Claude works, `compacted 182.0k → 31.0k` after a compaction (`shrank 182.0k → 31.0k` when the fill fell with no compaction seen), else `last turn +3.2k`; fill trend `trend ▁▂▃▅▇ 12→42%` | `context.breakdown`; each main-thread request's usage; the turn ends; `trend` and `cache` state |
| 3 | session duration, session cost, how much of the last request the cache served, rate-limit windows (`5h`, `7d`, `spend`), each with a countdown to its reset, then the **compact** button once the bar warns: `session 1h 3m · $4.20 · cache 97% · 5h 72% full in ~48m, resets 2h 14m · 7d 41% resets 3d 4h · compact` | `startedAt` and the clock, `cost.usd`, the main request's usage, `rateLimits` (`percentUsed`, `resetsAt`) and the `pace` state |
| 4 (optional) | the 5 largest used categories, as `/context` splits them | `breakdown.categories` (kind `used`) — toggled by the **details** button |

- Bar color: Claude orange (`claude` theme key), then `warning` and `error` as the fill nears the auto-compact point (from three quarters of the way, and from 95 %; the `warnAt` and `alertAt` settings). With no auto-compact point known, the way to 80 % of the window: `warning` from 60 %, `error` from 76 % (`fillColor`). Clawd changes with it (see [The mascot](#the-mascot-clawd)).
- The bar fills in eighth-block steps (`▏▎▍▌▋▊▉█`), so it moves smoothly. It is up to 40 cells wide.
- A `┊` mark on the empty part shows where auto-compaction runs.
- The meter moves with each model request of a running turn, not only when the turn ends.
- When a reading raises the fill, the newly added part is drawn bold green (`success`) for about 10 s. The percent then shows a green `▲`, or a red `▼` (`error`) when it drops.
- **Change highlight:** every number that changed since the last reading is drawn bold for about 10 s (`HIGHLIGHT_TICKS` × 0.7 s): green where it went up, red where it went down (`moveOf`). This covers tokens, tokens left before compaction, percent, cost, each rate-limit percent and the `window … → …` note. A turn's growth (`this turn`, `last turn`) goes by its sign: `+` green, `−` red. Unchanged numbers stay dim. A new window (a model switch) is no growth: no `▲`, no count-up, just the `window …` note.
- **Colour-blind readers:** pick **Dark mode (colorblind-friendly)** or **Light mode (colorblind-friendly)** in `/theme`. Claude Code draws `success` in blue there and keeps `error` red, and the band's up and down colours are those two theme keys, so every rise turns blue. Clawd's moods change his face as well as his colour.
- **Arrows** take the same colours, not bold: the trend's ends (`12→42%` green when the fill rose over the trend, red when it fell) and the compaction note (`compacted 182.0k → 31.0k`, red).
- **Count-up:** a changed number does not jump to its new value. It counts there from the old one over 6 s with an ease-out (`TWEEN_STEPS` × `TWEEN_MS`), or over 1 s for a reading in the middle of a turn (`LIVE_STRIDE`), and the bar grows with it. A newer reading restarts the count.
- **Trend:** the tokens at the last 8 turn ends, scaled to the values shown, then first→last as percents of the window shown now, so a switch to a smaller window draws no spike.
- **Over the window:** the engine caps the percent at 100, so a context bigger than the window (after a switch to a smaller model) shows as red tokens and the warning at the start of row 2.
- Below 72 columns, when the badges leave too little room beside Clawd for the bar, the percent and the tokens, or when the full band (an open picker included) is taller than the room above the prompt (`maxRows`, a short fullscreen terminal), only row 1 and the two badges are drawn, without frame and mascot. Where even an open picker column is taller than that room, its choices are drawn in a row instead of the meter until it closes.
- Nothing is cut mid-figure. Where a row lacks room it leaves out whole pieces:
  - the meter row drops the word `tokens`, then `Context`, then the window, then the token count, and the bar shrinks last;
  - row 2 shortens `┊ auto-compact at 167.0k (83.0k left, ~6 turns)` to `┊ 83.0k left, ~6 turns` and the cold-cache warning to `cache cold`, then leaves out the trend, then the turn's growth;
  - row 3 first drops each window's reset countdown (the `7d` one first) and keeps its percent and any `full in` warning, then leaves out the cache's share, then the session's length, then the rate limits, the cost last. The **compact** and **details** buttons always keep their room.
- The session clock and the reset countdowns run between readings. A window whose reset time is unknown or already past shows its percent alone.
- Before the first reply of a session (or right after `/clear`) the token count shows "waiting for the first reply". Right after a compaction it shows what the compaction left, `~31.0k / 200.0k tokens`, until the next reply.
- `/clear` and `/resume` start the meter over: no growth or trend is measured against the conversation before.
- **A fill that falls without a compaction seen:** when a reading is more than a fifth below the one before (`SHRINK`) and no compaction was recorded, row 2 shows `shrank 182.0k → 31.0k` instead of a negative turn, and the next turn counts from there. This covers organisation-managed installs, where Claude Code does not run a plugin's `session.compact` hooks, and rewinds.
- In Claude Code Desktop Clawd is drawn as one picture (`clawdSvg`), so he looks as he does in the terminal; the badges and picker options are Desktop's own buttons. The band's text is set in the monospaced face where Desktop's engine supports it (2.1.299 or later, read with `$.session.version()`). An older engine refuses the whole band over that setting, so there, or while the version is unknown, the text uses Desktop's page font.
- Until the first reading, the band is one line: `Context waiting for the first reply`, or, where reading the usage fails, `reading failed on desktop: <why>` in `warning`. The reason also goes to the debug log (`claude --debug`).

## Looking ahead

### Turns to compact

`┊ auto-compact at 167.0k (83.0k left, ~6 turns)`: the tokens left before auto-compaction over the average growth of the last 5 turns that grew (a compaction's drop is not a turn's growth), rounded up (`turnsLeft`). With auto-compaction off it counts toward a full window instead: `window full in ~6 turns`. Nothing shows before two turns have grown, or from 100 turns on.

### Rate-limit pace

Each rate-limit window keeps its readings of the last half hour, about one a minute (`withReadings`, the `pace` state); a new window (another reset time) or a drop starts them over. Once they span 10 minutes and rose a point, and while the newest is under 10 minutes old, a window that the recent pace would use up before it resets says when: `5h 72% full in ~48m, resets 2h 14m`, the warning in red (`fullIn`).

### Cold cache

- `cache 97%` in row 3: how much of the last main-thread request the prompt cache served (`cache_read` over all its input). The first request of a conversation reads nearly nothing.
- Idle past the cache's lifetime, row 2 opens with `cache cold: next send re-writes 162.0k` in amber: the next send writes the whole context to the cache again, at the cache-write rate. Not while Claude works.
- The plugin API does not give the cache's lifetime, so the requests show it (`ttlFrom`). A request sent more than 5 minutes after the last reply, on the same model and effort, that still read most of its input from the cache means it lives an hour. One that had to write most of it again means 5 minutes. A compaction, another model or effort, or `/clear` starts a new cache, which tells nothing. What was learned is kept in the mod's store (`cacheTtl`) for later sessions. Until a request has shown it, the warning assumes an hour, so it never says "cold" too early.
- No `$` estimate: token prices are not in the plugin API, and subscription plans do not pay per token.
- If Claude Code renews the cache in the background, the cache can stay warm longer than the warning assumes.

### Compact button

Once the bar turns amber or red (or the context is over the window), and while Claude is not working, row 3 ends `· compact · details`. A press asks `compact now? yes · no`; **yes** compacts the conversation as `/compact` does without instructions (`$.session.compact()`), shows `compacting…`, then `compacted 182.0k → 31.0k` in row 2. If Claude Code skips the compaction, a toast says why. A prompt moves on from an unanswered confirm. For a compaction with instructions, type `/compact <what to keep>`.

## Model badge

Left of the effort badge: `◇ Opus 5.5 ▾`, the main loop's model as `/model` shows it (`$.session.model()`, read at start, after every `/model` and every 1.4 s, so a change made anywhere shows up). A 1M-context variant reads `◇ Opus 5.5 · 1M`.

When the model changes, the meter reads the new window, auto-compact point and saved effort at once, without waiting for the next turn.

**Click it** to open a picker column around the badge, in the order `haiku sonnet opus fable` (`MODEL_CHOICES`): smaller models stack above the badge, larger ones below. A pick runs `/model <alias>` exactly as if you typed it, so Claude Code's own model changes, and whether it is saved as your default follows `/model`'s own rules. Only one picker is open at a time: opening one closes the other.

When Claude Code keeps the model (`/model` answers "Kept model as …"), the mod shows a toast: `Claude Code kept Opus 5.5: /model sonnet did not switch`. Typing the command answers the same, so the toast suggests nothing. Plugins may not submit slash commands themselves.

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
| none (a model that takes no effort) | `– no effort`, dimmed |

**Click it** to open a picker column around the badge, in the order `low medium high xhigh max ultracode`: lower levels stack above the badge, higher ones below it, and the ultracode switch comes last. Click the badge again to close it. The **details**/**hide** toggle sits at the end of row 3, away from the picker. A pick runs `/effort <choice>` exactly as if you typed it (`$.command.run`), so Claude Code's own setting changes. Whether it is saved as the default follows `/effort`'s own rules. If `/effort` refuses, caps or overrides the pick (ultracode unavailable, an organization's cap, `CLAUDE_CODE_EFFORT_LEVEL`), the badge shows what is in force and a toast quotes why. If it prints nothing the mod can read, the badge shows what was picked. Ultracode rides on top of a level: picking a level while it is on changes the level and keeps ultracode on, as `/effort` itself does (badge `✦ ULTRACODE · XHIGH`). Only the last option, `✦ ultracode off` (`/effort ultracode off`), turns it off.

The level comes from these sources:

- `command.run` on `/effort` (picked from the badge, or typed where the hook sees it): the mod reads the output: "Set effort level to …", "Ultracode on/off", "Effort stays …".
- `prompt.submit` of a typed `/effort <level>`, `/effort ultracode [on|off]`: read from the arguments. `max` and ultracode are session-only and saved nowhere else the mod could read.
- `turn.step` on the main thread (no `agentId`): the effort every request actually sends, after any downgrade for the model. A request with none means the model takes no effort (`– no effort`). Subagents' requests are ignored.
- A `/config` row named `effort…`, when this build has one: a starting value, read only until a request or a pick names the level.
- Saved settings, polled every 1.4 s and after a model switch: `modelSettings[<model>].effortLevel` (the key matched by id or by the name `/model` shows), else `effortLevel`. This catches Claude Code's own `/effort` panel, which no hook sees. It applies only when the saved value changes.

Ultracode starts off in every session (it is per session). A prompt that only mentions the word "ultracode" does not turn the badge on.

## The mascot (Clawd)

Clawd as the Claude Code welcome banner draws him, in the frame's left corner, sitting behind a keyboard: two rows of keycaps on a dark gray case (a key, the spacebar and a key on top; six keys below; `CLAWD.keyboard`).

- Idle: blinks for one tick (0.7 s) about every 4.2 s (every 6th tick). Shut eyes are thin dark lines (`CLAWD.shutEye`), so he never looks eyeless.
- While Claude works (`isWorking`): he types. One arm reaches down at a time (`CLAWD.typing`) and a key under that hand lights up blue, a different one each frame (`litKey`, from `CLAWD.keysLeft` / `CLAWD.keysRight`).
- He dresses for the effort level (`outfitFor`, `clawdRows`):

  | Effort | Outfit |
  | --- | --- |
  | low | none |
  | medium | a blue cap, facing front |
  | high | the cap plus a bottle in a holder strapped to each side, straws running into his face |
  | xhigh | cap, bottles and straws, plus glasses with round white rims around his eyes |
  | max, ultracode | a tall purple magician's hat with a gold band, and nothing else |

  He is 13 cells wide in every outfit, so the stats beside him never move.
- He feels the context fill up. His mood follows the bar's colour (`fillColor`, read by `moodFor`), so the two always change together, count-up included:

  | Bar | Mood | Clawd |
  | --- | --- | --- |
  | orange | calm | as above |
  | `warning` | annoyed | ember body (`#e5603f`) and flat eyes (`▂`, a `-_-` look; behind the glasses a line through the middle of each lens, `━`, where the open eye sits); he still blinks and types as usual |
  | `error` | fuming | red body (`#e5383b`) and eyes squeezed shut (`>` `<`), so he does not blink; awake, he shakes a cell left and right each frame (his hat, cap and bottles with him, the keyboard stays), and the key he hits flashes amber (`warning`) |

  The body colours are raw, so he looks the same in every theme (`MOOD_BODY`, `MOOD_EYES`). His outfit, width and height never change with the mood. In Claude Code Desktop the picture's alt text names it (`Clawd, fuming, typing`).
- Asleep: after 5 minutes without activity (the `sleepAfterMinutes` setting; `0` keeps him awake), he leaves the keyboard (his legs show again in its place), his eyes close (inside the glasses too) and "zZzZ" grows out from the top-left of his head, in an extra row above him and any hat. He keeps his outfit and his mood's colour while asleep, but rests: no squeezed eyes, no shaking. A prompt, a model request or a new reading wakes him (`markActive`).
- Frames live in the `CLAWD` constant in `hooks/register.tsx`; the timing in
  `TICK_MS` (tick length) and `BLINK_EVERY` (ticks between blinks).

## The timer

All animation runs on two `$.clock.every` intervals. The ticker (`startTicker`) ticks every 0.7 s (`TICK_MS`): Clawd's frames, the highlight's fade and, every second tick, the polls. The counter (`startCounter`) ticks every 100 ms (`TWEEN_MS`) only while a changed number counts up, and stops once it lands, so an idle band makes about 86 dispatches a minute. Work that a hook starts with `sleep` loops dies when that hook's dispatch ends, because each hook has a time budget and sleeps count against it. An engine interval runs until it is cancelled or the module reloads. `session.start` starts the ticker and lands any count-up a reload interrupted. `session.measure`, `prompt.submit` and `/effort` restart it if it is missing, because a `/clear` fires no new `session.start`. `session.end` stops it, except on `/clear` and `/resume`, which keep it and start the meter over 0.3 s later. It runs only while a terminal or Claude Code Desktop draws the band.

Every `/effort` writes a line to the debug log (`claude --debug`): `context-meter: /effort <args> → "<output>" (applied: …)`. If `/effort` was given a level and the mod could not read its output, the line also goes to the transcript.

## When it refreshes

| Event | What happens |
| --- | --- |
| `session.start` | reads the engine's version (whether Text takes `mono`); first reading; starts the mascot's animation loop where a terminal draws the band (the REPL); `-p` and SDK runs, which draw nothing, run none of the band's work |
| `session.attach` / `session.detach` | Claude Code Desktop joining starts the band's work with a fresh reading; the last drawing client leaving stops it |
| `turn.complete` | the end of a main-thread turn: a reading with breakdown, the turn's growth and a trend point |
| `session.measure` | a plain reading, after each turn and whenever a rate-limit window moves (mid-turn too) |
| `turn.step` | each main-thread request: its effort level, then a live reading from the response's own usage, and the cache's share and lifetime |
| `session.compact` | a main-conversation compaction: records what it freed and redraws (the compact button records its own) |
| `session.end` | `/clear` and `/resume`: start the meter over; anything else: stops the animation loop |
| `prompt.submit` | wakes Clawd; reads a typed `/effort …` |
| `command.run` (`effort`) | reads the level and ultracode state back from `/effort`'s output |
| `command.run` (`model`) | reads the model back (`$.session.model()`) once `/model` ran; a new model gets a full reading |
| `ui.render` (`AbovePrompt`) | draws the band from the stored state; yields to surveys (`hasSurvey`) |

Turn ends, model switches and compactions call `$.session.usage({ breakdown: 'summary' })`.
A `summary` breakdown is estimated locally — no token-count API calls, no cost. (`'full'`
would count with the API, as `/context` does.) Live readings and cost-only measures read
the plain figures, which cost nothing.

## Files

| File | Purpose |
| --- | --- |
| `.claude-plugin/plugin.json` | manifest (name, version, description, `types`) |
| `hooks/hooks.json` | points to the hooks module |
| `hooks/register.tsx` | all logic: refresh, animation, rendering, formatting helpers |
| `types/index.d.ts` | state contract under `context-meter`: `snap`, `trend`, `frame`, `effort`, `model`, the pickers' open flags, `pace`, `cache`, `cacheTtl`, `compactStep`, … |
| `tests/meter.test.ts` | formatting, band contents and redraw, layouts, model switches, live readings, `/clear`, `/resume`, `/compact`, blink timing |
| `README.md` | this document |

## Common edits

- **Change the colors** — the thresholds in `fillColor` and the `color="claude"` props in the `ui.render` hook. Any theme key works (`success`, `warning`, `error`, `subtle`, `permission`, …).
- **Bar width** — `const width = Math.max(10, Math.min(40, …))` in the render hook.
- **One-line cut-off** — `isCompact` in the render hook (`planMeter` decides what the meter row keeps, `fitGroups` what rows 2 and 3 keep).
- **Trend length** — `TREND_LEN` (shown), `TREND_KEEP` (stored).
- **Add a metric** — add a field to `Snapshot` in `types/index.d.ts`, fill it in `toSnapshot`, print it in `line2` / `line3`.
- **More categories in details** — `.slice(0, 5)` in `toSnapshot`.

## Working on it

Run from the folder that holds the clone:

```
claude plugin validate context-meter
claude plugin test context-meter
```

Type-check: once Claude Code has loaded the mod (`claude --plugin-dir ./context-meter`), `.claude-plugin/types/` holds the engine's types (gitignored) and `npx -y -p typescript@5.6.3 tsc -p context-meter` works.

Releasing: bump `version` in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, add a `CHANGELOG.md` entry, commit to `main` and push, then publish the GitHub release (`gh release create vX.Y.Z --target main`, which creates the tag). Installed copies pick it up with `/plugin update context-meter`, then `/reload-plugins`.
