# context-meter: open findings of the 2026-10-15 audit

What is left of the multi-agent audit run on 0.3.1's branch, after the high and medium findings were fixed for the 0.3.1 release. The audit was stopped partway, so **none of these is verified**: each comes from one auditor. Before fixing one, prove it with a test that fails on the current code, and drop it if it does not reproduce.

Line numbers are as of the audit, before the follow-up fixes; search for the function or text instead. Severity and confidence are the auditor's.


## Low (29)


### `compact-hook-skipped-org-managed`: Under an organization-managed Claude Code the session.compact hook never runs, and nothing else notices a compaction

- **Where:** `hooks/register.tsx:1095`; confidence certain
- **Scenario:** `claude plugin validate context-meter` on 2.1.300 reports: 'hooks on session.compact do not run in a plugin a person installs where an organization manages Claude Code'. Such a user installs the mod as README says. A turn ends at 182k (turnBase 182k), then /compact or an auto-compaction runs, and the first reply returns 40k.
- **Expected:** The compaction is noted ('compacted 182.0k → …') and no negative turn growth is shown, as README:59 and :133 and the CHANGELOG promise.
- **Actual:** Nothing records the compaction. The old fill stays until the next reply. The band then shows 'this turn −142.0k' while working and 'last turn −142.0k' with ▼ after the turn: the bug-4 symptoms.
- **Suggested fix:** Add a fallback that does not depend on session.compact. When a main-loop reading's tokens fall far below turnBase with no compaction recorded (or a main turn.step's messageCount drops), record compaction {before: old tokens} and clear turnBase. Optionally, have the poll call the free $.session.usage() and treat context.tokens going from a value to undefined as a compaction. Note the limitation in README either way.

### `refused-every-kills-ticker`: A refused clock.every period ends the ticker for good, but its handle stays set, so it is never re-armed

- **Where:** `hooks/register.tsx:919`; confidence likely
- **Scenario:** The d.ts says of $.clock.every: 'a refused period ends the interval'. Another installed or managed plugin that hooks clock.every denies one period. `ticker` stays set, so every later startTicker() returns at `if (ticker) return`. A probe that wraps mock.clock's every hook to deny one period reproduces this.
- **Expected:** Count-ups, frames and the 1.4 s polls carry on, or resume.
- **Actual:** No further periods run. After a turn end from 42% to 91%, the band still draws ' 42%▲' and '84.0k' 8 s later, because tweenStep is stuck. Highlights never fade and Clawd freezes. The model and effort polls and the null-snap retry stop until the module reloads.
- **Suggested fix:** Have onTick record the last tick time. In startTicker, if a ticker exists but no tick has landed for well over one period, cancel and re-arm it.

### `refused-after-skips-startover`: A refused session.end clock.after leaves /clear and /resume with the old conversation's numbers

- **Where:** `hooks/register.tsx:1083`; confidence likely
- **Scenario:** The d.ts says of $.clock.after: 'fn runs when it resolves, and never when a hook refuses it'. A plugin that hooks clock.after denies the 300 ms wait set on session.end 'clear'. The try/catch only catches a synchronous throw. snap is not null, so the ticker's null-snap retry does not fire either.
- **Expected:** The meter starts over. Spec section 6's fallback: start over on the first prompt.submit after a clear.
- **Actual:** startOver never runs. The next turn end is measured against the old conversation: 'last turn −125.0k', ▼, and a trend across conversations.
- **Suggested fix:** Set a module flag (pendingStartOver) in session.end. Have prompt.submit, the turn.step live reading or onTick run startOver while it is set, and clear it inside startOver.

### `ticker-100ms-all-session`: The ticker runs at 100 ms for the whole session, though outside a count-up 6 of every 7 periods do nothing

- **Where:** `hooks/register.tsx:921`; confidence certain
- **Scenario:** Any session, idle or working, with no count-up running (countStep === TWEEN_STEPS). $.clock.every(TWEEN_MS) is never slowed down. Each period is its own clock.every dispatch through the host and through every plugin's clock.every hooks.
- **Expected:** Periods at TICK_MS (700 ms) for frames and polls, and 100 ms only during a 6 s count-up. This is separate from the left-out slower deep-sleep frames: the frames stay at 0.7 s.
- **Actual:** 600 dispatches a minute (about 36,000 an hour), of which about 515 a minute only do subtick++.
- **Suggested fix:** Run the ticker at TICK_MS. Have startCountUp start a separate $.clock.every(TWEEN_MS) that cancels itself when countStep reaches TWEEN_STEPS (session.start's landing cancels it too). Keep the polls on every 2nd 700 ms tick.

### `turn-end-replaces-live-highlight`: The turn-end reading right after the last live reading wipes that reading's highlight and runs an empty 6 s count-up

- **Where:** `hooks/register.tsx:826`; confidence certain
- **Scenario:** The context is at 84k. The turn's last request gives a live reading of 120k, with changed = tokens, headroom and percent (▲, a new bar segment, a count-up from 84k). Milliseconds later the turn-end measure reads the same 120k. changedKeys returns nothing and toSnapshot adds only 'delta', so next.changed = ['delta'] replaces the list, and startCountUp restarts. from.delta = old.tokens − old.turnBase = 36k, which equals lastDelta.
- **Expected:** '120.0k' and ' 60%▲' with the new bar segment stay highlighted for about 10 s, alongside 'last turn +36.0k'. No count-up runs where nothing moves.
- **Actual:** 0.7 s after the turn end: ' 60% ' with no ▲, '120.0k' dim and no new segment. The tokens and percent count-up snaps to its end. Then 61 tweenStep writes and about 60 redraws follow over 6 s, all with identical text. This happens at nearly every turn end that grew.
- **Suggested fix:** While the previous change is still fresh (tick − changedTick < HIGHLIGHT_TICKS), merge its keys, from and prevPercent into the new reading instead of replacing them. Start a count-up only when some changed key's from differs from its new value: leave such keys out in fromValues and call startCountUp only when next.from gained one.

### `countup-jumps-from-target`: A newer reading restarts the count-up from the previous target, not from the value on screen, so numbers jump

- **Where:** `hooks/register.tsx:841`; confidence certain
- **Scenario:** During a turn, request 1 moves 84k → 120k and the count-up starts. Two seconds later, with 109.3k on screen, request 2 lands at 130k. fromValues takes old.tokens (120k, the previous target) as the start. Percent, headroom, usd, the limits and the bar work the same way. At the turn end, from.delta is the previous target, not the 'this turn' figure on screen.
- **Expected:** The number counts on from what is drawn (109.3k → 130k), as README:54 says: a changed number 'does not jump to its new value'.
- **Actual:** The figure jumps from 109.3k to 120.0k in one tick, then counts to 130k. The bar and 'this turn' jump with it. A mid-count 'this turn +20k' becomes 'last turn +36.0k' at once.
- **Suggested fix:** Pass the current tweenStep into toSnapshot. In fromValues, for a key still counting (in old.changed, with step < TWEEN_STEPS), start from tween(old.from[key], oldValue, step); for 'delta', start from the 'this turn' figure on screen. Or soften README:54.

### `limit-highlight-subpercent`: A rate limit that moved by a tenth is highlighted and counted, though the drawn whole percent is unchanged

- **Where:** `hooks/register.tsx:759`; confidence certain
- **Scenario:** Subscription account. The engine reports percentUsed to a tenth, and a reading sees five_hour go from 23.1 to 23.3. changedKeys compares the raw values, while row 3 draws Math.round.
- **Expected:** No highlight unless the drawn percent changes, the way usd is compared in cents at line 756.
- **Actual:** '5h 23%' is drawn bold in the highlight colour for about 10 s and a count-up starts, after almost every request.
- **Suggested fix:** Compare Math.round(before.percentUsed) !== Math.round(l.percentUsed).

### `turnbase-unseeded-first-turn`: turnBase is only seeded by a fresh reading with tokens or by a turn end, so the first turn shows no 'this turn' and no 'last turn'

- **Where:** `hooks/register.tsx:788`; confidence certain
- **Scenario:** (a) A new session, or the moment after /clear: the fresh reading has no tokens, so turnBase is undefined. Live readings copy previous.turnBase, and the first turn end sets lastDelta to undefined. (b) A 0.3.0 snapshot survives a reload into this build. It has no turnBase, and session.start's refresh keeps previous.turnBase, which is undefined.
- **Expected:** 'this turn +X' while Claude works and 'last turn +X' after the turn (README:44, CHANGELOG).
- **Actual:** Nothing shows in that slot during the first turn, and nothing after it. It heals one turn later, so it repeats at every session start and every /clear.
- **Suggested fix:** In toSnapshot, when turnBase and compaction are both undefined and a reading that is not a turn end brings tokens, set turnBase = tokens. Leave the post-compaction case (compaction set) as it is.

### `ontick-subtick-after-await`: onTick tests the shared subtick after awaiting, so slow writes double or skip frames and can skip the 1.4 s poll entirely

- **Where:** `hooks/register.tsx:942`; confidence certain
- **Scenario:** The ticker fires `void onTick($)` every 100 ms without waiting for the previous tick. onTick increments subtick, awaits the tweenStep or frame write, and only then tests subtick % SUBTICKS and subtick % (SUBTICKS*2). With writes of 100 ms or more (host busy in a heavy turn), later ticks have already moved subtick. Reproduced: 150 ms tweenStep writes gave 15 frame writes in 7 s instead of 10. 120 ms frame writes gave 0 model polls in 14 s instead of 10, because the poll tick is also a frame tick and always reads subtick+1.
- **Expected:** One frame every 0.7 s, and the polls and retry every 1.4 s, whatever the write latency.
- **Actual:** Clawd blinks and types faster. He falls asleep early and highlights fade early, because both are counted in frames. pollSavedEffort, refreshModel and the null-snap retry stop while writes are slow.
- **Suggested fix:** Use `const n = ++subtick` at the top of onTick and test n in both checks. Optionally, skip a poll while the previous one is still in flight.

### `countup-step-race`: A count-up can flash its end value or a stale step: an in-flight tick write lands after startCountUp's reset, and snap and tweenStep are written separately

- **Where:** `hooks/register.tsx:978`; confidence certain
- **Scenario:** (a) A count-up is at step 31 and a tick's update(tweenStep, () => 31) is in flight when a new reading's startCountUp writes 0. The tick's ifVersion misses, update reruns `() => 31`, and 31 lands after the 0 (observed landing order [0,1,31,31,2,3,4]). (b) refresh writes the new snap (line 885) before startCountUp resets tweenStep (line 978). A frame drawn between the two writes uses the old step, which is 60 once the last count-up has finished.
- **Expected:** Each change counts from its old value to the new one.
- **Actual:** (a) The band shows 60%, jumps to '87%▲ 175.0k', falls back to '63%▲ 126.0k' and counts up again. (b) It draws '91%▲ 182.0k', then '42%▲ 84.0k' after the reset. Readings arrive every few seconds during a turn, so this flicker shows up regularly.
- **Suggested fix:** Tie the step to its change. Store tweenStep as { tick, step }, where tick is the snapshot's changedTick. Ticks write with `v => v.tick === tickNow ? { tick: tickNow, step } : v`. The render uses step only when tweenStep.tick === s.changedTick, and 0 otherwise.

### `refreshmodel-clears-noted-no-effort`: refreshModel clears '– no effort' after the new model's first request has already set it

- **Where:** `hooks/register.tsx:715`; confidence likely
- **Scenario:** The model switches where no hook sees it: a plan-mode switch, or a typed /model the command.run hook did not see in a live session. The new model's first request (no effort) runs before the 1.4 s poll, and noteEffort sets {level: undefined, isUnsupported: true}. The poll's refreshModel then sees a label change against the stale model atom and clears isUnsupported unconditionally. pollSavedEffort then writes nothing (the saved level equals lastSaved) or writes a saved level. Reproduced for Opus → Haiku.
- **Expected:** '– no effort' stays, because the new model's own request established it.
- **Actual:** 'effort ?', or the saved level with its outfit, on a model that takes no effort, until the next request.
- **Suggested fix:** Record which model the effort was noted for: noteEffort stores e.model from TurnStepInput (e.g. effort.notedFor). refreshModel clears isUnsupported, and lets pollSavedEffort write, only when modelLabel(notedFor) !== modelLabel(name). Optionally, also update the model atom from the main turn.step's e.model.

### `reload-poll-overrides-no-effort`: After a reload or worker respawn on a model without effort, the first saved-effort poll replaces '– no effort' with the saved level

- **Where:** `hooks/register.tsx:587`; confidence certain
- **Scenario:** On Haiku, the effort in $.state is {level: undefined, isUnsupported: true}. The module reloads: $.state survives, but the module variable lastSaved resets to undefined. session.start runs pollSavedEffort. isFirst is true and old.level is undefined, so the guard does not hold and it writes {level: 'high', isUnsupported: false}.
- **Expected:** The first poll after a reload fills in only an unknown level and keeps an established '– no effort', as refreshEffort already does.
- **Actual:** '● high' with the cap-and-bottles outfit on a model that takes no effort, until the next request.
- **Suggested fix:** `isFirst && (old.level !== undefined || old.isUnsupported) ? old : { ...old, level, isUnsupported: false }`, or keep lastSaved in $.state.

### `waiting-text-clipped`: 'waiting for the first reply' is budgeted as the 23-cell token text and is cut to 'waiting for the first rep'

- **Where:** `hooks/register.tsx:1218`; confidence likely
- **Since then:** Probably fixed in 0.3.1: the meter row now leaves "waiting for the first reply" out whole where it lacks room.
- **Scenario:** A fresh session or a /clear, before the first reply (tokens and compaction undefined), at bodyColumns 100–126 with the default badges. The width arithmetic budgets 23 cells after the percent box, but this Text is 27 cells.
- **Expected:** The whole phrase.
- **Actual:** '0%    waiting for the first rep' at every bodyColumns from 72 to about 126. In the one-line layout it is cut below 52 + the pickers' width. This shows on every new session and every /clear.
- **Suggested fix:** Subtract 4 more from width while neither tokens nor compactedTo is known, or shorten the text to 23 cells or fewer (e.g. 'awaiting first reply').

### `categories-row-wraps`: The details categories Text wraps onto 2–4 rows while fullRows counts it as one

- **Where:** `hooks/register.tsx:1439`; confidence likely
- **Scenario:** 'details' is pressed with five categories (about 95 cells) and the effort is low. The Text uses the default wrap, so it takes 2 lines at bodyColumns 100–139 and 4 at 72. fullRows counts it as 1 row, so in a fullscreen slot with maxRows 6 the full band is chosen and then scrolls.
- **Expected:** One categories row, as fullRows assumes.
- **Actual:** The band grows 1–3 rows past its budget, and the wrapped tail and the bottom border scroll out of view.
- **Suggested fix:** Draw it through row('categories', …) with the group-dropping fix, or give the Text wrap="truncate-end".

### `unbounded-model-label`: An unrecognised model name is drawn raw and unbounded, crowding the meter out

- **Where:** `hooks/register.tsx:683`; confidence likely
- **Since then:** 0.3.1 measures the pickers, so a long label now takes room from the meter row instead of drawing over it; the label itself is still unbounded.
- **Scenario:** ANTHROPIC_MODEL is a Bedrock application-inference-profile ARN, 78 characters long. modelFamily finds no family, so modelLabel returns the whole ARN, and the model Button is flexShrink 0.
- **Expected:** A bounded label, so the meter keeps its room.
- **Actual:** In the full layout at bodyColumns 72–110, no meter is drawn at all and the effort badge is pushed past the right border. The one-line layout shows only the ARN.
- **Suggested fix:** Bound the fallback in modelLabel: take the last ':' or '/' segment, capped at about 18 cells with '…'. Also count the real pickers width in the layout decision (see meter-row-clipped-narrow).

### `unknown-percent-zero`: An unknown fill is drawn as a bold '0%'

- **Where:** `hooks/register.tsx:1148`; confidence certain
- **Scenario:** A fresh session, or the moment after /clear, before the first reply: percent and tokens are undefined and there is no compaction, so fillPercent falls back to 0.
- **Expected:** A placeholder (a dim ' –%') and an empty bar. The engine documents the percent as absent until the first response, and the context already holds the system prompt, tools and memory files.
- **Actual:** 'Context ░░░░░░░░┊░ 0%' in the bold fill colour, which states an empty context.
- **Suggested fix:** Leave fillPercent undefined when neither s.percent nor compactedTo is known, and draw ' –%' dim with an all-empty bar.

### `saved-level-overrides-session-effort`: The saved-effort poll overwrites a session-level effort that Claude Code keeps, after /model or when another window saves

- **Where:** `hooks/register.tsx:717`; confidence likely
- **Scenario:** (a) Any /effort this session sets Claude Code's sessionEffort, and /model does not reset it. Pick max on Opus with modelSettings {sonnet: low}, then run /model sonnet. refreshModel calls pollSavedEffort, which sees 'low' ≠ lastSaved and writes it, while requests carry max. (b) Two windows share ~/.claude/settings.json. Window B picks a session-only MAX. Window A saves 'medium' in the /effort panel. B's poll sees the saved value move high → medium and shows '○ medium'.
- **Expected:** While a session-level effort is in force, the badge keeps it (clamped by the model).
- **Actual:** The new model's saved level, or the other window's, until the next request corrects it.
- **Suggested fix:** Record where the shown level came from: a request, a pick, a typed /effort, or settings. Apply a moved saved value, in the poll and in refreshModel, only when the current level came from settings or is unknown.

### `effort-unknown-after-switch-back`: Switching back from a model without effort leaves the badge at 'effort ?' until the next request

- **Where:** `hooks/register.tsx:582`; confidence certain
- **Scenario:** The saved effortLevel is 'high'. On Opus the badge reads '● high' and lastSaved is 'high'. After /model haiku, its request carries no effort, so noteEffort sets the level to undefined and isUnsupported to true. After /model opus, refreshModel clears isUnsupported, then pollSavedEffort returns early because 'high' === lastSaved. The effort is now {level: undefined}. The existing test only checks that 'no effort' is gone.
- **Expected:** '● high ▾' and the cap-and-bottles outfit at once.
- **Actual:** 'effort ? ▾' and a bare Clawd until the first request on Opus.
- **Suggested fix:** On a switch, apply the saved level whenever the current level is undefined, even if it equals lastSaved (subject to saved-level-overrides-session-effort). Or have noteEffort keep `level` and set only isUnsupported when a request carries none; effortBadge already checks isUnsupported first, and outfitFor would then have to as well.

### `legacy-top-level-effort`: The top-level user effortLevel is shown for models where Claude Code ignores it

- **Where:** `hooks/register.tsx:566`; confidence likely
- **Scenario:** 2.1.300 (VAr in the binary) resolves effort as byModel[iG(model)] ?? default ?? (cvo(model) ? legacyUserEffort : undefined). default is a top-level effortLevel from a non-user source. A top-level effortLevel in user settings becomes legacyUserEffort, which applies only to a legacy model list, not to claude-opus-5-5 or claude-sonnet-5-5. With ~/.claude/settings.json {"effortLevel":"low"} left over from an older version and no modelSettings entry, Opus 5.5 runs at its default.
- **Expected:** No saved level is shown where a top-level user effortLevel does not apply.
- **Actual:** '· low' at session start (when /config gives no level), after each switch to such a model, and after a saved '/effort auto', until the next request. The test 'the badge shows the new model's saved effort' pins this fallback.
- **Suggested fix:** Read the top-level effortLevel only from non-user sources ($.settings.read({ source }) per source), or from user settings only for the legacy model list. Update that test.

### `lastsaved-not-cleared`: pollSavedEffort keeps lastSaved when the saved level is removed, so saving the same level again goes unseen

- **Where:** `hooks/register.tsx:582`; confidence certain
- **Scenario:** The saved level is high (lastSaved 'high'). A saved '/effort auto' deletes the per-model entry, so savedEffort returns undefined, and the early return leaves lastSaved at 'high'. The next request carries the model default (xhigh). The person then picks high again in Claude Code's /effort panel. The saved 'high' equals the stale lastSaved and is ignored.
- **Expected:** The badge shows high within 1.4 s.
- **Actual:** The badge stays at xhigh until the next request.
- **Suggested fix:** Update lastSaved when the saved value becomes undefined too, and keep the early return only for the state write.

### `model-output-effort-ignored`: The effort a /model pick carries is never read

- **Where:** `hooks/register.tsx:1011`; confidence likely
- **Scenario:** Claude Code's own /model picker can set an effort along with the model. It prints "Set model to `Opus 5.5` … · `max` effort for this session only" or "… with `high` effort" and sets sessionEffort. The command.run 'model' hook only calls refreshModel, and a session-only max is saved nowhere the poll could see it.
- **Expected:** The badge shows max.
- **Actual:** The old level, or after a model change the saved level, until the next request.
- **Suggested fix:** In the model hook and in pickModel, parse /(?:with|·) `(\w+)` effort/ from result.text and apply it after refreshModel.

### `outfit-ignores-unsupported`: A level set on a model without effort puts the outfit on while the badge says '– no effort'

- **Where:** `hooks/register.tsx:60`; confidence certain
- **Scenario:** On Haiku (isUnsupported), the person picks or types /effort max. applyEffortOutput, the pickEffort fallback and prompt.submit all merge {level: 'max'} and leave isUnsupported true. effortBadge checks isUnsupported first, but outfitFor ignores it.
- **Expected:** The badge and Clawd agree.
- **Actual:** '– no effort' beside the top hat (or the cap and bottles for high) until the next request. The taller Clawd also raises fullRows, which can flip a short slot to the one-line meter.
- **Suggested fix:** Return 'none' from outfitFor when e.isUnsupported && !e.isUltra, or share one rule with effortBadge. Add a test.

### `same-value-writes-redraw`: update() always writes, so updaters that return the old value still bump the version and redraw the band

- **Where:** `hooks/register.tsx:712`; confidence certain
- **Scenario:** Per the d.ts, update() reads, applies `change`, then writes. (1) An idle session with an unchanged model: refreshModel writes `model` every 1.4 s, 42 times a minute. (2) noteEffort returns `old` but still writes on every main request. (3) markActive writes awakeTick on every request, subagents' included (50 writes for 50 subagent requests in 2.5 s), even while Clawd is awake and far from the sleep threshold. The trend update behaves the same way. A probe shows that same-value writes trigger re-renders.
- **Expected:** No write, and no redraw, when the value is unchanged. The identity returns in the code show this was the intent.
- **Actual:** Dozens of extra writes and band re-renders a minute when idle, and more during agentic turns.
- **Suggested fix:** Add a helper that reads with $.state.get, compares (=== or a shallow equal for effort), and calls $.state.set(ref, next, { ifVersion }) only on a change, retrying on a miss. Use it in refreshModel, noteEffort, markActive and the trend write. In markActive, also skip the write while frame − awakeTick is under about 14 ticks.

### `duplicate-first-reading`: A slow first reading is taken again and again, because the ticker retries while session.start's own reading is still in flight

- **Where:** `hooks/register.tsx:945`; confidence certain
- **Scenario:** The first session (snap null), or after startOver nulled the snapshot. session.start starts the ticker and awaits refresh() with a summary breakdown. If usage() takes more than 1.4 s (say, a long --resume transcript), onTick sees snap === null and starts refresh({isFresh: true}), another summary estimate, and starts one more every 1.4 s until the first lands. A probe with a 2 s usage() saw two summary reads. The late retry then overwrites the first fresh reading. The retry also asks for a breakdown every 1.4 s while no session is bound.
- **Expected:** One reading at start, and a retry only after a reading failed.
- **Actual:** Duplicate breakdown estimates, more of them the slower the first one is.
- **Suggested fix:** Keep a module in-flight flag (or promise) set by refresh and startOver. onTick retries only when snap is null and no reading is in flight. The retry can use breakdown: false.

### `live-readings-restart-countup`: Every main-loop request restarts the 6 s count-up, so the band redraws about 10 times a second for a whole agentic turn

- **Where:** `hooks/register.tsx:893`; confidence certain
- **Scenario:** A tool loop with a main request every ~3 s, each adding ~3k. Each live reading changes the tokens, so refresh calls startCountUp, and onTick writes tweenStep every 100 ms. The next request arrives before the count-up lands, so it never ends while the turn runs.
- **Expected:** Redraws at about the frame rate, except while a count-up worth animating runs.
- **Actual:** A probe over 60 s with 20 requests saw 620 tweenStep writes and about 620 renders (85 when idle), plus about 7,200 state.get calls. About half of those renders drew the same text as the one before. On Desktop each render is an ~11.5 KB tree, 5.4–7.6 KB of it the Clawd Svg.
- **Suggested fix:** For live readings (opts.stepTokens), use a short count-up of about 10 steps, or retarget a running count-up instead of resetting countStep to 0 (see countup-jumps-from-target). Write tweenStep only when the rounded figures it drives change, and use $.state.set for the blind writes.

### `polls-run-while-asleep`: The saved-effort and model polls run every 1.4 s while Clawd is asleep, copying the merged settings each time

- **Where:** `hooks/register.tsx:943`; confidence likely
- **Scenario:** A session left idle (overnight, over lunch). onTick still runs pollSavedEffort ($.settings.read) and refreshModel ($.session.model plus a model write) every 14 subticks. A typed /effort or /model is a prompt.submit, which wakes Clawd first, so while he sleeps only an edit made outside the session can be missed. This is distinct from the left-out slower frames: the frames and the typing stay as they are.
- **Expected:** The polls slow down while Clawd is asleep.
- **Actual:** 43 settings.read calls (each the whole merged settings object), 43 session.model calls and 42 model writes a minute: about 20k polls per 8 hours.
- **Suggested fix:** Poll every 1.4 s while awake and about every 10 s while asleep (frame − awakeTick ≥ SLEEP_AFTER_TICKS). Also update the model atom from the main turn.step's e.model and from the command.run 'model' hook, so the poll is only a fallback.

### `untested-fixed-branches`: Many of the batch's fixed branches have no test that fails when they break: each mutation below passes the whole suite

- **Where:** `tests/meter.test.ts:714`; confidence certain
- **Scenario:** Each of these mutations passes all tests. (1) Dropping session.compact's agentId, precompute or skip filters (register.tsx:1097): a subagent or precompute compaction would show 'compacted' and clear turnBase. (2) Making prompt.submit's typed-/effort update a no-op (1051). (3) Setting `carried` to undefined in toSnapshot: live readings would wipe compactAt, isAutoCompact and the categories. (4) Dropping compactFraction or the compact-point colour from the band (1152, 1179). (5) Removing the trend reset in startOver (961): the /clear tests never draw a trend. (6) Replacing the null-snap retry (945). (7) `const isFresh = true`: the highlight never fades (1174). (8) `breakdown: false` at the turn-end measure (1021). (9) Never drawing the categories row (1438). (10) Removing `&& over === undefined`: the auto-compact segment would show beside the over-window warning. (11) A /config row regex that never matches: config.list is always answered empty. (12) Deleting the hasSurvey hand-over (1113). (13) Removing refreshModel from the command.run 'model' hook (1011): the picker test passes through pickModel. (14) Removing `.slice(-TREND_KEEP)` (896). (15) Dropping pickModel's kept-the-asked-model guard (734).
- **Expected:** Each fixed behaviour has a test that fails when it breaks.
- **Actual:** Each of these regressions would ship unnoticed.
- **Suggested fix:** Add the auditors' probes as tests, the batch's fixes first: compact filters (agentId 'agent-1', trigger 'precompute', a {skip} result, each giving no /compacted/); a typed '/effort max' through $.prompt.submit giving ' ▲ MAX '; a breakdown reading then request($,'high') still showing /auto-compact at 167\.0k/ and /^┊$/; turns on both sides of /clear giving /trend ▁█ 13→15%/; usage throwing then succeeding, with the band back within 1.5 s; the highlight gone after about 11 s; a turn-end breakdown change reaching the band; config.list with an effort row giving '● high'; hasSurvey true giving the engine's band; $.command.run model with no clock advance giving the new window; 20 turn ends leaving a trend of 16; a details press showing the categories biggest first.

### `clear-test-arrow-vacuous`: The /clear test's ▼ assertion cannot fail

- **Where:** `tests/meter.test.ts:807`; confidence certain
- **Scenario:** After the clear, the test's usage has no tokens or percent, so the start-over reading's percent is undefined. The arrow is drawn only when prevPercent !== undefined, so no ▼ can appear even if startOver read non-fresh. With `const previous = old` in refresh, only the 'last turn' assertion catches the regression.
- **Expected:** Each assertion can catch the regression it is written for.
- **Actual:** The ▼ assertion passes whatever startOver does.
- **Suggested fix:** Give the post-clear reading tokens (e.g. 5k, 3%) and follow it with a lower turn end, or assert the trend content instead.

### `readme-update-needs-reload`: README says /plugin update is enough, but a running session needs /reload-plugins or a restart

- **Where:** `README.md:22`; confidence certain
- **Scenario:** A user follows README:22, or the release note at README:176, and runs /plugin update context-meter in an open session.
- **Expected:** The new version is active after the update.
- **Actual:** `claude plugin update --help` on 2.1.300 says '(restart required to apply)', and reference.md says a new version reaches a session through the update and then /reload-plugins. The session keeps drawing the old meter.
- **Suggested fix:** At README:22 and :176, add 'then /reload-plugins (or restart Claude Code)'.

## Trivial (10)


### `prompt-submit-awaits-state`: prompt.submit awaits state round trips before the prompt goes on

- **Where:** `hooks/register.tsx:1045`; confidence certain
- **Scenario:** Every submitted prompt. The hook awaits markActive (a get of frame, then a get and ifVersion set of awakeTick) and, for a typed /effort, an effort update, all before next(e). Fix 15 removed such waits from turn.step but not from this hook.
- **Expected:** Nothing awaited before next(e).
- **Actual:** Each prompt waits on 2–4 host state round trips, more on version misses.
- **Suggested fix:** `const noted = Promise.all([markActive($), asked ? update(...).catch(() => {}) : undefined]); const r = await next(e); await noted; return r`.

### `effort-med-alias`: A typed '/effort med' is not read

- **Where:** `hooks/register.tsx:636`; confidence certain
- **Scenario:** Claude Code accepts 'med' as an alias for medium (le = {med:'medium'} in the binary). parseEffortArgs knows only the five full names, so prompt.submit applies nothing.
- **Expected:** '○ medium'.
- **Actual:** The old level until the next request.
- **Suggested fix:** Map 'med' to 'medium' before the includes() check.

### `ultracode-hat-assertion-vacuous`: The picker test's 'ultracode puts the hat on' check cannot fail, because max already wears the hat

- **Where:** `tests/meter.test.ts:359`; confidence certain
- **Scenario:** Delete `if (e.isUltra) return 'top-hat'` from outfitFor: the picker test still passes, and only the outfit unit test fails. The /▄▄█████▄▄/ check runs while the level is max, which maps to the top hat anyway.
- **Expected:** The UI check catches ultracode losing its hat.
- **Actual:** It passes whatever ultracode does to the outfit.
- **Suggested fix:** Turn ultracode on at a lower level (pick low first) before asserting the hat.

### `request-helper-result-undefined`: The tests' request() helper returns stream.result, which the kit's stream does not have

- **Where:** `tests/meter.test.ts:114`; confidence certain
- **Scenario:** A probe shows that 'result' in the stream from $.turn.step is false. So `return stream.result` here, and `await stream.result` at line 758, resolve to undefined at once; the step's result is the drained generator's return value. A future `(await request($)).usage` would crash, or wrongly assume the hook's work was awaited. Spec section 2 states the kit has stream.result.
- **Expected:** The helper returns the step's result.
- **Actual:** It always returns undefined.
- **Suggested fix:** Drain with `while (true) { const n = await stream.next(); if (n.done) return n.value }`, and correct spec section 2.

### `ultracode-budget-uppercase`: Ultracode with a numeric effort budget draws '32.0K BUDGET'

- **Where:** `hooks/register.tsx:494`; confidence certain
- **Scenario:** A main request carries effort 32000 with ultracode on. effortBadge uppercases the formatted budget along with the level.
- **Expected:** ' ✦ ULTRACODE · 32.0k budget ', with the lowercase k used everywhere else.
- **Actual:** ' ✦ ULTRACODE · 32.0K BUDGET '.
- **Suggested fix:** Uppercase only a string level, and add a unit expectation for { level: 32_000, isUltra: true }.

### `asleep-through-readings`: Clawd stays asleep through new readings and picker presses, though README says a new reading wakes him

- **Where:** `hooks/register.tsx:708`; confidence certain
- **Scenario:** The session has been idle for more than 3 minutes and Clawd is asleep. The person picks sonnet from the model badge, or the poll catches a model switch, or a compaction or start-over reading lands. The band redraws ('window 1.00M → 200.0k', 'compacted 182.0k → 31.0k') with the legs row and zZzZ still drawn.
- **Expected:** README:116: 'A prompt, a model request or a new reading wakes him'.
- **Actual:** Only session.start, session.measure, turn.step and prompt.submit call markActive. refreshModel, session.compact, startOver, the retry and the picker presses do not.
- **Suggested fix:** Call markActive in refreshModel on a label change, in the session.compact hook, in startOver, and in pickModel and pickEffort. Or reword README:116.

### `spacebar-lit-twice`: The spacebar stays lit for two typing frames in a row, against 'a different key each frame'

- **Where:** `hooks/register.tsx:330`; confidence certain
- **Scenario:** Clawd is typing. keysLeft[4] and keysRight[4] are both the spacebar [0,3,8], and pick = floor(t/2)*7+3 is the same for frames t and t+1. At t = 10k+6 and 10k+7, both hands pick index 4.
- **Expected:** README:104 and the CHANGELOG: a different key lights up each frame.
- **Actual:** The spacebar stays lit for 1.4 s once every 7 s.
- **Suggested fix:** Offset the right hand's pick (e.g. +1), or drop the spacebar from one hand's list.

### `readme-72-columns`: README's '72 terminal columns' cut-off is really 72 band columns, about 77 terminal columns

- **Where:** `README.md:57`; confidence certain
- **Since then:** The README line was reworded in 0.3.1 ("Below 72 columns"); check whether it is clear now.
- **Scenario:** A 75-column terminal with no docked pane.
- **Expected:** README:57: the one-line meter only below 72 terminal columns, so the full band at 75.
- **Actual:** The layout tests e.props.bodyColumns, which is the column's width less the engine's five cells for the [-] mark, and only the transcript's width beside a docked pane. At 75 terminal columns bodyColumns is 70, so the one-line meter is drawn.
- **Suggested fix:** Reword to 'below 72 columns of band width (about 77 terminal columns, fewer beside a docked pane)'.

### `docs-status-drift`: The spec's status and row-2 order, and the CHANGELOG's release date, do not match the branch

- **Where:** `docs/superpowers/specs/2026-10-15-audit-and-next-steps.md:7`; confidence certain
- **Since then:** The spec's section 1 still says "TDD red".
- **Scenario:** handoff.md sends readers to the spec. Spec section 1 says the batch does not bump the version and is at TDD red with 35 tests, but the branch is 0.3.1 with all tests passing. Spec line 87 puts 'compacted …' before 'this turn', but the code draws 'this turn' first; only handoff.md records that change. CHANGELOG.md:3 reads '## 0.3.1 — 2026-10-15' for a version that is neither tagged nor merged, while CLAUDE.md:77 says changes collect under '## Unreleased' until a release.
- **Expected:** The docs describe the code and the branch as they are.
- **Actual:** A stale status and row order, and a release date that may be wrong on release day.
- **Suggested fix:** Mark spec section 1 as historical (or update it) and fix line 87's order. Use '## 0.3.1 — Unreleased' until the tag, or update CLAUDE.md:77.

### `claude-md-gating-list`: CLAUDE.md names command.run and session.compact as the gating hooks, but validate also flags prompt.submit, which has no .catch

- **Where:** `CLAUDE.md:50`; confidence certain
- **Scenario:** `claude plugin validate context-meter` reports 'gating hook without .catch: prompt.submit' (register.tsx:1043). The hook's body is defensive, and a failed hook is skipped with the prompt passing, so there is no run-time effect today; the rule as written is incomplete.
- **Expected:** The documented rule matches what validate checks.
- **Actual:** prompt.submit is a gating hook with no .catch and is missing from CLAUDE.md's list.
- **Suggested fix:** Add prompt.submit to the list, and give it `.catch(($, e, next) => next(e))` or note why it needs none.
