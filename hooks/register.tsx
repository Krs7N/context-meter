import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Effort, Snapshot } from '../types'

const snap = atom({ plugin: 'context-meter', key: 'snap' } as const, null)
const effort = atom({ plugin: 'context-meter', key: 'effort' } as const, { isUltra: false } as Effort)
const isPickerOpen = atom({ plugin: 'context-meter', key: 'isPickerOpen' } as const, false)
const model = atom({ plugin: 'context-meter', key: 'model' } as const, null as string | null)
const isModelPickerOpen = atom({ plugin: 'context-meter', key: 'isModelPickerOpen' } as const, false)
const tweenStep = atom({ plugin: 'context-meter', key: 'tweenStep' } as const, 0)
const history = atom({ plugin: 'context-meter', key: 'history' } as const, [])
const frame = atom({ plugin: 'context-meter', key: 'frame' } as const, 0)
const awakeTick = atom({ plugin: 'context-meter', key: 'awakeTick' } as const, 0)
const showDetails = atom({ plugin: 'context-meter', key: 'showDetails' } as const, false)

/**
 * Clawd, the Claude Code mascot, as the welcome banner draws him.
 *
 * His rows are 9 cells wide. He sits behind an 11-cell keyboard that hides his
 * legs; his arms are the corner nubs of the body row.
 */
const CLAWD = {
  eyesOpen: ' ▐▛███▜▌ ',
  /** Shut eyes: the eye cells as a thin dark line on orange, so he still has eyes. */
  shutEye: '▁',
  body: '▝▜█████▛▘',
  /** Typing: left arm down, then right arm down. */
  typing: ['▗▜█████▛▘', '▝▜█████▛▖'],
  /** Asleep, away from the keyboard: his four legs, in columns 2, 3, 5 and 6. */
  legs: '  ▘▘ ▝▝  ',
  /**
   * Two rows of keycaps on the case, 11 cells: a key, the spacebar and a key
   * on top; six keys below. Each cap is the upper half of its cell, so the
   * case shows between rows and between keys.
   */
  keyboard: [' ▀ ▀▀▀▀▀ ▀ ', '▀ ▀ ▀ ▀ ▀ ▀'],
  /** The keys under each hand, as [row, first cell, end cell]; the spacebar is under both. */
  keysLeft: [
    [1, 0, 1],
    [1, 2, 3],
    [1, 4, 5],
    [0, 1, 2],
    [0, 3, 8],
  ] as const,
  keysRight: [
    [1, 6, 7],
    [1, 8, 9],
    [1, 10, 11],
    [0, 9, 10],
    [0, 3, 8],
  ] as const,
  /** Asleep: a row above his head where "zZzZ" grows out from its top-left. */
  zzz: ['   z     ', '  Zz     ', ' zZz     ', 'ZzZz     ', '         '],
}

/** What Clawd wears for the effort: each level adds to the last, max and ultracode swap it all for a top hat. */
export type Outfit = 'none' | 'cap' | 'cap-bottles' | 'cap-bottles-glasses' | 'top-hat'

export function outfitFor(e: Effort): Outfit {
  if (e.isUltra) return 'top-hat'
  switch (e.level) {
    case 'medium':
      return 'cap'
    case 'high':
      return 'cap-bottles'
    case 'xhigh':
      return 'cap-bottles-glasses'
    case 'max':
      return 'top-hat'
    default:
      return 'none'
  }
}

export type ClawdPiece = { text: string; color?: string; bg?: string; bold?: boolean }

const PAD = '  '
const CAP_COLOR = 'suggestion'
const BOTTLE_COLOR = 'success'
const STRAW_COLOR = 'text'
const HAT_COLOR = 'merged' // purple in the built-in themes
const BAND_COLOR = 'warning'
const GLASSES_COLOR = 'text' // white rims on a dark theme, so they stand out on his orange face
const KEYBOARD_COLOR = 'subtle' // the case, showing between the keycaps
const KEY_COLOR = 'inactive'
const KEY_LIT_COLOR = 'suggestion'

/**
 * Clawd's rows as colored pieces, 13 cells wide: his 9 plus 2 on each side,
 * where the high-effort bottles hang. The width never changes with the outfit,
 * so the stats beside him stay put.
 */
export function clawdRows(o: { outfit: Outfit; isShut: boolean; typing?: number; zzz?: string }): ClawdPiece[][] {
  const C = 'claude'
  const side = (text: string, color?: string): ClawdPiece => ({ text, color })
  const hasBottles = o.outfit === 'cap-bottles' || o.outfit === 'cap-bottles-glasses'
  const hasCap = o.outfit === 'cap' || hasBottles
  const rows: ClawdPiece[][] = []
  if (o.zzz !== undefined) rows.push([side(PAD), { text: o.zzz, color: 'subtle', bold: true }, side(PAD)])

  if (o.outfit === 'top-hat') {
    rows.push([side(`${PAD}  ▄▄▄▄▄  ${PAD}`, HAT_COLOR)])
    rows.push([side(`${PAD}  █████  ${PAD}`, HAT_COLOR)])
    rows.push([side(`${PAD}  `), { text: '█████', color: BAND_COLOR }, side(`  ${PAD}`)])
    rows.push([side(`${PAD}▄▄█████▄▄${PAD}`, HAT_COLOR)])
  }
  // A cap seen from the front: a small crown on top, then the dome flaring into the brim,
  // as wide as his head. With bottles, each one sits in a holder strapped to the cap's side.
  if (hasCap) {
    rows.push([
      hasBottles ? side(' ▄', BOTTLE_COLOR) : side(PAD),
      { text: '   ▄▄▄   ', color: CAP_COLOR },
      hasBottles ? side('▄ ', BOTTLE_COLOR) : side(PAD),
    ])
    rows.push(
      hasBottles
        ? [
            side(' █', BOTTLE_COLOR),
            { text: '━▟█████▙━', color: CAP_COLOR },
            side('█ ', BOTTLE_COLOR),
          ]
        : [side(PAD), { text: ' ▟█████▙ ', color: CAP_COLOR }, side(PAD)],
    )
  }

  // Straws run from each bottle's bottom down and into his face.
  const left = hasBottles ? side(' ╰', STRAW_COLOR) : side(PAD)
  const right = hasBottles ? side('╯ ', STRAW_COLOR) : side(PAD)
  const inner = (text: string): ClawdPiece => (hasBottles ? side('─', STRAW_COLOR) : side(text))
  if (o.outfit === 'cap-bottles-glasses') {
    // Round white rims around each eye, a bridge between them; the eyes shut inside the rims.
    const rim = (text: string): ClawdPiece => ({ text, color: GLASSES_COLOR, bg: C, bold: true })
    const pupil: ClawdPiece = { text: o.isShut ? '─' : '●', color: 'inverseText', bg: C }
    rows.push([left, inner(' '), rim('('), pupil, rim(')─('), pupil, rim(')'), inner(' '), right])
  } else if (o.isShut) {
    rows.push([
      left,
      inner(' '),
      { text: '▐', color: C },
      { text: CLAWD.shutEye, color: 'inverseText', bg: C },
      { text: '███', color: C },
      { text: CLAWD.shutEye, color: 'inverseText', bg: C },
      { text: '▌', color: C },
      inner(' '),
      right,
    ])
  } else {
    rows.push([left, inner(' '), { text: CLAWD.eyesOpen.trim(), color: C }, inner(' '), right])
  }
  // He sits behind a keyboard. Typing, one arm reaches down at a time and a key under it lights up.
  const t = o.typing
  const body = (t === undefined ? undefined : CLAWD.typing[t % CLAWD.typing.length]) ?? CLAWD.body
  rows.push([side(PAD), { text: body, color: C }, side(PAD)])
  // Asleep he has left the keyboard: his legs show again where it stood.
  if (o.zzz !== undefined) {
    rows.push([side(PAD), { text: CLAWD.legs, color: C }, side(PAD)])
    return rows
  }
  const lit = t === undefined ? undefined : litKey(t)
  CLAWD.keyboard.forEach((line, r) => {
    const cells = [...line]
    const cap = (text: string, isLit = false): ClawdPiece => ({
      text,
      color: isLit ? KEY_LIT_COLOR : KEY_COLOR,
      bg: KEYBOARD_COLOR,
      bold: isLit,
    })
    const pieces =
      lit && lit[0] === r
        ? [
            cap(cells.slice(0, lit[1]).join('')),
            cap(cells.slice(lit[1], lit[2]).join(''), true),
            cap(cells.slice(lit[2]).join('')),
          ].filter(p => p.text !== '')
        : [cap(line)]
    rows.push([side(' '), ...pieces, side(' ')])
  })
  return rows
}

/**
 * The key that lights up on typing frame `t`: one under the arm that is down
 * (left on even frames, right on odd), picked pseudo-randomly from the frame.
 */
export function litKey(t: number): readonly [number, number, number] {
  const keys = t % 2 === 0 ? CLAWD.keysLeft : CLAWD.keysRight
  const pick = Math.floor(t / 2) * 7 + 3 // walks the keys in a jumbled order
  return keys[pick % keys.length] ?? keys[0]
}

const TICK_MS = 700
const BLINK_EVERY = 6 // ticks: a 0.7 s blink about every 4 s
const HISTORY_LEN = 16
const HIGHLIGHT_TICKS = 14 // a changed number stays highlighted about 10 s
const HL_COLOR = 'suggestion'
const TWEEN_STEPS = 60 // a changed number counts up in 60 steps…
const TWEEN_MS = 100 // …of 0.1 s: 6 s in all

/** Ease-out: fast at first, settling onto the new value. */
export function tween(from: number, to: number, step: number): number {
  if (step >= TWEEN_STEPS) return to
  const t = Math.max(0, step) / TWEEN_STEPS
  return from + (to - from) * (1 - (1 - t) ** 3)
}
const SLEEP_AFTER_TICKS = Math.round((3 * 60_000) / TICK_MS) // 3 min without activity

/**
 * Bar color by fill: orange, then `warning` from 60 %, `error` from 80 %. With the
 * auto-compact point known (as a percent of the window), by how near the fill is to
 * it instead: `warning` from three quarters of the way, `error` from 95 %.
 */
export function fillColor(percent: number, compactPercent?: number): string {
  if (compactPercent !== undefined && compactPercent > 0) {
    const ratio = percent / compactPercent
    return ratio >= 0.95 ? 'error' : ratio >= 0.75 ? 'warning' : 'claude'
  }
  return percent >= 80 ? 'error' : percent >= 60 ? 'warning' : 'claude'
}

export type MeterRun = { text: string; kind: 'old' | 'new' | 'empty' | 'mark' }

/**
 * The bar as styled runs: the fill that was there before (`old`), the part
 * the last reading added (`new`), the empty rest, and a `┊` mark where
 * auto-compaction runs.
 */
export function meterRuns(args: {
  percent: number
  prevPercent?: number
  compactFraction?: number
  width: number
}): MeterRun[] {
  const { percent, prevPercent, compactFraction, width } = args
  const { filled, empty } = bar(percent, width)
  const chars = [...filled]
  const oldLen =
    prevPercent !== undefined && prevPercent < percent
      ? Math.min(chars.length, Math.floor((Math.max(0, prevPercent) / 100) * width))
      : chars.length
  const rest = [...empty]
  let mark = -1
  if (compactFraction !== undefined) {
    mark = Math.min(width - 1, Math.floor(compactFraction * width)) - chars.length
    if (mark >= 0 && mark < rest.length) rest[mark] = '┊'
    else mark = -1
  }
  const runs: MeterRun[] = [
    { text: chars.slice(0, oldLen).join(''), kind: 'old' },
    { text: chars.slice(oldLen).join(''), kind: 'new' },
  ]
  if (mark < 0) {
    runs.push({ text: rest.join(''), kind: 'empty' })
  } else {
    runs.push(
      { text: rest.slice(0, mark).join(''), kind: 'empty' },
      { text: '┊', kind: 'mark' },
      { text: rest.slice(mark + 1).join(''), kind: 'empty' },
    )
  }
  return runs.filter(r => r.text.length > 0)
}

type Seg = { text: string; hl?: boolean }

/** Groups joined by ` · `, adjacent plain pieces merged so the row stays few Texts. */
function joinSegs(groups: Seg[][]): Seg[] {
  const out: Seg[] = []
  groups.forEach((g, i) => {
    for (const seg of i > 0 ? [{ text: ' · ' }, ...g] : g) {
      const last = out[out.length - 1]
      if (last && !last.hl && !seg.hl) last.text += seg.text
      else out.push({ ...seg })
    }
  })
  return out
}
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const SPARK = '▁▂▃▄▅▆▇█'

export function fmtTokens(n: number | undefined): string {
  if (n === undefined) return '–'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

/** A bar of `width` cells, filled to `percent` with eighth-block precision. */
export function bar(percent: number, width: number): { filled: string; empty: string } {
  const cells = (Math.max(0, Math.min(100, percent)) / 100) * width
  const whole = Math.floor(cells)
  const part = EIGHTHS[Math.round((cells - whole) * 8)] ?? ''
  const filled = '█'.repeat(whole) + (whole < width ? part : '')
  return { filled, empty: '░'.repeat(Math.max(0, width - [...filled].length)) }
}

/** Bars scaled between the lowest and highest value shown, so small moves stay visible. */
export function sparkline(values: readonly number[]): string {
  const lo = Math.min(...values)
  const span = Math.max(...values) - lo
  return values
    .map(v => (span === 0 ? SPARK[3] : SPARK[Math.min(7, Math.max(0, Math.floor(((v - lo) / span) * 8)))]))
    .join('')
}

const TREND_LEN = 8

/** "trend ▁▂▃▅▇ 12→42%": the last TREND_LEN readings' shape, then where the fill started and is now. */
export function trendText(values: readonly number[]): string {
  const shown = values.slice(-TREND_LEN)
  return `trend ${sparkline(shown)} ${shown[0]}→${shown[shown.length - 1]}%`
}

/** "42m", "3h 5m", and from a day on "1d 2h". */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(minutes / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return h > 0 ? `${h}h ${minutes % 60}m` : `${minutes}m`
}

const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

type EffortBadge = {
  text: string
  color?: string
  backgroundColor?: string
  bold?: boolean
  dimColor?: boolean
}

/** How loudly the effort is drawn: quiet for low, a filled badge for max and ultracode. */
export function effortBadge(e: Effort): EffortBadge | undefined {
  const level = typeof e.level === 'number' ? `${fmtTokens(e.level)} budget` : e.level
  if (e.isUltra) {
    return {
      text: ` ✦ ULTRACODE${level ? ` · ${String(level).toUpperCase()}` : ''} `,
      color: 'inverseText',
      backgroundColor: 'claude',
      bold: true,
    }
  }
  switch (level) {
    case undefined:
      return undefined
    case 'max':
      return { text: ' ▲ MAX ', color: 'inverseText', backgroundColor: 'error', bold: true }
    case 'xhigh':
      return { text: '◆ xhigh', color: 'warning', bold: true }
    case 'high':
      return { text: '● high', color: 'claude', bold: true }
    case 'medium':
      return { text: '○ medium', color: 'text' }
    case 'low':
      return { text: '· low', dimColor: true }
    default:
      return { text: `effort ${level}`, color: 'text' }
  }
}

/** The choices the effort picker offers, as `/effort <arg>` takes them. */
export const EFFORT_CHOICES = ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'] as const

/**
 * What `/effort` printed, read back: "Set effort level to max (…)",
 * "Ultracode on (this session only): … Effort stays medium.", "… · Ultracode off".
 */
export function parseEffortOutput(text: string): Partial<Effort> {
  const found: Partial<Effort> = {}
  const level = /effort level to (\w+)/i.exec(text) ?? /effort stays (\w+)/i.exec(text)
  const word = level?.[1]
  if (word) found.level = word.toLowerCase()
  if (/ultracode on\b/i.test(text)) found.isUltra = true
  else if (/ultracode off\b/i.test(text)) found.isUltra = false
  return found
}

/** The `/config` row for effort, when this build has one: a starting value before the first request. */
async function refreshEffort($: EngineInterface): Promise<void> {
  try {
    const row = (await $.config.list()).find(r => /^effort/i.test(r.key) || /^effort/i.test(r.label))
    const level = row?.value
    if (typeof level !== 'string' && typeof level !== 'number') return
    await update($, effort, old => (old.level !== undefined ? old : { ...old, level }))
  } catch {
    // no such row: the first request's effort fills it in
  }
}

/**
 * The saved effort for a model: `modelSettings[model].effortLevel`, else the first
 * `modelSettings` entry naming the same model another way (settings key by id, the
 * session may say "Opus 5.5"), else the top-level `effortLevel`.
 */
export function savedEffort(settings: Readonly<Record<string, unknown>>, model?: string): string | undefined {
  const perModel = settings.modelSettings as Record<string, { effortLevel?: unknown } | undefined> | undefined
  let level = model ? perModel?.[model]?.effortLevel : undefined
  if (level === undefined && model && perModel) {
    const label = modelLabel(model)
    level = Object.entries(perModel).find(([key, v]) => v?.effortLevel !== undefined && modelLabel(key) === label)?.[1]
      ?.effortLevel
  }
  level ??= settings.effortLevel
  return typeof level === 'string' ? level : undefined
}

let lastSaved: string | undefined

/**
 * Picks up an effort changed where no hook sees it (Claude Code's own /effort panel).
 * Applies only when the saved value itself moved, so a session-only /effort or a
 * request's effort is not overwritten by a stale saved one.
 */
async function pollSavedEffort($: EngineInterface): Promise<void> {
  try {
    const s = await read($, snap)
    const level = savedEffort(await $.settings.read(), s?.model)
    if (level === undefined || level === lastSaved) return
    const isFirst = lastSaved === undefined
    lastSaved = level
    // a newly saved level changes the level only; ultracode stays as it was
    await update($, effort, old => (isFirst && old.level !== undefined ? old : { ...old, level }))
  } catch {
    // settings unreadable: hooks and requests still fill it in
  }
}

async function applyEffortOutput($: EngineInterface, text: string | undefined): Promise<boolean> {
  const found = parseEffortOutput(text ?? '')
  if (Object.keys(found).length === 0) return false
  await update($, effort, old => ({ ...old, ...found }))
  return true
}

/**
 * What a typed `/effort <args>` asks for, read from the arguments alone.
 * A level leaves ultracode as it is (Claude Code keeps it on across level changes);
 * `ultracode` or `ultracode on` turns it on, `ultracode off` off. Bare `/effort`, `auto` and
 * anything else give nothing.
 */
export function parseEffortArgs(args: string): Partial<Effort> | undefined {
  const [word, flag, ...rest] = args.trim().toLowerCase().split(/\s+/)
  if (rest.length > 0) return undefined
  if (word === 'ultracode') {
    if (flag === undefined || flag === 'on') return { isUltra: true }
    return flag === 'off' ? { isUltra: false } : undefined
  }
  if (flag !== undefined) return undefined
  return ['low', 'medium', 'high', 'xhigh', 'max'].includes(word ?? '') ? { level: word } : undefined
}

/** A prompt that is a typed `/effort …` command: what it asks for. */
export function parseEffortCommand(text: string): Partial<Effort> | undefined {
  const m = /^\s*\/effort(?:\s+(.*))?$/i.exec(text)
  return m ? parseEffortArgs(m[1] ?? '') : undefined
}

/**
 * Runs `/effort <args>` exactly as if typed. What it printed wins when the mod
 * can read it; otherwise the badge shows what was asked for, since a session-only
 * choice (max, ultracode) is saved nowhere the mod could read it back from.
 */
async function pickEffort($: EngineInterface, args: string): Promise<void> {
  await update($, isPickerOpen, () => false)
  try {
    const result = await $.command.run({ command: 'effort', args })
    const isApplied = await applyEffortOutput($, result.text)
    if (!isApplied) {
      const asked = parseEffortArgs(args)
      if (asked) await update($, effort, old => ({ ...old, ...asked }))
      $.ui.log(`context-meter: /effort ${args} printed nothing readable; showing what was asked`, { to: 'debug' })
    }
  } catch (err) {
    await $.ui.toast(`/effort ${args} failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** The models the picker offers, as `/model <alias>` takes them, smallest first. */
export const MODEL_CHOICES = ['haiku', 'sonnet', 'opus', 'fable'] as const
type ModelChoice = (typeof MODEL_CHOICES)[number]

/** Which family a model name or id belongs to ("claude-opus-5-5", "Opus 5.5" → "opus"). */
export function modelFamily(name: string | null | undefined): ModelChoice | undefined {
  const lower = name?.toLowerCase() ?? ''
  return MODEL_CHOICES.find(f => lower.includes(f))
}

/**
 * A model as the badge shows it: "claude-opus-5-5" → "Opus 5.5", "claude-opus-4-20250514"
 * → "Opus 4", "claude-3-5-haiku-20241022" → "Haiku 3.5", "claude-opus-5-5[1m]" →
 * "Opus 5.5 · 1M"; an unknown name as given.
 */
export function modelLabel(name: string | null | undefined): string {
  if (!name) return 'model ?'
  const family = modelFamily(name)
  if (!family) return name.replace(/`/g, '')
  // the version right after the family; a date is no minor version
  const after = new RegExp(`${family}[-_ ]?(\\d{1,2})(?:[-.](\\d{1,2}))?(?!\\d)`, 'i').exec(name)
  // older ids put it before the family: claude-3-5-haiku
  const before = after
    ? undefined
    : /(?<!\d)(\d{1,2})[-.](\d{1,2})[-.]/.exec(name.slice(0, name.toLowerCase().indexOf(family)))
  const [, major, minor] = after ?? before ?? []
  const title = family[0]?.toUpperCase() + family.slice(1)
  const version = major === undefined ? '' : minor === undefined ? ` ${major}` : ` ${major}.${minor}`
  const isLong = /\[1m\]|1m context/i.test(name)
  return `${title}${version}${isLong ? ' · 1M' : ''}`
}

/** What `/model <alias>` printed: "Set model to Opus 5.5 …", "Kept model as `Opus 5.5`". */
export function parseModelOutput(text: string | undefined): string | undefined {
  const m = /(?:set model to|kept model as)\s+`?([^`\n(]+?)`?(?:\s+and saved\b|\s*\(|\s*$|\n)/i.exec(text ?? '')
  return m?.[1]?.trim() || undefined
}

/** The main loop's model, straight from the engine. */
async function refreshModel($: EngineInterface): Promise<void> {
  try {
    const name = await $.session.model()
    await update($, model, old => (old === name ? old : name))
  } catch {
    // no model yet: the badge shows "model ?"
  }
}

/**
 * Runs `/model <alias>`, then reads the model back. When Claude Code wants a
 * confirmation first (it answers "Kept model as …" to a plugin's run, which cannot
 * show the dialog) and plugins may not submit slash commands, the mod says what to type.
 */
async function pickModel($: EngineInterface, alias: ModelChoice): Promise<void> {
  await update($, isModelPickerOpen, () => false)
  try {
    const result = await $.command.run({ command: 'model', args: alias })
    const name = parseModelOutput(result.text)
    if (/kept model as/i.test(result.text ?? '') && modelFamily(name) !== alias) {
      await $.ui.toast(`Claude Code kept ${modelLabel(name)}: /model ${alias} did not switch`)
    } else if (name) {
      await update($, model, () => name)
    }
    await refreshModel($)
  } catch (err) {
    await $.ui.toast(`/model ${alias} failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** The keys of the numbers that differ between two readings ('limit:<kind>' per rate-limit window). */
export function changedKeys(old: Snapshot | null | undefined, next: Snapshot): string[] {
  if (!old) return []
  const keys: string[] = []
  if (next.tokens !== undefined && next.tokens !== old.tokens) keys.push('tokens', 'headroom', 'delta')
  if (next.percent !== undefined && next.percent !== old.percent) keys.push('percent')
  if (next.usd !== undefined && Math.round((next.usd ?? 0) * 100) !== Math.round((old.usd ?? 0) * 100)) keys.push('usd')
  for (const l of next.limits) {
    const before = old.limits.find(o => o.kind === l.kind)
    if (before && before.percentUsed !== l.percentUsed) keys.push(`limit:${l.kind}`)
  }
  return keys
}

export function toSnapshot(u: SessionUsage, now: number, previous?: Snapshot | null, tick = 0): Snapshot {
  const b = u.context.breakdown
  const categories = (b?.categories ?? [])
    .filter(c => c.kind === 'used' && c.tokens > 0)
    .sort((x, y) => y.tokens - x.tokens)
    .slice(0, 5)
    .map(c => ({ name: c.name, tokens: c.tokens }))
  const tokens = u.context.tokens
  const isNewTokens = tokens !== undefined && previous?.tokens !== undefined && tokens !== previous.tokens
  const next: Snapshot = {
    tokens,
    window: u.context.window,
    percent: u.context.percent,
    compactAt: b?.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
    model: b?.model,
    categories,
    usd: u.cost?.usd,
    limits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
    startedAt: u.startedAt,
    lastDelta: isNewTokens ? tokens - previous.tokens! : previous?.lastDelta,
    at: now,
    changed: previous?.changed ?? [],
    changedTick: previous?.changedTick ?? tick,
    prevPercent: previous?.prevPercent,
    from: previous?.from ?? {},
  }
  const keys = changedKeys(previous, next)
  if (keys.length > 0 && previous) {
    next.changed = keys
    next.changedTick = tick
    if (keys.includes('percent')) next.prevPercent = previous.percent
    next.from = fromValues(previous, keys)
  }
  return next
}

/** Each changed number's old value, the start of its count-up; a new last-turn growth counts from 0. */
function fromValues(old: Snapshot, keys: readonly string[]): Record<string, number> {
  const from: Record<string, number> = {}
  for (const key of keys) {
    if (key === 'tokens' && old.tokens !== undefined) from.tokens = old.tokens
    else if (key === 'headroom' && old.compactAt !== undefined && old.tokens !== undefined) {
      from.headroom = Math.max(0, old.compactAt - old.tokens)
    } else if (key === 'delta') from.delta = 0
    else if (key === 'percent' && old.percent !== undefined) from.percent = old.percent
    else if (key === 'usd' && old.usd !== undefined) from.usd = old.usd
    else if (key.startsWith('limit:')) {
      const before = old.limits.find(l => `limit:${l.kind}` === key)
      if (before) from[key] = before.percentUsed
    }
  }
  return from
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    const [usage, now, tick] = await Promise.all([
      $.session.usage({ breakdown: 'summary', columns: 40 }),
      $.clock.now(),
      read($, frame),
    ])
    let isNewReading = false
    let isChanged = false
    await update($, snap, old => {
      isNewReading = usage.context.tokens !== undefined && usage.context.tokens !== old?.tokens
      const next = toSnapshot(usage, now, old, tick)
      isChanged = old !== null && next.changedTick === tick && next.changed.length > 0 && next.changed !== old.changed
      return next
    })
    if (isChanged) await startCountUp($)
    const percent = usage.context.percent
    if (isNewReading && percent !== undefined) {
      await update($, history, h => [...h, percent].slice(-HISTORY_LEN))
    }
  } catch {
    // usage unavailable (no session bound yet): keep the last reading
  }
}

/*
 * One engine timer drives every animation. Work a hook starts on its own dies
 * with that hook's dispatch (its budget counts every sleep), so the loop is a
 * `$.clock.every` interval, which runs until cancelled or the module reloads.
 * It ticks every TWEEN_MS: the count-up advances on each tick while it runs,
 * the mascot's frame on every SUBTICKS-th.
 */
const SUBTICKS = Math.round(TICK_MS / TWEEN_MS)

let ticker: { cancel: () => void } | undefined
let subtick = 0
let countStep = TWEEN_STEPS

function startTicker($: EngineInterface): void {
  if (ticker) return
  try {
    ticker = $.clock.every(TWEEN_MS, () => {
      void onTick($)
    })
  } catch {
    ticker = undefined
  }
}

function stopTicker(): void {
  ticker?.cancel()
  ticker = undefined
}

async function onTick($: EngineInterface): Promise<void> {
  subtick++
  try {
    if (countStep < TWEEN_STEPS) {
      countStep++
      const step = countStep
      await update($, tweenStep, () => step)
    }
    if (subtick % SUBTICKS === 0) await update($, frame, t => t + 1)
    if (subtick % (SUBTICKS * 2) === 0) await Promise.all([pollSavedEffort($), refreshModel($)])
  } catch {
    // drawing state is best effort
  }
}

/** A change was recorded: count up from step 0; a newer change restarts it. */
async function startCountUp($: EngineInterface): Promise<void> {
  countStep = 0
  await update($, tweenStep, () => 0)
  startTicker($)
}

/** Activity wakes Clawd: the idle count restarts from the current tick. */
async function markActive($: EngineInterface): Promise<void> {
  try {
    const t = await read($, frame)
    await update($, awakeTick, () => t)
  } catch {
    // drawing state is best effort
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    startTicker($)
    await Promise.all([refresh($), refreshEffort($), markActive($), refreshModel($)])
    await pollSavedEffort($)
    return next(e)
  })

  // `/model`, typed or picked from the badge: read the model back once it ran.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const result = await next(e)
    await refreshModel($)
    return result
  }).catch(($, e, next) => next(e))

  // Also (re)starts the timer: a /clear ends the session without a new session.start.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    startTicker($)
    await Promise.all([refresh($), refreshEffort($), markActive($)])
    return result
  })

  // The effort the main thread actually sends, after any downgrade for the model.
  on('turn.step', async function* ($, e, next) {
    await markActive($)
    if (e.agentId === undefined && e.effort !== undefined) {
      const level = e.effort
      try {
        await update($, effort, old => (old.level === level ? old : { ...old, level }))
      } catch {
        // drawing state is best effort; never hold up the request
      }
    }
    return yield* next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    startTicker($)
    await markActive($)
    // A typed `/effort max` or `/effort ultracode` is session-only and saved nowhere
    // the mod can read; take it from the command line itself.
    const asked = parseEffortCommand(e.text)
    if (asked) {
      try {
        await update($, effort, old => ({ ...old, ...asked }))
      } catch {
        // drawing state is best effort
      }
    }
    return next(e)
  })

  // `/effort`, typed or picked from the badge: read back the level and ultracode it set.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    startTicker($)
    try {
      const isApplied = await applyEffortOutput($, result.text)
      $.ui.log(`context-meter: /effort ${e.args} → ${JSON.stringify(result.text ?? null)} (applied: ${isApplied})`, {
        to: 'debug',
      })
      if (!isApplied && e.args.trim() !== '') {
        $.ui.log(`context-meter: could not read the effort from /effort's output: ${result.text ?? '(no text)'}`)
      }
    } catch {
      // drawing state is best effort
    }
    return result
  }).catch(($, e, next) => next(e))

  // A /clear ends the session but the process and this module go on; keep the timer.
  on('session.end', ($, e, next) => {
    if (e.reason !== 'clear') stopTicker()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [s, trend, tick, isDetailed, eff, awake, isPicking, step, modelName, isModelPicking] = await Promise.all([
      read($, snap),
      read($, history),
      read($, frame),
      read($, showDetails),
      read($, effort),
      read($, awakeTick),
      read($, isPickerOpen),
      read($, tweenStep),
      read($, model),
      read($, isModelPickerOpen),
    ])
    if (s === null) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const isWorking = e.props.isWorking
    const columns = e.props.bodyColumns
    // A changed number counts from its old value to the new one while `step` runs.
    const shown = (key: string, to: number) => {
      const from = s.from[key]
      return from === undefined || !s.changed.includes(key) ? to : tween(from, to, step)
    }
    const percent = Math.round(shown('percent', s.percent ?? 0))
    const compactPercent = s.compactAt !== undefined && s.window > 0 ? (s.compactAt / s.window) * 100 : undefined
    const fill = fillColor(percent, compactPercent)
    const isCompact = columns < 72
    const badge = effortBadge(eff)
    const modelText = `◇ ${modelLabel(modelName ?? s.model)}`
    const badgeWidth = (badge ? [...badge.text].length : 8) + 3 + [...modelText].length + 4
    const width = Math.max(10, Math.min(40, columns - (isCompact ? 42 : 60) - badgeWidth))

    // A changed number stays highlighted for HIGHLIGHT_TICKS ticks (about 5 s).
    const isFresh = tick - s.changedTick < HIGHLIGHT_TICKS
    const hl = (key: string) => isFresh && s.changed.includes(key)
    const runs = meterRuns({
      percent: shown('percent', s.percent ?? 0),
      prevPercent: hl('percent') ? s.prevPercent : undefined,
      compactFraction: s.compactAt !== undefined && s.window > 0 ? s.compactAt / s.window : undefined,
      width,
    })
    const arrow =
      hl('percent') && s.prevPercent !== undefined ? ((s.percent ?? 0) > s.prevPercent ? '▲' : '▼') : ' '

    const runStyle = (kind: MeterRun['kind']) =>
      kind === 'old'
        ? { color: fill }
        : kind === 'new'
          ? { color: HL_COLOR, bold: true }
          : kind === 'mark'
            ? { color: 'warning', bold: true }
            : { dimColor: true }

    // Every piece keeps its own width (flexShrink 0) and the row clips what does
    // not fit, so a number that grows while counting can never draw over its neighbour.
    const meter = (
      <Box key="meter" flexDirection="row" justifyContent="space-between" overflow="hidden">
        <Box key="fill" flexDirection="row" flexShrink={0}>
          <Text bold color="claude">
            {'Context '}
          </Text>
          {runs.map((r, i) => (
            <Text key={`run${i}`} {...runStyle(r.kind)}>
              {r.text}
            </Text>
          ))}
          <Box key="percent" width={7} flexShrink={0}>
            <Text bold color={hl('percent') ? HL_COLOR : fill}>
              {` ${percent}%${arrow}`}
            </Text>
          </Box>
          {s.tokens === undefined ? (
            <Text dimColor>waiting for the first reply</Text>
          ) : (
            <Box key="tokens" flexDirection="row" flexShrink={0} marginLeft={1}>
              <Text bold={hl('tokens')} color={hl('tokens') ? HL_COLOR : undefined} dimColor={!hl('tokens')}>
                {fmtTokens(shown('tokens', s.tokens))}
              </Text>
              <Text dimColor>{` / ${fmtTokens(s.window)} tokens`}</Text>
            </Box>
          )}
        </Box>
      </Box>
    )

    // The picker opens around the badge: lower levels above it, higher ones below, the
    // ultracode switch last. Ultracode rides on top of a level, so the level places the
    // badge either way, and with ultracode on the switch turns it off.
    const levels = EFFORT_CHOICES.filter(c => c !== 'ultracode')
    const at = levels.findIndex(c => c === eff.level)
    const above = isPicking && at >= 0 ? levels.slice(0, at) : []
    const below = isPicking ? [...levels.slice(at + 1), 'ultracode' as const] : []
    const choiceButton = (choice: (typeof EFFORT_CHOICES)[number]) => {
      const isUltraOff = choice === 'ultracode' && eff.isUltra
      // Options are plain text: the badge's inverse colors need its background, so max is drawn in `error`.
      const look = isUltraOff
        ? { text: '✦ ultracode off', color: 'subtle' }
        : choice === 'ultracode'
          ? { text: '✦ ultracode', color: 'claude' }
          : choice === 'max'
            ? { text: '▲ max', color: 'error' }
            : effortBadge({ level: choice, isUltra: false })
      const args = isUltraOff ? 'ultracode off' : choice
      return (
        <Button key={`pick-${choice}`} plain label={args} onPress={() => pickEffort($, args)}>
          <Text color={look?.color} dimColor={look?.dimColor}>
            {`${look?.text.trim() ?? choice}  `}
          </Text>
        </Button>
      )
    }
    const effortColumn = (
      <Box key="effort-col" flexDirection="column" alignItems="flex-end" flexShrink={0}>
        {above.map(choiceButton)}
        <Button
          key="effort"
          plain
          label="effort"
          onPress={async () => {
            await update($, isModelPickerOpen, () => false)
            await update($, isPickerOpen, v => !v)
          }}
        >
          <Text
            color={badge?.color}
            backgroundColor={badge?.backgroundColor}
            bold={badge?.bold}
            dimColor={badge ? badge.dimColor : true}
          >
            {badge ? badge.text : 'effort ?'}
          </Text>
          <Text dimColor>{isPicking ? ' ▴' : ' ▾'}</Text>
        </Button>
        {below.map(choiceButton)}
      </Box>
    )

    // The model picker works the same way: smaller models above the badge, larger ones below.
    const family = modelFamily(modelName ?? s.model)
    const mAt = MODEL_CHOICES.findIndex(c => c === family)
    const mAbove = isModelPicking && mAt >= 0 ? MODEL_CHOICES.slice(0, mAt) : []
    const mBelow = isModelPicking ? MODEL_CHOICES.slice(mAt + 1) : []
    const modelButton = (choice: ModelChoice) => (
      <Button key={`model-${choice}`} plain label={choice} onPress={() => pickModel($, choice)}>
        <Text color="text">{`◇ ${modelLabel(choice)}  `}</Text>
      </Button>
    )
    const modelColumn = (
      <Box key="model-col" flexDirection="column" alignItems="flex-end" flexShrink={0}>
        {mAbove.map(modelButton)}
        <Button
          key="model"
          plain
          label="model"
          onPress={async () => {
            await update($, isPickerOpen, () => false)
            await update($, isModelPickerOpen, v => !v)
          }}
        >
          <Text color="text" bold>
            {modelText}
          </Text>
          <Text dimColor>{isModelPicking ? ' ▴' : ' ▾'}</Text>
        </Button>
        {mBelow.map(modelButton)}
      </Box>
    )
    const pickers = (
      <Box key="pickers" flexDirection="row" gap={2} flexShrink={0}>
        {modelColumn}
        {effortColumn}
      </Box>
    )

    if (isCompact) {
      return (
        <Box key="context-meter" flexDirection="row" justifyContent="space-between">
          <Box key="left" flexGrow={1} flexShrink={1} overflow="hidden">
            {meter}
          </Box>
          {pickers}
        </Box>
      )
    }

    const headroom = s.compactAt !== undefined && s.tokens !== undefined ? s.compactAt - s.tokens : undefined
    const line2: Seg[][] = []
    if (s.compactAt !== undefined) {
      // "┊ auto-compact at 167.0k (83.0k left)" — the same ┊ as the bar's compaction mark
      const seg: Seg[] = [{ text: `┊ auto-compact at ${fmtTokens(s.compactAt)}` }]
      if (headroom !== undefined) {
        seg.push(
          { text: ' (' },
          { text: fmtTokens(shown('headroom', Math.max(0, headroom))), hl: hl('headroom') },
          { text: ' left)' },
        )
      }
      line2.push(seg)
    }
    if (s.lastDelta !== undefined && s.lastDelta !== 0) {
      const delta = shown('delta', s.lastDelta)
      line2.push([
        { text: 'last turn ' },
        { text: `${s.lastDelta > 0 ? '+' : '−'}${fmtTokens(Math.abs(delta))}`, hl: hl('delta') },
      ])
    }
    if (trend.length > 1) line2.push([{ text: trendText(trend) }])

    const line3: Seg[][] = [[{ text: `session ${duration(s.at - s.startedAt)}` }]]
    if (s.usd !== undefined) line3.push([{ text: `$${shown('usd', s.usd).toFixed(2)}`, hl: hl('usd') }])
    for (const l of s.limits) {
      const key = `limit:${l.kind}`
      line3.push([
        { text: `${LIMIT_NAMES[l.kind] ?? l.kind} ` },
        { text: `${Math.round(shown(key, l.percentUsed))}%`, hl: hl(key) },
      ])
    }

    // Pieces keep their width; the row clips at its edge instead of squeezing them onto each other.
    const row = (key: string, groups: Seg[][]) => (
      <Box key={key} flexDirection="row" overflow="hidden" flexShrink={1}>
        {groups.length === 0 ? <Text dimColor> </Text> : null}
        {joinSegs(groups).map((g, i) => (
          <Box key={`${key}${i}`} flexShrink={0}>
            <Text bold={g.hl} color={g.hl ? HL_COLOR : undefined} dimColor={!g.hl}>
              {g.text}
            </Text>
          </Box>
        ))}
      </Box>
    )

    const idleTicks = tick - awake
    const isAsleep = !isWorking && idleTicks >= SLEEP_AFTER_TICKS
    const isBlinking = !isAsleep && tick % BLINK_EVERY === BLINK_EVERY - 1
    const typing = isWorking ? tick : undefined
    const zzz = CLAWD.zzz[Math.floor((idleTicks - SLEEP_AFTER_TICKS) / 2) % CLAWD.zzz.length]

    return (
      <Box key="context-meter" borderStyle="round" borderColor="claude" paddingX={1} flexDirection="row" gap={2}>
        <Box key="clawd" flexDirection="column" flexShrink={0}>
          {clawdRows({ outfit: outfitFor(eff), isShut: isAsleep || isBlinking, typing, zzz: isAsleep ? zzz : undefined }).map(
            (row, r) => (
              <Box key={`clawd${r}`} flexDirection="row">
                {row.map((p, i) => (
                  <Text key={`c${r}-${i}`} color={p.color} backgroundColor={p.bg} bold={p.bold}>
                    {p.text}
                  </Text>
                ))}
              </Box>
            ),
          )}
        </Box>
        <Box key="stats" flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          {meter}
          {row('line2', line2)}
          <Box key="line3" flexDirection="row" overflow="hidden">
            {row('line3segs', line3)}
            <Box key="details-box" flexShrink={0}>
              <Text dimColor>{' · '}</Text>
              <Button
                key="details"
                label={isDetailed ? 'hide' : 'details'}
                dimColor
                plain
                onPress={() => update($, showDetails, v => !v)}
              />
            </Box>
          </Box>
          {isDetailed && s.categories.length > 0 ? (
            <Text key="categories" color="subtle">
              {s.categories.map(c => `${c.name} ${fmtTokens(c.tokens)}`).join(' · ')}
            </Text>
          ) : null}
        </Box>
        {pickers}
      </Box>
    )
  })
}
