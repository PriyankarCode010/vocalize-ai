import { useRef, useEffect, useState, useCallback } from 'react';
import { initializeMediaPipeHands } from '@/lib/mediapipe-config';
import { normalizeFeatures, validateFeatures } from '@/lib/feature-normalization';

interface UseASLRecognitionProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    enabled?: boolean;
}

interface UseASLRecognitionReturn {
    isInitialized: boolean;
    handDetected: boolean;
    currentPrediction: string | null;
    rawPrediction: string | null;
    landmarks: any; // MediaPipe landmarks
    error: string | null;
}

const DETECTION_INTERVAL = 100; // ms (10 FPS)
const PREDICTION_INTERVAL = 400; // ms (2.5 FPS)
const SMOOTHING_WINDOW = 5;

// Fallback logic for drawing directly if needed
export function drawLandmarks(ctx: CanvasRenderingContext2D, landmarks: any) {
    if (!landmarks) return;

    // Draw connections (simplified)
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8], // Index
        [0, 9], [9, 10], [10, 11], [11, 12], // Middle
        [0, 13], [13, 14], [14, 15], [15, 16], // Ring
        [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
        [5, 9], [9, 13], [13, 17] // Palm
    ];

    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;

    connections.forEach(([start, end]) => {
        const p1 = landmarks[start];
        const p2 = landmarks[end];

        ctx.beginPath();
        ctx.moveTo(p1.x * ctx.canvas.width, p1.y * ctx.canvas.height);
        ctx.lineTo(p2.x * ctx.canvas.width, p2.y * ctx.canvas.height);
        ctx.stroke();
    });

    ctx.fillStyle = '#FF0000';
    landmarks.forEach((landmark: any) => {
        ctx.beginPath();
        ctx.arc(landmark.x * ctx.canvas.width, landmark.y * ctx.canvas.height, 3, 0, 2 * Math.PI);
        ctx.fill();
    });
}


export function useASLRecognition({ videoRef, enabled = true }: UseASLRecognitionProps): UseASLRecognitionReturn {
    const [isInitialized, setIsInitialized] = useState(false);
    const [handDetected, setHandDetected] = useState(false);
    const [currentPrediction, setCurrentPrediction] = useState<string | null>(null);
    const [rawPrediction, setRawPrediction] = useState<string | null>(null);
    const [landmarks, setLandmarks] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const handsRef = useRef<any>(null);
    const lastDetectionTimeRef = useRef<number>(0);
    const lastPredictionTimeRef = useRef<number>(0);
    const predictionHistoryRef = useRef<string[]>([]);
    const mountedRef = useRef(true);
    const rafRef = useRef<number | null>(null);

    const onResults = useCallback(async (results: any) => {
        if (!mountedRef.current) return;

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            setHandDetected(true);
            const outputLandmarks = results.multiHandLandmarks[0];
            setLandmarks(outputLandmarks);

            const now = Date.now();
            if (now - lastPredictionTimeRef.current >= PREDICTION_INTERVAL) {
                lastPredictionTimeRef.current = now;

                try {
                    const features = normalizeFeatures(outputLandmarks);
                    if (!validateFeatures(features)) {
                        console.warn("Invalid features detected");
                        return;
                    }

                    const response = await fetch(process.env.NEXT_PUBLIC_BACKEND_URL + '/predict', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ features })
                    });

                    if (!response.ok) throw new Error('Prediction failed');

                    const data = await response.json();
                    const prediction = data.prediction;

                    setRawPrediction(prediction);

                    // Smoothing
                    const history = predictionHistoryRef.current;
                    history.push(prediction);
                    if (history.length > SMOOTHING_WINDOW) history.shift();

                    if (history.length >= SMOOTHING_WINDOW) {
                        const counts: Record<string, number> = {};
                        history.forEach(p => counts[p] = (counts[p] || 0) + 1);

                        let maxCount = 0;
                        let smoothed = prediction;
                        for (const p in counts) {
                            if (counts[p] > maxCount) {
                                maxCount = counts[p];
                                smoothed = p;
                            }
                        }

                        // Set final prediction if stable enough (optional logic)
                        setCurrentPrediction(smoothed);
                    } else {
                        setCurrentPrediction(prediction);
                    }
                } catch (err) {
                    console.error(err);
                }
            }
        } else {
            setHandDetected(false);
            setLandmarks(null);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        let handsInstance: any = null;

        const init = async () => {
            try {
                handsInstance = await initializeMediaPipeHands(onResults);
                handsRef.current = handsInstance;
                setIsInitialized(true);
            } catch (err) {
                console.error("Failed to init MediaPipe:", err);
                setError("Failed to initialize hand tracking");
            }
        };

        if (enabled) {
            init();
        }

        return () => {
            mountedRef.current = false;
            if (handsInstance) handsInstance.close();
        };
    }, [enabled, onResults]);

    useEffect(() => {
        const processFrame = async () => {
            if (!mountedRef.current) return;

            if (enabled && isInitialized && videoRef.current && handsRef.current) {
                const now = Date.now();
                if (now - lastDetectionTimeRef.current >= DETECTION_INTERVAL) {
                    lastDetectionTimeRef.current = now;
                    if (videoRef.current.readyState >= 2) {
                        await handsRef.current.send({ image: videoRef.current });
                    }
                }
            }
            rafRef.current = requestAnimationFrame(processFrame);
        };

        if (enabled && isInitialized) {
            processFrame();
        }

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [enabled, isInitialized, videoRef]);

    return { isInitialized, handDetected, currentPrediction, rawPrediction, landmarks, error };
}
