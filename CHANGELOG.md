# Changelog

## 0.3.1 — 2026-10-15

- The meter moves during a turn: each model request updates the fill, and row 2 shows `this turn +12.0k` while Claude works. `last turn` is now the whole turn's growth.
- A model switch redraws the meter at once: the new window, auto-compact point and headroom, with a `window 1.00M → 200.0k` note instead of a `▲` and a count-up. The badge takes the new model's saved effort.
- A context bigger than the window (after a switch to a smaller model) says what happens next: `! 150.0k over the 200.0k window: next send compacts`, or `/compact before sending` with auto-compaction off. The tokens turn red, in the one-line meter too.
- The trend keeps tokens, so a smaller window no longer draws a fake spike; its percents are of the window shown now.
- `/clear` and `/resume` start the meter over: no `last turn −125.0k`, no `▼` and no trend across conversations. Clawd keeps animating after `/resume`.
- `/compact` redraws at once: `~31.0k / 200.0k tokens` until the next reply, and `compacted 182.0k → 31.0k` in row 2.
- A model that takes no effort shows `– no effort` instead of the last model's level and outfit.
- A short band slot (fullscreen, a low terminal) gets the one-line meter instead of a band that scrolls and cuts Clawd.
- The session clock runs between readings, and counts days: `1d 2h`.
- The bar turns `warning` and `error` as the fill nears the auto-compact point, not at fixed percents of the window.
- Model names: `Opus 4` for dated ids, `Haiku 3.5` for older ids, `Opus 5.5 · 1M` for the 1M-context variant.
- The saved effort is looked up for the current model, by id or by its shown name.
- When Claude Code keeps the model, the toast no longer advises typing `/model`, which answers the same: `Claude Code kept Opus 5.5: /model sonnet did not switch`.
- A reload during a count-up lands the numbers instead of freezing them midway.
- Less work per turn: the breakdown is read only when the fill moved, `/config` only until the effort is known, and nothing is awaited before a request is sent.
- Claude Code Desktop: Clawd is drawn as a picture, so his rows no longer split or shift. The band's text uses the monospaced face, so the bar, numbers and columns line up as in the terminal. The terminal is unchanged.

## 0.3.0 — 2026-10-14

- **Model picker:** a `◇ Opus 5.5 ▾` badge left of the effort badge. Click it for a vertical picker like the effort one: smaller models above (`haiku`, `sonnet`), larger below (`opus`, `fable`). A pick runs `/model <alias>`. The badge follows the model however it changes. The model moved out of row 3 into the badge.
- When Claude Code keeps the model back (it wants to confirm a switch mid-conversation, which a plugin cannot show), a toast says which `/model` to type.
- Only one picker is open at a time.
- Fix: ultracode stays on when a level is picked or typed while it is on, as Claude Code keeps it (badge `✦ ULTRACODE · <LEVEL>`, magician's hat). Only `✦ ultracode off` / `/effort ultracode off` turns it off. A newly saved level no longer clears it either.
- The picker places the badge by level even with ultracode on; the ultracode switch is always the last option.
- The keyboard has keycaps: two rows on a dark gray case (key, spacebar, key on top; six keys below). While Clawd types, keys under the hand that is down light up blue, a different one each frame.
- Asleep, Clawd leaves the keyboard: his legs show again in its place. He keeps his outfit, and zZzZ rises from the top of his head or hat.

## 0.2.2 — 2026-10-14

- Clawd dresses for the effort level: cap (medium), cap with straw bottles (high), plus glasses (xhigh), a purple magician's hat (max, ultracode).
- Clawd sits behind a keyboard and types while Claude works, instead of trotting.
- Shut eyes (blink, sleep) are thin dark lines instead of disappearing.
- Count-up takes 6 s; the change highlight lasts about 10 s.
- The cap faces front; the bottles sit in holders strapped to it, straws into his face.
- Glasses: round white rims around his eyes. Eyes close inside them when he blinks or sleeps.
- `max` and ultracode now show: a pick from the badge applies even when `/effort` prints nothing readable, and a typed `/effort …` is read from the prompt.
- With ultracode on, the picker offers `✦ ultracode off` (`/effort ultracode off`).

## 0.2.0 — 2026-10-14

- Effort picker opens as a column around the badge: lower levels above, higher ones and ultracode below.
- The badge follows the saved effort (`modelSettings[<model>].effortLevel`, else `effortLevel`), so changes from Claude Code's own `/effort` panel show up too.
- `max` is readable in the picker on dark terminals.
- The **details** toggle moved to the end of row 3.
- Count-up takes 3 s; the change highlight lasts about 7 s.
- Pieces of a row keep their width and the row clips, so numbers never draw over each other.
- Row 2 labels restored: `┊ auto-compact at … (… left) · last turn +… · trend …`.

## 0.1.0

- First version: fill bar, tokens, auto-compact mark, trend, cost, rate limits, effort badge, Clawd.
