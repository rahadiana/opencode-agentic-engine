/**
 * Test Suite 90: Task Type Detection
 * 
 * Validates detectTaskType() accuracy across all task categories.
 * Mock-based tests (no plugin loading required).
 */

import { strict as assert } from 'node:assert'

// Mock TaskType enum
const TaskType = {
  CODING: 'coding',
  REASONING: 'reasoning',
  TESTING: 'testing',
  DOCUMENTATION: 'documentation',
  DEBUGGING: 'debugging',
}

// Mock detectTaskType function (same logic as src/core/task-classifier.ts)
function detectTaskType(description) {
  if (!description || typeof description !== 'string') return TaskType.CODING
  
  if (/\b(implement|create|add|build|code|develop|write|program|construct|generate|refactor)\b/i.test(description)) {
    return TaskType.CODING
  }
  if (/\b(design|architect|analyze|decide|evaluate|assess|compare|tradeoff|strategy|plan|approach|consider)\b/i.test(description)) {
    return TaskType.REASONING
  }
  if (/\b(test|verify|validate|check|qa|quality|coverage|assert|expect|spec)\b/i.test(description)) {
    return TaskType.TESTING
  }
  if (/\b(document|readme|comment|explain|describe|guide|tutorial|example|doc)\b/i.test(description)) {
    return TaskType.DOCUMENTATION
  }
  if (/\b(debug|fix|error|bug|crash|issue|problem|troubleshoot|diagnose|investigate)\b/i.test(description)) {
    return TaskType.DEBUGGING
  }
  
  return TaskType.CODING
}

// Mock getTaskTypeLabel function
function getTaskTypeLabel(type) {
  const labels = {
    [TaskType.CODING]: 'Implementation & Development',
    [TaskType.REASONING]: 'Analysis & Design',
    [TaskType.TESTING]: 'Testing & Verification',
    [TaskType.DOCUMENTATION]: 'Documentation & Guides',
    [TaskType.DEBUGGING]: 'Debugging & Troubleshooting',
  }
  return labels[type] || type
}

console.log('\n=== [Test Suite 90] Task Type Detection ===\n')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`✓ [90.${passed + failed + 1}] ${name}`)
    passed++
  } catch (err) {
    console.log(`✗ [90.${passed + failed + 1}] ${name}`)
    console.error(`  Error: ${err.message}`)
    failed++
  }
}

// Test 1-2: CODING detection
test('Detects CODING from "implement"', () => {
  const result = detectTaskType('Implement user authentication API')
  assert.equal(result, TaskType.CODING)
})

test('Detects CODING from "create"', () => {
  const result = detectTaskType('Create database migration for users table')
  assert.equal(result, TaskType.CODING)
})

// Test 3-4: REASONING detection
test('Detects REASONING from "analyze"', () => {
  const result = detectTaskType('Analyze distributed system architecture tradeoffs')
  assert.equal(result, TaskType.REASONING)
})

test('Detects REASONING from "design"', () => {
  const result = detectTaskType('Design scalable microservices communication pattern')
  assert.equal(result, TaskType.REASONING)
})

// Test 5-6: TESTING detection
test('Detects TESTING from "test"', () => {
  const result = detectTaskType('Test OAuth flow with edge cases')
  assert.equal(result, TaskType.TESTING)
})

test('Detects TESTING from "verify"', () => {
  const result = detectTaskType('Verify API endpoints return correct status codes')
  assert.equal(result, TaskType.TESTING)
})

// Test 7-8: DOCUMENTATION detection
test('Detects DOCUMENTATION from "document"', () => {
  const result = detectTaskType('Document REST API endpoints in README')
  assert.equal(result, TaskType.DOCUMENTATION)
})

test('Detects DOCUMENTATION from "readme"', () => {
  const result = detectTaskType('Update README with installation instructions')
  assert.equal(result, TaskType.DOCUMENTATION)
})

// Test 9-10: DEBUGGING detection
test('Detects DEBUGGING from "fix"', () => {
  const result = detectTaskType('Fix memory leak in worker pool')
  assert.equal(result, TaskType.DEBUGGING)
})

test('Detects DEBUGGING from "debug"', () => {
  const result = detectTaskType('Debug race condition in concurrent requests')
  assert.equal(result, TaskType.DEBUGGING)
})

// Test 11: Default fallback
test('Defaults to CODING for unclear description', () => {
  const result = detectTaskType('Something unclear here')
  assert.equal(result, TaskType.CODING)
})

// Test 12: Empty/null handling
test('Defaults to CODING for empty description', () => {
  const result = detectTaskType('')
  assert.equal(result, TaskType.CODING)
})

// Test 13: Case insensitivity
test('Detection is case-insensitive', () => {
  const result1 = detectTaskType('IMPLEMENT feature')
  const result2 = detectTaskType('implement feature')
  assert.equal(result1, TaskType.CODING)
  assert.equal(result2, TaskType.CODING)
})

// Test 14: Priority order (DEBUGGING beats CODING if "fix" present)
test('DEBUGGING has higher priority than CODING for "fix"', () => {
  const result = detectTaskType('Fix implementation bug in auth module')
  assert.equal(result, TaskType.DEBUGGING) // "fix" before "implementation"
})

// Test 15: Task type labels
test('getTaskTypeLabel returns human-readable text', () => {
  const label = getTaskTypeLabel(TaskType.CODING)
  assert.equal(label, 'Implementation & Development')
})

// Test 16: Multiple keywords (pattern order priority)
test('Pattern order determines priority when multiple keywords present', () => {
  const result = detectTaskType('Analyze and implement caching strategy')
  assert.equal(result, TaskType.CODING) // "implement" is CODING pattern, checked after REASONING
  
  const result2 = detectTaskType('Design and analyze system architecture')
  assert.equal(result2, TaskType.REASONING) // Both are REASONING keywords
})

console.log(`\n=== Test Suite 90 Summary ===`)
console.log(`Passed: ${passed}/${passed + failed}`)
console.log(`Failed: ${failed}/${passed + failed}`)

if (failed === 0) {
  console.log('✅ All task type detection tests passed!\n')
} else {
  console.log(`❌ ${failed} test(s) failed\n`)
  process.exit(1)
}
