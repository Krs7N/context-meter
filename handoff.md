# Handoff

## Goal

Keep developing **context-meter**, a Claude Code mod (hooks-module plugin) that draws a live context-window band above the prompt: fill bar, tokens, auto-compact headroom, trend, cost, rate limits, a model picker, an effort picker, and Clawd the mascot (outfits per effort, typing on a keyboard, sleeping).

- Repo: https://github.com/Krs7N/context-meter (public). The repo is its own marketplace: `/plugin install context-meter --marketplace Krs7N/context-meter`. Needs Claude Code 2.1.296 or later. 0.3.1 was developed and tested on 2.1.300; 2.1.296's binary has every hook 0.3.1 uses (checked by searching its strings, not by running it). The `mono` prop that Desktop's drawing uses may be newer: 2.1.300's docs name it, 2.1.296's don't.
- **Current stage:** **0.3.1 is on `main`** (2026-10-15): `fix/audit-bugs` fast-forwarded into it. The tag `v0.3.1` and the GitHub Release come from GitHub's release form, published by the user: the cloud session's git proxy refused the tag push (HTTP 403), and no tool there creates a release. It shipped **without the check by eye**: Desktop's drawing has been seen only as screenshots of the Svg in headless Chromium. Next: the user's check by eye in a real terminal and in Desktop, a new README screenshot, the open questions in Next Steps, then the choice between some of the upgrades and the subagent panel.
- **Background documents** (their line references are as of v0.3.0, now stale):
  - `docs/superpowers/specs/2026-10-15-audit-and-next-steps.md`: the audit, the engine facts behind it, each bug with its fix, what is left out and why, assumptions to check by eye (section 6), the open `/model` bug (section 7), how to verify (section 8), and the guide for deciding what comes after the batch (section 9).
  - `docs/superpowers/plans/2026-10-15-audit-bug-fixes.md`: the ordered tasks (0–7) as planned.
  - `docs/superpowers/audits/2026-10-15-open-findings.md`: the 39 low and trivial findings the audit follow-up left open, unverified.

## Current State

- **`main`:** v0.3.1. The tag `v0.3.1` exists once the release form is published; check https://github.com/Krs7N/context-meter/releases. Its history is linear: 0.3.1's commits sit on it one per task, as on the branch.
- **Branch `fix/audit-bugs`:** merged into `main` (same commit). Start the next batch on a new branch from `main`.
- **Tests:** `claude plugin test context-meter` gives **55 pass, 0 fail**. `claude plugin validate context-meter` passes with the one old warning (no marketplace description). `tsc` 5.6.3 is clean.
- **Type-check without `.claude-plugin/types/`:** a tsconfig kept outside the repo, `include` = the plugin-authoring skill's `types/claude-code.d.ts` plus the repo's `hooks`, `types`, `tests` (compilerOptions from that file's header), then `npx -y -p typescript@5.6.3 tsc -p <that tsconfig>`.
- **Installed copy:** `context-meter@context-meter` 0.3.0 at user scope on the user's PC, until they run `/plugin update context-meter` and then `/reload-plugins` or a restart. `--plugin-dir .` **replaces** a same-named installed plugin (2.1.300 logs `from --plugin-dir overrides installed version`), so the old "two meters draw" note was wrong; two meters most likely came from the old copy in `~/.claude/dev-mods/450e8183-…/`. The trap: if the repo copy fails to load, there is no meter at all while `claude plugin list` still shows the installed one enabled. Check `claude --debug=hooks` for `hooks module context-meter … loaded` / `not loaded: <reason>`.
- **Cloud sessions:** the mod cannot be seen there. They skip user-scope plugins and the repo's `enabledPlugins`, and the docs say the band does not draw in cloud sessions. `claude --teleport` (from the local clone, clean tree) copies a cloud session and its branch to the terminal.
- **Open `/model` bug (outside the batch):** `/model sonnet`, typed or picked, answers "Kept model as `Opus 5.5`" on the user's PC. Spec section 7 has the two tests still to run. Until `/model` switches there, the model-switch fixes (bugs 1, 5, 6, 7, 10) can be seen only in the tests.

## Active Files

- `hooks/register.tsx`: all logic. Readings: `refresh($, { breakdown, isTurnEnd, isFresh, stepTokens })` → `toSnapshot(u, now, previous, tick, isTurnEnd)`. Hooks: `turn.step` (live reading + `noteEffort`), `turn.complete` (the turn end), `session.measure` (a plain reading), `session.compact` (records before and after, reads nothing), `session.end` (`startOver` on `/clear` and `/resume`), `session.attach` / `session.detach` (`isDrawn`), `refreshModel` (full reading on a model change). Layout: `planMeter` (meter row) and `fitGroups` (rows 2 and 3) leave out whole pieces where a row lacks room. Desktop: `clawdSvg`, `SVG_DARK` / `SVG_LIGHT`, and the `Text` wrapper that adds `mono`. Effort: `parseEffortOutput`, `effortRefusal`.
- `types/index.d.ts`: the `$.state` contract. Every atom used in `register.tsx` must be declared here or `validate` fails. Now has `Snapshot.turnBase`, `windowFrom`, `isAutoCompact`, `compaction`, `Effort.isUnsupported`, and `trend` (tokens) in place of `history` (percents).
- `tests/meter.test.ts`: the suite. Helpers: `usageIn`, `breakdownOf`, `props(columns, isWorking, maxRows)`, `START`, `band`, `answer` (the engine's answer to a `turn.step`), `request` (one main-thread `$.turn.step`), `turnEnds` (a `turn.complete`, then a `session.measure` with `changed: ['context']`, as the engine raises them; a test that uses it answers both), `drawn`, `pickersWidth`, `ASKED` / `SUMMARY`.
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`: the version lives in **both**. Both say 0.3.1.
- `CHANGELOG.md` (`## 0.3.1 — 2026-10-15` holds this release), `README.md` (rows, badges, layouts, hooks updated), `docs/context-meter.png` (README screenshot; the user supplies it as `Downloads/context-meter.png`; it still shows 0.3.0, and row 2 changed in 0.3.1).
- `CLAUDE.md`: commands, architecture, engine rules, Desktop notes, working with the user.
- `tsconfig.json` extends `./.claude-plugin/types/tsconfig.json` (gitignored; written by the engine when it loads the mod from this folder).

## Changes Made

- **0.2.0 (published):** repo with marketplace.json, MIT license, changelog, README install section; vertical effort picker; badge follows saved settings; `details` toggle in row 3.
- **0.2.2 (folded into 0.3.0):** outfits per effort (none, cap, cap with bottles, plus glasses, magician's hat for max/ultracode); Clawd types on a keyboard; thin closed eyes; count-up 6 s, highlight about 10 s; picker applies max/ultracode even when `/effort` output is unreadable; a typed `/effort …` is read in `prompt.submit`; `✦ ultracode off` option.
- **0.3.0 (published):** model picker badge `◇ Opus 5.5 ▾` (`/model <alias>`, polls `$.session.model()` every 1.4 s); one picker open at a time; ultracode stays on across level changes; keycap keyboard with a lit key per typing frame; asleep, legs replace the keyboard and zZzZ rises; model removed from row 3.
- **2026-10-15, audit:** 17 bugs found (spec section 4). The main cause: `session.measure` fires only after each main-thread turn, so the meter went stale during turns and after `/model`, `/compact`, `/clear` and `/resume`.
- **2026-10-15, failing tests:** 13 new tests and 5 extended in `tests/meter.test.ts`; confirmed red (20 fail, 15 pass), each failure an assertion on its bug.
- **2026-10-15, docs:** wrote the spec and the plan; slimmed this handoff; created branch `fix/audit-bugs`.
- **2026-10-15, the batch (cloud session, Claude Code 2.1.300):** plan Tasks 1–6 and the non-visual part of 7, one commit each. Test counts per task matched the plan, except Task 2 (25/11, not 24/12: the trend test already passes once the turn end reads the new window).
- **Deviations from the plan, each with a test:**
  - `fromValues`: a turn end's `last turn` counts on from the `this turn` figure the live readings showed, not from 0 (otherwise `+36.0k` read `+0` right after the turn ended).
  - Row 2's turn piece: `this turn` outranks the `compacted` note (spec section 4 put the note first, which hid the second post-compaction turn's growth, since the note lasts until a turn end measures a real turn).
  - A model switch clears `isUnsupported`, so `– no effort` does not outlast a switch back to a model with effort.
  - `refreshEffort` skips `/config` while `isUnsupported` too, so a model without effort does not get a level back from `/config`.
- **2026-10-15, Claude Code Desktop:** the user reported Clawd and the layout broken in Desktop, fine in the terminal. Cause (2.1.300 API): Desktop draws `Text` in its page font unless `mono`, and block glyphs leave gaps between lines. Fix: off the terminal every Text gets `mono`, and Clawd is one `Svg` (`clawdSvg`), checked by screenshots in headless Chromium for all outfits, dark and light. Not seen in Desktop itself yet. Still open: Desktop draws `Button`s as native buttons (badges, pickers), and whether its spans collapse runs of spaces is unknown; ask the user for a screenshot.
- **2026-10-15, audit follow-up:** a multi-agent audit (stopped partway at the user's word) found 50 candidate issues; 1 was confirmed by 3 of 3 checks before it stopped. The user had the high and medium ones fixed, each proven first by a test that fails on the old code. Fixed, one commit each:
  1. turn ends now come from `turn.complete` (a mid-turn rate-limit measure had been taken for a turn end);
  2. `/compact` no longer reads usage before the engine installs the compaction;
  3. an open picker counts in the band's height (choices in a row in a very short slot);
  4. nothing is cut mid-figure (`planMeter`, `fitGroups`). Pieces are left out only where a row lacks room. The user first took this for a permanent removal of `tokens`, the auto-compact point and the session's length; they were restored, then the user confirmed the room-based dropping and it came back (revert of `1975aae`);
  5. a refused, capped or overridden effort shows what is in force, with a toast (wording from the 2.1.300 binary);
  6. the saved effort is found on 1M models and dated ids;
  7. no work where nothing draws (`isDrawn`, `session.attach`/`detach`);
  8. the subagent test can now fail;
  9. the two clock-heavy tests get 20 s (they timed out at 5 s with 6 suites in parallel).

  Not reproduced, so no code change: a reading answered after `/clear` landing on the fresh meter; the engine abandons the old conversation's dispatches, and a guard test pins that. The 39 low and trivial findings wait for the user's pick, in `docs/superpowers/audits/2026-10-15-open-findings.md`. Each comes from one auditor, unverified.
- **CLAUDE.md** added (commands, architecture, engine rules, Desktop notes, preferences).
- **2026-10-15, release 0.3.1:** at the user's word, `fix/audit-bugs` fast-forwarded into `main`. The tag push was refused (Failed Attempts), so the release form creates `v0.3.1` on `main`'s last commit, which is where `v0.3.0` sits too. Release notes: "Everything since **0.3.0**." and the CHANGELOG's 0.3.1 section, in v0.3.0's format.
- **Two tests corrected (they could not pass as written):** the session clock test advances one more 0.7 s frame (the band redraws on Clawd's frames; the last one before 12:00 lands at 11:59.7). The `/clear` and `/resume` tests asserted "eyes open" and then "eyes shut" exactly one blink period apart, which never holds while the timer runs, and after a turn end, whose measure restarts the timer anyway; they now watch one blink period before the next turn ends, and a stopped timer fails them (checked with a mutant).

## Failed Attempts

- **Detached `sleep` loops for animation:** they die when the hook's dispatch budget ends. Use the one `$.clock.every` ticker.
- **Detecting ultracode from prompt keywords:** false positives. Removed.
- **Relying on the `command.run` hook for `/effort`:** in a live session it never saw typed `/effort`. Now: the settings poll, parsing `/effort …` in `prompt.submit`, and picker picks applied optimistically.
- **Assuming a level change turns ultracode off:** wrong; Claude Code keeps it on until `/effort ultracode off`.
- **Glasses as solid gray lenses `▐●━━━●▌`, straws moved to the mouth row:** the user rejected it. Kept white `(●)─(●)` and the original straws.
- **`$.prompt.submit({ text: '/model x', asUser: true })`:** the host refuses slash commands submitted by plugins.
- **`$.command.run({ command: 'model', args })`:** answers "Kept model as …"; a typed `/model sonnet` does the same.
- **One commit per version (0.2.2, 0.2.3):** impossible; those states were never saved separately. Their notes went into the v0.3.0 release.
- **Test fixture: `session.compact` answering `messages: []`:** the kit refuses it (a compaction keeps at least one message). Use `ASKED` / `SUMMARY`.
- **`$.session.compact({})` from a test:** type error; the test `$` takes the raw event input `{ trigger, messages }`.
- **Looking up `switchModelsOnFlag` in the public settings schema:** not listed, so its meaning is unknown.
- **Seeing the mod in a cloud session:** not installed there (user-scope plugins do not travel), and the band does not draw in cloud sessions per the docs. Use a local terminal.
- **`claude plugin test` writing `.claude-plugin/types/`:** it does not; only loading the mod in a session does. Type-check with the tsconfig outside the repo (Current State).
- **Multi-agent workflows for the audit and its fixes:** slow when run side by side, and the user stopped them. Work through findings one at a time instead.
- **Tagging and releasing from a cloud session:** the git proxy refused `git push origin v0.3.1` with HTTP 403 while branch pushes went through; the GitHub tools there only read releases, and `gh` is not available. Push the branches, then publish `https://github.com/Krs7N/context-meter/releases/new?tag=vX.Y.Z&target=main`, which creates the tag.

## Next Steps

1. **Publish the GitHub Release** for `v0.3.1` if https://github.com/Krs7N/context-meter/releases does not list it yet; publishing creates the tag on `main`. Title `v0.3.1`, notes "Everything since **0.3.0**." and the CHANGELOG's 0.3.1 section.
2. **`/model` first** (spec section 7): `/model sonnet` in a fresh local session, then again without `switchModelsOnFlag`. Until a switch works on the user's PC, the model-switch fixes cannot be seen there.
3. **Check by eye** (spec sections 6 and 8), in a local terminal on `main`: `claude --plugin-dir .` (it replaces the installed copy; confirm `hooks module context-meter … loaded` in `claude --debug=hooks`), or the installed copy after `/plugin update context-meter`. Try a long turn (the meter moves per request, `this turn +…`), `/model` to a smaller window (window note, no spike, over-window warning), `/compact` (`~after`, `compacted … → …`), `/clear` and `/resume` (meter empties within a second, Clawd keeps animating), a short fullscreen terminal (one-line meter), a narrow one (whole pieces left out, nothing cut mid-figure), a model without effort (`– no effort`). In Desktop: Clawd as one picture in both themes, the band's text monospaced, and how the native buttons and runs of spaces look; ask the user for a screenshot. Where a spec section 6 assumption fails, apply its fallback with a test.
4. **New README screenshot** (`docs/context-meter.png`, from the user's `Downloads/context-meter.png`): the current one shows 0.3.0.
5. **Questions waiting on the user:**
   - The drop order: should the trend and the turn's growth go before the auto-compact point shortens to `┊ 83.0k left`, and the rate limits before the session's length?
   - CLAUDE.md says to ask before pushing, but in cloud sessions a stop hook asks to push every unpushed commit at the end of a turn. Keep the rule or drop it?
   - Which open findings to fix (`docs/superpowers/audits/2026-10-15-open-findings.md`). Prove each with a test that fails on the current code first, and drop it if it does not reproduce.
6. **Decide what comes next** with the user (spec section 9): upgrades or the subagent panel. Ask the four questions in that section. Recommended order: upgrades 1, 4, 5 (and 2), then the panel; swap them if subagents are an everyday tool. Worth weighing: the Anthropic Directory already lists two "Context Bar" mods and an "Odometer" drawing the same kind of band.
7. **Next release:** spec section 9, "Release steps", but the user names the version, and in a cloud session the release page is published by hand (Failed Attempts).

**User preferences:**
- Caveman (terse) replies.
- Iterates on visuals one tweak at a time.
- Names the version bump per batch.
- Supplies README screenshots as `Downloads/context-meter.png`; the public README shows their cost and limits.
- No multi-agent workflows: fix findings one at a time, in the order given.
- Likes the room-based dropping (whole pieces left out only where a row lacks room). When a piece goes missing in a screenshot, say whether room is the reason before changing anything.
