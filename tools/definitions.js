/**
 * Tool Definitions for PlisCord Assistant
 * These are the functions that FunctionGemma can call
 */

// Tool registry with schemas and handlers
export const TOOLS = {
    // YouTube Music Playback
    play_youtube: {
        schema: {
            name: 'play_youtube',
            description: 'Play a song or video from YouTube',
            properties: {
                query: {
                    type: 'string',
                    description: 'Song name, artist, or search query',
                },
            },
            required: ['query'],
        },
        handler: null, // Set by the specific adapter (Discord/Driving)
    },

    // Media Controls
    media_control: {
        schema: {
            name: 'media_control',
            description: 'Control media playback (pause, resume, skip, stop, volume)',
            properties: {
                action: {
                    type: 'string',
                    enum: ['pause', 'resume', 'skip', 'stop', 'volume_up', 'volume_down'],
                    description: 'The control action to perform',
                },
            },
            required: ['action'],
        },
        handler: null,
    },

    // Web Search
    search_web: {
        schema: {
            name: 'search_web',
            description: 'Search the web for information',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query',
                },
            },
            required: ['query'],
        },
        handler: null,
    },

    // Discord Invite
    invite_friend: {
        schema: {
            name: 'invite_friend',
            description: 'Invite a friend to play a game on Discord',
            properties: {
                friend_name: {
                    type: 'string',
                    description: 'Name of the friend to invite',
                },
                game: {
                    type: 'string',
                    description: 'Name of the game to play',
                },
            },
            required: ['friend_name'],
        },
        handler: null,
    },

    // Navigation (Driving Mode)
    navigate: {
        schema: {
            name: 'navigate',
            description: 'Start navigation to a destination',
            properties: {
                destination: {
                    type: 'string',
                    description: 'Where to navigate (address, place name, or "home")',
                },
            },
            required: ['destination'],
        },
        handler: null,
    },

    // Time/Date Query
    get_time: {
        schema: {
            name: 'get_time',
            description: 'Get the current time or date',
            properties: {
                format: {
                    type: 'string',
                    enum: ['time', 'date', 'datetime'],
                    description: 'What to return',
                },
            },
        },
        handler: async (params) => {
            const now = new Date();
            const format = params.format || 'time';

            let response;
            switch (format) {
                case 'date':
                    response = `Today is ${now.toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })}`;
                    break;
                case 'datetime':
                    response = `It's ${now.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit'
                    })} on ${now.toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric'
                    })}`;
                    break;
                default:
                    response = `It's ${now.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit'
                    })}`;
            }

            return { response };
        },
    },

    // Set Reminder
    set_reminder: {
        schema: {
            name: 'set_reminder',
            description: 'Set a reminder for later',
            properties: {
                message: {
                    type: 'string',
                    description: 'What to remind about',
                },
                minutes: {
                    type: 'number',
                    description: 'Minutes from now',
                },
            },
            required: ['message'],
        },
        handler: null,
    },

    // Voice Channel Control (Discord)
    voice_channel: {
        schema: {
            name: 'voice_channel',
            description: 'Control voice channel presence',
            properties: {
                action: {
                    type: 'string',
                    enum: ['join', 'leave', 'mute', 'unmute'],
                    description: 'Action to perform',
                },
                channel: {
                    type: 'string',
                    description: 'Channel name (for join)',
                },
            },
            required: ['action'],
        },
        handler: null,
    },
};

/**
 * Create a tools object configured for a specific adapter
 * @param {Object} handlers - Map of tool name to handler function
 * @returns {Object} Configured tools
 */
export function createTools(handlers) {
    const tools = {};

    for (const [name, tool] of Object.entries(TOOLS)) {
        tools[name] = {
            schema: tool.schema,
            handler: handlers[name] || tool.handler || (async () => ({
                response: `Sorry, ${name} is not available right now.`,
            })),
        };
    }

    return tools;
}

export default TOOLS;
