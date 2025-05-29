import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
    const timeApis = [
        { 
            url: 'https://worldtimeapi.org/api/timezone/Europe/Istanbul', 
            name: 'World Time API',
            parseTime: (data: any) => new Date(data.utc_datetime)
        },
        { 
            url: 'https://timeapi.io/api/Time/current/zone?timeZone=Europe/Istanbul', 
            name: 'Time API IO',
            parseTime: (data: any) => new Date(data.dateTime)
        }
    ];

    for (const api of timeApis) {
        try {
            const response = await fetch(api.url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });

            if (!response.ok) {
                console.warn(`${api.name} returned non-OK status`);
                continue;
            }

            const data = await response.json();
            const time = api.parseTime(data);

            return new Response(JSON.stringify({ 
                time: time.toISOString(),
                source: api.name
            }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store, max-age=0'
                }
            });
        } catch (err) {
            console.warn(`Error fetching time from ${api.name}:`, err);
        }
    }

    // Fallback to system time if all APIs fail
    const fallbackTime = new Date();
    return new Response(JSON.stringify({ 
        time: fallbackTime.toISOString(),
        source: 'System Time'
    }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, max-age=0'
        }
    });
}; 