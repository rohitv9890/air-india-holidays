/** Travel bookings are limited to a rolling 12-month window. */

const MAX_BOOKING_DAYS = 366;

const MONTHS = {
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sep: 9, sept: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
};

function utcToday(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatYmd(date) {
    return date.toISOString().slice(0, 10);
}

/**
 * Pick the year for a month/day within the next 12 months.
 * Past calendar days this year roll to next year.
 */
export function resolveTravelYear(month, day, now = new Date()) {
    const today = utcToday(now);
    const thisYear = today.getUTCFullYear();
    let candidate = new Date(Date.UTC(thisYear, month - 1, day));
    if (candidate < today) {
        candidate = new Date(Date.UTC(thisYear + 1, month - 1, day));
    }
    return candidate.getUTCFullYear();
}

/**
 * Normalize a travel date into YYYY-MM-DD within the booking window.
 * Accepts YYYY-MM-DD, "15 October", "October 15", "15 Oct 2026".
 */
export function normalizeTravelDate(value, now = new Date()) {
    if (value == null || value === '') return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
        const date = new Date(`${iso[0]}T00:00:00Z`);
        if (Number.isNaN(date.getTime())) return null;
        return clampToBookingWindow(date, now);
    }

    const dayMonth = raw.match(
        /^(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?$/i
    );
    if (dayMonth) {
        const day = Number(dayMonth[1]);
        const month = MONTHS[dayMonth[2].toLowerCase()];
        const year = dayMonth[3] ? Number(dayMonth[3]) : resolveTravelYear(month, day, now);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (Number.isNaN(date.getTime())) return null;
        return clampToBookingWindow(date, now);
    }

    const monthDay = raw.match(
        /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/i
    );
    if (monthDay) {
        const month = MONTHS[monthDay[1].toLowerCase()];
        const day = Number(monthDay[2]);
        const year = monthDay[3] ? Number(monthDay[3]) : resolveTravelYear(month, day, now);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (Number.isNaN(date.getTime())) return null;
        return clampToBookingWindow(date, now);
    }

    return null;
}

function clampToBookingWindow(date, now = new Date()) {
    const today = utcToday(now);
    const max = new Date(today);
    max.setUTCDate(max.getUTCDate() + MAX_BOOKING_DAYS);

    if (date < today) {
        // Already-past ISO year from the model: bump to next occurrence in window.
        const bumped = new Date(Date.UTC(today.getUTCFullYear() + 1, date.getUTCMonth(), date.getUTCDate()));
        if (bumped <= max) return formatYmd(bumped);
        return formatYmd(today);
    }
    if (date > max) return formatYmd(max);
    return formatYmd(date);
}

export function normalizeTravelDates(dates, now = new Date()) {
    if (!dates || typeof dates !== 'object') return dates;
    const start = dates.start != null ? normalizeTravelDate(dates.start, now) : null;
    let end = dates.end != null ? normalizeTravelDate(dates.end, now) : null;
    if (start && end && end < start) end = start;
    return {
        start: start ?? dates.start ?? null,
        end: end ?? dates.end ?? null,
    };
}
