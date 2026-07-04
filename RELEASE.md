# Release Process

How to build, version, and publish SMS Gateway Dashboard releases.

## Overview

Releases are automated through GitHub Actions CI. When a version tag is pushed, the CI:
1. Builds the Tauri desktop app on **Linux**, **Windows**, and **macOS**
2. Produces installers (AppImage, DEB, RPM, MSI, EXE, DMG)
3. Creates a **draft** GitHub Release with all artifacts attached

You do **not** build locally — the CI does it for you.

## Quick Start (Normal Flow)

```bash
# 1. Make your changes, then commit
git add .
git commit -m "description of changes"

# 2. Push to master  
git push

# 3. Tag the release version
git tag v2.0.1

# 4. Push the tag — this triggers the CI build + release
git push origin v2.0.1
```

That's it. The CI builds everything and creates a draft release at:
`https://github.com/Kilibest/SMS-Gateway-Android/releases`

**Review and publish** the draft from the GitHub web UI.

> **Note:** Tags must follow the `v` prefix pattern (`v2.0.1`, `v2.1.0`, etc.) for the CI to trigger.

## Full Workflow

```
                         ┌──────────────────────────┐
                         │  Make changes to code     │
                         │  (proxy.rs, index.html,   │
                         │   tauri.conf.json, etc.)  │
                         └──────────┬───────────────┘
                                    │
                         ┌──────────▼───────────────┐
                         │  Commit and push to       │
                         │  master branch            │
                         │  git add .                │
                         │  git commit -m "..."      │
                         │  git push                 │
                         └──────────┬───────────────┘
                                    │
                         ┌──────────▼───────────────┐
                         │  Tag the release          │
                         │  git tag vX.Y.Z           │
                         │  git push origin vX.Y.Z   │
                         └──────────┬───────────────┘
                                    │
                         ┌──────────▼───────────────┐
                         │  GitHub Actions CI runs   │
                         │  .github/workflows/       │
                         │  build.yml                │
                         │                           │
                         │  ┌─────────────────────┐  │
                         │  │ Linux (AppImage/deb) │  │
                         │  │ Windows (msi/exe)    │  │
                         │  │ macOS (dmg)          │  │
                         │  └─────────────────────┘  │
                         └──────────┬───────────────┘
                                    │
                         ┌──────────▼───────────────┐
                         │  Draft release created    │
                         │  on GitHub with all       │
                         │  platform installers      │
                         └──────────┬───────────────┘
                                    │
                         ┌──────────▼───────────────┐
                         │  Review and click         │
                         │  "Publish release"        │
                         └──────────────────────────┘
```

## Versioning

Follow [Semantic Versioning](https://semver.org/):

| Change | Example | Version bump |
|--------|---------|--------------|
| Bug fix | SSRF blocking fix | `2.0.0` → `2.0.1` |
| New feature | CSV import | `2.0.0` → `2.1.0` |
| Breaking change | API redesign | `2.0.0` → `3.0.0` |

Update the version in these files when creating a release:

- `src-tauri/Cargo.toml` — `[package] version = "x.y.z"`
- `src-tauri/tauri.conf.json` — `"version": "x.y.z"`
- `package.json` — root and `frontend/package.json`

**Important:** The version must match the tag (e.g., tag `v2.0.1` means version `2.0.1` in Cargo.toml).

## Retagging (If CI Fails)

If a release tag push triggers a CI failure, fix the issue, then:

```bash
# Delete old tag locally and on remote
git tag -d v2.0.1
git push --delete origin v2.0.1

# Re-create tag on the latest commit
git tag v2.0.1
git push origin v2.0.1
```

This triggers a fresh CI run with the fix.

## How It All Connects

### CI Pipeline (`.github/workflows/build.yml`)

The workflow has two jobs that run in sequence:

**1. `build` job** — runs in parallel on all 3 platforms:
- Sets up Rust, Node.js, system libraries
- Runs `cargo tauri build` via the official `tauri-apps/tauri-action`
- Uploads build artifacts (installers) as workflow artifacts

**2. `release` job** — runs only on tag pushes:
- Downloads artifacts from all 3 platforms
- Creates a **draft** GitHub Release with all installer files
- Auto-generates release notes from commit history

### Trigger Conditions

| Event | Builds | Creates Release |
|-------|--------|-----------------|
| `git push` to `master` | ✅ Yes | ❌ No |
| `git push origin v*` | ✅ Yes | ✅ Yes (draft) |
| Pull request to `master` | ✅ Yes | ❌ No |

## Manual Download (No Build Required)

Pre-built installers for each release are available at:
https://github.com/Kilibest/SMS-Gateway-Android/releases

## Local Build (For Testing)

If you want to test the build locally without waiting for CI:

```bash
cd src-tauri
cargo tauri build
```

Installers appear in `src-tauri/target/release/bundle/`.
