# Handoff

## Goal

Keep developing **context-meter**, a Claude Code mod (hooks-module plugin) that draws a live context-window band above the prompt: fill bar, tokens, auto-compact headroom, trend, cost, rate limits, a model picker, an effort picker, and Clawd the mascot (outfits per effort, typing on a keyboard, sleeping).

- Repo: https://github.com/Krs7N/context-meter (public). The repo is its own marketplace: `/plugin install context-meter --marketplace Krs7N/context-meter`. Needs Claude Code 2.1.296 or later (developed on 2.1.299).
- **Current stage:** the 2026-10-15 audit batch is **coded and green** on branch `fix/audit-bugs` (plan Tasks 0–7, except the check by eye), with the Claude Code Desktop fix, as **version 0.3.1** (bumped on the branch at the user's word, 2026-10-15). Not released yet: not merged to `main`, no tag. Next: the results of the bug audit decide what else goes into 0.3.1; then the user checks it by eye in a real terminal and in Desktop, then the release, then the choice between some of the upgrades and the subagent panel.
- **Background documents** (their line references are as of v0.3.0, now stale):
  - `docs/superpowers/specs/2026-10-15-audit-and-next-steps.md`: the audit, the engine facts behind it, each bug with its fix, what is left out and why, assumptions to check by eye (section 6), the open `/model` bug (section 7), how to verify (section 8), and the guide for deciding what comes after the batch (section 9).
  - `docs/superpowers/plans/2026-10-15-audit-bug-fixes.md`: the ordered tasks (0–7) as planned.

## Current State

- **`main`:** v0.3.0, released (tag `v0.3.0`). Untouched.
- **Branch `fix/audit-bugs`:** all 17 audit bugs fixed, plus two gaps found while finishing (see Changes Made). One commit per plan task. **Not pushed yet** unless the user said so after 2026-10-15's cloud session (check `git status` against `origin`).
- **Tests:** `claude plugin test context-meter` gives **55 pass, 0 fail**. `claude plugin validate context-meter` passes with the one old warning (no marketplace description). `tsc` 5.6.3 is clean.
- **Type-check without `.claude-plugin/types/`:** a tsconfig kept outside the repo, `include` = the plugin-authoring skill's `types/claude-code.d.ts` plus the repo's `hooks`, `types`, `tests` (compilerOptions from that file's header), then `npx -y -p typescript@5.6.3 tsc -p <that tsconfig>`.
- **Installed copy:** `context-meter@context-meter` 0.3.0 at user scope on the user's PC. `--plugin-dir .` **replaces** a same-named installed plugin (2.1.300 logs `from --plugin-dir overrides installed version`), so the old "two meters draw" note was wrong; two meters most likely came from the old copy in `~/.claude/dev-mods/450e8183-…/`. The trap: if the repo copy fails to load, there is no meter at all while `claude plugin list` still shows the installed one enabled. Check `claude --debug=hooks` for `hooks module context-meter … loaded` / `not loaded: <reason>`.
- **Cloud sessions:** the mod cannot be seen there. They skip user-scope plugins and the repo's `enabledPlugins`, and the docs say the band does not draw in cloud sessions. `claude --teleport` (from the local clone, clean tree) copies a cloud session and its branch to the terminal.
- **Open `/model` bug (outside the batch):** `/model sonnet`, typed or picked, answers "Kept model as `Opus 5.5`" on the user's PC. Spec section 7 has the two tests still to run. Until `/model` switches there, the model-switch fixes (bugs 1, 5, 6, 7, 10) can be seen only in the tests.

## Active Files

- `hooks/register.tsx`: all logic. Readings: `refresh($, { breakdown, isTurnEnd, isFresh, stepTokens })` → `toSnapshot(u, now, previous, tick, isTurnEnd)`. Hooks: `turn.step` (live reading + `noteEffort`), `session.measure` (turn end vs cost-only), `session.compact`, `session.end` (`startOver` on `/clear` and `/resume`), `refreshModel` (full reading on a model change).
- `types/index.d.ts`: the `$.state` contract. Every atom used in `register.tsx` must be declared here or `validate` fails. Now has `Snapshot.turnBase`, `windowFrom`, `isAutoCompact`, `compaction`, `Effort.isUnsupported`, and `trend` (tokens) in place of `history` (percents).
- `tests/meter.test.ts`: the suite. Helpers: `usageIn`, `breakdownOf`, `props(columns, isWorking, maxRows)`, `START`, `band`, `answer` (the engine's answer to a `turn.step`), `request` (one main-thread `$.turn.step`), `turnEnds` (a `session.measure` with `changed: ['context']`), `ASKED` / `SUMMARY`.
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`: the version lives in **both**. Both say 0.3.1.
- `CHANGELOG.md` (`## 0.3.1 — 2026-10-15` holds this batch), `README.md` (rows, badges, layouts, hooks updated), `docs/context-meter.png` (README screenshot; the user supplies it as `Downloads/context-meter.png`; a new one is due with the release, row 2 changed).
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
  4. nothing is cut mid-figure (`planMeter`, `fitGroups`);
  5. a refused, capped or overridden effort shows what is in force, with a toast (wording from the 2.1.300 binary);
  6. the saved effort is found on 1M models and dated ids;
  7. no work where nothing draws (`isDrawn`, `session.attach`/`detach`);
  8. the subagent test can now fail;
  9. the two clock-heavy tests get 20 s (they timed out at 5 s with 6 suites in parallel).

  Not reproduced, so no code change: a reading answered after `/clear` landing on the fresh meter; the engine abandons the old conversation's dispatches, and a guard test pins that. The low and trivial findings wait for the user's pick; the list is in this session's scratchpad (`audit-dedup.json`) and in the chat.
- **CLAUDE.md** added (commands, architecture, engine rules, Desktop notes, preferences).
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

## Next Steps

1. **Push** `fix/audit-bugs` if not done yet. Ask the user first (public repo).
2. **`/model` first** (spec section 7): `/model sonnet` in a fresh local session, then again without `switchModelsOnFlag`. Until a switch works on the user's PC, the model-switch fixes cannot be seen there.
3. **Check by eye** (spec sections 6 and 8), in a local terminal on the branch: `claude --plugin-dir .` (it replaces the installed copy; confirm `hooks module context-meter … loaded` in `claude --debug=hooks`). Try a long turn (the meter moves per request, `this turn +…`), `/model` to a smaller window (window note, no spike, over-window warning), `/compact` (`~after`, `compacted … → …`), `/clear` and `/resume` (meter empties within a second, Clawd keeps animating), a short fullscreen terminal (one-line meter), a model without effort (`– no effort`). Where a spec section 6 assumption fails, apply its fallback with a test.
4. **Decide what comes next** with the user (spec section 9): upgrades or the subagent panel. Ask the four questions in that section. Recommended order: release the bug batch, then upgrades 1, 4, 5 (and 2), then the panel; swap the last two if subagents are an everyday tool. Worth weighing: the Anthropic Directory already lists two "Context Bar" mods and an "Odometer" drawing the same kind of band.
5. **Release 0.3.1** once the audit's fixes are in and the eye check passes: spec section 9, "Release steps" (the version is already bumped; fix the changelog date if it moves; new README screenshot). Merge to `main`, tag `v0.3.1`, `gh release create`. Ask before pushing `main` and the tag.

**User preferences:**
- Caveman (terse) replies.
- Iterates on visuals one tweak at a time.
- Names the version bump per batch.
- Supplies README screenshots as `Downloads/context-meter.png`; the public README shows their cost and limits.
