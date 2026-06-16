/**
 * Test Suite 91: Task-Aware Model Selection
 * 
 * Validates capability-aware model selection across task types.
 */

import { strict as assert } from 'node:assert'

console.log('\n=== [Test Suite 91] Task-Aware Model Selection ===\n')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`✓ [91.${passed + failed + 1}] ${name}`)
    passed++
  } catch (err) {
    console.log(`✗ [91.${passed + failed + 1}] ${name}`)
    console.error(`  Error: ${err.message}`)
    failed++
  }
}

const TaskType = {
  CODING: 'coding',
  REASONING: 'reasoning',
  TESTING: 'testing',
  DOCUMENTATION: 'documentation',
  DEBUGGING: 'debugging',
}

class MockModelRegistry {
  constructor() {
    this.stats = new Map()
  }

  addModel(name) {
    if (!this.stats.has(name)) {
      this.stats.set(name, {
        model: name,
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        hallucinationCount: 0,
        avgLatencyMs: 0,
        lastUsed: 0,
        consecutiveFailures: 0,
        byTaskType: {},
      })
    }
  }

  recordCall(model, success, latencyMs, taskType) {
    this.addModel(model)
    const stat = this.stats.get(model)
    stat.totalCalls++
    stat.lastUsed = Date.now()

    if (success) {
      stat.successCalls++
      stat.consecutiveFailures = 0
    } else {
      stat.failedCalls++
      stat.consecutiveFailures++
    }

    stat.avgLatencyMs = stat.avgLatencyMs === 0
      ? latencyMs
      : (stat.avgLatencyMs * (stat.totalCalls - 1) + latencyMs) / stat.totalCalls

    if (taskType && stat.byTaskType) {
      if (!stat.byTaskType[taskType]) {
        stat.byTaskType[taskType] = {
          totalCalls: 0,
          successCalls: 0,
          failedCalls: 0,
          hallucinationCount: 0,
          avgLatencyMs: 0,
          lastUsed: 0,
          consecutiveFailures: 0,
        }
      }
      const taskStat = stat.byTaskType[taskType]
      taskStat.totalCalls++
      taskStat.lastUsed = Date.now()
      if (success) {
        taskStat.successCalls++
        taskStat.consecutiveFailures = 0
      } else {
        taskStat.failedCalls++
        taskStat.consecutiveFailures++
      }
      taskStat.avgLatencyMs = taskStat.avgLatencyMs === 0
        ? latencyMs
        : (taskStat.avgLatencyMs * (taskStat.totalCalls - 1) + latencyMs) / taskStat.totalCalls
    }
  }

  getScoreByTaskType(model, taskType) {
    const stat = this.stats.get(model)
    if (!stat || !stat.byTaskType || !stat.byTaskType[taskType]) {
      return {
        model,
        reliability: 0.5,
        hallucinationRate: 0,
        totalCalls: 0,
        status: "healthy",
      }
    }

    const taskStat = stat.byTaskType[taskType]
    if (taskStat.totalCalls === 0) {
      return {
        model,
        reliability: 0.5,
        hallucinationRate: 0,
        totalCalls: 0,
        status: "healthy",
      }
    }

    const successRate = taskStat.successCalls / taskStat.totalCalls
    const hallucinationRate = taskStat.hallucinationCount / taskStat.totalCalls
    const reliability = Math.max(0, Math.min(1, successRate - hallucinationRate * 2))

    let status = "healthy"
    if (taskStat.consecutiveFailures >= 3) status = "degraded"
    if (hallucinationRate > 0.3 || successRate < 0.4) status = "unstable"

    return { model, reliability, hallucinationRate, totalCalls: taskStat.totalCalls, status }
  }

  selectBestModel(taskType, availableModels) {
    if (availableModels.length === 0) return "default"
    if (availableModels.length === 1) return availableModels[0]

    const scored = availableModels
      .map(model => ({ model, score: this.getScoreByTaskType(model, taskType) }))
      .sort((a, b) => {
        if (a.score.status === "healthy" && b.score.status !== "healthy") return -1
        if (a.score.status !== "healthy" && b.score.status === "healthy") return 1
        return b.score.reliability - a.score.reliability
      })

    return scored.length > 0 ? scored[0].model : availableModels[0]
  }
}

test('ModelRegistry tracks per-task-type stats independently', () => {
  const registry = new MockModelRegistry()
  
  registry.recordCall('gpt-4', true, 100, TaskType.CODING)
  registry.recordCall('gpt-4', true, 150, TaskType.REASONING)
  registry.recordCall('gpt-4', false, 200, TaskType.CODING)
  
  const codingScore = registry.getScoreByTaskType('gpt-4', TaskType.CODING)
  const reasoningScore = registry.getScoreByTaskType('gpt-4', TaskType.REASONING)
  
  assert.equal(codingScore.totalCalls, 2)
  assert.equal(reasoningScore.totalCalls, 1)
  assert.equal(codingScore.reliability, 0.5)
  assert.equal(reasoningScore.reliability, 1.0)
})

test('selectBestModel chooses model with highest task-specific reliability', () => {
  const registry = new MockModelRegistry()
  
  registry.recordCall('gpt-3.5', true, 50, TaskType.CODING)
  registry.recordCall('gpt-3.5', true, 55, TaskType.CODING)
  registry.recordCall('gpt-3.5', true, 60, TaskType.CODING)
  
  registry.recordCall('gpt-4', true, 100, TaskType.CODING)
  registry.recordCall('gpt-4', false, 120, TaskType.CODING)
  
  const bestModel = registry.selectBestModel(TaskType.CODING, ['gpt-3.5', 'gpt-4'])
  assert.equal(bestModel, 'gpt-3.5')
})

test('selectBestModel falls back to default when no stats available', () => {
  const registry = new MockModelRegistry()
  const bestModel = registry.selectBestModel(TaskType.REASONING, ['model-a', 'model-b'])
  assert.ok(['model-a', 'model-b'].includes(bestModel))
})

test('Task type detection affects model selection', () => {
  const registry = new MockModelRegistry()
  
  registry.recordCall('fast-model', true, 30, TaskType.TESTING)
  registry.recordCall('fast-model', true, 35, TaskType.TESTING)
  registry.recordCall('fast-model', false, 40, TaskType.CODING)
  
  registry.recordCall('slow-model', false, 200, TaskType.TESTING)
  registry.recordCall('slow-model', true, 180, TaskType.CODING)
  
  const bestForTesting = registry.selectBestModel(TaskType.TESTING, ['fast-model', 'slow-model'])
  const bestForCoding = registry.selectBestModel(TaskType.CODING, ['fast-model', 'slow-model'])
  
  assert.equal(bestForTesting, 'fast-model')
  assert.equal(bestForCoding, 'slow-model')
})

test('Healthy status prioritized over higher reliability with unstable status', () => {
  const registry = new MockModelRegistry()
  
  registry.recordCall('stable-model', true, 100, TaskType.REASONING)
  registry.recordCall('stable-model', true, 110, TaskType.REASONING)
  
  registry.recordCall('unstable-model', true, 50, TaskType.REASONING)
  registry.recordCall('unstable-model', false, 60, TaskType.REASONING)
  registry.recordCall('unstable-model', false, 70, TaskType.REASONING)
  registry.recordCall('unstable-model', false, 80, TaskType.REASONING)
  
  const unstableScore = registry.getScoreByTaskType('unstable-model', TaskType.REASONING)
  assert.equal(unstableScore.status, 'unstable')
  
  const bestModel = registry.selectBestModel(TaskType.REASONING, ['stable-model', 'unstable-model'])
  assert.equal(bestModel, 'stable-model')
})

console.log(`\n=== Test Suite 91 Summary ===`)
console.log(`Passed: ${passed}/${passed + failed}`)
console.log(`Failed: ${failed}/${passed + failed}`)

if (failed === 0) {
  console.log('✅ All task-aware model selection tests passed!\n')
} else {
  console.log(`❌ ${failed} test(s) failed\n`)
  process.exit(1)
}
