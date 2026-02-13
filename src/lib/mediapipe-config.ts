/**
 * MediaPipe Hands configuration and initialization
 */

export const MEDIAPIPE_CONFIG = {
    locateFile: (file: string) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    },
};

export const HANDS_CONFIG = {
    maxNumHands: 1,
    modelComplexity: 1 as 0 | 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.5,
};

export async function initializeMediaPipeHands(
    onResults: (results: any) => void
): Promise<any> {
    // Dynamic import to avoid SSR issues
    const { Hands } = await import('@mediapipe/hands');

    const hands = new Hands(MEDIAPIPE_CONFIG);

    hands.setOptions(HANDS_CONFIG);
    hands.onResults(onResults);

    return hands;
}
