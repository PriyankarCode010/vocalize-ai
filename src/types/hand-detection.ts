/**
 * Type definitions for hand detection and ASL prediction
 */

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface PredictionRequest {
  features: number[];
}

export interface PredictionResponse {
  prediction: string;
}

export interface DetectionState {
  isDetecting: boolean;
  isLoading: boolean;
  error: string | null;
  currentPrediction: string | null;
  handDetected: boolean;
}
