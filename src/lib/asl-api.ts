/**
 * API client for ASL prediction backend
 */

import { PredictionRequest, PredictionResponse } from '@/types/hand-detection';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';
const API_TIMEOUT = 5000; // 5 seconds

/**
 * Sends feature array to backend and returns prediction
 * @param features - Array of 42 normalized feature values
 * @returns Prediction response from backend
 */
export async function predictASL(features: number[]): Promise<PredictionResponse> {
    if (!BACKEND_URL) {
        throw new Error('Backend URL not configured. Please set NEXT_PUBLIC_BACKEND_URL in .env.local');
    }

    if (features.length !== 42) {
        throw new Error(`Invalid feature array length: ${features.length}. Expected 42.`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
        const response = await fetch(`${BACKEND_URL}/predict`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ features } as PredictionRequest),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Backend error: ${response.status} ${response.statusText}`);
        }

        const data: PredictionResponse = await response.json();

        if (!data.prediction) {
            throw new Error('Invalid response format: missing prediction field');
        }

        return data;
    } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error) {
            if (error.name === 'AbortError') {
                throw new Error('Request timeout: Backend took too long to respond');
            }
            throw error;
        }

        throw new Error('Unknown error occurred while calling backend');
    }
}
