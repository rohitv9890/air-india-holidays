import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ideaForStayDay, resetDayIdeasCache } from '../lib/day-content.js';

const ideas = JSON.parse(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../data/catalog/v1/day-ideas.json'),
    'utf8',
));

describe('day-content Addis images', () => {
    it('gives each curated Addis stay day a distinct local image', () => {
        resetDayIdeasCache();
        const pool = ideas['addis-ababa'];
        const images = pool.map((_, i) => ideaForStayDay('addis-ababa', i).image);
        assert.equal(new Set(images).size, images.length);
        assert.ok(images.every((img) => /images\/addis/i.test(img)));
        assert.ok(pool.length >= 8, `expected a wide Addis image set, got ${pool.length}`);
    });

    it('cycles Addis images after the curated list ends', () => {
        resetDayIdeasCache();
        const n = ideas['addis-ababa'].length;
        const first = ideaForStayDay('addis-ababa', 0);
        const wrap = ideaForStayDay('addis-ababa', n);
        assert.equal(wrap.image, first.image);
        assert.notEqual(wrap.title, first.title);
    });
});
