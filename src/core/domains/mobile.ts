import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { DomainPack, VerifierStrategy, ErrorMatcher } from "../domain-registry.js"
import { createGenericContract } from "../formal-model.js"

// ─── Keywords ──────────────────────────────────────────────────────────

const mobileKeywords = [
  "mobile", "android", "ios", "react native", "flutter", "swift",
  "kotlin", "java android", "dart", "objc", "swiftui", "uikit",
  "app", "mobile app", "smartphone", "tablet", "ipad", "iphone",
  "apk", "ipa", "app store", "play store", "google play",
  "xcode", "android studio", "gradle", "cocoapods", "pubspec",
  "widget", "activity", "viewcontroller", "fragment", "compose",
  "android manifest", "info.plist", "storyboard", "xib",
  "push notification", "firebase", "admob", "in-app purchase",
  "responsive", "mobile-first", "touch", "gesture", "swipe",
  "offline-first", "local storage", "sqlite", "room", "core data",
  "react-native", "expo", "capacitor", "cordova", "ionic",
]

// ─── Detection ─────────────────────────────────────────────────────────

const mobileDetect = (input: string): number => {
  const lower = input.toLowerCase()
  let score = 0
  for (const kw of mobileKeywords) {
    if (lower.includes(kw)) score += 0.06
  }
  const projectDir = process.cwd()
  const mobileFiles = [
    "AndroidManifest.xml", "build.gradle", "build.gradle.kts",
    "Podfile", "Cartfile", "project.pbxproj",
    "pubspec.yaml", "app.json", "expo.json",
    "Info.plist", ".entitlements",
  ]
  for (const f of mobileFiles) {
    try {
      const fullPath = resolve(projectDir, f)
      if (existsSync(fullPath)) score += 0.25
    } catch { /* skip */ }
  }
  return Math.min(score, 1.0)
}

// ─── Verifiers ─────────────────────────────────────────────────────────

const mobileVerifiers: VerifierStrategy[] = [
  {
    name: "manifest-check",
    async verify(context) {
      const issues: string[] = []
      for (const file of context.filesModified) {
        if (!file.includes("AndroidManifest.xml")) continue
        try {
          const absPath = resolve(context.projectDir, file)
          const content = readFileSync(absPath, "utf-8")

          // Check for common manifest issues
          if (!content.includes("xmlns:android")) {
            issues.push(`${file}: Missing android namespace`)
          }
          if (!content.includes("<application")) {
            issues.push(`${file}: Missing <application> block`)
          }
          // Check for debuggable in release
          if (content.includes("android:debuggable=\"true\"")) {
            issues.push(`${file}: android:debuggable set to true — remove for release builds`)
          }
          // Check for exported activities without intent filter
          const actRegex = /<activity[\s\S]*?<\/activity>/g
          let actMatch: RegExpExecArray | null
          while ((actMatch = actRegex.exec(content)) !== null) {
            const actBlock = actMatch[0]
            if (actBlock.includes("android:exported=\"true\"") && !actBlock.includes("<intent-filter>")) {
              issues.push(`${file}: Activity with exported=true but no intent-filter`)
            }
          }
        } catch { /* skip */ }
      }
      if (issues.length > 0) {
        return { passed: false, output: `Android manifest issues:\n${issues.join("\n")}` }
      }
      return { passed: true, output: "Manifest checks passed" }
    },
  },
  {
    name:"plist-check",
    async verify(context) {
      const issues: string[] = []
      for (const file of context.filesModified) {
        if (!file.endsWith("Info.plist")) continue
        try {
          const absPath = resolve(context.projectDir, file)
          const content = readFileSync(absPath, "utf-8")

          // Check for common plist issues (XML plist format)
          if (!content.includes("<!DOCTYPE plist") && !content.includes("<plist")) {
            issues.push(`${file}: Invalid plist format`)
          }
          // Check for NSAppTransportSecurity for network apps
          if (content.includes("NSAppTransportSecurity")) {
            if (content.includes("NSAllowsArbitraryLoads") && content.includes("<true/>")) {
              issues.push(`${file}: ATS disabled — consider specific exceptions instead`)
            }
          }
        } catch { /* skip */ }
      }
      if (issues.length > 0) {
        return { passed: false, output: `iOS plist issues:\n${issues.join("\n")}` }
      }
      return { passed: true, output: "Plist checks passed" }
    },
  },
]

// ─── Error Matchers ────────────────────────────────────────────────────

const mobileErrorMatchers: ErrorMatcher[] = [
  {
    name: "gradle",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("gradle") || lower.includes("build.gradle")) {
        if (lower.includes("failed") || lower.includes("error") || lower.includes("could not resolve")) {
          return {
            matched: true, category: "gradle",
            summary: "Gradle build error",
            likelyRootCause: "Dependency resolution failure, SDK version mismatch, or plugin error",
            suggestedFix: "Check compileSdkVersion, update Gradle wrapper, verify dependency coordinates",
            severity: "critical",
          }
        }
      }
      return null
    },
  },
  {
    name: "xcode",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("xcode") || lower.includes("swift") || lower.includes("iboutlet") || lower.includes("ibaction")) {
        if (lower.includes("error") || lower.includes("failed") || lower.includes("crash")) {
          return {
            matched: true, category: "xcode-build",
            summary: "Xcode build error",
            likelyRootCause: "Swift compilation error, missing outlet connection, or provisioning issue",
            suggestedFix: "Check IBOutlet connections, verify code signing, clean build folder",
            severity: "high",
          }
        }
      }
      return null
    },
  },
  {
    name: "react-native",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("metro") || lower.includes("react-native") || lower.includes("react native")) {
        if (lower.includes("error") || lower.includes("bundle") || lower.includes("transform")) {
          return {
            matched: true, category: "rn-bundle",
            summary: "React Native bundling error",
            likelyRootCause: "Metro bundler failed to resolve module or transform file",
            suggestedFix: "Clear metro cache: npx react-native start --reset-cache",
            severity: "high",
          }
        }
      }
      return null
    },
  },
]

export const mobileDomain: DomainPack = {
  name: "mobile",
  description: "Mobile development domain — Android (Kotlin/Java), iOS (Swift/ObjC), React Native, Flutter",
  detect: mobileDetect,
  verifiers: mobileVerifiers,
  errorMatchers: mobileErrorMatchers,
  roles: [],
  skills: [],
  tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_nav", "agentic_verify", "agentic_score", "agentic_delegate", "agentic_skill", "agentic_plan", "agentic_execute", "agentic_episodes"],
  fileExtensions: [".kt", ".kts", ".swift", ".java", ".dart", ".xml", ".plist", ".xib", ".storyboard", ".gradle", ".podspec"],
  formalContract: createGenericContract(),
}
