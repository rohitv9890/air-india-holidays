import { expandSearchPanelIfSticky } from './guzo-context.js';

export function initModeToggle(setInputMode) {
    const toggle = document.getElementById('guzo-mode-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.guzo-mode-btn');
        if (!btn) return;

        const mode = btn.dataset.mode;
        if (mode === 'guzo') {
            expandSearchPanelIfSticky();
        }
        setInputMode(mode);
    });
}
