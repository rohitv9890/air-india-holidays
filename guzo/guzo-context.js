export function getActiveSearchTab() {
    const active = document.querySelector('#search-tabs-container .search-tab.active');
    return active?.dataset.target || 'packages';
}

export function getPageSection() {
    const sections = [
        { id: 'search-container-wrapper', name: 'search' },
    ];
    const viewportMid = window.scrollY + window.innerHeight * 0.4;

    for (const section of document.querySelectorAll('section')) {
        const rect = section.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        const bottom = top + rect.height;
        if (viewportMid >= top && viewportMid <= bottom) {
            const heading = section.querySelector('h2, h1');
            return heading?.textContent?.trim().slice(0, 40) || 'page';
        }
    }

    if (viewportMid < 600) return 'hero';
    return 'page';
}

export function buildContext() {
    return {
        productTab: getActiveSearchTab(),
        inputMode: document.querySelector('.guzo-mode-btn.active')?.dataset.mode || 'manual',
        pageSection: getPageSection(),
        locale: 'en',
        currency: 'USD',
    };
}

export function expandSearchPanelIfSticky() {
    if (window.EHSearchPanel?.expand) {
        window.EHSearchPanel.expand();
        return;
    }

    const searchPanel = document.getElementById('search-panel');
    if (!searchPanel) return;

    if (searchPanel.classList.contains('is-sticky') && searchPanel.classList.contains('is-collapsed')) {
        searchPanel.classList.remove('is-collapsed');
        searchPanel.classList.remove('py-3');
        searchPanel.classList.add('py-4');
    }
}
