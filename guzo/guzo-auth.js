export function getMaharajaClubContext() {
    const token = sessionStorage.getItem('maharajaClubToken');
    if (!token) {
        return { authenticated: false };
    }

    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return {
            authenticated: true,
            memberId: payload.sub,
            firstName: payload.given_name || payload.firstName || 'Member',
            tier: payload.tier || 'Blue',
            milesBalance: payload.miles ?? null,
            homeAirport: payload.home_airport || null,
        };
    } catch {
        return { authenticated: false };
    }
}

export function getMaharajaClubSubtitle() {
    const ctx = getMaharajaClubContext();
    if (!ctx.authenticated) return 'Your Air India travel guide';
    const points = ctx.milesBalance != null ? ` · ${ctx.milesBalance.toLocaleString()} pts` : '';
    return `${ctx.tier}${points}`;
}

export function getMaharajaClubWelcome() {
    const ctx = getMaharajaClubContext();
    if (!ctx.authenticated) return null;
    return `Welcome back, ${ctx.firstName}! Ready to plan your next guzo?`;
}
