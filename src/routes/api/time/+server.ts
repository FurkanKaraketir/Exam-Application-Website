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

    let apiErrors = 0;

    for (const api of timeApis) {
        try {
            // Add timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

            const response = await fetch(api.url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                apiErrors++;
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
            apiErrors++;
            // Only log if all APIs fail to reduce console noise
            if (apiErrors === timeApis.length) {
                console.warn('All time APIs failed, using system time as fallback');
            }
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