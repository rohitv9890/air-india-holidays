/** In-memory itinerary map (process-local). Sessions also persist itinerary when DynamoDB is used. */

const store = new Map();

export function putItinerary(itinerary) {
    if (!itinerary?.id) return;
    store.set(itinerary.id, itinerary);
}

export function getItinerary(id) {
    if (!id) return null;
    return store.get(id) || null;
}
