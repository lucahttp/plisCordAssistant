/**
 * PlisCord Driving Assistant
 * Ultra-lightweight voice assistant for car PCs
 * 
 * Features:
 * - Minimal resource usage (potato mode)
 * - Headless operation
 * - System audio I/O
 * - Navigation integration
 * - Media controls
 */

import 'dotenv/config';
import { VoicePipeline } from '../core/pipeline.js';
import { createTools } from '../tools/definitions.js';
import { YouTubeTool } from '../tools/youtube.js';
import { exec } from 'child_process';
import mic from 'mic';
import Speaker from 'speaker';
import chalk from 'chalk';

// Configuration for driving mode
const config = {
    wakeWord: process.env.WAKE_WORD || 'ok-computer',
    ttsVoice: process.env.TTS_VOICE || 'M3',
    audioDevice: process.env.AUDIO_DEVICE || 'default',
    debug: process.env.DEBUG === 'true',

    // Driving-specific optimizations
    performanceMode: 'potato', // Always potato for driving
    sampleRate: 16000,
    channels: 1,
    bitDepth: 16,

    // Saved locations
    homeAddress: process.env.HOME_ADDRESS || '',
    workAddress: process.env.WORK_ADDRESS || '',
};

class DrivingAssistant {
    constructor() {
        this.pipeline = null;
        this.microphone = null;
        this.speaker = null;
        this.youtube = new YouTubeTool({ debug: config.debug });

        this.isListening = false;
    }

    log(...args) {
        console.log(chalk.green('🚗'), ...args);
    }

    error(...args) {
        console.error(chalk.red('❌'), ...args);
    }

    status(...args) {
        console.log(chalk.yellow('📡'), ...args);
    }

    /**
     * Initialize the driving assistant
     */
    async initialize() {
        this.log('Starting Driving Assistant...');
        this.log(`Performance mode: ${chalk.yellow(config.performanceMode)}`);
        this.log(`Wake word: ${chalk.cyan(config.wakeWord)}`);

        // Create tool handlers for driving mode
        const handlers = {
            play_youtube: async (params) => {
                const result = await this.youtube.play(params);
                if (result.track) {
                    // In driving mode, we'd play through system audio
                    this.log(`Would play: ${result.track.title}`);
                }
                return result;
            },

            media_control: async (params) => {
                return this.youtube.mediaControl(params.action);
            },

            navigate: async (params) => {
                return this.startNavigation(params.destination);
            },

            search_web: async (params) => {
                // Simplified search for driving - just acknowledge
                return {
                    response: `I'll remember to search for ${params.query} when we stop.`,
                };
            },
        };

        const tools = createTools(handlers);

        // Create pipeline with potato settings
        this.pipeline = new VoicePipeline({
            performanceMode: config.performanceMode,
            wakeWord: config.wakeWord,
            ttsVoice: config.ttsVoice,
            tools,
            debug: config.debug,
        });

        // Setup event handlers
        this.setupPipelineEvents();

        // Initialize pipeline
        this.status('Loading AI models (this may take a minute)...');
        await this.pipeline.initialize();

        this.log(chalk.green('✓') + ' Driving Assistant ready!');
    }

    /**
     * Setup pipeline event handlers
     */
    setupPipelineEvents() {
        this.pipeline.on('stateChange', (state) => {
            if (state === 'listening') {
                // Show subtle indicator
            } else if (state === 'recording') {
                this.status('Listening...');
            }
        });

        this.pipeline.on('wakeWord', () => {
            this.log(chalk.yellow('🎤 Wake word detected!'));
            // Could trigger a beep here
        });

        this.pipeline.on('transcript', (text) => {
            this.log(chalk.cyan('Heard:'), text);
        });

        this.pipeline.on('intent', (result) => {
            if (result.function) {
                this.log(chalk.green('Action:'), result.function);
            }
            if (result.response) {
                this.log(chalk.blue('Response:'), result.response);
            }
        });

        this.pipeline.on('error', (error) => {
            this.error('Pipeline error:', error.message);
        });
    }

    /**
     * Start navigation to a destination
     */
    async startNavigation(destination) {
        let address = destination;

        // Handle shortcuts
        if (destination.toLowerCase() === 'home') {
            address = config.homeAddress || destination;
        } else if (destination.toLowerCase() === 'work') {
            address = config.workAddress || destination;
        }

        this.log(`Starting navigation to: ${address}`);

        // Try to open system navigation
        // This will vary by platform and installed apps
        try {
            const encodedAddress = encodeURIComponent(address);

            // Try Google Maps URL (opens in browser or app)
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`;

            // Platform-specific open command
            const openCmd = process.platform === 'win32' ? 'start' :
                process.platform === 'darwin' ? 'open' : 'xdg-open';

            exec(`${openCmd} "${mapsUrl}"`, (error) => {
                if (error) {
                    this.error('Failed to open navigation:', error.message);
                }
            });

            return {
                response: `Starting navigation to ${destination}.`,
            };
        } catch (error) {
            return {
                response: `I couldn't start navigation, but your destination is ${destination}.`,
            };
        }
    }

    /**
     * Initialize system microphone
     */
    initMicrophone() {
        this.microphone = mic({
            rate: config.sampleRate.toString(),
            channels: config.channels.toString(),
            bitwidth: config.bitDepth.toString(),
            device: config.audioDevice,
            encoding: 'signed-integer',
            endian: 'little',
        });

        return this.microphone.getAudioStream();
    }

    /**
     * Start listening
     */
    async start() {
        await this.initialize();

        this.log('Starting microphone...');
        const audioStream = this.initMicrophone();

        // Create an event-based audio source for the pipeline
        const audioSource = {
            on: (event, callback) => {
                if (event === 'data') {
                    audioStream.on('data', callback);
                }
            },
            removeAllListeners: () => audioStream.removeAllListeners(),
        };

        // Start the pipeline
        await this.pipeline.start(audioSource);

        // Start the microphone
        this.microphone.start();
        this.isListening = true;

        this.log('Listening for wake word...');
        this.log(chalk.gray(`Say "${config.wakeWord}" to activate`));
        this.log(chalk.gray('Press Ctrl+C to exit'));

        // Display status periodically
        this.startStatusDisplay();
    }

    /**
     * Show periodic status updates
     */
    startStatusDisplay() {
        setInterval(() => {
            if (!this.isListening) return;

            const state = this.pipeline.getState();
            const mem = process.memoryUsage();
            const memMB = Math.round(mem.rss / 1024 / 1024);

            // Only show if not actively processing
            if (state.state === 'listening' && config.debug) {
                process.stdout.write(chalk.gray(`\r[State: ${state.state}] [Memory: ${memMB}MB] [Speech: ${(state.speechProbability * 100).toFixed(0)}%]   `));
            }
        }, 2000);
    }

    /**
     * Stop the assistant
     */
    async stop() {
        this.isListening = false;

        if (this.microphone) {
            this.microphone.stop();
        }

        if (this.pipeline) {
            await this.pipeline.dispose();
        }

        this.log('Driving Assistant stopped');
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n');
    await assistant.stop();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error(chalk.red('Uncaught error:'), error);
});

// Start the assistant
const assistant = new DrivingAssistant();

console.log(chalk.bold.green(`
╔═══════════════════════════════════════╗
║     🚗 PlisCord Driving Assistant     ║
║       Ultra-lightweight Mode          ║
╚═══════════════════════════════════════╝
`));

assistant.start().catch((error) => {
    console.error(chalk.red('Failed to start:'), error);
    process.exit(1);
});
