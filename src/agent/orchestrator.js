/**
 * ReAct Agent Orchestrator
 * Coordinates reasoning-acting multi-turn loop between Gemini LLM,
 * Local Tools Actuator, Security Guard, and Session Persistence.
 */

import { createLlmClient } from '../llm/registry.js';
import { SecurityGuard } from '../security/guard.js';
import { getToolDeclarations, dispatchToolCall } from '../tools/registry.js';
import { buildSystemPrompt } from './system-prompt.js';
import { pruneMessages } from './pruner.js';
import { Session, createSession, defaultSessionManager } from './session.js';
import { logger as defaultLogger } from '../utils/logger.js';

export const DEFAULT_MAX_ITERATIONS = 15;

/**
 * Core ReAct Agent Orchestrator Class
 */
export class AgentOrchestrator {
  /**
   * @param {object} [options={}]
   * @param {object} [options.llmClient] - Generic LLM client instance
   * @param {object} [options.geminiClient] - Legacy alias for LLM client
   * @param {string} [options.provider='gemini'] - Active provider ID
   * @param {SecurityGuard} [options.securityGuard] - Security guard engine
   * @param {Session} [options.session] - Conversation session
   * @param {string} [options.model] - Model name override
   * @param {string} [options.apiKey] - API key override
   * @param {string} [options.workingDir] - Active working directory
   * @param {number} [options.maxIterations=15] - Maximum autonomous loop turns
   * @param {Array<object>} [options.tools] - Tool declarations
   * @param {string} [options.systemInstruction] - Custom system prompt
   * @param {boolean} [options.autoApprove=false] - Auto-approve risky actions
   * @param {object} [options.logger] - Logger instance
   * @param {number} [options.maxContextTokens] - Max context tokens before pruning
   */
  constructor(options = {}) {
    this.workingDir = options.workingDir || process.cwd();
    this.maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
    this.maxContextTokens = options.maxContextTokens;
    this.logger = options.logger || defaultLogger;

    // Security Guard
    this.securityGuard =
      options.securityGuard ||
      new SecurityGuard({
        autoApprove: options.autoApprove,
        baseDir: this.workingDir
      });

    // LLM client: prefer explicit llmClient, then geminiClient (legacy), then create from provider
    this.provider = options.provider || 'gemini';
    this.llmClient =
      options.llmClient ||
      options.geminiClient ||
      createLlmClient({
        provider: this.provider,
        model: options.model,
        apiKey: options.apiKey,
        logger: this.logger
      });
    this.geminiClient = this.llmClient; // legacy alias

    // Session Management
    this.session =
      options.session ||
      createSession({
        model: this.llmClient.getModel(),
        provider: this.provider,
        workingDir: this.workingDir
      });

    // Tools
    this.tools = options.tools || getToolDeclarations();

    // System prompt
    this.systemInstruction =
      options.systemInstruction ||
      buildSystemPrompt({
        workingDir: this.workingDir
      });
  }

  /**
   * Gets current active session
   * @returns {Session}
   */
  getSession() {
    return this.session;
  }

  /**
   * Sets or attaches a new session
   * @param {Session} session
   */
  setSession(session) {
    if (!session || typeof session.getMessages !== 'function') {
      throw new TypeError('Invalid session instance');
    }
    this.session = session;
  }

  /**
   * Runs an autonomous ReAct loop for a user instruction/prompt
   *
   * @param {string} prompt - User input task
   * @param {object} [options={}]
   * @param {(token: string) => void} [options.onToken] - Real-time token streaming callback
   * @param {(call: { name: string, args: object }) => void} [options.onToolCall] - Hook when tool is called
   * @param {(name: string, result: any) => void} [options.onToolResult] - Hook when tool finishes
   * @param {(iteration: number) => void} [options.onIterationStart] - Turn hook
   * @param {AbortSignal} [options.signal] - Abort controller signal
   * @param {number} [options.maxIterations] - Override max iterations
   * @returns {Promise<{
   *   success: boolean,
   *   text: string,
   *   iterations: number,
   *   toolCalls: Array<object>,
   *   loopLimitReached: boolean,
   *   session: Session
   * }>}
   */
  async runTurn(prompt, options = {}) {
    const maxIters = options.maxIterations || this.maxIterations;
    const signal = options.signal;
    const executedToolCalls = [];
    let finalText = '';
    let loopLimitReached = false;
    let currentIteration = 0;

    // Add user prompt to session history if provided
    if (prompt && typeof prompt === 'string' && prompt.trim() !== '') {
      this.session.addUserMessage(prompt.trim());
    }

    while (currentIteration < maxIters) {
      if (signal && signal.aborted) {
        throw signal.reason || new Error('ReAct loop was aborted');
      }

      currentIteration++;
      if (typeof options.onIterationStart === 'function') {
        options.onIterationStart(currentIteration);
      }

      // Step 1: Context Pruning
      const rawMessages = this.session.getMessages();
      const prunedContents = pruneMessages(rawMessages, {
        maxTokens: this.maxContextTokens
      });

      // Step 2: Stream generation via LLM API
      let streamResult;
      try {
        streamResult = await this.llmClient.generateStream({
          contents: prunedContents,
          tools: this.tools,
          systemInstruction: this.systemInstruction,
          onToken: (token) => {
            if (typeof options.onToken === 'function') {
              options.onToken(token);
            }
          },
          signal
        });
      } catch (genErr) {
        // If stream error occurs, log and rethrow
        this.logger.error(`Generation error at turn ${currentIteration}: ${genErr.message}`);
        throw genErr;
      }

      const { text, functionCalls } = streamResult;

      // Step 3: Handle Pure Text Response (No tool calls)
      if (!functionCalls || functionCalls.length === 0) {
        finalText = text;
        this.session.addModelMessage(text);
        break; // Successfully concluded the ReAct loop
      }

      // Step 4: Handle Function Call(s)
      // Record model message containing function call(s) and any accompanying thinking text
      const modelParts = [];
      if (text && text.trim()) {
        modelParts.push({ text });
      }
      for (const fc of functionCalls) {
        modelParts.push({
          functionCall: {
            name: fc.name,
            args: fc.args || {}
          }
        });
      }
      this.session.addMessage({ role: 'model', parts: modelParts });

      // Step 5: Execute each tool call through Security Guard and Actuators
      for (const fc of functionCalls) {
        const { name, args } = fc;

        if (typeof options.onToolCall === 'function') {
          options.onToolCall(fc);
        }

        // Dispatch actuator tool with security authorization
        const toolExecution = await dispatchToolCall(name, args, {
          securityGuard: this.securityGuard,
          baseDir: this.workingDir,
          logger: this.logger
        });

        let responsePayload;

        if (toolExecution.error) {
          // Self-correction error feedback payload
          responsePayload = {
            error: true,
            status: 'error',
            message: toolExecution.message || 'Tool execution failed'
          };
          this.logger.warn(`Tool "${name}" failed: ${toolExecution.message}`);
        } else {
          // Successful tool output
          responsePayload = toolExecution.result !== undefined ? toolExecution.result : { status: 'ok' };
        }

        executedToolCalls.push({
          name,
          args,
          response: responsePayload,
          iteration: currentIteration
        });

        if (typeof options.onToolResult === 'function') {
          options.onToolResult(name, responsePayload);
        }

        // Add function response to session history
        this.session.addFunctionResponseMessage(name, responsePayload);
      }

      // Check if we hit the iteration ceiling
      if (currentIteration >= maxIters) {
        loopLimitReached = true;
        this.logger.warn(`ReAct loop reached maximum iteration limit (${maxIters}).`);
        break;
      }
    }

    // Step 6: Atomic session save
    try {
      this.session.save();
    } catch (saveErr) {
      this.logger.warn(`Failed to persist session to disk: ${saveErr.message}`);
    }

    return {
      success: !loopLimitReached,
      text: finalText,
      iterations: currentIteration,
      toolCalls: executedToolCalls,
      loopLimitReached,
      session: this.session
    };
  }

  /**
   * Switch active provider, recreate llmClient, update session.
   * @param {string} providerId
   * @param {object} [overrides] - optional { model, apiKey, baseUrl }
   */
  setProvider(providerId, overrides = {}) {
    if (!providerId || typeof providerId !== 'string') {
      throw new TypeError('providerId must be a non-empty string');
    }
    this.provider = providerId;
    this.llmClient = createLlmClient({
      provider: providerId,
      model: overrides.model || (this.llmClient ? this.llmClient.getModel() : undefined),
      apiKey: overrides.apiKey || (this.llmClient ? this.llmClient.getApiKey() : undefined),
      baseUrl: overrides.baseUrl,
      logger: this.logger,
    });
    this.geminiClient = this.llmClient;
    if (this.session) {
      this.session.provider = providerId;
      this.session.model = this.llmClient.getModel();
    }
  }

  /**
   * Alias for runTurn
   * @param {string} prompt
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async execute(prompt, options = {}) {
    return this.runTurn(prompt, options);
  }
}

/**
 * Factory to create an AgentOrchestrator instance
 *
 * @param {object} [options={}]
 * @returns {AgentOrchestrator}
 */
export function createAgentOrchestrator(options = {}) {
  return new AgentOrchestrator(options);
}

