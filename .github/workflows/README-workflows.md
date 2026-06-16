# GitHub Actions CI/CD Workflows for opencode-agentic-engine

This directory contains GitHub Actions workflow files ready to be copied to `.github/workflows/`.

## Files

1. **ci.yml** - Continuous Integration (runs on every push/PR)
2. **publish.yml** - Automated npm publishing (runs on version tags)

## Usage

Copy these files to your repository:

```bash
# Create workflows directory
mkdir -p .github/workflows

# Copy CI workflow
cp /tmp/ci.yml .github/workflows/ci.yml

# Copy publish workflow
cp /tmp/publish.yml .github/workflows/publish.yml

# Commit and push
git add .github/workflows/
git commit -m "ci: Add GitHub Actions workflows"
git push
```

## CI Workflow (ci.yml)

Runs on every push and pull request to main branch:
- ✅ Tests on Node.js 20.x and 22.x
- ✅ Runs build
- ✅ Runs full test suite (495 tests)
- ✅ Checks TypeScript types

## Publish Workflow (publish.yml)

Runs when you push a version tag (e.g., v0.1.0):
- ✅ Builds package
- ✅ Runs tests
- ✅ Publishes to npm registry
- ✅ Creates GitHub release

## Setup Required

### 1. NPM Token
Add npm token to GitHub repository secrets:

1. Generate npm token: https://www.npmjs.com/settings/YOUR_USERNAME/tokens
2. Go to repository Settings → Secrets → Actions
3. Add new secret: `NPM_TOKEN` = your token

### 2. Publishing a Release

```bash
# Update version in package.json
npm version patch  # or minor, or major

# Push changes and tags
git push && git push --tags

# GitHub Actions will automatically publish to npm
```

## Notes

- CI runs on every commit
- Publish only runs on tags matching `v*.*.*`
- Both workflows use Node.js 20+ (as required by package.json)
- Test suite runs in full (495 tests)
