/**
 * UNIX Stdin Piping Handler
 * Reads streams from standard input when piped into `t-ai`
 * Example: `cat error.log | t-ai "analisis masalah ini"`
 */

const DEFAULT_PIPE_TIMEOUT_MS = 5000;
const MAX_PIPE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Checks if the standard input is being piped
 * @param {NodeJS.ReadStream} [stream=process.stdin]
 * @returns {boolean}
 */
export function isPipedInput(stream = process.stdin) {
  if (!stream) return false;
  // If isTTY is false or undefined on stdin, input is likely piped or redirected
  return Boolean(stream.isTTY === false);
}

/**
 * Reads all data from standard input asynchronously
 *
 * @param {object} [options={}]
 * @param {NodeJS.ReadStream} [options.stream=process.stdin] - Input stream
 * @param {number} [options.timeoutMs=5000] - Read timeout
 * @param {number} [options.maxBytes=5242880] - Maximum allowed byte size
 * @returns {Promise<string>}
 */
export async function readPipedStdin(options = {}) {
  const stream = options.stream || process.stdin;
  const timeoutMs = options.timeoutMs || DEFAULT_PIPE_TIMEOUT_MS;
  const maxBytes = options.maxBytes || MAX_PIPE_SIZE_BYTES;

  // If stream is a TTY and not piped, return empty immediately
  if (stream.isTTY) {
    return '';
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      // If we read some chunks before timeout, resolve with what we have
      if (chunks.length > 0) {
        resolve(Buffer.concat(chunks).toString('utf8').trim());
      } else {
        resolve('');
      }
    }, timeoutMs);

    if (timer.unref) timer.unref();

    function onData(chunk) {
      if (settled) return;
      chunks.push(chunk);
      totalBytes += chunk.length;

      if (totalBytes > maxBytes) {
        settled = true;
        cleanup();
        reject(new Error(`Piped input exceeded maximum size limit (${Math.round(maxBytes / 1024 / 1024)}MB)`));
      }
    }

    function onEnd() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8').trim());
    }

    function onError(err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);

    // If stream is already ended / readable ended
    if (stream.readableEnded) {
      onEnd();
    } else if (typeof stream.resume === 'function') {
      stream.resume();
    }
  });
}

/**
 * Combines piped stdin content with user instruction
 *
 * @param {string} pipedContent
 * @param {string} [userPrompt='']
 * @returns {string} Formatted merged prompt
 */
export function mergePipedPrompt(pipedContent, userPrompt = '') {
  const content = (pipedContent || '').trim();
  const instruction = (userPrompt || '').trim();

  if (!content) {
    return instruction;
  }

  if (!instruction) {
    return `[Piped Input Content]:\n\`\`\`\n${content}\n\`\`\`\n\nPlease analyze, explain, or process the above input.`;
  }

  return `[Piped Input Content]:\n\`\`\`\n${content}\n\`\`\`\n\n[Instruction]:\n${instruction}`;
}
