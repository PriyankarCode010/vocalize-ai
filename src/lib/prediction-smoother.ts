/**
 * Prediction smoothing using majority voting
 */

export class PredictionSmoother {
    private buffer: string[] = [];
    private readonly bufferSize: number;

    constructor(bufferSize: number = 5) {
        this.bufferSize = bufferSize;
    }

    /**
     * Adds a new prediction to the buffer and returns the smoothed prediction
     * @param prediction - New prediction to add
     * @returns Smoothed prediction using majority voting
     */
    addPrediction(prediction: string): string {
        // Add new prediction to buffer
        this.buffer.push(prediction);

        // Keep only the last N predictions
        if (this.buffer.length > this.bufferSize) {
            this.buffer.shift();
        }

        // Return majority vote
        return this.getMajorityVote();
    }

    /**
     * Gets the most frequent prediction in the buffer
     */
    private getMajorityVote(): string {
        if (this.buffer.length === 0) {
            return '';
        }

        // Count occurrences of each prediction
        const counts = new Map<string, number>();
        for (const pred of this.buffer) {
            counts.set(pred, (counts.get(pred) || 0) + 1);
        }

        // Find prediction with highest count
        let maxCount = 0;
        let majorityPrediction = this.buffer[this.buffer.length - 1]; // Default to latest

        for (const [prediction, count] of counts.entries()) {
            if (count > maxCount) {
                maxCount = count;
                majorityPrediction = prediction;
            }
        }

        return majorityPrediction;
    }

    /**
     * Clears the prediction buffer
     */
    reset(): void {
        this.buffer = [];
    }

    /**
     * Gets the current buffer size
     */
    getBufferLength(): number {
        return this.buffer.length;
    }
}
