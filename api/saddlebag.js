const SADDLEBAG_URL = 'https://docs.saddlebagexchange.com/api/wow/tsmstats';

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'Only POST is supported.' });
    }

    try {
        const upstream = await fetch(SADDLEBAG_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.body)
        });
        const payload = await upstream.text();
        response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
        response.setHeader('Content-Type', 'application/json');
        return response.status(upstream.status).send(payload);
    } catch (error) {
        return response.status(502).json({ error: 'Saddlebag API is unavailable.', detail: error.message });
    }
}
