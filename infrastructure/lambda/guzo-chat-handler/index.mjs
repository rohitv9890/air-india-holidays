import { handleChatStream } from './lib/chat.js';
import {
    handleSession,
    handleSessionGet,
    handleHealth,
    handleCatalogSearch,
    handleCatalogProduct,
    handleEnhancements,
    handleQuote,
    handleItineraryPost,
    handleItineraryGet,
    getRoutePath,
    getCorsHeaders,
} from './lib/routes.js';

async function routeBuffered(event) {
    const path = getRoutePath(event);
    const method = event.requestContext?.http?.method || event.httpMethod || 'GET';

    if (method === 'OPTIONS') {
        return { statusCode: 204, headers: getCorsHeaders(event), body: '' };
    }

    if (path.endsWith('/guzo/health') && method === 'GET') {
        return handleHealth(event);
    }

    if (path.endsWith('/guzo/session') && method === 'GET') {
        return await handleSessionGet(event);
    }

    if (path.endsWith('/guzo/session') && method === 'POST') {
        return await handleSession(event);
    }

    if ((path.endsWith('/guzo/catalog/search') || path.includes('/guzo/catalog/search')) && method === 'GET') {
        return await handleCatalogSearch(event);
    }

    if (path.includes('/guzo/catalog/product') && method === 'GET') {
        return await handleCatalogProduct(event);
    }

    if (path.endsWith('/guzo/enhancements') && method === 'GET') {
        return await handleEnhancements(event);
    }

    if (path.endsWith('/guzo/quote') && method === 'POST') {
        return await handleQuote(event);
    }

    if (path.endsWith('/guzo/itinerary') && method === 'POST') {
        return await handleItineraryPost(event);
    }

    if (path.endsWith('/guzo/itinerary') && method === 'GET') {
        return await handleItineraryGet(event);
    }

    if (path.endsWith('/guzo/chat') && method === 'POST') {
        const body = event.body ? JSON.parse(event.body) : {};
        const chunks = [];
        const mockStream = {
            write(s) { chunks.push(s); },
            end() {},
        };
        await handleChatStream(body, mockStream);
        return {
            statusCode: 200,
            headers: getCorsHeaders(event),
            body: chunks.join(''),
        };
    }

    return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(event) },
        body: JSON.stringify({ error: 'Not found' }),
    };
}

const streamHandler = globalThis.awslambda?.streamifyResponse
    ? globalThis.awslambda.streamifyResponse(async (event, responseStream) => {
        const path = getRoutePath(event);
        const method = event.requestContext?.http?.method || event.httpMethod || 'GET';

        if (method === 'OPTIONS') {
            const stream = globalThis.awslambda.HttpResponseStream.from(responseStream, {
                statusCode: 204,
                headers: getCorsHeaders(event),
            });
            stream.end();
            return;
        }

        // Non-streaming JSON endpoints
        if (
            (path.endsWith('/guzo/health') && method === 'GET')
            || (path.endsWith('/guzo/session') && (method === 'GET' || method === 'POST'))
            || ((path.endsWith('/guzo/catalog/search') || path.includes('/guzo/catalog/search')) && method === 'GET')
            || (path.includes('/guzo/catalog/product') && method === 'GET')
            || (path.endsWith('/guzo/enhancements') && method === 'GET')
            || (path.endsWith('/guzo/quote') && method === 'POST')
            || (path.endsWith('/guzo/itinerary') && (method === 'POST' || method === 'GET'))
        ) {
            const result = await routeBuffered(event);
            const stream = globalThis.awslambda.HttpResponseStream.from(responseStream, {
                statusCode: result.statusCode,
                headers: result.headers,
            });
            stream.write(result.body || '');
            stream.end();
            return;
        }

        if (path.endsWith('/guzo/chat') && method === 'POST') {
            const body = event.body ? JSON.parse(event.body) : {};
            const stream = globalThis.awslambda.HttpResponseStream.from(responseStream, {
                statusCode: 200,
                headers: getCorsHeaders(event),
            });
            await handleChatStream(body, stream);
            return;
        }

        const stream = globalThis.awslambda.HttpResponseStream.from(responseStream, {
            statusCode: 404,
            headers: { 'Content-Type': 'application/json', ...getCorsHeaders(event) },
        });
        stream.write(JSON.stringify({ error: 'Not found' }));
        stream.end();
    })
    : null;

export const handler = streamHandler || routeBuffered;
