export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Category = { name: string; tokens: number }

/** A rate-limit window's recent readings, oldest first, for its pace: kept while the window (its `resetsAt`) stays the same. */
export type LimitPace = { resetsAt?: string; samples: { at: number; percent: number }[] }

export type Snapshot = {
  /** Input tokens of the last response (absent before the first one, and right after a compaction). */
  tokens?: number
  /** The model's context window, in tokens. */
  window: number
  /** tokens / window, whole percent, capped at 100 by the engine. */
  percent?: number
  /** Token count at which auto-compaction runs, when it is on. */
  compactAt?: number
  /** Auto-compaction is on, as the last breakdown said; absent until one was read. */
  isAutoCompact?: boolean
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
  /** Token growth of the last completed turn: its end's tokens less `turnBase`. */
  lastDelta?: number
  /**
   * Tokens at the last turn end, or at a fresh reading: "this turn" counts from here.
   * Absent after a compaction until the next turn end sets it.
   */
  turnBase?: number
  /** The window before the last window change (a model switch), for the `window 1.00M → 200.0k` chip. */
  windowFrom?: number
  /** The last main-conversation compaction, kept until a turn end measures a real `lastDelta`. */
  compaction?: { before?: number; after?: number }
  /** When this reading was taken, in $.clock.now() milliseconds. */
  at: number
  /** Which numbers changed at the last change: tokens, headroom, delta, percent, window, usd, limit:<kind>. */
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
  /** The model takes no effort: the main thread's last request carried none. */
  isUnsupported?: boolean
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
      /** Tokens at each turn end (and at a fresh reading), the last 16; percents are taken against the window shown. */
      trend: number[]
      frame: number
      /** Frame tick of the last activity; Clawd sleeps once idle long enough. */
      awakeTick: number
      showDetails: boolean
      /** Why the last reading failed, shown by the placeholder band; null once one succeeds. */
      readError: string | null
      /** The engine's Text takes `mono` (2.1.299 on); false while the version is unknown. */
      hasMono: boolean
      /** Each rate-limit window's readings of the last half hour, by kind, for its pace. */
      pace: Record<string, LimitPace>
    }
  }
}
