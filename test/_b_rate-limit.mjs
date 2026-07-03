// test/_b_rate-limit.mjs — Part B: Debounce + Throttle unit tests
import { pluginDist, G, R, RST, state, assert, section, mockCtx, freshSid } from "./_common.mjs"

console.log("\n[RATE-LIMIT] Debounce + Throttle")

const mod = await import(pluginDist)
const { debounce, throttle } = mod

let rlPassed = 0, rlFailed = 0
const s = (name, fn) => { try { fn(); rlPassed++; console.log(`  ${G}PASS${RST}: ${name}`) } catch (e) { rlFailed++; console.log(`  ${R}FAIL${RST}: ${name} — ${e.message}`) } }

// ── Debounce Tests ──

// RL-D1: trailing edge (default)
{
  let callCount = 0
  const debounced = debounce(() => { callCount++ }, 30)
  debounced()
  debounced()
  debounced()
  s("RL-D1a trailing debounce does not fire immediately", () => { if (callCount !== 0) throw new Error(`expected 0, got ${callCount}`) })
  await new Promise(r => setTimeout(r, 60))
  s("RL-D1b trailing debounce fires once after quiet period", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
}

// RL-D2: leading edge
{
  let callCount = 0
  const debounced = debounce(() => { callCount++ }, 30, { leading: true, trailing: false })
  debounced()
  s("RL-D2a leading debounce fires on first call", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
  debounced()
  debounced()
  s("RL-D2b leading suppresses subsequent calls", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
  await new Promise(r => setTimeout(r, 60))
  s("RL-D2c leading does not fire trailing", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
}

// RL-D3: leading + trailing
{
  let callCount = 0
  const debounced = debounce(() => { callCount++ }, 30, { leading: true, trailing: true })
  debounced()
  s("RL-D3a fires leading edge", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
  debounced()
  debounced()
  await new Promise(r => setTimeout(r, 60))
  s("RL-D3b fires both leading and trailing", () => { if (callCount !== 2) throw new Error(`expected 2, got ${callCount}`) })
}

// RL-D4: maxWait forces execution
{
  let callCount = 0
  const debounced = debounce(() => { callCount++ }, 80, { maxWait: 40 })
  const interval = setInterval(() => { debounced() }, 10)
  await new Promise(r => setTimeout(r, 150))
  clearInterval(interval)
  await new Promise(r => setTimeout(r, 100))
  s("RL-D4 maxWait forces at least 2 executions", () => { if (callCount < 2) throw new Error(`expected >=2, got ${callCount}`) })
}

// RL-D5: passes arguments
{
  let captured: string | undefined
  const debounced = debounce((x: string) => { captured = x }, 10)
  debounced("hello")
  await new Promise(r => setTimeout(r, 40))
  s("RL-D5 debounce passes arguments", () => { if (captured !== "hello") throw new Error(`got "${captured}"`) })
}

// RL-D6: trailing=false suppresses trailing
{
  let callCount = 0
  const debounced = debounce(() => { callCount++ }, 20, { leading: true, trailing: false })
  debounced()
  s("RL-D6a fires leading", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
  debounced()
  await new Promise(r => setTimeout(r, 50))
  s("RL-D6b trailing=false suppresses trailing", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
}

// RL-D7: timer resets on new call
{
  let callCount = 0
  const debounced = debounce(() => { callCount++ }, 40)
  debounced()
  await new Promise(r => setTimeout(r, 20))
  debounced()
  await new Promise(r => setTimeout(r, 20))
  debounced()
  await new Promise(r => setTimeout(r, 60))
  s("RL-D7 only trailing edge fires when timer is reset", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
}

// RL-D8: preserves this context
{
  const obj = { value: 42, fn: debounce(function (this: { value: number }) { return this.value }, 10) }
  let err: Error | null = null
  try { obj.fn() } catch (e) { err = e as Error }
  await new Promise(r => setTimeout(r, 40))
  s("RL-D8 debounce preserves this context", () => { if (err) throw err })
}

// RL-D9: multiple independent debounced instances
{
  let a = 0, b = 0
  const da = debounce(() => { a++ }, 20)
  const db = debounce(() => { b++ }, 20)
  da(); da(); db(); db()
  await new Promise(r => setTimeout(r, 50))
  s("RL-D9a independent debounce a fires once", () => { if (a !== 1) throw new Error(`expected 1, got ${a}`) })
  s("RL-D9b independent debounce b fires once", () => { if (b !== 1) throw new Error(`expected 1, got ${b}`) })
}

// ── Throttle Tests ──

// RL-T1: leading edge (default)
{
  let callCount = 0
  const throttled = throttle(() => { callCount++ }, 30)
  throttled()
  s("RL-T1a leading throttle fires immediately", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
  throttled()
  throttled()
  s("RL-T1b leading suppresses within window", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
}

// RL-T2: trailing edge fires last call
{
  let callCount = 0
  const throttled = throttle(() => { callCount++ }, 30)
  throttled()
  s("RL-T2a fires leading", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
  throttled()
  throttled()
  await new Promise(r => setTimeout(r, 50))
  s("RL-T2b trailing fires last call after window", () => { if (callCount !== 2) throw new Error(`expected 2, got ${callCount}`) })
}

// RL-T3: leading=false suppresses leading edge
{
  let callCount = 0
  const throttled = throttle(() => { callCount++ }, 20, { leading: false, trailing: true })
  throttled()
  s("RL-T3a leading=false suppresses immediate", () => { if (callCount !== 0) throw new Error(`expected 0, got ${callCount}`) })
  await new Promise(r => setTimeout(r, 40))
  s("RL-T3b trailing fires after window", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
}

// RL-T4: trailing=false suppresses trailing
{
  let callCount = 0
  const throttled = throttle(() => { callCount++ }, 20, { leading: true, trailing: false })
  throttled()
  s("RL-T4a fires leading", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
  await new Promise(r => setTimeout(r, 10))
  throttled()
  await new Promise(r => setTimeout(r, 40))
  s("RL-T4b trailing=false suppresses trailing", () => { if (callCount !== 1) throw new Error(`expected 1, got ${callCount}`) })
}

// RL-T5: at most once per window
{
  let callCount = 0
  const throttled = throttle(() => { callCount++ }, 30)
  const start = Date.now()
  const interval = setInterval(() => { throttled() }, 5)
  await new Promise(r => setTimeout(r, 200))
  clearInterval(interval)
  await new Promise(r => setTimeout(r, 50))
  s("RL-T5 throttle limits to ~1 per 30ms", () => {
    if (callCount < 4 || callCount > 12) throw new Error(`expected 4-12, got ${callCount}`)
  })
}

// RL-T6: passes arguments
{
  let captured: number | undefined
  const throttled = throttle((x: number) => { captured = x }, 10)
  throttled(42)
  s("RL-T6 throttle passes arguments", () => { if (captured !== 42) throw new Error(`got ${captured}`) })
}

// RL-T7: trailing fires most recent
{
  let captured: string | undefined
  const throttled = throttle((x: string) => { captured = x }, 20)
  throttled("a")
  throttled("b")
  throttled("c")
  await new Promise(r => setTimeout(r, 40))
  s("RL-T7 trailing fires most recent args", () => { if (captured !== "c") throw new Error(`got "${captured}"`) })
}

// RL-T8: preserves this context
{
  const obj = { value: 7, fn: throttle(function (this: { value: number }) { return this.value }, 10) }
  let err: Error | null = null
  try { obj.fn() } catch (e) { err = e as Error }
  s("RL-T8 throttle preserves this context", () => { if (err) throw err })
}

// RL-T9: multiple independent throttled instances
{
  let a = 0, b = 0
  const ta = throttle(() => { a++ }, 20)
  const tb = throttle(() => { b++ }, 20)
  ta(); ta(); tb(); tb()
  s("RL-T9a independent throttle a fires leading", () => { if (a !== 1) throw new Error(`expected 1, got ${a}`) })
  s("RL-T9b independent throttle b fires leading", () => { if (b !== 1) throw new Error(`expected 1, got ${b}`) })
}

// ── Summary ──
console.log(`  Rate-limit: ${rlPassed} passed, ${rlFailed} failed`)
state.passed += rlPassed; state.failed += rlFailed
console.log(`__RESULT__:${JSON.stringify({passed:state.passed,failed:state.failed})}`)
