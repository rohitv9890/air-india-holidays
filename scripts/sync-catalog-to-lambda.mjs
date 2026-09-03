#!/usr/bin/env node
/**
 * Copy repo catalog fixtures into the Lambda package so SAM deploys include them.
 * Runs integrity validation first; refuses to sync an invalid active catalog.
 *
 * Usage: node scripts/sync-catalog-to-lambda.mjs
 *        node scripts/sync-catalog-to-lambda.mjs --force   (skip validation — not for release)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'data/catalog/v1');
const dest = path.join(root, 'infrastructure/lambda/guzo-chat-handler/data/catalog/v1');
const force = process.argv.includes('--force');

if (!fs.existsSync(src)) {
    console.error('Missing', src);
    process.exit(1);
}

if (!force) {
    const validation = spawnSync(process.execPath, [path.join(root, 'scripts/validate-catalog.mjs')], {
        cwd: root,
        encoding: 'utf8',
    });
    if (validation.stdout) process.stdout.write(validation.stdout);
    if (validation.stderr) process.stderr.write(validation.stderr);
    if (validation.status !== 0) {
        console.error('Refusing to sync: catalog validation failed. Fix errors or pass --force.');
        process.exit(validation.status || 1);
    }
}

fs.mkdirSync(dest, { recursive: true });
const synced = [];
for (const name of fs.readdirSync(src)) {
    if (!name.endsWith('.json')) continue;
    // Do not ship local remediation/merge manifests into Lambda runtime package.
    if (name.endsWith('-manifest.json')) continue;
    fs.copyFileSync(path.join(src, name), path.join(dest, name));
    synced.push(name);
    console.log('synced', name);
}

// Diff check
let drift = 0;
for (const name of synced) {
    const a = fs.readFileSync(path.join(src, name));
    const b = fs.readFileSync(path.join(dest, name));
    if (!a.equals(b)) {
        console.error('Drift after copy:', name);
        drift += 1;
    }
}
if (drift) {
    console.error('Lambda catalog copies do not match source');
    process.exit(1);
}
console.log(JSON.stringify({ ok: true, synced, identical: true }, null, 2));
