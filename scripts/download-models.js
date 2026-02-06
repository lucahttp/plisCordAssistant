/**
 * Model Download Script
 * Downloads all required AI models for offline operation
 */

import { mkdir, writeFile, access } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';

const MODELS_DIR = './models';

// Model URLs - using onnx-community versions
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

    // Supertonic TTS from onnx-community
    tts: {
        config: 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/config.json',
        tokenizer: 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/tokenizer.json',
        tokenizerConfig: 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/tokenizer_config.json',
        onnx: {
            // Main ONNX models
            'text_encoder': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/onnx/text_encoder.onnx',
            'text_encoder_data': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/onnx/text_encoder.onnx_data',
            'latent_denoiser': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/onnx/latent_denoiser.onnx',
            'latent_denoiser_data': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/onnx/latent_denoiser.onnx_data',
            'voice_decoder': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/onnx/voice_decoder.onnx',
            'voice_decoder_data': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/onnx/voice_decoder.onnx_data',
        },
        voices: {
            // Voice embeddings as .bin files
            'M1': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/M1.bin',
            'M2': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/M2.bin',
            'M3': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/M3.bin',
            'M4': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/M4.bin',
            'M5': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/M5.bin',
            'F1': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/F1.bin',
            'F2': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/F2.bin',
            'F3': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/F3.bin',
            'F4': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/F4.bin',
            'F5': 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/F5.bin',
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
        return true;
    } catch {
        // File doesn't exist, download it
    }

    const filename = url.split('/').pop();
    spinner.text = `Downloading: ${filename}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            spinner.warn(`Skipped (${response.status}): ${filename}`);
            return false;
        }

        const buffer = await response.arrayBuffer();
        await writeFile(destPath, Buffer.from(buffer));

        const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(2);
        spinner.succeed(`Downloaded: ${destPath} (${sizeMB} MB)`);
        return true;
    } catch (error) {
        spinner.warn(`Failed: ${filename} - ${error.message}`);
        return false;
    }
}

async function downloadModels() {
    console.log(chalk.bold.blue(`
╔═══════════════════════════════════════╗
║    🤖 PlisCord Model Downloader       ║
╚═══════════════════════════════════════╝
`));

    const spinner = ora('Preparing...').start();
    let downloadedCount = 0;
    let failedCount = 0;

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
            if (await downloadFile(url, join(MODELS_DIR, 'wakeword', `${name}.onnx`), spinner)) {
                downloadedCount++;
            } else {
                failedCount++;
            }
        }

        // Download pretrained models
        spinner.info(chalk.cyan('Downloading pretrained models...'));
        for (const [name, url] of Object.entries(MODELS.pretrained)) {
            if (await downloadFile(url, join(MODELS_DIR, 'pretrained', `${name}.onnx`), spinner)) {
                downloadedCount++;
            } else {
                failedCount++;
            }
        }

        // Download TTS config files
        spinner.info(chalk.cyan('Downloading TTS config...'));
        if (await downloadFile(MODELS.tts.config, join(MODELS_DIR, 'tts', 'config.json'), spinner)) {
            downloadedCount++;
        }
        if (await downloadFile(MODELS.tts.tokenizer, join(MODELS_DIR, 'tts', 'tokenizer.json'), spinner)) {
            downloadedCount++;
        }
        if (await downloadFile(MODELS.tts.tokenizerConfig, join(MODELS_DIR, 'tts', 'tokenizer_config.json'), spinner)) {
            downloadedCount++;
        }

        // Download TTS ONNX models
        spinner.info(chalk.cyan('Downloading TTS ONNX models (this may take a while)...'));
        for (const [name, url] of Object.entries(MODELS.tts.onnx)) {
            const ext = name.endsWith('_data') ? '.onnx_data' : '.onnx';
            const baseName = name.replace('_data', '');
            if (await downloadFile(url, join(MODELS_DIR, 'tts', 'onnx', `${baseName}${ext}`), spinner)) {
                downloadedCount++;
            } else {
                failedCount++;
            }
        }

        // Download voice embeddings
        spinner.info(chalk.cyan('Downloading voice embeddings...'));
        for (const [name, url] of Object.entries(MODELS.tts.voices)) {
            if (await downloadFile(url, join(MODELS_DIR, 'tts', 'voices', `${name}.bin`), spinner)) {
                downloadedCount++;
            } else {
                failedCount++;
            }
        }

        const status = failedCount === 0
            ? chalk.bold.green('✅ All models downloaded successfully!')
            : chalk.bold.yellow(`⚠ Downloaded ${downloadedCount} files, ${failedCount} failed`);

        console.log(`
${status}

Downloaded: ${downloadedCount} files
${failedCount > 0 ? `Failed: ${failedCount} files\n` : ''}
Note: Whisper and FunctionGemma models will be downloaded
automatically on first run via @huggingface/transformers.

To start the Discord bot:
  npm run discord

To start the Driving Assistant:
  npm run drive
`);

    } catch (error) {
        spinner.fail(chalk.red('Download failed'));
        console.error(error);
        process.exit(1);
    }
}

downloadModels();
