#!/usr/bin/env node
/**
 * DEPRECATED stub — do not use for Hermes remediation imports.
 *
 * The remediation flow is:
 *   1. node scripts/transform-hermes-remediation.mjs   (normalize research → staging bundle)
 *   2. node scripts/merge-hermes-import-bundle.mjs [--dry-run]
 *   3. node scripts/remediate-catalog-inventory.mjs    (lifecycle/geography/commerce gates)
 *   4. node scripts/validate-catalog.mjs
 *   5. node scripts/sync-catalog-to-lambda.mjs         (only after validation)
 *
 * This legacy importer pointed at data/research/ and filled unsafe defaults
 * (zero prices, placeholder images, out-of-schema fields). It now exits non-zero.
 *
 * @see research/hermes-ethiopia-remediation-2026-08-09/IMPORT.md
 */
console.error(`scripts/import-hermes-catalog.mjs is retired.

Use the remediation pipeline instead:
  node scripts/transform-hermes-remediation.mjs
  node scripts/merge-hermes-import-bundle.mjs [--dry-run]
  node scripts/remediate-catalog-inventory.mjs
  node scripts/validate-catalog.mjs
  node scripts/sync-catalog-to-lambda.mjs
`);
process.exit(1);
