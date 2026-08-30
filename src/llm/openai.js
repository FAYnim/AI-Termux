/**
 * OpenAI-compatible Chat Completions adapter.
 * Translates Gemini request shape -> OpenAI, parses SSE stream back into Gemini-compatible result.
 */
import { BaseLlmClient } from './base.js';

/**
 * Recursively converts Gemini UPPERCASE schema types to standard lowercase JSON Schema types.
 * @param {object} schema
 * @returns {object}
 */
export function convertToJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) {
    return schema.map((item) => {
      if (item && typeof item === 'object') return convertToJsonSchema(item);
      return item;
    });
  }

  const res = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') {
      res[k] = v.toLowerCase();
    } else if (v && typeof v === 'object') {
      res[k] = convertToJsonSchema(v);
    } else {
      res[k] = v;
    }
  }
  return res;
}

export class OpenAIClient extends BaseLlmClient {
  constructor(options = {}) {
    super(options);
    this.apiVersion = options.apiVersion || 'v1';
    if (!this.baseUrl) {
      this.baseUrl = 'https://api.openai.com/v1';
    }
  }

  getEndpoint(action = 'chat/completions', _isStream = false) {
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
      const text =
        typeof systemInstruction === 'string'
          ? systemInstruction
          : systemInstruction.parts?.[0]?.text || '';
      if (text) messages.push({ role: 'system', content: text });
    }

    if (Array.isArray(contents)) {
      const toolCallIdQueue = [];

      for (const msg of contents) {
        if (msg.role === 'user') {
          const text = (msg.parts || []).map((p) => p.text || '').join('');
          messages.push({ role: 'user', content: text });
        } else if (msg.role === 'model') {
          const texts = [];
          const toolCalls = [];
          for (let pIdx = 0; pIdx < (msg.parts || []).length; pIdx++) {
            const part = msg.parts[pIdx];
            if (part.text) texts.push(part.text);
            if (part.functionCall) {
              const callId =
                part.functionCall.id ||
                part.functionCall.toolCallId ||
                `call_${Date.now()}_${pIdx}`;
              toolCallIdQueue.push({ name: part.functionCall.name, id: callId });
              toolCalls.push({
                id: callId,
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
          for (const part of msg.parts || []) {
            if (part.functionResponse) {
              let callId = part.functionResponse.toolCallId || part.functionResponse.id;
              if (!callId) {
                const qIdx = toolCallIdQueue.findIndex(
                  (q) => q.name === part.functionResponse.name,
                );
                if (qIdx !== -1) {
                  callId = toolCallIdQueue[qIdx].id;
                  toolCallIdQueue.splice(qIdx, 1);
                } else if (toolCallIdQueue.length > 0) {
                  callId = toolCallIdQueue.shift().id;
                } else {
                  callId = `call_${Date.now()}_0`;
                }
              }
              messages.push({
                role: 'tool',
                tool_call_id: callId,
                content: JSON.stringify(part.functionResponse.response),
              });
            }
          }
        }
      }
    }

    const payload = {
      model: this.model || 'gpt-4o-mini',
      messages,
    };

    // Tools: flat OpenAI shape
    if (tools && tools.length > 0) {
      const oaTools = [];
      for (const t of tools) {
        const fds = Array.isArray(t.functionDeclarations) ? t.functionDeclarations : [t];
        for (const fd of fds) {
          if (fd?.name) {
            oaTools.push({
              type: 'function',
              function: {
                name: fd.name,
                description: fd.description || '',
                parameters: convertToJsonSchema(fd.parameters),
              },
            });
          }
        }
      }
      if (oaTools.length) {
        payload.tools = oaTools;
        payload.tool_choice = 'auto';
      }
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

    return await this._requestWithRetry(
      async () => {
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
      },
      { signal: parentSignal, logger: this.logger },
    );
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
          try {
            args = JSON.parse(b.argsParts.join(''));
          } catch {
            args = {};
          }
        }
        functionCalls.push({ name: b.name, args });
        if (typeof options.onFunctionCall === 'function') {
          options.onFunctionCall({ name: b.name, args });
        }
      }
      Object.keys(toolCallBuffers).forEach((k) => {
        delete toolCallBuffers[k];
      });
    };

    const onChunk = (line) => {
      line = line.trim();
      if (!line || line === 'data: [DONE]') return;
      if (!line.startsWith('data:')) return;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) return;
      let data;
      try {
        data = JSON.parse(jsonStr);
      } catch {
        return;
      }

      if (data.choices && data.choices.length === 0) {
        finishReason = 'STOP';
        return;
      }

      const choice = data.choices?.[0];
      if (!choice?.delta) return;

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
        while (buffer.includes('\n')) {
          nlIdx = buffer.indexOf('\n');
          const line = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 1);
          onChunk(line);
        }
      }
      if (buffer.trim()) onChunk(buffer);
    }

    emitToolCalls();

    if (functionCalls.length === 0) {
      const rawText = tokens.join('');
      const fallbackCalls = parseTextToolCalls(rawText);
      if (fallbackCalls.length > 0) {
        functionCalls.push(...fallbackCalls);
        for (const fc of fallbackCalls) {
          if (typeof options.onFunctionCall === 'function') {
            options.onFunctionCall(fc);
          }
        }
      }
    }

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

    return await this._requestWithRetry(
      async () => {
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
      },
      { signal: parentSignal, logger: this.logger },
    );
  }

  _validateApiKey() {
    if (!this.apiKey || typeof this.apiKey !== 'string' || this.apiKey.trim() === '') {
      throw new Error(
        "OpenAI API key is not configured. Set OPENAI_API_KEY or run 'termuxai provider add openai'.",
      );
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
      try {
        errorMessage = await response.text();
      } catch {}
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
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              args = {};
            }
          }
          functionCalls.push({ name: tc.function.name, args });
        }
      }
      const map = { stop: 'STOP', length: 'MAX_TOKENS', tool_calls: 'STOP' };
      finishReason = map[choice.finish_reason] ?? choice.finish_reason ?? null;
    }

    if (functionCalls.length === 0 && text) {
      const fallbackCalls = parseTextToolCalls(text);
      if (fallbackCalls.length > 0) {
        functionCalls.push(...fallbackCalls);
      }
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

/**
 * Extracts embedded XML or JSON tool calls from raw assistant text (e.g. from DeepSeek-R1 / Qwen models).
 * @param {string} text
 * @returns {Array<{ name: string, args: object }>}
 */
export function parseTextToolCalls(rawText) {
  const calls = [];
  if (!rawText || typeof rawText !== 'string') return calls;

  // Strip reasoning think tags if present
  const text = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/think>/gi, '')
    .replace(/<think>/gi, '');

  const validTools = ['read_file', 'write_file', 'patch_file', 'list_dir', 'execute_command'];
  const validToolsRegex = validTools.join('|');

  // Helper to add call without duplicate
  const addCall = (name, args) => {
    if (!name || !args || typeof args !== 'object') return;
    const cleanName = name.trim();
    if (validTools.includes(cleanName)) {
      if (
        !calls.some((c) => c.name === cleanName && JSON.stringify(c.args) === JSON.stringify(args))
      ) {
        calls.push({ name: cleanName, args });
      }
    }
  };

  // Helper to extract JSON from a string
  const extractJson = (str) => {
    if (!str) return null;
    const firstBrace = str.indexOf('{');
    const lastBrace = str.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(str.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
    return null;
  };

  // Pattern 1: <tool_calls> ... <tool_call>write_file<tool_sep> ... { ... } ... </tool_calls>
  const toolCallsBlocks = text.matchAll(/<tool_calls?>([\s\S]*?)<\/tool_calls?>/gi);
  for (const match of toolCallsBlocks) {
    const block = match[1];
    const nameMatch = block.match(
      new RegExp(`(?:<tool_name>|<tool_call>|name[:=]?\\s*)?(${validToolsRegex})`, 'i'),
    );
    if (nameMatch) {
      const name = nameMatch[1];
      const parsedArgs = extractJson(block);
      if (parsedArgs) {
        addCall(name, parsedArgs);
      }
    }
  }

  // Pattern 2: XML tags <tool_call><_function_call>... or <function_call>...<tool_name>name</tool_name>...
  const xmlMatches = text.matchAll(
    /<(?:tool_call>)?<_(?:function_call|action)>([\s\S]*?)<\/(?:function_call|action)>/gi,
  );
  for (const match of xmlMatches) {
    const block = match[1];
    const nameMatch =
      block.match(/<tool_name>([\s\S]*?)<\/tool_name>/i) ||
      block.match(/<action_name>([\s\S]*?)<\/action_name>/i);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      const args = {};
      const tagMatches = block.matchAll(/<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/g);
      for (const tm of tagMatches) {
        const key = tm[1];
        if (key !== 'tool_name' && key !== 'action_name') {
          const mappedKey = key === 'path' ? 'filePath' : key;
          args[mappedKey] = tm[2].trim();
        }
      }
      addCall(name, args);
    }
  }

  // Pattern 2b: <function=write_file><parameter=filePath>...</parameter></function>
  const fnParamMatches = text.matchAll(/<function=([a-zA-Z0-9_]+)>([\s\S]*?)<\/function>/gi);
  for (const match of fnParamMatches) {
    const name = match[1].trim();
    const block = match[2];
    const args = {};
    const paramMatches = block.matchAll(
      /<parameter(?:=|\s+name=)["']?([a-zA-Z0-9_]+)["']?>([\s\S]*?)<\/parameter>/gi,
    );
    for (const pm of paramMatches) {
      const key = pm[1];
      const mappedKey = key === 'path' ? 'filePath' : key;
      args[mappedKey] = pm[2].trim();
    }
    addCall(name, args);
  }

  // Pattern 3: <tool_call> JSON </tool_call> or <function_call> JSON </function_call>
  const jsonMatches = text.matchAll(
    /<(?:tool_call|function_call)>\s*(\{[\s\S]*?\})\s*<\/(?:tool_call|function_call)>/gi,
  );
  for (const match of jsonMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      const name = parsed.name || parsed.tool || parsed.function;
      if (name) {
        const args =
          typeof parsed.arguments === 'string'
            ? JSON.parse(parsed.arguments)
            : parsed.arguments || parsed.args || parsed.parameters || {};
        addCall(name, args);
      }
    } catch {}
  }

  // Pattern 4: Markdown JSON code blocks
  const mdMatches = text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi);
  for (const match of mdMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      const name =
        parsed.name || parsed.tool || parsed.function || parsed.tool_name || parsed.action;
      if (name) {
        const args =
          typeof parsed.arguments === 'string'
            ? JSON.parse(parsed.arguments)
            : parsed.arguments || parsed.parameters || parsed.args || parsed.action_input || {};
        addCall(name, args);
      }
    } catch {}
  }

  // Pattern 5: Action: tool \n Action Input: {...}
  const actionMatch = text.match(
    /Action:\s*([a-zA-Z0-9_]+)[\s\S]*?Action\s*Input:\s*(\{[\s\S]*?\})/i,
  );
  if (actionMatch) {
    const name = actionMatch[1].trim();
    try {
      const args = JSON.parse(actionMatch[2]);
      addCall(name, args);
    } catch {}
  }

  // Pattern 6: Tool name followed by JSON object anywhere with arbitrary delimiter
  // e.g. execute_command\nwrite_file\n{"path": "..."} or write_file<tool_sep>{"filePath": ...}
  const plainRegex = new RegExp(
    `(?:^|\\n|\\s|<tool_call>)(${validToolsRegex})[^\\w{]*(\\{[\\s\\S]*?\\})`,
    'gi',
  );
  for (const match of text.matchAll(plainRegex)) {
    const name = match[1];
    try {
      const args = JSON.parse(match[2]);
      addCall(name, args);
    } catch {}
  }

  // Pattern 7: Standalone JSON object with characteristic tool parameters
  if (calls.length === 0) {
    const jsonObjectRegex = /\{[\s\S]*?\}/g;
    for (const match of text.matchAll(jsonObjectRegex)) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          if (
            obj.content !== undefined ||
            (obj.filePath && obj.content) ||
            (obj.path && obj.content)
          ) {
            addCall('write_file', obj);
          } else if (obj.searchString || obj.replaceString || obj.search || obj.replace) {
            addCall('patch_file', obj);
          } else if (obj.command || obj.cmd) {
            addCall('execute_command', obj);
          } else if (obj.dirPath || obj.depth) {
            addCall('list_dir', obj);
          } else if (obj.filePath || obj.path) {
            addCall('read_file', obj);
          }
        }
      } catch {}
    }
  }

  return calls;
}
