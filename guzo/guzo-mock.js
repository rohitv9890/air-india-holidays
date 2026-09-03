import { GUZO_CONFIG } from './guzo-config.js';

export function getGreeting(activeTab) {
    return {
        role: 'assistant',
        type: 'greeting',
        content: GUZO_CONFIG.tabGreetings[activeTab] || GUZO_CONFIG.tabGreetings.packages,
    };
}

export function getMaharajaClubPrompt() {
    return {
        role: 'assistant',
        type: 'maharaja',
        content: 'Sign in to Maharaja Club to save this plan and see how many Maharaja Points you could earn on your booking.',
    };
}
