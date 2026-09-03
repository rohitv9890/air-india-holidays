import { createEmptyIntent } from './intent.js';

const TABLE = process.env.SESSIONS_TABLE;
const TTL_HOURS = 24;
const memorySessions = new Map();

function useMemory() {
    return !TABLE;
}

function ttlEpoch() {
    return Math.floor(Date.now() / 1000) + TTL_HOURS * 3600;
}

let docPromise = null;
async function getDynamoDoc() {
    if (!docPromise) {
        docPromise = Promise.all([
            import('@aws-sdk/client-dynamodb'),
            import('@aws-sdk/lib-dynamodb'),
        ]).then(([{ DynamoDBClient }, { DynamoDBDocumentClient }]) =>
            DynamoDBDocumentClient.from(new DynamoDBClient({})),
        );
    }
    return docPromise;
}

export async function getSession(sessionId) {
    if (useMemory()) {
        return memorySessions.get(sessionId) || null;
    }

    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const doc = await getDynamoDoc();
    const { Item } = await doc.send(new GetCommand({
        TableName: TABLE,
        Key: { sessionId },
    }));
    return Item || null;
}

export async function upsertSession(sessionId, patch = {}) {
    const now = new Date().toISOString();
    const existing = await getSession(sessionId);
    const tab = patch.tab || existing?.tab || 'packages';

    const item = {
        sessionId,
        tab,
        intent: patch.intent ?? existing?.intent ?? createEmptyIntent(tab),
        messages: patch.messages ?? existing?.messages ?? [],
        diagnostics: patch.diagnostics ?? existing?.diagnostics ?? [],
        title: patch.title ?? existing?.title ?? null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        ttl: ttlEpoch(),
    };

    if (patch.itinerary !== undefined) {
        item.itinerary = patch.itinerary;
    } else if (existing?.itinerary) {
        item.itinerary = existing.itinerary;
    }

    if (useMemory()) {
        memorySessions.set(sessionId, item);
        return item;
    }

    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const doc = await getDynamoDoc();
    await doc.send(new PutCommand({ TableName: TABLE, Item: item }));
    return item;
}

export async function appendMessage(sessionId, role, content) {
    const session = await getSession(sessionId);
    const messages = [...(session?.messages || []), { role, content, at: new Date().toISOString() }];
    const patch = {
        tab: session?.tab,
        intent: session?.intent,
        itinerary: session?.itinerary,
        messages: messages.slice(-40),
        title: session?.title,
    };
    // Title from the first user message for history lists.
    if (role === 'user' && !session?.title && content) {
        patch.title = String(content).replace(/\s+/g, ' ').trim().slice(0, 72);
    }
    return upsertSession(sessionId, patch);
}

export async function appendDiagnostic(sessionId, event) {
    const session = await getSession(sessionId);
    const diagnostics = [
        ...(session?.diagnostics || []),
        { ...event, at: new Date().toISOString() },
    ].slice(-100);
    return upsertSession(sessionId, {
        tab: session?.tab,
        intent: session?.intent,
        itinerary: session?.itinerary,
        messages: session?.messages,
        diagnostics,
    });
}

export async function saveIntent(sessionId, intent) {
    const session = await getSession(sessionId);
    return upsertSession(sessionId, {
        tab: intent.productTab || session?.tab,
        intent,
        itinerary: session?.itinerary,
        messages: session?.messages,
    });
}

export async function saveItinerary(sessionId, itinerary) {
    const session = await getSession(sessionId);
    return upsertSession(sessionId, {
        tab: session?.tab,
        intent: session?.intent,
        messages: session?.messages,
        itinerary,
    });
}
