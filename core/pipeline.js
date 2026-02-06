/**
 * PlisCord Assistant - Core Voice Pipeline
 * Orchestrates: Wake Word → STT → Function Calling → TTS
 * 
 * Designed to be ultra-performant for potato PCs
 */

import { EventEmitter } from 'events';
import { WakeWordDetector } from './wakeword/detector.js';
import { SpeechToText } from './stt/whisper.js';
import { FunctionCaller } from './function-caller/gemma.js';
import { TextToSpeech } from './tts/supertonic.js';

/**
 * @typedef {Object} PipelineOptions
 * @property {'potato'|'balanced'|'quality'} performanceMode - Resource usage mode
 * @property {string} wakeWord - Wake word to listen for
 * @property {string} ttsVoice - TTS voice ID
 * @property {boolean} debug - Enable debug logging
 * @property {Object} tools - Available tool functions
 */

/**
 * @typedef {Object} PipelineState
 * @property {'idle'|'listening'|'recording'|'transcribing'|'processing'|'speaking'} state
 * @property {number} speechProbability - Current speech probability
 * @property {string} transcript - Current transcription
 * @property {Object} lastIntent - Last detected intent
 */

export class VoicePipeline extends EventEmitter {
    /**
     * @param {PipelineOptions} options
     */
    constructor(options = {}) {
        super();
        
        this.debug = options.debug || false;
        this.performanceMode = options.performanceMode || 'potato';
        this.wakeWord = options.wakeWord || 'hey-buddy';
        this.ttsVoice = options.ttsVoice || 'M3';
        this.tools = options.tools || {};
        
        // State
        this.state = 'idle';
        this.isInitialized = false;
        this.isPaused = false;
        
        // Components (lazy-loaded for performance)
        this.wakeWordDetector = null;
        this.stt = null;
        this.functionCaller = null;
        this.tts = null;
        
        // Audio buffer for recording after wake word
        this.audioBuffer = [];
        this.maxRecordingMs = 10000; // Max 10 seconds per command
        
        this.log('Pipeline created with mode:', this.performanceMode);
    }

    log(...args) {
        if (this.debug) {
            console.log('[Pipeline]', ...args);
        }
    }

    /**
     * Get performance configuration based on mode
     */
    getPerformanceConfig() {
        const configs = {
            potato: {
                whisperModel: 'whisper-tiny',
                whisperQuantized: true,
                functionGemmaQuantized: true,
                vadBufferMs: 500,
                sampleRate: 16000,
                ttsCaching: true,
            },
            balanced: {
                whisperModel: 'whisper-base',
                whisperQuantized: true,
                functionGemmaQuantized: false,
                vadBufferMs: 300,
                sampleRate: 16000,
                ttsCaching: true,
            },
            quality: {
                whisperModel: 'whisper-small',
                whisperQuantized: false,
                functionGemmaQuantized: false,
                vadBufferMs: 200,
                sampleRate: 16000,
                ttsCaching: false,
            },
        };
        return configs[this.performanceMode] || configs.potato;
    }

    /**
     * Initialize all components
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.isInitialized) return;
        
        const config = this.getPerformanceConfig();
        this.log('Initializing with config:', config);
        
        this.emit('status', { stage: 'init', message: 'Loading wake word detector...' });
        
        // 1. Wake Word Detector (lightweight, loads first)
        this.wakeWordDetector = new WakeWordDetector({
            wakeWord: this.wakeWord,
            debug: this.debug,
        });
        await this.wakeWordDetector.initialize();
        
        this.wakeWordDetector.on('detected', () => this.onWakeWordDetected());
        this.wakeWordDetector.on('speechStart', () => this.emit('speechStart'));
        this.wakeWordDetector.on('speechEnd', (audio) => this.onSpeechEnd(audio));
        this.wakeWordDetector.on('vad', (data) => this.emit('vad', data));
        
        this.emit('status', { stage: 'init', message: 'Loading speech recognition...' });
        
        // 2. Speech-to-Text (Whisper)
        this.stt = new SpeechToText({
            model: config.whisperModel,
            quantized: config.whisperQuantized,
            debug: this.debug,
        });
        await this.stt.initialize();
        
        this.emit('status', { stage: 'init', message: 'Loading intent recognition...' });
        
        // 3. Function Caller (FunctionGemma)
        this.functionCaller = new FunctionCaller({
            quantized: config.functionGemmaQuantized,
            tools: this.tools,
            debug: this.debug,
        });
        await this.functionCaller.initialize();
        
        this.emit('status', { stage: 'init', message: 'Loading text-to-speech...' });
        
        // 4. Text-to-Speech (Supertonic)
        this.tts = new TextToSpeech({
            voice: this.ttsVoice,
            caching: config.ttsCaching,
            debug: this.debug,
        });
        await this.tts.initialize();
        
        this.isInitialized = true;
        this.state = 'idle';
        this.emit('ready');
        this.log('Pipeline initialized');
    }

    /**
     * Start listening for wake word
     * @param {Object} audioSource - Audio input source
     */
    async start(audioSource) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        this.state = 'listening';
        this.emit('stateChange', this.state);
        
        // Connect audio source to wake word detector
        this.wakeWordDetector.start(audioSource);
        this.log('Pipeline started, listening for wake word...');
    }

    /**
     * Stop the pipeline
     */
    stop() {
        this.wakeWordDetector?.stop();
        this.tts?.stop();
        this.state = 'idle';
        this.emit('stateChange', this.state);
        this.log('Pipeline stopped');
    }

    /**
     * Pause listening (e.g., while processing)
     */
    pause() {
        this.isPaused = true;
        this.wakeWordDetector?.pause();
    }

    /**
     * Resume listening
     */
    resume() {
        this.isPaused = false;
        this.wakeWordDetector?.resume();
        this.state = 'listening';
        this.emit('stateChange', this.state);
    }

    /**
     * Handle wake word detection
     */
    onWakeWordDetected() {
        this.log('Wake word detected!');
        this.state = 'recording';
        this.emit('stateChange', this.state);
        this.emit('wakeWord');
        
        // Play acknowledgment sound (optional)
        // this.tts.playAcknowledgment();
    }

    /**
     * Handle speech end (recording complete)
     * @param {Float32Array} audio - Recorded audio samples
     */
    async onSpeechEnd(audio) {
        if (this.state !== 'recording') return;
        
        this.log('Speech ended, processing...');
        this.pause();
        
        try {
            // 1. Transcribe
            this.state = 'transcribing';
            this.emit('stateChange', this.state);
            
            const transcript = await this.stt.transcribe(audio);
            this.log('Transcript:', transcript);
            this.emit('transcript', transcript);
            
            if (!transcript || transcript.trim().length === 0) {
                this.log('Empty transcript, resuming...');
                this.resume();
                return;
            }
            
            // 2. Process intent and call function
            this.state = 'processing';
            this.emit('stateChange', this.state);
            
            const result = await this.functionCaller.process(transcript);
            this.log('Function result:', result);
            this.emit('intent', result);
            
            // 3. Speak response
            if (result.response) {
                this.state = 'speaking';
                this.emit('stateChange', this.state);
                
                await this.tts.speak(result.response);
            }
            
        } catch (error) {
            this.log('Processing error:', error);
            this.emit('error', error);
        }
        
        // Resume listening
        this.resume();
    }

    /**
     * Process text input directly (skip wake word and STT)
     * Useful for text commands or testing
     * 
     * @param {string} text - Input text
     * @returns {Promise<Object>} Function call result
     */
    async processText(text) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        const result = await this.functionCaller.process(text);
        
        if (result.response) {
            await this.tts.speak(result.response);
        }
        
        return result;
    }

    /**
     * Register a new tool function
     * 
     * @param {string} name - Tool name
     * @param {Object} schema - JSON schema for parameters
     * @param {Function} handler - Tool implementation
     */
    registerTool(name, schema, handler) {
        this.tools[name] = { schema, handler };
        this.functionCaller?.registerTool(name, schema, handler);
    }

    /**
     * Get current pipeline state
     * @returns {PipelineState}
     */
    getState() {
        return {
            state: this.state,
            speechProbability: this.wakeWordDetector?.speechProbability || 0,
            isInitialized: this.isInitialized,
            isPaused: this.isPaused,
        };
    }

    /**
     * Cleanup resources
     */
    async dispose() {
        this.stop();
        await this.wakeWordDetector?.dispose();
        await this.stt?.dispose();
        await this.functionCaller?.dispose();
        await this.tts?.dispose();
        this.isInitialized = false;
        this.log('Pipeline disposed');
    }
}

export default VoicePipeline;
