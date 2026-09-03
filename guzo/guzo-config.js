export const GUZO_CONFIG = {
    /** Demo runs entirely off the local catalog JSON — no backend, no API key needed. */
    mockMode: true,
    /** Same-origin via guzo-local-server; falls back to localhost API for file:// opens */
    apiUrl: (() => {
        if (typeof window === 'undefined') return 'http://localhost:8787';
        const origin = window.location?.origin || '';
        if (!origin || origin === 'null' || origin.startsWith('file:')) return 'http://localhost:8787';
        return origin;
    })(),
    signInUrl: '#',
    joinShebaMilesUrl: '#',
    typingDelayMs: 900,

    tabLabels: {
        packages: 'Packages',
        hotels: 'Hotels',
        tours: 'Tours',
        transfers: 'Transfers',
        flights: 'Flights',
    },

    tabGreetings: {
        packages: "Namaste! I'm Maharaja, your Air India Holidays assistant. Tell me where you'd like to go — the Cricket World Cup 2027 in South Africa, a Taj Holidays escape, or anywhere else — and I'll build your itinerary.\n\nHere are some suggested trips:",
        hotels: "Namaste! Tell me the city, dates, and guests. I'll ask for anything still missing, then search.",
        tours: "Namaste! Share your destination and dates. I'll fill in the gaps, then search.",
        transfers: "Namaste! Pickup, dropoff, and time. I'll confirm the details, then search.",
        flights: "Namaste! Your route, dates, and travellers. I'll ask what's missing, then search.",
    },

    tabPrompts: {
        packages: [
            'India v Pakistan at Newlands, Cape Town',
            'Cricket World Cup Final package',
            'Taj Lake Palace, Udaipur',
            'Maldives at Taj Exotica',
            'World Cup opener in Johannesburg',
        ],
        hotels: [
            'Taj Falaknuma Palace, Hyderabad, 2 nights',
            '5-star hotel in Cape Town during the World Cup',
            'Taj Exotica Resort, Maldives',
        ],
        tours: [
            'City Palace and Lake Pichola, Udaipur',
            'Table Mountain and Cape Point, Cape Town',
            'Taj Mahal sunrise tour, Agra',
        ],
        transfers: [
            'Airport pickup at JNB to Melrose Arch',
            'Hotel to Newlands Stadium on match day',
            'Transfer from Udaipur airport to Taj Lake Palace jetty',
        ],
        flights: [
            'Return flight Delhi to Johannesburg',
            'Business class to Cape Town for the final',
            'Mumbai to Udaipur, 2 adults',
        ],
    },
};
