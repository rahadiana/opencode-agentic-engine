// test/_state.mjs — Shared mutable state for all test modules
// All test modules import this to share counters and state

export const state = {
  passed: 0,
  failed: 0,
  sid: 0,
  mod: null,
  currentSection: "",
  sectionStart: 0,
  failedTests: [],
}

export const runStart = Date.now()
