/**
 * Wake Word Detector
 * Based on HeyBuddy - lightweight wake word detection using ONNX models
 * Optimized for low-resource environments
 */

import { EventEmitter } from 'events';
import ort from 'onnxruntime-node';
import { VADProcessor } from './vad.js';

// Model URLs from HeyBuddy repository
const HEYBUDDY_BASE = 'https://huggingface.co/benjamin-paine/hey-buddy/resolve/main';

const WAKE_WORD_MODELS = {
    'hey-buddy': `${HEYBUDDY_BASE}/models/hey-buddy.onnx`,
    'ok-buddy': `${HEYBUDDY_BASE}/models/okay-buddy.onnx`,
    'hi-buddy': `${HEYBUDDY_BASE}/models/hi-buddy.onnx`,
};

const PRETRAINED_MODELS = {
    vad: `${HEYBUDDY_BASE}/pretrained/silero-vad.onnx`,
    spectrogram: `${HEYBUDDY_BASE}/pretrained/mel-spectrogram.onnx`,
    embedding: `${HEYBUDDY_BASE}/pretrained/speech-embedding.onnx`,
};

export class WakeWordDetector extends EventEmitter {
    constructor(options = {}) {
        super();

        this.debug = options.debug || false;
        this.wakeWord = options.wakeWord || 'hey-buddy';
        this.threshold = options.threshold || 0.5;
        this.cooldownMs = options.cooldownMs || 2000;

        // Sample rate
        this.sampleRate = 16000;
        this.batchSamples = Math.floor(this.sampleRate * 1.08); // ~1 second batches
        this.batchInterval = Math.floor(this.sampleRate * 0.12); // 120ms intervals

        // State
        this.isInitialized = false;
        this.isRunning = false;
        this.isPaused = false;
        this.isRecording = false;
        this.lastWakeWordTime = 0;

        // Audio buffer
        this.audioBuffer = new Float32Array(0);
        this.recordingBuffer = null;

        // ONNX sessions
        this.vadSession = null;
        this.spectrogramSession = null;
        this.embeddingSession = null;
        this.wakeWordSession = null;

        // VAD processor
        this.vad = new VADProcessor({
            positiveThreshold: 0.65,
            negativeThreshold: 0.4,
            negativeCount: 8,
        });

        // Embedding buffer for wake word detection
        this.embeddingBuffer = [];
        this.embeddingFrames = 16;

        this.speechProbability = 0;
    }

    log(...args) {
        if (this.debug) {
            console.log('[WakeWord]', ...args);
        }
    }

    async downloadModel(url) {
        this.log('Downloading model:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download model: ${response.statusText}`);
        }
        return new Uint8Array(await response.arrayBuffer());
    }

    async initialize() {
        if (this.isInitialized) return;

        this.log('Initializing wake word detector...');

        const sessionOptions = {
            executionProviders: ['cpu'], // CPU for potato mode
            graphOptimizationLevel: 'all',
        };

        // Load VAD model
        this.log('Loading VAD model...');
        const vadData = await this.downloadModel(PRETRAINED_MODELS.vad);
        this.vadSession = await ort.InferenceSession.create(vadData.buffer, sessionOptions);

        // Load Mel Spectrogram model
        this.log('Loading spectrogram model...');
        const specData = await this.downloadModel(PRETRAINED_MODELS.spectrogram);
        this.spectrogramSession = await ort.InferenceSession.create(specData.buffer, sessionOptions);

        // Load Speech Embedding model
        this.log('Loading embedding model...');
        const embData = await this.downloadModel(PRETRAINED_MODELS.embedding);
        this.embeddingSession = await ort.InferenceSession.create(embData.buffer, sessionOptions);

        // Load Wake Word model
        const wakeWordUrl = WAKE_WORD_MODELS[this.wakeWord];
        if (!wakeWordUrl) {
            throw new Error(`Unknown wake word: ${this.wakeWord}`);
        }
        this.log('Loading wake word model:', this.wakeWord);
        const wwData = await this.downloadModel(wakeWordUrl);
        this.wakeWordSession = await ort.InferenceSession.create(wwData.buffer, sessionOptions);

        this.isInitialized = true;
        this.log('Wake word detector initialized');
    }

    start(audioSource) {
        if (!this.isInitialized) {
            throw new Error('Wake word detector not initialized');
        }

        this.isRunning = true;
        this.audioSource = audioSource;

        // Process audio chunks from source
        audioSource.on('data', (chunk) => this.processAudioChunk(chunk));

        this.log('Wake word detection started');
    }

    stop() {
        this.isRunning = false;
        this.audioSource?.removeAllListeners('data');
        this.log('Wake word detection stopped');
    }

    pause() {
        this.isPaused = true;
    }

    resume() {
        this.isPaused = false;
        this.isRecording = false;
        this.recordingBuffer = null;
    }

    /**
     * Process incoming audio chunk
     * @param {Buffer|Float32Array} chunk - Audio samples
     */
    async processAudioChunk(chunk) {
        if (!this.isRunning || this.isPaused) return;

        // Convert Buffer to Float32Array if needed
        let samples;
        if (Buffer.isBuffer(chunk)) {
            // Assume 16-bit PCM
            samples = new Float32Array(chunk.length / 2);
            for (let i = 0; i < samples.length; i++) {
                samples[i] = chunk.readInt16LE(i * 2) / 32768.0;
            }
        } else {
            samples = chunk;
        }

        // Add to audio buffer
        const newBuffer = new Float32Array(this.audioBuffer.length + samples.length);
        newBuffer.set(this.audioBuffer);
        newBuffer.set(samples, this.audioBuffer.length);
        this.audioBuffer = newBuffer;

        // If recording after wake word, accumulate audio
        if (this.isRecording) {
            if (!this.recordingBuffer) {
                this.recordingBuffer = new Float32Array(0);
            }
            const newRecording = new Float32Array(this.recordingBuffer.length + samples.length);
            newRecording.set(this.recordingBuffer);
            newRecording.set(samples, this.recordingBuffer.length);
            this.recordingBuffer = newRecording;
        }

        // Process when we have enough samples
        while (this.audioBuffer.length >= this.batchSamples) {
            const batch = this.audioBuffer.slice(0, this.batchSamples);
            this.audioBuffer = this.audioBuffer.slice(this.batchInterval);

            await this.processBatch(batch);
        }
    }

    /**
     * Process a batch of audio for wake word detection
     */
    async processBatch(audio) {
        try {
            // 1. VAD - Check if speech is present
            const vadResult = await this.runVAD(audio);
            this.speechProbability = vadResult.probability;

            this.emit('vad', {
                probability: vadResult.probability,
                isSpeaking: vadResult.isSpeaking,
            });

            // Handle speech start/end
            if (vadResult.justStarted) {
                this.emit('speechStart');
            }
            if (vadResult.justEnded) {
                this.emit('speechEnd', this.recordingBuffer);
                this.recordingBuffer = null;
            }

            // Only process wake word if speaking
            if (!vadResult.isSpeaking) return;

            // 2. Compute mel spectrogram
            const spectrogram = await this.runSpectrogram(audio);

            // 3. Get speech embedding
            const embedding = await this.runEmbedding(spectrogram);

            // 4. Add to embedding buffer
            this.embeddingBuffer.push(embedding);
            if (this.embeddingBuffer.length > this.embeddingFrames) {
                this.embeddingBuffer.shift();
            }

            // 5. Check wake word (need full buffer)
            if (this.embeddingBuffer.length >= this.embeddingFrames) {
                const detected = await this.checkWakeWord();

                if (detected) {
                    const now = Date.now();
                    if (now - this.lastWakeWordTime >= this.cooldownMs) {
                        this.lastWakeWordTime = now;
                        this.isRecording = true;
                        this.recordingBuffer = new Float32Array(audio);
                        this.emit('detected');
                    }
                }
            }

        } catch (error) {
            this.log('Batch processing error:', error);
        }
    }

    /**
     * Run Voice Activity Detection
     */
    async runVAD(audio) {
        const inputTensor = new ort.Tensor('float32', audio, [1, audio.length]);

        // Silero VAD expects specific input format
        const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(this.sampleRate)]), []);

        const feeds = {
            input: inputTensor,
            sr: sr,
            ...this.vad.getState(),
        };

        const results = await this.vadSession.run(feeds);
        return this.vad.process(results);
    }

    /**
     * Compute mel spectrogram from audio
     */
    async runSpectrogram(audio) {
        const inputTensor = new ort.Tensor('float32', audio, [1, audio.length]);
        const results = await this.spectrogramSession.run({ audio: inputTensor });
        return results.mel_spectrogram;
    }

    /**
     * Get speech embedding from spectrogram
     */
    async runEmbedding(spectrogram) {
        const results = await this.embeddingSession.run({ mel_spectrogram: spectrogram });
        return results.embedding;
    }

    /**
     * Check if wake word was spoken
     */
    async checkWakeWord() {
        // Combine embeddings into single tensor
        const combinedDims = [this.embeddingFrames, this.embeddingBuffer[0].dims[1]];
        const combinedData = new Float32Array(combinedDims[0] * combinedDims[1]);

        for (let i = 0; i < this.embeddingBuffer.length; i++) {
            combinedData.set(this.embeddingBuffer[i].data, i * this.embeddingBuffer[0].dims[1]);
        }

        const embeddingTensor = new ort.Tensor('float32', combinedData, combinedDims);

        const results = await this.wakeWordSession.run({ embedding: embeddingTensor });
        const probability = results.probability.data[0];

        this.log(`Wake word probability: ${probability.toFixed(3)}`);

        return probability >= this.threshold;
    }

    async dispose() {
        this.stop();
        await this.vadSession?.release();
        await this.spectrogramSession?.release();
        await this.embeddingSession?.release();
        await this.wakeWordSession?.release();
        this.isInitialized = false;
    }
}

export default WakeWordDetector;
