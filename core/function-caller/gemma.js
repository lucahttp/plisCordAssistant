/**
 * FunctionGemma - Intent Recognition and Function Calling
 * 
 * Uses Google's FunctionGemma (Gemma 3 270M fine-tuned for function calling)
 * to interpret natural language commands and map them to tool calls.
 * 
 * This is the "brain" that decides what action to take.
 */

import { EventEmitter } from 'events';
import { AutoTokenizer, AutoModelForCausalLM } from '@huggingface/transformers';

// FunctionGemma model
const FUNCTION_GEMMA_MODEL = 'onnx-community/gemma-3-270m-it-ONNX';

export class FunctionCaller extends EventEmitter {
    constructor(options = {}) {
        super();

        this.debug = options.debug || false;
        this.quantized = options.quantized !== false;
        this.tools = options.tools || {};

        this.tokenizer = null;
        this.model = null;
        this.isInitialized = false;

        // Tool schemas for context injection
        this.toolSchemas = {};
    }

    log(...args) {
        if (this.debug) {
            console.log('[FunctionCaller]', ...args);
        }
    }

    /**
     * Register a tool function
     * @param {string} name - Tool name (e.g., 'play_youtube')
     * @param {Object} schema - JSON schema describing parameters
     * @param {Function} handler - Function to execute
     */
    registerTool(name, schema, handler) {
        this.tools[name] = { schema, handler };
        this.toolSchemas[name] = schema;
        this.log(`Registered tool: ${name}`);
    }

    async initialize() {
        if (this.isInitialized) return;

        this.log('Loading FunctionGemma model...');

        try {
            // Load tokenizer
            this.tokenizer = await AutoTokenizer.from_pretrained(FUNCTION_GEMMA_MODEL, {
                progress_callback: (p) => this.emit('progress', p),
            });

            // Load model with ONNX optimization
            this.model = await AutoModelForCausalLM.from_pretrained(FUNCTION_GEMMA_MODEL, {
                quantized: this.quantized,
                progress_callback: (p) => this.emit('progress', p),
            });

            this.isInitialized = true;
            this.log('FunctionGemma initialized');

        } catch (error) {
            this.log('Failed to initialize FunctionGemma:', error);
            throw error;
        }
    }

    /**
     * Build the system prompt with available tools
     */
    buildSystemPrompt() {
        const toolDescriptions = Object.entries(this.toolSchemas).map(([name, schema]) => {
            return `- ${name}: ${schema.description}\n  Parameters: ${JSON.stringify(schema.properties || {})}`;
        }).join('\n');

        return `You are a voice assistant that interprets user commands and calls functions.

Available functions:
${toolDescriptions}

When the user gives a command, respond with a JSON object containing:
- "function": the function name to call
- "parameters": an object with the function parameters
- "response": a short spoken response to the user

If no function matches, respond with:
- "function": null
- "response": your helpful response to the user

Always respond with valid JSON only.`;
    }

    /**
     * Process user input and determine intent
     * @param {string} text - User's spoken command
     * @returns {Promise<Object>} - { function, parameters, response, executed }
     */
    async process(text) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        this.log('Processing:', text);

        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = `User command: "${text}"`;

        // Format for chat
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];

        try {
            // Tokenize
            const inputs = this.tokenizer.apply_chat_template(messages, {
                add_generation_prompt: true,
                return_dict: true,
            });

            // Generate
            const output = await this.model.generate({
                ...inputs,
                max_new_tokens: 256,
                temperature: 0.1, // Low temperature for deterministic outputs
                do_sample: false,
            });

            // Decode
            const responseText = this.tokenizer.decode(output[0], {
                skip_special_tokens: true,
            });

            this.log('Raw response:', responseText);

            // Parse JSON response
            const result = this.parseResponse(responseText);

            // Execute function if found
            if (result.function && this.tools[result.function]) {
                try {
                    this.log(`Executing: ${result.function}`, result.parameters);
                    const tool = this.tools[result.function];
                    const toolResult = await tool.handler(result.parameters);
                    result.executed = true;
                    result.toolResult = toolResult;

                    // Update response if tool provided one
                    if (toolResult?.response) {
                        result.response = toolResult.response;
                    }
                } catch (error) {
                    this.log('Tool execution error:', error);
                    result.executed = false;
                    result.error = error.message;
                    result.response = `Sorry, I had trouble with that. ${error.message}`;
                }
            }

            this.emit('result', result);
            return result;

        } catch (error) {
            this.log('Processing error:', error);
            return {
                function: null,
                parameters: {},
                response: "I'm sorry, I didn't understand that.",
                error: error.message,
            };
        }
    }

    /**
     * Parse the model's JSON response
     */
    parseResponse(responseText) {
        try {
            // Extract JSON from response (might have extra text)
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }

            // Fallback: treat as plain response
            return {
                function: null,
                parameters: {},
                response: responseText.trim(),
            };
        } catch (error) {
            this.log('JSON parse error:', error);
            return {
                function: null,
                parameters: {},
                response: responseText.trim(),
            };
        }
    }

    /**
     * Quick intent classification without full generation
     * Faster for simple yes/no or category decisions
     */
    async classifyIntent(text, intents) {
        // Simple keyword matching for speed
        const lowerText = text.toLowerCase();

        for (const [intent, keywords] of Object.entries(intents)) {
            for (const keyword of keywords) {
                if (lowerText.includes(keyword.toLowerCase())) {
                    return intent;
                }
            }
        }

        return null;
    }

    async dispose() {
        this.tokenizer = null;
        this.model = null;
        this.isInitialized = false;
    }
}

export default FunctionCaller;
