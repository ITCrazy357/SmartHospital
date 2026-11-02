import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deploymentRevision, writeDeploymentMetadata } from './deployment-metadata.mjs';

test('release metadata selects the first defined provider and normalizes a full Git SHA', () => {
  assert.equal(deploymentRevision({ VERCEL_GIT_COMMIT_SHA: 'A'.repeat(40), GITHUB_SHA: 'b'.repeat(40) }), 'a'.repeat(40));
  assert.equal(deploymentRevision({ GITHUB_SHA: 'B'.repeat(40), APP_REVISION: 'c'.repeat(40) }), 'b'.repeat(40));
  assert.equal(deploymentRevision({ APP_REVISION: 'c'.repeat(40) }), 'c'.repeat(40));
});

test('release metadata never publishes malformed values or silently changes providers', () => {
  for (const value of ['', 'private-fixture-value', 'a'.repeat(39), 'g'.repeat(40), 'a'.repeat(40) + '\n']) {
    assert.equal(deploymentRevision({ VERCEL_GIT_COMMIT_SHA: value, GITHUB_SHA: 'b'.repeat(40) }), null);
    assert.equal(deploymentRevision({ GITHUB_SHA: value, APP_REVISION: 'c'.repeat(40) }), null);
    assert.equal(deploymentRevision({ APP_REVISION: value }), null);
  }
  assert.equal(deploymentRevision({}), null);
});

test('written deployment artifact contains only the revision and overwrites previous metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'smarthospital-release-'));
  const metadataFile = join(directory, 'deployment.json');
  try {
    writeDeploymentMetadata(directory, { APP_REVISION: 'a'.repeat(40), PRIVATE_FIXTURE: 'never-publish-this' });
    assert.deepEqual(JSON.parse(readFileSync(metadataFile, 'utf8')), { revision: 'a'.repeat(40) });
    writeDeploymentMetadata(directory, { APP_REVISION: 'malformed-private-fixture' });
    assert.deepEqual(JSON.parse(readFileSync(metadataFile, 'utf8')), { revision: null });
  } finally {
    unlinkSync(metadataFile);
    rmdirSync(directory);
  }
});

test('both Vercel root configurations prevent cached deployment identity', () => {
  for (const relativePath of ['../../vercel.json', '../vercel.json']) {
    const config = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
    const route = config.headers.find(entry => entry.source === '/deployment.json');
    assert.ok(route.headers.some(header => header.key.toLowerCase() === 'cache-control' && header.value === 'no-store'));
  }
});
