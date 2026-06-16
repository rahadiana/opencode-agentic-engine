/**
 * Task Type Classifier
 * 
 * Automatically detects task type from description for capability-aware model selection.
 */

export enum TaskType {
  CODING = 'coding',
  REASONING = 'reasoning',
  TESTING = 'testing',
  DOCUMENTATION = 'documentation',
  DEBUGGING = 'debugging',
}

interface TaskPattern {
  type: TaskType
  keywords: RegExp
}

const TASK_PATTERNS: TaskPattern[] = [
  {
    type: TaskType.CODING,
    keywords: /\b(implement|create|add|build|code|develop|write|program|construct|generate|refactor)\b/i,
  },
  {
    type: TaskType.REASONING,
    keywords: /\b(design|architect|analyze|decide|evaluate|assess|compare|tradeoff|strategy|plan|approach|consider)\b/i,
  },
  {
    type: TaskType.TESTING,
    keywords: /\b(test|verify|validate|check|qa|quality|coverage|assert|expect|spec)\b/i,
  },
  {
    type: TaskType.DOCUMENTATION,
    keywords: /\b(document|readme|comment|explain|describe|guide|tutorial|example|doc)\b/i,
  },
  {
    type: TaskType.DEBUGGING,
    keywords: /\b(debug|fix|error|bug|crash|issue|problem|troubleshoot|diagnose|investigate)\b/i,
  },
]

/**
 * Detect task type from description using keyword matching.
 * 
 * @param description Task description or action text
 * @returns Detected task type (defaults to CODING if no match)
 */
export function detectTaskType(description: string): TaskType {
  if (!description || typeof description !== 'string') {
    return TaskType.CODING // Default fallback
  }

  // Check each pattern in order of priority
  for (const pattern of TASK_PATTERNS) {
    if (pattern.keywords.test(description)) {
      return pattern.type
    }
  }

  // Default to CODING if no keywords matched
  return TaskType.CODING
}

/**
 * Get human-readable label for task type.
 */
export function getTaskTypeLabel(type: TaskType): string {
  const labels: Record<TaskType, string> = {
    [TaskType.CODING]: 'Implementation & Development',
    [TaskType.REASONING]: 'Analysis & Design',
    [TaskType.TESTING]: 'Testing & Verification',
    [TaskType.DOCUMENTATION]: 'Documentation & Guides',
    [TaskType.DEBUGGING]: 'Debugging & Troubleshooting',
  }
  return labels[type] || type
}
