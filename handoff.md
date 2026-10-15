# Handoff

## Goal

Keep developing **context-meter**, a Claude Code mod (hooks-module plugin) that draws a live context-window band above the prompt: fill bar, tokens, auto-compact headroom, trend, cost, rate limits, a model picker, an effort picker, and Clawd the mascot (outfits per effort, typing on a keyboard, sleeping).

- Repo: https://github.com/Krs7N/context-meter (public). The repo is its own marketplace: `/plugin install context-meter --marketplace Krs7N/context-meter`. Needs Claude Code 2.1.296 or later (developed on 2.1.299).
- **Current stage (agreed 2026-10-15):** fix every bug from the 2026-10-15 audit on branch `fix/audit-bugs`, test first, without bumping the version. Then the user decides between some of the upgrades and the subagent panel.
- **Read these two documents first:**
  - `docs/superpowers/specs/2026-10-15-audit-and-next-steps.md`: the audit, the engine facts behind it, each bug with its fix, what is left out and why, assumptions to check by eye, the open `/model` bug, how to verify, and the guide for deciding what comes after the batch.
  - `docs/superpowers/plans/2026-10-15-audit-bug-fixes.md`: the ordered tasks (0–7), each with files, interfaces, the tests it turns green, the expected test counts and its commit.

## Current State

- **`main`:** v0.3.0, released (tag `v0.3.0`). Untouched this session.
- **Branch `fix/audit-bugs`:** the failing tests, the spec, the plan and this handoff. No production code changed yet (`hooks/register.tsx` and `types/index.d.ts` are as in v0.3.0).
- **Tests are red on purpose (TDD):** `claude plugin test context-meter` gives 35 tests, 15 pass (all behaviour that already worked), 20 fail, each on an assertion about the bug it targets. The plan's Task 0 lists how to confirm this.
- **tsc:** only the 6 expected `TS2554` errors (tests pass a second argument to `trendText` and `fillColor`). `.claude-plugin/types/` does not exist in the repo yet; spec section 8 says how to type-check without it.
- **Installed copy:** `context-meter@context-meter` 0.3.0 is installed and enabled at user scope. Disable or uninstall it before running the repo with `claude --plugin-dir .`, or two meters draw.
- **Open `/model` bug (outside the batch):** `/model sonnet`, typed or picked, answers "Kept model as `Opus 5.5`" (seen again 2026-10-15). Facts and the tests still to run are in spec section 7.

## Active Files

- `hooks/register.tsx`: all logic. Every fix lands here; the plan gives line ranges as of v0.3.0.
- `types/index.d.ts`: the `$.state` contract. Every atom used in `register.tsx` must be declared here or `validate` fails. Task 2 adds `Snapshot.turnBase`, `windowFrom`, `isAutoCompact`, `compaction`, `Effort.isUnsupported`, and replaces `history` (percents) with `trend` (tokens).
- `tests/meter.test.ts`: the suite. Helpers added this stage: `usageIn`, `breakdownOf`, `props(columns, isWorking, maxRows)`, `START`, `band`, `answer` (the engine's answer to a `turn.step`), `request` (one main-thread `$.turn.step`), `turnEnds` (a `session.measure` with `changed: ['context']`), `ASKED` / `SUMMARY`.
- `docs/superpowers/specs/2026-10-15-audit-and-next-steps.md` and `docs/superpowers/plans/2026-10-15-audit-bug-fixes.md`: the spec and the plan for this stage.
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`: the version lives in **both**. Do not bump it in this stage.
- `CHANGELOG.md` (Task 7 adds `## Unreleased`), `README.md`, `docs/context-meter.png` (README screenshot; the user supplies it as `Downloads/context-meter.png`).
- `tsconfig.json` extends `./.claude-plugin/types/tsconfig.json` (gitignored; written by the engine when it loads the mod from this folder).

## Changes Made

- **0.2.0 (published):** repo with marketplace.json, MIT license, changelog, README install section; vertical effort picker; badge follows saved settings; `details` toggle in row 3.
- **0.2.2 (folded into 0.3.0):** outfits per effort (none, cap, cap with bottles, plus glasses, magician's hat for max/ultracode); Clawd types on a keyboard; thin closed eyes; count-up 6 s, highlight about 10 s; picker applies max/ultracode even when `/effort` output is unreadable; a typed `/effort …` is read in `prompt.submit`; `✦ ultracode off` option.
- **0.3.0 (published):** model picker badge `◇ Opus 5.5 ▾` (`/model <alias>`, polls `$.session.model()` every 1.4 s); one picker open at a time; ultracode stays on across level changes; keycap keyboard with a lit key per typing frame; asleep, legs replace the keyboard and zZzZ rises; model removed from row 3.
- **2026-10-15, audit:** 17 bugs found (spec section 4). The main cause: `session.measure` fires only after each main-thread turn, so the meter went stale during turns and after `/model`, `/compact`, `/clear` and `/resume`.
- **2026-10-15, failing tests:** 13 new tests and 5 extended in `tests/meter.test.ts`; confirmed red (20 fail, 15 pass), each failure an assertion on its bug.
- **2026-10-15, docs:** wrote the spec and the plan; slimmed this handoff; created branch `fix/audit-bugs`.

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

## Next Steps

1. **Fix the bugs:** follow `docs/superpowers/plans/2026-10-15-audit-bug-fixes.md` from Task 0 to Task 7, on `fix/audit-bugs`. Each task names the failing tests it must turn green and the expected pass/fail counts; commit after each task. Ask the user before every push (public repo). No version bump.
2. **Check by eye** (plan Task 7 Step 5, spec sections 6 and 8): run the repo with `claude --plugin-dir .` after disabling the installed copy, then try a long turn, `/model` to a smaller window, `/compact`, `/clear`, `/resume` and a short fullscreen terminal. Where an assumption fails, apply its fallback with a test.
3. **Decide what comes next** with the user (spec section 9): upgrades (forecast, window and fit in the model picker, cache-cold warning, compaction count, rate-limit reset countdown, `/config` options, `/context` grid pane, session summary) or the subagent panel (layouts A–D; A and D first). Ask the four questions in that section. Recommended order: release the bug batch, then upgrades 1, 4, 5 (and 2), then the panel; swap the last two if subagents are an everyday tool.
4. **Release** when the user names the version: spec section 9, "Release steps".

**User preferences:**
- Caveman (terse) replies.
- Iterates on visuals one tweak at a time.
- Names the version bump per batch.
- Supplies README screenshots as `Downloads/context-meter.png`; the public README shows their cost and limits.
