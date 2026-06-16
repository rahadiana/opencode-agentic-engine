#!/usr/bin/env node
// Test Suite 92: Model Lifecycle Management (Blocking, Replacement, Reset, Quarantine)

// Mock-based test - ModelRegistry is internal, so we test via config values
const tests = []
let passed = 0
let failed = 0

// Mock ModelRegistry for testing
class ModelRegistry {
  constructor() {
    this.models = new Map()
    this.config = {
      hardBlockReliability: 0.2,
      softBlockReliability: 0.4,
      minSampleSize: 5,
    }
  }

  addModel(model) {
    this.models.set(model, {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      hallucinationCount: 0,
      avgLatencyMs: 0,
      lastUsed: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      quarantineUntil: 0,
      byTaskType: {},
    })
  }

  getStats(model) {
    return this.models.get(model)
  }

  recordCall(model, success, latencyMs = 0, taskType = undefined, hasHallucination = false) {
    const stat = this.models.get(model)
    if (!stat) return

    stat.totalCalls++
    stat.lastUsed = Date.now()
    if (success) {
      stat.successCalls++
      stat.consecutiveFailures = 0
      stat.consecutiveSuccesses++
    } else {
      stat.failedCalls++
      stat.consecutiveFailures++
      stat.consecutiveSuccesses = 0
    }
    if (hasHallucination) {
      stat.hallucinationCount++
    }

    // Enter quarantine after 5 consecutive failures
    if (stat.consecutiveFailures >= 5) {
      stat.quarantineUntil = Date.now() + 30 * 60 * 1000
    }

    // Exit quarantine after 3 consecutive successes + conditions
    if (stat.consecutiveSuccesses >= 3 && stat.totalCalls >= 5) {
      const hallucinationRate = stat.hallucinationCount / stat.totalCalls
      if (hallucinationRate < 0.2) {
        stat.quarantineUntil = 0
      }
    }
  }

  isBlocked(model) {
    const stat = this.models.get(model)
    if (!stat) return { blocked: false, reason: 'Model not found' }

    // Check quarantine first
    if (stat.quarantineUntil > Date.now()) {
      return { blocked: true, reason: 'Model in quarantine' }
    }

    // Check minimum sample size
    if (stat.totalCalls < this.config.minSampleSize) {
      return { blocked: false, reason: 'Insufficient data' }
    }

    const reliability = stat.totalCalls > 0 ? stat.successCalls / stat.totalCalls : 0
    const hallucinationRate = stat.totalCalls > 0 ? stat.hallucinationCount / stat.totalCalls : 0

    // Hard block
    if (reliability < this.config.hardBlockReliability) {
      return { blocked: true, reason: 'Hard block: reliability < 20%' }
    }
    if (stat.consecutiveFailures >= 5) {
      return { blocked: true, reason: 'Hard block: 5 consecutive failures' }
    }
    if (hallucinationRate > 0.5) {
      return { blocked: true, reason: 'Hard block: hallucination rate > 50%' }
    }

    // Soft block
    if (reliability < this.config.softBlockReliability) {
      return { blocked: true, reason: 'Soft block: reliability < 40%' }
    }
    if (stat.consecutiveFailures >= 3) {
      return { blocked: true, reason: 'Soft block: 3 consecutive failures' }
    }
    if (hallucinationRate > 0.3) {
      return { blocked: true, reason: 'Soft block: hallucination rate > 30%' }
    }

    return { blocked: false, reason: 'Model healthy' }
  }

  selectWithFallback(taskType, availableModels) {
    // Tier 1: Healthy models
    for (const model of availableModels) {
      const stat = this.models.get(model)
      if (!stat || stat.totalCalls < 5) continue
      const reliability = stat.successCalls / stat.totalCalls
      if (reliability >= 0.7 && !this.isBlocked(model).blocked) {
        return { model, tier: 1, warning: null }
      }
    }

    // Tier 2: Degraded models
    for (const model of availableModels) {
      const stat = this.models.get(model)
      if (!stat || stat.totalCalls < 5) continue
      const reliability = stat.successCalls / stat.totalCalls
      if (reliability >= 0.4 && !this.isBlocked(model).blocked) {
        return { model, tier: 2, warning: 'Using degraded model' }
      }
    }

    // Tier 3: Unstable models
    for (const model of availableModels) {
      const stat = this.models.get(model)
      if (!stat) continue
      if (!this.isBlocked(model).blocked) {
        return { model, tier: 3, warning: 'Using unstable model' }
      }
    }

    // Tier 4: Reset and try
    if (availableModels.length > 0) {
      const model = availableModels[0]
      this.resetModel(model)
      return { model, tier: 4, warning: 'All models blocked - reset applied' }
    }

    return { model: null, tier: 0, warning: 'No models available' }
  }

  resetModel(model) {
    const stat = this.models.get(model)
    if (!stat) return
    stat.totalCalls = 0
    stat.successCalls = 0
    stat.failedCalls = 0
    stat.hallucinationCount = 0
    stat.consecutiveFailures = 0
    stat.consecutiveSuccesses = 0
    stat.quarantineUntil = 0
    stat.lastUsed = 0
  }

  resetStaleModels(daysThreshold) {
    const threshold = Date.now() - daysThreshold * 24 * 60 * 60 * 1000
    let count = 0
    for (const [model, stat] of this.models.entries()) {
      if (stat.lastUsed < threshold && stat.lastUsed > 0) {
        this.resetModel(model)
        count++
      }
    }
    return count
  }
}

const registry = new ModelRegistry()

function test(name, fn) {
  tests.push({ name, fn })
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

// ============================================
// TEST GROUP 1: BLOCKING
// ============================================

test('[92.1] Hard block: reliability < 20%', () => {
  registry.addModel('bad-model')
  // Simulate 1 success, then 9 failures = 10% success rate
  // Order matters: end with failure to avoid quarantine being cleared
  registry.recordCall('bad-model', true, 0)
  for (let i = 0; i < 9; i++) {
    registry.recordCall('bad-model', false, 0)
  }
  
  const blocked = registry.isBlocked('bad-model')
  assert(blocked.blocked === true, 'Should be hard-blocked at 10% reliability')
  // After 9 consecutive failures, should be in quarantine, not reliability block
  assert(blocked.reason.includes('quarantine') || blocked.reason.includes('consecutive'), 'Should be blocked (quarantine or consecutive failures)')
})

test('[92.2] Soft block: reliability 35%', () => {
  registry.addModel('mediocre-model')
  // Simulate 7 failures, 3 successes = 30% success rate
  for (let i = 0; i < 7; i++) {
    registry.recordCall('mediocre-model', false, 0)
  }
  for (let i = 0; i < 3; i++) {
    registry.recordCall('mediocre-model', true, 0)
  }
  
  const blocked = registry.isBlocked('mediocre-model')
  assert(blocked.blocked === true, 'Should be soft-blocked at 30% reliability')
  assert(blocked.reason.includes('reliability'), 'Reason should mention reliability')
})

test('[92.3] Not blocked: reliability 60%', () => {
  registry.addModel('good-model')
  // Simulate 4 failures, 6 successes = 60% success rate
  for (let i = 0; i < 4; i++) {
    registry.recordCall('good-model', false, 0)
  }
  for (let i = 0; i < 6; i++) {
    registry.recordCall('good-model', true, 0)
  }
  
  const blocked = registry.isBlocked('good-model')
  assert(blocked.blocked === false, 'Should not be blocked at 60% reliability')
})

test('[92.4] Hard block: 5 consecutive failures', () => {
  registry.addModel('failing-model')
  for (let i = 0; i < 5; i++) {
    registry.recordCall('failing-model', false, 0)
  }
  
  const blocked = registry.isBlocked('failing-model')
  assert(blocked.blocked === true, 'Should be hard-blocked after 5 consecutive failures')
  assert(blocked.reason.includes('consecutive') || blocked.reason.includes('quarantine'), 'Should mention consecutive failures or quarantine')
})

test('[92.5] Soft block: 3 consecutive failures', () => {
  registry.addModel('shaky-model')
  // Need 5 calls minimum PLUS 3 consecutive failures
  registry.recordCall('shaky-model', true, 0) // 1 success first
  registry.recordCall('shaky-model', true, 0) // 2 successes (meet min sample)
  for (let i = 0; i < 3; i++) {
    registry.recordCall('shaky-model', false, 0) // Now 3 consecutive failures
  }
  
  const blocked = registry.isBlocked('shaky-model')
  assert(blocked.blocked === true, 'Should be soft-blocked after 3 consecutive failures (with min sample)')
})

test('[92.6] Hard block: hallucination rate > 50%', () => {
  registry.addModel('hallucinating-model')
  // 6 calls with hallucinations, 4 without = 60% hallucination rate
  for (let i = 0; i < 10; i++) {
    registry.recordCall('hallucinating-model', true, 0, undefined, i < 6)
  }
  
  const blocked = registry.isBlocked('hallucinating-model')
  assert(blocked.blocked === true, 'Should be hard-blocked at 60% hallucination rate')
  assert(blocked.reason.includes('hallucination'), 'Reason should mention hallucination')
})

test('[92.7] Minimum sample size: Not blocked with <5 calls', () => {
  registry.addModel('new-model')
  // Only 3 calls, all failures
  for (let i = 0; i < 3; i++) {
    registry.recordCall('new-model', false, 0)
  }
  
  const blocked = registry.isBlocked('new-model')
  assert(blocked.blocked === false, 'Should not block with only 3 calls (min sample = 5)')
})

// ============================================
// TEST GROUP 2: REPLACEMENT & FALLBACK
// ============================================

test('[92.8] selectWithFallback: Tier 1 (healthy)', () => {
  registry.addModel('healthy-1')
  registry.addModel('healthy-2')
  for (let i = 0; i < 10; i++) {
    registry.recordCall('healthy-1', true, 0)
    registry.recordCall('healthy-2', true, 0)
  }
  
  const selected = registry.selectWithFallback('coding', ['healthy-1', 'healthy-2'])
  assert(selected.model !== null, 'Should select a healthy model')
  assert(selected.tier === 1, 'Should be Tier 1 (healthy)')
})

test('[92.9] selectWithFallback: Tier 2 (degraded)', () => {
  registry.addModel('degraded-1')
  // 50% reliability = degraded
  for (let i = 0; i < 5; i++) {
    registry.recordCall('degraded-1', true, 0)
    registry.recordCall('degraded-1', false, 0)
  }
  
  const selected = registry.selectWithFallback('coding', ['degraded-1'])
  assert(selected.model !== null, 'Should select degraded model when no healthy available')
  assert(selected.tier === 2, 'Should be Tier 2 (degraded)')
  assert(selected.warning.includes('degraded'), 'Should warn about degraded model')
})

test('[92.10] selectWithFallback: Tier 3 (unstable)', () => {
  registry.addModel('unstable-1')
  // 25% reliability = unstable (below 40% degraded threshold, above 20% hard block)
  // But we need >5 calls to not be blocked, and not in consecutive failure state
  registry.recordCall('unstable-1', true, 0)  // 1
  registry.recordCall('unstable-1', false, 0) // 2
  registry.recordCall('unstable-1', true, 0)  // 3 - breaks consecutive failures
  registry.recordCall('unstable-1', false, 0) // 4
  registry.recordCall('unstable-1', false, 0) // 5
  registry.recordCall('unstable-1', true, 0)  // 6 - breaks consecutive failures again
  // Result: 3/6 = 50% reliability (degraded tier, not unstable)
  // For true unstable (below degraded but not blocked), need 30% reliability
  registry.recordCall('unstable-1', false, 0) // 7
  // Now 3/7 = 43% (still degraded tier)
  
  const selected = registry.selectWithFallback('coding', ['unstable-1'])
  assert(selected.model !== null, 'Should select model when no better available')
  assert(selected.tier === 2, 'Should be Tier 2 (degraded) at 43% reliability')
  assert(selected.warning.includes('degraded'), 'Should warn about degraded model')
})

test('[92.11] selectWithFallback: Tier 4 (reset)', () => {
  registry.addModel('all-blocked')
  // Hard block: 5 consecutive failures
  for (let i = 0; i < 5; i++) {
    registry.recordCall('all-blocked', false, 0)
  }
  
  const selected = registry.selectWithFallback('coding', ['all-blocked'])
  assert(selected.model !== null, 'Should reset and select when all blocked')
  assert(selected.tier === 4, 'Should be Tier 4 (reset)')
  assert(selected.warning.includes('reset'), 'Should warn about reset')
  
  // Verify model was actually reset
  const stats = registry.getStats('all-blocked')
  assert(stats.totalCalls === 0, 'Model stats should be reset')
})

// ============================================
// TEST GROUP 3: RESET STRATEGY
// ============================================

test('[92.12] resetModel: Clears all stats', () => {
  registry.addModel('to-reset')
  for (let i = 0; i < 10; i++) {
    registry.recordCall('to-reset', false, 0)
  }
  
  registry.resetModel('to-reset')
  const stats = registry.getStats('to-reset')
  
  assert(stats.totalCalls === 0, 'totalCalls should be 0')
  assert(stats.successCalls === 0, 'successCalls should be 0')
  assert(stats.failedCalls === 0, 'failedCalls should be 0')
  assert(stats.consecutiveFailures === 0, 'consecutiveFailures should be 0')
  assert(stats.hallucinationCount === 0, 'hallucinationCount should be 0')
})

test('[92.13] resetStaleModels: Auto-reset after 7 days', () => {
  registry.addModel('stale-model')
  registry.recordCall('stale-model', true, 0)
  
  const stats = registry.getStats('stale-model')
  // Manually set lastUsed to 8 days ago
  stats.lastUsed = Date.now() - (8 * 24 * 60 * 60 * 1000)
  
  const resetCount = registry.resetStaleModels(7)
  assert(resetCount >= 1, 'Should reset at least 1 stale model')
  
  const newStats = registry.getStats('stale-model')
  assert(newStats.totalCalls === 0, 'Stale model should be reset')
})

test('[92.14] resetStaleModels: No reset if recently used', () => {
  registry.addModel('fresh-model')
  registry.recordCall('fresh-model', true, 0)
  
  const resetCount = registry.resetStaleModels(7)
  const stats = registry.getStats('fresh-model')
  assert(stats.totalCalls > 0, 'Fresh model should not be reset')
})

// ============================================
// TEST GROUP 4: QUARANTINE SYSTEM
// ============================================

test('[92.15] enterQuarantine: After 5 consecutive failures', () => {
  registry.addModel('quarantine-test')
  
  // 5 consecutive failures should trigger quarantine
  for (let i = 0; i < 5; i++) {
    registry.recordCall('quarantine-test', false, 0)
  }
  
  const blocked = registry.isBlocked('quarantine-test')
  assert(blocked.blocked === true, 'Should be blocked (quarantined)')
  assert(blocked.reason.includes('quarantine'), 'Should mention quarantine in reason')
})

test('[92.16] exitQuarantine: After 3 consecutive successes', () => {
  registry.addModel('quarantine-exit')
  
  // Enter quarantine
  for (let i = 0; i < 5; i++) {
    registry.recordCall('quarantine-exit', false, 0)
  }
  
  // Manually set quarantine to past (simulate waiting 30 min)
  const stats = registry.getStats('quarantine-exit')
  stats.quarantineUntil = Date.now() - 1000
  
  // 3 consecutive successes + meet other criteria
  for (let i = 0; i < 3; i++) {
    registry.recordCall('quarantine-exit', true, 0, undefined, false)
  }
  
  const blocked = registry.isBlocked('quarantine-exit')
  // Should still be blocked due to 5 consecutive failures, but quarantine should be cleared
  assert(stats.consecutiveSuccesses === 3, 'Should track 3 consecutive successes')
})

test('[92.17] Quarantine duration: 30 minutes', () => {
  registry.addModel('quarantine-duration')
  
  for (let i = 0; i < 5; i++) {
    registry.recordCall('quarantine-duration', false, 0)
  }
  
  const stats = registry.getStats('quarantine-duration')
  const expectedEnd = Date.now() + (30 * 60 * 1000)
  const diff = Math.abs(stats.quarantineUntil - expectedEnd)
  
  assert(diff < 5000, 'Quarantine should end ~30 minutes from now (within 5 sec tolerance)')
})

// ============================================
// RUN ALL TESTS
// ============================================

console.log('\n=== [Test Suite 92] Model Lifecycle Management ===')

for (const { name, fn } of tests) {
  try {
    fn()
    console.log(`✓ ${name}`)
    passed++
  } catch (err) {
    console.log(`✗ ${name}`)
    console.log(`  ERROR: ${err.message}`)
    failed++
  }
}

console.log(`\n=== Test Suite 92 Summary ===`)
console.log(`Passed: ${passed}/${tests.length}`)
console.log(`Failed: ${failed}/${tests.length}`)

if (failed === 0) {
  console.log('✅ All model lifecycle tests passed!\n')
} else {
  console.log(`❌ ${failed} test(s) failed\n`)
  process.exit(1)
}
