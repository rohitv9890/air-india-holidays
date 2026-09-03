import { normalizeDestination } from './catalog.js';

const API_BASE = process.env.EASYGDS_API_BASE || 'https://demo.apps.easygds.com/api';

export async function searchPlaces(query, type) {
    let url;
    if (type === 'airport_code') {
        url = new URL(`${API_BASE}/places/cities-with-airports`);
        url.searchParams.set('search_text', query);
        url.searchParams.set('language_code', 'en-US');
    } else if (type === 'tour_region') {
        url = new URL(`${API_BASE}/places`);
        url.searchParams.set('search_text', query);
        url.searchParams.set('language_code', 'en-US');
        url.searchParams.set('types', 'country,airport,administrative_area_level_4,administrative_area_level_3');
        url.searchParams.set('property_included', 'false');
        url.searchParams.set('with_properties', 'false');
        url.searchParams.set('has_code', 'false');
        url.searchParams.set('per_page', '20');
        url.searchParams.set('page', '1');
    } else {
        url = new URL(`${API_BASE}/places`);
        url.searchParams.set('search_text', query);
        url.searchParams.set('language_code', 'en-US');
        url.searchParams.set('types', 'country,airport,administrative_area_level_4,administrative_area_level_3');
        url.searchParams.set('property_included', 'false');
        url.searchParams.set('with_properties', 'true');
        url.searchParams.set('has_code', 'false');
        url.searchParams.set('per_page', '20');
        url.searchParams.set('page', '1');
    }

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Places API failed: ${res.status}`);
    }

    const data = await res.json();
    const results = [];

    if (Array.isArray(data)) {
        for (const item of data) {
            results.push({
                name: item.name,
                code: item.code || item.id,
                type: 'airport_code',
                id: item.id,
            });
        }
    } else {
        for (const p of data.places || []) {
            const name = p.long_name || p.name;
            results.push({
                name,
                code: p.id,
                type: 'place_id',
                id: p.id,
                catalogId: normalizeDestination(name) || null,
            });
        }
        for (const p of data.properties || []) {
            results.push({
                name: p.name,
                code: p.hotel_id || p.id,
                type: 'hotel',
                id: p.id,
            });
        }
    }

    return results.slice(0, 10);
}
