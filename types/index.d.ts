export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Category = { name: string; tokens: number }

export type Snapshot = {
  /** Input tokens of the last response (absent before the first one). */
  tokens?: number
  /** The model's context window, in tokens. */
  window: number
  /** tokens / window, whole percent. */
  percent?: number
  /** Token count at which auto-compaction runs, when it is on. */
  compactAt?: number
  /** Model the breakdown was computed for. */
  model?: string
  /** Largest used categories of the window, biggest first. */
  categories: Category[]
  /** Session cost so far, USD. */
  usd?: number
  /** Rate-limit windows (five_hour, seven_day, ...). */
  limits: Limit[]
  /** When the session began, in $.clock.now() milliseconds. */
  startedAt: number
  /** Token growth since the previous reading. */
  lastDelta?: number
  /** When this reading was taken, in $.clock.now() milliseconds. */
  at: number
  /** Which numbers changed at the last change: tokens, headroom, delta, percent, usd, limit:<kind>. */
  changed: string[]
  /** The mascot frame tick at which `changed` was recorded (drives the highlight's fade). */
  changedTick: number
  /** Percent before the last change, so the bar can draw the newly filled part. */
  prevPercent?: number
  /** Where each changed number counts up from, by the keys of `changed`. */
  from: Record<string, number>
}

export type Effort = {
  /** Effort the main thread's last request carried: a level, or a token budget. */
  level?: string | number
  /** Ultracode is on for this session, as the last `/effort` output said. */
  isUltra: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'context-meter': {
      snap: Snapshot | null
      effort: Effort
      /** Count-up step since the last change, 0..TWEEN_STEPS (done). */
      tweenStep: number
      /** The effort picker column is open. */
      isPickerOpen: boolean
      /** The main loop's model, as `/model` shows it (`$.session.model()`); null until read. */
      model: string | null
      /** The model picker column is open. */
      isModelPickerOpen: boolean
      history: number[]
      frame: number
      /** Frame tick of the last activity; Clawd sleeps once idle long enough. */
      awakeTick: number
      showDetails: boolean
    }
  }
}
