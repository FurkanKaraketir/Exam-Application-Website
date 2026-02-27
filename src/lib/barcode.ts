import { db } from '$lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

/**
 * Get the location barcode URL for display (img src).
 * Returns locationBarcodeUrl from school doc if set, else static path /{schoolId}.png
 */
export async function getBarcodeUrl(schoolId: string): Promise<string> {
    try {
        const schoolRef = doc(db, 'schools', schoolId);
        const schoolSnap = await getDoc(schoolRef);
        const url = schoolSnap.data()?.locationBarcodeUrl;
        return url || `/${schoolId}.png`;
    } catch {
        return `/${schoolId}.png`;
    }
}

/**
 * Get the location barcode image as base64 for use in PDF generation.
 * Uses locationBarcodeBase64 from Firestore (stored on upload) - no image fetch, works on static hosting.
 * Falls back to same-origin static /{schoolId}.png fetch for schools without uploaded barcode.
 */
export async function getBarcodeBase64(schoolId: string): Promise<string | null> {
    try {
        const schoolRef = doc(db, 'schools', schoolId);
        const schoolSnap = await getDoc(schoolRef);
        const data = schoolSnap.data();
        const base64 = data?.locationBarcodeBase64;
        if (base64) return base64;

        // Fallback: same-origin static file (no CORS)
        const staticUrl = `/${schoolId}.png`;
        const res = await fetch(staticUrl);
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}
