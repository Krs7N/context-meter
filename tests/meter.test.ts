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
  fillColor,
  fmtTokens,
  litKey,
  modelLabel,
  parseModelOutput,
  meterRuns,
  parseEffortCommand,
  parseEffortOutput,
  savedEffort,
  sparkline,
  trendText,
  tween,
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

/** A main-thread turn ends: the engine measures the session. */
const turnEnds = ($: Engine, u: SessionUsage) =>
  $.session.measure({ context: u.context, rateLimits: u.rateLimits, cost: u.cost, changed: ['context'] })

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
  await $.session.measure({ context: current.context, rateLimits: current.rateLimits, cost: current.cost, changed: ['context'] })

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
  // …land on the new one, still highlighted
  expect(await ui.find({ type: 'Text', text: /91%▲/ })).toBeDefined()
  const tokens = await ui.find({ type: 'Text', text: '182.0k' })
  expect(tokens?.props.bold).toBe(true)
  expect(tokens?.props.color).toBe('suggestion')
  const delta = await ui.find({ type: 'Text', text: '+98.0k' })
  expect(delta?.props.color).toBe('suggestion')
  await ui.unmount()
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

test('idle Clawd falls asleep with zZzZ and wakes on a prompt', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  const clock = mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  expect(await ui.find({ type: 'Text', text: /z/ })).toBeUndefined()
  await clock.advance(2 * 60_000)
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

test('on the desktop Clawd is one picture and the band is set in the monospaced face', async ($, on) => {
  on('session.usage', () => ({ value: usage(84_000, 42) }))
  on('session.start', () => ({ cwd: '.' }))
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
  // the theme's text colour (straws, rims) follows a light page
  expect(clawdSvg(clawdRows({ outfit: 'cap-bottles', isShut: false })).source).toContain('class="ts"')
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
    expect(await ui.find({ type: 'Text', text: /trend ▁▃▅█ 70→90%/ })).toBeDefined()
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

  test('a subagent’s request moves neither the meter nor the badge', async ($, on) => {
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.start', () => ({ cwd: '.' }))
    on('turn.step', answer(() => 150_000))
    mock.clock(on, { now: 600_000 })
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

  for (const reason of ['clear', 'resume'] as const) {
    test(`/${reason} starts the meter over`, async ($, on) => {
      let current: SessionUsage = usage(150_000, 75)
      on('session.usage', () => ({ value: current }))
      on('session.start', () => ({ cwd: '.' }))
      on('session.measure', ($, e) => ({ changed: e.changed }))
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

  test('/compact redraws at once with what it freed', async ($, on) => {
    let current: SessionUsage = usage(182_000, 91)
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 182_000, tokensAfter: 31_000 }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    // just compacted: no reply has measured the window yet
    current = { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.5 } }
    await $.session.compact({ trigger: 'manual', messages: [ASKED, SUMMARY] })
    await clock.advance(7000)
    const ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: /91%/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /~31\.0k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /compacted 182\.0k → 31\.0k/ })).toBeDefined()
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
    current = { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.5 } }
    await $.session.compact({ trigger: 'auto', messages: [ASKED, SUMMARY] })
    await request($, 'high')
    await clock.advance(7000)
    const ui = await band($, 140, true)
    expect(await ui.find({ type: 'Text', text: /this turn/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /compacted 150\.0k → 30\.0k/ })).toBeDefined()
    await ui.unmount()
  })

  test('after a compaction, the second turn shows its own growth', async ($, on) => {
    let current: SessionUsage = usage(182_000, 91)
    let context = 40_000
    on('session.usage', () => ({ value: current }))
    on('session.start', () => ({ cwd: '.' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 182_000, tokensAfter: 31_000 }))
    on('turn.step', answer(() => context))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    current = { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 1.5 } }
    await $.session.compact({ trigger: 'manual', messages: [ASKED, SUMMARY] })
    // the first turn after it is measured from nothing: the compaction stays the news
    await request($, 'high')
    current = usage(40_000, 20)
    await turnEnds($, current)
    let ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: /compacted 182\.0k → 31\.0k/ })).toBeDefined()
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

  test('the session clock runs between readings', async ($, on) => {
    on('session.usage', () => ({ value: usage(50_000, 25) }))
    on('session.start', () => ({ cwd: '.' }))
    const clock = mock.clock(on, { now: 600_000 })
    await $.session.start(START)
    const ui = await band($, 140)
    expect(await ui.find({ type: 'Text', text: /session 10m/ })).toBeDefined()
    // the band redraws on Clawd's frames, every 0.7 s: one more frame lands past the minute
    await clock.advance(2 * 60_000 + 700)
    expect(await ui.find({ type: 'Text', text: /session 12m/ })).toBeDefined()
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
