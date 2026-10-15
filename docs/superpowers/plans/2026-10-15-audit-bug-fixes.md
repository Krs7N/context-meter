# context-meter audit bug batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 17 bugs from the 2026-10-15 audit so the meter is right after model switches, during turns, after `/clear`, `/resume` and `/compact`, and in short or narrow layouts.

**Architecture:** All logic stays in the one hooks module `hooks/register.tsx`, state contract in `types/index.d.ts`. Readings get explicit kinds (fresh, live, turn end), the snapshot learns turn growth, window changes and compactions, and new or changed hooks (`turn.step`, `session.compact`, `session.end`, `session.measure`, `refreshModel`) take readings at the right moments.

**Tech Stack:** Claude Code 2.1.299 function hooks (TypeScript + JSX against `h`), `claude-code/testing` kit via `claude plugin test`, `tsc` 5.6.3.

**Spec:** [`docs/superpowers/specs/2026-10-15-audit-and-next-steps.md`](../specs/2026-10-15-audit-and-next-steps.md). Read sections 2, 4 and 6 before starting.

## Global Constraints

- Work on branch `fix/audit-bugs`. **Do not bump the version** in `.claude-plugin/plugin.json` or `.claude-plugin/marketplace.json`: the user names it at release.
- Every atom used in `register.tsx` must be declared in `types/index.d.ts`, or `claude plugin validate` fails.
- Drawing state lives in `$.state`; module variables (`ticker`, `countStep`, `subtick`, `lastSaved`) are lost on every reload.
- A render hook never writes state.
- Hooks on the request path (`turn.step`, and `tool.call` if one is ever added) must not await anything before passing the request on.
- Keep the 15 tests that pass today passing at every commit.
- Commit messages follow the repo's plain style and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ask the user before every push: the repo is public.
- Texts the tests pin, verbatim: `window 1.00M → 200.0k`, `! 150.0k over the 200.0k window: next send compacts`, `…: /compact before sending`, `this turn +36.0k`, `last turn +36.0k`, `compacted 182.0k → 31.0k`, `~31.0k`, `– no effort`, `Claude Code kept Opus 5.5: /model sonnet did not switch`, `Opus 5.5 · 1M`, `1d 2h`.

## Review Focus

Conditions no failing test covered when the batch was written; each gets a test in its owning task:

1. A subagent's request (`turn.step` with `agentId`) must move neither the main meter nor the effort badge. Test in Task 4.
2. A request that got no response (`usage: null`: interrupted, API error) must leave the meter alone. Test in Task 4.
3. A window of 0 (unknown model) must never print `NaN` or `Infinity`. Test in Task 2.
4. The one-line layout (under 72 columns) must still flag a context bigger than the window. Test in Task 5.
5. Auto-compaction in the middle of a turn must not show negative turn growth (`this turn −120.0k`). Test in Task 6.

---

### Task 0: Get set up

**Files:** none changed.

- [ ] **Step 1: Check out the branch.** `git checkout fix/audit-bugs`. Expected: clean tree.
- [ ] **Step 2: Confirm red.** From the repo's parent folder: `claude plugin test context-meter 2>&1 | grep -E '^\((pass|fail)\)|pass$|fail$'`. Expected: `15 pass`, `20 fail`; the 20 are the tests named in Tasks 1–6.
- [ ] **Step 3: Set up type-checking.** If `.claude-plugin/types/` is missing, make a tsconfig outside the repo as spec section 8 says. Expected: `tsc` reports only the 6 `TS2554` errors in `tests/meter.test.ts` (second argument to `trendText` and `fillColor`).

### Task 1: Small helpers (bugs 10, 11, 13 days, 14, 16)

**Files:**
- Modify: `hooks/register.tsx`: `fillColor` (`:208-211`), `duration` (`:306-310`), `savedEffort` (`:380-385`), `modelLabel` (`:468-476`), the toast in `pickModel` (`:505`), the bar colour in the render (`:772`).
- Test: `tests/meter.test.ts` (already written).

**Interfaces:**
- Produces: `fillColor(percent: number, compactPercent?: number): string`; `duration(ms: number): string`; `modelLabel(name: string | null | undefined): string`; `savedEffort(settings: Readonly<Record<string, unknown>>, model?: string): string | undefined`.

- [ ] **Step 1: Confirm these fail:** `formatting > durations`, `bar runs > newly filled part and the auto-compact mark are separate runs`, `model names`, `saved effort: per-model first, then the top-level default`, `a model switch Claude Code keeps back says so, without advice that does not work`.
- [ ] **Step 2: `duration`:** from 24 h, `${d}d ${h}h`; below that unchanged.
- [ ] **Step 3: `fillColor(percent, compactPercent?)`:** without `compactPercent`, unchanged (60 / 80). With it, `ratio = percent / compactPercent`: `error` from 0.95, `warning` from 0.75, else `claude`. In the render pass `compactPercent = s.compactAt / s.window * 100` when both are known and the window is above 0.
- [ ] **Step 4: `modelLabel`:** take the version right after the family name: `new RegExp(`${family}[-_ ]?(\\d{1,2})(?:[-.](\\d{1,2}))?(?!\\d)`, 'i')`. If that misses, take `(\d{1,2})[-.](\d{1,2})[-.]` before the family (`claude-3-5-haiku`). Append ` · 1M` when the name holds `[1m]` or `1M context` (any case).
- [ ] **Step 5: `savedEffort`:** try `modelSettings[model]`; if absent, use the first `modelSettings` entry whose key has the same `modelLabel` as `model`; then the top-level `effortLevel`.
- [ ] **Step 6: toast:** `Claude Code kept ${modelLabel(name)}: /model ${alias} did not switch`.
- [ ] **Step 7: Run the suite.** Expected: the 5 tests from Step 1 pass; 20 pass, 15 fail.
- [ ] **Step 8: Commit.** `git add hooks/register.tsx && git commit` with message `Fix model labels, saved-effort lookup, durations, bar colour and the /model toast`.

### Task 2: Readings core (bugs 6 and 7 data side, 15)

**Files:**
- Modify: `types/index.d.ts` (`Snapshot`, `Effort`, `PluginState`); `hooks/register.tsx`: atoms (`:6-15`), `trendText` (`:298-304`), `refreshEffort` (`:368-378`), `changedKeys` (`:515-527`), `toSnapshot` (`:529-563`), `refresh` (`:583-606`), the `session.measure` hook (`:685-690`), the trend in row 2 (`:953`).
- Test: `tests/meter.test.ts`.

**Interfaces:**
- Produces:
  - `Snapshot` fields `turnBase?: number`, `windowFrom?: number`, `isAutoCompact?: boolean`, `compaction?: { before?: number; after?: number }`. `lastDelta` now means the growth of the last completed turn.
  - `Effort.isUnsupported?: boolean`.
  - State key `trend: number[]` (tokens at turn ends, last 16) replacing `history`.
  - `trendText(tokens: readonly number[], window: number): string`.
  - `toSnapshot(u: SessionUsage, now: number, previous: Snapshot | null | undefined, tick?: number, isTurnEnd?: boolean): Snapshot`.
  - `refresh($: EngineInterface, opts?: { breakdown?: boolean; isTurnEnd?: boolean; isFresh?: boolean; stepTokens?: number }): Promise<boolean>`: `true` when a reading was stored. `breakdown` defaults to `true`. `isFresh` reads with no previous snapshot. `stepTokens` overrides the context's tokens and sets `percent = min(100, round(tokens / window * 100))`.

- [ ] **Step 1: Add the Review Focus 3 test** to the `formatting` describe:

```ts
test('a trend with no window shows tokens', async () => {
  expect(trendText([10_000, 20_000], 0)).toBe('trend ▁█ 10.0k→20.0k')
})
```

- [ ] **Step 2: Confirm these fail:** `formatting > tokens, bar and sparkline`, `formatting > a trend with no window shows tokens`, `readings > a measure that moved only the cost reads no breakdown`, `readings > the effort is read from /config only while no request has named it`.
- [ ] **Step 3: Contract.** Update `types/index.d.ts` as the Interfaces block says, with a doc comment on each field.
- [ ] **Step 4: `trendText(tokens, window)`:** the sparkline of the last 8 entries, then `first→last%` with percents rounded against `window`. With `window <= 0`, `first→last` as `fmtTokens`.
- [ ] **Step 5: `toSnapshot`** follows spec section 4, "Reading rules". The parts the signature does not decide:

```
b = u.context.breakdown; previous may be null (fresh)
windowChanged = previous && previous.window !== u.context.window
carry = !b && previous && !windowChanged      // compactAt, isAutoCompact, model, categories
turnBase = previous ? previous.turnBase : tokens
lastDelta = previous?.lastDelta; compaction = previous?.compaction
if isTurnEnd && tokens !== undefined:
  if turnBase !== undefined: lastDelta = tokens - turnBase; compaction = undefined
  else: lastDelta = undefined
  turnBase = tokens
keys = changedKeys(previous, next)            // tokens + headroom; percent only in the same window;
                                              // window; usd; limit:<kind>; never delta
if isTurnEnd && lastDelta was recomputed && lastDelta !== 0: keys.push('delta')
windowFrom = windowChanged ? previous.window : previous?.windowFrom
```

  `prevPercent` and `from` are as today, but only for the keys present.
- [ ] **Step 6: `refresh(opts)`:** reads `$.session.usage(opts.breakdown === false ? undefined : { breakdown: 'summary', columns: 40 })`. It pushes `tokens` to `trend` when `(isFresh || isTurnEnd)`, tokens are known and differ from the last entry. It starts the count-up as today. It returns whether it stored a reading.
- [ ] **Step 7: `session.measure`:** `isTurnEnd = e.changed.includes('context')`; `refresh($, { breakdown: isTurnEnd, isTurnEnd })`. Call `refreshEffort` only when `(await read($, effort)).level === undefined`; move that guard before `$.config.list()`.
- [ ] **Step 8: Run the suite.** Expected: the 4 tests from Step 2 pass, and `band shows fill, tokens, cost and limits; a new reading redraws it` still passes (`+98.0k` comes from the turn end now). 24 pass, 12 fail.
- [ ] **Step 9: Validate and type-check.** `claude plugin validate context-meter` lists `trend` and not `history`. `tsc` is clean.
- [ ] **Step 10: Commit:** `Readings know turn ends: token trend, breakdown only when the fill moved`.

### Task 3: Model switch (bugs 1, 6 render, 10 wiring)

**Files:**
- Modify: `hooks/register.tsx`: `pollSavedEffort` (`:387-406`), `refreshModel` (`:484-492`), `pickModel` (`:499-513`), row 2 in the render (`:932-953`), `Seg` and `joinSegs` (`:256-269`), the `row` helper (`:966-977`).

**Interfaces:**
- Consumes: `refresh` and the `Snapshot` fields from Task 2; `modelLabel` and `savedEffort` from Task 1.
- Produces: `Seg = { text: string; hl?: boolean; color?: string }`. `joinSegs` merges only plain pieces (no `hl`, no `color`). `row` draws `color ?? (hl ? HL_COLOR : undefined)`, bold when `hl` or `color`, dim otherwise.

- [ ] **Step 1: Confirm these fail:** `model switch > the meter redraws for the new window at once`, `model switch > the badge shows the new model’s saved effort`, `model switch > the trend reads tokens, so a smaller window is no spike`.
- [ ] **Step 2: `refreshModel`:** read the old `model` atom first, then `$.session.model()`, then write. When the old value is not null and `modelLabel(old) !== modelLabel(new)`: `await refresh($)` (with breakdown), then `await pollSavedEffort($)`.
- [ ] **Step 3: `pickModel`:** stop writing the `model` atom from the command's output (that write would hide the switch from Step 2); keep `await refreshModel($)`.
- [ ] **Step 4: `pollSavedEffort`:** look up `savedEffort(settings, (await read($, model)) ?? s?.model)`. A level it applies also sets `isUnsupported: false`.
- [ ] **Step 5: Window chip:** while `hl('window')`, row 2 shows `window ${fmtTokens(s.windowFrom)} → ${fmtTokens(s.window)}` as a highlighted piece, in the order of spec section 4, "Row 2".
- [ ] **Step 6: Run the suite.** Expected: the 3 tests pass; 27 pass, 9 fail.
- [ ] **Step 7: Commit:** `The meter follows model switches: new window at once, window chip, saved effort per model`.

### Task 4: Live readings and effort per request (bugs 2, 8, 15 request path)

**Files:**
- Modify: `hooks/register.tsx`: the `turn.step` hook (`:693-704`), `effortBadge` (`:322-349`), row 2 in the render.
- Test: `tests/meter.test.ts`.

**Interfaces:**
- Consumes: `refresh(opts.stepTokens)` from Task 2.
- Produces: `noteEffort($: EngineInterface, level: TurnStepInput['effort']): Promise<void>`. Undefined sets `{ level: undefined, isUnsupported: true }`; a value sets `{ level, isUnsupported: false }`; ultracode is left as it is.

- [ ] **Step 1: Add the Review Focus 1 and 2 tests** to the `readings` describe:

```ts
test('a subagent’s request moves neither the meter nor the badge', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  on('turn.step', answer(() => 150_000))
  mock.clock(on, { now: 600_000 })
  await $.session.start(START)
  const stream = $.turn.step({
    turnId: 't2', index: 0, model: 'claude-haiku-5-5', effort: 'max', messageCount: 2, agentId: 'agent-1',
  })
  for await (const _ of stream) {
    // nothing streamed
  }
  await stream.result
  const ui = await band($, 140)
  expect(await ui.find({ type: 'Text', text: '50.0k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /MAX/ })).toBeUndefined()
  await ui.unmount()
})

test('a request that got no response leaves the meter alone', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  on('turn.step', async function* (_$: unknown, e: TurnStepInput) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  mock.clock(on, { now: 600_000 })
  await $.session.start(START)
  await request($, 'high')
  const ui = await band($, 140)
  expect(await ui.find({ type: 'Text', text: '50.0k' })).toBeDefined()
  await ui.unmount()
})
```

  Both pass before this task; they guard it.
- [ ] **Step 2: Confirm these fail:** `readings > the meter moves with each request of a running turn`, `model switch > a model without effort drops the old level from the badge`.
- [ ] **Step 3: `turn.step` hook:** start `markActive($)` and, on the main loop, `noteEffort($, e.effort)` without awaiting. Then `const result = yield* next(e)`, then await both. On the main loop with `result.usage`: `refresh($, { breakdown: false, stepTokens: input_tokens + cache_read_input_tokens + cache_creation_input_tokens })`. Return `result`.
- [ ] **Step 4: `effortBadge`:** with `isUnsupported` and no ultracode: `{ text: '– no effort', dimColor: true }`.
- [ ] **Step 5: "This turn":** in row 2's piece 4, while `isWorking` with `turnBase` and `tokens` known: `this turn ` plus the signed growth, `fmtTokens(shown('tokens', s.tokens) - s.turnBase)`, highlighted with `hl('tokens')`, shown only when not 0. Otherwise `last turn ±X` as before.
- [ ] **Step 6: Run the suite.** Expected: the 2 tests pass and both guards still pass; 31 pass, 7 fail.
- [ ] **Step 7: Commit:** `Live readings per request; effort badge follows every request, including none`.

### Task 5: Layout guards (bugs 5, 9, 13 clock)

**Files:**
- Modify: `hooks/register.tsx`: the render (`:746-1025`: layout choice at `:773`, meter row `:802-830`, row 2, row 3 `:955`).
- Test: `tests/meter.test.ts`.

**Interfaces:**
- Consumes: `Seg.color` from Task 3; `Snapshot.isAutoCompact` from Task 2.

- [ ] **Step 1: Add the Review Focus 4 test** to the `model switch` describe:

```ts
test('the one-line meter colours a context bigger than the window', async ($, on) => {
  on('session.usage', () => ({ value: usageIn(200_000, 350_000) }))
  on('session.start', () => ({ cwd: '.' }))
  mock.clock(on, { now: 600_000 })
  await $.session.start(START)
  const ui = await band($, 60)
  const tokens = await ui.find({ type: 'Text', text: '350.0k' })
  expect(tokens?.props.color).toBe('error')
  await ui.unmount()
})
```

- [ ] **Step 2: Confirm these fail:** that test, `model switch > a context bigger than the window says what the next send does`, `a short band slot gets the one-line meter`, `readings > the session clock runs between readings`.
- [ ] **Step 3: Over the window** (`tokens > window > 0`): row 2 starts with `! ${fmtTokens(over)} over the ${fmtTokens(window)} window: ` plus `/compact before sending` when `isAutoCompact === false`, else `next send compacts`, coloured `error`. The `┊ auto-compact at …` piece is left out then. The meter row's tokens text is coloured `error` (both layouts).
- [ ] **Step 4: `maxRows`:** compute Clawd's rows before choosing the layout. `fullRows = max(clawdRows.length, 3 + (details row ? 1 : 0)) + 2`. `isCompact = columns < 72 || fullRows > e.props.maxRows`. Picker columns do not count.
- [ ] **Step 5: Session clock:** `const now = await $.clock.now().catch(() => s.at)`; row 3 shows `session ${duration(now - s.startedAt)}`.
- [ ] **Step 6: Run the suite.** Expected: the 4 tests pass; 35 pass, 4 fail (the four Task 6 tests).
- [ ] **Step 7: Commit:** `Warn when the context is bigger than the window; short slots get the one-line meter; the session clock runs`.

### Task 6: Lifecycle (bugs 3, 4, 12)

**Files:**
- Modify: `hooks/register.tsx`: the `session.start` hook (`:670-675`), `onTick` (`:637-650`), the `session.end` hook (`:741-744`), a new `session.compact` hook, the meter row and row 2 in the render.
- Test: `tests/meter.test.ts`.

**Interfaces:**
- Consumes: `refresh(opts.isFresh)` and `Snapshot.compaction` / `turnBase` from Task 2.
- Produces: `startOver($: EngineInterface): Promise<void>`: `trend` → `[]`, then `refresh($, { isFresh: true })`; when that returns false, `snap` → `null`.

- [ ] **Step 1: Add the Review Focus 5 test** to the `readings` describe:

```ts
test('auto-compaction mid-turn shows no negative turn growth', async ($, on) => {
  let current: SessionUsage = usage(150_000, 75)
  on('session.usage', () => ({ value: current }))
  on('session.start', () => ({ cwd: '.' }))
  on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 150_000, tokensAfter: 30_000 }))
  on('turn.step', answer(() => 40_000))
  const clock = mock.clock(on, { now: 600_000 })
  await $.session.start(START)
  current = { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.5 } }
  await $.session.compact({ trigger: 'auto', messages: [ASKED, SUMMARY] })
  await request($, 'high')
  await clock.advance(7000)
  const ui = await band($, 140, true)
  expect(await ui.find({ type: 'Text', text: /this turn/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /compacted 150\.0k → 30\.0k/ })).toBeDefined()
  await ui.unmount()
})
```

- [ ] **Step 2: Confirm these fail:** that test, `readings > /clear starts the meter over`, `readings > /resume starts the meter over`, `readings > /compact redraws at once with what it freed`, `readings > a session start (a reload) lands a count-up on the new numbers`.
- [ ] **Step 3: `session.start`:** before reading, set `countStep = TWEEN_STEPS` and the `tweenStep` atom to `TWEEN_STEPS`.
- [ ] **Step 4: `session.end`:** for `clear` and `resume`, keep the ticker and schedule `$.clock.after(300, () => void startOver($))`. Other reasons stop the ticker as today.
- [ ] **Step 5: `onTick`:** in the 1.4 s slot, when `snap` is null, `refresh($, { isFresh: true })`.
- [ ] **Step 6: `session.compact` hook** with `.catch(($, e, next) => next(e))`. After `await next(e)`, when `e.agentId === undefined`, `e.trigger !== 'precompute'` and the result has no `skip`: set `snap.compaction = { before: result.tokensBefore ?? snap.tokens, after: result.tokensAfter }` and `snap.turnBase = undefined`, then `refresh($)`. Return the result.
- [ ] **Step 7: Render a compaction:**
  - When `tokens` is undefined and `compaction.after` is known, the bar uses `round(after / window * 100)` and the tokens text is `~${fmtTokens(after)}` plus ` / ${fmtTokens(window)} tokens` (dim).
  - Row 2's piece 4 is `compacted ${fmtTokens(before)} → ${fmtTokens(after)}` while `compaction` is set.
- [ ] **Step 8: Run the suite.** Expected: 40 pass, 0 fail.
- [ ] **Step 9: Commit:** `/clear, /resume and /compact redraw the meter; a reload lands a count-up`.

### Task 7: Finish

**Files:**
- Modify: `hooks/register.tsx:779` (comment: about 10 s); `CHANGELOG.md`; `README.md` if it describes row 2; `handoff.md`.

- [ ] **Step 1: Comment.** Fix the highlight comment at `:779`.
- [ ] **Step 2: Verify.** `claude plugin validate context-meter` (warnings only); `claude plugin test context-meter` (40 pass); `tsc` clean.
- [ ] **Step 3: Changelog.** Add `## Unreleased` at the top of `CHANGELOG.md`, one line per user-visible fix, in the style of the 0.3.0 section. No version bump.
- [ ] **Step 4: README.** Update only where it describes row 2, the badge or the layouts.
- [ ] **Step 5: Check by eye** (spec section 8): a long turn, `/model` to a smaller window, `/compact`, `/clear`, `/resume`, a short fullscreen terminal. Check the assumptions table in spec section 6 and apply a fallback where one fails, with a test.
- [ ] **Step 6: Handoff.** Update `handoff.md` with the `handoff` skill: batch done, what the eye check found, next decision (spec section 9).
- [ ] **Step 7: Commit:** `Audit bug batch: changelog, README, handoff`. Ask the user, then `git push`.
- [ ] **Step 8: Hand over the decision.** Present spec section 9 to the user: the four questions, the recommendation, and the release steps once they name a version.
