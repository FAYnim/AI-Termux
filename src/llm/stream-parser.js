/**
 * Server-Sent Events (SSE) Stream Parser for Google Gemini API
 * Parses real-time streaming tokens, function calls, usage metadata, and fragmented JSON buffers.
 */

export class SSEStreamParser {
  /**
   * @param {object} [callbacks={}]
   * @param {(token: string) => void} [callbacks.onToken] - Called on each text token
   * @param {(token: string) => void} [callbacks.onChunk] - Alias for onToken
   * @param {(call: { name: string, args: object }) => void} [callbacks.onFunctionCall] - Called on function call
   * @param {(reason: string) => void} [callbacks.onFinish] - Called when finish reason received
   * @param {(error: Error) => void} [callbacks.onError] - Called on parsing error
   */
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.decoder = new TextDecoder('utf-8');
    this.buffer = '';
    this.accumulatedText = '';
    this.functionCalls = [];
    this.finishReason = null;
    this.usage = null;
    this.rawCandidates = [];
    this.isDone = false;
  }

  /**
   * Feeds a chunk of data (Uint8Array, Buffer, or string) into the parser.
   *
   * @param {Uint8Array|Buffer|string} chunk
   */
  feed(chunk) {
    if (!chunk) return;

    let textChunk = '';
    if (typeof chunk === 'string') {
      textChunk = chunk;
    } else {
      textChunk = this.decoder.decode(chunk, { stream: true });
    }

    this.buffer += textChunk;
    this._processBuffer();
  }

  /**
   * Internal method to process lines in the buffer.
   * @private
   */
  _processBuffer() {
    let newlineIndex = this.buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trimEnd();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      this._parseLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  /**
   * Parses a single SSE line.
   *
   * @param {string} line
   * @private
   */
  _parseLine(line) {
    const trimmed = line.trim();

    // Skip empty lines or SSE comment lines (e.g. ": ping")
    if (!trimmed || trimmed.startsWith(':')) {
      return;
    }

    // Check for SSE data line
    if (trimmed.startsWith('data:')) {
      const dataStr = trimmed.slice(5).trim();

      if (!dataStr) return;

      if (dataStr === '[DONE]') {
        this.isDone = true;
        return;
      }

      try {
        const payload = JSON.parse(dataStr);
        this._handlePayload(payload);
      } catch (err) {
        // If JSON parsing failed on a complete line, emit error if listener attached
        if (typeof this.callbacks.onError === 'function') {
          this.callbacks.onError(new Error(`Failed to parse SSE JSON payload: ${err.message}`));
        } else {
          throw new Error(`Failed to parse SSE JSON payload: ${err.message} (Data: "${dataStr}")`);
        }
      }
    }
  }

  /**
   * Handles a parsed Gemini JSON payload.
   *
   * @param {object} payload
   * @private
   */
  _handlePayload(payload) {
    // Check for API-level error in payload
    if (payload.error) {
      const errorMsg = payload.error.message || 'Stream error in payload';
      const error = new Error(`Gemini API Stream Error: ${errorMsg}`);
      error.code = payload.error.code;
      error.status = payload.error.status;
      if (typeof this.callbacks.onError === 'function') {
        this.callbacks.onError(error);
        return;
      }
      throw error;
    }

    // Capture usageMetadata if present
    if (payload.usageMetadata) {
      this.usage = {
        promptTokenCount: payload.usageMetadata.promptTokenCount ?? 0,
        candidatesTokenCount: payload.usageMetadata.candidatesTokenCount ?? 0,
        totalTokenCount: payload.usageMetadata.totalTokenCount ?? 0,
      };
    }

    // Process candidates
    const candidates = payload.candidates;
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) {
        this.rawCandidates.push(candidate);

        // Check finish reason
        if (candidate.finishReason) {
          this.finishReason = candidate.finishReason;
          if (typeof this.callbacks.onFinish === 'function') {
            this.callbacks.onFinish(candidate.finishReason);
          }
        }

        // Process content parts
        const parts = candidate.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            // Text token
            if (part.text) {
              this.accumulatedText += part.text;

              if (typeof this.callbacks.onToken === 'function') {
                this.callbacks.onToken(part.text);
              }
              if (
                typeof this.callbacks.onChunk === 'function' &&
                this.callbacks.onChunk !== this.callbacks.onToken
              ) {
                this.callbacks.onChunk(part.text);
              }
            }

            // Function call
            if (part.functionCall) {
              const call = {
                name: part.functionCall.name,
                args: part.functionCall.args || {},
              };
              // Gemini 3+ signs function call parts with thoughtSignature and
              // rejects the follow-up request with 400 if it is not echoed back.
              if (part.thoughtSignature) {
                call.thoughtSignature = part.thoughtSignature;
              }
              this.functionCalls.push(call);

              if (typeof this.callbacks.onFunctionCall === 'function') {
                this.callbacks.onFunctionCall(call);
              }
            }
          }
        }
      }
    }
  }

  /**
   * Flushes any remaining bytes in the decoder and remaining buffer.
   */
  flush() {
    const remainingDecoded = this.decoder.decode();
    if (remainingDecoded) {
      this.buffer += remainingDecoded;
    }

    if (this.buffer.trim()) {
      const remainingLine = this.buffer.trim();
      this.buffer = '';
      this._parseLine(remainingLine);
    }
  }

  /**
   * Returns the aggregated parsing result.
   *
   * @returns {{
   *   text: string,
   *   functionCalls: Array<{ name: string, args: object, thoughtSignature?: string }>,
   *   finishReason: string|null,
   *   usage: { promptTokenCount: number, candidatesTokenCount: number, totalTokenCount: number }|null,
   *   rawCandidates: Array<object>
   * }}
   */
  getResult() {
    return {
      text: this.accumulatedText,
      functionCalls: [...this.functionCalls],
      finishReason: this.finishReason,
      usage: this.usage,
      rawCandidates: [...this.rawCandidates],
    };
  }

  /**
   * Resets the parser state.
   */
  reset() {
    this.decoder = new TextDecoder('utf-8');
    this.buffer = '';
    this.accumulatedText = '';
    this.functionCalls = [];
    this.finishReason = null;
    this.usage = null;
    this.rawCandidates = [];
    this.isDone = false;
  }
}

/**
 * Parses an async iterable stream (e.g. `response.body`) into aggregated Gemini result.
 *
 * @param {AsyncIterable<Uint8Array|Buffer|string>|ReadableStream} stream
 * @param {object} [options={}]
 * @param {(token: string) => void} [options.onToken]
 * @param {(token: string) => void} [options.onChunk]
 * @param {(call: { name: string, args: object }) => void} [options.onFunctionCall]
 * @param {(reason: string) => void} [options.onFinish]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{
 *   text: string,
 *   functionCalls: Array<{ name: string, args: object, thoughtSignature?: string }>,
 *   finishReason: string|null,
 *   usage: object|null,
 *   rawCandidates: Array<object>
 * }>}
 */
export async function parseSSEStream(stream, options = {}) {
  const parser = new SSEStreamParser({
    onToken: options.onToken,
    onChunk: options.onChunk,
    onFunctionCall: options.onFunctionCall,
    onFinish: options.onFinish,
  });

  const signal = options.signal;

  if (signal?.aborted) {
    throw signal.reason || new Error('Stream parsing aborted');
  }

  // Handle ReadableStream or AsyncIterable
  if (stream) {
    if (typeof stream[Symbol.asyncIterator] === 'function') {
      for await (const chunk of stream) {
        if (signal?.aborted) {
          throw signal.reason || new Error('Stream parsing aborted');
        }
        parser.feed(chunk);
      }
    } else if (typeof stream.getReader === 'function') {
      const reader = stream.getReader();
      try {
        while (true) {
          if (signal?.aborted) {
            await reader.cancel();
            throw signal.reason || new Error('Stream parsing aborted');
          }
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(value);
        }
      } finally {
        reader.releaseLock?.();
      }
    }
  }

  parser.flush();
  return parser.getResult();
}
