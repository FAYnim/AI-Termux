/**
 * OpenAI-compatible Chat Completions adapter.
 * Translates Gemini request shape -> OpenAI, parses SSE stream back into Gemini-compatible result.
 */
import { BaseLlmClient } from './base.js';

export class OpenAIClient extends BaseLlmClient {
  constructor(options = {}) {
    super(options);
    this.apiVersion = options.apiVersion || 'v1';
    if (!this.baseUrl) {
      this.baseUrl = 'https://api.openai.com/v1';
    }
  }

  getEndpoint(action = 'chat/completions', isStream = false) {
    let base = (this.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!base.endsWith('/v1') && !base.includes('/v1/')) {
      base = `${base}/v1`;
    }
    const cleanAction = action.replace(/^\/+/, '');
    return `${base}/${cleanAction}`;
  }

  buildRequestBody({ contents, tools, systemInstruction, generationConfig }) {
    const messages = [];

    // System instruction -> top-level system message
    if (systemInstruction) {
      const text = typeof systemInstruction === 'string'
        ? systemInstruction
        : (systemInstruction.parts?.[0]?.text || '');
      if (text) messages.push({ role: 'system', content: text });
    }

    if (Array.isArray(contents)) {
      for (const msg of contents) {
        if (msg.role === 'user') {
          const text = (msg.parts || []).map(p => p.text || '').join('');
          messages.push({ role: 'user', content: text });
        } else if (msg.role === 'model') {
          const texts = [];
          const toolCalls = [];
          for (const part of (msg.parts || [])) {
            if (part.text) texts.push(part.text);
            if (part.functionCall) {
              toolCalls.push({
                id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                type: 'function',
                function: {
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args || {}),
                },
              });
            }
          }
          if (texts.length || toolCalls.length) {
            const entry = { role: 'assistant' };
            if (texts.length) entry.content = texts.join('');
            if (toolCalls.length) entry.tool_calls = toolCalls;
            messages.push(entry);
          }
        } else if (msg.role === 'function') {
          for (const part of (msg.parts || [])) {
            if (part.functionResponse) {
              messages.push({
                role: 'tool',
                tool_call_id: part.functionResponse.toolCallId || `call_${Date.now()}`,
                content: JSON.stringify(part.functionResponse.response),
              });
            }
          }
        }
      }
    }

    const payload = {
      model: this.model || 'gpt-4o-mini',
      messages
    };

    // Tools: flat OpenAI shape
    if (tools && tools.length > 0) {
      const oaTools = [];
      for (const t of tools) {
        const fds = t.functionDeclarations || [];
        for (const fd of fds) {
          oaTools.push({
            type: 'function',
            function: {
              name: fd.name,
              description: fd.description || '',
              parameters: fd.parameters || { type: 'object', properties: {} },
            },
          });
        }
      }
      if (oaTools.length) payload.tools = oaTools;
    }

    if (generationConfig) {
      if (generationConfig.temperature !== undefined) {
        payload.temperature = generationConfig.temperature;
      }
      if (generationConfig.maxOutputTokens !== undefined) {
        payload.max_tokens = generationConfig.maxOutputTokens;
      }
    }

    return payload;
  }

  async generateStream(options = {}) {
    this._validateApiKey();
    const payload = this.buildRequestBody({
      contents: options.contents,
      tools: options.tools,
      systemInstruction: options.systemInstruction,
      generationConfig: options.generationConfig,
    });
    payload.stream = true;

    const endpoint = this.getEndpoint('chat/completions', true);
    const parentSignal = options.signal;

    return await this._requestWithRetry(async () => {
      const response = await this.fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: parentSignal,
      });

      if (!response.ok) await this._handleErrorResponse(response);

      return await this._parseOpenAISSE(response.body, options, parentSignal);
    }, { signal: parentSignal, logger: this.logger });
  }

  async _parseOpenAISSE(body, options, parentSignal) {
    const tokens = [];
    const functionCalls = [];
    let finishReason = null;
    const toolCallBuffers = {}; // index -> { name, argsParts }

    const decoder = new TextDecoder();
    let buffer = '';

    const emitToolCalls = () => {
      for (const idx of Object.keys(toolCallBuffers)) {
        const b = toolCallBuffers[idx];
        let args = {};
        if (b.argsParts.length) {
          try { args = JSON.parse(b.argsParts.join('')); } catch { args = {}; }
        }
        functionCalls.push({ name: b.name, args });
        if (typeof options.onFunctionCall === 'function') {
          options.onFunctionCall({ name: b.name, args });
        }
      }
      Object.keys(toolCallBuffers).forEach(k => delete toolCallBuffers[k]);
    };

    const onChunk = (line) => {
      line = line.trim();
      if (!line || line === 'data: [DONE]') return;
      if (!line.startsWith('data:')) return;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) return;
      let data;
      try { data = JSON.parse(jsonStr); } catch { return; }

      if (data.choices && data.choices.length === 0) {
        finishReason = 'STOP';
        return;
      }

      const choice = data.choices?.[0];
      if (!choice || !choice.delta) return;

      if (choice.delta.content) {
        tokens.push(choice.delta.content);
        if (typeof options.onToken === 'function') options.onToken(choice.delta.content);
        if (typeof options.onChunk === 'function') options.onChunk(choice.delta.content);
      }

      if (choice.delta.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const i = tc.index ?? 0;
          if (!toolCallBuffers[i]) toolCallBuffers[i] = { name: '', argsParts: [] };
          if (tc.function?.name) toolCallBuffers[i].name = tc.function.name;
          if (tc.function?.arguments) toolCallBuffers[i].argsParts.push(tc.function.arguments);
        }
      }

      const fr = choice.finish_reason ?? choice.delta?.finish_reason;
      if (fr !== undefined) {
        const map = { stop: 'STOP', length: 'MAX_TOKENS', tool_calls: 'STOP' };
        finishReason = map[fr] ?? fr ?? null;
        if (typeof options.onFinish === 'function') options.onFinish(finishReason);
        if (finishReason !== null) {
          emitToolCalls();
        }
      }

      if (parentSignal?.aborted) throw parentSignal.reason || new Error('Aborted');
    };

    if (body) {
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nlIdx;
        while ((nlIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 1);
          onChunk(line);
        }
      }
      if (buffer.trim()) onChunk(buffer);
    }

    emitToolCalls();

    return {
      text: tokens.join(''),
      functionCalls,
      finishReason,
      usage: null,
      raw: null,
    };
  }

  async generate(options = {}) {
    this._validateApiKey();
    const payload = this.buildRequestBody({
      contents: options.contents,
      tools: options.tools,
      systemInstruction: options.systemInstruction,
      generationConfig: options.generationConfig,
    });
    const endpoint = this.getEndpoint('chat/completions', false);
    const parentSignal = options.signal;

    return await this._requestWithRetry(async () => {
      const response = await this.fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: parentSignal,
      });

      if (!response.ok) await this._handleErrorResponse(response);

      const data = await response.json();
      return this._extractNonStreamResult(data);
    }, { signal: parentSignal, logger: this.logger });
  }

  _validateApiKey() {
    if (!this.apiKey || typeof this.apiKey !== 'string' || this.apiKey.trim() === '') {
      throw new Error("OpenAI API key is not configured. Set OPENAI_API_KEY or run 'termuxai provider add openai'.");
    }
  }

  async _handleErrorResponse(response) {
    let errorDetails = null;
    let errorMessage = '';
    try {
      errorDetails = await response.json();
      if (errorDetails?.error?.message) errorMessage = errorDetails.error.message;
    } catch {}
    if (!errorMessage) {
      try { errorMessage = await response.text(); } catch {}
      if (!errorMessage) errorMessage = `HTTP error ${response.status} ${response.statusText}`;
    }
    const error = new Error(`OpenAI API Error (${response.status}): ${errorMessage}`);
    error.status = response.status;
    error.statusCode = response.status;
    error.details = errorDetails;
    throw error;
  }

  _extractNonStreamResult(data) {
    let text = '';
    const functionCalls = [];
    let finishReason = null;

    const choice = data.choices?.[0];
    if (choice) {
      if (choice.message?.content) text = choice.message.content;
      if (choice.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          let args = {};
          if (tc.function?.arguments) {
            try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
          }
          functionCalls.push({ name: tc.function.name, args });
        }
      }
      const map = { stop: 'STOP', length: 'MAX_TOKENS', tool_calls: 'STOP' };
      finishReason = map[choice.finish_reason] ?? choice.finish_reason ?? null;
    }

    let usage = null;
    if (data.usage) {
      usage = {
        promptTokenCount: data.usage.prompt_tokens ?? 0,
        candidatesTokenCount: data.usage.completion_tokens ?? 0,
        totalTokenCount: data.usage.total_tokens ?? 0,
      };
    }

    return { text, functionCalls, finishReason, usage, raw: data };
  }
}
