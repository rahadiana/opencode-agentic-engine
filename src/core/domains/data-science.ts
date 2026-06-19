import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import type { DomainPack, VerifierStrategy, ErrorMatcher } from "../domain-registry.js"
import { createGenericContract } from "../formal-model.js"

// ─── Keywords ──────────────────────────────────────────────────────────

const dsKeywords = [
  "machine learning", "deep learning", "neural network", "ai", "artificial intelligence",
  "data science", "data analysis", "data mining", "statistics", "predictive",
  "classification", "regression", "clustering", "nlp", "natural language",
  "computer vision", "cnn", "rnn", "lstm", "transformer", "bert", "gpt",
  "tensorflow", "pytorch", "keras", "scikit-learn", "pandas", "numpy",
  "jupyter", "notebook", "matplotlib", "seaborn", "plotly",
  "feature engineering", "feature extraction", "dimensionality reduction",
  "train", "validation", "test split", "cross-validation", "hyperparameter",
  "loss function", "accuracy", "precision", "recall", "f1", "auc", "roc",
  "overfitting", "underfitting", "bias", "variance", "gradient descent",
  "embedding", "vector", "tokenizer", "corpus", "dataset",
  "data pipeline", "etl", "data wrangling", "data cleaning",
  "data science", "data analyst", "ml", "model",
]

// ─── Detection ─────────────────────────────────────────────────────────

const dsDetect = (input: string): number => {
  const lower = input.toLowerCase()
  let score = 0
  for (const kw of dsKeywords) {
    if (lower.includes(kw)) score += 0.05
  }
  // Check for data science project files
  const dsFiles = ["requirements.txt", "environment.yml", "Pipfile",
    "setup.py", "pyproject.toml",
  ]
  for (const f of dsFiles) {
    try { if (existsSync(f)) score += 0.1 } catch { /* skip */ }
  }
  // Check for jupyter notebooks
  try {
    const files = readdirSync(".")
    const notebooks = files.filter(f => f.endsWith(".ipynb"))
    score += notebooks.length * 0.2
    const pyFiles = files.filter(f => f.endsWith(".py"))
    // If there are python files with data-science imports, boost score
    for (const pf of pyFiles) {
      try {
        const content = readFileSync(pf, "utf-8")
        const dsImports = ["pandas", "numpy", "sklearn", "tensorflow", "torch", "matplotlib", "seaborn"]
        for (const imp of dsImports) {
          if (content.includes(imp)) { score += 0.1; break }
        }
      } catch { /* skip */ }
    }
  } catch { /* non-fatal */ }
  return Math.min(score, 1.0)
}

// ─── Verifiers ─────────────────────────────────────────────────────────

const dsVerifiers: VerifierStrategy[] = [
  {
    name: "notebook-check",
    async verify(context) {
      const issues: string[] = []
      for (const file of context.filesModified) {
        if (!file.endsWith(".ipynb")) continue
        try {
          const absPath = resolve(context.projectDir, file)
          if (!existsSync(absPath)) continue
          const content = readFileSync(absPath, "utf-8")
          const nb = JSON.parse(content)

          // Check notebook structure
          if (!nb.cells || !Array.isArray(nb.cells)) {
            issues.push(`${file}: Invalid notebook structure`)
            continue
          }
          if (nb.nbformat !== 4) issues.push(`${file}: Non-standard nbformat (expected 4)`)

          // Check for execution count issues
          let emptyOutputs = 0
          for (let i = 0; i < nb.cells.length; i++) {
            const cell = nb.cells[i]
            if (cell.cell_type === "code" && cell.execution_count === null) {
              emptyOutputs++
            }
          }
          if (emptyOutputs > 3) issues.push(`${file}: ${emptyOutputs} cells never executed`)
        } catch { /* skip */ }
      }
      if (issues.length > 0) {
        return { passed: false, output: `Notebook issues:\n${issues.join("\n")}` }
      }
      return { passed: true, output: "Notebook valid" }
    },
  },
  {
    name: "python-imports",
    async verify(context) {
      const issues: string[] = []
      for (const file of context.filesModified) {
        if (!file.endsWith(".py")) continue
        try {
          const absPath = resolve(context.projectDir, file)
          if (!existsSync(absPath)) continue
          const content = readFileSync(absPath, "utf-8")
          const lines = content.split("\n")

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            // Check for wildcard imports
            if (line.match(/^\s*from\s+\S+\s+import\s+\*/)) {
              issues.push(`${file}:${i + 1}: Wildcard import — import specific names instead`)
            }
            // Check for bare except:
            if (line.match(/^\s*except\s*:/)) {
              issues.push(`${file}:${i + 1}: Bare except — catch specific exceptions`)
            }
          }
        } catch { /* skip */ }
      }
      if (issues.length > 0) {
        return { passed: false, output: `Python code issues:\n${issues.join("\n")}` }
      }
      return { passed: true, output: "Python imports OK" }
    },
  },
]

// ─── Error Matchers ────────────────────────────────────────────────────

const dsErrorMatchers: ErrorMatcher[] = [
  {
    name: "import-python",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("importerror") || lower.includes("modulenotfounderror") || lower.includes("cannot import")) {
        const match = msg.match(/['"]([\w\-/.]+)['"]/)
        return {
          matched: true, category: "python-import",
          summary: "Python module import error",
          likelyRootCause: `Module ${match?.[1] ?? ""} not installed or not in PYTHONPATH`,
          suggestedFix: `Run: pip install ${match?.[1] ?? "<module>"}`,
          severity: "critical",
        }
      }
      return null
    },
  },
  {
    name: "data-science",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("shape") || lower.includes("dimension") || lower.includes("broadcast") || lower.includes("nan") || lower.includes("inf")) {
        return {
          matched: true, category: "data-shape",
          summary: "Data shape/dimension mismatch or NaN values",
          likelyRootCause: "Incompatible array shapes or missing data preprocessing",
          suggestedFix: "Check data shapes with .shape, handle NaN values with .fillna() or .dropna()",
          severity: "high",
        }
      }
      return null
    },
  },
]

export const dataScienceDomain: DomainPack = {
  name: "data-science",
  description: "Data science & ML domain — notebooks, model training, data analysis, visualization",
  detect: dsDetect,
  verifiers: dsVerifiers,
  errorMatchers: dsErrorMatchers,
  roles: [],
  skills: [],
  tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_nav", "agentic_verify", "agentic_score", "agentic_delegate", "agentic_skill", "agentic_plan", "agentic_execute", "agentic_episodes"],
  fileExtensions: [".py", ".ipynb", ".r", ".rmd", ".sql"],
  formalContract: createGenericContract(),
}
