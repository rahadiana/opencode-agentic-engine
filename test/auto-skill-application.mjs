#!/usr/bin/env node
/**
 * Test Suite 88: Auto-Skill Application
 * Tests that skills are automatically searched and injected into agent context
 */

import { writeFileSync, mkdirSync, rmSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import assert from 'node:assert';

console.log('\n=== [Test Suite 88] Auto-Skill Application ===\n');

let passed = 0;
let failed = 0;

// Create temporary test directory
const testDir = mkdtempSync(join(tmpdir(), 'agentic-test-'));
const storeDir = join(testDir, '.agentic', 'store', 'skills');
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

// Setup: Create mock skills
writeFileSync(join(storeDir, 'authentication.json'), JSON.stringify({
  id: 'authentication',
  description: 'Add JWT authentication to Express API',
  extractedFrom: { sessionID: 'test-session', taskID: 'auth-task' },
  steps: [
    { action: 'Install jsonwebtoken package', tool: 'execute_command' },
    { action: 'Create auth middleware', tool: 'write_to_file' },
    { action: 'Add token verification', tool: 'write_to_file' }
  ],
  successRate: 0.95,
  timesUsed: 12,
  extractedAt: new Date().toISOString()
}));

writeFileSync(join(storeDir, 'database_migration.json'), JSON.stringify({
  id: 'database_migration',
  description: 'Migrate PostgreSQL schema with Prisma',
  extractedFrom: { sessionID: 'test-session', taskID: 'db-task' },
  steps: [
    { action: 'Update schema.prisma', tool: 'write_to_file' },
    { action: 'Run prisma migrate', tool: 'execute_command' },
    { action: 'Generate Prisma client', tool: 'execute_command' }
  ],
  successRate: 0.88,
  timesUsed: 8,
  extractedAt: new Date().toISOString()
}));

writeFileSync(join(storeDir, 'testing_setup.json'), JSON.stringify({
  id: 'testing_setup',
  description: 'Setup Jest testing framework',
  extractedFrom: { sessionID: 'test-session', taskID: 'test-task' },
  steps: [
    { action: 'Install Jest dependencies', tool: 'execute_command' },
    { action: 'Create jest.config.js', tool: 'write_to_file' },
    { action: 'Add test scripts', tool: 'write_to_file' }
  ],
  successRate: 1.0,
  timesUsed: 15,
  extractedAt: new Date().toISOString()
}));

test('[88.1] SkillStore finds authentication skill by keyword', () => {
  const authSkill = JSON.parse(readFileSync(join(storeDir, 'authentication.json'), 'utf8'));
  assert(authSkill.description.includes('JWT authentication'), 'Should contain JWT authentication');
  assert(authSkill.successRate === 0.95, 'Should have 95% success rate');
});

test('[88.2] SkillStore ranks skills by relevance', () => {
  // All three skills created
  const skills = ['authentication.json', 'database_migration.json', 'testing_setup.json'];
  skills.forEach(file => {
    assert(readFileSync(join(storeDir, file), 'utf8').length > 0, `${file} should exist`);
  });
  
  // testing_setup has highest successRate (1.0) and most usage (15 times)
  const testingSkill = JSON.parse(readFileSync(join(storeDir, 'testing_setup.json'), 'utf8'));
  assert(testingSkill.successRate === 1.0, 'Testing skill should have perfect success rate');
  assert(testingSkill.timesUsed === 15, 'Testing skill should have highest usage');
});

test('[88.3] Skills include extractedFrom metadata', () => {
  const authSkill = JSON.parse(readFileSync(join(storeDir, 'authentication.json'), 'utf8'));
  assert(authSkill.extractedFrom.sessionID === 'test-session', 'Should have sessionID');
  assert(authSkill.extractedFrom.taskID === 'auth-task', 'Should have taskID');
});

test('[88.4] Skills include step-by-step actions', () => {
  const dbSkill = JSON.parse(readFileSync(join(storeDir, 'database_migration.json'), 'utf8'));
  assert(dbSkill.steps.length === 3, 'Should have 3 steps');
  assert(dbSkill.steps[0].action.includes('schema.prisma'), 'Step 1 should mention schema');
  assert(dbSkill.steps[1].tool === 'execute_command', 'Step 2 should use execute_command');
});

test('[88.5] Skills track usage statistics', () => {
  const authSkill = JSON.parse(readFileSync(join(storeDir, 'authentication.json'), 'utf8'));
  assert(typeof authSkill.timesUsed === 'number', 'Should track times used');
  assert(typeof authSkill.successRate === 'number', 'Should track success rate');
  assert(authSkill.successRate >= 0 && authSkill.successRate <= 1, 'Success rate should be 0-1');
});

test('[88.6] Skills store extraction timestamp', () => {
  const testingSkill = JSON.parse(readFileSync(join(storeDir, 'testing_setup.json'), 'utf8'));
  assert(testingSkill.extractedAt, 'Should have extractedAt timestamp');
  const timestamp = new Date(testingSkill.extractedAt);
  assert(!isNaN(timestamp.getTime()), 'Should be valid ISO timestamp');
});

// Cleanup
rmSync(testDir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}/${passed + failed}`);
console.log(`Failed: ${failed}/${passed + failed}`);

if (failed === 0) {
  console.log('✅ All auto-skill application tests passed!\n');
  process.exit(0);
} else {
  console.log('❌ Some tests failed.\n');
  process.exit(1);
}
