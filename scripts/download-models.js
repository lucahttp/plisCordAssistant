/**
 * Model Download Script
 * Downloads all required AI models for offline operation
 */

import { mkdir, writeFile, access } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';

const MODELS_DIR = './models';

// Model URLs
const MODELS = {
    // Wake Word models from HeyBuddy
    wakeword: {
        'hey-buddy': 'https://huggingface.co/benjamin-paine/hey-buddy/resolve/main/models/hey-buddy.onnx',
        'ok-buddy': 'https://huggingface.co/benjamin-paine/hey-buddy/resolve/main/models/okay-buddy.onnx',
        'hi-buddy': 'https://huggingface.co/benjamin-paine/hey-buddy/resolve/main/models/hi-buddy.onnx',
    },

    // Pretrained models for wake word detection
    pretrained: {
        'silero-vad': 'https://huggingface.co/benjamin-paine/hey-buddy/resolve/main/pretrained/silero-vad.onnx',
        'mel-spectrogram': 'https://huggingface.co/benjamin-paine/hey-buddy/resolve/main/pretrained/mel-spectrogram.onnx',
        'speech-embedding': 'https://huggingface.co/benjamin-paine/hey-buddy/resolve/main/pretrained/speech-embedding.onnx',
    },

    // Supertonic TTS
    tts: {
        config: 'https://huggingface.co/Supertone/supertonic-2/resolve/main/tts.json',
        indexer: 'https://huggingface.co/Supertone/supertonic-2/resolve/main/unicode_indexer.json',
        onnx: {
            'duration_predictor': 'https://huggingface.co/Supertone/supertonic-2/resolve/main/onnx/duration_predictor.onnx',
            'text_encoder': 'https://huggingface.co/Supertone/supertonic-2/resolve/main/onnx/text_encoder.onnx',
            'vector_estimator': 'https://huggingface.co/Supertone/supertonic-2/resolve/main/onnx/vector_estimator.onnx',
            'vocoder': 'https://huggingface.co/Supertone/supertonic-2/resolve/main/onnx/vocoder.onnx',
        },
        voices: {
            'M3': 'https://huggingface.co/Supertone/supertonic-2/resolve/main/voice_styles/M3.json',
            'F3': 'https://huggingface.co/Supertone/supertonic-2/resolve/main/voice_styles/F3.json',
        },
    },
};

async function ensureDir(dir) {
    try {
        await access(dir);
    } catch {
        await mkdir(dir, { recursive: true });
    }
}

async function downloadFile(url, destPath, spinner) {
    try {
        await access(destPath);
        spinner.info(`Already exists: ${destPath}`);
        return;
    } catch {
        // File doesn't exist, download it
    }

    spinner.text = `Downloading: ${url.split('/').pop()}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    await writeFile(destPath, Buffer.from(buffer));

    const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(2);
    spinner.succeed(`Downloaded: ${destPath} (${sizeMB} MB)`);
}

async function downloadModels() {
    console.log(chalk.bold.blue(`
╔═══════════════════════════════════════╗
║    🤖 PlisCord Model Downloader       ║
╚═══════════════════════════════════════╝
`));

    const spinner = ora('Preparing...').start();

    try {
        // Create directories
        await ensureDir(MODELS_DIR);
        await ensureDir(join(MODELS_DIR, 'wakeword'));
        await ensureDir(join(MODELS_DIR, 'pretrained'));
        await ensureDir(join(MODELS_DIR, 'tts'));
        await ensureDir(join(MODELS_DIR, 'tts', 'onnx'));
        await ensureDir(join(MODELS_DIR, 'tts', 'voices'));

        // Download wake word models
        spinner.info(chalk.cyan('Downloading Wake Word models...'));
        for (const [name, url] of Object.entries(MODELS.wakeword)) {
            await downloadFile(url, join(MODELS_DIR, 'wakeword', `${name}.onnx`), spinner);
        }

        // Download pretrained models
        spinner.info(chalk.cyan('Downloading pretrained models...'));
        for (const [name, url] of Object.entries(MODELS.pretrained)) {
            await downloadFile(url, join(MODELS_DIR, 'pretrained', `${name}.onnx`), spinner);
        }

        // Download TTS models
        spinner.info(chalk.cyan('Downloading TTS models...'));
        await downloadFile(MODELS.tts.config, join(MODELS_DIR, 'tts', 'tts.json'), spinner);
        await downloadFile(MODELS.tts.indexer, join(MODELS_DIR, 'tts', 'unicode_indexer.json'), spinner);

        for (const [name, url] of Object.entries(MODELS.tts.onnx)) {
            await downloadFile(url, join(MODELS_DIR, 'tts', 'onnx', `${name}.onnx`), spinner);
        }

        for (const [name, url] of Object.entries(MODELS.tts.voices)) {
            await downloadFile(url, join(MODELS_DIR, 'tts', 'voices', `${name}.json`), spinner);
        }

        console.log(chalk.bold.green(`
✅ All models downloaded successfully!

Note: Whisper and FunctionGemma models will be downloaded
automatically on first run via @huggingface/transformers.

To start the Discord bot:
  npm run discord

To start the Driving Assistant:
  npm run drive
`));

    } catch (error) {
        spinner.fail(chalk.red('Download failed'));
        console.error(error);
        process.exit(1);
    }
}

downloadModels();
