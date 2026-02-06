/**
 * Speech-to-Text using Whisper ONNX
 * Optimized for low-latency, low-resource transcription
 */

import { EventEmitter } from 'events';
import { pipeline } from '@huggingface/transformers';

// Model configurations based on performance needs
const WHISPER_MODELS = {
    'whisper-tiny': {
        model: 'Xenova/whisper-tiny.en',
        description: 'Fastest, ~39M params, English only',
    },
    'whisper-base': {
        model: 'Xenova/whisper-base',
        description: 'Good balance, ~74M params, multilingual',
    },
    'whisper-small': {
        model: 'Xenova/whisper-small',
        description: 'Better quality, ~244M params',
    },
};

export class SpeechToText extends EventEmitter {
    constructor(options = {}) {
        super();

        this.debug = options.debug || false;
        this.modelName = options.model || 'whisper-tiny';
        this.quantized = options.quantized !== false;
        this.language = options.language || 'en';

        this.transcriber = null;
        this.isInitialized = false;
    }

    log(...args) {
        if (this.debug) {
            console.log('[STT]', ...args);
        }
    }

    async initialize() {
        if (this.isInitialized) return;

        const modelConfig = WHISPER_MODELS[this.modelName];
        if (!modelConfig) {
            throw new Error(`Unknown Whisper model: ${this.modelName}`);
        }

        this.log(`Loading ${this.modelName}...`);

        try {
            // Use transformers.js for Whisper inference
            this.transcriber = await pipeline(
                'automatic-speech-recognition',
                modelConfig.model,
                {
                    quantized: this.quantized,
                    progress_callback: (progress) => {
                        this.emit('progress', progress);
                        if (progress.status === 'progress') {
                            this.log(`Loading: ${progress.progress?.toFixed(1)}%`);
                        }
                    },
                }
            );

            this.isInitialized = true;
            this.log('STT initialized');

        } catch (error) {
            this.log('Failed to initialize STT:', error);
            throw error;
        }
    }

    /**
     * Transcribe audio samples
     * @param {Float32Array} audio - Audio samples at 16kHz
     * @param {Object} options - Transcription options
     * @returns {Promise<string>} Transcription text
     */
    async transcribe(audio, options = {}) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const startTime = performance.now();

        this.emit('start');

        try {
            const result = await this.transcriber(audio, {
                language: options.language || this.language,
                task: 'transcribe',
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: false,
            });

            const elapsed = performance.now() - startTime;
            this.log(`Transcription took ${elapsed.toFixed(0)}ms:`, result.text);

            this.emit('complete', {
                text: result.text,
                duration: elapsed,
            });

            return result.text;

        } catch (error) {
            this.log('Transcription error:', error);
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Transcribe with streaming output
     * Calls callback with partial results
     */
    async transcribeStreaming(audio, callback) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        this.emit('start');

        try {
            const result = await this.transcriber(audio, {
                language: this.language,
                task: 'transcribe',
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: true,
                // Stream chunks
                callback_function: (chunk) => {
                    if (callback) {
                        callback(chunk.text, chunk.timestamp);
                    }
                    this.emit('chunk', chunk);
                },
            });

            this.emit('complete', { text: result.text });
            return result.text;

        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    async dispose() {
        this.transcriber = null;
        this.isInitialized = false;
    }
}

export default SpeechToText;
