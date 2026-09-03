import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    loadCatalog,
    search,
    getById,
    isSellableProduct,
    listDestinations,
    normalizeDestination,
    normalizeImageUrl,
    rankPackagesForIntent,
    rankProductsForIntent,
    toRecommendation,
} from '../lib/catalog.js';
import {
    loadCatalogBundle,
    validateCatalogIntegrity,
    ROOT,
} from '../../../../scripts/lib/catalog-integrity.mjs';
import { ideaForStayDay, loadDayIdeas } from '../lib/day-content.js';
import { runTool } from '../lib/tools.js';
import { createEmptyIntent, mergeIntent } from '../lib/intent.js';
import { quotePrice, seasonalMultiplier, gbpToEur } from '../lib/pricing.js';
import { checkAvailability } from '../lib/availability.js';
import { buildItinerary, buildStayPlan } from '../lib/itinerary-builder.js';
import { displayProductTitle } from '../lib/display-title.js';
import { isInternationalFlightsExclusion } from '../lib/itinerary-inclusions.js';
import { estimateMiles } from '../lib/miles.js';
import { selectFlights } from '../lib/flights.js';

describe('catalog', () => {
    it('loads products', () => {
        const cat = loadCatalog();
        assert.equal(cat.version, 'v1');
        assert.ok(cat.products.length >= 25);
    });

    it('searches by type and destination', () => {
        const pkgs = search({ type: 'package', destination: 'lalibela' });
        assert.ok(pkgs.some((p) => p.id === 'pkg-northern-historic-7d'));
        assert.ok(getById('pkg-omo-cultural-6d'));
        assert.ok(listDestinations().length >= 10);
    });

    it('normalizes EasyGDS destinations and matches multi-place queries', () => {
        assert.equal(normalizeDestination('2093'), 'lalibela');
        assert.equal(normalizeDestination('Lalibela, Amhara Region, Ethiopia'), 'lalibela');
        assert.ok(search({ type: 'package', destination: '2093' }).length > 0);

        const matches = search({
            type: 'package',
            q: 'Addis Ababa Lalibela Bahir Dar',
        });
        assert.ok(matches.length > 0);
        assert.ok(matches.every((p) =>
            p.destinations.includes('addis-ababa')
            && p.destinations.includes('lalibela')
            && p.destinations.includes('bahir-dar')
        ));
    });

    it('ranks close package matches and maps UI recommendation cards', () => {
        const matches = rankPackagesForIntent({
            destination: {
                name: 'Lalibela, Amhara Region, Ethiopia',
                code: '2093',
                id: '2093',
            },
            interests: ['Addis Ababa', 'Bahir Dar'],
            durationDays: 9,
            tier: 'classic',
        });
        assert.ok(matches.length > 0);
        assert.ok(matches[0].destinations.includes('lalibela'));
        assert.ok(matches[0].destinations.includes('bahir-dar'));

        const card = toRecommendation(matches[0]);
        assert.equal(card.id, matches[0].id);
        assert.equal(card.title, displayProductTitle(matches[0].name));
        assert.doesNotMatch(card.title, /GR03|\([A-Z]{2,}\d+\)/);
        assert.equal(typeof card.priceFrom, 'number');

        const withImage = toRecommendation(getById('dest-lalibela'));
        assert.match(withImage.image, /\/thumb\/[^/]+\/[^/]+\/[^/]+\/\d+px-/);
    });

    it('repairs collapsed Wikimedia thumb URLs', () => {
        const broken = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/1280px-Bete_Giyorgis_05.jpg';
        const fixed = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Bete_Giyorgis_05.jpg/1280px-Bete_Giyorgis_05.jpg';
        assert.equal(normalizeImageUrl(broken), fixed);
        assert.equal(normalizeImageUrl(fixed), fixed);
    });

    it('replaces the hazy Addis skyline with Friendship Park', () => {
        const legacy = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Addis_Ababa_skyline.jpg/1280px-Addis_Ababa_skyline.jpg';
        assert.equal(normalizeImageUrl(legacy), 'images/addis-friendship-park.jpg');
        assert.equal(
            getById('dest-addis-ababa')?.images?.[0]?.url,
            'images/addis-friendship-park.jpg',
        );
    });

    it('replaces the broken Gondar Fasil Ghebbi Wikimedia URL', () => {
        const legacy = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Fasil_Ghebbi_%28Gonder%2C_Ethiopia%29.jpg/1280px-Fasil_Ghebbi_%28Gonder%2C_Ethiopia%29.jpg';
        const fixed = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/ET_Gondar_asv2018-02_img11_Fasil_Ghebbi.jpg/1280px-ET_Gondar_asv2018-02_img11_Fasil_Ghebbi.jpg';
        assert.equal(normalizeImageUrl(legacy), fixed);
    });

    it('prefers the exact trip length over a one-day tier match', () => {
        const matches = rankPackagesForIntent({
            destination: { name: 'Lalibela', catalogId: 'lalibela' },
            interests: ['Lalibela', 'Simien Mountains'],
            durationDays: 8,
            tier: 'comfort',
        });
        assert.equal(matches[0].id, 'pkg-northern-historic-8d');
    });

    it('maps partial Addis tokens without treating gateway IATA as Bale/Danakil', () => {
        assert.equal(normalizeDestination('add'), 'addis-ababa');
        assert.equal(normalizeDestination('addis'), 'addis-ababa');
        assert.equal(normalizeDestination('city break in add'), 'addis-ababa');
        assert.equal(normalizeDestination({ name: 'add', code: null }), 'addis-ababa');
    });

    it('ranks Addis city-break intents toward Addis-focused packages', () => {
        const matches = rankPackagesForIntent({
            destination: { name: 'add', code: null, type: 'place_id' },
            interests: ['city break'],
            preferences: 'city break in add',
        });
        assert.ok(matches.length > 0);
        assert.equal(matches[0].id, 'pkg-addis-stopover-3d');
        assert.deepEqual(matches[0].destinations, ['addis-ababa']);
        assert.ok(matches.every((p) => p.destinations.length === 1 && p.destinations[0] === 'addis-ababa'));
        const ids = matches.map((p) => p.id);
        assert.equal(ids.includes('pkg-northern-historic-7d'), false);
        assert.equal(ids.includes('pkg-northern-historic-8d'), false);
        assert.ok(ids.indexOf('pkg-addis-stopover-3d') < ids.indexOf('pkg-bale-wildlife-5d')
            || !ids.includes('pkg-bale-wildlife-5d'));
        assert.ok(ids.indexOf('pkg-addis-stopover-3d') < ids.indexOf('pkg-danakil-adventure-4d')
            || !ids.includes('pkg-danakil-adventure-4d'));
    });

    it('keeps Northern Historic circuits out of Addis city-break chip results', () => {
        const chip = rankPackagesForIntent({
            preferences: 'Addis Ababa city break',
        });
        const ids = chip.map((p) => p.id);
        assert.ok(ids.includes('pkg-addis-stopover-3d'));
        assert.equal(ids.includes('pkg-northern-historic-7d'), false);
        assert.equal(ids.includes('pkg-northern-historic-8d'), false);
        assert.ok(chip.every((p) => p.destinations.length === 1 && p.destinations[0] === 'addis-ababa'));
    });

    it('prefers a matching multi-stop tour over an Addis stopover for a long family holiday', () => {
        const [match] = rankPackagesForIntent({
            destination: { name: 'Addis Ababa, Ethiopia', code: 'ADD', catalogId: 'addis-ababa' },
            durationDays: 10,
            preferences: 'Family trip around Ethiopia',
            interests: ['family', 'culture', 'nature'],
            tier: 'comfort',
        });
        assert.notEqual(match.id, 'pkg-addis-stopover-3d');
        assert.equal(match.duration.days, 10);
        assert.ok(match.destinations.length > 1);
    });

    it('ranks Addis hotel intents toward accommodations', () => {
        const hotels = rankProductsForIntent({
            destination: { name: 'Addis Ababa', code: 'ADD' },
            preferences: 'i want a hotel in addis',
        }, { types: ['accommodation'], limit: 4 });
        assert.ok(hotels.length > 0);
        assert.ok(hotels.every((p) => p.type === 'accommodation'));
        assert.ok(hotels.every((p) => p.destinations.includes('addis-ababa')));
    });

    it('search_catalog returns Addis hotels for hotel queries on packages tab', async () => {
        const intent = mergeIntent(createEmptyIntent('packages'), {
            destination: { name: 'addis', code: 'ADD' },
            preferences: 'i want a hotel in addis',
        }, 'packages');
        const result = await runTool('search_catalog', {
            q: 'hotel in addis',
            type: 'accommodation',
            destination: 'addis',
        }, { intent, tab: 'packages' });
        assert.equal(result.ok, true);
        assert.ok(result.count > 0);
        assert.ok(result.items.every((p) => p.type === 'accommodation'));
        assert.ok(result.items.every((p) => p.destinations.includes('addis-ababa')));
    });

    it('search_catalog for Addis city break omits Northern Historic circuits', async () => {
        const result = await runTool('search_catalog', {
            q: 'Addis Ababa city break',
            type: 'package',
        }, { intent: createEmptyIntent('packages'), tab: 'packages' });
        assert.equal(result.ok, true);
        const ids = result.items.map((p) => p.id);
        assert.ok(ids.includes('pkg-addis-stopover-3d'));
        assert.equal(ids.includes('pkg-northern-historic-7d'), false);
        assert.equal(ids.includes('pkg-northern-historic-8d'), false);
    });

    it('keeps Hermes incomplete packages as non-sellable drafts but preserves records', () => {
        const draft = getById('pkg-be-historic-north-christmas-lalibela-11d', { includeNonActive: true });
        assert.ok(draft);
        assert.equal(draft.status, 'draft');
        assert.equal(getById('pkg-be-historic-north-christmas-lalibela-11d'), null);
        assert.equal(isSellableProduct(draft), false);
        assert.ok(!search({ type: 'package' }).some((p) => p.id === draft.id));
        assert.ok(draft.inclusions?.length > 0, 'christmas package has source inclusions');
        assert.ok(draft.route?.length > 0, 'christmas package now has a logical route');
        const nightSum = (draft.route || []).reduce((n, s) => n + (Number(s.nights) || 0), 0);
        assert.equal(nightSum, draft.duration.nights);
        for (const template of draft.dayTemplates || []) {
            assert.ok(template.moduleId, `day ${template.day} should reference a moduleId`);
            assert.equal(template.title, undefined);
            assert.equal(template.summary, undefined);
        }
        assert.ok((draft.blockers || []).includes('COMMERCIAL_REVIEW'));

        const hotel = getById('acc-addis-ababa-hotel-lobelia');
        assert.ok(hotel);
        assert.equal(hotel.basePrice.currency, 'GBP');
        assert.ok(['per-night', 'per-room'].includes(hotel.basePrice.basis));
        assert.ok(hotel.basePrice.amount > 0);
        assert.ok(hotel.priceProvenance?.sourceCurrency);
        assert.ok(listDestinations().some((d) => d.id === 'hawassa'));
        assert.ok(listDestinations().some((d) => d.id === 'ziway'));
        assert.ok(listDestinations().some((d) => d.id === 'abijatta-shalla'));
        assert.ok(listDestinations().some((d) => d.id === 'yirgacheffe'));
    });

    it('promotes Brilliant Ethiopia packages with source-backed routes and inclusions', () => {
        for (const id of [
            'pkg-be-simien-mountains-northern-history-7d',
            'pkg-be-best-of-southern-ethiopia-13d',
            'pkg-be-4-day-simien-trek',
            'pkg-be-cultural-and-natural-south-13d',
        ]) {
            const pkg = getById(id);
            assert.ok(pkg, id);
            assert.equal(pkg.status, 'active', id);
            assert.ok(pkg.inclusions?.length, id);
            assert.ok(pkg.exclusions?.length, id);
            const nightSum = (pkg.route || []).reduce((n, s) => n + (Number(s.nights) || 0), 0);
            assert.equal(nightSum, pkg.duration.nights, id);
        }
    });

    it('promotes source-backed Hermes route/night repairs to sellable when gates pass', () => {
        for (const id of [
            'pkg-classic-ethiopia-highlights-10d-set',
            'pkg-ee-around-rift-valley-lakes-11d',
            'pkg-venture-rift-valley-lakes-3d',
        ]) {
            const pkg = getById(id);
            assert.ok(pkg, id);
            assert.equal(pkg.status, 'active', id);
            assert.equal(isSellableProduct(pkg), true, id);
            const nightSum = (pkg.route || []).reduce((n, s) => n + (Number(s.nights) || 0), 0);
            assert.equal(nightSum, pkg.duration.nights, id);
            assert.ok(pkg.route.every((s) => s.nights != null), id);
            assert.ok(!(pkg.route || []).some((s) => s.destinationId === 'heathrow'), id);
        }
        const ee = getById('pkg-ee-around-rift-valley-lakes-11d');
        assert.equal(ee.originFlightPoint, 'LHR');
        assert.ok(ee.route.some((s) => s.destinationId === 'ziway' && s.nights === 2));
        assert.ok(ee.route.some((s) => s.destinationId === 'yirgacheffe' && s.nights === 1));
    });

    it('passes referential integrity and lifecycle gates for active products', () => {
        const result = validateCatalogIntegrity(loadCatalogBundle());
        assert.equal(result.ok, true, result.errors.map((e) => `${e.id}:${e.code}`).join('; '));
        const cat = loadCatalog();
        for (const p of cat.products.filter((x) => x.status === 'active' && x.type === 'package')) {
            assert.ok(p.route?.length, p.id);
            assert.ok(p.inclusions?.length, p.id);
            assert.ok(p.exclusions?.length, p.id);
            assert.ok(
                p.inclusions.some((item) => /^international flights?\b/i.test(item)),
                `${p.id} should include international flights`,
            );
            assert.equal(
                p.exclusions.some(isInternationalFlightsExclusion),
                false,
                `${p.id} should not exclude international flights`,
            );
            assert.ok(p.basePrice?.amount > 0, p.id);
            assert.equal(p.availabilityMode, 'indicative');
            for (const stop of p.route) {
                assert.notEqual(stop.destinationId, 'heathrow');
            }
            for (const rel of p.relationships || []) {
                const target = getById(rel.productId);
                assert.ok(target, `${p.id} -> ${rel.productId}`);
                assert.equal(target.status, 'active');
            }
        }
        for (const p of cat.products.filter((x) => x.status === 'active' && x.type === 'accommodation')) {
            assert.ok(['per-night', 'per-room'].includes(p.basePrice.basis), p.id);
        }
    });

    it('exposes typed relationships; day copy comes from destination plans', () => {
        const pkg = getById('pkg-northern-historic-7d');
        assert.ok(pkg.relationships?.some((r) => r.type === 'optional-addon' && r.productId === 'exp-lalibela-churches'));
        assert.ok(pkg.relationships?.some((r) => r.type === 'alternative' && r.productId === 'pkg-northern-historic-8d'));
        assert.ok(pkg.travellerFit?.length);
        assert.ok(pkg.pace);
        for (const template of pkg.dayTemplates || []) {
            assert.ok(template.moduleId, `day ${template.day} should reference a moduleId`);
            assert.equal(template.title, undefined);
            assert.equal(template.summary, undefined);
        }
        const ideas = loadDayIdeas();
        for (const destId of pkg.destinations || []) {
            assert.ok(ideas.destinations?.[destId]?.plans?.['1']?.length === 1, destId);
        }
    });

    it('keeps package dayTemplates as moduleId overrides without inline prose', () => {
        const cat = loadCatalog();
        for (const pkg of cat.products.filter((p) => p.type === 'package')) {
            for (const template of pkg.dayTemplates || []) {
                assert.ok(template.moduleId, `${pkg.id} day ${template.day}`);
                assert.equal(template.title, undefined, pkg.id);
                assert.equal(template.summary, undefined, pkg.id);
                assert.equal(template.image, undefined, pkg.id);
            }
        }
        const withOverrides = cat.products.filter((p) => p.type === 'package' && p.dayTemplates?.length);
        assert.ok(withOverrides.length >= 1);
    });

    it('resolves authored 1-to-5-day plans for all 22 destinations', () => {
        const dests = listDestinations();
        assert.equal(dests.length, 22);
        const ideas = loadDayIdeas();
        for (const dest of dests) {
            const program = ideas.destinations?.[dest.id];
            assert.ok(program, dest.id);
            for (let length = 1; length <= 5; length += 1) {
                const expected = program.plans[String(length)];
                assert.equal(expected.length, length, `${dest.id} plan ${length}`);
                for (let i = 0; i < length; i += 1) {
                    const idea = ideaForStayDay(dest.id, i, length, null);
                    const module = (program.modules || []).find((m) => m.id === expected[i]);
                    assert.ok(module, `${dest.id} ${expected[i]}`);
                    assert.equal(idea.moduleId, module.id, `${dest.id} day ${i + 1} of ${length}`);
                    assert.equal(idea.title, module.title);
                    assert.equal(idea.summary, module.summary);
                    assert.equal(idea.image, module.image);
                    assert.deepEqual(idea.experienceIds, module.experienceIds || []);
                }
            }
        }
    });

    it('fails validation for missing connection, module, image, or invalid plan', () => {
        const base = loadCatalogBundle();

        const missingConnection = structuredClone(base);
        const pair = `${missingConnection.catalog.products.find((p) => p.id === 'pkg-northern-historic-7d').route[0].destinationId}|${missingConnection.catalog.products.find((p) => p.id === 'pkg-northern-historic-7d').route[1].destinationId}`;
        missingConnection.connections.connections = missingConnection.connections.connections.filter(
            (row) => `${row.from}|${row.to}` !== pair,
        );
        const noConn = validateCatalogIntegrity(missingConnection);
        assert.equal(noConn.ok, false);
        assert.ok(noConn.errors.some((e) => e.code === 'PACKAGE_CONNECTION_MISSING'));

        const missingModule = structuredClone(base);
        const lalibela = missingModule.dayIdeas.destinations.lalibela;
        lalibela.modules = lalibela.modules.filter((m) => m.id !== 'lalibela-bete-giyorgis');
        const noMod = validateCatalogIntegrity(missingModule);
        assert.equal(noMod.ok, false);
        assert.ok(noMod.errors.some((e) => e.code === 'DAY_PLAN_UNKNOWN_MODULE' && /lalibela-bete-giyorgis/.test(e.message)));

        const missingImage = structuredClone(base);
        missingImage.dayIdeas.destinations.lalibela.modules[0].image = '';
        const noImg = validateCatalogIntegrity(missingImage);
        assert.equal(noImg.ok, false);
        assert.ok(noImg.errors.some((e) => e.code === 'DAY_MODULE_IMAGE_MISSING'));

        const invalidPlan = structuredClone(base);
        invalidPlan.dayIdeas.destinations.lalibela.plans['3'] = ['lalibela-northern-cluster'];
        const badPlan = validateCatalogIntegrity(invalidPlan);
        assert.equal(badPlan.ok, false);
        assert.ok(badPlan.errors.some((e) => e.code === 'DAY_PLAN_INCOMPLETE' && e.id === 'lalibela'));
    });

    it('matches catalog source files to the Lambda copy', () => {
        const src = join(ROOT, 'data/catalog/v1');
        const dest = join(ROOT, 'infrastructure/lambda/guzo-chat-handler/data/catalog/v1');
        const names = readdirSync(src).filter((name) => name.endsWith('.json') && !name.endsWith('-manifest.json'));
        assert.ok(names.includes('catalog.json'));
        assert.ok(names.includes('day-ideas.json'));
        assert.ok(names.includes('connections.json'));
        for (const name of names) {
            const lambdaPath = join(dest, name);
            assert.equal(existsSync(lambdaPath), true, `missing Lambda copy of ${name}`);
            assert.equal(
                readFileSync(join(src, name)).equals(readFileSync(lambdaPath)),
                true,
                `${name} drifted between catalog source and Lambda copy`,
            );
        }
    });
});

describe('pricing', () => {
    it('is deterministic and applies seasonality', () => {
        const a = quotePrice({
            productId: 'pkg-northern-historic-7d',
            startDate: '2026-12-15',
            adults: 2,
            children: 0,
            tier: 'comfort',
        });
        const b = quotePrice({
            productId: 'pkg-northern-historic-7d',
            startDate: '2026-12-15',
            adults: 2,
            children: 0,
            tier: 'comfort',
        });
        assert.deepEqual(a, b);
        assert.equal(seasonalMultiplier('2026-12-01'), 1.15);
        assert.equal(seasonalMultiplier('2026-07-01'), 0.9);
        assert.equal(a.eur, gbpToEur(a.gbp));
        assert.ok(a.breakdown.landGbp > 0);
    });

    it('scales with party size', () => {
        const two = quotePrice({
            productId: 'pkg-addis-stopover-3d',
            startDate: '2026-03-01',
            adults: 2,
            children: 0,
        });
        const four = quotePrice({
            productId: 'pkg-addis-stopover-3d',
            startDate: '2026-03-01',
            adults: 4,
            children: 0,
        });
        assert.ok(four.gbp > two.gbp);
    });

    it('quotes per-night hotels by rooms × nights', () => {
        const oneNight = quotePrice({
            productId: 'acc-addis-ababa-hotel-lobelia',
            startDate: '2026-03-01',
            adults: 2,
            nights: 1,
            rooms: 1,
        });
        const threeNights = quotePrice({
            productId: 'acc-addis-ababa-hotel-lobelia',
            startDate: '2026-03-01',
            adults: 2,
            nights: 3,
            rooms: 1,
        });
        assert.ok(threeNights.gbp > oneNight.gbp);
        assert.equal(threeNights.breakdown.basis, 'per-night');
    });

    it('does not recharge included GR03 flights and exposes a per-person price', () => {
        const itinerary = buildItinerary({
            packageId: 'pkg-classic-ethiopia-highlights-10d-set',
            originIata: 'FRA',
            startDate: '2027-01-22',
            adults: 2,
            children: 0,
            cabin: 'Economy',
            tier: 'classic',
            currency: 'EUR',
        });

        assert.ok(itinerary.flights.length > 0, 'included flights should remain visible');
        assert.equal(itinerary.quote.breakdown.flightGbp, 0);
        assert.equal(itinerary.quote.totalAmount, 4554);
        assert.equal(itinerary.quote.perPersonAmount, 2277);
        assert.equal(itinerary.quote.formattedPerPerson, '€2,277');

        const business = buildItinerary({
            packageId: 'pkg-classic-ethiopia-highlights-10d-set',
            originIata: 'FRA',
            startDate: '2027-01-22',
            adults: 2,
            children: 0,
            cabin: 'Business',
            tier: 'classic',
            currency: 'EUR',
        });
        assert.ok(business.quote.breakdown.flightGbp > 0, 'cabin upgrade delta should still be charged');
        assert.ok(business.quote.perPersonAmount > itinerary.quote.perPersonAmount);
    });

    it('strips SKU codes from recommendation card titles', () => {
        const pkg = getById('pkg-classic-ethiopia-highlights-10d-set');
        assert.match(pkg.name, /GR03/);
        const card = toRecommendation(pkg);
        assert.equal(card.title, displayProductTitle(pkg.name));
        assert.equal(card.title, "Short Classic Tour to Ethiopia's Highlights");
        assert.doesNotMatch(card.title, /GR03/i);
    });

    it('titles a composed 10-day custom itinerary from the trip, not the short-tour SKU', () => {
        const pkg = getById('pkg-classic-ethiopia-highlights-10d-set');
        assert.match(pkg.name, /Short Classic Tour to Ethiopia's Highlights \(GR03\)/);

        const itin = buildItinerary({
            packageId: pkg.id,
            originIata: 'FRA',
            startDate: '2027-01-22',
            durationDays: 10,
            adults: 2,
            children: 2,
            interests: ['family', 'culture', 'nature'],
            preferences: 'Family trip around Ethiopia',
            tier: 'classic',
            currency: 'EUR',
        });

        assert.equal(itin.days.length, 10);
        assert.doesNotMatch(itin.title, /GR03/i);
        assert.doesNotMatch(itin.title, /Short Classic Tour/i);
        assert.match(itin.title, /10-day/i);
        assert.equal(itin.title, 'Classic 10-day family Ethiopia highlights');
    });

    it('keeps the browser display-title helper aligned with the server', () => {
        const server = readFileSync(join(ROOT, 'infrastructure/lambda/guzo-chat-handler/lib/display-title.js'), 'utf8');
        const client = readFileSync(join(ROOT, 'guzo/display-title.js'), 'utf8');
        assert.equal(server, client);
    });

    it('refuses quotes for draft products', () => {
        assert.throws(
            () => quotePrice({
                productId: 'pkg-be-historic-north-christmas-lalibela-11d',
                startDate: '2026-03-01',
                adults: 2,
            }),
            /not sellable/i,
        );
    });
});

describe('availability', () => {
    it('is deterministic for same inputs', () => {
        const a = checkAvailability('pkg-northern-historic-7d', '2026-12-10', 2);
        const b = checkAvailability('pkg-northern-historic-7d', '2026-12-10', 2);
        assert.deepEqual(a, b);
        assert.equal(typeof a.available, 'boolean');
        assert.doesNotMatch(a.note, /allotment|space confirmed|waitlist|on request/i);
    });
});

describe('flights + miles + itinerary', () => {
    it('selects ET international and domestic segments', () => {
        const segs = selectFlights({
            originIata: 'LHR',
            routeStops: ['addis-ababa', 'bahir-dar', 'gondar', 'lalibela'],
            startDate: '2026-12-10',
            durationDays: 7,
            cabin: 'Economy',
        });
        assert.ok(segs.some((s) => s.origin === 'LHR' && s.destination === 'ADD'));
        assert.ok(segs.some((s) => s.direction === 'return'));
    });

    it('estimates miles from GBP and cabin', () => {
        const eco = estimateMiles({ totalGbp: 1000, cabin: 'Economy' });
        const biz = estimateMiles({ totalGbp: 1000, cabin: 'Business' });
        assert.equal(eco.shebaMiles, 1500);
        assert.equal(biz.shebaMiles, 2500);
    });

    it('builds itinerary with days, flights, quote, miles, easygds', () => {
        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            origin: 'LHR',
            startDate: '2026-12-10',
            adults: 2,
            children: 0,
            cabin: 'Economy',
            tier: 'comfort',
        });
        assert.equal(itin.packageId, 'pkg-northern-historic-7d');
        assert.equal(itin.days.length, 7);
        assert.ok(itin.flights.length >= 2);
        assert.ok(itin.flights.some((f) => f.direction === 'outbound' && f.origin === 'LHR'));
        assert.ok(itin.stays.length >= 1);
        assert.ok(itin.quote.gbp > 0);
        assert.ok(itin.quote.eur > 0);
        assert.ok(itin.milesEstimate.shebaMiles > 0);
        assert.ok(itin.easygds.handoff);
        assert.equal(itin.easygds.handoff.startPlaceCode, 'LHR');
        assert.ok(itin.heroImage);
        const dayImages = new Set(itin.days.map((d) => d.image).filter(Boolean));
        assert.ok(dayImages.size >= 3, 'expected distinct day images by destination');
        assert.ok(itin.days.every((d) => d.image), 'each day should have a destination image');
        assert.ok(itin.inclusions.some((item) => /^international flights?\b/i.test(item)));
        assert.equal(itin.exclusions.some(isInternationalFlightsExclusion), false);
    });

    it('includes Frankfurt outbound on FRA itineraries without duplicate ADD-BJR', () => {
        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-8d',
            originIata: 'FRA',
            startDate: '2026-09-14',
            adults: 2,
        });
        assert.ok(itin.flights.some((f) => f.direction === 'outbound' && f.origin === 'FRA' && f.destination === 'ADD'));
        assert.ok(itin.flights.some((f) => f.direction === 'return' && f.origin === 'ADD' && f.destination === 'FRA'));
        const addBjr = itin.flights.filter((f) => f.origin === 'ADD' && f.destination === 'BJR');
        assert.equal(addBjr.length, 1);
    });

    it('builds the closest itinerary from an EasyGDS destination id', () => {
        const itin = buildItinerary({
            destination: '2093',
            durationDays: 9,
            originIata: 'FRA',
            startDate: '2026-09-23',
            adults: 2,
            children: 1,
            childAges: [11],
            tier: 'classic',
        });
        assert.ok(itin.destinations.includes('lalibela'));
        assert.ok(Math.abs(itin.days.length - 9) <= 2);
        assert.deepEqual(itin.travelers.childAges, [11]);
    });

    it('keeps the selected catalog package tier authoritative', () => {
        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-8d',
            originIata: 'LHR',
            startDate: '2026-10-10',
            endDate: '2026-10-17',
            adults: 2,
            tier: 'comfort',
        });
        assert.equal(itin.tier, 'signature');
        assert.equal(itin.dates.end, '2026-10-17');
    });

    it('builds a bespoke 6-day Addis + Lalibela plan when catalog matches are longer', () => {
        const plan = buildStayPlan({
            preferences: '3 days in Addis Ababa and 3 days in Lalibela',
            interests: ['Addis Ababa', 'Lalibela'],
            destination: 'lalibela',
        }, 6);
        assert.deepEqual(plan, [
            { destinationId: 'addis-ababa', days: 3 },
            { destinationId: 'lalibela', days: 3 },
        ]);

        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'NBO',
            startDate: '2026-11-01',
            durationDays: 6,
            adults: 2,
            preferences: '3 days in Addis Ababa and 3 days in Lalibela',
            interests: ['Addis Ababa', 'Lalibela'],
            destination: 'lalibela',
            bespoke: true,
        });
        assert.equal(itin.days.length, 6);
        assert.equal(itin.bespoke, true);
        assert.equal(itin.dates.end, '2026-11-06');
        const addisDays = itin.days.filter((d) => d.destinationId === 'addis-ababa').length;
        const lalibelaDays = itin.days.filter((d) => d.destinationId === 'lalibela').length;
        assert.equal(addisDays, 3);
        assert.equal(lalibelaDays, 3);
        assert.equal(itin.title, 'Comfort 6-day Addis Ababa and Lalibela');
        assert.doesNotMatch(itin.title, /GR03|Short Classic/i);
    });

    it('varies titles and summaries across multiple days in one destination', () => {
        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-09-22',
            durationDays: 5,
            adults: 2,
            preferences: '5 days in Lalibela',
            interests: ['Lalibela'],
            destination: 'lalibela',
            bespoke: true,
        });
        assert.equal(itin.days.length, 5);
        const titles = itin.days.map((d) => d.title);
        const summaries = itin.days.map((d) => d.summary);
        assert.equal(new Set(titles).size >= 3, true, `expected varied titles, got ${titles.join(' | ')}`);
        assert.equal(summaries.every((s) => s && !/^Day \d+/i.test(s)), true);
        assert.ok(itin.days.every((d) => (d.highlights || []).length > 0));
        assert.ok(itin.days.some((d) => /yemrehanna|bete giyorgis|northern cluster|asheten|craft/i.test(d.title)));
        const images = itin.days.map((d) => d.image);
        assert.equal(new Set(images).size, images.length, `expected unique day images, got ${images.join(' | ')}`);
    });

    it('uses images/tiya.jpg for the Tiya day on the classic 10-day highlights package', () => {
        const itin = buildItinerary({
            packageId: 'pkg-classic-ethiopia-highlights-10d-set',
            originIata: 'FRA',
            startDate: '2026-11-15',
            adults: 2,
        });
        const tiya = itin.days.find((d) => d.moduleId === 'rift-valley-lakes-tiya');
        assert.ok(
            tiya,
            `expected a Tiya day, got ${itin.days.map((d) => `${d.day}:${d.moduleId}`).join(' | ')}`,
        );
        assert.equal(tiya.image, 'images/tiya.jpg');
    });

    it('uses distinct Gondar images across a multi-day Gondar stay', () => {
        const itin = buildItinerary({
            packageId: 'pkg-northern-historic-7d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 4,
            adults: 2,
            bespoke: true,
            stayPlan: [
                { destinationId: 'gondar', days: 2 },
                { destinationId: 'simien', days: 2 },
            ],
        });
        const gondar = itin.days.filter((d) => d.destinationId === 'gondar');
        assert.ok(gondar.length >= 2, `expected a multi-day Gondar stay, got ${gondar.length} days`);
        const images = gondar.map((d) => d.image);
        assert.equal(
            new Set(images).size,
            images.length,
            `expected unique Gondar images, got ${images.join(' | ')}`,
        );
        assert.ok(
            images.includes('images/gondar-castle.jpg'),
            `expected gondar-castle.jpg on one Gondar day, got ${images.join(' | ')}`,
        );
        assert.ok(
            images.some((img) => /ET_Gondar_asv2018-02_img11_Fasil_Ghebbi/.test(img)),
            `expected the Fasil Ghebbi Wikimedia shot on the other Gondar day, got ${images.join(' | ')}`,
        );
    });

    it('uses distinct local Addis images across a multi-day Addis stay', () => {
        const itin = buildItinerary({
            packageId: 'pkg-addis-stopover-3d',
            originIata: 'LHR',
            startDate: '2026-11-01',
            durationDays: 6,
            adults: 2,
            preferences: '6 days in Addis Ababa',
            interests: ['Addis Ababa'],
            destination: 'addis-ababa',
            bespoke: true,
        });
        const addis = itin.days.filter((d) => d.destinationId === 'addis-ababa');
        assert.ok(addis.length >= 5, `expected a long Addis stay, got ${addis.length} days`);
        const images = addis.map((d) => d.image);
        assert.equal(
            new Set(images).size,
            images.length,
            `expected unique Addis images, got ${images.join(' | ')}`,
        );
        assert.ok(
            images.every((img) => /images\/addis/i.test(img)),
            `expected local Addis images, got ${images.join(' | ')}`,
        );
    });

    it('refuses itinerary composition for draft packages', () => {
        assert.throws(
            () => buildItinerary({
                packageId: 'pkg-be-historic-north-christmas-lalibela-11d',
                originIata: 'LHR',
                startDate: '2026-11-01',
                adults: 2,
            }),
            /not sellable/i,
        );
    });
});
