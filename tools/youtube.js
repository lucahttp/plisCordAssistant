/**
 * YouTube Tool Implementation
 * Uses play-dl for YouTube audio extraction
 */

import play from 'play-dl';

export class YouTubeTool {
    constructor(options = {}) {
        this.debug = options.debug || false;
        this.currentStream = null;
        this.isPlaying = false;
        this.volume = options.volume || 0.5;

        // Queue
        this.queue = [];
        this.currentTrack = null;
    }

    log(...args) {
        if (this.debug) {
            console.log('[YouTube]', ...args);
        }
    }

    /**
     * Search YouTube and get audio stream
     * @param {string} query - Search query
     * @returns {Promise<Object>} - Track info and stream
     */
    async search(query) {
        this.log('Searching:', query);

        const results = await play.search(query, {
            source: { youtube: 'video' },
            limit: 1,
        });

        if (results.length === 0) {
            throw new Error('No results found');
        }

        const video = results[0];
        this.log('Found:', video.title);

        return {
            id: video.id,
            title: video.title,
            artist: video.channel?.name || 'Unknown',
            duration: video.durationInSec,
            thumbnail: video.thumbnails?.[0]?.url,
            url: video.url,
        };
    }

    /**
     * Get audio stream for a video
     * @param {string} url - YouTube URL
     * @returns {Promise<Stream>} - Audio stream
     */
    async getStream(url) {
        const stream = await play.stream(url, {
            quality: 2, // 0 = best, 2 = worst (faster for potato mode)
        });

        return stream.stream;
    }

    /**
     * Play handler for function calling
     */
    async play(params) {
        const { query } = params;

        try {
            const track = await this.search(query);
            this.currentTrack = track;
            this.queue.push(track);

            return {
                response: `Playing ${track.title} by ${track.artist}`,
                track,
            };
        } catch (error) {
            this.log('Play error:', error);
            return {
                response: `Sorry, I couldn't find "${query}" on YouTube`,
                error: error.message,
            };
        }
    }

    /**
     * Media control handler
     */
    mediaControl(action) {
        switch (action) {
            case 'pause':
                this.isPlaying = false;
                return { response: 'Paused' };

            case 'resume':
                this.isPlaying = true;
                return { response: 'Resumed' };

            case 'skip':
                if (this.queue.length > 0) {
                    const next = this.queue.shift();
                    this.currentTrack = next;
                    return { response: `Skipping to ${next.title}` };
                }
                return { response: 'No more tracks in queue' };

            case 'stop':
                this.isPlaying = false;
                this.currentStream = null;
                this.currentTrack = null;
                this.queue = [];
                return { response: 'Stopped playback' };

            case 'volume_up':
                this.volume = Math.min(1, this.volume + 0.1);
                return { response: `Volume at ${Math.round(this.volume * 100)}%` };

            case 'volume_down':
                this.volume = Math.max(0, this.volume - 0.1);
                return { response: `Volume at ${Math.round(this.volume * 100)}%` };

            default:
                return { response: `Unknown action: ${action}` };
        }
    }
}

export default YouTubeTool;
