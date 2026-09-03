function getEH() {
    if (!window.EHSearch?.go) {
        throw new Error('Search API not ready. Please refresh the page.');
    }
    return window.EHSearch;
}

function buildTravelers(intent) {
    const t = intent.travelers;
    const travelers = [];
    for (let i = 0; i < t.adults; i++) travelers.push({ type: 'adult', age: 30, room: 1 });
    for (let i = 0; i < t.children; i++) {
        travelers.push({ type: 'child', age: t.childAges[i] || 8, room: 1 });
    }
    for (let i = 0; i < (t.infants || 0); i++) travelers.push({ type: 'infant', age: 1, room: 1 });
    return travelers;
}

function defaultDates() {
    return getEH().getDefaultDates();
}

function buildSearchPayload(intent, tab) {
    const EH = getEH();
    const def = defaultDates();
    const travelers = buildTravelers(intent);
    const start = intent.dates?.start || def.startStr;
    const end = intent.dates?.end || def.endStr;

    switch (tab) {
        case 'packages':
            return {
                paramsObj: {
                    process: 'bundle',
                    package_id: EH.PACKAGE_CONFIG_ID,
                    place_type: 'airport',
                    place_id: intent.destination.id || intent.destination.code || 'AGR',
                    is_separate: false,
                    expectation: JSON.stringify({
                        fl_cabin_class: intent.cabin || 'Economy',
                        fl_departure_date: start,
                        fl_return_date: end,
                        fl_round_trip: intent.roundTrip !== false,
                        start_place_code: intent.origin.code || 'DEL',
                        start_place_type: 'airport_code',
                        des_code: intent.destination.code || 'AGR',
                        des_type: 'airport_code',
                        ht_des_code: intent.destination.code || 'AGR',
                        ht_des_type: 'airport_code',
                        ht_checkin_date: start,
                        ht_checkout_date: end,
                        is_separate: false,
                        stars: null,
                    }),
                    travelers: JSON.stringify(travelers),
                },
            };
        case 'flights': {
            const expectation = {
                is_multi_city: false,
                start_place_code: intent.origin.code || 'DEL',
                start_place_type: 'airport_code',
                des_code: intent.destination.code || 'AGR',
                des_type: 'airport_code',
                fl_cabin_class: intent.cabin || 'Economy',
                fl_departure_date: start,
                fl_round_trip: intent.roundTrip !== false,
            };
            if (intent.roundTrip !== false) expectation.fl_return_date = end;
            return {
                paramsObj: {
                    process: 'flight',
                    package_id: EH.FLIGHT_CONFIG_ID,
                    expectation: JSON.stringify(expectation),
                    travelers: JSON.stringify(travelers),
                },
            };
        }
        case 'hotels': {
            const code = intent.destination.code || intent.destination.id || '110001';
            const selType = intent.destination.type === 'hotel' ? 'hotel' : 'place_id';
            const paramsObj = {
                process: 'hotel',
                package_id: EH.HOTEL_CONFIG_ID,
                expectation: JSON.stringify({
                    ht_des_code: code,
                    ht_checkin_date: start,
                    ht_checkout_date: end,
                    ht_des_type: selType === 'hotel' ? 'property_id' : 'place_id',
                    is_separate: selType === 'hotel',
                }),
                travelers: JSON.stringify(travelers),
            };
            if (selType === 'hotel') {
                paramsObj.place_type = 'hotel';
                paramsObj.place_id = code;
                return { paramsObj, customPath: `products/hotel/${code}` };
            }
            paramsObj.place_type = 'administrative_area_level_4';
            paramsObj.place_id = code;
            return { paramsObj };
        }
        case 'tours':
            return {
                paramsObj: {
                    process: 'tour',
                    package_id: EH.TOUR_PACKAGE_ID,
                    expectation: JSON.stringify({
                        is_separate: false,
                        tr_des_code: intent.destination.id || intent.destination.code || '244102',
                        tr_des_type: 'place_id',
                        tr_start_date: start,
                        tr_end_date: end,
                    }),
                    travelers: JSON.stringify(travelers),
                },
            };
        case 'transfers': {
            const pickup = intent.pickup;
            const dropoff = intent.dropoff;
            const isFromAirport = pickup?.type === 'airport_code';
            const airportCode = isFromAirport ? (pickup.code || 'DEL') : (dropoff.code || 'DEL');
            const place = isFromAirport ? dropoff : pickup;
            const placeId = place?.id || place?.code || '31842';
            const placeType = place?.type === 'hotel' ? 'property_id' : 'place_id';
            return {
                paramsObj: {
                    process: 'transfer',
                    package_id: EH.TRANSFER_CONFIG_ID,
                    expectation: JSON.stringify({
                        is_separate: false,
                        tf_airport_code: airportCode,
                        tf_from_airport: isFromAirport,
                        tf_pickup_date: intent.pickupDate || start,
                        tf_pickup_time: intent.pickupTime || '12:00',
                        tf_place_code: placeId,
                        tf_place_type: placeType,
                        tf_return_date: null,
                        tf_return_time: null,
                        tf_round_trip: false,
                    }),
                    travelers: JSON.stringify([{ type: 'adult', age: 30, room: 1 }]),
                },
            };
        }
        default:
            throw new Error(`Unknown product tab: ${tab}`);
    }
}

export function getSearchUrl(intent, tab) {
    const EH = getEH();
    const { paramsObj, customPath } = buildSearchPayload(intent, tab);
    return EH.buildSearchUrl(paramsObj, customPath);
}

export function executeSearch(intent, tab) {
    const EH = getEH();
    const { paramsObj, customPath } = buildSearchPayload(intent, tab);
    EH.go(paramsObj, customPath);
}

export function isSearchApiReady() {
    return !!window.EHSearch?.go;
}
