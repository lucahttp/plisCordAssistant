import { EventEmitter } from 'events';
import ort from 'onnxruntime-node';

// Speaker is optional - may not be available on all platforms
let Speaker = null;
try {
    Speaker = (await import('speaker')).default;
} catch {
    console.warn('[TTS] Speaker not available - audio playback disabled');
}

const SUPERTONIC_BASE = 'https://huggingface.co/Supertone/supertonic-2/resolve/main';

const VOICE_MAP = {
    'M1': 'M1.json', 'M2': 'M2.json', 'M3': 'M3.json', 'M4': 'M4.json', 'M5': 'M5.json',
    'F1': 'F1.json', 'F2': 'F2.json', 'F3': 'F3.json', 'F4': 'F4.json', 'F5': 'F5.json',
};

export class TextToSpeech extends EventEmitter {
    constructor(options = {}) {
        super();

        this.debug = options.debug || false;
        this.voice = options.voice || 'M3';
        this.caching = options.caching !== false;
        this.basePath = options.basePath || SUPERTONIC_BASE;

        // Models
        this.config = null;
        this.processor = null;
        this.sessions = null;
        this.voiceEmbeddings = {};

        // Audio output
        this.speaker = null;
        this.isPlaying = false;

        // Cache for common phrases
        this.audioCache = new Map();
        this.maxCacheSize = 50;

        this.isInitialized = false;
    }

    log(...args) {
        if (this.debug) {
            console.log('[TTS]', ...args);
        }
    }

    async downloadJson(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
        return response.json();
    }

    async downloadModel(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
        return new Uint8Array(await response.arrayBuffer());
    }

    async initialize() {
        if (this.isInitialized) return;

        this.log('Initializing Supertonic TTS...');

        const sessionOptions = {
            executionProviders: ['cpu'],
            graphOptimizationLevel: 'all',
        };

        // Load config
        this.log('Loading TTS config...');
        this.config = await this.downloadJson(`${this.basePath}/tts.json`);

        // Load unicode indexer
        this.log('Loading text processor...');
        const indexerData = await this.downloadJson(`${this.basePath}/unicode_indexer.json`);
        this.processor = new UnicodeProcessor(indexerData);

        // Load ONNX models
        this.log('Loading duration predictor...');
        const dpData = await this.downloadModel(`${this.basePath}/onnx/duration_predictor.onnx`);
        const dp = await ort.InferenceSession.create(dpData.buffer, sessionOptions);

        this.log('Loading text encoder...');
        const textEncData = await this.downloadModel(`${this.basePath}/onnx/text_encoder.onnx`);
        const textEnc = await ort.InferenceSession.create(textEncData.buffer, sessionOptions);

        this.log('Loading vector estimator...');
        const vectorEstData = await this.downloadModel(`${this.basePath}/onnx/vector_estimator.onnx`);
        const vectorEst = await ort.InferenceSession.create(vectorEstData.buffer, sessionOptions);

        this.log('Loading vocoder...');
        const vocoderData = await this.downloadModel(`${this.basePath}/onnx/vocoder.onnx`);
        const vocoder = await ort.InferenceSession.create(vocoderData.buffer, sessionOptions);

        this.sessions = { dp, textEnc, vectorEst, vocoder };

        // Load default voice
        await this.loadVoice(this.voice);

        this.isInitialized = true;
        this.log('TTS initialized');
    }

    async loadVoice(voiceId) {
        if (this.voiceEmbeddings[voiceId]) return;

        const filename = VOICE_MAP[voiceId];
        if (!filename) throw new Error(`Unknown voice: ${voiceId}`);

        this.log(`Loading voice: ${voiceId}`);
        const data = await this.downloadJson(`${this.basePath}/voice_styles/${filename}`);

        this.voiceEmbeddings[voiceId] = {
            styleTtl: new ort.Tensor(
                data.style_ttl.type || 'float32',
                Float32Array.from(data.style_ttl.data.flat(Infinity)),
                data.style_ttl.dims
            ),
            styleDp: new ort.Tensor(
                data.style_dp.type || 'float32',
                Float32Array.from(data.style_dp.data.flat(Infinity)),
                data.style_dp.dims
            ),
        };
    }

    /**
     * Generate audio from text
     * @param {string} text - Text to synthesize
     * @param {string} voiceId - Voice to use
     * @returns {Promise<{audio: Float32Array, sampleRate: number}>}
     */
    async generate(text, voiceId = null) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        voiceId = voiceId || this.voice;

        // Check cache
        const cacheKey = `${voiceId}:${text}`;
        if (this.caching && this.audioCache.has(cacheKey)) {
            this.log('Cache hit:', text.substring(0, 30));
            return this.audioCache.get(cacheKey);
        }

        await this.loadVoice(voiceId);
        const embeddings = this.voiceEmbeddings[voiceId];

        // Clean text
        const cleanText = text
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<\/?think>/gi, '')
            .trim();

        if (!cleanText) throw new Error('No text to synthesize');

        // Process text
        const { textIds, textMask } = this.processor.call([cleanText], 'en');
        const textIdsShape = [1, textIds[0].length];
        const textMaskShape = [1, 1, textMask[0][0].length];

        const textIdsTensor = new ort.Tensor(
            'int64',
            BigInt64Array.from(textIds.flat().map(x => BigInt(x))),
            textIdsShape
        );
        const textMaskTensor = new ort.Tensor(
            'float32',
            Float32Array.from(textMask.flat(Infinity)),
            textMaskShape
        );

        // Duration prediction
        const dpOut = await this.sessions.dp.run({
            text_ids: textIdsTensor,
            style_dp: embeddings.styleDp,
            text_mask: textMaskTensor,
        });

        // Text encoding
        const textEncOut = await this.sessions.textEnc.run({
            text_ids: textIdsTensor,
            style_ttl: embeddings.styleTtl,
            text_mask: textMaskTensor,
        });

        // Sample noisy latent
        const durOnnx = Array.from(dpOut.duration.data);
        const { noisyLatent, latentMask } = this.sampleNoisyLatent([[[durOnnx[0]]]]);

        const latentDim = noisyLatent[0].length;
        const latentLen = noisyLatent[0][0].length;
        const latentShape = [1, latentDim, latentLen];

        const latentBuffer = new Float32Array(latentDim * latentLen);
        let idx = 0;
        for (let d = 0; d < latentDim; d++) {
            for (let t = 0; t < latentLen; t++) {
                latentBuffer[idx++] = noisyLatent[0][d][t];
            }
        }

        // Denoising loop
        const totalStep = 10;
        const latentMaskTensor = new ort.Tensor(
            'float32',
            Float32Array.from(latentMask.flat(Infinity)),
            [1, 1, latentMask[0][0].length]
        );

        for (let step = 0; step < totalStep; step++) {
            const currentStepTensor = new ort.Tensor('float32', Float32Array.from([step]), [1]);
            const totalStepTensor = new ort.Tensor('float32', Float32Array.from([totalStep]), [1]);
            const noisyLatentTensor = new ort.Tensor('float32', latentBuffer, latentShape);

            const out = await this.sessions.vectorEst.run({
                noisy_latent: noisyLatentTensor,
                text_emb: textEncOut.text_emb,
                style_ttl: embeddings.styleTtl,
                text_mask: textMaskTensor,
                latent_mask: latentMaskTensor,
                total_step: totalStepTensor,
                current_step: currentStepTensor,
            });
            latentBuffer.set(out.denoised_latent.data);
        }

        // Vocoder
        const vocoderLatentTensor = new ort.Tensor('float32', latentBuffer, latentShape);
        const vocoderOut = await this.sessions.vocoder.run({
            latent: vocoderLatentTensor,
        });

        const wavBatch = vocoderOut.wav_tts.data;
        const sampleRate = this.config.ae.sample_rate;
        const wavLen = Math.floor(sampleRate * durOnnx[0]);

        const result = {
            audio: wavBatch.slice(0, wavLen),
            sampleRate,
        };

        // Cache result
        if (this.caching) {
            this.audioCache.set(cacheKey, result);
            if (this.audioCache.size > this.maxCacheSize) {
                const firstKey = this.audioCache.keys().next().value;
                this.audioCache.delete(firstKey);
            }
        }

        return result;
    }

    sampleNoisyLatent(duration) {
        const sampleRate = this.config.ae.sample_rate;
        const baseChunkSize = this.config.ae.base_chunk_size;
        const chunkCompressFactor = this.config.ttl.chunk_compress_factor;
        const ldim = this.config.ttl.latent_dim;

        const wavLenMax = Math.max(...duration.map(d => d[0][0])) * sampleRate;
        const wavLengths = duration.map(d => Math.floor(d[0][0] * sampleRate));
        const chunkSize = baseChunkSize * chunkCompressFactor;
        const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
        const latentDim = ldim * chunkCompressFactor;

        const noisyLatent = [];
        for (let b = 0; b < duration.length; b++) {
            const batch = [];
            for (let d = 0; d < latentDim; d++) {
                const row = [];
                for (let t = 0; t < latentLen; t++) {
                    const u1 = Math.random();
                    const u2 = Math.random();
                    row.push(Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2));
                }
                batch.push(row);
            }
            noisyLatent.push(batch);
        }

        const latentMask = this.getLatentMask(wavLengths);
        for (let b = 0; b < noisyLatent.length; b++) {
            for (let d = 0; d < noisyLatent[b].length; d++) {
                for (let t = 0; t < noisyLatent[b][d].length; t++) {
                    noisyLatent[b][d][t] *= latentMask[b][0][t];
                }
            }
        }

        return { noisyLatent, latentMask };
    }

    getLatentMask(wavLengths) {
        const baseChunkSize = this.config.ae.base_chunk_size;
        const chunkCompressFactor = this.config.ttl.chunk_compress_factor;
        const latentSize = baseChunkSize * chunkCompressFactor;
        const latentLengths = wavLengths.map(len => Math.floor((len + latentSize - 1) / latentSize));
        return this.lengthToMask(latentLengths);
    }

    lengthToMask(lengths, maxLen = null) {
        maxLen = maxLen || Math.max(...lengths);
        const mask = [];
        for (let i = 0; i < lengths.length; i++) {
            const row = [];
            for (let j = 0; j < maxLen; j++) {
                row.push(j < lengths[i] ? 1.0 : 0.0);
            }
            mask.push([row]);
        }
        return mask;
    }

    /**
     * Speak text through audio output
     */
    async speak(text, voiceId = null) {
        const { audio, sampleRate } = await this.generate(text, voiceId);
        await this.playAudio(audio, sampleRate);
    }

    /**
     * Play audio through speaker
     */
    async playAudio(audio, sampleRate) {
        // If Speaker isn't available, just return the audio data
        if (!Speaker) {
            this.log('Speaker not available - returning audio data');
            this.emit('audioData', { audio, sampleRate });
            return { audio, sampleRate };
        }

        return new Promise((resolve, reject) => {
            this.isPlaying = true;
            this.emit('start');

            // Convert Float32Array to Int16 for speaker
            const buffer = Buffer.alloc(audio.length * 2);
            for (let i = 0; i < audio.length; i++) {
                const sample = Math.max(-1, Math.min(1, audio[i]));
                buffer.writeInt16LE(Math.floor(sample * 32767), i * 2);
            }

            this.speaker = new Speaker({
                channels: 1,
                bitDepth: 16,
                sampleRate: sampleRate,
            });

            this.speaker.on('close', () => {
                this.isPlaying = false;
                this.emit('end');
                resolve();
            });

            this.speaker.on('error', (err) => {
                this.isPlaying = false;
                reject(err);
            });

            this.speaker.write(buffer);
            this.speaker.end();
        });
    }

    /**
     * Stop current playback
     */
    stop() {
        if (this.speaker) {
            this.speaker.end();
            this.speaker = null;
        }
        this.isPlaying = false;
    }

    async dispose() {
        this.stop();
        await this.sessions?.dp?.release();
        await this.sessions?.textEnc?.release();
        await this.sessions?.vectorEst?.release();
        await this.sessions?.vocoder?.release();
        this.isInitialized = false;
    }
}

/**
 * Unicode text processor for Supertonic
 */
class UnicodeProcessor {
    constructor(indexer) {
        this.indexer = indexer;
    }

    call(textList, lang = null) {
        const processedTexts = textList.map(t => this.preprocessText(t, lang));
        const textIdsLengths = processedTexts.map(t => t.length);
        const maxLen = Math.max(...textIdsLengths);

        const textIds = [];
        for (let i = 0; i < processedTexts.length; i++) {
            const row = new Array(maxLen).fill(0);
            for (let j = 0; j < processedTexts[i].length; j++) {
                const charCode = processedTexts[i].charCodeAt(j);
                row[j] = this.indexer[charCode] ?? 0;
            }
            textIds.push(row);
        }

        const textMask = this.getTextMask(textIdsLengths);
        return { textIds, textMask };
    }

    preprocessText(text, lang = null) {
        text = text.normalize('NFKD');
        // Remove emojis
        text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]+/gu, '');

        const replacements = {
            '–': '-', '—': '-', '_': ' ', '"': '"', '"': '"', ''': "'", ''': "'",
        };
        for (const [k, v] of Object.entries(replacements)) {
            text = text.replaceAll(k, v);
        }

        text = text.replace(/\s+/g, ' ').trim();
        if (!/[.!?;:,'")}\]…]$/.test(text) && text.length > 0) {
            text += '.';
        }

        if (lang) {
            text = `<${lang}>` + text + `</${lang}>`;
        } else {
            text = '<na>' + text + '</na>';
        }

        return text;
    }

    getTextMask(lengths, maxLen = null) {
        maxLen = maxLen || Math.max(...lengths);
        const mask = [];
        for (let i = 0; i < lengths.length; i++) {
            const row = [];
            for (let j = 0; j < maxLen; j++) {
                row.push(j < lengths[i] ? 1.0 : 0.0);
            }
            mask.push([row]);
        }
        return mask;
    }
}

export default TextToSpeech;
