/**
 * ReAct Agent Orchestrator
 * Coordinates reasoning-acting multi-turn loop between Gemini LLM,
 * Local Tools Actuator, Security Guard, and Session Persistence.
 */

import { parseTextToolCalls } from '../llm/openai.js';
import { createLlmClient } from '../llm/registry.js';
import { SecurityGuard } from '../security/guard.js';
import { dispatchToolCall, getToolDeclarations } from '../tools/registry.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { estimateSessionTokens, pruneMessages } from './pruner.js';
import { ReflectionChecker } from './reflection.js';
import { createSession, Session } from './session.js';
import { buildSystemPrompt } from './system-prompt.js';

export const DEFAULT_MAX_ITERATIONS = 30;

/**
 * Core ReAct Agent Orchestrator Class
 */
export class AgentOrchestrator {
  /**
   * @param {object} [options={}]
   * @param {object} [options.llmClient] - Generic LLM client instance
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
   * @param {number} [options.reflectionInterval=3] - Reflection check interval (0 = disabled)
   */
  constructor(options = {}) {
    this.workingDir = options.workingDir || process.cwd();
    this.maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
    this.maxContextTokens = options.maxContextTokens;
    this.reflectionInterval = options.reflectionInterval != null ? options.reflectionInterval : 3;
    this.logger = options.logger || defaultLogger;
    this.locale = options.locale;

    // Security Guard
    this.securityGuard =
      options.securityGuard ||
      new SecurityGuard({
        autoApprove: options.autoApprove,
        baseDir: this.workingDir,
      });

    // LLM client: prefer explicit llmClient, then create from provider
    this.provider = options.provider || 'gemini';
    this.baseUrl = options.baseUrl;
    this.adapter = options.adapter;
    this.llmClient =
      options.llmClient ||
      createLlmClient({
        provider: this.provider,
        adapter: this.adapter,
        model: options.model,
        apiKey: options.apiKey,
        baseUrl: this.baseUrl,
        logger: this.logger,
        locale: this.locale,
      });
    // Session Management
    this.session =
      options.session ||
      createSession({
        model: this.llmClient.getModel(),
        provider: this.provider,
        workingDir: this.workingDir,
      });

    // Tools
    this.tools = options.tools || getToolDeclarations();

    // System prompt
    this.systemInstruction =
      options.systemInstruction ||
      buildSystemPrompt({
        workingDir: this.workingDir,
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
   * @param {number} [options.reflectionInterval] - Override reflection check interval (0 = disabled)
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

    // Reflection checker (0 means disabled)
    const reflectionEnabled = (options.reflectionInterval ?? this.reflectionInterval) > 0;
    const reflectionInterval = reflectionEnabled
      ? (options.reflectionInterval ?? this.reflectionInterval)
      : 0;
    const reflectionChecker = reflectionEnabled
      ? new ReflectionChecker(this.llmClient, {
          interval: reflectionInterval,
          logger: this.logger,
        })
      : null;

    // Add user prompt to session history if provided
    if (prompt && typeof prompt === 'string' && prompt.trim() !== '') {
      this.session.addUserMessage(prompt.trim());
    }

    while (currentIteration < maxIters) {
      if (signal?.aborted) {
        throw signal.reason || new Error('ReAct loop was aborted');
      }

      currentIteration++;
      if (typeof options.onIterationStart === 'function') {
        options.onIterationStart(currentIteration);
      }

      // Step 0: Token Budget Check — stop before context overflows
      const currentTokens = estimateSessionTokens(this.session);
      const budgetLimit = Math.floor((this.maxContextTokens || 800000) * 0.85);
      if (currentTokens > budgetLimit) {
        this.logger.warn(
          `Token budget exceeded (${currentTokens.toLocaleString()} / ${budgetLimit.toLocaleString()} tokens). ` +
            `Stopping ReAct loop at iteration ${currentIteration} to avoid context overflow.`,
        );
        break;
      }

      // Step 1: Context Pruning
      const rawMessages = this.session.getMessages();
      const prunedContents = pruneMessages(rawMessages, {
        maxTokens: this.maxContextTokens,
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
          signal,
        });
      } catch (genErr) {
        // If stream error occurs, log and rethrow
        this.logger.error(`Generation error at turn ${currentIteration}: ${genErr.message}`);
        throw genErr;
      }

      let { text, functionCalls } = streamResult;

      // Fallback: If no structured function calls returned, detect embedded tool calls in text
      if (!functionCalls || functionCalls.length === 0) {
        const textCalls = parseTextToolCalls(text);
        if (textCalls.length > 0) {
          functionCalls = textCalls;
        }
      }

      // Step 3: Handle Pure Text Response (No tool calls)
      if (!functionCalls || functionCalls.length === 0) {
        finalText = text;
        this.session.addModelMessage(text);
        break; // Successfully concluded the ReAct loop
      }

      // Step 4: Handle Function Call(s)
      // Record model message containing function call(s) and any accompanying thinking text
      const modelParts = [];
      if (text?.trim()) {
        modelParts.push({ text });
      }
      for (const fc of functionCalls) {
        modelParts.push({
          functionCall: {
            name: fc.name,
            args: fc.args || {},
          },
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
          logger: this.logger,
        });

        let responsePayload;

        if (toolExecution.error) {
          // Self-correction error feedback payload
          responsePayload = {
            error: true,
            status: 'error',
            message: toolExecution.message || 'Tool execution failed',
          };
          this.logger.warn(`Tool "${name}" failed: ${toolExecution.message}`);
        } else {
          // Successful tool output
          responsePayload =
            toolExecution.result !== undefined ? toolExecution.result : { status: 'ok' };
        }

        executedToolCalls.push({
          name,
          args,
          response: responsePayload,
          iteration: currentIteration,
        });

        if (typeof options.onToolResult === 'function') {
          options.onToolResult(name, responsePayload);
        }

        // Add function response to session history
        this.session.addFunctionResponseMessage(name, responsePayload);
      }

      // Step 5.5: Record for reflection and run periodic check
      if (reflectionChecker) {
        reflectionChecker.record(currentIteration, executedToolCalls);

        // Run reflection check at interval, but skip on the very last iteration
        const isLastIteration = currentIteration >= maxIters - 1;
        if (!isLastIteration && currentIteration % reflectionInterval === 0) {
          try {
            const verdict = await reflectionChecker.check(prompt || '', currentIteration);
            if (verdict.finish) {
              this.logger.info(`[Reflection] Stopping early — ${verdict.reason}`);
              break;
            }
          } catch (refErr) {
            this.logger.warn(
              `[Reflection] Check failed at iter ${currentIteration}: ${refErr.message}`,
            );
          }
        }
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
      session: this.session,
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
    this.adapter = overrides.adapter;
    this.llmClient = createLlmClient({
      provider: providerId,
      adapter: overrides.adapter,
      model: overrides.model || (this.llmClient ? this.llmClient.getModel() : undefined),
      apiKey: overrides.apiKey || (this.llmClient ? this.llmClient.getApiKey() : undefined),
      baseUrl: overrides.baseUrl,
      logger: this.logger,
      locale: this.locale,
    });
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
