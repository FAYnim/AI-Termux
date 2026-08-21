/**
 * Gemini Message Types, Roles & Payload Serializers
 * Standardized for Google Gemini API v1beta
 */

export const GEMINI_ROLES = {
  USER: 'user',
  MODEL: 'model',
  FUNCTION: 'function',
  SYSTEM: 'system'
};

/**
 * Creates a User message content object for Gemini API
 *
 * @param {string|Array<object|string>} textOrParts - Text or array of parts
 * @returns {{ role: string, parts: Array<object> }}
 */
export function createUserMessage(textOrParts) {
  if (typeof textOrParts === 'string') {
    return {
      role: GEMINI_ROLES.USER,
      parts: [{ text: textOrParts }]
    };
  }

  if (Array.isArray(textOrParts)) {
    const parts = textOrParts.map(p => (typeof p === 'string' ? { text: p } : p));
    return {
      role: GEMINI_ROLES.USER,
      parts
    };
  }

  throw new TypeError('textOrParts must be a string or an array of parts/strings');
}

/**
 * Creates a Model message content object for Gemini API
 *
 * @param {string|Array<object|string>} textOrParts - Text or array of parts
 * @returns {{ role: string, parts: Array<object> }}
 */
export function createModelMessage(textOrParts) {
  if (typeof textOrParts === 'string') {
    return {
      role: GEMINI_ROLES.MODEL,
      parts: [{ text: textOrParts }]
    };
  }

  if (Array.isArray(textOrParts)) {
    const parts = textOrParts.map(p => (typeof p === 'string' ? { text: p } : p));
    return {
      role: GEMINI_ROLES.MODEL,
      parts
    };
  }

  throw new TypeError('textOrParts must be a string or an array of parts/strings');
}

/**
 * Creates a Function Call part object for Gemini API
 *
 * @param {string} name - Function name
 * @param {object} [args={}] - Function arguments
 * @returns {{ functionCall: { name: string, args: object } }}
 */
export function createFunctionCallPart(name, args = {}) {
  if (!name || typeof name !== 'string') {
    throw new TypeError('Function call name must be a non-empty string');
  }
  return {
    functionCall: {
      name,
      args: typeof args === 'object' && args !== null ? args : {}
    }
  };
}

/**
 * Creates a Function Response part object for Gemini API
 *
 * @param {string} name - Function name
 * @param {any} response - Execution response or object
 * @returns {{ functionResponse: { name: string, response: object } }}
 */
export function createFunctionResponsePart(name, response) {
  if (!name || typeof name !== 'string') {
    throw new TypeError('Function response name must be a non-empty string');
  }

  const responseObj =
    typeof response === 'object' && response !== null && !Array.isArray(response)
      ? response
      : { output: response };

  return {
    functionResponse: {
      name,
      response: responseObj
    }
  };
}

/**
 * Creates a Function Response message for Gemini API
 *
 * @param {string} name - Function name
 * @param {any} response - Execution response
 * @returns {{ role: string, parts: Array<object> }}
 */
export function createFunctionResponseMessage(name, response) {
  return {
    role: GEMINI_ROLES.FUNCTION,
    parts: [createFunctionResponsePart(name, response)]
  };
}

/**
 * Creates a System Instruction object for Gemini API
 *
 * @param {string|object} instruction - Text or instruction object
 * @returns {{ parts: Array<{ text: string }> }}
 */
export function createSystemInstruction(instruction) {
  if (!instruction) return undefined;

  if (typeof instruction === 'string') {
    return {
      parts: [{ text: instruction }]
    };
  }

  if (typeof instruction === 'object' && Array.isArray(instruction.parts)) {
    return instruction;
  }

  if (typeof instruction === 'object' && instruction.text) {
    return {
      parts: [{ text: instruction.text }]
    };
  }

  throw new TypeError('System instruction must be a string or an object with parts/text');
}

/**
 * Formats tool declarations for Gemini API payload
 *
 * @param {Array<object>|object} tools - Tool schemas or declarations
 * @returns {Array<object>|undefined}
 */
export function formatTools(tools) {
  if (!tools || (Array.isArray(tools) && tools.length === 0)) {
    return undefined;
  }

  // If already in Gemini API tool wrapper format [{ functionDeclarations: [...] }]
  if (Array.isArray(tools) && tools[0] && Array.isArray(tools[0].functionDeclarations)) {
    return tools;
  }

  // If single wrapper object { functionDeclarations: [...] }
  if (typeof tools === 'object' && Array.isArray(tools.functionDeclarations)) {
    return [tools];
  }

  // If list of tool declarations [{ name, description, parameters }]
  if (Array.isArray(tools)) {
    return [
      {
        functionDeclarations: tools
      }
    ];
  }

  return undefined;
}

/**
 * Normalizes a message or content object to ensure Gemini API compliance
 *
 * @param {object|string} content
 * @returns {{ role: string, parts: Array<object> }}
 */
export function normalizeContent(content) {
  if (typeof content === 'string') {
    return createUserMessage(content);
  }

  if (!content || typeof content !== 'object') {
    throw new TypeError('Content must be a string or a message object');
  }

  const role = content.role || GEMINI_ROLES.USER;
  let parts = content.parts;

  if (!parts) {
    if (content.text) {
      parts = [{ text: content.text }];
    } else if (content.functionCall) {
      parts = [{ functionCall: content.functionCall }];
    } else if (content.functionResponse) {
      parts = [{ functionResponse: content.functionResponse }];
    } else {
      parts = [{ text: '' }];
    }
  } else if (!Array.isArray(parts)) {
    parts = [parts];
  }

  // Normalize each part if it's a raw string
  const normalizedParts = parts.map(part => {
    if (typeof part === 'string') {
      return { text: part };
    }
    return part;
  });

  return {
    role,
    parts: normalizedParts
  };
}
