#!/usr/bin/env node
/**
 * Demo script: Populate .agentic/store/ with all memory data
 * 
 * This script will:
 * 1. Create skills/ directory with sample skill data
 * 2. Create episodes/ directory with sample episodic memory
 * 3. Show how self-learning data is organized
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;
const agenticDir = resolve(projectRoot, '.agentic');
const storeDir = resolve(agenticDir, 'store');

console.log('🚀 Populating .agentic/store/ with memory data...\n');

// ============================================================================
// 1. CREATE SKILLS DIRECTORY
// ============================================================================
const skillsDir = resolve(storeDir, 'skills');
if (!existsSync(skillsDir)) {
  mkdirSync(skillsDir, { recursive: true });
  console.log('✅ Created directory: .agentic/store/skills/');
} else {
  console.log('ℹ️  Directory exists: .agentic/store/skills/');
}

// Sample skill 1: Gap analysis
const skill1 = {
  id: 'skill_gap_analysis_20260616',
  name: 'Critical Gap Analysis vs Academic Paper',
  description: 'Identify gaps between implementation and academic paper without trusting test suite',
  pattern: {
    trigger: ['gap analysis', 'paper comparison', 'don\'t trust tests'],
    context: ['academic paper citation', 'test suite present', 'implementation complete'],
    actions: [
      'Read paper formal model',
      'Analyze implementation architecture',
      'Search for semantic verification in code',
      'Check test coverage for semantic checks',
      'Identify silent error handling patterns',
      'Measure file sizes for god object detection',
      'Compare paper gaps vs implementation'
    ],
    expectedOutcome: 'Comprehensive gap analysis document with evidence'
  },
  metadata: {
    successRate: 1.0,
    timesUsed: 1,
    avgDuration: 7200, // 2 hours
    lastUsed: '2026-06-16T08:00:00.000Z',
    tags: ['analysis', 'verification', 'academic', 'critical-thinking']
  },
  examples: [
    {
      input: 'Check if implementation matches paper arXiv:2606.05608',
      output: 'Found Gap #4 (verification fidelity) not closed - semantic check exists but never called'
    }
  ]
};

writeFileSync(
  resolve(skillsDir, `${skill1.id}.json`),
  JSON.stringify(skill1, null, 2)
);
console.log(`✅ Created skill: ${skill1.id}.json`);

// Sample skill 2: Surgical edit implementation
const skill2 = {
  id: 'skill_surgical_edits_20260616',
  name: 'Surgical Code Edits with Protocol Compliance',
  description: 'Implement fixes using small surgical edits (<50 lines each) following CHUNKED WRITE PROTOCOL',
  pattern: {
    trigger: ['fix bug', 'implement feature', 'refactor code'],
    context: ['CHUNKED WRITE PROTOCOL active', 'source code to modify', 'clear requirements'],
    actions: [
      'Identify minimal change needed',
      'Read existing code first',
      'Plan surgical edit (target lines)',
      'Apply edit (<50 lines)',
      'Verify with build & tests',
      'Document change'
    ],
    expectedOutcome: 'Clean, minimal code changes with 100% test pass'
  },
  metadata: {
    successRate: 1.0,
    timesUsed: 31, // 31 surgical edits for Gap #4 & #5
    avgDuration: 120, // 2 minutes per edit
    lastUsed: '2026-06-16T08:30:00.000Z',
    tags: ['implementation', 'surgical-edit', 'protocol-compliance', 'best-practice']
  },
  examples: [
    {
      input: 'Add requireSemanticCheck config parameter',
      output: 'Added 5 lines to config.ts, 100% protocol compliant'
    },
    {
      input: 'Fix 21 empty catch blocks in llm.ts',
      output: 'Added logParseError() helper + 21 edits, average 2 lines each'
    }
  ]
};

writeFileSync(
  resolve(skillsDir, `${skill2.id}.json`),
  JSON.stringify(skill2, null, 2)
);
console.log(`✅ Created skill: ${skill2.id}.json`);

// Sample skill 3: Integration testing
const skill3 = {
  id: 'skill_integration_testing_20260616',
  name: 'E2E Integration Test Suite Creation',
  description: 'Create comprehensive integration tests that validate real behavior, not just unit tests',
  pattern: {
    trigger: ['add integration test', 'test real behavior', 'validate fix'],
    context: ['unit tests exist', 'feature implemented', 'need behavior validation'],
    actions: [
      'Identify test scenarios',
      'Create test file (<300 lines)',
      'Write assertions for expected behavior',
      'Test failure cases',
      'Test success cases',
      'Verify all tests pass',
      'Document test coverage'
    ],
    expectedOutcome: 'Integration test suite with 100% pass rate'
  },
  metadata: {
    successRate: 1.0,
    timesUsed: 3, // 3 test files created
    avgDuration: 600, // 10 minutes per test file
    lastUsed: '2026-06-16T08:25:00.000Z',
    tags: ['testing', 'integration', 'e2e', 'validation']
  },
  examples: [
    {
      input: 'Create EvoClaw benchmark test with semantic check',
      output: 'test/e2e-evoclaw-semantic.mjs with 8 tests, all passing'
    },
    {
      input: 'Test error propagation prevention',
      output: 'test/error-propagation.mjs with 8 tests, validates 80%+ reduction'
    }
  ]
};

writeFileSync(
  resolve(skillsDir, `${skill3.id}.json`),
  JSON.stringify(skill3, null, 2)
);
console.log(`✅ Created skill: ${skill3.id}.json`);

console.log(`\n📊 Skills Summary: 3 skills created\n`);

// ============================================================================
// 2. CREATE EPISODES DIRECTORY
// ============================================================================
const episodesDir = resolve(storeDir, 'episodes');
if (!existsSync(episodesDir)) {
  mkdirSync(episodesDir, { recursive: true });
  console.log('✅ Created directory: .agentic/store/episodes/');
} else {
  console.log('ℹ️  Directory exists: .agentic/store/episodes/');
}

// Sample episode 1: Gap #4 discovery
const episode1 = {
  id: 'episode_gap4_discovery_20260616',
  sessionId: 'session_20260616_080000',
  timestamp: '2026-06-16T08:00:00.000Z',
  task: 'Critical analysis of implementation vs paper',
  outcome: 'success',
  learnings: [
    'Test suite can validate wrong behavior - always verify independently',
    'Semantic verification existed but was never called in auto-verify flow',
    'Empty catch blocks hide critical debugging information',
    'God object anti-pattern (2893 lines) makes verification harder'
  ],
  actions: [
    'grep -rn verifyAllDeep src/index.ts → 0 results (method never called)',
    'Analyzed verifier.ts lines 141-158 (semantic check implementation)',
    'Found test/run.mjs validating default-pass behavior (wrong)',
    'Identified 21 empty catch blocks in src/core/llm.ts'
  ],
  impact: {
    filesModified: ['src/core/config.ts', 'src/core/verifier.ts', 'src/index.ts', 'src/core/llm.ts'],
    testsAdded: 32,
    benchmarkImprovement: '+17pp (38% → 55%)',
    errorReduction: '80%+'
  },
  tags: ['gap-analysis', 'critical-bug', 'verification', 'test-quality']
};

writeFileSync(
  resolve(episodesDir, `${episode1.id}.json`),
  JSON.stringify(episode1, null, 2)
);
console.log(`✅ Created episode: ${episode1.id}.json`);

// Sample episode 2: Surgical implementation strategy
const episode2 = {
  id: 'episode_surgical_impl_20260616',
  sessionId: 'session_20260616_080000',
  timestamp: '2026-06-16T08:15:00.000Z',
  task: 'Implement Gap #4 and Gap #5 fixes',
  outcome: 'success',
  learnings: [
    'Surgical edits (<50 lines) more reliable than large rewrites',
    'CHUNKED WRITE PROTOCOL prevents server timeouts',
    'Multiple small operations faster than one large operation',
    'Test-driven fix: write integration test first, then implement'
  ],
  actions: [
    'Applied 31 surgical edits across 4 source files',
    'Average 10.3 lines per edit (largest: 35 lines)',
    'Created 3 integration test files (26 tests total)',
    'Built successfully after each edit (no regressions)'
  ],
  impact: {
    filesModified: ['src/core/config.ts', 'src/core/verifier.ts', 'src/index.ts', 'src/core/llm.ts', 'test/run.mjs'],
    testsAdded: 32,
    buildTime: '495/495 passing (100%)',
    protocolCompliance: '100% (all edits <350 lines)'
  },
  tags: ['implementation', 'surgical-edit', 'protocol', 'best-practice']
};

writeFileSync(
  resolve(episodesDir, `${episode2.id}.json`),
  JSON.stringify(episode2, null, 2)
);
console.log(`✅ Created episode: ${episode2.id}.json`);

console.log(`\n📊 Episodes Summary: 2 episodes created\n`);

// ============================================================================
// 3. SHOW FINAL STRUCTURE
// ============================================================================
console.log('✅ Memory data populated successfully!\n');
console.log('📁 Final .agentic/store/ structure:');
console.log('   .agentic/store/');
console.log('   ├── models/');
console.log('   │   └── registry.json');
console.log('   ├── prompts/');
console.log('   │   └── state.json');
console.log('   ├── skills/');
console.log('   │   ├── skill_gap_analysis_20260616.json');
console.log('   │   ├── skill_surgical_edits_20260616.json');
console.log('   │   └── skill_integration_testing_20260616.json');
console.log('   └── episodes/');
console.log('       ├── episode_gap4_discovery_20260616.json');
console.log('       └── episode_surgical_impl_20260616.json');
console.log('');
console.log('🎯 Usage:');
console.log('   - Skills: Reusable workflows extracted from successful tasks');
console.log('   - Episodes: Cross-session memory with learnings & outcomes');
console.log('   - Models: LLM reliability statistics');
console.log('   - Prompts: Agent prompt version history');
console.log('');
console.log('📖 See LOKASI_SELF_LEARNING.md for detailed documentation');
