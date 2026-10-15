# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

context-meter is a Claude Code **mod**: a hooks-module plugin (no build step, no package.json) that draws a live band above the prompt with the context window's fill bar, tokens, auto-compact headroom, trend, cost and rate limits, plus a model picker, an effort picker and Clawd the mascot. The repo is also its own marketplace (`/plugin install context-meter --marketplace Krs7N/context-meter`). It runs on Claude Code 2.1.295+ (Claude Code Desktop's bundled engine) and was last worked on 2.1.300. The plugin API is early access and changes between releases.

## Commands

Run these from the folder that **contains** the repo (the commands take the mod's folder name):

```
claude plugin validate context-meter     # manifest, hooks module and $.state contract; warnings only is a pass
claude plugin test context-meter         # every tests/*.test.ts, in the engine's own test kit (~10 s)
claude --plugin-dir ./context-meter      # run it in a real session; hot-reloads on save
```

- There is no test filter and no `test.only`. To run one test, copy `.claude-plugin/`, `hooks/`, `types/` and a test file holding just that test into a scratch folder and run `claude plugin test` on that folder.
- Type-check: once Claude Code has loaded the mod from this folder, `.claude-plugin/types/` holds the engine's types (gitignored) and `npx -y -p typescript@5.6.3 tsc -p context-meter` works (`tsconfig.json` extends it). `claude plugin test` does not write that folder. Without it, use a tsconfig kept outside the repo whose `include` names the plugin-authoring skill's `types/claude-code.d.ts` plus this repo's `hooks`, `types` and `tests`, with the compilerOptions from that d.ts's header (`jsx: react`, `jsxFactory: h`, `jsxFragmentFactory: Fragment`, `strict`, `noUncheckedIndexedAccess`, `lib es2023`, no DOM).
- `--plugin-dir` silently replaces an installed plugin of the same name (`claude plugin list` still shows the installed one). If the band is missing, `claude --debug=hooks` logs `hooks module context-meter … loaded` or `not loaded: <reason>`.

## Architecture

All logic is in `hooks/register.tsx` (`hooks/hooks.json` points at it). It exports `register(on)`, which adds hooks; there are no other modules.

- **State.** Everything the band draws from lives in `$.state` atoms (`snap`, `effort`, `model`, `trend`, `frame`, `tweenStep`, the pickers' flags, …). Every atom must be declared in `types/index.d.ts` under `PluginState['context-meter']`, or `validate` fails. `$.state` survives hot reloads; module variables (`ticker`, `subtick`, `countStep`, `lastSaved`) start over on each reload.
- **Readings.** `refresh($, { breakdown, isTurnEnd, isFresh, stepTokens })` reads `$.session.usage()` and stores `toSnapshot(usage, now, previous, tick, isTurnEnd)`. There are three kinds of reading:
  - **fresh:** there is no previous snapshot (first start, `/clear`, `/resume`). Nothing is highlighted, and `turnBase` is set to the current tokens.
  - **live:** taken after each main-loop request (`turn.step`), with tokens from that response's usage. It never sets `lastDelta` and never adds a trend point.
  - **turn end:** a main-loop `turn.complete`. It computes `lastDelta = tokens − turnBase`, moves `turnBase`, adds a trend point, and only then reads the breakdown. Never take turn ends from `session.measure`: the engine raises one right after each `turn.complete`, but also mid-turn whenever a rate-limit window moves a whole point, and then `changed` names the context too.

  `changedKeys` / `fromValues` drive the change highlight (`changed`, `changedTick`, about 10 s) and the 6 s count-up (`from`, `tweenStep`). A window change (a model switch) is its own key (`window`), never `percent`.
- **Hooks.**
  - `session.start`: first reading, starts the ticker, and lands any count-up that a reload interrupted.
  - `turn.complete` (main loop): the turn end.
  - `session.measure`: a plain reading, with no breakdown.
  - `turn.step`: the effort the request carried, then a live reading.
  - `session.compact`: records before and after, then redraws.
  - `session.end`: `/clear` and `/resume` call `startOver` 300 ms later, because no `session.start` follows them; any other reason stops the ticker.
  - `prompt.submit`: reads a typed `/effort …`.
  - `command.run`: reads back what `/effort` and `/model` set.
  - `ui.render` `{ component: 'AbovePrompt' }`: the band.
- **Only where it is drawn.** `isDrawn` says whether a terminal or Desktop draws the band. `session.start` sets it from `e.surface`, `session.attach`/`session.detach` keep it up to date, and a render while it is false sets it. Without one, the ticker, its polls and the readings do not run (`claude -p`, the SDK, VS Code).
- **One timer.** Every animation (count-up, Clawd's frames, blink, sleep) and the 1.4 s polls (saved effort, `$.session.model()`) run on a single `$.clock.every(100)` ticker (`startTicker`/`onTick`). A hook's own `sleep` loops die with its dispatch budget, so don't add them.
- **Render.** The band redraws when an atom it read changes; `frame` changes every 0.7 s, so the band redraws at least that often. It picks the one-line layout below 72 columns, when the stats column is too narrow for the bar, the percent and the tokens, or when the full band (an open picker included) is taller than `props.maxRows`. Otherwise it draws the full layout: Clawd (`clawdRows`, 13 cells wide in every outfit) beside three stats rows. Elements come from `$.ui.resolve(e)`, never globals.
- **Room.** Only where a row lacks room does it leave out pieces, whole, never cutting a figure:
  - the meter row (`planMeter`) drops the word `tokens`, then `Context`, then the window;
  - rows 2 and 3 (`fitGroups`, by rank) take the short forms first (the auto-compact point becomes `┊ 83.0k left`; each rate limit loses its `resets 2h 14m`, the `7d` one first), then drop the session's length or the trend first.

  With room, everything shows. The user confirmed this after first taking it for a permanent removal, so don't revert it to clipping.

## Engine rules that bite

- A render hook never writes state. Write from handlers (`onPress`) or other events, using `update($, atom, fn)`. `update` may run `fn` more than once.
- Hooks on the request path (`turn.step`, and `tool.call` if one is ever added) must not await anything before `yield* next(e)` / `next(e)`.
- Gating hooks (`command.run`, `session.compact`) carry `.catch(($, e, next) => next(e))` so a failure in the mod never blocks the command.
- `AbovePrompt` is raised on the **terminal** (Ink) and **desktop** (Claude Code Desktop, drawn over the wire with its own element table) surfaces only, never on mobile, VS Code, `claude -p` or cloud sessions. `e.surface` says which one is drawing.
- **Desktop differs from the terminal.**
  - Desktop draws `Text` as a span in its page font unless the Text has `mono`, so the render hook wraps `Text` to add `mono` off the terminal, but only where the engine takes it (`hasMono`, set in `session.start` from `$.session.version()` by `takesMono`: 2.1.299 on). An older engine refuses the whole tree (`Text prop "mono" is not allowed`) and draws no band; an unknown version counts as older.
  - Desktop runs its own bundled engine, not the terminal's (2.1.295 on 2026-10-15): `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\<version>\<hash>\claude.exe`. Run that binary's `plugin test context-meter` to check the mod against it. There, the tests that fake a 2.1.300 engine fail by design (its Text refuses `mono`); every other test must pass.
  - Clawd is drawn as one `Svg` (`clawdSvg`, built from the same `clawdRows` cells). Block glyphs leave gaps between lines in a page.
  - An Svg is isolated from the theme, so colours are hex: Claude Code's dark theme (`SVG_DARK`), switched to its light theme (`SVG_LIGHT`) on a light page through `prefers-color-scheme`.
  - Clawd must match Claude Code's welcome banner: what a glyph leaves empty (his open eyes in `▛`/`▜`) shows the background on both surfaces. So his eyes are white on a light theme, as the banner's are; don't fill them.
  - `Button`s are native buttons there even with `plain`.
  - Keep the terminal tree unchanged when changing the Desktop drawing; the tests pin both.
  - To look at the Svg, dump `clawdSvg(...).source` from a scratch test and screenshot it with headless Chromium.
- The plugin API reference is the plugin-authoring skill's `types/claude-code.d.ts` (about 17k lines; grep it for the event or noun) and its `reference.md`.

## Tests

`tests/meter.test.ts` drives the real module through the engine's test kit (`claude-code/testing`). Each test answers the events the mod calls (`on('session.usage', …)`); an unanswered event throws at the bottom, `config.list` and `settings.read` included, and the mod is written to tolerate that. The test kit validates a tree under each surface's rules, but never paints it.

Helpers in the test file:
- `usage` / `usageIn` / `breakdownOf` build readings.
- `band($, columns, isWorking, maxRows)` mounts the band.
- `answer` / `request` run a main-loop `turn.step`.
- `turnEnds` ends a turn as the engine does: `turn.complete`, then `session.measure`. A test that uses it answers both events.

`mock.clock(on, { now })` plus `clock.advance(ms)` drives the ticker. Because the band redraws only on 0.7 s frames, a time-based assertion must allow for the frame phase, and a blink check must span a whole 6-frame period.

## Releases and docs

- The version lives in **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. The user names each version bump, so don't bump it unasked.
- `CHANGELOG.md` collects changes under `## Unreleased` until a release. The README screenshot is `docs/context-meter.png`, which the user supplies.
- Release steps: bump both manifests, move the changelog section under the version, commit on `main` and push, then `gh release create vX.Y.Z --target main --title vX.Y.Z`, which creates the tag. Notes: `Everything since **<previous version>**.`, then the changelog section under `### X.Y.Z — <date>`. No workflow publishes releases: a push alone only updates the marketplace copy that `/plugin update` reads.
- Design history: `docs/superpowers/specs/` (the audit, its engine facts and the decision guide for what comes next), `docs/superpowers/plans/` and `docs/superpowers/audits/` (the open low and trivial findings).

## Working with the user

- Replies: terse.
- Branches: none. Work and commit on `main`.
- Visuals: one tweak at a time, so they can judge each change.
- Pushing: the repo is public, so ask before pushing.
