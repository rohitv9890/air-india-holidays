#!/usr/bin/env node
/**
 * One-time catalog migration to reusable destination-day modules, 1–5 day plans,
 * journey connections, and moduleId-only package overrides.
 *
 * Source of truth remains data/catalog/v1/. Does not write Lambda copies.
 *
 * Usage: node scripts/migrate-day-programs.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = join(ROOT, 'data/catalog/v1');

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function slug(title) {
    return String(title || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

const IMG = {
    addisSkyline: 'images/addis-friendship-park.jpg',
    addisCity: 'images/addis_ababa.jpg',
    sheraton: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Sheraton_front.jpg/1280px-Sheraton_front.jpg',
    entoto: 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Mount_Entoto.jpg',
    tana: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/View_from_Shore_of_Lake_Tana_-_Bahir_Dar_-_Ethiopia_-_03_%288677068123%29.jpg/1280px-View_from_Shore_of_Lake_Tana_-_Bahir_Dar_-_Ethiopia_-_03_%288677068123%29.jpg',
    ura: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Ura_Kidane_Mehret.jpg/1280px-Ura_Kidane_Mehret.jpg',
    nile: 'https://upload.wikimedia.org/wikipedia/commons/4/46/Blue_Nile_Falls_Ethiopia.jpg',
    fasil: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/ET_Gondar_asv2018-02_img11_Fasil_Ghebbi.jpg/1280px-ET_Gondar_asv2018-02_img11_Fasil_Ghebbi.jpg',
    gondar: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/ET_Gondar_asv2018-02_img11_Fasil_Ghebbi.jpg/1280px-ET_Gondar_asv2018-02_img11_Fasil_Ghebbi.jpg',
    gondarCastle: 'images/gondar-castle.jpg',
    simien: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Simien_Mountains_National_Park_01.jpg/1280px-Simien_Mountains_National_Park_01.jpg',
    simien7: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Simien_Mountains_National_Park_07.jpg/1280px-Simien_Mountains_National_Park_07.jpg',
    medhane: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Bete_Medhane_Alem_in_Lalibela.JPG/1280px-Bete_Medhane_Alem_in_Lalibela.JPG',
    giyorgis: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Bete_Giyorgis_05.jpg/1280px-Bete_Giyorgis_05.jpg',
    yemrehanna: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Yemerehne_kristos%2C_esterno%2C_01.jpg/1280px-Yemerehne_kristos%2C_esterno%2C_01.jpg',
    lalibelaCourt: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Bet_Giyorgis_church_Lalibela_01.jpg/1280px-Bet_Giyorgis_church_Lalibela_01.jpg',
    goldCross: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/The_Gold_Cross%2C_Lalibela%2C_Ethiopia_%283214256022%29.jpg/1280px-The_Gold_Cross%2C_Lalibela%2C_Ethiopia_%283214256022%29.jpg',
    axum: 'https://upload.wikimedia.org/wikipedia/commons/7/78/Obelisk_of_Axum.jpg',
    abaya: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Lake_Abaya.jpg/1280px-Lake_Abaya.jpg',
    hawassa: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Sunset_Over_Lake_Hawassa%2C_Ethiopia.jpg/1280px-Sunset_Over_Lake_Hawassa%2C_Ethiopia.jpg',
    dorze: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Dorze_people.jpg/1280px-Dorze_people.jpg',
    south: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Southern_Ethiopia.jpg/1280px-Southern_Ethiopia.jpg',
    jinka: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Jinka.jpg/1280px-Jinka.jpg',
    mursi: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Mursi_people.jpg/1280px-Mursi_people.jpg',
    mursiWoman: 'https://upload.wikimedia.org/wikipedia/commons/8/8f/Mursi_woman.jpg',
    turmi: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Turmi.jpg/1280px-Turmi.jpg',
    hamer: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Hamer_woman.jpg/1280px-Hamer_woman.jpg',
    omoRiver: 'https://upload.wikimedia.org/wikipedia/commons/f/f4/Omo_River.jpg',
};

function mod({
    id, title, summary, highlights, image, imageAlt,
    hours, intensity, experienceIds = [], kind = 'full-day',
}) {
    const module = {
        id,
        title,
        summary,
        highlights,
        image,
        imageAlt,
        expectedActivityHours: hours,
        intensity,
        kind,
    };
    if (experienceIds.length) module.experienceIds = experienceIds;
    return module;
}

function leisure(id, place, image, imageAlt) {
    return mod({
        id,
        title: `${place} at leisure`,
        summary: `A clearly marked free day in ${place} — rest, optional walks, crafts, or coffee rather than a scheduled full-day touring circuit.`,
        highlights: ['At leisure', 'Optional walks', 'Crafts & coffee'],
        image,
        imageAlt,
        hours: 3,
        intensity: 'easy',
        kind: 'leisure',
    });
}

function program(modules, planOrder, extras = {}) {
    if (planOrder.length !== 5) {
        throw new Error(`planOrder must have 5 ids, got ${planOrder.join(',')}`);
    }
    const byId = new Map(modules.map((m) => [m.id, m]));
    for (const id of planOrder) {
        if (!byId.has(id)) throw new Error(`Unknown plan module ${id}`);
    }
    const plans = {};
    for (let n = 1; n <= 5; n += 1) {
        plans[String(n)] = planOrder.slice(0, n);
    }
    return {
        modules,
        plans,
        arrivalModuleId: extras.arrival || planOrder[0],
        departureModuleId: extras.departure || planOrder[planOrder.length - 1],
        leisureModuleId: extras.leisure || modules.find((m) => m.kind === 'leisure')?.id,
    };
}

function buildDayPrograms() {
    const destinations = {};

    destinations['addis-ababa'] = program([
        mod({
            id: 'addis-ababa-gateway',
            title: 'Gateway to the highlands',
            summary: 'Settle into Addis Ababa — coffee ceremony welcome, a stroll through Piazza, and first views over the Entoto ridge.',
            highlights: ['Coffee ceremony', 'Piazza stroll', 'Entoto views'],
            image: IMG.addisSkyline,
            imageAlt: 'Addis Ababa skyline',
            hours: 4,
            intensity: 'easy',
            kind: 'arrival-light',
            experienceIds: ['exp-addis-city-tour'],
        }),
        mod({
            id: 'addis-ababa-museums-merkato',
            title: 'Museums & Merkato',
            summary: "Morning with Lucy at the National Museum, then the colour and chaos of Merkato — the continent's largest open-air market.",
            highlights: ['National Museum', 'Lucy fossil', 'Merkato'],
            image: IMG.addisCity,
            imageAlt: 'Addis Ababa city life',
            hours: 6,
            intensity: 'moderate',
        }),
        mod({
            id: 'addis-ababa-trinity-flavours',
            title: 'Holy Trinity & local flavours',
            summary: 'Visit Holy Trinity Cathedral, then a guided tasting of injera, tibs, and craft coffee in a neighbourhood restaurant.',
            highlights: ['Holy Trinity Cathedral', 'Food tasting', 'Craft coffee'],
            image: IMG.sheraton,
            imageAlt: 'Addis Ababa city centre',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'addis-ababa-entoto',
            title: 'Entoto & freestyle afternoon',
            summary: 'Drive up Mount Entoto for highland panoramas, then free time for boutiques, galleries, or a spa before your onward flight.',
            highlights: ['Mount Entoto', 'Panoramic views', 'Free time'],
            image: IMG.entoto,
            imageAlt: 'Mount Entoto above Addis Ababa',
            hours: 5,
            intensity: 'easy',
            kind: 'half-day',
        }),
        leisure('addis-ababa-leisure', 'Addis Ababa', IMG.addisSkyline, 'Addis Ababa skyline'),
    ], [
        'addis-ababa-gateway',
        'addis-ababa-museums-merkato',
        'addis-ababa-trinity-flavours',
        'addis-ababa-entoto',
        'addis-ababa-leisure',
    ], { arrival: 'addis-ababa-gateway', departure: 'addis-ababa-entoto', leisure: 'addis-ababa-leisure' });

    destinations['bahir-dar'] = program([
        mod({
            id: 'bahir-dar-arrive-tana',
            title: 'Arrive on Lake Tana',
            summary: "Touch down beside Lake Tana — lakeside walk, fresh fish supper, and your first glimpse of the Blue Nile's source.",
            highlights: ['Lake Tana shore', 'Lakeside dinner', 'Blue Nile source'],
            image: IMG.tana,
            imageAlt: 'Shore of Lake Tana, Bahir Dar',
            hours: 4,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'bahir-dar-zege',
            title: 'Monasteries of Zege',
            summary: 'Boat across Lake Tana to the Zege peninsula — painted monasteries, frankincense forests, and quiet island chapels.',
            highlights: ['Monastery boat trip', 'Zege peninsula', 'Painted frescoes'],
            image: IMG.ura,
            imageAlt: 'Ura Kidane Mehret monastery on Lake Tana',
            hours: 6,
            intensity: 'moderate',
            experienceIds: ['exp-lake-tana-monasteries'],
        }),
        mod({
            id: 'bahir-dar-blue-nile',
            title: 'Blue Nile Falls',
            summary: 'Day trip to Tis Issat — the Blue Nile Falls — with misty viewpoints, a village walk, and Portuguese bridge photo stops.',
            highlights: ['Tis Issat falls', 'Village walk', 'Portuguese bridge'],
            image: IMG.nile,
            imageAlt: 'Blue Nile Falls near Bahir Dar',
            hours: 7,
            intensity: 'moderate',
        }),
        mod({
            id: 'bahir-dar-market-crafts',
            title: 'Bahir Dar markets & lakeshore crafts',
            summary: 'A slower town day for the central market, papyrus-boat workshops, and coffee along the Lake Tana promenade.',
            highlights: ['Town market', 'Papyrus crafts', 'Lakeshore coffee'],
            image: IMG.tana,
            imageAlt: 'Shore of Lake Tana, Bahir Dar',
            hours: 5,
            intensity: 'easy',
        }),
        leisure('bahir-dar-leisure', 'Bahir Dar', IMG.tana, 'Shore of Lake Tana, Bahir Dar'),
    ], [
        'bahir-dar-arrive-tana',
        'bahir-dar-zege',
        'bahir-dar-blue-nile',
        'bahir-dar-market-crafts',
        'bahir-dar-leisure',
    ]);

    destinations.gondar = program([
        mod({
            id: 'gondar-castles',
            title: 'Imperial castles of Gondar',
            summary: "Explore Fasil Ghebbi, the Royal Enclosure of emperors — towers, banquet halls, and the story of Ethiopia's Camelot.",
            highlights: ['Fasil Ghebbi', 'Royal Enclosure', 'Castle circuit'],
            image: IMG.fasil,
            imageAlt: 'Fasil Ghebbi castles in Gondar',
            hours: 5,
            intensity: 'moderate',
        }),
        mod({
            id: 'gondar-debre-berhan',
            title: 'Debre Berhan Selassie',
            summary: "Morning at Debre Berhan Selassie — famous for its angel-ceiling frescoes — then Fasilides' Bath and a local lunch.",
            highlights: ['Angel ceiling', 'Fasilides Bath', 'Local lunch'],
            image: IMG.gondarCastle,
            imageAlt: 'Gondar castle',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'gondar-foothills',
            title: 'Gondar at leisure',
            summary: 'A slower day for markets, craft workshops, or an optional trip toward the Simien foothills before your next stop.',
            highlights: ['Market time', 'Craft workshops', 'Optional foothills'],
            image: IMG.simien,
            imageAlt: 'Highland views near Gondar',
            hours: 4,
            intensity: 'easy',
            kind: 'half-day',
        }),
        mod({
            id: 'gondar-qusquam',
            title: 'Qusquam & highland palaces',
            summary: "Walk Empress Mentewab's Qusquam complex and quieter palace ruins above town, with time for coffee in Gondar's piazzas.",
            highlights: ['Qusquam palace', 'Hill views', 'Town coffee'],
            image: IMG.gondar,
            imageAlt: 'Gondar royal compound',
            hours: 5,
            intensity: 'easy',
        }),
        leisure('gondar-leisure', 'Gondar', IMG.fasil, 'Fasil Ghebbi castles in Gondar'),
    ], [
        'gondar-castles',
        'gondar-debre-berhan',
        'gondar-foothills',
        'gondar-qusquam',
        'gondar-leisure',
    ]);

    destinations.lalibela = program([
        mod({
            id: 'lalibela-northern-cluster',
            title: 'Rock churches — northern cluster',
            summary: "Descend into Lalibela's northern group of rock-hewn churches with a specialist guide — tunnels, courtyards, and living liturgy.",
            highlights: ['Northern cluster', 'Expert local guide', 'Rock-hewn churches'],
            image: IMG.medhane,
            imageAlt: 'Bete Medhane Alem, Lalibela',
            hours: 6,
            intensity: 'moderate',
            experienceIds: ['exp-lalibela-churches'],
        }),
        mod({
            id: 'lalibela-bete-giyorgis',
            title: 'Bete Giyorgis & highland life',
            summary: 'Focus on the iconic cross-shaped Bete Giyorgis, then a village walk to see farming terraces and everyday highland life.',
            highlights: ['Bete Giyorgis', 'Village walk', 'Highland farming'],
            image: IMG.giyorgis,
            imageAlt: 'Bete Giyorgis, Lalibela',
            hours: 6,
            intensity: 'moderate',
        }),
        mod({
            id: 'lalibela-yemrehanna',
            title: 'Yemrehanna Kristos excursion',
            summary: 'Day trip to Yemrehanna Kristos — a beautiful cave church set in juniper forest, with picnic lunch in the hills.',
            highlights: ['Cave church', 'Juniper forest', 'Hill picnic'],
            image: IMG.yemrehanna,
            imageAlt: 'Yemrehanna Kristos cave church',
            hours: 8,
            intensity: 'active',
            experienceIds: ['exp-yemrehanna-kristos'],
        }),
        mod({
            id: 'lalibela-asheten',
            title: 'Asheten Maryam & sunset ridges',
            summary: 'Optional mule ride or hike to Asheten Maryam monastery for sweeping valley views, then sunset over the Lalibela escarpment.',
            highlights: ['Asheten Maryam', 'Valley views', 'Escarpment sunset'],
            image: IMG.lalibelaCourt,
            imageAlt: 'Lalibela rock church courtyard',
            hours: 6,
            intensity: 'active',
        }),
        mod({
            id: 'lalibela-craft-morning',
            title: 'Slow morning & craft time',
            summary: 'A gentler pace — revisit a favourite church for morning prayers, then browse crosses, textiles, and honey in town.',
            highlights: ['Morning liturgy', 'Local crafts', 'Coffee stop'],
            image: IMG.goldCross,
            imageAlt: 'Processional cross in Lalibela',
            hours: 4,
            intensity: 'easy',
            kind: 'half-day',
        }),
        leisure('lalibela-leisure', 'Lalibela', IMG.giyorgis, 'Bete Giyorgis, Lalibela'),
    ], [
        'lalibela-northern-cluster',
        'lalibela-bete-giyorgis',
        'lalibela-yemrehanna',
        'lalibela-asheten',
        'lalibela-craft-morning',
    ], { arrival: 'lalibela-northern-cluster', departure: 'lalibela-craft-morning', leisure: 'lalibela-leisure' });

    destinations.simien = program([
        mod({
            id: 'simien-roof',
            title: 'Roof of Africa',
            summary: 'Enter Simien Mountains National Park for escarpment viewpoints and your first sightings of gelada baboons.',
            highlights: ['Gelada baboons', 'Escarpment views', 'Park entry'],
            image: IMG.simien7,
            imageAlt: 'Simien Mountains National Park',
            hours: 5,
            intensity: 'moderate',
            kind: 'arrival-light',
        }),
        mod({
            id: 'simien-escarpment-trek',
            title: 'Escarpment day trek',
            summary: 'A guided trek along the UNESCO escarpment — wildflower meadows, dramatic drops, and picnic lunch with the ranges.',
            highlights: ['Guided trek', 'Wildflower meadows', 'Picnic lunch'],
            image: IMG.simien,
            imageAlt: 'Simien escarpment trek',
            hours: 7,
            intensity: 'active',
            experienceIds: ['exp-simien-day-trek'],
        }),
        mod({
            id: 'simien-chennek',
            title: 'Chennek & high camps',
            summary: 'Push toward Chennek for chance sightings of walia ibex, with time to simply watch the light change on the cliffs.',
            highlights: ['Chennek', 'Walia ibex', 'Cliff light'],
            image: IMG.entoto,
            imageAlt: 'Highland cliffs and open sky',
            hours: 7,
            intensity: 'active',
        }),
        mod({
            id: 'simien-descend',
            title: 'Descend toward Gondar',
            summary: 'A last escarpment viewpoint and gelada watch, then descend toward Gondar for connections onward or home.',
            highlights: ['Final viewpoint', 'Gelada watch', 'Descend to Gondar'],
            image: IMG.simien,
            imageAlt: 'Leaving the Simien escarpment',
            hours: 5,
            intensity: 'moderate',
            kind: 'half-day',
        }),
        leisure('simien-leisure', 'the Simien Mountains', IMG.simien7, 'Simien Mountains National Park'),
    ], [
        'simien-roof',
        'simien-escarpment-trek',
        'simien-chennek',
        'simien-descend',
        'simien-leisure',
    ]);

    destinations.axum = program([
        mod({
            id: 'axum-stelae',
            title: 'Stelae fields of Axum',
            summary: 'Walk the ancient stelae park — towering granite markers of the Aksumite empire — with a local historian guide.',
            highlights: ['Stelae park', 'Aksumite history', 'Local guide'],
            image: IMG.axum,
            imageAlt: 'Obelisk of Axum',
            hours: 5,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'axum-mary-zion',
            title: 'Church of St Mary of Zion',
            summary: "Visit the churches of St Mary of Zion and the museum of crowns, then Queen of Sheba ruins at the city's edge.",
            highlights: ['St Mary of Zion', 'Crown museum', 'Sheba ruins'],
            image: IMG.yemrehanna,
            imageAlt: 'Historic Axum church architecture',
            hours: 6,
            intensity: 'moderate',
        }),
        mod({
            id: 'axum-sheba-palace',
            title: 'Dungur palace & tombs',
            summary: 'A focused morning at the Dungur (Queen of Sheba) palace remains and nearby tombs, with museum time for Aksumite coins and ivory.',
            highlights: ['Dungur palace', 'Aksumite tombs', 'Museum coins'],
            image: IMG.axum,
            imageAlt: 'Obelisk of Axum',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'axum-yeha-option',
            title: 'Yeha temple excursion',
            summary: 'Optional road trip to Yeha — Ethiopia’s oldest standing temple — with highland farmland stops and a picnic lunch.',
            highlights: ['Yeha temple', 'Farmland stops', 'Picnic lunch'],
            image: IMG.yemrehanna,
            imageAlt: 'Historic Axum church architecture',
            hours: 7,
            intensity: 'moderate',
        }),
        leisure('axum-leisure', 'Axum', IMG.axum, 'Obelisk of Axum'),
    ], [
        'axum-stelae',
        'axum-mary-zion',
        'axum-sheba-palace',
        'axum-yeha-option',
        'axum-leisure',
    ]);

    destinations['arba-minch'] = program([
        mod({
            id: 'arba-minch-twin-lakes',
            title: 'Twin lakes arrival',
            summary: 'Arrive between Lakes Abaya and Chamo — viewpoint sundowner and your first Rift Valley night sounds.',
            highlights: ['Twin lakes view', 'Sundowner', 'Rift Valley'],
            image: IMG.abaya,
            imageAlt: 'Lake Abaya near Arba Minch',
            hours: 4,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'arba-minch-chamo-boat',
            title: 'Lake Chamo boat safari',
            summary: 'Boat on Lake Chamo for hippo pods and Nile crocodiles, with optional Nechisar plains wildlife time.',
            highlights: ['Hippo spotting', 'Crocodiles', 'Nechisar'],
            image: IMG.hawassa,
            imageAlt: 'Southern Rift Valley lake light',
            hours: 6,
            intensity: 'moderate',
            experienceIds: ['exp-nechisar-boat'],
        }),
        mod({
            id: 'arba-minch-dorze',
            title: 'Dorze highlands',
            summary: 'Day trip into the Dorze hills — bamboo beehive houses, enset gardens, and weaving demonstrations.',
            highlights: ['Dorze houses', 'Enset gardens', 'Weaving'],
            image: IMG.dorze,
            imageAlt: 'Dorze community in the southern highlands',
            hours: 7,
            intensity: 'moderate',
        }),
        mod({
            id: 'arba-minch-nechisar',
            title: 'Nechisar plains wildlife',
            summary: 'A fuller park morning on the Nechisar isthmus for zebra, gazelle, and lake viewpoints between Abaya and Chamo.',
            highlights: ['Nechisar isthmus', 'Plains wildlife', 'Twin-lake views'],
            image: IMG.abaya,
            imageAlt: 'Lake Abaya near Arba Minch',
            hours: 6,
            intensity: 'moderate',
        }),
        leisure('arba-minch-leisure', 'Arba Minch', IMG.abaya, 'Lake Abaya near Arba Minch'),
    ], [
        'arba-minch-twin-lakes',
        'arba-minch-chamo-boat',
        'arba-minch-dorze',
        'arba-minch-nechisar',
        'arba-minch-leisure',
    ]);

    destinations['omo-valley'] = program([
        mod({
            id: 'omo-valley-south-road',
            title: 'South to the Lower Omo',
            summary: 'Leave the lakes behind and travel toward the Lower Omo — savannah horizons, roadside markets, and a first sense of the valley.',
            highlights: ['Road south', 'Savannah views', 'Roadside markets'],
            image: IMG.south,
            imageAlt: 'Southern Ethiopia landscape',
            hours: 6,
            intensity: 'moderate',
            kind: 'transfer',
        }),
        mod({
            id: 'omo-valley-jinka',
            title: 'Arrive Jinka',
            summary: 'Settle into Jinka, gateway to Mago National Park — museum time, market stroll, and briefings for community visits.',
            highlights: ['Jinka town', 'Local market', 'Visit briefing'],
            image: IMG.jinka,
            imageAlt: 'Jinka, gateway to the Lower Omo',
            hours: 4,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'omo-valley-mursi',
            title: 'Mursi country',
            summary: 'Guided visit toward Mago with a Mursi community host — photography etiquette, conversation, and time without rush.',
            highlights: ['Mursi visit', 'Mago approaches', 'Photography etiquette'],
            image: IMG.mursi,
            imageAlt: 'Mursi community in the Lower Omo',
            hours: 7,
            intensity: 'moderate',
            experienceIds: ['exp-omo-village-visit'],
        }),
        mod({
            id: 'omo-valley-mago-crafts',
            title: 'Mago morning & crafts',
            summary: 'A quieter morning for crafts and conversation, then an afternoon at leisure in Jinka before the road to Turmi.',
            highlights: ['Craft time', 'Quiet morning', 'Jinka leisure'],
            image: IMG.mursiWoman,
            imageAlt: 'Lower Omo cultural portrait',
            hours: 4,
            intensity: 'easy',
            kind: 'half-day',
        }),
        mod({
            id: 'omo-valley-turmi-road',
            title: 'Road to Turmi',
            summary: 'Drive into Hamer country around Turmi — acacia plains, village compounds, and sunset over the Omo approaches.',
            highlights: ['Turmi', 'Hamer country', 'Savannah sunset'],
            image: IMG.turmi,
            imageAlt: 'Turmi in the Lower Omo',
            hours: 6,
            intensity: 'moderate',
            kind: 'transfer',
        }),
        mod({
            id: 'omo-valley-hamer',
            title: 'Hamer village visit',
            summary: 'Spend the day with Hamer hosts — cattle culture, ochre and clay adornment, and a respectful look at daily life.',
            highlights: ['Hamer hosts', 'Cattle culture', 'Village life'],
            image: IMG.hamer,
            imageAlt: 'Hamer community in the Omo Valley',
            hours: 6,
            intensity: 'moderate',
            experienceIds: ['exp-omo-village-visit'],
        }),
        mod({
            id: 'omo-valley-dassanech',
            title: 'Omo River & Dassanech',
            summary: 'Travel toward the Omo River for a Dassanech community visit — riverside life, fishing traditions, and wide open light.',
            highlights: ['Omo River', 'Dassanech visit', 'Riverside life'],
            image: IMG.omoRiver,
            imageAlt: 'Omo River',
            hours: 7,
            intensity: 'moderate',
        }),
        mod({
            id: 'omo-valley-turmi-market',
            title: 'Market day in Turmi',
            summary: 'If timing aligns, Turmi’s lively market — beads, butter, honey, and a chance to see neighbouring communities meet.',
            highlights: ['Turmi market', 'Regional trade', 'Beadwork'],
            image: IMG.dorze,
            imageAlt: 'Southern Ethiopia community market life',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'omo-valley-karo',
            title: 'Karo viewpoints',
            summary: 'Optional excursion toward Karo country for river terraces and painted-body traditions, with a picnic above the Omo.',
            highlights: ['Karo country', 'River terraces', 'Picnic views'],
            image: IMG.south,
            imageAlt: 'Lower Omo river terraces',
            hours: 7,
            intensity: 'moderate',
        }),
        mod({
            id: 'omo-valley-journey-north',
            title: 'Slow morning & journey north',
            summary: 'A freer morning for photos and farewells, then begin the journey north toward Arba Minch or your onward flight.',
            highlights: ['At leisure', 'Farewells', 'Road north'],
            image: IMG.abaya,
            imageAlt: 'Journey north via the southern lakes',
            hours: 5,
            intensity: 'easy',
            kind: 'transfer',
        }),
        leisure('omo-valley-leisure', 'the Omo Valley', IMG.turmi, 'Turmi in the Lower Omo'),
    ], [
        'omo-valley-jinka',
        'omo-valley-mursi',
        'omo-valley-turmi-road',
        'omo-valley-hamer',
        'omo-valley-dassanech',
    ], { arrival: 'omo-valley-south-road', departure: 'omo-valley-journey-north', leisure: 'omo-valley-leisure' });

    destinations.harar = program([
        mod({
            id: 'harar-jegol',
            title: 'Jegol old city walk',
            summary: "Enter the walled Jegol — alleyways, colourful houses, and a coffee stop in one of Islam's holiest cities in Africa.",
            highlights: ['Jegol walls', 'Old city alleys', 'Coffee stop'],
            image: IMG.yemrehanna,
            imageAlt: 'Historic walled-city atmosphere in eastern Ethiopia',
            hours: 5,
            intensity: 'easy',
            kind: 'arrival-light',
            experienceIds: ['exp-harar-old-city'],
        }),
        mod({
            id: 'harar-markets-hyena',
            title: 'Markets & hyena feeding',
            summary: 'Morning spice and textile markets, then the famous dusk hyena feeding on the edge of town.',
            highlights: ['Spice market', 'Textiles', 'Hyena feeding'],
            image: IMG.addisSkyline,
            imageAlt: 'Eastern Ethiopian city streets at dusk',
            hours: 6,
            intensity: 'moderate',
        }),
        mod({
            id: 'harar-coffee-departure',
            title: 'Coffee culture & departure',
            summary: 'A final Harari coffee ceremony and Jegol photo walk, then the road or flight corridor back toward Addis.',
            highlights: ['Coffee ceremony', 'Jegol photos', 'Return to Addis'],
            image: IMG.sheraton,
            imageAlt: 'Harar farewell coffee and city streets',
            hours: 4,
            intensity: 'easy',
            kind: 'half-day',
        }),
        mod({
            id: 'harar-shrines',
            title: 'Shrines & Harari houses',
            summary: 'Visit historic shrines and a traditional Harari house museum — carved niches, baskets, and the city’s layered faiths.',
            highlights: ['City shrines', 'Harari house', 'Basketwork'],
            image: IMG.yemrehanna,
            imageAlt: 'Historic walled-city atmosphere in eastern Ethiopia',
            hours: 5,
            intensity: 'easy',
        }),
        leisure('harar-leisure', 'Harar', IMG.yemrehanna, 'Historic walled-city atmosphere in eastern Ethiopia'),
    ], [
        'harar-jegol',
        'harar-markets-hyena',
        'harar-shrines',
        'harar-coffee-departure',
        'harar-leisure',
    ]);

    destinations.bale = program([
        mod({
            id: 'bale-sanetti',
            title: 'Into Bale Mountains',
            summary: "Climb toward the Sanetti Plateau — afro-alpine moorland and the rare Ethiopian wolf's high home.",
            highlights: ['Sanetti Plateau', 'Ethiopian wolf habitat', 'Afro-alpine flora'],
            image: IMG.simien7,
            imageAlt: 'Bale Mountains highlands',
            hours: 6,
            intensity: 'moderate',
            kind: 'arrival-light',
            experienceIds: ['exp-sanetti-plateau'],
        }),
        mod({
            id: 'bale-harenna',
            title: 'Harenna Forest trails',
            summary: 'Descend into Harenna Forest for birds, bushbuck, and giant heather — a cooler, greener Bale day.',
            highlights: ['Harenna Forest', 'Birding', 'Giant heather'],
            image: IMG.simien,
            imageAlt: 'Bale Mountains forest trails',
            hours: 6,
            intensity: 'moderate',
        }),
        mod({
            id: 'bale-wolves-dawn',
            title: 'Wolves at dawn',
            summary: 'Pre-dawn return to Sanetti for Ethiopian wolf sightings, then a freer afternoon at your lodge.',
            highlights: ['Dawn wolves', 'Sanetti return', 'Lodge leisure'],
            image: IMG.entoto,
            imageAlt: 'Open afro-alpine plateau',
            hours: 6,
            intensity: 'active',
        }),
        mod({
            id: 'bale-return',
            title: 'Return via the highlands',
            summary: 'A final Bale morning for photos or a short walk, then the highland road back toward Addis with picnic stops en route.',
            highlights: ['Final park morning', 'Highland road', 'Picnic stops'],
            image: IMG.south,
            imageAlt: 'Highland road leaving Bale Mountains',
            hours: 5,
            intensity: 'easy',
            kind: 'transfer',
        }),
        leisure('bale-leisure', 'Bale Mountains', IMG.simien7, 'Bale Mountains highlands'),
    ], [
        'bale-sanetti',
        'bale-harenna',
        'bale-wolves-dawn',
        'bale-return',
        'bale-leisure',
    ]);

    destinations.danakil = program([
        mod({
            id: 'danakil-convoy',
            title: 'Desert convoy begins',
            summary: 'Leave the highlands for the Danakil — salt pans, camel caravans, and the first colours of the depression.',
            highlights: ['Salt pans', 'Camel caravans', 'Desert convoy'],
            image: IMG.south,
            imageAlt: 'Arid Ethiopian landscape approaching the Danakil',
            hours: 8,
            intensity: 'active',
            kind: 'transfer',
        }),
        mod({
            id: 'danakil-erta-ale',
            title: 'Erta Ale overnight',
            summary: 'Trek to the lava lake rim of Erta Ale for an overnight beside glowing molten rock under desert stars.',
            highlights: ['Erta Ale', 'Lava lake', 'Overnight camp'],
            image: IMG.simien7,
            imageAlt: 'Dramatic volcanic highland and desert light',
            hours: 10,
            intensity: 'active',
            experienceIds: ['exp-erta-ale-overnight'],
        }),
        mod({
            id: 'danakil-dallol',
            title: 'Dallol colour springs',
            summary: "Explore Dallol's acid ponds, salt canyons, and sulphur formations — one of Earth's most surreal landscapes.",
            highlights: ['Dallol', 'Salt canyons', 'Sulphur springs'],
            image: IMG.hawassa,
            imageAlt: 'Intense mineral colours in a harsh landscape',
            hours: 6,
            intensity: 'active',
        }),
        mod({
            id: 'danakil-return',
            title: 'Return via the Afar lowlands',
            summary: 'Break camp and retrace the desert tracks toward the highlands, with a final Afar tea stop before Addis.',
            highlights: ['Desert return', 'Afar hospitality', 'Highland road'],
            image: IMG.south,
            imageAlt: 'Return road from the Danakil lowlands',
            hours: 8,
            intensity: 'moderate',
            kind: 'transfer',
        }),
        leisure('danakil-leisure', 'the Danakil', IMG.south, 'Arid Ethiopian landscape approaching the Danakil'),
    ], [
        'danakil-convoy',
        'danakil-erta-ale',
        'danakil-dallol',
        'danakil-return',
        'danakil-leisure',
    ]);

    destinations.bishoftu = program([
        mod({
            id: 'bishoftu-crater-lakes',
            title: 'Crater lakes of Bishoftu',
            summary: 'Settle beside the volcanic crater lakes — lakeside walk, sunset swim stop, and a first taste of highland resort life.',
            highlights: ['Crater lakes', 'Lakeside walk', 'Resort evening'],
            image: IMG.hawassa,
            imageAlt: 'Ethiopian crater lake light near Bishoftu',
            hours: 4,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'bishoftu-spa-pace',
            title: 'Lake day & spa pace',
            summary: 'A slower crater-lake morning for coffee and views, then optional spa time or a short walk between neighbouring lakes.',
            highlights: ['Lake coffee', 'Optional spa', 'Inter-lake walk'],
            image: IMG.abaya,
            imageAlt: 'Calm highland lake shore',
            hours: 4,
            intensity: 'easy',
            kind: 'half-day',
        }),
        mod({
            id: 'bishoftu-birding',
            title: 'Bishoftu birding circuit',
            summary: 'A guided lakeshore birding loop for pelicans, ducks, and highland raptors, with picnic time between crater rims.',
            highlights: ['Lakeshore birds', 'Crater rims', 'Picnic'],
            image: IMG.hawassa,
            imageAlt: 'Ethiopian crater lake light near Bishoftu',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'bishoftu-town',
            title: 'Bishoftu town & markets',
            summary: 'Stroll the small town markets and lakeside avenues — fruit stalls, coffee, and an easy free afternoon before Addis.',
            highlights: ['Town market', 'Lakeside avenues', 'Free afternoon'],
            image: IMG.south,
            imageAlt: 'Highland town approaches near Bishoftu',
            hours: 4,
            intensity: 'easy',
        }),
        leisure('bishoftu-leisure', 'Bishoftu', IMG.abaya, 'Calm highland lake shore'),
    ], [
        'bishoftu-crater-lakes',
        'bishoftu-spa-pace',
        'bishoftu-birding',
        'bishoftu-town',
        'bishoftu-leisure',
    ]);

    destinations.ziway = program([
        mod({
            id: 'ziway-arrive',
            title: 'Arrive Lake Ziway',
            summary: "Reach Lake Ziway for a bird-rich shoreline — pelicans, fishermen's boats, and your first Rift Valley overnight.",
            highlights: ['Lake Ziway', 'Birdlife', "Fishermen's boats"],
            image: IMG.hawassa,
            imageAlt: 'Rift Valley lake shore near Ziway',
            hours: 4,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'ziway-island-cruise',
            title: 'Island monasteries cruise',
            summary: "Boat toward Ziway's island churches and bird colonies, with picnic lunch and time for photography on the water.",
            highlights: ['Island cruise', 'Bird colonies', 'Picnic lunch'],
            image: IMG.tana,
            imageAlt: 'Boat cruise on an Ethiopian lake',
            hours: 6,
            intensity: 'moderate',
        }),
        mod({
            id: 'ziway-bird-hides',
            title: 'Shoreline hides & fishermen',
            summary: 'A quieter birding morning at shoreline hides, then time with local fishermen and a lakeside lunch.',
            highlights: ['Bird hides', 'Fishing boats', 'Lakeside lunch'],
            image: IMG.hawassa,
            imageAlt: 'Rift Valley lake shore near Ziway',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'ziway-village',
            title: 'Ziway town & fruit farms',
            summary: 'Walk Ziway’s market streets and nearby fruit farms — mango, papaya, and Rift Valley produce — before the next lake stop.',
            highlights: ['Town market', 'Fruit farms', 'Rift produce'],
            image: IMG.south,
            imageAlt: 'Southern Rift Valley farmland',
            hours: 4,
            intensity: 'easy',
        }),
        leisure('ziway-leisure', 'Ziway', IMG.hawassa, 'Rift Valley lake shore near Ziway'),
    ], [
        'ziway-arrive',
        'ziway-island-cruise',
        'ziway-bird-hides',
        'ziway-village',
        'ziway-leisure',
    ]);

    destinations['abijatta-shalla'] = program([
        mod({
            id: 'abijatta-shalla-park',
            title: 'Abiyatta–Shalla National Park',
            summary: 'Explore twin crater lakes — alkaline Abiyatta flamingo shores and deep blue Shalla viewpoints in one park day.',
            highlights: ['Flamingo shores', 'Shalla viewpoints', 'Park circuit'],
            image: IMG.hawassa,
            imageAlt: 'Rift Valley lakes in Abiyatta–Shalla',
            hours: 6,
            intensity: 'moderate',
        }),
        mod({
            id: 'abijatta-shalla-hot-springs',
            title: 'Hot springs & ostrich plains',
            summary: "Walk the park's hot-spring edges and open plains for ostrich and antelope, with a picnic between the crater rims.",
            highlights: ['Hot springs', 'Ostrich plains', 'Crater picnic'],
            image: IMG.south,
            imageAlt: 'Open Rift Valley plains',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'abijatta-shalla-flamingo-dawn',
            title: 'Dawn flamingo shores',
            summary: 'An early return to Abiyatta’s alkaline shore for flamingo flocks and soft Rift light, then a slower lodge morning.',
            highlights: ['Dawn flamingos', 'Alkaline shore', 'Lodge morning'],
            image: IMG.hawassa,
            imageAlt: 'Rift Valley lakes in Abiyatta–Shalla',
            hours: 5,
            intensity: 'moderate',
        }),
        mod({
            id: 'abijatta-shalla-rim-walk',
            title: 'Shalla crater rim walk',
            summary: 'A guided walk along Shalla’s deep-blue crater rim — viewpoints, hot-spring steam, and picnic shade in the acacias.',
            highlights: ['Crater rim', 'Hot-spring steam', 'Acacia picnic'],
            image: IMG.abaya,
            imageAlt: 'Deep Rift Valley crater lake',
            hours: 5,
            intensity: 'moderate',
        }),
        leisure('abijatta-shalla-leisure', 'Abijatta–Shalla', IMG.hawassa, 'Rift Valley lakes in Abiyatta–Shalla'),
    ], [
        'abijatta-shalla-park',
        'abijatta-shalla-hot-springs',
        'abijatta-shalla-flamingo-dawn',
        'abijatta-shalla-rim-walk',
        'abijatta-shalla-leisure',
    ]);

    destinations.hawassa = program([
        mod({
            id: 'hawassa-lakefront',
            title: 'Hawassa lakefront',
            summary: 'Arrive on Lake Hawassa — fish market stroll, lakeside boardwalk, and hippo spotting at dusk.',
            highlights: ['Fish market', 'Lakeside boardwalk', 'Hippo dusk'],
            image: IMG.hawassa,
            imageAlt: 'Sunset over Lake Hawassa',
            hours: 4,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'hawassa-boat-sidama',
            title: 'Morning boat & Sidama flavours',
            summary: 'Early boat for birds and hippos, then Sidama coffee tasting and a leisurely afternoon by the water.',
            highlights: ['Morning boat', 'Sidama coffee', 'Lakefront leisure'],
            image: IMG.abaya,
            imageAlt: 'Morning light on a southern Ethiopian lake',
            hours: 6,
            intensity: 'easy',
        }),
        mod({
            id: 'hawassa-amora-gedel',
            title: 'Amora Gedel & town time',
            summary: "Walk Amora Gedel park and Hawassa's lakeside avenues — crafts, juice stalls, and an easy free afternoon.",
            highlights: ['Amora Gedel', 'Craft browsing', 'Free afternoon'],
            image: IMG.south,
            imageAlt: 'Southern Ethiopia town and lake approaches',
            hours: 4,
            intensity: 'easy',
        }),
        mod({
            id: 'hawassa-fish-market',
            title: 'Fish market & hippo creek',
            summary: 'A fuller morning at the fish market and hippo creek viewpoints, with time for lakeside lunch and photography.',
            highlights: ['Fish market', 'Hippo creek', 'Lakeside lunch'],
            image: IMG.hawassa,
            imageAlt: 'Sunset over Lake Hawassa',
            hours: 5,
            intensity: 'easy',
        }),
        leisure('hawassa-leisure', 'Hawassa', IMG.hawassa, 'Sunset over Lake Hawassa'),
    ], [
        'hawassa-lakefront',
        'hawassa-boat-sidama',
        'hawassa-amora-gedel',
        'hawassa-fish-market',
        'hawassa-leisure',
    ]);

    destinations['rift-valley-lakes'] = program([
        mod({
            id: 'rift-valley-lakes-into',
            title: 'Into the Rift Valley lakes',
            summary: 'Leave Addis for the Great Rift — first lake shores, acacia plains, and flamingo-rich light toward evening.',
            highlights: ['Rift drive', 'Lake shores', 'Flamingo light'],
            image: IMG.hawassa,
            imageAlt: 'Ethiopian Rift Valley lake sunset',
            hours: 5,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'rift-valley-lakes-birding',
            title: 'Birding & crater viewpoints',
            summary: 'A full day among the chain of lakes — bird hides, crater rims, and village stops for coffee and fruit.',
            highlights: ['Birding circuit', 'Crater viewpoints', 'Village coffee'],
            image: IMG.abaya,
            imageAlt: 'Rift Valley lake and shoreline',
            hours: 7,
            intensity: 'moderate',
        }),
        mod({
            id: 'rift-valley-lakes-tiya',
            title: 'Tiya & Melka Kunture options',
            summary: 'On the return corridor, optional stops at Tiya stelae and Melka Kunture prehistoric sites before Addis.',
            highlights: ['Tiya stelae', 'Melka Kunture', 'Road to Addis'],
            image: IMG.yemrehanna,
            imageAlt: 'Ancient stone markers on the Ethiopian plateau',
            hours: 6,
            intensity: 'easy',
            kind: 'half-day',
        }),
        mod({
            id: 'rift-valley-lakes-langano',
            title: 'Langano shore day',
            summary: 'A dedicated Lake Langano shore day — swimming stops, acacia walks, and sunset over the Rift escarpment.',
            highlights: ['Langano shore', 'Acacia walks', 'Rift sunset'],
            image: IMG.hawassa,
            imageAlt: 'Ethiopian Rift Valley lake sunset',
            hours: 5,
            intensity: 'easy',
        }),
        leisure('rift-valley-lakes-leisure', 'the Rift Valley lakes', IMG.abaya, 'Rift Valley lake and shoreline'),
    ], [
        'rift-valley-lakes-into',
        'rift-valley-lakes-birding',
        'rift-valley-lakes-langano',
        'rift-valley-lakes-tiya',
        'rift-valley-lakes-leisure',
    ]);

    destinations.yirgacheffe = program([
        mod({
            id: 'yirgacheffe-arrive',
            title: 'Arrive coffee country',
            summary: "Roll into Yirgacheffe's green hills — cooperative welcome, drying beds, and the scent of washed Arabica.",
            highlights: ['Coffee hills', 'Drying beds', 'Cooperative welcome'],
            image: IMG.south,
            imageAlt: 'Southern Ethiopia highland coffee country',
            hours: 4,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'yirgacheffe-farm-cup',
            title: 'Farm to cup day',
            summary: 'Walk a smallholder farm and washing station — cherry sorting, parchment coffee, and a guided cupping session.',
            highlights: ['Farm walk', 'Washing station', 'Cupping'],
            image: IMG.hawassa,
            imageAlt: 'Lush southern highland landscape',
            hours: 6,
            intensity: 'moderate',
        }),
        mod({
            id: 'yirgacheffe-village-market',
            title: 'Village paths & market',
            summary: 'A gentler day on village paths and the local market — spices, honey, and time with coffee-growing families.',
            highlights: ['Village paths', 'Local market', 'Honey & spices'],
            image: IMG.dorze,
            imageAlt: 'Southern highland community life',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'yirgacheffe-washing-stations',
            title: 'Washing stations & forest plots',
            summary: 'Visit a second washing station and shaded forest coffee plots, with time to talk through harvest seasons and grades.',
            highlights: ['Second station', 'Forest plots', 'Harvest talk'],
            image: IMG.south,
            imageAlt: 'Southern Ethiopia highland coffee country',
            hours: 5,
            intensity: 'easy',
        }),
        leisure('yirgacheffe-leisure', 'Yirgacheffe', IMG.south, 'Southern Ethiopia highland coffee country'),
    ], [
        'yirgacheffe-arrive',
        'yirgacheffe-farm-cup',
        'yirgacheffe-village-market',
        'yirgacheffe-washing-stations',
        'yirgacheffe-leisure',
    ]);

    destinations['tigray-heritage'] = program([
        mod({
            id: 'tigray-heritage-arrive',
            title: "Into Tigray's rock churches",
            summary: 'Arrive in the Gheralta or eastern Tigray highlands — sandstone cliffs and your first cliff-church briefing.',
            highlights: ['Gheralta cliffs', 'Rock churches', 'Highland arrival'],
            image: IMG.yemrehanna,
            imageAlt: 'Rock-hewn church architecture in northern Ethiopia',
            hours: 4,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'tigray-heritage-cliff-church',
            title: 'Cliff church day',
            summary: 'Guided hike to a cliff-cut church — ropes, foot-holds, and frescoes high above the valley floor.',
            highlights: ['Cliff hike', 'Frescoes', 'Valley views'],
            image: IMG.medhane,
            imageAlt: 'Rock church carved into highland stone',
            hours: 7,
            intensity: 'active',
        }),
        mod({
            id: 'tigray-heritage-community-trek',
            title: 'Community trek day',
            summary: 'Village-to-village walking with local hosts — farming terraces, injera lunches, and overnight community lodging.',
            highlights: ['Community trek', 'Farming terraces', 'Village hosts'],
            image: IMG.simien,
            imageAlt: 'Northern highland terraces and paths',
            hours: 7,
            intensity: 'active',
        }),
        mod({
            id: 'tigray-heritage-second-cluster',
            title: 'Second cliff cluster',
            summary: 'A second church cluster or easier escarpment walk — more frescoes, quiet courtyards, and golden-hour ridges.',
            highlights: ['Second cluster', 'Quiet courtyards', 'Escarpment light'],
            image: IMG.lalibelaCourt,
            imageAlt: 'Highland church courtyard',
            hours: 6,
            intensity: 'moderate',
        }),
        leisure('tigray-heritage-leisure', 'Tigray Heritage', IMG.yemrehanna, 'Rock-hewn church architecture in northern Ethiopia'),
    ], [
        'tigray-heritage-arrive',
        'tigray-heritage-cliff-church',
        'tigray-heritage-community-trek',
        'tigray-heritage-second-cluster',
        'tigray-heritage-leisure',
    ]);

    destinations.adama = program([
        mod({
            id: 'adama-arrive',
            title: 'Arrive Adama',
            summary: 'Settle into Adama on the eastern Rift corridor — a first walk through the commercial centre and a highland-evening meal.',
            highlights: ['Town arrival', 'Corridor views', 'Local supper'],
            image: IMG.addisSkyline,
            imageAlt: 'Eastern Rift Valley city approaches',
            hours: 3,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'adama-town-markets',
            title: 'Adama markets & city walk',
            summary: 'A guided walk through Adama’s markets and avenues — fruit stalls, coffee, and a sense of Oromia’s commercial hub.',
            highlights: ['City markets', 'Coffee stops', 'Avenues'],
            image: IMG.addisCity,
            imageAlt: 'Adama city streets',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'adama-rift-view',
            title: 'Rift escarpment viewpoints',
            summary: 'Short drives to escarpment lookouts above the eastern Rift, with picnic time and photos before returning to town.',
            highlights: ['Escarpment views', 'Picnic stop', 'Rift light'],
            image: IMG.south,
            imageAlt: 'Eastern Rift Valley escarpment',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'adama-corridor',
            title: 'Eastern corridor day',
            summary: 'A flexible day along the Adama–Awash approaches — acacia plains, roadside produce, and time to rest before Harar or Addis.',
            highlights: ['Awash approaches', 'Acacia plains', 'Roadside produce'],
            image: IMG.south,
            imageAlt: 'Eastern Rift Valley plains',
            hours: 5,
            intensity: 'easy',
            kind: 'half-day',
        }),
        leisure('adama-leisure', 'Adama', IMG.addisSkyline, 'Eastern Rift Valley city approaches'),
    ], [
        'adama-arrive',
        'adama-town-markets',
        'adama-rift-view',
        'adama-corridor',
        'adama-leisure',
    ]);

    destinations['dire-dawa'] = program([
        mod({
            id: 'dire-dawa-arrive',
            title: 'Arrive Dire Dawa',
            summary: 'Touch down in Dire Dawa — Ethiopia’s eastern rail and trade city — with a first walk through Kezira’s shaded streets.',
            highlights: ['Kezira streets', 'Rail city', 'Eastern arrival'],
            image: IMG.sheraton,
            imageAlt: 'Eastern Ethiopian city streets',
            hours: 3,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'dire-dawa-markets',
            title: 'Megala markets & old town',
            summary: 'Explore Megala’s markets and mixed old-town streets — incense, textiles, and the city’s Somali and Harari trade heritage.',
            highlights: ['Megala market', 'Old town', 'Trade heritage'],
            image: IMG.addisSkyline,
            imageAlt: 'Eastern Ethiopian city streets at dusk',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'dire-dawa-rail',
            title: 'Rail heritage & cafes',
            summary: 'A slower day for the historic railway quarter, Italian-era cafes, and an easy free afternoon before Harar or Addis.',
            highlights: ['Railway quarter', 'City cafes', 'Free afternoon'],
            image: IMG.sheraton,
            imageAlt: 'Eastern Ethiopian city streets',
            hours: 4,
            intensity: 'easy',
            kind: 'half-day',
        }),
        mod({
            id: 'dire-dawa-hills',
            title: 'Hills above Dire Dawa',
            summary: 'Short drives into the hills above town for dry-valley views and a picnic, with time to rest in the heat of the day.',
            highlights: ['Hill viewpoints', 'Dry valleys', 'Picnic'],
            image: IMG.south,
            imageAlt: 'Dry eastern Ethiopian hills',
            hours: 5,
            intensity: 'easy',
        }),
        leisure('dire-dawa-leisure', 'Dire Dawa', IMG.sheraton, 'Eastern Ethiopian city streets'),
    ], [
        'dire-dawa-arrive',
        'dire-dawa-markets',
        'dire-dawa-rail',
        'dire-dawa-hills',
        'dire-dawa-leisure',
    ]);

    destinations.jimma = program([
        mod({
            id: 'jimma-arrive',
            title: 'Arrive Jimma',
            summary: 'Roll into Jimma, historic heart of Ethiopia’s coffee story — a first walk through the leafy town and a welcome coffee.',
            highlights: ['Coffee town', 'Leafy streets', 'Welcome coffee'],
            image: IMG.south,
            imageAlt: 'Southwestern Ethiopian highland town',
            hours: 3,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'jimma-palace-museum',
            title: 'Palace museum & town',
            summary: 'Visit the Aba Jifar palace museum and Jimma’s town centre — royal rooms, coffee history, and a market stroll.',
            highlights: ['Aba Jifar palace', 'Coffee history', 'Town market'],
            image: IMG.yemrehanna,
            imageAlt: 'Historic southwestern Ethiopian architecture',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'jimma-coffee-forests',
            title: 'Coffee forest day',
            summary: 'Walk shaded coffee forests outside town — wild Arabica under canopy, drying beds, and a farm lunch.',
            highlights: ['Coffee forest', 'Wild Arabica', 'Farm lunch'],
            image: IMG.south,
            imageAlt: 'Southwestern Ethiopian highland coffee country',
            hours: 6,
            intensity: 'moderate',
        }),
        mod({
            id: 'jimma-markets',
            title: 'Jimma markets & crafts',
            summary: 'A gentler market day for spices, honey, and weaving, with free time in town before the road back to Addis.',
            highlights: ['Spice market', 'Honey', 'Town crafts'],
            image: IMG.dorze,
            imageAlt: 'Southwestern highland community life',
            hours: 4,
            intensity: 'easy',
        }),
        leisure('jimma-leisure', 'Jimma', IMG.south, 'Southwestern Ethiopian highland town'),
    ], [
        'jimma-arrive',
        'jimma-palace-museum',
        'jimma-coffee-forests',
        'jimma-markets',
        'jimma-leisure',
    ]);

    destinations.mekelle = program([
        mod({
            id: 'mekelle-arrive',
            title: 'Arrive Mekelle',
            summary: 'Settle into Mekelle, Tigray’s highland capital and usual gateway toward the Danakil or Gheralta churches.',
            highlights: ['Highland capital', 'Gateway briefing', 'Town arrival'],
            image: IMG.addisSkyline,
            imageAlt: 'Northern highland city approaches',
            hours: 3,
            intensity: 'easy',
            kind: 'arrival-light',
        }),
        mod({
            id: 'mekelle-monument-market',
            title: 'Monument, museum & markets',
            summary: 'A city circuit of Mekelle’s monument and museum, then the lively markets for incense, spices, and coffee.',
            highlights: ['City monument', 'Museum', 'Spice market'],
            image: IMG.sheraton,
            imageAlt: 'Northern Ethiopian city streets',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'mekelle-escarpment',
            title: 'Escarpment views toward Afar',
            summary: 'Drive to lookouts where the highland drops toward Afar — a sense of the Danakil approaches without the full desert day.',
            highlights: ['Escarpment views', 'Afar approaches', 'Highland light'],
            image: IMG.south,
            imageAlt: 'Highland escarpment toward the Afar lowlands',
            hours: 5,
            intensity: 'easy',
        }),
        mod({
            id: 'mekelle-churches',
            title: 'Nearby rock-church option',
            summary: 'An optional shorter church visit in the Mekelle hinterland — frescoes without the full Gheralta hike — then town time.',
            highlights: ['Nearby church', 'Frescoes', 'Town time'],
            image: IMG.medhane,
            imageAlt: 'Rock church carved into highland stone',
            hours: 6,
            intensity: 'moderate',
        }),
        leisure('mekelle-leisure', 'Mekelle', IMG.addisSkyline, 'Northern highland city approaches'),
    ], [
        'mekelle-arrive',
        'mekelle-monument-market',
        'mekelle-escarpment',
        'mekelle-churches',
        'mekelle-leisure',
    ]);

    return destinations;
}

const DEST_GEO = {
    'addis-ababa': { lat: 9.03, lng: 38.74, stayGuidance: { minDays: 1, recommendedDays: 2 } },
    lalibela: { lat: 12.031, lng: 39.043, stayGuidance: { minDays: 2, recommendedDays: 2 } },
    'bahir-dar': { lat: 11.593, lng: 37.391, stayGuidance: { minDays: 1, recommendedDays: 2 } },
    gondar: { lat: 12.603, lng: 37.452, stayGuidance: { minDays: 1, recommendedDays: 2 } },
    simien: { lat: 13.184, lng: 38.04, stayGuidance: { minDays: 2, recommendedDays: 3 } },
    axum: { lat: 14.128, lng: 38.716, stayGuidance: { minDays: 1, recommendedDays: 2 } },
    'arba-minch': { lat: 6.033, lng: 37.548, stayGuidance: { minDays: 1, recommendedDays: 2 } },
    'omo-valley': { lat: 5.78, lng: 36.57, stayGuidance: { minDays: 4, recommendedDays: 5 } },
    bale: { lat: 6.883, lng: 39.733, stayGuidance: { minDays: 2, recommendedDays: 3 } },
    danakil: { lat: 14.241, lng: 40.3, stayGuidance: { minDays: 2, recommendedDays: 3 } },
    harar: { lat: 9.313, lng: 42.118, stayGuidance: { minDays: 2, recommendedDays: 2 } },
    adama: { lat: 8.54, lng: 39.27, stayGuidance: { minDays: 1, recommendedDays: 1 } },
    bishoftu: { lat: 8.752, lng: 38.979, stayGuidance: { minDays: 1, recommendedDays: 2 } },
    'dire-dawa': { lat: 9.593, lng: 41.866, stayGuidance: { minDays: 1, recommendedDays: 1 } },
    hawassa: { lat: 7.062, lng: 38.476, stayGuidance: { minDays: 1, recommendedDays: 2 } },
    jimma: { lat: 7.673, lng: 36.834, stayGuidance: { minDays: 1, recommendedDays: 2 } },
    mekelle: { lat: 13.496, lng: 39.475, stayGuidance: { minDays: 1, recommendedDays: 1 } },
    'rift-valley-lakes': { lat: 7.6, lng: 38.7, stayGuidance: { minDays: 1, recommendedDays: 2 } },
    'tigray-heritage': { lat: 13.85, lng: 39.55, stayGuidance: { minDays: 2, recommendedDays: 3 } },
    ziway: { lat: 7.933, lng: 38.715, stayGuidance: { minDays: 1, recommendedDays: 2 } },
    'abijatta-shalla': { lat: 7.5, lng: 38.63, stayGuidance: { minDays: 1, recommendedDays: 1 } },
    yirgacheffe: { lat: 6.162, lng: 38.205, stayGuidance: { minDays: 1, recommendedDays: 2 } },
};

function connId(from, to, mode, tag = '') {
    const extra = tag ? `-${tag}` : '';
    return `conn-${from}-${to}-${mode}${extra}`;
}

function makeConn({
    from, to, mode, hours, load, flightRouteId, transferId, via, notes, seasonality, tag,
}) {
    const row = {
        id: connId(from, to, mode, tag),
        from,
        to,
        mode,
        hours,
        load,
    };
    if (flightRouteId) row.flightRouteId = flightRouteId;
    if (transferId) row.transferId = transferId;
    if (via?.length) row.via = via;
    if (notes) row.notes = notes;
    if (seasonality) row.seasonality = seasonality;
    return row;
}

function buildConnections() {
    const rows = [];
    const seen = new Set();

    function push(spec) {
        const row = makeConn(spec);
        if (seen.has(row.id)) throw new Error(`Duplicate connection id ${row.id}`);
        seen.add(row.id);
        rows.push(row);
        return row;
    }

    function pair(spec) {
        const forward = push(spec);
        const back = push({
            ...spec,
            from: spec.to,
            to: spec.from,
            flightRouteId: spec.returnFlightRouteId,
            via: spec.returnVia || (spec.via ? [...spec.via].reverse() : undefined),
            notes: spec.returnNotes || spec.notes,
            tag: spec.returnTag || spec.tag,
        });
        forward.reciprocalId = back.id;
        back.reciprocalId = forward.id;
    }

    // International gateway flights (domestic door-to-door).
    pair({
        from: 'addis-ababa', to: 'lalibela', mode: 'flight', hours: 5.1, load: 'half-day',
        flightRouteId: 'flt-add-lli', returnFlightRouteId: 'flt-lli-add',
        notes: 'Door-to-door includes city/hotel transfers and ADD/LLI airport time.',
    });
    pair({
        from: 'addis-ababa', to: 'bahir-dar', mode: 'flight', hours: 5.0, load: 'half-day',
        flightRouteId: 'flt-add-bjr', returnFlightRouteId: 'flt-bjr-add',
    });
    pair({
        from: 'addis-ababa', to: 'gondar', mode: 'flight', hours: 5.2, load: 'half-day',
        flightRouteId: 'flt-add-gdq', returnFlightRouteId: 'flt-gdq-add',
    });
    pair({
        from: 'addis-ababa', to: 'axum', mode: 'flight', hours: 5.3, load: 'half-day',
        flightRouteId: 'flt-add-axu',
        notes: 'Return airborne sector may be requested as AXU–ADD; door-to-door still ~5.3h.',
    });
    pair({
        from: 'addis-ababa', to: 'arba-minch', mode: 'flight', hours: 5.3, load: 'half-day',
        flightRouteId: 'flt-add-amh',
        notes: 'Return airborne sector may be requested as AMH–ADD.',
    });
    pair({
        from: 'gondar', to: 'lalibela', mode: 'flight', hours: 4.8, load: 'half-day',
        flightRouteId: 'flt-gdq-lli', returnFlightRouteId: 'flt-lli-gdq',
    });
    pair({
        from: 'simien', to: 'lalibela', mode: 'flight', hours: 6.0, load: 'half-day',
        flightRouteId: 'flt-gdq-lli', returnFlightRouteId: 'flt-lli-gdq',
        notes: 'Simien uses GDQ: road to Gondar airport plus LLI flight.',
        via: ['gondar'],
    });
    pair({
        from: 'bahir-dar', to: 'lalibela', mode: 'flight', hours: 5.0, load: 'half-day',
        notes: 'Regional hop; not always in the published ET city-pair table.',
    });
    pair({
        from: 'axum', to: 'lalibela', mode: 'flight', hours: 5.2, load: 'half-day',
        notes: 'Northern heritage hop; may route via ADD when the direct sector is not operating.',
    });
    pair({
        from: 'gondar', to: 'axum', mode: 'flight', hours: 5.0, load: 'half-day',
        notes: 'GDQ–AXU when scheduled; otherwise via ADD.',
    });
    pair({
        from: 'tigray-heritage', to: 'lalibela', mode: 'flight', hours: 5.5, load: 'half-day',
        notes: 'Usually Mekelle or Axum airport plus LLI; door-to-door includes Gheralta road time.',
        via: ['mekelle'],
    });
    pair({
        from: 'addis-ababa', to: 'mekelle', mode: 'flight', hours: 5.5, load: 'half-day',
        notes: 'Usual Danakil and Tigray gateway hop (ADD–MQX).',
    });
    pair({
        from: 'addis-ababa', to: 'jimma', mode: 'flight', hours: 5.0, load: 'half-day',
        notes: 'ADD–JIM when scheduled; road alternative is catalogued separately.',
    });
    pair({
        from: 'addis-ababa', to: 'dire-dawa', mode: 'flight', hours: 5.0, load: 'half-day',
        notes: 'ADD–DIR eastern gateway; Harar is a short road onward.',
    });
    pair({
        from: 'addis-ababa', to: 'hawassa', mode: 'flight', hours: 4.8, load: 'half-day',
        notes: 'ADD–AWA when scheduled; the Rift road is often faster door-to-door.',
    });

    // Via-Addis composed package adjacencies.
    pair({
        from: 'lalibela', to: 'rift-valley-lakes', mode: 'flight', hours: 8.0, load: 'full-day',
        via: ['addis-ababa'], tag: 'via-addis',
        notes: 'LLI–ADD then road south to the Rift lakes; treat as a full transfer day.',
    });
    pair({
        from: 'lalibela', to: 'arba-minch', mode: 'flight', hours: 8.5, load: 'full-day',
        via: ['addis-ababa'], tag: 'via-addis',
        notes: 'LLI–ADD–AMH (or ADD then road); not a direct city-pair.',
    });
    pair({
        from: 'omo-valley', to: 'addis-ababa', mode: 'flight', hours: 7.0, load: 'half-day',
        via: ['arba-minch'], tag: 'via-amh',
        notes: 'Road to Arba Minch (AMH) plus ADD flight.',
        flightRouteId: undefined,
        returnFlightRouteId: 'flt-add-amh',
    });

    // Northern roads.
    pair({ from: 'bahir-dar', to: 'gondar', mode: 'road', hours: 3.5, load: 'short' });
    pair({ from: 'gondar', to: 'simien', mode: 'road', hours: 3.0, load: 'short', notes: 'Gondar–Debark park approaches.' });
    pair({
        from: 'simien', to: 'lalibela', mode: 'road', hours: 8.0, load: 'full-day',
        notes: 'Highland road via Gondar/Woldia corridor; flight is usually faster.',
    });
    pair({ from: 'simien', to: 'axum', mode: 'road', hours: 7.5, load: 'full-day' });
    pair({ from: 'gondar', to: 'axum', mode: 'road', hours: 8.0, load: 'full-day' });
    pair({ from: 'axum', to: 'tigray-heritage', mode: 'road', hours: 2.5, load: 'short', notes: 'Axum–Gheralta/Hawzen.' });
    pair({ from: 'axum', to: 'mekelle', mode: 'road', hours: 3.0, load: 'short' });
    pair({ from: 'mekelle', to: 'tigray-heritage', mode: 'road', hours: 2.0, load: 'short' });
    pair({ from: 'tigray-heritage', to: 'lalibela', mode: 'road', hours: 6.5, load: 'half-day' });
    pair({ from: 'mekelle', to: 'danakil', mode: 'road', hours: 6.0, load: 'half-day', notes: 'Escarpment descent to the Afar/Danakil tracks.' });
    pair({
        from: 'addis-ababa', to: 'danakil', mode: 'road', hours: 12.0, load: 'full-day',
        notes: 'Convoy day via Mekelle or the Afar road; not a touring day.',
        via: ['mekelle'],
    });

    // East.
    pair({ from: 'addis-ababa', to: 'harar', mode: 'road', hours: 8.5, load: 'full-day' });
    pair({ from: 'addis-ababa', to: 'adama', mode: 'road', hours: 1.5, load: 'short' });
    pair({ from: 'adama', to: 'harar', mode: 'road', hours: 6.5, load: 'half-day' });
    pair({ from: 'adama', to: 'dire-dawa', mode: 'road', hours: 6.0, load: 'half-day' });
    pair({ from: 'dire-dawa', to: 'harar', mode: 'road', hours: 1.2, load: 'short' });
    pair({ from: 'addis-ababa', to: 'dire-dawa', mode: 'road', hours: 8.0, load: 'full-day' });

    // Rift / south roads.
    pair({ from: 'addis-ababa', to: 'bishoftu', mode: 'road', hours: 1.2, load: 'short' });
    pair({ from: 'addis-ababa', to: 'ziway', mode: 'road', hours: 2.5, load: 'short' });
    pair({ from: 'addis-ababa', to: 'rift-valley-lakes', mode: 'road', hours: 4.0, load: 'half-day' });
    pair({ from: 'addis-ababa', to: 'hawassa', mode: 'road', hours: 4.0, load: 'half-day' });
    pair({ from: 'addis-ababa', to: 'bale', mode: 'road', hours: 9.0, load: 'full-day' });
    pair({ from: 'addis-ababa', to: 'arba-minch', mode: 'road', hours: 8.5, load: 'full-day' });
    pair({ from: 'addis-ababa', to: 'jimma', mode: 'road', hours: 6.5, load: 'half-day' });
    pair({ from: 'bishoftu', to: 'ziway', mode: 'road', hours: 1.8, load: 'short' });
    pair({ from: 'ziway', to: 'abijatta-shalla', mode: 'road', hours: 0.8, load: 'short' });
    pair({ from: 'ziway', to: 'hawassa', mode: 'road', hours: 2.2, load: 'short' });
    pair({ from: 'abijatta-shalla', to: 'hawassa', mode: 'road', hours: 1.5, load: 'short' });
    pair({ from: 'abijatta-shalla', to: 'rift-valley-lakes', mode: 'road', hours: 0.6, load: 'short' });
    pair({ from: 'ziway', to: 'rift-valley-lakes', mode: 'road', hours: 0.8, load: 'short' });
    pair({ from: 'hawassa', to: 'rift-valley-lakes', mode: 'road', hours: 1.8, load: 'short' });
    pair({ from: 'hawassa', to: 'yirgacheffe', mode: 'road', hours: 2.5, load: 'short' });
    pair({ from: 'hawassa', to: 'bale', mode: 'road', hours: 6.5, load: 'half-day' });
    pair({ from: 'hawassa', to: 'arba-minch', mode: 'road', hours: 4.5, load: 'half-day' });
    pair({ from: 'yirgacheffe', to: 'arba-minch', mode: 'road', hours: 4.0, load: 'half-day' });
    pair({ from: 'arba-minch', to: 'omo-valley', mode: 'road', hours: 5.5, load: 'half-day' });
    pair({ from: 'omo-valley', to: 'yirgacheffe', mode: 'road', hours: 7.5, load: 'full-day' });
    pair({ from: 'omo-valley', to: 'hawassa', mode: 'road', hours: 8.0, load: 'full-day' });
    pair({ from: 'bale', to: 'rift-valley-lakes', mode: 'road', hours: 5.0, load: 'half-day' });

    return rows;
}

function occupancyStayPlan(route = []) {
    return route.map((stop, i, arr) => ({
        destinationId: stop.destinationId,
        days: i === arr.length - 1
            ? Math.max((Number(stop.nights) || 0) + 1, 1)
            : Math.max(Number(stop.nights) || 0, 1),
    }));
}

function defaultModuleIdsForStay(stay, programs) {
    const ids = [];
    for (const stop of stay) {
        const dest = programs[stop.destinationId];
        if (!dest) continue;
        if (stop.days <= 5) {
            ids.push(...(dest.plans[String(stop.days)] || []));
            continue;
        }
        ids.push(...(dest.plans['5'] || []));
        const used = new Set(dest.plans['5'] || []);
        const unused = dest.modules.filter((m) => !used.has(m.id) && m.kind !== 'leisure').map((m) => m.id);
        let remaining = stop.days - 5;
        for (const id of unused) {
            if (remaining <= 0) break;
            ids.push(id);
            remaining -= 1;
        }
        while (remaining > 0 && dest.leisureModuleId) {
            ids.push(dest.leisureModuleId);
            remaining -= 1;
        }
    }
    return ids;
}

function slimPackageTemplates(catalog, programs) {
    const report = {
        packages: 0,
        dropped: [],
        overrides: [],
        unmatchedTitles: [],
    };

    const modulesByTitle = new Map();
    for (const [destId, dest] of Object.entries(programs)) {
        for (const module of dest.modules) {
            modulesByTitle.set(`${destId}::${slug(module.title)}`, module);
            modulesByTitle.set(`*::${slug(module.title)}`, module);
        }
    }

    for (const product of catalog.products || []) {
        if (product.type !== 'package') continue;
        report.packages += 1;
        const templates = product.dayTemplates;
        if (!templates?.length) {
            delete product.dayTemplates;
            continue;
        }

        const stay = occupancyStayPlan(product.route || []);
        const defaultIds = defaultModuleIdsForStay(stay, programs);
        const resolved = [];
        for (const template of templates) {
            const destId = template.destinationId;
            const key = destId ? `${destId}::${slug(template.title)}` : `*::${slug(template.title)}`;
            const module = modulesByTitle.get(key) || modulesByTitle.get(`*::${slug(template.title)}`);
            if (!module) {
                report.unmatchedTitles.push({
                    packageId: product.id,
                    day: template.day,
                    title: template.title,
                    destinationId: destId,
                });
                continue;
            }
            const slim = {
                day: template.day,
                moduleId: module.id,
            };
            if (destId) slim.destinationId = destId;
            const moduleExps = module.experienceIds || [];
            const templateExps = template.experienceIds || [];
            if (templateExps.length && templateExps.join() !== moduleExps.join()) {
                slim.experienceIds = templateExps;
            }
            resolved.push(slim);
        }

        const resolvedIds = resolved.map((row) => row.moduleId);
        const matchesDefault = resolved.length
            && resolved.length === defaultIds.length
            && resolvedIds.every((id, i) => id === defaultIds[i]);

        if (!resolved.length || matchesDefault) {
            delete product.dayTemplates;
            report.dropped.push(product.id);
        } else {
            product.dayTemplates = resolved;
            report.overrides.push({ id: product.id, days: resolved.length });
        }
    }

    return report;
}

function applyDestinationGeo(destDoc) {
    for (const dest of destDoc.destinations || []) {
        const extra = DEST_GEO[dest.id];
        if (!extra) continue;
        dest.lat = extra.lat;
        dest.lng = extra.lng;
        dest.stayGuidance = {
            ...(dest.stayGuidance || {}),
            ...extra.stayGuidance,
        };
    }
    const missing = (destDoc.destinations || []).filter((d) => d.lat == null || d.lng == null).map((d) => d.id);
    return missing;
}

function main() {
    const catalogPath = join(CATALOG_DIR, 'catalog.json');
    const destPath = join(CATALOG_DIR, 'destinations.json');
    const programs = buildDayPrograms();
    const destDoc = readJson(destPath);
    const catalog = readJson(catalogPath);

    const destIds = (destDoc.destinations || []).map((d) => d.id);
    const missingPrograms = destIds.filter((id) => !programs[id]);
    const extraPrograms = Object.keys(programs).filter((id) => !destIds.includes(id));
    if (missingPrograms.length || extraPrograms.length) {
        throw new Error(`Destination mismatch missing=${missingPrograms.join(',')} extra=${extraPrograms.join(',')}`);
    }

    const dayIdeas = {
        schemaVersion: '1.0.0',
        version: 'v1',
        overflowPolicy: 'append-unused-then-leisure',
        notes: 'Reusable destination-day modules. Plans 1–5 are ordered module ID lists. Stays longer than five days append unused modules, then the leisure module — they do not cycle generic copy.',
        destinations: programs,
    };
    writeJson(join(CATALOG_DIR, 'day-ideas.json'), dayIdeas);

    const connections = {
        schemaVersion: '1.0.0',
        version: 'v1',
        defaultGatewayId: 'addis-ababa',
        notes: 'Door-to-door journey graph for the 22 catalog destinations. Airborne time lives in flights.json; hours here include airport and transfer overhead. ADD is the default international gateway. Non-direct package hops are explicit via-hub connections rather than assumed point-to-point flights.',
        connections: buildConnections(),
    };
    writeJson(join(CATALOG_DIR, 'connections.json'), connections);

    const missingGeo = applyDestinationGeo(destDoc);
    if (missingGeo.length) throw new Error(`Missing lat/lng for ${missingGeo.join(',')}`);
    writeJson(destPath, destDoc);

    const templateReport = slimPackageTemplates(catalog, programs);
    catalog.notes = 'Guzo catalog v1: synthetic baseline plus Hermes imports. Day titles, copy, and images live in day-ideas.json modules; package dayTemplates are optional moduleId overrides only. Journey times live in connections.json.';
    writeJson(catalogPath, catalog);

    const report = {
        destinations: destIds.length,
        modules: Object.values(programs).reduce((n, d) => n + d.modules.length, 0),
        plansComplete: destIds.every((id) => ['1', '2', '3', '4', '5'].every((k) => programs[id].plans[k]?.length === Number(k))),
        connections: connections.connections.length,
        missingGeo,
        templates: templateReport,
        wrote: [
            'data/catalog/v1/day-ideas.json',
            'data/catalog/v1/connections.json',
            'data/catalog/v1/destinations.json',
            'data/catalog/v1/catalog.json',
        ],
    };
    const reportPath = join(ROOT, 'scripts/day-program-migration-report.json');
    writeJson(reportPath, report);
    console.log(JSON.stringify(report, null, 2));
    if (!existsSync(join(ROOT, 'data/catalog/schema/day-ideas.schema.json'))) {
        console.warn('day-ideas.schema.json missing');
    }
}

main();
