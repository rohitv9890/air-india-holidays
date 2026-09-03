#!/usr/bin/env node
/**
 * Import a Guzo enrichment-return JSONL into research hotels + deployable catalog.
 *
 * - hotel_rate: update hotels.jsonl rateObserved; add/update catalog accommodations
 * - unresolved: annotate pending rows (no invented prices)
 * Other recordTypes are accepted but currently no-op with a skip report.
 *
 * Usage:
 *   node scripts/import-enrichment-return.mjs [path/to/guzo-enrichment-return-YYYY-MM-DD.jsonl]
 *   node scripts/import-enrichment-return.mjs --dry-run [path]
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CATALOG_PATH = join(ROOT, 'data/catalog/v1/catalog.json');
const HOTELS_PATH = join(ROOT, 'research/hermes-ethiopia-hotels-2026-08-08/hotels.jsonl');
const PENDING_PATH = join(ROOT, 'research/hermes-ethiopia-remediation-2026-08-09/catalog-products-pending.jsonl');
const DEFAULT_ENRICHMENT = join(
    ROOT,
    'research/guzo-enrichment-2026-08-10/guzo-enrichment-return-2026-08-10.jsonl',
);
const MANIFEST_PATH = join(ROOT, 'data/catalog/v1/enrichment-import-manifest.json');

const DRY_RUN = process.argv.includes('--dry-run');
const ARG_PATH = process.argv.slice(2).find((a) => !a.startsWith('--'));

const FX_TO_GBP = { GBP: 1, EUR: 1 / 1.17, USD: 0.78, ETB: 0.0054 };

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line, i) => {
            try {
                return JSON.parse(line);
            } catch {
                throw new Error(`Invalid JSONL ${path}:${i + 1}`);
            }
        });
}

function writeJsonl(path, rows) {
    writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function roundMoney(n) {
    return Math.round(Number(n) * 100) / 100;
}

function normalizeBasis(basis) {
    if (!basis) return null;
    const b = String(basis).toLowerCase().trim();
    if (b === 'per night' || b === 'per-night') return 'per-night';
    if (b === 'per room' || b === 'per-room') return 'per-room';
    if (b === 'per room per night' || b === 'per-room-per-night' || b === 'per room / night') {
        return 'per-night';
    }
    if (b.includes('night')) return 'per-night';
    if (b.includes('room')) return 'per-room';
    return null;
}

function toGbp(amount, currency, fxDate) {
    const cur = String(currency || 'GBP').toUpperCase();
    const rate = FX_TO_GBP[cur];
    if (rate == null) throw new Error(`Unsupported currency: ${currency}`);
    return {
        amountGbp: roundMoney(Number(amount) * rate),
        rate,
        fxDate: fxDate || new Date().toISOString().slice(0, 10),
        sourceCurrency: cur,
    };
}

function validateHotelRate(row) {
    const rate = row?.booking?.rateObserved;
    const source = row?.source || {};
    const errors = [];
    if (!row.proposedCatalogId) errors.push('missing proposedCatalogId');
    if (!row.canonicalId) errors.push('missing canonicalId');
    if (!(typeof rate?.amount === 'number' && rate.amount > 0)) errors.push('invalid rate amount');
    if (!['GBP', 'USD', 'EUR', 'ETB'].includes(String(rate?.currency || '').toUpperCase())) {
        errors.push('invalid currency');
    }
    if (!normalizeBasis(rate?.basis)) errors.push('unsupported basis');
    if (!source.url) errors.push('missing source.url');
    if (!(rate?.observedAt || row.observedAt)) errors.push('missing observedAt');
    return errors;
}

function priceFieldsFromRate(row) {
    const rate = row.booking.rateObserved;
    const basis = normalizeBasis(rate.basis);
    const observedAt = rate.observedAt || row.observedAt;
    const { amountGbp, rate: fx, fxDate, sourceCurrency } = toGbp(rate.amount, rate.currency, observedAt);
    const publisher = row.source?.publisher || 'unknown';
    return {
        basePrice: {
            amount: amountGbp,
            currency: 'GBP',
            basis,
        },
        priceProvenance: {
            sourceAmount: rate.amount,
            sourceCurrency,
            sourceBasis: basis,
            fxRateToGbp: fx,
            fxDate,
            convertedAmount: amountGbp,
            convertedCurrency: 'GBP',
            notes:
                `guzo-enrichment-return ${observedAt}; ${publisher} observed ` +
                `${rate.priceText || `${rate.amount} ${sourceCurrency}`}` +
                (rate.stayDates ? ` (${rate.stayDates})` : ''),
        },
        confidence: publisher === 'hotel' || publisher === 'operator' ? 'high' : 'medium',
        sourceRefs: [
            `enrichment:${row.canonicalId}`,
            row.source?.url,
            rate.sourceId ? `ota-hotel:${rate.sourceId}` : null,
        ].filter(Boolean),
    };
}

function buildAccommodationProduct(pendingRow, enrichmentRow) {
    const mapped = { ...(pendingRow?.mappedFields || {}) };
    const priced = priceFieldsFromRate(enrichmentRow);
    const seasonality = { ...(mapped.seasonality || {}) };
    if (Array.isArray(seasonality.availableMonths) && seasonality.availableMonths.length === 0) {
        delete seasonality.availableMonths;
    }

    return {
        id: enrichmentRow.proposedCatalogId,
        type: 'accommodation',
        name: mapped.name || enrichmentRow.canonicalId,
        summary: mapped.summary || `${mapped.name || enrichmentRow.canonicalId} in Ethiopia.`,
        destinations: mapped.destinations || [],
        themes: mapped.themes || ['stay'],
        duration: mapped.duration || { days: 1, nights: 1 },
        tier: mapped.tier || 'comfort',
        ...priced,
        inclusions: mapped.inclusions || [],
        exclusions: mapped.exclusions || [],
        images: mapped.images || [],
        easygds: mapped.easygds || {
            packageId: null,
            placeId: mapped.destinations?.[0] || null,
            hotelId: null,
            flightConfigId: null,
            productCode: enrichmentRow.proposedCatalogId,
        },
        seasonality,
        compatibility: mapped.compatibility || mapped.destinations || [],
        status: 'draft',
        availabilityMode: 'indicative',
        blockers: ['AWAITING_ACTIVE_GATES'],
        inclusionCompleteness: 'unknown',
        exclusionCompleteness: 'unknown',
    };
}

function patchHotelRecord(hotel, enrichmentRow) {
    const rate = enrichmentRow.booking.rateObserved;
    const next = {
        ...hotel,
        booking: {
            ...(hotel.booking || {}),
            statusOnSource: enrichmentRow.booking?.statusOnSource || hotel.booking?.statusOnSource || 'bookable',
            bookingChannelsObserved: [
                ...new Set([
                    ...(hotel.booking?.bookingChannelsObserved || []),
                    ...(enrichmentRow.booking?.bookingChannelsObserved || []),
                ]),
            ],
            rateObserved: {
                priceText: rate.priceText || null,
                amount: rate.amount,
                currency: String(rate.currency).toUpperCase(),
                basis: rate.basis,
                roomType: rate.roomType || null,
                mealBasis: rate.mealBasis || null,
                taxesText: rate.taxesText || null,
                stayDates: rate.stayDates || null,
                observedAt: rate.observedAt || enrichmentRow.observedAt,
                sourceId: rate.sourceId || null,
            },
        },
        reviewNotes: [
            hotel.reviewNotes,
            `Enrichment ${enrichmentRow.observedAt}: rate from ${enrichmentRow.source?.publisher || 'source'}`,
        ]
            .filter(Boolean)
            .join(' | '),
    };
    if (enrichmentRow.operatingStatus === 'operating') {
        next.fieldConfidence = {
            ...(hotel.fieldConfidence || {}),
            operatingStatus: 'high',
            booking: 'high',
        };
    }
    if (enrichmentRow.canonicalUrl && !next.canonicalUrl) next.canonicalUrl = enrichmentRow.canonicalUrl;
    if (enrichmentRow.bookingUrl && !next.bookingUrl) next.bookingUrl = enrichmentRow.bookingUrl;
    return next;
}

function main() {
    const enrichmentPath = ARG_PATH || DEFAULT_ENRICHMENT;
    if (!existsSync(enrichmentPath)) {
        console.error('Missing enrichment file:', enrichmentPath);
        process.exit(1);
    }
    for (const p of [CATALOG_PATH, HOTELS_PATH, PENDING_PATH]) {
        if (!existsSync(p)) {
            console.error('Missing required path:', p);
            process.exit(1);
        }
    }

    // Keep a copy under research/ for provenance if importing from Downloads.
    const archiveDir = join(ROOT, 'research/guzo-enrichment-2026-08-10');
    const archivePath = join(archiveDir, basename(enrichmentPath));
    if (!DRY_RUN) {
        mkdirSync(archiveDir, { recursive: true });
        if (enrichmentPath !== archivePath) copyFileSync(enrichmentPath, archivePath);
    }

    const rows = readJsonl(enrichmentPath);
    const catalog = readJson(CATALOG_PATH);
    const hotels = readJsonl(HOTELS_PATH);
    const pending = readJsonl(PENDING_PATH);

    const hotelsById = new Map(hotels.map((h) => [h.id, h]));
    const pendingByProposed = new Map(pending.map((p) => [p.proposedCatalogId, p]));
    const pendingByCanonical = new Map(pending.map((p) => [p.canonicalId, p]));
    const productById = new Map(catalog.products.map((p) => [p.id, p]));

    const report = {
        generatedAt: new Date().toISOString(),
        sourceFile: enrichmentPath,
        dryRun: DRY_RUN,
        hotelRatesAccepted: [],
        hotelRatesRejected: [],
        catalogAdded: [],
        catalogUpdated: [],
        unresolvedAnnotated: [],
        skippedRecordTypes: {},
    };

    for (const row of rows) {
        if (row.recordType === 'unresolved') {
            const pendingRow =
                pendingByProposed.get(row.proposedCatalogId) || pendingByCanonical.get(row.canonicalId);
            if (pendingRow) {
                pendingRow.enrichmentUnresolved = {
                    observedAt: row.observedAt,
                    reasonCodes: row.reasonCodes || [],
                    notes: row.notes || null,
                    sourcesChecked: row.sourcesChecked || [],
                };
                report.unresolvedAnnotated.push(row.proposedCatalogId || row.canonicalId);
            } else {
                report.unresolvedAnnotated.push(`${row.proposedCatalogId || row.canonicalId}:pending-missing`);
            }
            continue;
        }

        if (row.recordType !== 'hotel_rate') {
            report.skippedRecordTypes[row.recordType] =
                (report.skippedRecordTypes[row.recordType] || 0) + 1;
            continue;
        }

        const errors = validateHotelRate(row);
        if (errors.length) {
            report.hotelRatesRejected.push({ id: row.proposedCatalogId, errors });
            continue;
        }

        const hotel = hotelsById.get(row.canonicalId);
        if (hotel) {
            hotelsById.set(row.canonicalId, patchHotelRecord(hotel, row));
        }

        const pendingRow = pendingByProposed.get(row.proposedCatalogId);
        const priced = priceFieldsFromRate(row);
        const existing = productById.get(row.proposedCatalogId);

        if (existing && existing.type === 'accommodation') {
            Object.assign(existing, priced, {
                availabilityMode: 'indicative',
                status: existing.status === 'rejected' ? 'rejected' : 'draft',
                blockers: ['AWAITING_ACTIVE_GATES'],
            });
            report.catalogUpdated.push(existing.id);
        } else if (!existing) {
            if (!pendingRow) {
                report.hotelRatesRejected.push({
                    id: row.proposedCatalogId,
                    errors: ['pending mappedFields missing; cannot create product'],
                });
                continue;
            }
            const product = buildAccommodationProduct(pendingRow, row);
            catalog.products.push(product);
            productById.set(product.id, product);
            report.catalogAdded.push(product.id);
        } else {
            report.hotelRatesRejected.push({
                id: row.proposedCatalogId,
                errors: [`catalog id exists as type=${existing.type}`],
            });
            continue;
        }

        if (pendingRow) {
            pendingRow.blockers = (pendingRow.blockers || []).filter(
                (b) =>
                    ![
                        'PRICE_UNKNOWN',
                        'PRICE_BASIS_UNSUPPORTED',
                        'OPERATING_STATUS_UNVERIFIED',
                    ].includes(b.code),
            );
            pendingRow.enrichmentResolved = {
                observedAt: row.observedAt,
                sourceUrl: row.source?.url,
                publisher: row.source?.publisher,
                amount: row.booking.rateObserved.amount,
                currency: row.booking.rateObserved.currency,
                basis: normalizeBasis(row.booking.rateObserved.basis),
            };
            if (row.operatingStatus === 'operating') {
                pendingRow.blockers = (pendingRow.blockers || []).filter(
                    (b) => b.code !== 'OPERATING_STATUS_UNVERIFIED',
                );
            }
        }

        report.hotelRatesAccepted.push(row.proposedCatalogId);
    }

    catalog.generatedAt = new Date().toISOString();
    catalog.notes =
        (catalog.notes || 'Guzo catalog') +
        ` Enrichment import ${report.generatedAt.slice(0, 10)}: ` +
        `${report.catalogAdded.length} hotels added, ${report.catalogUpdated.length} updated from guzo-enrichment-return.`;

    if (DRY_RUN) {
        console.log(JSON.stringify({ ok: true, ...report }, null, 2));
        return;
    }

    writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
    writeJsonl(HOTELS_PATH, [...hotelsById.values()]);
    writeJsonl(PENDING_PATH, pending);
    writeFileSync(MANIFEST_PATH, JSON.stringify(report, null, 2) + '\n');

    console.log(JSON.stringify({
        ok: true,
        dryRun: false,
        accepted: report.hotelRatesAccepted.length,
        rejected: report.hotelRatesRejected.length,
        added: report.catalogAdded.length,
        updated: report.catalogUpdated.length,
        unresolvedAnnotated: report.unresolvedAnnotated.length,
        skippedRecordTypes: report.skippedRecordTypes,
        nextSteps: [
            'node scripts/remediate-catalog-inventory.mjs',
            'node scripts/validate-catalog.mjs',
            'node --test infrastructure/lambda/guzo-chat-handler/test/*.test.mjs',
            'node scripts/sync-catalog-to-lambda.mjs',
        ],
    }, null, 2));
}

main();
