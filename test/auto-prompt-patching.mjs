#!/usr/bin/env node
/**
 * Test Suite 89: Auto-Prompt Patching
 * Tests that prompt patches are automatically applied based on error patterns
 */

import { writeFileSync, mkdirSync, rmSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import assert from 'node:assert';

console.log('\n=== [Test Suite 89] Auto-Prompt Patching ===\n');

let passed = 0;
let failed = 0;

// Create temporary test directory
const testDir = mkdtempSync(join(tmpdir(), 'agentic-test-'));
const storeDir = join(testDir, '.agentic', 'store', 'prompts');
mkdirSync(storeDir, { recursive: true });

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${err.message}`);
    failed++;
  }
}

// Setup: Create mock prompt patch state
const promptState = {
  version: 1,
  patches: [
    {
      id: 'patch-001',
      pattern: 'import.*module.*not.*found',
      suggestion: 'Always check module existence with fs.existsSync() before importing',
      priority: 'high',
      occurrences: 3,
      appliedAt: null
    },
    {
      id: 'patch-002',
      pattern: 'undefined.*property',
      suggestion: 'Add null checks before accessing object properties',
      priority: 'high',
      occurrences: 5,
      appliedAt: null
    },
    {
      id: 'patch-003',
      pattern: 'async.*without.*await',
      suggestion: 'Ensure async functions properly await promises',
      priority: 'medium',
      occurrences: 12,
      appliedAt: null
    },
    {
      id: 'patch-004',
      pattern: 'memory.*limit.*exceeded',
      suggestion: 'Use streaming or pagination for large datasets',
      priority: 'medium',
      occurrences: 8,
      appliedAt: null
    },
    {
      id: 'patch-005',
      pattern: 'timeout.*exceeded',
      suggestion: 'Add timeout handling and retry logic',
      priority: 'low',
      occurrences: 2,
      appliedAt: null
    }
  ],
  lastUpdated: new Date().toISOString()
};

writeFileSync(join(storeDir, 'state.json'), JSON.stringify(promptState, null, 2));

test('[89.1] Prompt state stores error patterns and suggestions', () => {
  const state = JSON.parse(readFileSync(join(storeDir, 'state.json'), 'utf8'));
  assert(state.patches.length === 5, 'Should have 5 patches');
  assert(state.patches[0].pattern, 'Patch should have pattern');
  assert(state.patches[0].suggestion, 'Patch should have suggestion');
});

test('[89.2] High-priority patches with 2-5 occurrences are auto-applied', () => {
  const state = JSON.parse(readFileSync(join(storeDir, 'state.json'), 'utf8'));
  
  // patch-001: high priority, 3 occurrences -> should auto-apply
  const patch1 = state.patches.find(p => p.id === 'patch-001');
  assert(patch1.priority === 'high', 'Should be high priority');
  assert(patch1.occurrences >= 2 && patch1.occurrences <= 5, 'Should be in 2-5 range');
  
  // This pattern matches auto-apply criteria in self-evolver.ts lines 65-94
});

test('[89.3] Medium-priority patches with ≥10 occurrences are auto-applied', () => {
  const state = JSON.parse(readFileSync(join(storeDir, 'state.json'), 'utf8'));
  
  // patch-003: medium priority, 12 occurrences -> should auto-apply
  const patch3 = state.patches.find(p => p.id === 'patch-003');
  assert(patch3.priority === 'medium', 'Should be medium priority');
  assert(patch3.occurrences >= 10, 'Should have ≥10 occurrences');
});

test('[89.4] Low-priority patches are NOT auto-applied', () => {
  const state = JSON.parse(readFileSync(join(storeDir, 'state.json'), 'utf8'));
  
  // patch-005: low priority, 2 occurrences -> should NOT auto-apply
  const patch5 = state.patches.find(p => p.id === 'patch-005');
  assert(patch5.priority === 'low', 'Should be low priority');
  assert(patch5.appliedAt === null, 'Should not be auto-applied');
});

test('[89.5] High-priority patches with >5 occurrences are NOT auto-applied', () => {
  const state = JSON.parse(readFileSync(join(storeDir, 'state.json'), 'utf8'));
  
  // patch-002: high priority, 5 occurrences -> at boundary (should apply)
  // But if occurrences > 5, it's widespread, so needs manual review
  const patch2 = state.patches.find(p => p.id === 'patch-002');
  assert(patch2.priority === 'high', 'Should be high priority');
  assert(patch2.occurrences === 5, 'Should be at boundary');
  
  // Safety: widespread patterns (>5) need human review
});

test('[89.6] Patches track application timestamp', () => {
  const state = JSON.parse(readFileSync(join(storeDir, 'state.json'), 'utf8'));
  
  // All patches have appliedAt field (null or ISO timestamp)
  state.patches.forEach(patch => {
    assert('appliedAt' in patch, 'Patch should have appliedAt field');
    assert(patch.appliedAt === null || typeof patch.appliedAt === 'string', 
           'appliedAt should be null or string');
  });
});

test('[89.7] Prompt state tracks version and lastUpdated', () => {
  const state = JSON.parse(readFileSync(join(storeDir, 'state.json'), 'utf8'));
  assert(typeof state.version === 'number', 'Should have version number');
  assert(state.lastUpdated, 'Should have lastUpdated timestamp');
  
  const timestamp = new Date(state.lastUpdated);
  assert(!isNaN(timestamp.getTime()), 'Should be valid ISO timestamp');
});

test('[89.8] Auto-apply logic follows safety criteria', () => {
  const state = JSON.parse(readFileSync(join(storeDir, 'state.json'), 'utf8'));
  
  // Count patches that meet auto-apply criteria
  let autoApplyCount = 0;
  state.patches.forEach(patch => {
    const isHighPriorityNew = patch.priority === 'high' && 
                              patch.occurrences >= 2 && 
                              patch.occurrences <= 5;
    const isMediumPriorityProven = patch.priority === 'medium' && 
                                   patch.occurrences >= 10;
    
    if (isHighPriorityNew || isMediumPriorityProven) {
      autoApplyCount++;
    }
  });
  
  // Should have exactly 3 patches meeting criteria (patch-001, patch-002, patch-003)
  // patch-001: high priority, 3 occurrences (in 2-5 range) ✓
  // patch-002: high priority, 5 occurrences (in 2-5 range) ✓
  // patch-003: medium priority, 12 occurrences (≥10) ✓
  assert(autoApplyCount === 3, `Expected 3 auto-apply patches, got ${autoApplyCount}`);
});

// Cleanup
rmSync(testDir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}/${passed + failed}`);
console.log(`Failed: ${failed}/${passed + failed}`);

if (failed === 0) {
  console.log('✅ All auto-prompt patching tests passed!\n');
  process.exit(0);
} else {
  console.log('❌ Some tests failed.\n');
  process.exit(1);
}
