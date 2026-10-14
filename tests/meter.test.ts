import { describe, expect, mock, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import {
  bar,
  effortBadge,
  fillColor,
  fmtTokens,
  meterRuns,
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

const props = (bodyColumns: number, isWorking = false) => ({
  hasSurvey: false,
  isWorking,
  maxRows: 20,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
})

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
    expect(trendText([12, 20, 42])).toBe('trend ▁▃█ 12→42%')
    // only the last 8 readings
    expect(trendText([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe('trend ▁▂▃▄▅▆▇█ 3→10%')
    expect(tween(0, 100, 0)).toBe(0)
    expect(tween(0, 100, 30)).toBe(100)
    expect(tween(0, 100, 10)).toBeGreaterThan(50) // ease-out: most of the way early
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
  await clock.advance(1000)
  const midway = await ui.find({ type: 'Text', text: /\d+%▲/ })
  const mid = Number(/(\d+)%/.exec(midway?.text ?? '')?.[1])
  expect(mid).toBeGreaterThan(42)
  expect(mid).toBeLessThan(91)
  await clock.advance(2500)
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
  await $.prompt.submit({ text: 'wake up', wait: false, origin: { kind: 'composer' } })
  await clock.advance(700)
  expect(await ui.find({ type: 'Text', text: /[zZ]/ })).toBeUndefined()
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
  })
})

test('the badge opens a picker that runs /effort', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  const ran: string[] = []
  on('command.run', { command: 'effort' }, ($, e) => {
    ran.push(e.args)
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
  await ui.unmount()
})

test('saved effort: per-model first, then the top-level default', async () => {
  expect(savedEffort({ effortLevel: 'high', modelSettings: { m: { effortLevel: 'low' } } }, 'm')).toBe('low')
  expect(savedEffort({ effortLevel: 'high' }, 'm')).toBe('high')
  expect(savedEffort({})).toBeUndefined()
})

test('working Clawd walks with legs kept under his body', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  const clock = mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(120, true) })
  const seen = new Set<string>()
  for (let i = 0; i < 4; i++) {
    for (const feet of ['  ▘▘ ▝▝  ', '  ▝▘ ▝▘  ', '  ▘▝ ▘▝  ']) {
      if (await ui.find({ type: 'Text', text: feet })) seen.add(feet)
    }
    await clock.advance(700)
  }
  expect(seen.size).toBe(3)
  await ui.unmount()
})

test('Clawd blinks about every four seconds', async ($, on) => {
  on('session.usage', () => ({ value: usage(50_000, 25) }))
  on('session.start', () => ({ cwd: '.' }))
  const clock = mock.clock(on, { now: 600_000 })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'context-meter', surface: 'terminal', component: 'AbovePrompt', props: props(120) })
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeDefined()
  await clock.advance(700 * 5)
  expect(await ui.find({ type: 'Text', text: /▐█████▌/ })).toBeDefined()
  await clock.advance(700)
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeDefined()
  await ui.unmount()
})
