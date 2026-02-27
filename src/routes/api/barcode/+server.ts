import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Allowed host for proxied URLs (Firebase Storage) */
const ALLOWED_HOST = 'firebasestorage.googleapis.com';

export const GET: RequestHandler = async ({ url }) => {
    const imageUrl = url.searchParams.get('url');
    if (!imageUrl) {
        throw error(400, 'Missing url parameter');
    }

    let parsed: URL;
    try {
        parsed = new URL(imageUrl);
    } catch {
        throw error(400, 'Invalid url');
    }

    if (parsed.hostname !== ALLOWED_HOST) {
        throw error(403, 'URL must be from Firebase Storage');
    }

    try {
        const response = await fetch(imageUrl, {
            headers: { Accept: 'image/*' }
        });
        if (!response.ok) {
            throw error(response.status, 'Failed to fetch image');
        }
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const contentType = response.headers.get('content-type') || 'image/png';

        return new Response(
            JSON.stringify({ base64: `data:${contentType};base64,${base64}` }),
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=3600'
                }
            }
        );
    } catch (e) {
        if (e && typeof e === 'object' && 'status' in e) throw e;
        console.error('Barcode proxy error:', e);
        throw error(502, 'Failed to fetch barcode image');
    }
};
