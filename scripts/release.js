#!/usr/bin/env node
/**
 * scripts/release.js — bump version, commit, tag, push, deploy to RPi
 *
 * Usage:
 *   npm run release           → patch bump
 *   npm run release:minor     → minor bump
 *   npm run release:major     → major bump
 *
 * What it does:
 *   1. Refuses to release if there are uncommitted changes
 *   2. Bumps version in root package.json
 *   3. Builds miniapp (vite)
 *   4. Commits version bump + dist
 *   5. Creates git tag
 *   6. Pushes to remote
 *   7. SSHs into RPi and runs update (git pull + docker-compose up --build)
 *
 * RPi env vars (optional, override defaults):
 *   RPI_HOST  — SSH target, default: pi@raspberrypi.local
 *   RPI_DIR   — Remote project dir, default: /home/pi/swipe-to-hire
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// ── Dirty-tree guard ──────────────────────────────────────
const dirty = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
if (dirty) {
  console.error('Refusing to release: uncommitted changes detected.\n');
  console.error(dirty);
  console.error('\nCommit or stash your changes first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const bumpType = args.find(a => a.startsWith('--bump-type='))?.split('=')[1] ?? 'patch';
const valid = ['patch', 'minor', 'major'];
if (!valid.includes(bumpType)) {
  console.error(`Invalid bump type: ${bumpType}. Use: patch, minor, or major`);
  process.exit(1);
}

// ── Bump version in root package.json ────────────────────
const rootPkgPath = 'package.json';
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
const [major, minor, patch] = rootPkg.version.split('.').map(Number);
let newVersion;
if (bumpType === 'major')      newVersion = `${major + 1}.0.0`;
else if (bumpType === 'minor') newVersion = `${major}.${minor + 1}.0`;
else                           newVersion = `${major}.${minor}.${patch + 1}`;
rootPkg.version = newVersion;
writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
console.log(`Bumped to v${newVersion}`);

// ── Build miniapp ─────────────────────────────────────────
console.log('Building miniapp...');
execSync('npm run build:miniapp', { stdio: 'inherit' });

// ── Commit + tag ──────────────────────────────────────────
execSync(`git add package.json packages/miniapp/dist`, { stdio: 'inherit' });
execSync(`git commit -m "chore: release v${newVersion}"`, { stdio: 'inherit' });
execSync(`git tag -a v${newVersion} -m "Release v${newVersion}"`, { stdio: 'inherit' });
console.log(`Tagged v${newVersion}`);

// ── Push ─────────────────────────────────────────────────
execSync('git push && git push --tags', { stdio: 'inherit' });
console.log('Pushed to remote');

// ── Deploy to RPi ─────────────────────────────────────────
const RPI_HOST = process.env.RPI_HOST ?? 'pi@raspberrypi.local';
const RPI_DIR  = process.env.RPI_DIR  ?? '/home/pi/swipe-to-hire';
console.log(`Deploying to ${RPI_HOST}:${RPI_DIR}...`);
execSync(
  `ssh ${RPI_HOST} "cd ${RPI_DIR} && git pull && docker-compose up -d --build bot"`,
  { stdio: 'inherit' }
);
console.log(`\nReleased v${newVersion} and deployed to RPi`);
