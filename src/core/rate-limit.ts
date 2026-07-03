/**
 * Rate-limiting utilities: debounce and throttle.
 *
 * Both functions preserve the `this` context and accept all arguments
 * from the wrapped function. Return values are discarded (fire-and-forget
 * for debounce; leading-edge capture for throttle).
 *
 * @module
 */

// ── Types ──

export interface DebounceOptions {
  /**
   * If true, fire on the leading edge (immediately on first call),
   * then suppress subsequent calls until the trailing quiet period.
   * @default false
   */
  leading?: boolean
  /**
   * If true, fire on the trailing edge (after calls stop).
   * Ignored when `maxWait` is set (trailing always fires then).
   * @default true
   */
  trailing?: boolean
  /**
   * Maximum time the debounced call can be delayed. Ensures the
   * function fires at least once every `maxWait` ms.
   */
  maxWait?: number
}

export interface ThrottleOptions {
  /**
   * If true, fire on the leading edge (default true).
   */
  leading?: boolean
  /**
   * If true, fire on the trailing edge (default true).
   */
  trailing?: boolean
}

// ── Debounce ──

/**
 * Creates a debounced function that delays invoking `fn` until
 * `wait` milliseconds have elapsed since the last invocation.
 *
 * @example
 * ```ts
 * const save = debounce(async (data: string) => {
 *   await api.save(data)
 * }, 300)
 * input.oninput = () => save(input.value)
 * ```
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void | Promise<void>,
  wait: number,
  options?: DebounceOptions,
): (...args: Args) => void {
  const { leading = false, trailing = true, maxWait } = options ?? {}

  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Args | null = null
  let lastCallTime: number | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  let leadingFired = false

  function invoke(thisArg: unknown, args: Args) {
    lastArgs = null
    leadingFired = true
    fn.apply(thisArg, args)
  }

  function clearTimers() {
    if (timer !== null) { clearTimeout(timer); timer = null }
    if (maxTimer !== null) { clearTimeout(maxTimer); maxTimer = null }
  }

  return function (this: unknown, ...args: Args): void {
    const now = Date.now()
    const isFirstCall = lastCallTime === null
    const elapsed = lastCallTime !== null ? now - lastCallTime : wait
    const remaining = wait - elapsed

    lastArgs = args
    lastCallTime = now

    // Leading edge: fire on the first call of a new burst
    if (leading && !leadingFired && (isFirstCall || remaining > 0)) {
      leadingFired = true
      invoke(this, args)
    }

    // Clear existing timer
    if (timer !== null) { clearTimeout(timer); timer = null }

    // Set up maxWait timer on first call
    if (maxWait !== undefined && maxTimer === null && maxWait > 0) {
      maxTimer = setTimeout(() => {
        if (lastArgs !== null) {
          invoke(this, lastArgs)
        }
        maxTimer = null
        // After maxWait fires, reset leading so next call can be leading
        leadingFired = false
      }, maxWait)
    }

    // Trailing edge
    if (trailing) {
      timer = setTimeout(() => {
        clearTimers()
        leadingFired = false
        if (lastArgs !== null) {
          invoke(this, lastArgs)
        }
      }, wait)
    }
  }
}

// ── Throttle ──

/**
 * Creates a throttled function that invokes `fn` at most once
 * every `wait` milliseconds.
 *
 * @example
 * ```ts
 * const update = throttle((pos: { x: number; y: number }) => {
 *   render(pos)
 * }, 16) // ~60 fps
 * window.addEventListener("mousemove", (e) => update({ x: e.clientX, y: e.clientY }))
 * ```
 */
export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void | Promise<void>,
  wait: number,
  options?: ThrottleOptions,
): (...args: Args) => void {
  const { leading = true, trailing = true } = options ?? {}

  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Args | null = null
  let lastCallTime: number | null = null

  function invoke(thisArg: unknown, args: Args) {
    lastCallTime = Date.now()
    lastArgs = null
    fn.apply(thisArg, args)
  }

  return function (this: unknown, ...args: Args): void {
    const now = Date.now()

    if (lastCallTime === null) {
      // First call
      if (leading) {
        invoke(this, args)
      } else {
        lastCallTime = now
        lastArgs = args
      }
      return
    }

    const elapsed = now - lastCallTime

    if (elapsed >= wait) {
      // Enough time has passed — invoke now
      if (timer !== null) { clearTimeout(timer); timer = null }
      invoke(this, args)
      return
    }

    // Within throttle window — store for trailing
    lastArgs = args

    if (timer === null && trailing) {
      const remaining = wait - elapsed
      timer = setTimeout(() => {
        timer = null
        if (lastArgs !== null) {
          invoke(this, lastArgs)
        }
      }, remaining)
    }
  }
}
