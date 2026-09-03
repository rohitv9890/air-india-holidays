const FIELD_MAP = {
    packages: {
        origin: '#pkg-origin',
        dest: '#pkg-dest',
        dates: '#pkg-dates',
        travelers: '#pkg-traveler-summary',
        cabin: '#pkg-cabin-val',
    },
    hotels: {
        dest: '#ht-dest',
        dates: '#ht-dates',
        travelers: '#traveler-summary',
    },
    tours: {
        dest: '#tour-dest',
        dates: '#tour-dates',
        travelers: '#tour-pax-display',
    },
    transfers: {
        pickup: '#tr-pickup',
        dropoff: '#tr-dropoff',
        date: '#tr-date',
        time: '#tr-time-val',
    },
    flights: {
        origin: '#fl-origin',
        dest: '#fl-dest',
        dates: '#fl-dates',
        travelers: '#fl-pax-display',
    },
};

function setFieldValue(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return null;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
        el.textContent = value;
    }

    return el.closest('.search-input-box');
}

function highlightBox(box) {
    if (!box) return;
    box.classList.add('guzo-field-highlight');
    setTimeout(() => box.classList.remove('guzo-field-highlight'), 3200);
}

export function prefillSearchForm(tab, fields) {
    const map = FIELD_MAP[tab];
    if (!map) return false;

    const highlighted = [];

    Object.entries(fields).forEach(([key, value]) => {
        const selector = map[key];
        if (!selector || value == null) return;
        const box = setFieldValue(selector, value);
        if (box) highlighted.push(box);
    });

    highlighted.forEach((box, i) => {
        setTimeout(() => highlightBox(box), i * 120);
    });

    return highlighted.length > 0;
}

export function activateSearchTab(tab) {
    const tabBtn = document.querySelector(`#search-tabs-container .search-tab[data-target="${tab}"]`);
    if (tabBtn) tabBtn.click();
}

export function applyPrefillAndSwitchToManual(tab, fields, setInputMode) {
    activateSearchTab(tab);
    prefillSearchForm(tab, fields);
    setInputMode('manual');
}
