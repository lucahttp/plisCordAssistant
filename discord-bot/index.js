/**
 * PlisCord Discord Bot
 * Voice-enabled assistant for Discord servers
 */

import 'dotenv/config';
import {
    Client,
    GatewayIntentBits,
    Events,
    SlashCommandBuilder,
    REST,
    Routes,
} from 'discord.js';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    EndBehaviorType,
} from '@discordjs/voice';
import { VoicePipeline } from '../core/pipeline.js';
import { createTools } from '../tools/definitions.js';
import { YouTubeTool } from '../tools/youtube.js';
import { Readable } from 'stream';
import chalk from 'chalk';
import ora from 'ora';

// Configuration
const config = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    wakeWord: process.env.WAKE_WORD || 'hey-buddy',
    performanceMode: process.env.PERFORMANCE_MODE || 'potato',
    ttsVoice: process.env.TTS_VOICE || 'M3',
    autoJoin: process.env.AUTO_JOIN !== 'false',
    debug: process.env.DEBUG === 'true',
};

class PlisCordBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
        });

        // Per-guild connections
        this.connections = new Map();
        this.players = new Map();
        this.pipelines = new Map();

        // Shared tools
        this.youtube = new YouTubeTool({ debug: config.debug });

        this.setupEventHandlers();
    }

    log(...args) {
        console.log(chalk.blue('[PlisCord]'), ...args);
    }

    error(...args) {
        console.error(chalk.red('[PlisCord Error]'), ...args);
    }

    setupEventHandlers() {
        this.client.once(Events.ClientReady, () => this.onReady());
        this.client.on(Events.VoiceStateUpdate, (oldState, newState) =>
            this.onVoiceStateUpdate(oldState, newState));
        this.client.on(Events.InteractionCreate, (interaction) =>
            this.onInteraction(interaction));
    }

    async onReady() {
        this.log(`Logged in as ${chalk.green(this.client.user.tag)}`);
        this.log(`Mode: ${chalk.yellow(config.performanceMode)}`);

        // Register slash commands
        await this.registerCommands();

        this.log('Bot is ready!');
    }

    async registerCommands() {
        const commands = [
            new SlashCommandBuilder()
                .setName('join')
                .setDescription('Join your voice channel'),
            new SlashCommandBuilder()
                .setName('leave')
                .setDescription('Leave the voice channel'),
            new SlashCommandBuilder()
                .setName('play')
                .setDescription('Play a song from YouTube')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Song to play')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('stop')
                .setDescription('Stop playback'),
            new SlashCommandBuilder()
                .setName('status')
                .setDescription('Show bot status'),
        ].map(cmd => cmd.toJSON());

        const rest = new REST().setToken(config.token);

        try {
            await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
            this.log('Slash commands registered');
        } catch (error) {
            this.error('Failed to register commands:', error);
        }
    }

    /**
     * Handle user joining/leaving voice channels
     */
    async onVoiceStateUpdate(oldState, newState) {
        // User joined a voice channel
        if (!oldState.channel && newState.channel && config.autoJoin) {
            // Check if we should auto-join
            const channel = newState.channel;
            const guildId = channel.guild.id;

            // Don't join if already connected
            if (this.connections.has(guildId)) return;

            // Don't join AFK channels
            if (channel.id === channel.guild.afkChannelId) return;

            this.log(`User joined ${chalk.cyan(channel.name)} in ${channel.guild.name}`);

            // Auto-join after short delay
            setTimeout(() => {
                if (channel.members.size > 0) {
                    this.joinChannel(channel);
                }
            }, 1000);
        }

        // Check if we're alone in the channel
        if (oldState.channel && !newState.channel) {
            const channel = oldState.channel;
            const guildId = channel.guild.id;

            if (this.connections.has(guildId)) {
                // Only bot left in channel
                const members = channel.members.filter(m => !m.user.bot);
                if (members.size === 0) {
                    this.log('Channel empty, leaving...');
                    this.leaveChannel(guildId);
                }
            }
        }
    }

    /**
     * Join a voice channel
     */
    async joinChannel(channel) {
        const guildId = channel.guild.id;

        this.log(`Joining ${chalk.cyan(channel.name)}...`);

        try {
            // Create voice connection
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: guildId,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false, // Listen to audio
                selfMute: false,
            });

            // Wait for connection
            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

            this.connections.set(guildId, connection);

            // Create audio player
            const player = createAudioPlayer();
            connection.subscribe(player);
            this.players.set(guildId, player);

            // Setup voice pipeline for this guild
            await this.setupPipeline(guildId, connection);

            this.log(`Connected to ${chalk.green(channel.name)}`);

            // Listen to incoming audio
            this.startListening(guildId, connection);

        } catch (error) {
            this.error('Failed to join channel:', error);
        }
    }

    /**
     * Leave a voice channel
     */
    leaveChannel(guildId) {
        const connection = this.connections.get(guildId);
        if (connection) {
            connection.destroy();
            this.connections.delete(guildId);
        }

        const pipeline = this.pipelines.get(guildId);
        if (pipeline) {
            pipeline.dispose();
            this.pipelines.delete(guildId);
        }

        this.players.delete(guildId);
        this.log('Left voice channel');
    }

    /**
     * Setup voice pipeline for a guild
     */
    async setupPipeline(guildId, connection) {
        const spinner = ora('Initializing voice assistant...').start();

        // Create tool handlers for this guild
        const handlers = {
            play_youtube: async (params) => {
                const result = await this.youtube.play(params);
                if (result.track) {
                    await this.playYouTube(guildId, result.track.url);
                }
                return result;
            },

            media_control: async (params) => {
                return this.youtube.mediaControl(params.action);
            },

            voice_channel: async (params) => {
                switch (params.action) {
                    case 'leave':
                        this.leaveChannel(guildId);
                        return { response: 'Goodbye!' };
                    default:
                        return { response: 'Voice control not available' };
                }
            },

            invite_friend: async (params) => {
                // TODO: Implement friend invite via Discord DM
                return {
                    response: `I would invite ${params.friend_name} to play ${params.game || 'games'}, but that feature is coming soon!`
                };
            },
        };

        const tools = createTools(handlers);

        // Create pipeline
        const pipeline = new VoicePipeline({
            performanceMode: config.performanceMode,
            wakeWord: config.wakeWord,
            ttsVoice: config.ttsVoice,
            tools,
            debug: config.debug,
        });

        // Handle pipeline events
        pipeline.on('wakeWord', () => {
            this.log(chalk.yellow('Wake word detected!'));
        });

        pipeline.on('transcript', (text) => {
            this.log(chalk.cyan('Heard:'), text);
        });

        pipeline.on('intent', (result) => {
            this.log(chalk.green('Action:'), result.function || 'chat');
        });

        pipeline.on('stateChange', (state) => {
            if (config.debug) {
                this.log(chalk.gray('State:'), state);
            }
        });

        try {
            await pipeline.initialize();
            this.pipelines.set(guildId, pipeline);
            spinner.succeed('Voice assistant ready');
        } catch (error) {
            spinner.fail('Failed to initialize voice assistant');
            throw error;
        }
    }

    /**
     * Start listening to voice channel audio
     */
    startListening(guildId, connection) {
        const pipeline = this.pipelines.get(guildId);
        if (!pipeline) return;

        const receiver = connection.receiver;

        receiver.speaking.on('start', (userId) => {
            const audioStream = receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 1000,
                },
            });

            // Create a fake audio source for the pipeline
            const audioSource = {
                on: (event, callback) => {
                    if (event === 'data') {
                        audioStream.on('data', (chunk) => {
                            // Discord audio is Opus, need to decode
                            callback(chunk);
                        });
                    }
                },
                removeAllListeners: () => audioStream.removeAllListeners(),
            };

            // Note: In real implementation, you'd need to decode Opus to PCM
            // This is a simplified version
            pipeline.start(audioSource);
        });
    }

    /**
     * Play YouTube audio in voice channel
     */
    async playYouTube(guildId, url) {
        const player = this.players.get(guildId);
        if (!player) return;

        try {
            const stream = await this.youtube.getStream(url);
            const resource = createAudioResource(stream);
            player.play(resource);

            this.log(`Playing: ${url}`);
        } catch (error) {
            this.error('Playback error:', error);
        }
    }

    /**
     * Handle slash command interactions
     */
    async onInteraction(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const { commandName, guildId } = interaction;

        switch (commandName) {
            case 'join': {
                const channel = interaction.member?.voice?.channel;
                if (!channel) {
                    await interaction.reply('You need to be in a voice channel!');
                    return;
                }
                await interaction.deferReply();
                await this.joinChannel(channel);
                await interaction.editReply('Joined voice channel!');
                break;
            }

            case 'leave': {
                if (!this.connections.has(guildId)) {
                    await interaction.reply('Not connected to any voice channel.');
                    return;
                }
                this.leaveChannel(guildId);
                await interaction.reply('Left voice channel!');
                break;
            }

            case 'play': {
                const query = interaction.options.getString('query');
                await interaction.deferReply();

                const result = await this.youtube.play({ query });
                if (result.track) {
                    await this.playYouTube(guildId, result.track.url);
                    await interaction.editReply(`🎵 Now playing: **${result.track.title}**`);
                } else {
                    await interaction.editReply(result.response);
                }
                break;
            }

            case 'stop': {
                const player = this.players.get(guildId);
                if (player) {
                    player.stop();
                    await interaction.reply('Stopped playback.');
                } else {
                    await interaction.reply('Nothing is playing.');
                }
                break;
            }

            case 'status': {
                const pipeline = this.pipelines.get(guildId);
                const state = pipeline?.getState() || { state: 'not connected' };

                await interaction.reply({
                    embeds: [{
                        title: '🤖 PlisCord Status',
                        fields: [
                            { name: 'State', value: state.state, inline: true },
                            { name: 'Mode', value: config.performanceMode, inline: true },
                            { name: 'Wake Word', value: config.wakeWord, inline: true },
                        ],
                        color: 0x5865F2,
                    }],
                });
                break;
            }
        }
    }

    /**
     * Start the bot
     */
    async start() {
        if (!config.token) {
            this.error('DISCORD_TOKEN not set in environment!');
            this.log('Copy .env.example to .env and add your bot token.');
            process.exit(1);
        }

        const spinner = ora('Starting PlisCord...').start();

        try {
            await this.client.login(config.token);
            spinner.succeed('PlisCord started!');
        } catch (error) {
            spinner.fail('Failed to start');
            this.error(error);
            process.exit(1);
        }
    }
}

// Start the bot
const bot = new PlisCordBot();
bot.start();
