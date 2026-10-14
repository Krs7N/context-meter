# Changelog

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
