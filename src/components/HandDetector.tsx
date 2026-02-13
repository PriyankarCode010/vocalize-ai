'use client';

/**
 * HandDetector Component
 * Real-time ASL recognition using MediaPipe hand detection
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { initializeMediaPipeHands } from '@/lib/mediapipe-config';
import { normalizeFeatures, validateFeatures } from '@/lib/feature-normalization';
import { predictASL } from '@/lib/asl-api';
import { PredictionSmoother } from '@/lib/prediction-smoother';
import { HandLandmark } from '@/types/hand-detection';

// Local type definition for MediaPipe Results
interface Results {
    image?: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;
    multiHandLandmarks?: any[];
}


export default function HandDetector() {
    // Refs
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const handsRef = useRef<any>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const animationRef = useRef<number | null>(null);
    const lastPredictionTimeRef = useRef<number>(0);
    const lastDetectionTimeRef = useRef<number>(0);
    const predictionSmootherRef = useRef(new PredictionSmoother(5));

    // State
    const [isInitialized, setIsInitialized] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentPrediction, setCurrentPrediction] = useState<string | null>(null);
    const [handDetected, setHandDetected] = useState(false);
    const [rawPrediction, setRawPrediction] = useState<string | null>(null);

    // RATE LIMITING CONFIGURATION
    const PREDICTION_INTERVAL = 400; // API calls every 400ms
    const DETECTION_INTERVAL = 100;  // MediaPipe detection every 100ms (10 FPS)

    /**
     * Manual drawing fallback for landmarks
     */
    const drawLandmarksManually = (ctx: CanvasRenderingContext2D, landmarks: any[]) => {
        // Draw connections
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
            const startPoint = landmarks[start];
            const endPoint = landmarks[end];
            ctx.beginPath();
            ctx.moveTo(startPoint.x * ctx.canvas.width, startPoint.y * ctx.canvas.height);
            ctx.lineTo(endPoint.x * ctx.canvas.width, endPoint.y * ctx.canvas.height);
            ctx.stroke();
        });

        // Draw landmark points
        ctx.fillStyle = '#FF0000';
        landmarks.forEach((landmark: any) => {
            ctx.beginPath();
            ctx.arc(
                landmark.x * ctx.canvas.width,
                landmark.y * ctx.canvas.height,
                3,
                0,
                2 * Math.PI
            );
            ctx.fill();
        });
    };

    /**
     * Process hand detection results
     */
    const onResults = useCallback(async (results: Results) => {
        if (!canvasRef.current) return;

        const canvasCtx = canvasRef.current.getContext('2d');
        if (!canvasCtx) return;

        // Clear canvas (we only draw landmarks now, video is separate)
        canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

        // Check if hand is detected
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            // Only update state if it changed to minimize re-renders
            setHandDetected(prev => !prev ? true : prev);

            // Draw hand landmarks
            const landmarks = results.multiHandLandmarks[0];
            
            // Draw landmarks manually
            drawLandmarksManually(canvasCtx, landmarks);

            // Rate limiting: only predict every PREDICTION_INTERVAL ms
            const now = Date.now();
            if (now - lastPredictionTimeRef.current >= PREDICTION_INTERVAL) {
                lastPredictionTimeRef.current = now;

                try {
                    // Convert landmarks to our format
                    const handLandmarks: HandLandmark[] = landmarks.map((lm: any) => ({
                        x: lm.x,
                        y: lm.y,
                        z: lm.z,
                    }));

                    // Normalize features
                    const features = normalizeFeatures(handLandmarks);

                    // Validate features
                    if (!validateFeatures(features)) {
                        throw new Error('Invalid feature array generated');
                    }

                    // Send to backend
                    // Don't set loading state on every frame to avoid UI flicker
                    // setIsLoading(true); 
                    setError(null);

                    const response = await predictASL(features);
                    setRawPrediction(response.prediction);

                    // Apply smoothing
                    const smoothedPrediction = predictionSmootherRef.current.addPrediction(response.prediction);
                    setCurrentPrediction(smoothedPrediction);

                    // setIsLoading(false);
                } catch (err) {
                    // setIsLoading(false);
                    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
                    setError(errorMessage);
                    console.error('Prediction error:', err);
                }
            }
        } else {
            setHandDetected(prev => prev ? false : prev);
            // Don't clear prediction immediately to avoid flickering
            // setCurrentPrediction(null);
        }
    }, []);

    /**
     * Initialize MediaPipe and webcam
     */
    useEffect(() => {
        let mounted = true;

        const initializeCamera = async () => {
            try {
                if (!videoRef.current || !canvasRef.current) return;

                // Initialize MediaPipe Hands (now async)
                handsRef.current = await initializeMediaPipeHands(onResults);

                // Get webcam stream using getUserMedia
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: 640,
                        height: 480,
                        facingMode: 'user'
                    }
                });

                streamRef.current = stream;
                videoRef.current.srcObject = stream;

                await videoRef.current.play();

                // Process frames loop
                const processFrame = async () => {
                    if (!mounted) return;

                    const now = Date.now();
                    
                    // Throttle detection to reduce lag (e.g., 10 FPS)
                    if (handsRef.current && videoRef.current && 
                        (now - lastDetectionTimeRef.current >= DETECTION_INTERVAL)) {
                        
                        lastDetectionTimeRef.current = now;
                        
                        // Send frame to MediaPipe
                        // We don't await here to keep the loop running fast
                        // But actually send() is async, so we should be careful not to stack calls
                        // Since we throttle to 100ms, it should be fine
                         await handsRef.current.send({ image: videoRef.current });
                    }
                    
                    animationRef.current = requestAnimationFrame(processFrame);
                };

                processFrame();

                if (mounted) {
                    setIsInitialized(true);
                }
            } catch (err) {
                console.error('Initialization error:', err);
                if (mounted) {
                    setError('Failed to initialize camera. Please ensure camera permissions are granted.');
                }
            }
        };

        initializeCamera();

        // Cleanup
        return () => {
            mounted = false;
            
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
            
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
            
            if (handsRef.current) {
                handsRef.current.close();
            }
        };
    }, [onResults]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
            <div className="w-full max-w-4xl">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-5xl font-bold text-white mb-4 bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-600">
                        ASL Recognition
                    </h1>
                    <p className="text-gray-300 text-lg">
                        Show your hand to the camera to detect ASL signs
                    </p>
                </div>

                {/* Video and Canvas Container */}
                <div className="relative bg-black rounded-2xl overflow-hidden shadow-2xl mb-6 aspect-[4/3] w-full max-w-[640px] mx-auto">
                    {/* Video - Visible for smooth feed */}
                    <video
                        ref={videoRef}
                        className="absolute top-0 left-0 w-full h-full object-cover"
                        playsInline
                        muted
                    />
                    
                    {/* Canvas - Overlay for landmarks only */}
                    <canvas
                        ref={canvasRef}
                        width={640}
                        height={480}
                        className="absolute top-0 left-0 w-full h-full object-cover"
                    />

                    {/* Overlay Status */}
                    {!isInitialized && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-80 z-10">
                            <div className="text-white text-xl font-semibold animate-pulse">
                                Initializing camera...
                            </div>
                        </div>
                    )}
                </div>

                {/* Status Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    {/* Hand Detection Status */}
                    <div className={`p-6 rounded-xl shadow-lg transition-all duration-300 ${handDetected
                        ? 'bg-gradient-to-br from-green-500 to-emerald-600'
                        : 'bg-gradient-to-br from-gray-700 to-gray-800'
                        }`}>
                        <div className="text-sm font-medium text-white opacity-80 mb-1">
                            Hand Status
                        </div>
                        <div className="text-2xl font-bold text-white">
                            {handDetected ? '✓ Detected' : '✗ No Hand'}
                        </div>
                    </div>

                    {/* Current Prediction */}
                    <div className="p-6 rounded-xl shadow-lg bg-gradient-to-br from-purple-500 to-pink-600">
                        <div className="text-sm font-medium text-white opacity-80 mb-1">
                            Prediction
                        </div>
                        <div className="text-4xl font-bold text-white">
                            {currentPrediction || '—'}
                        </div>
                        {rawPrediction && rawPrediction !== currentPrediction && (
                            <div className="text-xs text-white opacity-60 mt-1">
                                Raw: {rawPrediction}
                            </div>
                        )}
                    </div>

                    {/* Confidence Placeholder */}
                    <div className="p-6 rounded-xl shadow-lg bg-gradient-to-br from-blue-500 to-cyan-600">
                        <div className="text-sm font-medium text-white opacity-80 mb-1">
                            Status
                        </div>
                        <div className="text-lg font-semibold text-white">
                            {isLoading ? (
                                <span className="flex items-center gap-2">
                                    <span className="animate-spin">⟳</span> Processing...
                                </span>
                            ) : handDetected ? (
                                'Ready'
                            ) : (
                                'Waiting...'
                            )}
                        </div>
                    </div>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="p-4 rounded-xl bg-red-500 bg-opacity-20 border border-red-500 mb-6">
                        <div className="flex items-start gap-3">
                            <span className="text-red-400 text-xl">⚠</span>
                            <div>
                                <div className="text-red-300 font-semibold mb-1">Error</div>
                                <div className="text-red-200 text-sm">{error}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Instructions */}
                <div className="bg-slate-800 bg-opacity-50 rounded-xl p-6 backdrop-blur-sm">
                    <h3 className="text-white font-semibold mb-3 text-lg">Instructions:</h3>
                    <ul className="text-gray-300 space-y-2">
                        <li className="flex items-start gap-2">
                            <span className="text-purple-400">•</span>
                            <span>Position your hand clearly in front of the camera</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="text-purple-400">•</span>
                            <span>Ensure good lighting for better detection</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="text-purple-400">•</span>
                            <span>The prediction uses smoothing (last 5 predictions) for stability</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="text-purple-400">•</span>
                            <span>Green lines show detected hand landmarks</span>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
