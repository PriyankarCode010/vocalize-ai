/**
 * Feature normalization for hand landmarks
 * Matches the exact training normalization process
 */

import { HandLandmark } from '@/types/hand-detection';

/**
 * Normalizes hand landmarks to a 42-value feature array
 * Algorithm:
 * 1. Collect all x and y values
 * 2. Find min(x) and min(y)
 * 3. For each landmark, push (x - minX) and (y - minY)
 * 
 * @param landmarks - Array of 21 hand landmarks
 * @returns Array of 42 normalized feature values
 */
export function normalizeFeatures(landmarks: HandLandmark[]): number[] {
    if (landmarks.length !== 21) {
        throw new Error(`Expected 21 landmarks, got ${landmarks.length}`);
    }

    // Extract all x and y values
    const xValues = landmarks.map(l => l.x);
    const yValues = landmarks.map(l => l.y);

    // Find minimum values
    const minX = Math.min(...xValues);
    const minY = Math.min(...yValues);

    // Normalize: subtract minimum from each coordinate
    const features: number[] = [];
    for (const landmark of landmarks) {
        features.push(landmark.x - minX);
        features.push(landmark.y - minY);
    }

    return features; // Length: 42
}

/**
 * Validates that the feature array is correct
 */
export function validateFeatures(features: number[]): boolean {
    return features.length === 42 && features.every(f => typeof f === 'number' && !isNaN(f));
}
