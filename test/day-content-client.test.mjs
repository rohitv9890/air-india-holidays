import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    selectDayIdea,
    shouldPreserveDayContent,
} from '../guzo/day-content.js';

describe('browser day-content overlay', () => {
    it('preserves module-resolved API days and enriches generic copy', () => {
        assert.equal(shouldPreserveDayContent({
            moduleId: 'delhi-gateway',
            title: 'Gateway to the capital',
            summary: 'Settle into Delhi.',
            image: 'images/delhi.jpg',
            highlights: ['Street food tour'],
        }), true);
        assert.equal(shouldPreserveDayContent({
            title: 'Jaipur',
            destinationId: 'jaipur',
            location: 'Jaipur',
            description: 'Best of the circuit — day 2 in Jaipur.',
            image: 'images/amber-fort.jpg',
        }), false);
        assert.equal(shouldPreserveDayContent({
            moduleId: 'agra-taj-cluster',
            title: 'API Taj cluster',
            summary: 'Server-authored copy.',
            image: 'https://example.test/api.jpg',
        }), true);
    });

    it('selects authored modules for a 2-day plan rather than cycling prefix copy', () => {
        const ideas = {
            jaipur: {
                modules: {
                    'jai-forts': {
                        id: 'jai-forts',
                        title: 'Amber Fort and City Palace',
                        summary: 'Amber Fort and the City Palace complex.',
                        highlights: ['Amber Fort'],
                        experienceIds: ['exp-jaipur-forts'],
                        image: 'images/jaipur-1.jpg',
                        imageAlt: 'Forts',
                    },
                    'jai-bazaar': {
                        id: 'jai-bazaar',
                        title: 'Hawa Mahal and the bazaars',
                        summary: 'Hawa Mahal and the old-town bazaars.',
                        highlights: ['Hawa Mahal'],
                        experienceIds: [],
                        image: 'images/jaipur-2.jpg',
                        imageAlt: 'Bazaar',
                    },
                },
                plans: {
                    1: ['jai-forts'],
                    2: ['jai-forts', 'jai-bazaar'],
                    3: ['jai-forts', 'jai-bazaar', 'jai-forts'],
                    4: ['jai-forts', 'jai-bazaar', 'jai-forts', 'jai-bazaar'],
                    5: ['jai-forts', 'jai-bazaar', 'jai-forts', 'jai-bazaar', 'jai-forts'],
                },
            },
        };
        const day2 = selectDayIdea(ideas, 'jaipur', 1, 2);
        assert.equal(day2.moduleId, 'jai-bazaar');
        assert.equal(day2.title, 'Hawa Mahal and the bazaars');
        assert.deepEqual(day2.experienceIds, []);
    });
});
