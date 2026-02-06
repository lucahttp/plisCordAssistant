/**
 * Voice Activity Detection (VAD) Processor
 * Tracks speech state using Silero VAD output
 */

export class VADProcessor {
    constructor(options = {}) {
        this.positiveThreshold = options.positiveThreshold || 0.65;
        this.negativeThreshold = options.negativeThreshold || 0.4;
        this.negativeCount = options.negativeCount || 8;

        // State tracking
        this.isSpeaking = false;
        this.negativeSamples = 0;
        this.wasSpseaking = false;

        // Silero VAD hidden state (LSTM)
        this.h = null;
        this.c = null;
    }

    /**
     * Get LSTM state tensors for VAD model
     */
    getState() {
        // Initialize hidden state if needed
        // Silero VAD uses 2 layers, 64 hidden units
        if (!this.h) {
            const zeros = new Float32Array(2 * 64).fill(0);
            const ort = require('onnxruntime-node');
            this.h = new ort.Tensor('float32', zeros, [2, 1, 64]);
            this.c = new ort.Tensor('float32', zeros, [2, 1, 64]);
        }

        return {
            h: this.h,
            c: this.c,
        };
    }

    /**
     * Process VAD model output
     * @param {Object} results - ONNX run output
     * @returns {Object} VAD state
     */
    process(results) {
        // Update hidden state
        this.h = results.hn;
        this.c = results.cn;

        const probability = results.output.data[0];

        const wasSpseaking = this.isSpeaking;

        if (probability >= this.positiveThreshold) {
            this.isSpeaking = true;
            this.negativeSamples = 0;
        } else if (probability < this.negativeThreshold) {
            this.negativeSamples++;
            if (this.negativeSamples >= this.negativeCount) {
                this.isSpeaking = false;
            }
        }

        return {
            probability,
            isSpeaking: this.isSpeaking,
            justStarted: this.isSpeaking && !wasSpseaking,
            justEnded: !this.isSpeaking && wasSpseaking,
        };
    }

    /**
     * Reset VAD state
     */
    reset() {
        this.isSpeaking = false;
        this.negativeSamples = 0;
        this.h = null;
        this.c = null;
    }
}

export default VADProcessor;
