import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, TurnStepInput } from 'claude-code'

import type { Effort, Snapshot } from '../types'

const snap = atom({ plugin: 'context-meter', key: 'snap' } as const, null)
const effort = atom({ plugin: 'context-meter', key: 'effort' } as const, { isUltra: false } as Effort)
const isPickerOpen = atom({ plugin: 'context-meter', key: 'isPickerOpen' } as const, false)
const model = atom({ plugin: 'context-meter', key: 'model' } as const, null as string | null)
const isModelPickerOpen = atom({ plugin: 'context-meter', key: 'isModelPickerOpen' } as const, false)
const tweenStep = atom({ plugin: 'context-meter', key: 'tweenStep' } as const, 0)
const trend = atom({ plugin: 'context-meter', key: 'trend' } as const, [])
const frame = atom({ plugin: 'context-meter', key: 'frame' } as const, 0)
const awakeTick = atom({ plugin: 'context-meter', key: 'awakeTick' } as const, 0)
const showDetails = atom({ plugin: 'context-meter', key: 'showDetails' } as const, false)
const readError = atom({ plugin: 'context-meter', key: 'readError' } as const, null as string | null)
const hasMono = atom({ plugin: 'context-meter', key: 'hasMono' } as const, false)

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

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

/** How Clawd takes the context filling up: calm while the bar is orange, annoyed once it warns, fuming once it is red. */
export type Mood = 'calm' | 'annoyed' | 'fuming'

/** Clawd's mood from the bar's colour (`fillColor`), so the two always change together. */
function moodFor(fill: string): Mood {
  return fill === 'error' ? 'fuming' : fill === 'warning' ? 'annoyed' : 'calm'
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
/** Fuming, the key he hits flashes amber: a red one would vanish under his red arm. */
const KEY_FUMING_COLOR = 'warning'
/** His body by mood: Claude orange, ember, red. Raw colours, so he looks the same in every theme. */
const MOOD_BODY: Record<Mood, string> = { calm: 'claude', annoyed: '#e5603f', fuming: '#e5383b' }
/** His eyes, left and right, when he is not calm: flat (annoyed), squeezed shut (fuming). */
const MOOD_EYES: Record<Exclude<Mood, 'calm'>, readonly [string, string]> = { annoyed: ['▂', '▂'], fuming: ['>', '<'] }

/**
 * Clawd's rows as colored pieces, 13 cells wide: his 9 plus 2 on each side,
 * where the high-effort bottles hang. The width never changes with the outfit,
 * so the stats beside him stay put. `shake` moves him a cell left (-1) or
 * right (1), keyboard aside.
 */
export function clawdRows(o: {
  outfit: Outfit
  isShut: boolean
  typing?: number
  zzz?: string
  mood?: Mood
  shake?: number
}): ClawdPiece[][] {
  const mood = o.mood ?? 'calm'
  const C = MOOD_BODY[mood]
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
  // Eyes drawn on his face (shut, flat or squeezed) take the colour of what ▛ and ▜ leave
  // empty: dark on a dark theme, light on a light one. Squeezed ones are bold.
  const isSqueezed = mood === 'fuming' && !o.isShut
  const ink = (text: string): ClawdPiece =>
    isSqueezed ? { text, color: 'inverseText', bg: C, bold: true } : { text, color: 'inverseText', bg: C }
  if (o.outfit === 'cap-bottles-glasses') {
    // Round white rims around each eye, a bridge between them; the eyes shut inside the rims.
    const rim = (text: string): ClawdPiece => ({ text, color: GLASSES_COLOR, bg: C, bold: true })
    const [l, r] = o.isShut ? ['─', '─'] : mood === 'calm' ? ['●', '●'] : MOOD_EYES[mood]
    rows.push([left, inner(' '), rim('('), ink(l), rim(')─('), ink(r), rim(')'), inner(' '), right])
  } else if (o.isShut || mood !== 'calm') {
    const [l, r] = o.isShut || mood === 'calm' ? [CLAWD.shutEye, CLAWD.shutEye] : MOOD_EYES[mood]
    rows.push([
      left,
      inner(' '),
      { text: '▐', color: C },
      ink(l),
      { text: '███', color: C },
      ink(r),
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
  if (o.zzz !== undefined) rows.push([side(PAD), { text: CLAWD.legs, color: C }, side(PAD)])
  // Shaking, all of him moves; the keyboard stays put.
  const by = o.shake ?? 0
  const placed = by === 0 ? rows : rows.map(row => shifted(row, by))
  if (o.zzz !== undefined) return placed
  const lit = t === undefined ? undefined : litKey(t)
  CLAWD.keyboard.forEach((line, r) => {
    const cells = [...line]
    const cap = (text: string, isLit = false): ClawdPiece => ({
      text,
      color: isLit ? (mood === 'fuming' ? KEY_FUMING_COLOR : KEY_LIT_COLOR) : KEY_COLOR,
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
    placed.push([side(' '), ...pieces, side(' ')])
  })
  return placed
}

/**
 * A row of Clawd moved a cell left (`by` < 0) or right (`by` > 0): a blank cell leaves one
 * edge and joins the other, so the row keeps its width. A row with no blank on that edge stays.
 */
function shifted(row: readonly ClawdPiece[], by: number): ClawdPiece[] {
  const first = row[0]
  const last = row[row.length - 1]
  if (by < 0 && first?.bg === undefined && first?.text.startsWith(' ')) {
    const rest = first.text.slice(1)
    return [...(rest ? [{ ...first, text: rest }] : []), ...row.slice(1), { text: ' ' }]
  }
  if (by > 0 && last?.bg === undefined && last?.text.endsWith(' ')) {
    const rest = last.text.slice(0, -1)
    return [{ text: ' ' }, ...row.slice(0, -1), ...(rest ? [{ ...last, text: rest }] : [])]
  }
  return [...row]
}

/**
 * Theme colours as Claude Code's dark and light themes draw them, for the Svg Clawd: an Svg
 * is drawn isolated from the page, so theme keys mean nothing inside it. The page's light or
 * dark picks the set, so he looks as the terminal draws him in that theme. Raw colours pass through.
 */
const SVG_DARK: Record<string, string> = {
  claude: '#d77757',
  suggestion: '#b1b9f9',
  success: '#4eba65',
  warning: '#ffc107',
  error: '#ff6b80',
  merged: '#af87ff',
  text: '#ffffff',
  inverseText: '#000000',
  inactive: '#999999',
  subtle: '#505050',
}
const SVG_LIGHT: Record<string, string> = {
  claude: '#d77757',
  suggestion: '#5769f7',
  success: '#2c7a39',
  warning: '#966c1e',
  error: '#ab2b3f',
  merged: '#8700ff',
  text: '#000000',
  inverseText: '#ffffff',
  inactive: '#666666',
  subtle: '#afafaf',
}
/** One terminal cell in the Svg, in CSS pixels: twice as tall as wide, as a terminal draws it. */
const CELL_W = 8
const CELL_H = 16

/** The quarters of a cell each block glyph fills: left-top, right-top, left-bottom, right-bottom. */
const QUADS: Record<string, readonly [number, number, number, number]> = {
  '█': [1, 1, 1, 1],
  '▀': [1, 1, 0, 0],
  '▄': [0, 0, 1, 1],
  '▌': [1, 0, 1, 0],
  '▐': [0, 1, 0, 1],
  '▘': [1, 0, 0, 0],
  '▝': [0, 1, 0, 0],
  '▖': [0, 0, 1, 0],
  '▗': [0, 0, 0, 1],
  '▛': [1, 1, 1, 0],
  '▜': [1, 1, 0, 1],
  '▙': [1, 0, 1, 1],
  '▟': [0, 1, 1, 1],
  '▚': [1, 0, 0, 1],
  '▞': [0, 1, 1, 0],
}

/** A colour in the Svg: the dark theme's as the attribute, and for a theme key the class that follows the page. */
type SvgPaint = { color: string; key?: string }

const svgPaint = (c: string): SvgPaint => {
  const dark = SVG_DARK[c]
  return dark === undefined ? { color: c } : { color: dark, key: c }
}
const fillOf = (p: SvgPaint) => `fill="${p.color}"${p.key ? ` class="f-${p.key}"` : ''}`
const strokeOf = (p: SvgPaint) => `stroke="${p.color}"${p.key ? ` class="s-${p.key}"` : ''}`
const escapeXml = (s: string) => s.replace(/[<>&"']/g, ch => `&#${ch.charCodeAt(0)};`)

/** The theme classes, dark first and light on a light page (a CSS rule outranks the attribute). */
const SVG_STYLE = (() => {
  const rules = (set: Record<string, string>) =>
    Object.entries(set)
      .map(([k, v]) => `.f-${k}{fill:${v}}.s-${k}{stroke:${v}}`)
      .join('')
  return `<style>${rules(SVG_DARK)}@media (prefers-color-scheme: light){${rules(SVG_LIGHT)}}</style>`
})()

/** One glyph of a cell at (x, y) as Svg markup: blocks as rects, the line-drawing ones as strokes. */
function glyphSvg(ch: string, x: number, y: number, paint: SvgPaint, isBold: boolean): string {
  const w = CELL_W
  const h = CELL_H
  const rect = (rx: number, ry: number, rw: number, rh: number) =>
    `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" ${fillOf(paint)}/>`
  const stroke = (d: string, width: number) =>
    `<path d="${d}" fill="none" ${strokeOf(paint)} stroke-width="${width}" stroke-linecap="round"/>`
  const q = QUADS[ch]
  if (q) {
    const [lt, rt, lb, rb] = q
    if (lt && rt && lb && rb) return rect(x, y, w, h)
    const half = (left: number, right: number, top: number) =>
      left && right ? rect(x, top, w, h / 2) : (left ? rect(x, top, w / 2, h / 2) : '') + (right ? rect(x + w / 2, top, w / 2, h / 2) : '')
    return half(lt, rt, y) + half(lb, rb, y + h / 2)
  }
  switch (ch) {
    case ' ':
      return ''
    case '▁':
      return rect(x, y + h - h / 8, w, h / 8)
    case '▂':
      return rect(x, y + h - h / 4, w, h / 4)
    case '>':
      return stroke(`M${x + 2} ${y + 5} L${x + w - 2} ${y + h / 2 + 1} L${x + 2} ${y + h - 3}`, isBold ? 2 : 1.5)
    case '<':
      return stroke(`M${x + w - 2} ${y + 5} L${x + 2} ${y + h / 2 + 1} L${x + w - 2} ${y + h - 3}`, isBold ? 2 : 1.5)
    case '─':
      return rect(x, y + h / 2 - (isBold ? 1 : 0.5), w, isBold ? 2 : 1)
    case '━':
      return rect(x, y + h / 2 - 1.5, w, 3)
    case '╰':
      return stroke(`M${x + w / 2} ${y} V${y + h / 2 - 2} Q${x + w / 2} ${y + h / 2} ${x + w / 2 + 2} ${y + h / 2} H${x + w}`, 1.5)
    case '╯':
      return stroke(`M${x + w / 2} ${y} V${y + h / 2 - 2} Q${x + w / 2} ${y + h / 2} ${x + w / 2 - 2} ${y + h / 2} H${x}`, 1.5)
    case '(':
      return stroke(`M${x + w - 2} ${y + 3} Q${x + 1} ${y + h / 2} ${x + w - 2} ${y + h - 3}`, isBold ? 2 : 1.5)
    case ')':
      return stroke(`M${x + 2} ${y + 3} Q${x + w - 1} ${y + h / 2} ${x + 2} ${y + h - 3}`, isBold ? 2 : 1.5)
    case '●':
      return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w * 0.35}" ${fillOf(paint)}/>`
    default:
      return `<text x="${x + w / 2}" y="${y + h * 0.75}" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="${h * 0.8}"${isBold ? ' font-weight="bold"' : ''} ${fillOf(paint)}>${escapeXml(ch)}</text>`
  }
}

/**
 * Clawd's rows (`clawdRows`) as one Svg, for surfaces that draw Text in a page font: there
 * the block glyphs leave gaps between lines and the cells lose their width. Every cell is
 * drawn as the terminal would fill it, so he looks the same: what a glyph leaves empty (his
 * eyes, as in the welcome banner) shows what is behind him.
 */
export function clawdSvg(rows: readonly (readonly ClawdPiece[])[]): { source: string; width: number; height: number } {
  const parts: string[] = []
  rows.forEach((row, r) => {
    let col = 0
    for (const p of row) {
      const paint = svgPaint(p.color ?? 'text')
      const bg = p.bg === undefined ? undefined : svgPaint(p.bg)
      for (const ch of p.text) {
        const x = col * CELL_W
        const y = r * CELL_H
        if (bg) parts.push(`<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" ${fillOf(bg)}/>`)
        parts.push(glyphSvg(ch, x, y, paint, p.bold === true))
        col++
      }
    }
  })
  const width = 13 * CELL_W
  const height = rows.length * CELL_H
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="crispEdges">` +
    SVG_STYLE +
    parts.join('') +
    '</svg>'
  return { source, width, height }
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
const TREND_KEEP = 16
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
const SLEEP_AFTER_MINUTES = 5

/**
 * Frames without activity before Clawd falls asleep, from the `sleepAfterMinutes` setting:
 * 0 keeps him awake; anything but a number of at least 0 keeps the default 5 minutes.
 */
export function sleepTicks(minutes: unknown): number {
  const m = typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0 ? minutes : SLEEP_AFTER_MINUTES
  return m === 0 ? Infinity : Math.round((m * 60_000) / TICK_MS)
}

/** Set from the plugin's options each time the module loads (a settings change reloads it). */
let sleepAfterTicks = sleepTicks(SLEEP_AFTER_MINUTES)

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

/**
 * A piece of a stats row: plain (dim), highlighted (`hl`, a fresh change, in the colour of
 * its move), or in a colour of its own (a warning, a move that is not fresh, `bold: false`).
 */
type Seg = { text: string; hl?: boolean; color?: string; bold?: boolean }

const isPlain = (seg: Seg) => !seg.hl && seg.color === undefined

/** Cells a text takes: one per character (the band draws no wide ones). */
const cellsOf = (text: string) => [...text].length

/**
 * A group of a stats row, how much it matters (the lowest rank goes first) and, for some, a
 * shorter form that keeps its main figure.
 */
export type Group = { segs: Seg[]; rank: number; short?: Seg[] }

/**
 * The groups that fit `room` cells joined by ` · `, in their order. While they do not fit,
 * the short forms are taken first, then the least important group is left out (the lowest
 * rank; of equal ranks, the later one), so a figure is shown whole or not at all, never cut
 * at the row's edge.
 */
export function fitGroups(groups: readonly Group[], room: number): Seg[][] {
  const kept = groups.map(g => ({ ...g }))
  const width = () =>
    kept.reduce((n, g, i) => n + (i > 0 ? 3 : 0) + g.segs.reduce((m, seg) => m + cellsOf(seg.text), 0), 0)
  // the least important of `among`: the lowest rank, of equal ranks the later one
  const leastOf = (among: readonly typeof kept[number][]) =>
    among.reduce<typeof kept[number] | undefined>((least, g) => (least === undefined || g.rank <= least.rank ? g : least), undefined)
  while (width() > room) {
    const g = leastOf(kept.filter(k => k.short !== undefined))
    if (g === undefined || g.short === undefined) break
    g.segs = g.short
    g.short = undefined
  }
  while (kept.length > 0 && width() > room) {
    const g = leastOf(kept)
    kept.splice(g === undefined ? 0 : kept.indexOf(g), 1)
  }
  return kept.map(g => g.segs)
}

const WAITING = 'waiting for the first reply'
const METER_LABEL = 'Context '
const PERCENT_CELLS = 7
const MIN_BAR = 10
const MAX_BAR = 40

/** The forms of the meter row's tokens piece, richest first: `84.0k / 200.0k tokens`, `84.0k / 200.0k`, `84.0k`. */
export type TokensForm = 'full' | 'short' | 'bare' | 'none'
export type MeterPlan = { hasLabel: boolean; tokens: TokensForm; bar: number }

/**
 * How the meter row fits `room` cells, given the cells each tokens form takes: the richest
 * row with a bar of at least MIN_BAR, leaving out whole pieces in turn (the word "tokens",
 * the "Context" label, the window, the tokens). Failing all, the bar and the percent alone.
 */
export function planMeter(room: number, tokensCells: (form: TokensForm) => number): MeterPlan {
  const forms = [
    [true, 'full'],
    [true, 'short'],
    [false, 'short'],
    [false, 'bare'],
    [false, 'none'],
  ] as const
  for (const [hasLabel, tokens] of forms) {
    const rest = room - (hasLabel ? cellsOf(METER_LABEL) : 0) - PERCENT_CELLS - tokensCells(tokens)
    if (rest >= MIN_BAR) return { hasLabel, tokens, bar: Math.min(MAX_BAR, rest) }
  }
  return { hasLabel: false, tokens: 'none', bar: Math.max(0, Math.min(MAX_BAR, room - PERCENT_CELLS)) }
}

/** Groups joined by ` · `, adjacent plain pieces merged so the row stays few Texts. */
function joinSegs(groups: Seg[][]): Seg[] {
  const out: Seg[] = []
  groups.forEach((g, i) => {
    for (const seg of i > 0 ? [{ text: ' · ' }, ...g] : g) {
      const last = out[out.length - 1]
      if (last && isPlain(last) && isPlain(seg)) last.text += seg.text
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

/**
 * "trend ▁▂▃▅▇ 12→42%": the last TREND_LEN turn ends' tokens as a shape, then where the
 * fill started and is now, as percents of `window` (the one shown now, so a model switch
 * draws no spike). With no window known, the tokens themselves.
 */
export function trendText(tokens: readonly number[], window: number): string {
  const shown = tokens.slice(-TREND_LEN)
  const first = shown[0] ?? 0
  const last = shown[shown.length - 1] ?? 0
  const ends =
    window > 0
      ? `${Math.round((first / window) * 100)}→${Math.round((last / window) * 100)}%`
      : `${fmtTokens(first)}→${fmtTokens(last)}`
  return `trend ${sparkline(shown)} ${ends}`
}

/** Turn growths a forecast averages: the last few that grew (a compaction's drop is none). */
const FORECAST_TURNS = 5

/**
 * About how many turns fit in `room` tokens: the room over the average growth of the last
 * FORECAST_TURNS turns that grew, taken from the trend (tokens at each turn end), rounded up.
 * Nothing with fewer than two growths, no room, or 100 turns or more.
 */
export function turnsLeft(trendTokens: readonly number[], room: number): number | undefined {
  const growths = trendTokens
    .slice(1)
    .map((t, i) => t - (trendTokens[i] ?? t))
    .filter(g => g > 0)
    .slice(-FORECAST_TURNS)
  if (growths.length < 2 || room <= 0) return undefined
  const turns = Math.max(1, Math.ceil(room / (growths.reduce((a, b) => a + b, 0) / growths.length)))
  return turns < 100 ? turns : undefined
}

/** "~6 turns", "~1 turn". */
const turnsText = (n: number) => `~${n} turn${n === 1 ? '' : 's'}`

/** "42m", "3h 5m", and from a day on "1d 2h". */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(minutes / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return h > 0 ? `${h}h ${minutes % 60}m` : `${minutes}m`
}

/**
 * "resets 2h 14m": how long until a rate-limit window resets (`resetsAt`, ISO 8601), under a
 * minute "resets <1m". Nothing when the time is unknown, unreadable or already past.
 */
export function resetText(resetsAt: string | undefined, now: number): string | undefined {
  const ms = resetsAt === undefined ? NaN : Date.parse(resetsAt) - now
  if (!(ms > 0)) return undefined
  return `resets ${ms < 60_000 ? '<1m' : duration(ms)}`
}

/** The first engine whose Text takes `mono`. Older ones refuse a tree naming it and draw no band. */
const MONO_SINCE = [2, 1, 299]

/**
 * Whether an engine of release `base` (`2.1.300`, `2.1.300-dev`) takes Text's `mono` prop.
 * Claude Code Desktop bundles its own engine (2.1.295 on 2026-10-15), so this varies by
 * surface. An unknown version counts as too old.
 */
export function takesMono(base: string | undefined): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(base ?? '')
  if (m === null) return false
  for (let i = 0; i < 3; i++) {
    const have = Number(m[i + 1])
    const need = MONO_SINCE[i] ?? 0
    if (have !== need) return have > need
  }
  return true
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
  if (e.isUnsupported) return { text: '– no effort', dimColor: true }
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
 * What `/effort` printed, read back as what is in force: "Set effort level to max (…)",
 * "Ultracode on (this session only): … Effort stays medium.", "… · Ultracode off"; and where
 * that is not what was asked, the level that holds: an environment variable's
 * ("CLAUDE_CODE_EFFORT_LEVEL=high overrides this session …"), a cap's ("… set to 'high'
 * instead"), the one kept ("Kept effort level as high"). A refused ultracode is off.
 */
export function parseEffortOutput(text: string): Partial<Effort> {
  const found: Partial<Effort> = {}
  const level =
    /CLAUDE_CODE_EFFORT_LEVEL=(\w+) (?:overrides|still controls)/i.exec(text) ??
    /set to '(\w+)' instead/i.exec(text) ??
    /exceeds the cap for .*?; using '(\w+)'/i.exec(text) ??
    /effort level to (\w+)/i.exec(text) ??
    /effort stays (\w+)/i.exec(text) ??
    /kept effort level as (\w+)/i.exec(text)
  const word = level?.[1]?.toLowerCase()
  if (word && word !== 'auto') found.level = word
  if (/ultracode on\b/i.test(text)) found.isUltra = true
  else if (/ultracode off\b/i.test(text) || /^ultracode (?:needs|isn't available)/i.test(text)) found.isUltra = false
  return found
}

/**
 * The output of a `/effort` that did not take effect as asked, as Claude Code words it:
 * refused (ultracode unavailable, a failure, a session-only level a remote process cannot
 * take), kept, capped, or overridden by `CLAUDE_CODE_EFFORT_LEVEL`. Undefined for a plain success.
 */
export function effortRefusal(text: string | undefined): string | undefined {
  const t = text?.trim() ?? ''
  const isRefused =
    /^ultracode (?:needs|isn't available)/i.test(t) ||
    /^failed to set effort level/i.test(t) ||
    /^not applied:/i.test(t) ||
    /^kept effort level as/i.test(t) ||
    /won't reach the remote process/i.test(t) ||
    /exceeds the cap for/i.test(t) ||
    /CLAUDE_CODE_EFFORT_LEVEL=\w+ (?:overrides|still controls)/i.test(t)
  return isRefused ? t : undefined
}

/**
 * The `/config` row for effort, when this build has one: a starting value before the
 * first request. Once a request or a pick named the level, `/config` is not read again.
 */
async function refreshEffort($: EngineInterface): Promise<void> {
  try {
    const known = await read($, effort)
    if (known.level !== undefined || known.isUnsupported) return
    const row = (await $.config.list()).find(r => /^effort/i.test(r.key) || /^effort/i.test(r.label))
    const level = row?.value
    if (typeof level !== 'string' && typeof level !== 'number') return
    await update($, effort, old => (old.level !== undefined ? old : { ...old, level }))
  } catch {
    // no such row: the first request's effort fills it in
  }
}

/**
 * A model as settings tell it apart, for comparing names: the 1M variant is the same model
 * ("claude-opus-5-5[1m]", "Opus 5.5 (1M context)" → "Opus 5.5"), and a version without a
 * minor is its .0 ("claude-opus-4-20250514" → "Opus 4.0", as "claude-opus-4-0").
 */
const settingsModel = (name: string) =>
  modelLabel(name.replace(/\[1m\]$/i, ''))
    .replace(/ · 1M$/, '')
    .replace(/^(\S+ \d+)$/, '$1.0')

/**
 * The saved effort for a model: `modelSettings[model].effortLevel`, else the first
 * `modelSettings` entry naming the same model another way (settings key by id without the
 * 1M suffix, the session may say "Opus 5.5" or name the 1M variant), else the top-level
 * `effortLevel`.
 */
export function savedEffort(settings: Readonly<Record<string, unknown>>, model?: string): string | undefined {
  const perModel = settings.modelSettings as Record<string, { effortLevel?: unknown } | undefined> | undefined
  let level = model ? (perModel?.[model]?.effortLevel ?? perModel?.[model.replace(/\[1m\]$/i, '')]?.effortLevel) : undefined
  if (level === undefined && model && perModel) {
    const name = settingsModel(model)
    level = Object.entries(perModel).find(([key, v]) => v?.effortLevel !== undefined && settingsModel(key) === name)?.[1]
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
    // the polled model: the breakdown's name is stale after a switch until the next full reading
    const [s, polled] = await Promise.all([read($, snap), read($, model)])
    const level = savedEffort(await $.settings.read(), polled ?? s?.model)
    if (level === undefined || level === lastSaved) return
    const isFirst = lastSaved === undefined
    lastSaved = level
    // a newly saved level changes the level only; ultracode stays as it was
    await update($, effort, old =>
      isFirst && old.level !== undefined ? old : { ...old, level, isUnsupported: false },
    )
  } catch {
    // settings unreadable: hooks and requests still fill it in
  }
}

/**
 * The effort a main-thread request carried, after any downgrade for the model. None
 * means the model takes no effort, so the old level must not linger on the badge.
 * Ultracode is left as it is: requests do not carry it.
 */
async function noteEffort($: EngineInterface, level: TurnStepInput['effort']): Promise<void> {
  try {
    await update($, effort, old =>
      level === undefined
        ? old.isUnsupported && old.level === undefined
          ? old
          : { ...old, level: undefined, isUnsupported: true }
        : old.level === level && !old.isUnsupported
          ? old
          : { ...old, level, isUnsupported: false },
    )
  } catch {
    // drawing state is best effort; never hold up the request
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
    // what is in force, where the output says; a pick that did not take as asked also says why
    const isApplied = await applyEffortOutput($, result.text)
    const refusal = effortRefusal(result.text)
    if (refusal !== undefined) {
      await $.ui.toast(refusal)
    } else if (!isApplied) {
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

/**
 * The main loop's model, straight from the engine. A switch to another model (not
 * the same one named another way) changes the window, the auto-compact point and the
 * saved effort, and no measure follows a /model: read them all now.
 */
async function refreshModel($: EngineInterface): Promise<void> {
  try {
    const old = await read($, model)
    const name = await $.session.model()
    await update($, model, o => (o === name ? o : name))
    if (old !== null && modelLabel(old) !== modelLabel(name)) {
      // whether the new model takes effort is known at its first request, not from the old one's
      await update($, effort, e => (e.isUnsupported ? { ...e, isUnsupported: false } : e))
      await refresh($)
      await pollSavedEffort($)
    }
  } catch {
    // no model yet: the badge shows "model ?"
  }
}

/**
 * Runs `/model <alias>`, then reads the model back from the engine. When Claude Code
 * keeps the old model (it answers "Kept model as …"), the mod says so; typing the
 * command answers the same, so it suggests nothing.
 */
async function pickModel($: EngineInterface, alias: ModelChoice): Promise<void> {
  await update($, isModelPickerOpen, () => false)
  try {
    const result = await $.command.run({ command: 'model', args: alias })
    const name = parseModelOutput(result.text)
    if (/kept model as/i.test(result.text ?? '') && modelFamily(name) !== alias) {
      await $.ui.toast(`Claude Code kept ${modelLabel(name)}: /model ${alias} did not switch`)
    }
    // the engine's answer, not the command's text: writing that here would hide the switch from refreshModel
    await refreshModel($)
  } catch (err) {
    await $.ui.toast(`/model ${alias} failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * The keys of the numbers that differ between two readings ('limit:<kind>' per
 * rate-limit window). A new window is its own change: the percent then moved because
 * the window did, so it is not counted as fill. A turn's growth (`delta`) is added by
 * the turn end alone.
 */
export function changedKeys(old: Snapshot | null | undefined, next: Snapshot): string[] {
  if (!old) return []
  const keys: string[] = []
  if (next.tokens !== undefined && next.tokens !== old.tokens) keys.push('tokens', 'headroom')
  if (next.window !== old.window) keys.push('window')
  else if (next.percent !== undefined && next.percent !== old.percent) keys.push('percent')
  if (next.usd !== undefined && Math.round((next.usd ?? 0) * 100) !== Math.round((old.usd ?? 0) * 100)) keys.push('usd')
  for (const l of next.limits) {
    const before = old.limits.find(o => o.kind === l.kind)
    if (before && before.percentUsed !== l.percentUsed) keys.push(`limit:${l.kind}`)
  }
  return keys
}

/**
 * A reading as the meter keeps it. With no `previous` it is fresh: nothing is
 * highlighted and "this turn" counts from its tokens. A reading without a breakdown,
 * in an unchanged window, keeps the last breakdown's figures. A turn end
 * (`isTurnEnd`) measures the turn's growth from `turnBase` and starts the next turn there.
 */
export function toSnapshot(
  u: SessionUsage,
  now: number,
  previous?: Snapshot | null,
  tick = 0,
  isTurnEnd = false,
): Snapshot {
  const b = u.context.breakdown
  const isNewWindow = previous != null && previous.window !== u.context.window
  const carried = !b && previous != null && !isNewWindow ? previous : undefined
  const categories = b
    ? b.categories
        .filter(c => c.kind === 'used' && c.tokens > 0)
        .sort((x, y) => y.tokens - x.tokens)
        .slice(0, 5)
        .map(c => ({ name: c.name, tokens: c.tokens }))
    : (carried?.categories ?? [])
  const tokens = u.context.tokens
  let turnBase = previous ? previous.turnBase : tokens
  let lastDelta = previous?.lastDelta
  let compaction = previous?.compaction
  let isTurnMeasured = false
  if (isTurnEnd && tokens !== undefined) {
    if (turnBase !== undefined) {
      lastDelta = tokens - turnBase
      compaction = undefined
      isTurnMeasured = true
    } else {
      lastDelta = undefined
    }
    turnBase = tokens
  }
  const next: Snapshot = {
    tokens,
    window: u.context.window,
    percent: u.context.percent,
    compactAt: b ? (b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined) : carried?.compactAt,
    isAutoCompact: b ? b.isAutoCompactEnabled : carried?.isAutoCompact,
    model: b ? b.model : carried?.model,
    categories,
    usd: u.cost?.usd,
    limits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
    startedAt: u.startedAt,
    lastDelta,
    turnBase,
    windowFrom: isNewWindow ? previous.window : previous?.windowFrom,
    compaction,
    at: now,
    changed: previous?.changed ?? [],
    changedTick: previous?.changedTick ?? tick,
    prevPercent: previous?.prevPercent,
    from: previous?.from ?? {},
  }
  const keys = changedKeys(previous, next)
  if (isTurnMeasured && lastDelta !== 0) keys.push('delta')
  if (keys.length > 0 && previous) {
    next.changed = keys
    next.changedTick = tick
    if (keys.includes('percent')) next.prevPercent = previous.percent
    next.from = fromValues(previous, keys)
  }
  return next
}

/** A fresh change's colour by the way it went: green where the number rose, red where it fell. */
const MOVE_COLOR = { up: 'success', down: 'error' } as const

/**
 * Which way a changed number went since the last reading: `up`, `down`, or undefined where
 * it did not move or its old value is unknown. A turn's growth (`delta`) goes by its sign,
 * a new window from the one before.
 */
export function moveOf(s: Snapshot, key: string): 'up' | 'down' | undefined {
  let from = s.from[key]
  let to: number | undefined
  if (key === 'delta') {
    from = 0
    to = s.lastDelta
  } else if (key === 'window') {
    from = s.windowFrom
    to = s.window
  } else if (key === 'percent') {
    from = s.prevPercent ?? from
    to = s.percent
  } else if (key === 'tokens') to = s.tokens
  else if (key === 'headroom') to = s.compactAt !== undefined && s.tokens !== undefined ? Math.max(0, s.compactAt - s.tokens) : undefined
  else if (key === 'usd') to = s.usd
  else if (key.startsWith('limit:')) to = s.limits.find(l => `limit:${l.kind}` === key)?.percentUsed
  if (from === undefined || to === undefined || from === to) return undefined
  return to > from ? 'up' : 'down'
}

/**
 * Each changed number's old value, the start of its count-up. A finished turn's growth
 * counts on from the "this turn" figure the live readings showed, else from 0.
 */
function fromValues(old: Snapshot, keys: readonly string[]): Record<string, number> {
  const from: Record<string, number> = {}
  for (const key of keys) {
    if (key === 'tokens' && old.tokens !== undefined) from.tokens = old.tokens
    else if (key === 'headroom' && old.compactAt !== undefined && old.tokens !== undefined) {
      from.headroom = Math.max(0, old.compactAt - old.tokens)
    } else if (key === 'delta') {
      from.delta = old.tokens !== undefined && old.turnBase !== undefined ? old.tokens - old.turnBase : 0
    }
    else if (key === 'percent' && old.percent !== undefined) from.percent = old.percent
    else if (key === 'usd' && old.usd !== undefined) from.usd = old.usd
    else if (key.startsWith('limit:')) {
      const before = old.limits.find(l => `limit:${l.kind}` === key)
      if (before) from[key] = before.percentUsed
    }
  }
  return from
}

type RefreshOptions = {
  /** Read the window's breakdown too (auto-compact point, categories); default true. */
  breakdown?: boolean
  /** A main-thread turn just ended: measure its growth and add a trend point. */
  isTurnEnd?: boolean
  /** Read as if nothing came before: a new conversation (/clear, /resume). */
  isFresh?: boolean
  /** The context's tokens as a request's own usage gave them, newer than the engine's figures. */
  stepTokens?: number
}

/** Takes a reading and stores it; true when one was stored. */
async function refresh($: EngineInterface, opts: RefreshOptions = {}): Promise<boolean> {
  try {
    const [read0, now, tick] = await Promise.all([
      $.session.usage(opts.breakdown === false ? undefined : { breakdown: 'summary', columns: 40 }),
      $.clock.now(),
      read($, frame),
    ])
    let usage = read0
    const stepTokens = opts.stepTokens
    if (stepTokens !== undefined) {
      const window = read0.context.window
      const percent = window > 0 ? Math.min(100, Math.round((stepTokens / window) * 100)) : undefined
      usage = { ...read0, context: { ...read0.context, tokens: stepTokens, percent } }
    }
    let isFresh = false
    let isChanged = false
    await update($, snap, old => {
      const previous = opts.isFresh ? null : old
      isFresh = previous === null
      const next = toSnapshot(usage, now, previous, tick, opts.isTurnEnd)
      isChanged =
        previous !== null && next.changedTick === tick && next.changed.length > 0 && next.changed !== previous.changed
      return next
    })
    if (isChanged) await startCountUp($)
    const tokens = usage.context.tokens
    if ((isFresh || opts.isTurnEnd) && tokens !== undefined) {
      await update($, trend, t => (t[t.length - 1] === tokens ? t : [...t, tokens].slice(-TREND_KEEP)))
    }
    await update($, readError, e => (e === null ? e : null))
    return true
  } catch (err) {
    // usage unavailable (no session bound yet): keep the last reading, and say why
    const why = errorText(err)
    try {
      await update($, readError, e => (e === why ? e : why))
      $.ui.log(`context-meter: reading failed: ${why}`, { to: 'debug' })
    } catch {
      // drawing state is best effort
    }
    return false
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

/** The surfaces the band is drawn on: AbovePrompt is raised on these alone. */
const BAND_SURFACES: ReadonlySet<string> = new Set(['terminal', 'desktop'])

/**
 * Whether something draws the band. Where nothing does (`claude -p`, the Agent SDK, VS Code,
 * Claude Code Desktop before it attaches), the timer, its polls and the readings do not run.
 */
let isDrawn = true

/** A surface that draws the band is attached; when the roster cannot be read, assume one is. */
async function isBandSurfaceAttached($: EngineInterface): Promise<boolean> {
  try {
    return (await $.session.surfaces()).some(s => BAND_SURFACES.has(s))
  } catch {
    return true
  }
}

/** The band's work starts: the timer, a full reading, the model and the effort. */
async function wake($: EngineInterface): Promise<void> {
  startTicker($)
  await Promise.all([refresh($), refreshEffort($), markActive($), refreshModel($)])
  await pollSavedEffort($)
}

function startTicker($: EngineInterface): void {
  if (ticker || !isDrawn) return
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
    if (subtick % (SUBTICKS * 2) === 0) {
      // no reading since a start-over failed: try again
      const retry = (await read($, snap)) === null ? refresh($, { isFresh: true }) : undefined
      await Promise.all([pollSavedEffort($), refreshModel($), retry])
    }
  } catch {
    // drawing state is best effort
  }
}

/**
 * A new conversation in the same process (/clear, an in-process /resume): no
 * session.start follows, so the meter starts over itself. Nothing is measured against
 * the last conversation: the trend empties and the reading is fresh.
 */
async function startOver($: EngineInterface): Promise<void> {
  try {
    startTicker($)
    await update($, trend, () => [])
    if (!(await refresh($, { isFresh: true }))) await update($, snap, () => null)
  } catch {
    // drawing state is best effort; the ticker retries while there is no reading
  }
}

/** "compacted 182.0k → 31.0k", or what the engine recorded of it. */
function compactionText(c: NonNullable<Snapshot['compaction']>): string {
  if (c.before !== undefined && c.after !== undefined) return `compacted ${fmtTokens(c.before)} → ${fmtTokens(c.after)}`
  if (c.after !== undefined) return `compacted to ${fmtTokens(c.after)}`
  return c.before !== undefined ? `compacted from ${fmtTokens(c.before)}` : 'compacted'
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

export const register: Register = (on, options) => {
  sleepAfterTicks = sleepTicks(options?.sleepAfterMinutes)

  on('session.start', async ($, e, next) => {
    // A reload drops the module's count-up step but not the state's: land any count-up
    // that was running, so its numbers do not freeze midway.
    countStep = TWEEN_STEPS
    try {
      await update($, tweenStep, () => TWEEN_STEPS)
    } catch {
      // drawing state is best effort
    }
    // The REPL starts on the terminal; `-p` and the SDK start drawing nowhere, and Claude Code
    // Desktop attaches later (session.attach).
    isDrawn = (e.surface !== null && BAND_SURFACES.has(e.surface)) || (await isBandSurfaceAttached($))
    // Text's `mono` prop exists from 2.1.299; an older engine refuses the whole band over it.
    let version: string | undefined
    try {
      const v = await $.session.version()
      version = v.base ?? v.version
    } catch {
      // unknown: no mono
    }
    const isMono = takesMono(version)
    try {
      await update($, hasMono, m => (m === isMono ? m : isMono))
      $.ui.log(
        `context-meter: session.start on ${e.surface ?? 'no surface'}, engine ${version ?? 'unknown'}; drawn: ${isDrawn}; mono: ${isMono}`,
        { to: 'debug' },
      )
    } catch {
      // drawing state is best effort
    }
    if (isDrawn) await wake($)
    return next(e)
  })

  // A client that draws the band joined (Claude Code Desktop attaches after an SDK-hosted
  // start): the band's work starts now, from a fresh reading.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    if (BAND_SURFACES.has(e.surface) && !isDrawn) {
      isDrawn = true
      await wake($)
    }
    return result
  })

  // The last client that drew the band left: its work stops until one attaches again.
  on('session.detach', async ($, e, next) => {
    const result = await next(e)
    if (BAND_SURFACES.has(e.surface) && !(await isBandSurfaceAttached($))) {
      isDrawn = false
      stopTicker()
    }
    return result
  })

  // `/model`, typed or picked from the badge: read the model back once it ran.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const result = await next(e)
    await refreshModel($)
    return result
  }).catch(($, e, next) => next(e))

  // The engine measured the session: after each main-thread turn (right after its
  // turn.complete), and whenever a rate-limit window moves a whole point, mid-turn too, when
  // `changed` names the context as well. So a measure is a plain reading, never a turn end.
  // Also (re)starts the timer: a /clear ends the session without a new session.start.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (isDrawn) {
      startTicker($)
      await Promise.all([refresh($, { breakdown: false }), refreshEffort($), markActive($)])
    }
    return result
  })

  // A main-thread turn ended (answered, interrupted, refused or failed): its growth, a
  // trend point and a fresh breakdown. Subagents' turns are theirs.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && isDrawn) await refresh($, { isTurnEnd: true })
    return result
  })

  // One model request. The main thread's carries the effort actually sent, and its
  // response the context's size: the meter moves with each request, not only at turn ends.
  // Nothing is awaited before the request goes on.
  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const noted = Promise.all([markActive($), isMain ? noteEffort($, e.effort) : undefined])
    const result = yield* next(e)
    await noted
    const u = result.usage
    if (isMain && u && isDrawn) {
      await refresh($, {
        breakdown: false,
        stepTokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
      })
    }
    return result
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

  // A /clear or an in-process /resume ends the session but the process and this module
  // go on, under a new conversation and with no session.start: keep the timer and start
  // over once the new conversation is in place. Any other end stops the timer.
  on('session.end', ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      try {
        $.clock.after(300, () => void startOver($))
      } catch {
        // no timer: the next measure or prompt still redraws
      }
    } else {
      stopTicker()
    }
    return next(e)
  })

  // A main-conversation compaction (/compact, or auto at the threshold): no measure
  // follows until the next reply, so record what it freed and redraw now. The engine
  // installs the compacted conversation only once every hook returned, so usage() would
  // still read the old fill here: until the next reply, the fill is what the compaction left.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) {
      try {
        await update($, snap, s =>
          s === null
            ? s
            : {
                ...s,
                compaction: { before: result.tokensBefore ?? s.tokens, after: result.tokensAfter },
                tokens: undefined,
                percent: undefined,
                turnBase: undefined,
              },
        )
      } catch {
        // drawing state is best effort
      }
    }
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const [s, trendTokens, tick, isDetailed, eff, awake, isPicking, step, modelName, isModelPicking, whyNoReading, isMono] =
      await Promise.all([
        read($, snap),
        read($, trend),
        read($, frame),
        read($, showDetails),
        read($, effort),
        read($, awakeTick),
        read($, isPickerOpen),
        read($, tweenStep),
        read($, model),
        read($, isModelPickerOpen),
        read($, readError),
        read($, hasMono),
      ])
    // A surface draws the band though none was seen to attach: its work starts, outside this
    // render (a render never writes state).
    if (!isDrawn) {
      isDrawn = true
      try {
        $.clock.after(0, () => void wake($))
      } catch {
        // the next measure or prompt starts it
      }
    }
    const table = $.ui.resolve(e)
    const { Box, Button } = table
    // The band is laid out in cells. The terminal is all cells; Claude Code Desktop draws a
    // Text in its page font unless asked for the monospaced face, so there every Text takes it
    // where the engine has `mono` (2.1.299 on; an older one refuses the band over it), and
    // Clawd is one Svg (block glyphs leave gaps between lines in a page).
    const isCells = e.surface === 'terminal'
    const Text: typeof table.Text = isCells || !isMono ? table.Text : props => table.Text({ ...props, mono: true })
    const Svg = !isCells && 'Svg' in table ? table.Svg : undefined

    // No reading yet: one line, so a surface where readings fail says why instead of drawing nothing.
    if (s === null) {
      return (
        <Box key="context-meter" flexDirection="row" overflow="hidden">
          <Text bold color="claude">
            {METER_LABEL}
          </Text>
          <Text dimColor={whyNoReading === null} color={whyNoReading === null ? undefined : 'warning'}>
            {whyNoReading === null ? WAITING : `reading failed on ${e.surface}: ${whyNoReading}`}
          </Text>
        </Box>
      )
    }
    // the clock, not the reading's time, so the session's length runs between readings
    const now = await $.clock.now().catch(() => s.at)
    const isWorking = e.props.isWorking
    const columns = e.props.bodyColumns
    // A changed number counts from its old value to the new one while `step` runs.
    const shown = (key: string, to: number) => {
      const from = s.from[key]
      return from === undefined || !s.changed.includes(key) ? to : tween(from, to, step)
    }
    // Just compacted, no reply has measured the window yet: draw what the compaction left.
    const compactedTo = s.tokens === undefined ? s.compaction?.after : undefined
    const fillPercent =
      s.percent ?? (compactedTo !== undefined && s.window > 0 ? Math.round((compactedTo / s.window) * 100) : 0)
    const percent = Math.round(shown('percent', fillPercent))
    const compactPercent = s.compactAt !== undefined && s.window > 0 ? (s.compactAt / s.window) * 100 : undefined
    const fill = fillColor(percent, compactPercent)
    // The engine caps the percent at 100: a context bigger than the window (after a switch
    // to a smaller one) is told apart by its tokens.
    const over = s.tokens !== undefined && s.window > 0 && s.tokens > s.window ? s.tokens - s.window : undefined

    const idleTicks = tick - awake
    const isAsleep = !isWorking && idleTicks >= sleepAfterTicks
    // Clawd takes the bar's colour. Fuming, his eyes are squeezed shut already, so he does not
    // blink, and while awake he shakes, a cell to one side each frame.
    const mood = moodFor(fill)
    const isBlinking = !isAsleep && mood !== 'fuming' && tick % BLINK_EVERY === BLINK_EVERY - 1
    const typing = isWorking ? tick : undefined
    const shake = mood === 'fuming' && !isAsleep ? (tick % 2 === 0 ? -1 : 1) : 0
    const zzz = isAsleep ? CLAWD.zzz[Math.floor((idleTicks - sleepAfterTicks) / 2) % CLAWD.zzz.length] : undefined
    const clawd = clawdRows({
      outfit: outfitFor(eff),
      isShut: isAsleep || isBlinking,
      typing,
      zzz: isAsleep ? zzz : undefined,
      mood,
      shake,
    })
    const hasCategories = isDetailed && s.categories.length > 0

    // The picker opens around the badge: lower levels above it, higher ones below, the
    // ultracode switch last. Ultracode rides on top of a level, so the level places the
    // badge either way, and with ultracode on the switch turns it off.
    const levels = EFFORT_CHOICES.filter(c => c !== 'ultracode')
    const at = levels.findIndex(c => c === eff.level)
    const above = isPicking && at >= 0 ? levels.slice(0, at) : []
    const below = isPicking ? [...levels.slice(at + 1), 'ultracode' as const] : []
    // The model picker works the same way: smaller models above the badge, larger ones below.
    const family = modelFamily(modelName ?? s.model)
    const mAt = MODEL_CHOICES.findIndex(c => c === family)
    const mAbove = isModelPicking && mAt >= 0 ? MODEL_CHOICES.slice(0, mAt) : []
    const mBelow = isModelPicking ? MODEL_CHOICES.slice(mAt + 1) : []
    // An open picker column is as tall as its badge and choices.
    const pickerRows = 1 + Math.max(above.length + below.length, mAbove.length + mBelow.length)

    // What the picker columns draw, measured: each column is as wide as its widest entry (the
    // badge and its ▾, or an open choice), with a gap of 2 between the two columns.
    const badge = effortBadge(eff)
    const effortBadgeText = badge ? badge.text : 'effort ?'
    const modelText = `◇ ${modelLabel(modelName ?? s.model)}`
    const effortLook = (choice: (typeof EFFORT_CHOICES)[number]) => {
      const isUltraOff = choice === 'ultracode' && eff.isUltra
      // Options are plain text: the badge's inverse colors need its background, so max is drawn in `error`.
      const look = isUltraOff
        ? { text: '✦ ultracode off', color: 'subtle' }
        : choice === 'ultracode'
          ? { text: '✦ ultracode', color: 'claude' }
          : choice === 'max'
            ? { text: '▲ max', color: 'error' }
            : effortBadge({ level: choice, isUltra: false })
      return {
        text: `${look?.text.trim() ?? choice}  `,
        color: look?.color,
        dimColor: look?.dimColor,
        args: isUltraOff ? 'ultracode off' : choice,
      }
    }
    const modelChoiceText = (choice: ModelChoice) => `◇ ${modelLabel(choice)}  `
    const pickerCells =
      Math.max(cellsOf(modelText) + 2, ...[...mAbove, ...mBelow].map(c => cellsOf(modelChoiceText(c)))) +
      2 +
      Math.max(cellsOf(effortBadgeText) + 2, ...[...above, ...below].map(c => cellsOf(effortLook(c).text)))

    // The meter row's tokens piece in each form, in cells: a margin, the tokens (6 at most, so
    // the row keeps its width while they count up) or the compaction's ~after, then the window.
    const windowText = fmtTokens(s.window)
    const tokensCells = (form: TokensForm) => {
      if (form === 'none') return 0
      if (s.tokens === undefined && compactedTo === undefined) return form === 'full' ? cellsOf(WAITING) : 0
      const suffix = form === 'full' ? ` / ${windowText} tokens` : form === 'short' ? ` / ${windowText}` : ''
      return 1 + (s.tokens === undefined ? 1 : 0) + 6 + cellsOf(suffix)
    }

    // The full band is as tall as Clawd, the stats or an open picker, plus its border. Its stats
    // column is the band less the border and padding (4), Clawd (13), two gaps (4) and the
    // pickers. A slot that cannot hold the band (a short fullscreen terminal), or a stats column
    // too narrow for the bar, the percent and the tokens, gets the one-line meter instead. Where
    // even a picker column does not fit the slot, its choices go in a row.
    const fullRows = Math.max(clawd.length, 3 + (hasCategories ? 1 : 0), pickerRows) + 2
    const statsCells = columns - 21 - pickerCells
    const fullPlan = planMeter(statsCells, tokensCells)
    const isCompact =
      columns < 72 || fullPlan.tokens === 'none' || fullPlan.bar < MIN_BAR || fullRows > e.props.maxRows
    const isPickerRow = pickerRows > e.props.maxRows
    const pickerDirection = isPickerRow ? 'row' : 'column'
    const plan = isCompact ? planMeter(columns - pickerCells, tokensCells) : fullPlan

    // A changed number stays highlighted for HIGHLIGHT_TICKS ticks (about 10 s).
    const isFresh = tick - s.changedTick < HIGHLIGHT_TICKS
    const hl = (key: string) => isFresh && s.changed.includes(key)
    // Green where the number rose, red where it fell; HL_COLOR where the way is unknown.
    const hlColor = (key: string): string => {
      const move = moveOf(s, key)
      return move === undefined ? HL_COLOR : MOVE_COLOR[move]
    }
    const hlSeg = (key: string, text: string): Seg => (hl(key) ? { text, hl: true, color: hlColor(key) } : { text })
    const runs = meterRuns({
      percent: shown('percent', fillPercent),
      prevPercent: hl('percent') ? s.prevPercent : undefined,
      compactFraction: s.compactAt !== undefined && s.window > 0 ? s.compactAt / s.window : undefined,
      width: plan.bar,
    })
    const arrow =
      hl('percent') && s.prevPercent !== undefined ? ((s.percent ?? 0) > s.prevPercent ? '▲' : '▼') : ' '

    const runStyle = (kind: MeterRun['kind']) =>
      kind === 'old'
        ? { color: fill }
        : kind === 'new'
          ? { color: MOVE_COLOR.up, bold: true }
          : kind === 'mark'
            ? { color: 'warning', bold: true }
            : { dimColor: true }

    // The pieces the plan keeps, each whole: the window after the tokens, in its form.
    const windowSuffix = plan.tokens === 'full' ? ` / ${windowText} tokens` : plan.tokens === 'short' ? ` / ${windowText}` : ''
    const tokensPiece =
      plan.tokens === 'none' ? null : s.tokens === undefined && compactedTo !== undefined ? (
        <Box key="tokens" flexDirection="row" flexShrink={0} marginLeft={1}>
          <Text dimColor>{`~${fmtTokens(compactedTo)}`}</Text>
          {windowSuffix ? <Text dimColor>{windowSuffix}</Text> : null}
        </Box>
      ) : s.tokens === undefined ? (
        plan.tokens === 'full' ? (
          <Text dimColor>{WAITING}</Text>
        ) : null
      ) : (
        <Box key="tokens" flexDirection="row" flexShrink={0} marginLeft={1}>
          <Text
            bold={over !== undefined || hl('tokens')}
            color={over !== undefined ? 'error' : hl('tokens') ? hlColor('tokens') : undefined}
            dimColor={over === undefined && !hl('tokens')}
          >
            {fmtTokens(shown('tokens', s.tokens))}
          </Text>
          {windowSuffix ? <Text dimColor>{windowSuffix}</Text> : null}
        </Box>
      )

    // Every piece keeps its own width (flexShrink 0); the plan leaves out what does not fit,
    // and the row clips only as a guard, so a number that grows while counting never draws
    // over its neighbour.
    const meter = (
      <Box key="meter" flexDirection="row" justifyContent="space-between" overflow="hidden">
        <Box key="fill" flexDirection="row" flexShrink={0}>
          {plan.hasLabel ? (
            <Text bold color="claude">
              {METER_LABEL}
            </Text>
          ) : null}
          {runs.map((r, i) => (
            <Text key={`run${i}`} {...runStyle(r.kind)}>
              {r.text}
            </Text>
          ))}
          <Box key="percent" width={PERCENT_CELLS} flexShrink={0}>
            <Text bold color={hl('percent') ? hlColor('percent') : fill}>
              {` ${percent}%${arrow}`}
            </Text>
          </Box>
          {tokensPiece}
        </Box>
      </Box>
    )

    const choiceButton = (choice: (typeof EFFORT_CHOICES)[number]) => {
      const look = effortLook(choice)
      return (
        <Button key={`pick-${choice}`} plain label={look.args} onPress={() => pickEffort($, look.args)}>
          <Text color={look.color} dimColor={look.dimColor}>
            {look.text}
          </Text>
        </Button>
      )
    }
    const effortColumn = (
      <Box key="effort-col" flexDirection={pickerDirection} alignItems="flex-end" flexShrink={0}>
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
            {effortBadgeText}
          </Text>
          <Text dimColor>{isPicking ? ' ▴' : ' ▾'}</Text>
        </Button>
        {below.map(choiceButton)}
      </Box>
    )

    const modelButton = (choice: ModelChoice) => (
      <Button key={`model-${choice}`} plain label={choice} onPress={() => pickModel($, choice)}>
        <Text color="text">{modelChoiceText(choice)}</Text>
      </Button>
    )
    const modelColumn = (
      <Box key="model-col" flexDirection={pickerDirection} alignItems="flex-end" flexShrink={0}>
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
      // Choices in a row take the line: the meter is back once the picker closes.
      return (
        <Box key="context-meter" flexDirection="row" justifyContent="space-between" overflow="hidden">
          {isPickerRow ? null : (
            <Box key="left" flexGrow={1} flexShrink={1} overflow="hidden">
              {meter}
            </Box>
          )}
          {pickers}
        </Box>
      )
    }

    // Rows 2 and 3 keep what fits whole, leaving out the least important groups first (the
    // lowest rank): in row 2 the trend, then the turn's growth; in row 3 the rate limits'
    // resets go first (short forms), then the session's length, the rate limits, the cost last.
    const headroom = s.compactAt !== undefined && s.tokens !== undefined ? s.compactAt - s.tokens : undefined
    const line2: Group[] = []
    // Bigger than the window: the next send compacts first, or with auto-compaction off it fails.
    if (over !== undefined) {
      const then = s.isAutoCompact === false ? '/compact before sending' : 'next send compacts'
      line2.push({
        segs: [{ text: `! ${fmtTokens(over)} over the ${fmtTokens(s.window)} window: ${then}`, color: 'error' }],
        rank: 5,
      })
    }
    // A new window (a model switch) moved the percent, not this turn: say so while it is fresh.
    if (hl('window') && s.windowFrom !== undefined) {
      line2.push({ segs: [hlSeg('window', `window ${fmtTokens(s.windowFrom)} → ${fmtTokens(s.window)}`)], rank: 4 })
    }
    if (s.compactAt !== undefined && over === undefined) {
      // "┊ auto-compact at 167.0k (83.0k left, ~6 turns)" — the same ┊ as the bar's compaction mark
      const seg: Seg[] = [{ text: `┊ auto-compact at ${fmtTokens(s.compactAt)}` }]
      let short: Seg[] | undefined
      if (headroom !== undefined) {
        const left = hlSeg('headroom', fmtTokens(shown('headroom', Math.max(0, headroom))))
        const turns = turnsLeft(trendTokens, headroom)
        const after = turns === undefined ? ' left' : ` left, ${turnsText(turns)}`
        seg.push({ text: ' (' }, left, { text: `${after})` })
        // short: "┊ 83.0k left, ~6 turns"
        short = [{ text: '┊ ' }, left, { text: after }]
      }
      line2.push({ segs: seg, rank: 3, short })
    } else if (s.isAutoCompact === false && s.tokens !== undefined && over === undefined) {
      // no auto-compaction to catch it: the turns until the window is full
      const turns = turnsLeft(trendTokens, s.window - s.tokens)
      if (turns !== undefined) line2.push({ segs: [{ text: `window full in ${turnsText(turns)}` }], rank: 3 })
    }
    // While Claude works, the running turn's growth so far; between turns, the last turn's.
    const turnGrowth =
      isWorking && s.turnBase !== undefined && s.tokens !== undefined
        ? Math.round(shown('tokens', s.tokens) - s.turnBase)
        : 0
    // the sign is the final value's: a count-up passes through 0
    const signed = (n: number, final = n) => `${final > 0 ? '+' : '−'}${fmtTokens(Math.abs(n))}`
    if (turnGrowth !== 0) {
      // the running turn's growth goes by its sign
      const growth: Seg = hl('tokens')
        ? { text: signed(turnGrowth), hl: true, color: MOVE_COLOR[turnGrowth > 0 ? 'up' : 'down'] }
        : { text: signed(turnGrowth) }
      line2.push({ segs: [{ text: 'this turn ' }, growth], rank: 2 })
    } else if (s.compaction !== undefined) {
      // until a turn end measures a real turn again, the compaction is the news;
      // "182.0k → 31.0k" in the colour of its move
      const c = s.compaction
      const text = compactionText(c)
      const move = c.before !== undefined && c.after !== undefined && c.before !== c.after ? (c.after > c.before ? 'up' : 'down') : undefined
      const prefix = 'compacted '
      line2.push({
        segs:
          move === undefined
            ? [{ text }]
            : [{ text: prefix }, { text: text.slice(prefix.length), color: MOVE_COLOR[move], bold: false }],
        rank: 2,
      })
    } else if (s.lastDelta !== undefined && s.lastDelta !== 0) {
      line2.push({ segs: [{ text: 'last turn ' }, hlSeg('delta', signed(shown('delta', s.lastDelta), s.lastDelta))], rank: 2 })
    }
    if (trendTokens.length > 1) {
      // "trend ▁▂▃▅▇ 12→42%", its ends in the colour of their move
      const text = trendText(trendTokens, s.window)
      const ends = text.slice(text.lastIndexOf(' ') + 1)
      const kept = trendTokens.slice(-TREND_LEN)
      const first = kept[0] ?? 0
      const last = kept[kept.length - 1] ?? 0
      const move = last > first ? 'up' : last < first ? 'down' : undefined
      line2.push({
        segs:
          move === undefined
            ? [{ text }]
            : [{ text: text.slice(0, text.length - ends.length) }, { text: ends, color: MOVE_COLOR[move], bold: false }],
        rank: 1,
      })
    }

    const line3: Group[] = [{ segs: [{ text: `session ${duration(now - s.startedAt)}` }], rank: 1 }]
    if (s.usd !== undefined) line3.push({ segs: [hlSeg('usd', `$${shown('usd', s.usd).toFixed(2)}`)], rank: 4 })
    s.limits.forEach((l, i) => {
      const key = `limit:${l.kind}`
      // short: "5h 23%", without when the window resets
      const short: Seg[] = [
        { text: `${LIMIT_NAMES[l.kind] ?? l.kind} ` },
        hlSeg(key, `${Math.round(shown(key, l.percentUsed))}%`),
      ]
      const resets = resetText(l.resetsAt, now)
      line3.push({
        segs: resets === undefined ? short : [...short, { text: ` ${resets}` }],
        rank: i === 0 ? 3 : 2,
        short: resets === undefined ? undefined : short,
      })
    })
    const detailsLabel = isDetailed ? 'hide' : 'details'

    // Pieces keep their width; the row clips at its edge instead of squeezing them onto each other.
    const row = (key: string, groups: Seg[][]) => (
      <Box key={key} flexDirection="row" overflow="hidden" flexShrink={1}>
        {groups.length === 0 ? <Text dimColor> </Text> : null}
        {joinSegs(groups).map((g, i) => (
          <Box key={`${key}${i}`} flexShrink={0}>
            <Text bold={g.bold ?? !isPlain(g)} color={g.color ?? (g.hl ? HL_COLOR : undefined)} dimColor={isPlain(g)}>
              {g.text}
            </Text>
          </Box>
        ))}
      </Box>
    )

    return (
      <Box key="context-meter" borderStyle="round" borderColor="claude" paddingX={1} flexDirection="row" gap={2}>
        <Box key="clawd" flexDirection="column" flexShrink={0}>
          {Svg ? (
            <Svg
              {...clawdSvg(clawd)}
              alt={`Clawd${mood === 'calm' ? '' : `, ${mood}`}${isAsleep ? ', asleep' : isWorking ? ', typing' : ''}`}
            />
          ) : (
            clawd.map((row, r) => (
              <Box key={`clawd${r}`} flexDirection="row">
                {row.map((p, i) => (
                  <Text key={`c${r}-${i}`} color={p.color} backgroundColor={p.bg} bold={p.bold}>
                    {p.text}
                  </Text>
                ))}
              </Box>
            ))
          )}
        </Box>
        <Box key="stats" flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          {meter}
          {row('line2', fitGroups(line2, statsCells))}
          <Box key="line3" flexDirection="row" overflow="hidden">
            {row('line3segs', fitGroups(line3, statsCells - cellsOf(` · ${detailsLabel}`)))}
            <Box key="details-box" flexShrink={0}>
              <Text dimColor>{' · '}</Text>
              <Button
                key="details"
                label={detailsLabel}
                dimColor
                plain
                onPress={() => update($, showDetails, v => !v)}
              />
            </Box>
          </Box>
          {hasCategories ? (
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
