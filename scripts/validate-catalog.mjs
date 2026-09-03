#!/usr/bin/env node
/**
 * Validate deployable catalog against structural + cross-file integrity gates.
 *
 * Checks catalog products, destination geo/stay guidance, day modules and 1–5
 * day plans, journey connections, and package moduleId overrides.
 *
 * Exit 1 when any active/production error is present.
 * Draft records are reported separately and do not fail the run by themselves.
 *
 * Usage:
 *   node scripts/validate-catalog.mjs
 *   node scripts/validate-catalog.mjs --json
 *   CATALOG_DIR=path node scripts/validate-catalog.mjs
 */
import { join } from 'node:path';
import {
    ROOT,
    loadCatalogBundle,
    validateCatalogIntegrity,
    formatReport,
} from './lib/catalog-integrity.mjs';

const jsonMode = process.argv.includes('--json');
const catalogDir = process.env.CATALOG_DIR
    ? join(process.cwd(), process.env.CATALOG_DIR)
    : join(ROOT, 'data/catalog/v1');

const bundle = loadCatalogBundle(catalogDir);
const result = validateCatalogIntegrity(bundle);

if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
} else {
    console.log(formatReport(result));
}

process.exit(result.ok ? 0 : 1);
