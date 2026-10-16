import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { SessionContextBreakdown, SessionMessage, SessionUsage, TurnStepInput } from 'claude-code'

import {
  bar,
  clawdRows,
  clawdSvg,
  duration,
  outfitFor,
  effortBadge,
  effortRefusal,
  fillColor,
  fmtTokens,
  litKey,
  modelLabel,
  moveOf,
  parseModelOutput,
  meterRuns,
  parseEffortCommand,
  parseEffortOutput,
  savedEffort,
  resetText,
  sleepTicks,
  sparkline,
  takesMono,
  toSnapshot,
  trendText,
  turnsLeft,
  tween,
  fullIn,
  withReadings,
  ttlFrom,
  settingsFrom,
} from '../hooks/register'

const usage = (tokens: number, percent: number): SessionUsage => ({
  startedAt: 0,
  context: { tokens, window: 200_000, percent },
  rateLimits: [{ kind: 'five_hour', percentUsed: 23 }],
  cost: { usd: 1.5 },
})

/** A reading against any window, its percent whole and capped at 100 as the engine gives it. */
const usageIn = (window: number, tokens?: number, breakdown?: SessionContextBreakdown): SessionUsage => ({
  startedAt: 0,
  context: {
    tokens,
    window,
    percent: tokens === undefined ? undefined : Math.min(100, Math.round((tokens / window) * 100)),
    breakdown,
  },
  rateLimits: [{ kind: 'five_hour', percentUsed: 23 }],
  cost: { usd: 1.5 },
})

/** The window broken down as /context does; auto-compaction on when `compactAt` is given. */
const breakdownOf = (o: { window: number; tokens: number; compactAt?: number }): SessionContextBreakdown => ({
  categories: [],
  totalTokens: o.tokens,
  maxTokens: o.window,
  rawMaxTokens: o.window,
  autocompactSource: 'model-default',
  percentage: Math.round((o.tokens / o.window) * 100),
  gridRows: [],
  model: 'claude-sonnet-5-5',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  autoCompactThreshold: o.compactAt,
  isAutoCompactEnabled: o.compactAt !== undefined,
  apiUsage: null,
})

const props = (bodyColumns: number, isWorking = false, maxRows = 20) => ({
  hasSurvey: false,
  isWorking,
  maxRows,
  bodyColumns,
  scroll: { offset: 0, bodyRows: maxRows },
  view: {},
})

const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const

const band = ($: Engine, bodyColumns: number, isWorking = false, maxRows = 20) =>
  $.ui.mount({
    plugin: 'context-meter',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: props(bodyColumns, isWorking, maxRows),
  })

/** The engine answering a model request: nothing streamed, then the response's input-side counts. */
const answer = (contextTokens: () => number) =>
  async function* (_$: unknown, e: TurnStepInput) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'tool_use' as const,
      usage: {
        input_tokens: 2_000,
        cache_read_input_tokens: contextTokens() - 10_000,
        cache_creation_input_tokens: 8_000,
        output_tokens: 900,
        model: 'claude-opus-5-5',
      },
    }
  }

/** One main-thread model request through the chain, as the engine sends it. */
async function request($: Engine, effort?: TurnStepInput['effort']) {
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'claude-opus-5-5',
    messageCount: 4,
    ...(effort === undefined ? {} : { effort }),
  })
  for await (const _ of stream) {
    // the engine above streams nothing
  }
  return stream.result
}

/** A conversation to compact, and the summary a compaction leaves of it. */
const ASKED: SessionMessage = { role: 'user', text: 'fix the meter', toolUses: [] }
const SUMMARY: SessionMessage = { role: 'user', text: 'Summary: the meter was fixed.', toolUses: [] }

/** A main-thread turn ends: the turn completes, then the engine measures the session (the engine's order). */
const turnEnds = async ($: Engine, u: SessionUsage) => {
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1_000, isAborted: false, reason: 'answer' })
  return $.session.measure({ context: u.context, rateLimits: u.rateLimits, cost: u.cost, changed: ['context'] })
}

describe('formatting', () => {
  test('tokens, bar and sparkline', async () => {
    expect(fmtTokens(84_000)).toBe('84.0k')
    expect(fmtTokens(1_200_000)).toBe('1.20M')
    expect(fmtTokens(undefined)).toBe('–')
    const half = bar(50, 10)
    expect(half.filled).toBe('█████')
    expect(half.empty).toBe('░░░░░')
    expect(sparkline([0, 50, 100])).toBe('▁▅█')
    // scaled to the values shown, so a small climb still reads as a climb
    expect(sparkline([40, 42, 44])).toBe('▁▅█')
    // the trend keeps tokens; its percents are of the window the meter shows now
    expect(trendText([24_000, 40_000, 84_000], 200_000)).toBe('trend ▁▃█ 12→42%')
    expect(trendText([24_000, 40_000, 84_000], 1_000_000)).toBe('trend ▁▃█ 2→8%')
    // only the last 8 readings
    const thousands = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => k * 1_000)
    expect(trendText(thousands, 100_000)).toBe('trend ▁▂▃▄▅▆▇█ 3→10%')
    expect(tween(0, 100, 0)).toBe(0)
    expect(tween(0, 100, 60)).toBe(100)
    expect(tween(0, 100, 20)).toBeGreaterThan(50) // ease-out: most of the way early
  })

  test('durations', async () => {
    expect(duration(42 * 60_000)).toBe('42m')
    expect(duration(3 * 3_600_000 + 5 * 60_000)).toBe('3h 5m')
    // a resumed session counts from its first launch, days ago
    expect(duration(26 * 3_600_000 + 5 * 60_000)).toBe('1d 2h')
  })

  test('when a rate-limit window resets', async () => {
    const now = Date.parse('2026-10-15T12:00:00Z')
    expect(resetText('2026-10-15T14:14:30Z', now)).toBe('resets 2h 14m')
    expect(resetText('2026-10-18T16:00:00Z', now)).toBe('resets 3d 4h')
    expect(resetText('2026-10-15T12:00:20Z', now)).toBe('resets <1m')
    // a reading from before the reset, or none, says nothing
    expect(resetText('2026-10-15T11:59:00Z', now)).toBeUndefined()
    expect(resetText(undefined, now)).toBeUndefined()
    expect(resetText('soon', now)).toBeUndefined()
  })

  test('a trend with no window shows tokens', async () => {
    expect(trendText([10_000, 20_000], 0)).toBe('trend ▁█ 10.0k→20.0k')
  })
})

test('band shows fill, tokens, cost and limits; a new reading redraws it', async ($, on) => {
  let current = usage(84_000, 42)
  on('session.usage', () => ({ value: current }))
  on('session.start', () => ({ cwd: '.' }))
  const clock = mock.clock(on, { now: 600_000 })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-meter', surface, component: 'AbovePrompt', props: props(120) })
    expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '84.0k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ' / 200.0k tokens' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.50 · 5h 23%/ })).toBeDefined()
    await ui.unmount()
  }

  current = usage(182_000, 91)
  await turnEnds($, current)

  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  // the changed numbers count up from the old reading…
  expect(await ui.find({ type: 'Text', text: /42%▲/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '84.0k' })).toBeDefined()
  await clock.advance(2000)
  const midway = await ui.find({ type: 'Text', text: /\d+%▲/ })
  const mid = Number(/(\d+)%/.exec(midway?.text ?? '')?.[1])
  expect(mid).toBeGreaterThan(42)
  expect(mid).toBeLessThan(91)
  await clock.advance(4500)
  // …land on the new one, still highlighted: green, as every number that went up
  expect((await ui.find({ type: 'Text', text: /91%▲/ }))?.props.color).toBe('success')
  const tokens = await ui.find({ type: 'Text', text: '182.0k' })
  expect(tokens?.props.bold).toBe(true)
  expect(tokens?.props.color).toBe('success')
  const delta = await ui.find({ type: 'Text', text: '+98.0k' })
  expect(delta?.props.color).toBe('success')
  // the bar's newly filled part, and the trend's rise
  const newRun = (await ui.findAll({ type: 'Text' })).find(t => /^[█▉▊▋▌▍▎▏]+$/.test(t.text ?? '') && t.props.bold)
  expect(newRun?.props.color).toBe('success')
  expect((await ui.find({ type: 'Text', text: '42→91%' }))?.props.color).toBe('success')

  // a drop is red, its arrow too (one this big is a shrink, not the turn's growth)
  current = usage(60_000, 30)
  await turnEnds($, current)
  await clock.advance(6500)
  expect((await ui.find({ type: 'Text', text: /30%▼/ }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: '60.0k' }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: '182.0k → 60.0k' }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: '42→30%' }))?.props.color).toBe('error')
  await ui.unmount()
})

describe('which way a change went', () => {
  const base = toSnapshot(usage(84_000, 42), 0)
  const after = (u: SessionUsage) => toSnapshot(u, 1, base, 5, true)

  test('a rise is up and a fall is down, key by key', async () => {
    const up = after({ ...usage(100_000, 50), cost: { usd: 2 }, rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] })
    for (const key of ['tokens', 'percent', 'usd', 'limit:five_hour', 'delta']) expect(moveOf(up, key), key).toBe('up')
    const down = after({ ...usage(70_000, 35), cost: { usd: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }] })
    for (const key of ['tokens', 'percent', 'usd', 'limit:five_hour', 'delta']) expect(moveOf(down, key), key).toBe('down')
  })

  test('a new window and the headroom go their own way', async () => {
    const smaller = toSnapshot(usageIn(100_000, 84_000), 1, toSnapshot(usageIn(1_000_000, 84_000), 0), 5)
    expect(moveOf(smaller, 'window')).toBe('down')
    const withRoom = (tokens: number) =>
      usageIn(200_000, tokens, breakdownOf({ window: 200_000, tokens, compactAt: 167_000 }))
    const less = toSnapshot(withRoom(120_000), 1, toSnapshot(withRoom(84_000), 0), 5)
    expect(moveOf(less, 'headroom')).toBe('down')
    expect(moveOf(less, 'tokens')).toBe('up')
    // a key that did not move has no way
    expect(moveOf(less, 'usd')).toBeUndefined()
  })
})

describe('bar runs', () => {
  test('newly filled part and the auto-compact mark are separate runs', async () => {
    const runs = meterRuns({ percent: 50, prevPercent: 30, compactFraction: 0.8, width: 10 })
    expect(runs).toEqual([
      { text: '███', kind: 'old' },
      { text: '██', kind: 'new' },
      { text: '░░░', kind: 'empty' },
      { text: '┊', kind: 'mark' },
      { text: '░', kind: 'empty' },
    ])
    expect(meterRuns({ percent: 50, width: 10 })).toEqual([
      { text: '█████', kind: 'old' },
      { text: '░░░░░', kind: 'empty' },
    ])
    expect(fillColor(59)).toBe('claude')
    expect(fillColor(60)).toBe('warning')
    expect(fillColor(80)).toBe('error')
    // with auto-compaction at 50% of the window, 40% is most of the way there
    expect(fillColor(30, 50)).toBe('claude')
    expect(fillColor(40, 50)).toBe('warning')
    expect(fillColor(48, 50)).toBe('error')
  })
})

// 5 minutes of the 100 ms timer: about 3 s alone, more on a busy machine
test('idle Clawd falls asleep with zZzZ after 5 minutes and wakes on a prompt', { timeoutMs: 30_000 }, async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  const clock = mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  expect(await ui.find({ type: 'Text', text: /z/ })).toBeUndefined()
  await clock.advance(4 * 60_000)
  expect(await ui.find({ type: 'Text', text: /[zZ]/ })).toBeUndefined()
  await clock.advance(60_000 + 700 * 4)
  expect(await ui.find({ type: 'Text', text: /[zZ]{2}/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeUndefined()
  // away from the keyboard: legs back in its place
  expect(await ui.find({ type: 'Text', text: '  ▘▘ ▝▝  ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▀ ▀/ })).toBeUndefined()
  await $.prompt.submit({ text: 'wake up', wait: false, origin: { kind: 'composer' } })
  await clock.advance(700)
  expect(await ui.find({ type: 'Text', text: /[zZ]/ })).toBeUndefined()
  await ui.unmount()
})

test('the time Clawd stays awake is a setting', { options: { sleepAfterMinutes: 1 }, timeoutMs: 20_000 }, async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  const clock = mock.clock(on, { now: 600_000 })
  await $.session.start(START)
  const ui = await band($, 120)
  await clock.advance(50_000)
  expect(await ui.find({ type: 'Text', text: /[zZ]/ })).toBeUndefined()
  await clock.advance(10_000 + 700 * 4)
  expect(await ui.find({ type: 'Text', text: /[zZ]{2}/ })).toBeDefined()
  await ui.unmount()
})

test('the sleep setting in frames: 0 never sleeps, a bad value keeps 5 minutes', async () => {
  expect(sleepTicks(5)).toBe(Math.round(300_000 / 700))
  expect(sleepTicks(1)).toBe(Math.round(60_000 / 700))
  expect(sleepTicks(0.5)).toBe(Math.round(30_000 / 700))
  expect(sleepTicks(0)).toBe(Infinity)
  for (const bad of [undefined, -1, Number.NaN, '5', true]) expect(sleepTicks(bad)).toBe(sleepTicks(5))
})

test('on the desktop Clawd is one picture, and from 2.1.299 the band is set in the monospaced face', async ($, on) => {
  on('session.usage', () => ({ value: usage(84_000, 42) }))
  on('session.start', () => ({ cwd: '.' }))
  on('session.version', () => ({ value: { version: '2.1.300', base: '2.1.300' } }))
  mock.clock(on, { now: 600_000 })
  await $.session.start(START)
  const desk = await $.ui.mount({ plugin: 'context-meter', surface: 'desktop', component: 'AbovePrompt', props: props(140) })
  const picture = await desk.find({ type: 'Svg' })
  expect(picture?.props.alt).toBe('Clawd')
  expect(String(picture?.props.source)).toContain('<svg')
  // no block-glyph rows, which a page font draws with gaps between the lines
  expect(await desk.find({ type: 'Text', text: /▐▛███▜▌|▀ ▀/ })).toBeUndefined()
  expect((await desk.find({ type: 'Text', text: '84.0k' }))?.props.mono).toBe(true)
  expect((await desk.find({ type: 'Text', text: /\$1\.50/ }))?.props.mono).toBe(true)
  await desk.unmount()
  // the terminal is all cells already: text Clawd, no mono prop
  const term = await band($, 140)
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeDefined()
  expect((await term.find({ type: 'Text', text: '84.0k' }))?.props.mono).toBeUndefined()
  await term.unmount()
})

// Claude Code Desktop bundles its own engine, 2.1.295 on 2026-10-15, whose Text refuses `mono`:
// a tree naming it draws no band at all.
test('a desktop engine before 2.1.299, or of unknown version, gets no mono prop', async ($, on) => {
  let answer: 'new' | 'old' | 'denied' | 'none' = 'new'
  on('session.usage', () => ({ value: usage(84_000, 42) }))
  on('session.start', () => ({ cwd: '.' }))
  on('session.version', ($, e, next) =>
    answer === 'new'
      ? { value: { version: '2.1.300', base: '2.1.300' } }
      : answer === 'old'
        ? { value: { version: '2.1.295', base: '2.1.295' } }
        : answer === 'denied'
          ? { deny: 'no version here' }
          : next(e),
  )
  mock.clock(on, { now: 600_000 })
  for (const a of ['new', 'old', 'new', 'denied', 'new', 'none'] as const) {
    answer = a
    await $.session.start(START)
    const desk = await $.ui.mount({ plugin: 'context-meter', surface: 'desktop', component: 'AbovePrompt', props: props(140) })
    expect(await desk.find({ type: 'Text', text: '84.0k' }), a).toBeDefined()
    const mono = (await desk.findAll({ type: 'Text' })).filter(t => t.props.mono !== undefined)
    expect(mono.length > 0, `${a}: ${mono.length} Texts with mono`).toBe(a === 'new')
    await desk.unmount()
  }
})

test('mono from 2.1.299 on', async () => {
  expect(takesMono('2.1.299')).toBe(true)
  expect(takesMono('2.1.300')).toBe(true)
  expect(takesMono('2.1.300-dev')).toBe(true)
  expect(takesMono('2.2.0')).toBe(true)
  expect(takesMono('3.0.0')).toBe(true)
  expect(takesMono('2.1.298')).toBe(false)
  expect(takesMono('2.1.295')).toBe(false)
  expect(takesMono('2.0.400')).toBe(false)
  expect(takesMono(undefined)).toBe(false)
  expect(takesMono('nightly')).toBe(false)
})

test('with no reading yet the band is a placeholder that says why', async ($, on) => {
  on('session.usage', () => ({ deny: 'usage unavailable here' }))
  on('session.start', () => ({ cwd: '.' }))
  mock.clock(on, { now: 600_000 })
  await $.session.start(START)
  const desk = await $.ui.mount({ plugin: 'context-meter', surface: 'desktop', component: 'AbovePrompt', props: props(140) })
  expect(await desk.find({ type: 'Text', text: /reading failed on desktop: .*usage unavailable here/ })).toBeDefined()
  await desk.unmount()
})

test('the desktop picture draws every cell of every outfit', async () => {
  for (const outfit of ['none', 'cap', 'cap-bottles', 'cap-bottles-glasses', 'top-hat'] as const) {
    const rows = clawdRows({ outfit, isShut: false, typing: 1 })
    const svg = clawdSvg(rows)
    expect(svg.width).toBe(13 * 8)
    expect(svg.height).toBe(rows.length * 16)
    // every glyph Clawd is drawn with has a shape: no stray text but the zZz
    expect(svg.source).not.toContain('<text')
  }
  const asleep = clawdSvg(clawdRows({ outfit: 'none', isShut: true, zzz: ' zZz     ' }))
  expect(asleep.source).toContain('>Z</text>')
  // theme colours follow the page: the dark theme's, and the light theme's on a light page
  const face = clawdSvg(clawdRows({ outfit: 'cap-bottles', isShut: false })).source
  expect(face).toContain('class="s-text"') // the straws
  expect(face).toContain('@media (prefers-color-scheme: light){')
  expect(face).toMatch(/prefers-color-scheme: light\)\{.*\.f-inverseText\{fill:#ffffff\}/)
  // as in the welcome banner, his open eyes are what ▛ and ▜ leave empty: the cells
  // (columns 4 and 8 of his face row) get no background, so the page shows through
  const bare = clawdSvg(clawdRows({ outfit: 'none', isShut: false })).source
  expect(bare).not.toMatch(/<rect x="(32|64)" y="0" width="8" height="16"/)
})

test('an open picker counts in the band’s height', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  mock.clock(on, { now: 600_000 })
  await $.session.start(START)
  // bare Clawd and the stats fit 8 rows with the border
  const ui = await band($, 140, false, 8)
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeDefined()
  // the effort picker is the badge and six choices: 9 rows with the border, more than the slot
  await ui.press({ key: 'effort' })
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /25%/ })).toBeDefined()
  for (const choice of ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']) {
    expect(await ui.find({ key: `pick-${choice}` })).toBeDefined()
  }
  await ui.unmount()
})

test('a slot too short for a picker column gets its choices in a row', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  mock.clock(on, { now: 600_000 })
  await $.session.start(START)
  const ui = await band($, 140, false, 3)
  expect((await ui.find({ key: 'effort-col' }))?.props.flexDirection).toBe('column')
  await ui.press({ key: 'effort' })
  expect((await ui.find({ key: 'effort-col' }))?.props.flexDirection).toBe('row')
  expect(await ui.find({ key: 'pick-ultracode' })).toBeDefined()
  await ui.unmount()
})

/** Every string an element draws, its children's included, in order. */
const drawn = (node: unknown): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : node !== null && typeof node === 'object' && 'children' in node
      ? ((node as { children?: unknown[] }).children ?? []).map(drawn).join('')
      : ''

/** The cells the pickers take on the right: both badge columns and the gap between them. */
const pickersWidth = async (ui: Awaited<ReturnType<typeof band>>) =>
  [...drawn(await ui.find({ key: 'model-col' }))].length + 2 + [...drawn(await ui.find({ key: 'effort-col' }))].length

describe('nothing is cut mid-figure', () => {
  test('the meter row fits its room at every width', async ($, on) => {
    on('session.usage', () => ({
      value: usageIn(200_000, 84_000, breakdownOf({ window: 200_000, tokens: 84_000, compactAt: 167_000 })),
    }))
    on('session.start', () => ({ cwd: '.' }))
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    for (const columns of [40, 50, 60, 71, 72, 76, 80, 90, 100, 120, 160]) {
      const ui = await band($, columns)
      // the full band: border and padding 4, Clawd 13, two gaps of 2; the one-line meter: the row less the pickers
      const isFull = (await ui.find({ key: 'stats' })) !== undefined
      const room = columns - (await pickersWidth(ui)) - (isFull ? 21 : 0)
      const meter = drawn(await ui.find({ key: 'fill' }))
      expect([...meter].length, `${columns} columns: "${meter}" in ${room} cells`).toBeLessThanOrEqual(room)
      expect(meter).toMatch(/ 42% /)
      await ui.unmount()
    }
  })

  test('rows 2 and 3 show each figure whole or not at all', async ($, on) => {
    let tokens = 20_000
    const reading = (): SessionUsage => ({
      ...usageIn(200_000, tokens, breakdownOf({ window: 200_000, tokens, compactAt: 167_000 })),
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23, resetsAt: new Date(600_000 + 2 * 3_600_000).toISOString() },
        { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(600_000 + 4 * 86_400_000).toISOString() },
      ],
      cost: { usd: 12.5 },
    })
    on('session.usage', () => ({ value: reading() }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    // eight turns: a full trend
    for (let turn = 0; turn < 8; turn++) {
      tokens += 9_000
      await turnEnds($, reading())
    }
    await clock.advance(7000)
    for (const columns of [80, 90, 100, 110, 118, 120, 127, 140, 200]) {
      const ui = await band($, columns)
      const room = columns - (await pickersWidth(ui)) - 21
      const row2 = drawn(await ui.find({ key: 'line2' }))
      const row3 = drawn(await ui.find({ key: 'line3segs' }))
      expect([...row2].length, `${columns} columns: "${row2}" in ${room} cells`).toBeLessThanOrEqual(room)
      // where the auto-compact point does not fit whole, its headroom still shows
      if (columns === 80) expect(row2).toMatch(/^┊ [\d.]+k left/)
      // row 3 ends with " · details"
      expect([...row3].length, `${columns} columns: "${row3}" in ${room - 10} cells`).toBeLessThanOrEqual(room - 10)
      // the resets give way before the session's length, the 7d's first; the percents stay
      if (/resets/.test(row3)) expect(row3).toMatch(/^session /)
      if (/7d 41% resets/.test(row3)) expect(row3).toMatch(/5h 23% resets/)
      await ui.unmount()
    }
    // with room enough, every figure shows
    const wide = await band($, 200)
    expect(drawn(await wide.find({ key: 'line2' }))).toMatch(/auto-compact at 167\.0k .* · last turn \+9\.0k · trend /)
    expect(drawn(await wide.find({ key: 'line3segs' }))).toMatch(
      /session 10m · \$12\.50 · 5h 23% resets 1h 59m · 7d 41% resets 3d 23h/,
    )
    await wide.unmount()
  })
})

test('where nothing draws the band, nothing runs for it until a surface attaches', async ($, on) => {
  let readings = 0
  let polls = 0
  on('session.usage', () => {
    readings++
    return { value: usage(50_000, 25) }
  })
  on('session.model', () => {
    polls++
    return { value: 'claude-opus-5-5' } as never
  })
  on('session.surfaces', () => ({ value: [] }) as never)
  on('session.start', () => ({ cwd: '.' }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', answer(() => 60_000))
  const clock = mock.clock(on, { now: 600_000 })
  // `claude -p` or the SDK: nothing draws
  await $.session.start({ cwd: '.', surface: null, isInteractive: false })
  await request($, 'high')
  await turnEnds($, usage(60_000, 30))
  await clock.advance(5000)
  expect(readings).toBe(0)
  expect(polls).toBe(0)
  // Claude Code Desktop attaches: a fresh reading, and the timer's polls start
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(readings).toBeGreaterThan(0)
  await clock.advance(5000)
  expect(polls).toBeGreaterThan(0)
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'desktop', component: 'AbovePrompt', props: props(140) })
  expect(await ui.find({ type: 'Text', text: '50.0k' })).toBeDefined()
  await ui.unmount()
})

test('a surface that draws the band unannounced starts its work', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.surfaces', () => ({ value: [] }) as never)
  on('session.start', () => ({ cwd: '.' }))
  // the engine's own band, drawn while the mod has nothing to draw
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  const clock = mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: null, isInteractive: false })
  // no session.attach was seen, yet a surface asks for the band
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'desktop', component: 'AbovePrompt', props: props(140) })
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: '50.0k' })).toBeDefined()
  await ui.unmount()
})

test('narrow terminal gets the one-line meter without the mascot', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(60) })
  expect(await ui.find({ type: 'Text', text: /25%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeUndefined()
  await ui.unmount()
})

describe('effort', () => {
  test('louder the higher it goes', async () => {
    const base = { isUltra: false }
    expect(effortBadge(base)).toBeUndefined()
    expect(effortBadge({ ...base, level: 'low' })?.dimColor).toBe(true)
    expect(effortBadge({ ...base, level: 'high' })?.text).toBe('● high')
    expect(effortBadge({ ...base, level: 'xhigh' })?.color).toBe('warning')
    const max = effortBadge({ ...base, level: 'max' })
    expect(max?.text).toBe(' ▲ MAX ')
    expect(max?.backgroundColor).toBe('error')
    expect(effortBadge({ ...base, level: 32_000 })?.text).toBe('effort 32.0k budget')
    const ultra = effortBadge({ ...base, level: 'max', isUltra: true })
    expect(ultra?.text).toBe(' ✦ ULTRACODE · MAX ')
    expect(ultra?.backgroundColor).toBe('claude')
  })

  test('reads what /effort printed', async () => {
    expect(parseEffortOutput('Set effort level to max (this session only): Maximum capability')).toEqual({ level: 'max' })
    expect(
      parseEffortOutput('Ultracode on (this session only): dynamic workflows on every task. Effort stays medium.'),
    ).toEqual({ level: 'medium', isUltra: true })
    expect(
      parseEffortOutput('Set effort level to medium (saved as your default for new sessions): Balanced · Ultracode off'),
    ).toEqual({ level: 'medium', isUltra: false })
    // a prompt that merely mentions it changes nothing
    expect(parseEffortOutput('emphasize the effort if it is max / or ultra code')).toEqual({})
    // what is in force when it is not what was asked: a cap, the environment, a kept level
    expect(
      parseEffortOutput(
        "Effort 'max' exceeds the cap for claude-opus-5-5 set by your settings or organization; set to 'high' instead: Thorough",
      ),
    ).toEqual({ level: 'high' })
    expect(parseEffortOutput('CLAUDE_CODE_EFFORT_LEVEL=medium overrides this session — clear it and max takes over')).toEqual({
      level: 'medium',
    })
    expect(parseEffortOutput('Kept effort level as xhigh')).toEqual({ level: 'xhigh' })
  })

  test('knows a refusal from /effort', async () => {
    expect(effortRefusal('Ultracode needs dynamic workflows enabled (see /config). Valid options are: low, max')).toBeDefined()
    expect(effortRefusal("Ultracode isn't available on claude-haiku-5-5. Valid options are: low, high")).toBeDefined()
    expect(effortRefusal('Failed to set effort level: settings are read-only')).toBeDefined()
    expect(effortRefusal("max is session-scoped and won't reach the remote process. Use low, medium, high, or xhigh instead.")).toBeDefined()
    expect(effortRefusal('Set effort level to max (this session only): Maximum capability')).toBeUndefined()
    expect(effortRefusal('')).toBeUndefined()
  })
})

test('the badge opens a picker that runs /effort', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  const ran: string[] = []
  let level = 'medium'
  on('command.run', { command: 'effort' }, ($, e) => {
    ran.push(e.args)
    // Claude Code's own wording; a level change leaves ultracode alone
    if (e.args === 'ultracode') return { text: `Ultracode on (this session only): workflows. Effort stays ${level}.` } as never
    if (e.args === 'ultracode off') return { text: `Ultracode off. Effort stays ${level}.` } as never
    level = e.args
    return { text: `Set effort level to ${e.args} (this session only)` } as never
  })
  mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  expect(await ui.find({ type: 'Text', text: /ULTRACODE/ })).toBeUndefined()
  await ui.press({ key: 'effort' })
  await ui.press({ key: 'pick-max' })
  expect(ran).toEqual(['max'])
  expect(await ui.find({ type: 'Text', text: ' ▲ MAX ' })).toBeDefined()
  // reopened at max: every lower level is offered, nothing but ultracode beyond it
  await ui.press({ key: 'effort' })
  expect(await ui.find({ key: 'pick-low' })).toBeDefined()
  expect(await ui.find({ key: 'pick-max' })).toBeUndefined()
  expect(await ui.find({ key: 'pick-ultracode' })).toBeDefined()
  // ultracode on puts the magician's hat on; pressing it again switches it off
  await ui.press({ key: 'pick-ultracode' })
  expect(await ui.find({ type: 'Text', text: ' ✦ ULTRACODE · MAX ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▄▄█████▄▄/ })).toBeDefined()
  // a level picked with ultracode on keeps ultracode on, as Claude Code does
  await ui.press({ key: 'effort' })
  await ui.press({ key: 'pick-xhigh' })
  expect(await ui.find({ type: 'Text', text: ' ✦ ULTRACODE · XHIGH ' })).toBeDefined()
  // the switch under the badge turns it off
  await ui.press({ key: 'effort' })
  expect(await ui.find({ type: 'Text', text: /ultracode off/ })).toBeDefined()
  await ui.press({ key: 'pick-ultracode' })
  expect(ran).toEqual(['max', 'ultracode', 'xhigh', 'ultracode off'])
  expect(await ui.find({ type: 'Text', text: /ULTRACODE/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '◆ xhigh' })).toBeDefined()
  await ui.unmount()
})

test('a pick shows even when /effort prints nothing the mod can read', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  on('command.run', { command: 'effort' }, () => ({ text: '' }) as never)
  mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  await ui.press({ key: 'effort' })
  await ui.press({ key: 'pick-max' })
  expect(await ui.find({ type: 'Text', text: ' ▲ MAX ' })).toBeDefined()
  await ui.unmount()
})

test('an effort pick /effort refuses or caps shows what is in force', async ($, on) => {
  const refusal = 'Ultracode needs dynamic workflows enabled (see /config). Valid options are: low, medium, high, xhigh, max'
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  on('command.run', { command: 'effort' }, ($, e) =>
    e.args === 'ultracode'
      ? ({ text: refusal } as never)
      : ({
          text: `Effort '${e.args}' exceeds the cap for claude-opus-5-5 set by your settings or organization; set to 'high' instead: Thorough`,
        } as never),
  )
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  mock.clock(on, { now: 600_000 })
  await $.session.start(START)
  const ui = await band($, 140)
  // refused: no ultracode badge, no top hat, and the reason
  await ui.press({ key: 'effort' })
  await ui.press({ key: 'pick-ultracode' })
  expect(await ui.find({ type: 'Text', text: /ULTRACODE/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /▄▄█████▄▄/ })).toBeUndefined()
  expect(toasts).toEqual([refusal])
  // capped: the level in force
  await ui.press({ key: 'effort' })
  await ui.press({ key: 'pick-max' })
  expect(await ui.find({ type: 'Text', text: /MAX/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '● high' })).toBeDefined()
  await ui.unmount()
})

test('typed /effort arguments', async () => {
  expect(parseEffortCommand('/effort max')).toEqual({ level: 'max' })
  expect(parseEffortCommand('/effort ultracode')).toEqual({ isUltra: true })
  expect(parseEffortCommand('/effort ultracode on')).toEqual({ isUltra: true })
  expect(parseEffortCommand('/effort ultracode off')).toEqual({ isUltra: false })
  expect(parseEffortCommand('/effort')).toBeUndefined()
  expect(parseEffortCommand('/effort auto')).toBeUndefined()
  expect(parseEffortCommand('make the effort max')).toBeUndefined()
})

test('the model badge opens a picker that runs /model', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  let current = 'claude-opus-5-5'
  on('session.model', () => ({ value: current }) as never)
  const ran: string[] = []
  on('command.run', { command: 'model' }, ($, e) => {
    ran.push(e.args)
    current = `claude-${e.args}-5-5`
    return { text: `Set model to ${e.args[0]?.toUpperCase()}${e.args.slice(1)} 5.5 and saved as your default` } as never
  })
  mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  expect(await ui.find({ type: 'Text', text: '◇ Opus 5.5' })).toBeDefined()
  // smaller models above the badge, larger below
  await ui.press({ key: 'model' })
  expect(await ui.find({ key: 'model-haiku' })).toBeDefined()
  expect(await ui.find({ key: 'model-sonnet' })).toBeDefined()
  expect(await ui.find({ key: 'model-opus' })).toBeUndefined()
  expect(await ui.find({ key: 'model-fable' })).toBeDefined()
  // only one picker open at a time
  await ui.press({ key: 'effort' })
  expect(await ui.find({ key: 'model-haiku' })).toBeUndefined()
  await ui.press({ key: 'model' })
  expect(await ui.find({ key: 'pick-low' })).toBeUndefined()
  await ui.press({ key: 'model-sonnet' })
  expect(ran).toEqual(['sonnet'])
  expect(await ui.find({ type: 'Text', text: '◇ Sonnet 5.5' })).toBeDefined()
  await ui.unmount()
})

test('a model switch Claude Code keeps back says so, without advice that does not work', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('command.run', { command: 'model' }, () => ({ text: 'Kept model as `Opus 5.5`' }) as never)
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  await ui.press({ key: 'model' })
  await ui.press({ key: 'model-sonnet' })
  // typing /model sonnet answers the same, so the toast tells nobody to type it
  expect(toasts).toEqual(['Claude Code kept Opus 5.5: /model sonnet did not switch'])
  expect(await ui.find({ type: 'Text', text: '◇ Opus 5.5' })).toBeDefined()
  await ui.unmount()
})

test('model names', async () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('Opus 5.5')).toBe('Opus 5.5')
  expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelLabel('haiku')).toBe('Haiku')
  expect(modelLabel(null)).toBe('model ?')
  // a dated id without a minor version, older ids, the 1M-context variant
  expect(modelLabel('claude-opus-4-20250514')).toBe('Opus 4')
  expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelLabel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5 · 1M')
  expect(parseModelOutput('Kept model as `Opus 5.5`')).toBe('Opus 5.5')
  expect(parseModelOutput('Set model to Sonnet 5.5 and saved as your default for new sessions')).toBe('Sonnet 5.5')
  expect(parseModelOutput('something else')).toBeUndefined()
})

test('saved effort: per-model first, then the top-level default', async () => {
  expect(savedEffort({ effortLevel: 'high', modelSettings: { m: { effortLevel: 'low' } } }, 'm')).toBe('low')
  expect(savedEffort({ effortLevel: 'high' }, 'm')).toBe('high')
  expect(savedEffort({})).toBeUndefined()
  // settings key a model by id; the session may name it as /model shows it
  const settings = { effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } }
  expect(savedEffort(settings, 'Opus 5.5')).toBe('xhigh')
  expect(savedEffort(settings, 'Sonnet 5.5')).toBe('high')
  // the 1M variant is the same model to settings, and a dated id without a minor is its .0
  expect(savedEffort(settings, 'claude-opus-5-5[1m]')).toBe('xhigh')
  expect(savedEffort(settings, 'Opus 5.5 (1M context)')).toBe('xhigh')
  expect(savedEffort({ effortLevel: 'high', modelSettings: { 'claude-opus-4-0': { effortLevel: 'low' } } }, 'claude-opus-4-20250514')).toBe('low')
})

test('working Clawd types on his keyboard, one arm at a time', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  const clock = mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(120, true) })
  const seen = new Set<string>()
  for (let i = 0; i < 4; i++) {
    for (const body of ['▗▜█████▛▘', '▝▜█████▛▖']) {
      if (await ui.find({ type: 'Text', text: body })) seen.add(body)
    }
    await clock.advance(700)
  }
  expect(seen.size).toBe(2)
  await ui.unmount()
})

test('the keyboard has keycaps, and typing lights keys under the arm that is down', async () => {
  const kb = (typing?: number) => clawdRows({ outfit: 'none', isShut: false, typing }).slice(-2)
  const line = (r: ReturnType<typeof kb>[number]) => r.map(p => p.text).join('')
  // two rows of caps on the case: key, spacebar, key; six keys
  expect(kb().map(line)).toEqual(['  ▀ ▀▀▀▀▀ ▀  ', ' ▀ ▀ ▀ ▀ ▀ ▀ '])
  expect(kb().flat().some(p => p.color === 'suggestion')).toBe(false)
  const seen = new Set<string>()
  for (let t = 0; t < 20; t++) {
    const [row, from, to] = litKey(t)
    // left arm down on even frames: a key in the left half (or the spacebar)
    if (from !== 3) expect(t % 2 === 0 ? to <= 5 : from >= 6).toBe(true)
    const lit = kb(t)
      .flat()
      .filter(p => p.color === 'suggestion')
    expect(lit.length).toBe(1)
    expect(lit[0]?.bg).toBe('subtle')
    seen.add(`${row}:${from}`)
  }
  expect(seen.size).toBeGreaterThan(6) // keys change, not one key over and over
})

describe('outfits', () => {
  const colors = (o: Parameters<typeof clawdRows>[0]['outfit']) =>
    new Set(clawdRows({ outfit: o, isShut: false }).flat().map(p => p.color))
  const text = (o: Parameters<typeof clawdRows>[0]['outfit'], isShut = false) =>
    clawdRows({ outfit: o, isShut })
      .map(r => r.map(p => p.text).join(''))
      .join('\n')
  const OUTFITS = ['none', 'cap', 'cap-bottles', 'cap-bottles-glasses', 'top-hat'] as const

  test('effort picks the outfit', async () => {
    expect(outfitFor({ isUltra: false, level: 'low' })).toBe('none')
    expect(outfitFor({ isUltra: false, level: 'medium' })).toBe('cap')
    expect(outfitFor({ isUltra: false, level: 'high' })).toBe('cap-bottles')
    expect(outfitFor({ isUltra: false, level: 'xhigh' })).toBe('cap-bottles-glasses')
    expect(outfitFor({ isUltra: false, level: 'max' })).toBe('top-hat')
    expect(outfitFor({ isUltra: true, level: 'low' })).toBe('top-hat')
  })

  test('each level adds to the last; the top hat stands alone', async () => {
    expect(colors('none').has('suggestion')).toBe(false)
    expect(colors('cap').has('suggestion')).toBe(true)
    expect(colors('cap-bottles').has('success')).toBe(true)
    // the cap faces front (symmetric) and the bottles are strapped to it
    expect(text('cap')).toContain(' ▟█████▙ ')
    expect(text('cap-bottles')).toContain(' █━▟█████▙━█ ')
    expect(text('cap-bottles')).toContain('╰─▐▛███▜▌─╯')
    expect(text('cap-bottles-glasses')).toContain('(●)─(●)')
    // white rims on his orange face
    const rim = clawdRows({ outfit: 'cap-bottles-glasses', isShut: false })
      .flat()
      .find(p => p.text === '(')
    expect(rim?.color).toBe('text')
    expect(rim?.bg).toBe('claude')
    const hat = colors('top-hat')
    expect(hat.has('merged')).toBe(true)
    expect(hat.has('suggestion') || hat.has('success')).toBe(false)
    expect(text('top-hat')).not.toContain('●')
    // the width never changes, so the stats beside him stay put
    for (const o of OUTFITS) {
      for (const row of [...text(o).split('\n'), ...text(o, true).split('\n')]) expect([...row].length).toBe(13)
    }
  })

  test('shut eyes close in every outfit, glasses included', async () => {
    for (const o of OUTFITS) {
      expect(text(o, true)).not.toContain('▐▛')
      expect(text(o, true)).not.toContain('●')
    }
    expect(text('cap-bottles-glasses', true)).toContain('(─)─(─)')
    expect(text('top-hat', true)).toContain('▁███▁')
  })
})

test('Clawd blinks about every four seconds', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  const clock = mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeDefined()
  await clock.advance(700 * 5)
  // shut eyes stay visible: thin dark lines on the orange head
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeUndefined()
  const lid = await ui.find({ type: 'Text', text: '▁' })
  expect(lid?.props.backgroundColor).toBe('claude')
  await clock.advance(700)
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeDefined()
  await ui.unmount()
})

/** Clawd's rows as the terminal band draws them, top to bottom. */
const clawdLines = async (ui: Awaited<ReturnType<typeof band>>) => {
  const lines: string[] = []
  for (let r = 0; ; r++) {
    const row = await ui.find({ key: `clawd${r}` })
    if (row === undefined) return lines
    lines.push(drawn(row))
  }
}

describe('moods', () => {
  const OUTFITS = ['none', 'cap', 'cap-bottles', 'cap-bottles-glasses', 'top-hat'] as const
  const lines = (o: Parameters<typeof clawdRows>[0]) => clawdRows(o).map(r => r.map(p => p.text).join(''))
  const pieces = (o: Parameters<typeof clawdRows>[0]) => clawdRows(o).flat()

  test('annoyed he turns ember and flattens his eyes; fuming, red with his eyes squeezed shut', async () => {
    for (const outfit of OUTFITS) {
      const annoyed = pieces({ outfit, isShut: false, mood: 'annoyed' })
      const fuming = pieces({ outfit, isShut: false, mood: 'fuming' })
      // none of his orange is left
      for (const p of [...annoyed, ...fuming]) expect([p.color, p.bg], outfit).not.toContain('claude')
      expect(annoyed.some(p => p.color === '#e5603f'), outfit).toBe(true)
      expect(fuming.some(p => p.color === '#e5383b'), outfit).toBe(true)
    }
    expect(lines({ outfit: 'none', isShut: false, mood: 'annoyed' })).toContain('   ▐▂███▂▌   ')
    expect(lines({ outfit: 'none', isShut: false, mood: 'fuming' })).toContain('   ▐>███<▌   ')
    // in the glasses, flat eyes sit where the open ones do: a line through the middle of each lens
    expect(lines({ outfit: 'cap-bottles-glasses', isShut: false, mood: 'annoyed' })).toContain(' ╰─(━)─(━)─╯ ')
    expect(lines({ outfit: 'cap-bottles-glasses', isShut: false, mood: 'fuming' })).toContain(' ╰─(>)─(<)─╯ ')
    // his eyes are drawn on his face, as shut ones are: dark on a dark theme, light on a light one
    expect(pieces({ outfit: 'none', isShut: false, mood: 'fuming' }).find(p => p.text === '>')).toMatchObject({
      color: 'inverseText',
      bg: '#e5383b',
    })
    // shut eyes (a blink, or asleep) win over the mood
    expect(lines({ outfit: 'none', isShut: true, mood: 'fuming' })).toContain('   ▐▁███▁▌   ')
    expect(lines({ outfit: 'cap-bottles-glasses', isShut: true, mood: 'annoyed' })).toContain(' ╰─(─)─(─)─╯ ')
  })

  test('fuming, he shakes a cell either way above the keyboard', async () => {
    expect(lines({ outfit: 'none', isShut: false, mood: 'fuming', shake: -1 })).toEqual([
      '  ▐>███<▌    ',
      ' ▝▜█████▛▘   ',
      '  ▀ ▀▀▀▀▀ ▀  ',
      ' ▀ ▀ ▀ ▀ ▀ ▀ ',
    ])
    expect(lines({ outfit: 'none', isShut: false, mood: 'fuming', shake: 1 })).toEqual([
      '    ▐>███<▌  ',
      '   ▝▜█████▛▘ ',
      '  ▀ ▀▀▀▀▀ ▀  ',
      ' ▀ ▀ ▀ ▀ ▀ ▀ ',
    ])
    for (const outfit of OUTFITS) {
      const still = lines({ outfit, isShut: false, mood: 'fuming' })
      for (const shake of [-1, 1]) {
        const moved = lines({ outfit, isShut: false, mood: 'fuming', shake })
        // the keyboard stays put; his hat, cap and bottles move with him; 13 cells always
        expect(moved.slice(-2), `${outfit} ${shake}`).toEqual(still.slice(-2))
        moved.slice(0, -2).forEach((row, i) => {
          const from = still[i] ?? ''
          expect(row, `${outfit} ${shake}`).toBe(shake < 0 ? `${from.slice(1)} ` : ` ${from.slice(0, -1)}`)
        })
        for (const row of moved) expect([...row].length).toBe(13)
      }
    }
  })

  test('his keys flash amber while he fumes', async () => {
    for (let t = 0; t < 4; t++) {
      const lit = pieces({ outfit: 'none', isShut: false, mood: 'fuming', typing: t }).filter(p => p.bold && p.bg === 'subtle')
      expect(lit.map(p => p.color)).toEqual(['warning'])
    }
  })

  test('the desktop picture draws every mood with shapes, in the mood’s colour', async () => {
    for (const mood of ['annoyed', 'fuming'] as const) {
      for (const outfit of OUTFITS) {
        for (const isShut of [false, true]) {
          const svg = clawdSvg(clawdRows({ outfit, isShut, mood, typing: 1, shake: -1 })).source
          expect(svg, `${mood} ${outfit}`).not.toContain('<text')
          expect(svg).toContain(mood === 'annoyed' ? 'fill="#e5603f"' : 'fill="#e5383b"')
          expect(svg).not.toContain('class="f-claude"')
        }
      }
    }
  })

  test('he takes on the bar’s colour as it changes, frame by frame', async ($, on) => {
    let current = usage(84_000, 42)
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 120)
    // his body for each colour of the bar's fill: orange, ember while it warns, red once it is red
    const BODY: Record<string, string> = { claude: 'claude', warning: '#e5603f', error: '#e5383b' }
    const colours = async () => {
      // the bar's fill is the run after the label
      const texts = await ui.findAll({ type: 'Text' })
      const fill = texts[texts.findIndex(t => t.text === 'Context ') + 1]
      return {
        bar: String(fill?.props.color),
        body: (await ui.find({ type: 'Text', text: '▝▜█████▛▘' }))?.props.color,
      }
    }
    const seen = new Set<string>()
    for (const next of [usage(132_000, 66), usage(170_000, 85)]) {
      current = next
      await turnEnds($, current)
      // the bar counts up to its new fill over 6 s, and Clawd changes when it does
      for (let i = 0; i < 10; i++) {
        const { bar, body } = await colours()
        expect(body, `bar ${bar}`).toBe(BODY[bar])
        seen.add(bar)
        await clock.advance(700)
      }
    }
    expect([...seen].sort()).toEqual(['claude', 'error', 'warning'])
    await ui.unmount()
    const desk = await $.ui.mount({ plugin: 'context-meter', surface: 'desktop', component: 'AbovePrompt', props: props(120) })
    const picture = await desk.find({ type: 'Svg' })
    expect(picture?.props.alt).toBe('Clawd, fuming')
    expect(String(picture?.props.source)).toContain('fill="#e5383b"')
    await desk.unmount()
  })

  test('fuming, he shakes every frame and never blinks', async ($, on) => {
    on('session.usage', () => ({ value: usage(170_000, 85) }))
    on('session.start', () => ({ cwd: '.' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 120)
    const seen = new Set<string>()
    // a whole blink period (6 frames), and one more
    for (let i = 0; i < 7; i++) {
      const [eyes, body, ...keyboard] = await clawdLines(ui)
      expect(eyes).toMatch(/▐>███<▌/)
      expect(keyboard).toEqual(['  ▀ ▀▀▀▀▀ ▀  ', ' ▀ ▀ ▀ ▀ ▀ ▀ '])
      seen.add(`${eyes}|${body}`)
      await clock.advance(700)
    }
    expect([...seen].sort()).toEqual(['    ▐>███<▌  |   ▝▜█████▛▘ ', '  ▐>███<▌    | ▝▜█████▛▘   '].sort())
    await ui.unmount()
  })

  test('asleep he stays red, but rests: eyes shut, no shaking', { options: { sleepAfterMinutes: 1 }, timeoutMs: 20_000 }, async ($, on) => {
    on('session.usage', () => ({ value: usage(170_000, 85) }))
    on('session.start', () => ({ cwd: '.' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 120)
    await clock.advance(60_000 + 700 * 4)
    const frames = new Set<string>()
    for (let i = 0; i < 2; i++) {
      const [zzz, ...rest] = await clawdLines(ui)
      expect(zzz).toMatch(/[zZ]/)
      frames.add(rest.join('\n'))
      await clock.advance(700)
    }
    expect([...frames]).toEqual(['   ▐▁███▁▌   \n  ▝▜█████▛▘  \n    ▘▘ ▝▝    '])
    expect((await ui.find({ type: 'Text', text: '▝▜█████▛▘' }))?.props.color).toBe('#e5383b')
    await ui.unmount()
  })
})

describe('model switch', () => {
  test('the meter redraws for the new window at once', async ($, on) => {
    let current = usageIn(1_000_000, 180_000)
    let name = 'claude-opus-5-5[1m]'
    on('session.usage', () => ({ value: current }))
    on('session.model', () => ({ value: name }) as never)
    on('session.start', () => ({ cwd: '.' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: ' / 1.00M tokens' })).toBeDefined()
    // switched before any turn ran: the same 180k, now in a 200k window
    name = 'claude-sonnet-5-5'
    current = usageIn(200_000, 180_000)
    await clock.advance(1500)
    expect(await ui.find({ type: 'Text', text: ' / 200.0k tokens' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /90%/ })).toBeDefined()
    // the jump is the window's, not this turn's: no ▲, a chip says what changed
    expect(await ui.find({ type: 'Text', text: /▲/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /window 1\.00M → 200\.0k/ })).toBeDefined()
    await ui.unmount()
  })

  test('a context bigger than the window says what the next send does', async ($, on) => {
    let current = usageIn(200_000, 350_000, breakdownOf({ window: 200_000, tokens: 350_000, compactAt: 167_000 }))
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    let ui = await band($, 160)
    expect(await ui.find({ type: 'Text', text: /150\.0k over the 200\.0k window: next send compacts/ })).toBeDefined()
    await ui.unmount()
    // with auto-compaction off, the next send fails unless the person compacts first
    current = usageIn(200_000, 350_000, breakdownOf({ window: 200_000, tokens: 350_000 }))
    await $.session.start(START)
    ui = await band($, 160)
    expect(await ui.find({ type: 'Text', text: /150\.0k over the 200\.0k window: \/compact before sending/ })).toBeDefined()
    await ui.unmount()
  })

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

  test('the trend reads tokens, so a smaller window is no spike', async ($, on) => {
    let current = usageIn(1_000_000, 140_000)
    let name = 'claude-opus-5-5[1m]'
    on('session.usage', () => ({ value: current }))
    on('session.model', () => ({ value: name }) as never)
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    current = usageIn(1_000_000, 150_000)
    await turnEnds($, current)
    current = usageIn(1_000_000, 160_000)
    await turnEnds($, current)
    name = 'claude-sonnet-5-5'
    current = usageIn(200_000, 160_000)
    await clock.advance(1500)
    current = usageIn(200_000, 180_000)
    await turnEnds($, current)
    const ui = await band($, 180)
    // 140k, 150k, 160k, 180k: of the 200k window now shown, 70% to 90%
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/trend ▁▃▅█ 70→90%/)
    await ui.unmount()
  })

  test('the badge shows the new model’s saved effort', async ($, on) => {
    let name = 'claude-opus-5-5'
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.model', () => ({ value: name }) as never)
    on(
      'settings.read',
      () => ({ value: { effortLevel: 'high', modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'low' } } } }) as never,
    )
    on('session.start', () => ({ cwd: '.' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: '● high' })).toBeDefined()
    // named as /model shows it; settings key it by id
    name = 'Sonnet 5.5'
    await clock.advance(1500)
    expect(await ui.find({ type: 'Text', text: '· low' })).toBeDefined()
    await ui.unmount()
  })

  test('a model without effort drops the old level from the badge', async ($, on) => {
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.start', () => ({ cwd: '.' }))
    on('turn.step', answer(() => 50_000))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await request($, 'max')
    const ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: ' ▲ MAX ' })).toBeDefined()
    // the new model's requests carry no effort
    await request($)
    await clock.advance(700)
    expect(await ui.find({ type: 'Text', text: /MAX/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /no effort/ })).toBeDefined()
    await ui.unmount()
  })

  test('switching away from a model without effort clears “no effort”', async ($, on) => {
    let name = 'claude-haiku-5-5'
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.model', () => ({ value: name }) as never)
    on('session.start', () => ({ cwd: '.' }))
    on('turn.step', answer(() => 50_000))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await request($)
    const ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: /no effort/ })).toBeDefined()
    name = 'claude-opus-5-5'
    await clock.advance(1500)
    expect(await ui.find({ type: 'Text', text: /no effort/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('readings', () => {
  test('the meter moves with each request of a running turn', async ($, on) => {
    let current = usage(84_000, 42)
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    on('turn.step', answer(() => 120_000))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await request($, 'high')
    await clock.advance(7000)
    let ui = await band($, 140, true)
    expect(await ui.find({ type: 'Text', text: '120.0k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /60%/ })).toBeDefined()
    // while it works, row 2 counts this turn's growth
    expect(await ui.find({ type: 'Text', text: /this turn/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+36\.0k/ })).toBeDefined()
    await ui.unmount()
    // the turn ends: the whole turn's growth, not the last request's
    current = usage(120_000, 60)
    await turnEnds($, current)
    ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+36\.0k/ })).toBeDefined()
    await ui.unmount()
  })

  test('a rate-limit measure in the middle of a turn is not the turn end', async ($, on) => {
    let current = usage(40_000, 20)
    const asked: (string | undefined)[] = []
    on('session.usage', ($, e) => {
      asked.push(e?.breakdown)
      return { value: current }
    })
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    let context = 50_000
    on('turn.step', answer(() => context))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    // turn 1: 40k → 50k
    await request($, 'high')
    current = usage(50_000, 25)
    await turnEnds($, current)
    // turn 2: its first request lands at 80k and moves the 5h window a whole point, so the
    // engine measures mid-turn, and `changed` names the context too (it moved since the last measure)
    context = 80_000
    await request($, 'high')
    current = { ...usage(80_000, 40), rateLimits: [{ kind: 'five_hour', percentUsed: 24 }] }
    asked.length = 0
    await $.session.measure({ context: current.context, rateLimits: current.rateLimits, cost: current.cost, changed: ['context', 'rateLimits'] })
    // a plain reading: no breakdown mid-turn
    expect(asked).toEqual([undefined])
    // its second request lands at 110k, still in the turn
    context = 110_000
    await request($, 'high')
    await clock.advance(7000)
    let ui = await band($, 160, true)
    expect(await ui.find({ type: 'Text', text: /this turn/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+60.0k' })).toBeDefined()
    await ui.unmount()
    // the real turn end: the whole turn's growth, and one trend point per turn (40k, 50k, 110k)
    current = { ...usage(110_000, 55), rateLimits: [{ kind: 'five_hour', percentUsed: 24 }] }
    await turnEnds($, current)
    await clock.advance(7000)
    ui = await band($, 160)
    expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+60.0k' })).toBeDefined()
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/trend ▁▂█ 20→55%/)
    await ui.unmount()
  })

  test('a subagent’s request moves neither the meter nor the badge', async ($, on) => {
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.start', () => ({ cwd: '.' }))
    on('turn.step', answer(() => 150_000))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const stream = $.turn.step({
      turnId: 't2',
      index: 0,
      model: 'claude-haiku-5-5',
      effort: 'max',
      messageCount: 2,
      agentId: 'agent-1',
    })
    for await (const _ of stream) {
      // nothing streamed
    }
    await stream.result
    // past any count-up, the main meter's tokens are still the main conversation's, exactly
    await clock.advance(7000)
    const ui = await band($, 140)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toContain('50.0k')
    expect(texts).not.toContain('150.0k')
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

  for (const reason of ['clear', 'resume'] as const) {
    test(`/${reason} starts the meter over`, async ($, on) => {
      let current: SessionUsage = usage(150_000, 75)
      on('session.usage', () => ({ value: current }))
      on('session.start', () => ({ cwd: '.' }))
      on('session.measure', ($, e) => ({ changed: e.changed }))
      on('turn.complete', () => ({ text: '' }))
      on('session.end', ($, e) => ({ sessionId: e.sessionId }))
      const clock = mock.clock(on, { now: 600_000 })
      await $.session.start(START)
      await $.session.end({ reason, sessionId: 'old', resume: { id: 'old' } })
      current = { startedAt: 600_000, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } }
      await clock.advance(1000)
      const ui = await band($, 140)
      expect(await ui.find({ type: 'Text', text: /75%/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /waiting for the first reply/ })).toBeDefined()
      // the timer still runs before the next turn ends (a measure would restart it):
      // over one blink period, 6 frames, Clawd's eyes both open and shut
      const isShut = new Set<boolean>()
      for (let frame = 0; frame < 6; frame++) {
        isShut.add((await ui.find({ type: 'Text', text: '▁' })) !== undefined)
        await clock.advance(700)
      }
      expect([...isShut].sort()).toEqual([false, true])
      // the next conversation's first turn is not measured against the last one
      current = usage(25_000, 13)
      await turnEnds($, current)
      await clock.advance(7000)
      expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /▼/ })).toBeUndefined()
      await ui.unmount()
    })
  }

  test('a reading taken before /clear and answered after it is dropped', async ($, on) => {
    let current: SessionUsage = usage(150_000, 75)
    let isSlow = false
    let markAsked = () => {}
    const asked = new Promise<void>(resolve => (markAsked = resolve))
    // the engine answers with the figures of the moment it was asked; a slow answer arrives late
    on('session.usage', async ($, e) => {
      const value = current
      if (isSlow) {
        isSlow = false
        markAsked()
        await $.clock.sleep(500)
      }
      return { value }
    })
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    // a turn ends and its reading is slow; /clear runs once it was asked, before it is answered.
    // The engine abandons the old conversation's dispatches when /clear ends it, so the late
    // answer is never written over the fresh reading (a guard: the mod relies on it)
    isSlow = true
    const ending = turnEnds($, current)
    await asked
    await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } })
    current = { startedAt: 600_000, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } }
    await clock.advance(1000)
    await ending
    const ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: /75%/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /waiting for the first reply/ })).toBeDefined()
    // the new conversation's first turn is measured against nothing of the old one
    current = usage(25_000, 13)
    await turnEnds($, current)
    await clock.advance(7000)
    expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /trend/ })).toBeUndefined()
    await ui.unmount()
  })

  test('/compact redraws at once with what it freed', async ($, on) => {
    let current: SessionUsage = usage(182_000, 91)
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 182_000, tokensAfter: 31_000 }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    // the engine installs the compacted conversation once every hook returned: while the
    // hooks run, usage() still reads the old fill; after, no reply has measured the window yet
    await $.session.compact({ trigger: 'manual', messages: [ASKED, SUMMARY] })
    current = { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.5 } }
    await clock.advance(7000)
    const ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: /91%/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /~31\.0k/ })).toBeDefined()
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/compacted 182\.0k → 31\.0k/)
    // a fall, red, but not bold: no fresh number
    const freed = await ui.find({ type: 'Text', text: '182.0k → 31.0k' })
    expect(freed?.props.color).toBe('error')
    expect(freed?.props.bold).toBe(false)
    await ui.unmount()
  })

  test('auto-compaction mid-turn shows no negative turn growth', async ($, on) => {
    let current: SessionUsage = usage(150_000, 75)
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 150_000, tokensAfter: 30_000 }))
    on('turn.step', answer(() => 40_000))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await $.session.compact({ trigger: 'auto', messages: [ASKED, SUMMARY] })
    current = { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.5 } }
    await request($, 'high')
    await clock.advance(7000)
    const ui = await band($, 140, true)
    expect(await ui.find({ type: 'Text', text: /this turn/ })).toBeUndefined()
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/compacted 150\.0k → 30\.0k/)
    await ui.unmount()
  })

  test('after a compaction, the second turn shows its own growth', async ($, on) => {
    let current: SessionUsage = usage(182_000, 91)
    let context = 40_000
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 182_000, tokensAfter: 31_000 }))
    on('turn.step', answer(() => context))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await $.session.compact({ trigger: 'manual', messages: [ASKED, SUMMARY] })
    current = { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.5 } }
    // the first turn after it is measured from nothing: the compaction stays the news
    await request($, 'high')
    current = usage(40_000, 20)
    await turnEnds($, current)
    let ui = await band($, 140)
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/compacted 182\.0k → 31\.0k/)
    await ui.unmount()
    // the second counts its own growth while it runs
    context = 52_000
    await request($, 'high')
    await clock.advance(7000)
    ui = await band($, 140, true)
    expect(await ui.find({ type: 'Text', text: /this turn/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+12\.0k/ })).toBeDefined()
    await ui.unmount()
  })

  test('a session start (a reload) lands a count-up on the new numbers', async ($, on) => {
    let current = usage(84_000, 42)
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    current = usage(182_000, 91)
    await turnEnds($, current)
    await clock.advance(2000)
    // the hooks module reloads mid count-up: session.start runs again
    await $.session.start(START)
    const ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: /91%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '182.0k' })).toBeDefined()
    await ui.unmount()
  })

  // 2 minutes of the 100 ms timer
  test('the session clock and the rate limits’ resets run between readings', { timeoutMs: 20_000 }, async ($, on) => {
    const at = (ms: number) => new Date(600_000 + ms).toISOString()
    on('session.usage', () => ({
      value: {
        ...usage(50_000, 25),
        rateLimits: [
          { kind: 'five_hour', percentUsed: 23, resetsAt: at((2 * 60 + 14) * 60_000 + 30_000) },
          { kind: 'seven_day', percentUsed: 41, resetsAt: at((3 * 24 + 4) * 3_600_000 + 30_000) },
        ],
      },
    }))
    on('session.start', () => ({ cwd: '.' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: /session 10m · \$1\.50 · 5h 23% resets 2h 14m · 7d 41% resets 3d 4h/ })).toBeDefined()
    // the band redraws on Clawd's frames, every 0.7 s: one more frame lands past the minute
    await clock.advance(2 * 60_000 + 700)
    expect(await ui.find({ type: 'Text', text: /session 12m .* 5h 23% resets 2h 12m · 7d 41% resets 3d 3h/ })).toBeDefined()
    await ui.unmount()
  })

  test('a measure that moved only the cost reads no breakdown', async ($, on) => {
    const asked: (string | undefined)[] = []
    on('session.usage', ($, e) => {
      asked.push(e?.breakdown)
      return { value: usage(50_000, 25) }
    })
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    asked.length = 0
    await $.session.measure({ context: usage(50_000, 25).context, rateLimits: [], cost: { usd: 2 }, changed: ['cost'] })
    expect(asked).toEqual([undefined])
  })

  test('the effort is read from /config only while no request has named it', async ($, on) => {
    let listed = 0
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    on('config.list', () => {
      listed++
      return { value: [] } as never
    })
    on('turn.step', answer(() => 50_000))
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    expect(listed).toBe(1)
    await request($, 'high')
    await turnEnds($, usage(50_000, 25))
    expect(listed).toBe(1)
  })

  test('a model without effort is not given a level from /config', async ($, on) => {
    let listed = 0
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    on('config.list', () => {
      listed++
      return { value: [] } as never
    })
    on('turn.step', answer(() => 50_000))
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await request($)
    await turnEnds($, usage(50_000, 25))
    expect(listed).toBe(1)
  })
})

test('a short band slot gets the one-line meter', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  on('turn.step', answer(() => 50_000))
  mock.clock(on, { now: 600_000 })
  await $.session.start(START)
  // bare Clawd is a face, a body and a two-row keyboard: 6 rows with the border
  let ui = await band($, 140, false, 8)
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeDefined()
  await ui.unmount()
  // the magician's hat makes him 10 rows tall, more than the slot holds
  await request($, 'max')
  ui = await band($, 140, false, 8)
  expect(await ui.find({ type: 'Text', text: /25%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /▄▄█████▄▄/ })).toBeUndefined()
  await ui.unmount()
})

describe('turns to compact', () => {
  test('the room left over the recent turns’ growth, rounded up', async () => {
    expect(turnsLeft([100_000, 110_000, 120_000], 47_000)).toBe(5)
    // a compaction's drop is no turn's growth
    expect(turnsLeft([100_000, 120_000, 40_000, 50_000], 60_000)).toBe(4)
    // the last five growths only
    expect(turnsLeft([0, 10_000, 20_000, 30_000, 40_000, 50_000, 150_000], 56_000)).toBe(2)
    // less room than a turn takes: the next one
    expect(turnsLeft([100_000, 110_000, 120_000], 4_000)).toBe(1)
  })

  test('no forecast without two growths, without room, or past 99 turns', async () => {
    expect(turnsLeft([100_000, 110_000], 47_000)).toBeUndefined()
    expect(turnsLeft([100_000, 90_000, 95_000], 47_000)).toBeUndefined()
    expect(turnsLeft([100_000, 110_000, 120_000], 0)).toBeUndefined()
    expect(turnsLeft([0, 1_000, 2_000], 200_000)).toBeUndefined()
  })

  test('row 2 says how many turns are left, to auto-compact or with it off to a full window', async ($, on) => {
    let tokens = 100_000
    let compactAt: number | undefined = 167_000
    const reading = () => usageIn(200_000, tokens, breakdownOf({ window: 200_000, tokens, compactAt }))
    on('session.usage', () => ({ value: reading() }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    for (const t of [110_000, 120_000]) {
      tokens = t
      await turnEnds($, reading())
    }
    await clock.advance(7000)
    const ui = await band($, 200)
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/┊ auto-compact at 167\.0k \(47\.0k left, ~5 turns\)/)
    await ui.unmount()
    compactAt = undefined
    tokens = 130_000
    await turnEnds($, reading())
    await clock.advance(7000)
    const off = await band($, 200)
    expect(drawn(await off.find({ key: 'line2' }))).toMatch(/window full in ~7 turns/)
    await off.unmount()
  })
})

describe('rate-limit pace', () => {
  const M = 60_000
  const RESET = new Date(3 * 3_600_000).toISOString()
  type Paces = Parameters<typeof withReadings>[0]
  /** Readings of the five-hour window, each [time, percent], as the mod keeps them. */
  const keep = (readings: [number, number][], resetsAt = RESET) =>
    readings.reduce<Paces>((p, [at, percentUsed]) => withReadings(p, [{ kind: 'five_hour', percentUsed, resetsAt }], at), {})

  test('the recent pace says when a window runs out', async () => {
    const p = keep([
      [0, 40],
      [6 * M, 46],
      [12 * M, 52],
    ]).five_hour
    // 12 points in 12 minutes: the 48 left last 48 minutes
    expect(fullIn(p, 12 * M)).toBe(48 * M)
    expect(fullIn(p, 13 * M)).toBe(47 * M)
  })

  test('no pace too early, too slow, gone idle, or when the window resets first', async () => {
    expect(fullIn(keep([[0, 40], [5 * M, 46]]).five_hour, 5 * M)).toBeUndefined()
    expect(fullIn(keep([[0, 40], [12 * M, 40.5]]).five_hour, 12 * M)).toBeUndefined()
    const p = keep([[0, 40], [12 * M, 52]]).five_hour
    expect(fullIn(p, 22 * M)).toBe(38 * M)
    expect(fullIn(p, 23 * M)).toBeUndefined()
    expect(fullIn(keep([[0, 40], [12 * M, 52]], new Date(30 * M).toISOString()).five_hour, 12 * M)).toBeUndefined()
    expect(fullIn(keep([[0, 99], [12 * M, 100]]).five_hour, 12 * M)).toBeUndefined()
  })

  test('a new window or a drop starts over; readings keep half an hour, about one a minute', async () => {
    expect(keep([[0, 40], [6 * M, 46], [12 * M, 10]]).five_hour?.samples).toEqual([{ at: 12 * M, percent: 10 }])
    const next = withReadings(keep([[0, 40], [6 * M, 46]]), [{ kind: 'five_hour', percentUsed: 47, resetsAt: 'later' }], 7 * M)
    expect(next.five_hour).toEqual({ resetsAt: 'later', samples: [{ at: 7 * M, percent: 47 }] })
    expect(keep([[0, 10], [20 * M, 20], [40 * M, 30]]).five_hour?.samples).toEqual([
      { at: 20 * M, percent: 20 },
      { at: 40 * M, percent: 30 },
    ])
    expect(keep([[0, 10], [10_000, 11], [20_000, 12], [90_000, 13]]).five_hour?.samples).toEqual([
      { at: 0, percent: 10 },
      { at: 20_000, percent: 12 },
      { at: 90_000, percent: 13 },
    ])
    // a window that is no longer reported is dropped
    expect(withReadings(keep([[0, 10]]), [], M)).toEqual({})
  })

  test('row 3 warns, in red, when a window runs out before it resets', { timeoutMs: 30_000 }, async ($, on) => {
    let percentUsed = 40
    const reading = (): SessionUsage => ({
      ...usage(84_000, 42),
      rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: new Date(600_000 + 3 * 3_600_000).toISOString() }],
    })
    on('session.usage', () => ({ value: reading() }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    for (const p of [46, 52]) {
      await clock.advance(6 * M)
      percentUsed = p
      const u = reading()
      await $.session.measure({ context: u.context, rateLimits: u.rateLimits, cost: u.cost, changed: ['rateLimits'] })
    }
    const ui = await band($, 200)
    expect(drawn(await ui.find({ key: 'line3segs' }))).toMatch(/5h \d+% full in ~48m, resets 2h 48m/)
    expect((await ui.find({ type: 'Text', text: 'full in ~48m' }))?.props.color).toBe('error')
    await ui.unmount()
  })
})

describe('cold cache', () => {
  const M = 60_000
  const used = (read: number, written: number, input = 2_000) => ({
    input_tokens: input,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: written,
    output_tokens: 900,
  })

  test('a request sent a while after the last reply tells how long the cache lives', async () => {
    // still read from the cache after 10 minutes: it lives an hour
    expect(ttlFrom(10 * M, used(50_000, 8_000))).toBe('1h')
    // written again after 10 minutes: it lives 5
    expect(ttlFrom(10 * M, used(0, 58_000))).toBe('5m')
    // too soon or too late to tell, too small, or neither
    expect(ttlFrom(3 * M, used(0, 58_000))).toBeUndefined()
    expect(ttlFrom(70 * M, used(50_000, 8_000))).toBeUndefined()
    expect(ttlFrom(10 * M, used(300, 100, 100))).toBeUndefined()
    expect(ttlFrom(10 * M, used(20_000, 20_000, 20_000))).toBeUndefined()
  })

  /** The engine answering a main request with these cache counts. */
  const answering = (counts: () => ReturnType<typeof used>) =>
    async function* (_$: unknown, e: TurnStepInput) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { ...counts(), model: 'claude-opus-5-5' },
      }
    }

  test('idle past the cache’s lifetime, row 2 says the next send re-writes it', { timeoutMs: 30_000 }, async ($, on) => {
    let read = 50_000
    const stored: Record<string, unknown> = {}
    on('store.get', ($, e) => ({ value: stored[e.key] }) as never)
    on('store.set', ($, e) => {
      stored[e.key] = e.value
      return { value: undefined } as never
    })
    on('session.usage', () => ({ value: usage(60_000, 30) }))
    on('session.start', () => ({ cwd: '.' }))
    on('turn.step', answering(() => used(read, 58_000 - read)))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await request($, 'high')
    const ui = await band($, 200)
    // how much of the last request the cache served
    expect(drawn(await ui.find({ key: 'line3segs' }))).toMatch(/ · cache 83% · /)
    // its lifetime is not known yet: no warning before an hour
    await clock.advance(6 * M)
    expect(drawn(await ui.find({ key: 'line2' }))).not.toMatch(/cache cold/)
    // the next request wrote it all again: it lives 5 minutes, and that is kept
    read = 0
    await request($, 'high')
    expect(stored.cacheTtl).toBe('5m')
    expect(drawn(await ui.find({ key: 'line3segs' }))).toMatch(/cache 0%/)
    await clock.advance(4 * M)
    expect(drawn(await ui.find({ key: 'line2' }))).not.toMatch(/cache cold/)
    await clock.advance(M + 1_000)
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/^cache cold: next send re-writes 60\.0k/)
    expect((await ui.find({ type: 'Text', text: /cache cold/ }))?.props.color).toBe('warning')
    // a request warms it again
    read = 50_000
    await request($, 'high')
    expect(drawn(await ui.find({ key: 'line2' }))).not.toMatch(/cache cold/)
    await ui.unmount()
  })

  test('a new cache tells nothing of its lifetime: after a compaction, on another effort, after /clear', { timeoutMs: 30_000 }, async ($, on) => {
    let read = 50_000
    const stored: Record<string, unknown> = {}
    on('store.get', ($, e) => ({ value: stored[e.key] }) as never)
    on('store.set', ($, e) => {
      stored[e.key] = e.value
      return { value: undefined } as never
    })
    on('session.usage', () => ({ value: usage(60_000, 30) }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 60_000, tokensAfter: 20_000 }))
    on('turn.step', answering(() => used(read, 58_000 - read)))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await request($, 'high')
    await $.session.compact({ trigger: 'manual', messages: [ASKED, SUMMARY] })
    await clock.advance(6 * M)
    read = 0
    await request($, 'high')
    expect(stored.cacheTtl).toBeUndefined()
    await clock.advance(6 * M)
    await request($, 'low')
    expect(stored.cacheTtl).toBeUndefined()
    // the same cache past 5 minutes: now it tells
    await clock.advance(6 * M)
    await request($, 'low')
    expect(stored.cacheTtl).toBe('5m')
    // a new conversation has served nothing from the cache yet
    await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } })
    await clock.advance(1000)
    const ui = await band($, 200)
    expect(drawn(await ui.find({ key: 'line3segs' }))).not.toMatch(/cache/)
    await ui.unmount()
  })

  test('a lifetime learned in an earlier session holds from the start', { timeoutMs: 30_000 }, async ($, on) => {
    on('store.get', ($, e) => ({ value: e.key === 'cacheTtl' ? '5m' : undefined }) as never)
    on('session.usage', () => ({ value: usage(60_000, 30) }))
    on('session.start', () => ({ cwd: '.' }))
    on('turn.step', answering(() => used(50_000, 8_000)))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await request($, 'high')
    await clock.advance(5 * M + 1_000)
    const ui = await band($, 200)
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/^cache cold/)
    // while Claude works, the cache is in use: no warning
    const working = await band($, 200, true)
    expect(drawn(await working.find({ key: 'line2' }))).not.toMatch(/cache cold/)
    await working.unmount()
    await ui.unmount()
  })
})

describe('timers', () => {
  test('idle, one timer runs at the frame rate; the fast one only while a number counts', { timeoutMs: 30_000 }, async ($, on) => {
    const periods: number[] = []
    // one probe per period the mod could ask for, above the mock clock's own hook (a second
    // unmatched clock.every hook is refused)
    for (const ms of [100, 700]) {
      on('clock.every', { ms }, ($, e, next) => {
        periods.push(e.ms)
        return next(e)
      })
    }
    const clock = mock.clock(on, { now: 600_000 })
    let current = usage(50_000, 25)
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    await $.session.start(START)
    await clock.advance(7_000)
    periods.length = 0
    await clock.advance(60_000)
    // a frame each 0.7 s (the polls ride every second one), nothing faster
    expect(periods.filter(ms => ms < 700)).toEqual([])
    expect(periods.length).toBeGreaterThanOrEqual(84)
    expect(periods.length).toBeLessThanOrEqual(87)
    // a turn end counts up for 6 s on the fast timer, which then stops
    periods.length = 0
    current = usage(80_000, 40)
    await turnEnds($, current)
    await clock.advance(10_000)
    const fast = periods.filter(ms => ms === 100).length
    expect(fast).toBeGreaterThanOrEqual(58)
    expect(fast).toBeLessThanOrEqual(62)
  })

  test('a reading in the middle of a turn counts up in a second', async ($, on) => {
    let context = 50_000
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.start', () => ({ cwd: '.' }))
    on('turn.step', answer(() => context))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await clock.advance(7_000)
    const ui = await band($, 140, true)
    context = 90_000
    await request($, 'high')
    await clock.advance(1_100)
    expect(await ui.find({ type: 'Text', text: '90.0k' })).toBeDefined()
    await ui.unmount()
  })
})

describe('a fill that falls without a compaction seen', () => {
  test('is a shrink, not a turn; the next turn counts from there', async ($, on) => {
    let current = usage(182_000, 91)
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    // an organisation-managed install runs no session.compact hook of the mod's
    current = usage(31_000, 16)
    await turnEnds($, current)
    await clock.advance(7_000)
    const ui = await band($, 200)
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/shrank 182\.0k → 31\.0k/)
    expect(drawn(await ui.find({ key: 'line2' }))).not.toMatch(/last turn/)
    current = usage(40_000, 20)
    await turnEnds($, current)
    await clock.advance(7_000)
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/last turn \+9\.0k/)
    expect(drawn(await ui.find({ key: 'line2' }))).not.toMatch(/shrank/)
    // a small drop is still the turn's own
    current = usage(36_000, 18)
    await turnEnds($, current)
    await clock.advance(7_000)
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/last turn −4\.0k/)
    await ui.unmount()
  })
})

describe('compact button', () => {
  test('once the bar warns, row 3 offers to compact, after a confirm', async ($, on) => {
    let compactions = 0
    on('session.usage', () => ({ value: usage(170_000, 85) }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.compact', () => {
      compactions++
      return { messages: [SUMMARY], tokensBefore: 170_000, tokensAfter: 31_000 }
    })
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 200)
    expect((await ui.find({ key: 'compact' }))?.props.label).toBe('compact')
    // a press asks first
    await ui.press({ key: 'compact' })
    expect(compactions).toBe(0)
    expect(await ui.find({ type: 'Text', text: 'compact now? ' })).toBeDefined()
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
    await ui.press({ key: 'compact-no' })
    expect(await ui.find({ key: 'compact-yes' })).toBeUndefined()
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    expect(compactions).toBe(0)
    await ui.press({ key: 'compact' })
    await ui.press({ key: 'compact-yes' })
    expect(compactions).toBe(1)
    // what it left, and no button once the bar is orange again
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/compacted 170\.0k → 31\.0k/)
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
    await ui.unmount()
  })

  test('no button while the bar is orange or Claude works', async ($, on) => {
    let current = usage(84_000, 42)
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const calm = await band($, 200)
    expect(await calm.find({ key: 'compact' })).toBeUndefined()
    await calm.unmount()
    current = usage(170_000, 85)
    await $.session.start(START)
    // once the bar has counted up to red, the button is there between turns only
    await clock.advance(7000)
    const idle = await band($, 200)
    expect(await idle.find({ key: 'compact' })).toBeDefined()
    await idle.unmount()
    const working = await band($, 200, true)
    expect(await working.find({ key: 'compact' })).toBeUndefined()
    await working.unmount()
  })

  test('a prompt moves on from an unanswered confirm', async ($, on) => {
    on('session.usage', () => ({ value: usage(170_000, 85) }))
    on('session.start', () => ({ cwd: '.' }))
    on('prompt.submit', ($, e) => ({ text: e.text }) as never)
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 200)
    await ui.press({ key: 'compact' })
    expect(await ui.find({ key: 'compact-yes' })).toBeDefined()
    await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
    expect(await ui.find({ key: 'compact-yes' })).toBeUndefined()
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    await ui.unmount()
  })

  test('a compaction Claude Code skips says why, and the button comes back', async ($, on) => {
    const toasts: string[] = []
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined } as never
    })
    on('session.usage', () => ({ value: usage(170_000, 85) }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.compact', () => ({ skip: 'a hook kept the conversation as it is' }))
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 200)
    await ui.press({ key: 'compact' })
    await ui.press({ key: 'compact-yes' })
    expect(toasts).toEqual(['Not compacted: a hook kept the conversation as it is'])
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    await ui.unmount()
  })
})

describe('settings', () => {
  const MODELS = ['haiku', 'sonnet', 'opus', 'fable']

  test('defaults, and a bad value keeps its default', async () => {
    expect(settingsFrom(undefined)).toEqual({
      showClawd: true,
      reduceMotion: false,
      layout: 'auto',
      showCost: true,
      showRateLimits: true,
      showCompactButton: true,
      warnAt: 75,
      alertAt: 95,
      cacheLifetime: 'auto',
      models: MODELS,
    })
    expect(
      settingsFrom({ layout: 'tall', cacheLifetime: '2h', warnAt: 0, alertAt: 120, models: ' , ', showClawd: 'no' }),
    ).toMatchObject({ layout: 'auto', cacheLifetime: 'auto', warnAt: 75, alertAt: 95, models: MODELS, showClawd: true })
    // an alert before the warning: both keep their defaults
    expect(settingsFrom({ warnAt: 90, alertAt: 80 })).toMatchObject({ warnAt: 75, alertAt: 95 })
    expect(settingsFrom({ warnAt: 50, alertAt: 50 })).toMatchObject({ warnAt: 50, alertAt: 50 })
    // models as /model takes them, once each, in order
    expect(settingsFrom({ models: 'sonnet, opus[1m] best opus[1m] -x claude-opus-4-1' }).models).toEqual([
      'sonnet',
      'opus[1m]',
      'best',
      'claude-opus-4-1',
    ])
  })

  test('the bar’s thresholds, toward auto-compact or with none known toward 80% of the window', async () => {
    expect(fillColor(24, 50, 50, 60)).toBe('claude')
    expect(fillColor(25, 50, 50, 60)).toBe('warning')
    expect(fillColor(30, 50, 50, 60)).toBe('error')
    expect(fillColor(39, undefined, 50, 60)).toBe('claude')
    expect(fillColor(40, undefined, 50, 60)).toBe('warning')
    expect(fillColor(48, undefined, 50, 60)).toBe('error')
  })

  test('with Clawd hidden the stats stand alone', { options: { showClawd: false } }, async ($, on) => {
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.start', () => ({ cwd: '.' }))
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 120)
    expect(await ui.find({ key: 'clawd' })).toBeUndefined()
    expect(await ui.find({ key: 'stats' })).toBeDefined()
    await ui.unmount()
    // his 15 cells go to the bar: at 100 columns a 33-cell bar, a 67-cell meter row (beside him 18 and 52)
    const narrow = await band($, 100)
    expect([...drawn(await narrow.find({ key: 'fill' }))].length).toBe(67)
    await narrow.unmount()
    const desk = await $.ui.mount({ plugin: 'context-meter', surface: 'desktop', component: 'AbovePrompt', props: props(120) })
    expect(await desk.find({ type: 'Svg' })).toBeUndefined()
    expect(await desk.find({ key: 'stats' })).toBeDefined()
    await desk.unmount()
  })

  test('with motion reduced numbers land at once and Clawd keeps still', { options: { reduceMotion: true } }, async ($, on) => {
    let current = usage(84_000, 42)
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 120, true)
    current = usage(170_000, 85)
    await turnEnds($, current)
    expect(await ui.find({ type: 'Text', text: /85%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '170.0k' })).toBeDefined()
    // working and fuming, yet no typing, blinking or shaking: one drawing every frame
    const frames = new Set<string>()
    for (let i = 0; i < 7; i++) {
      frames.add((await clawdLines(ui)).join('\n'))
      await clock.advance(700)
    }
    expect([...frames]).toHaveLength(1)
    expect([...frames][0]).toMatch(/▐>███<▌/)
    await ui.unmount()
  })

  test('with motion reduced the fast timer never runs', { options: { reduceMotion: true } }, async ($, on) => {
    let fast = 0
    on('clock.every', { ms: 100 }, ($, e, next) => {
      fast++
      return next(e)
    })
    let current = usage(84_000, 42)
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('turn.complete', () => ({ text: '' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    current = usage(120_000, 60)
    await turnEnds($, current)
    await clock.advance(7_000)
    expect(fast).toBe(0)
  })

  test('the one-line layout everywhere', { options: { layout: 'one-line' } }, async ($, on) => {
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.start', () => ({ cwd: '.' }))
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 200)
    expect(await ui.find({ key: 'stats' })).toBeUndefined()
    expect(await ui.find({ key: 'clawd' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /25%/ })).toBeDefined()
    await ui.unmount()
  })

  test(
    'cost, rate limits and the compact button can each be hidden',
    { options: { showCost: false, showRateLimits: false, showCompactButton: false } },
    async ($, on) => {
      on('session.usage', () => ({ value: usage(170_000, 85) }))
      on('session.start', () => ({ cwd: '.' }))
      mock.clock(on, { now: 600_000 })
      await $.session.start(START)
      const ui = await band($, 200)
      const row3 = drawn(await ui.find({ key: 'line3segs' }))
      expect(row3).toMatch(/^session /)
      expect(row3).not.toMatch(/\$|5h/)
      expect(await ui.find({ key: 'compact' })).toBeUndefined()
      await ui.unmount()
    },
  )

  test('the bar and Clawd follow the thresholds set', { options: { warnAt: 40, alertAt: 50 } }, async ($, on) => {
    on('session.usage', () => ({ value: usage(84_000, 42) }))
    on('session.start', () => ({ cwd: '.' }))
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 120)
    // 42% is 52.5% of the way to 80% of the window: past the alert
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts[texts.findIndex(t => t.text === 'Context ') + 1]?.props.color).toBe('error')
    expect((await ui.find({ type: 'Text', text: '▝▜█████▛▘' }))?.props.color).toBe('#e5383b')
    await ui.unmount()
  })

  test('a cache lifetime set overrides the one learned', { options: { cacheLifetime: '5m' }, timeoutMs: 30_000 }, async ($, on) => {
    on('session.usage', () => ({ value: usage(60_000, 30) }))
    on('session.start', () => ({ cwd: '.' }))
    on('turn.step', answer(() => 60_000))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await request($, 'high')
    await clock.advance(5 * 60_000 + 1_000)
    const ui = await band($, 200)
    expect(drawn(await ui.find({ key: 'line2' }))).toMatch(/^cache cold/)
    await ui.unmount()
  })

  test('an hour set holds over a learned 5 minutes', { options: { cacheLifetime: '1h' }, timeoutMs: 30_000 }, async ($, on) => {
    mock.store(on, { cacheTtl: '5m' })
    on('session.usage', () => ({ value: usage(60_000, 30) }))
    on('session.start', () => ({ cwd: '.' }))
    on('turn.step', answer(() => 60_000))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    await request($, 'high')
    await clock.advance(6 * 60_000)
    const ui = await band($, 200)
    expect(drawn(await ui.find({ key: 'line2' }))).not.toMatch(/cache cold/)
    await ui.unmount()
  })

  test('the model picker lists the models set', { options: { models: 'sonnet, opus[1m] best' } }, async ($, on) => {
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
    const ran: string[] = []
    on('command.run', { command: 'model' }, ($, e) => {
      ran.push(e.args)
      return { text: 'Set model to Opus 5.5 · 1M' } as never
    })
    mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 140)
    await ui.press({ key: 'model' })
    for (const m of ['sonnet', 'opus[1m]', 'best']) expect(await ui.find({ key: `model-${m}` }), m).toBeDefined()
    for (const m of ['haiku', 'opus', 'fable']) expect(await ui.find({ key: `model-${m}` }), m).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '◇ Opus · 1M  ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '◇ best  ' })).toBeDefined()
    await ui.press({ key: 'model-opus[1m]' })
    expect(ran).toEqual(['opus[1m]'])
    await ui.unmount()
  })
})
