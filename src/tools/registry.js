/**
 * Tool Registry & Gemini Function Declarations Generator
 */

import { readFileTool } from './read_file.js';
import { writeFileTool } from './write_file.js';
import { patchFileTool } from './patch_file.js';
import { listDirTool } from './list_dir.js';
import { executeCommandTool } from './execute_command.js';

/**
 * Mapping of all registered actuator tools
 */
export const TOOLS_MAP = {
  read_file: readFileTool,
  write_file: writeFileTool,
  patch_file: patchFileTool,
  list_dir: listDirTool,
  execute_command: executeCommandTool
};

/**
 * Gemini Function Declaration Schemas for all available tools
 */
export const TOOL_DECLARATIONS = [
  {
    name: 'read_file',
    description: 'Read content from a file with optional line range slicing and token protection.',
    parameters: {
      type: 'OBJECT',
      properties: {
        filePath: {
          type: 'STRING',
          description: 'Relative or absolute path to the file to read'
        },
        startLine: {
          type: 'INTEGER',
          description: '1-indexed starting line number for slicing (optional)'
        },
        endLine: {
          type: 'INTEGER',
          description: '1-indexed ending line number for slicing (optional)'
        },
        encoding: {
          type: 'STRING',
          description: 'File character encoding, defaults to utf-8'
        }
      },
      required: ['filePath']
    }
  },
  {
    name: 'write_file',
    description: 'Write text content to a destination file. Automatically creates parent directories and uses atomic write.',
    parameters: {
      type: 'OBJECT',
      properties: {
        filePath: {
          type: 'STRING',
          description: 'Destination file path'
        },
        content: {
          type: 'STRING',
          description: 'Full text content to write into the file'
        },
        encoding: {
          type: 'STRING',
          description: 'File character encoding, defaults to utf-8'
        }
      },
      required: ['filePath', 'content']
    }
  },
  {
    name: 'patch_file',
    description: 'Perform token-efficient exact search-and-replace on an existing file. The searchString must be unique.',
    parameters: {
      type: 'OBJECT',
      properties: {
        filePath: {
          type: 'STRING',
          description: 'Target file path to modify'
        },
        searchString: {
          type: 'STRING',
          description: 'Exact string to be replaced (must occur exactly once in the file)'
        },
        replaceString: {
          type: 'STRING',
          description: 'New string to replace the searchString with'
        }
      },
      required: ['filePath', 'searchString', 'replaceString']
    }
  },
  {
    name: 'list_dir',
    description: 'Inspect directory contents recursively with tree formatting, depth control, and ignore filtering (.git, node_modules).',
    parameters: {
      type: 'OBJECT',
      properties: {
        dirPath: {
          type: 'STRING',
          description: 'Directory path to inspect (defaults to current working directory .)'
        },
        depth: {
          type: 'INTEGER',
          description: 'Maximum depth level for recursive inspection (default 2)'
        },
        ignorePatterns: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Optional custom list of directory/file names to ignore'
        }
      }
    }
  },
  {
    name: 'execute_command',
    description: 'Execute a shell command locally in Termux or host environment with timeout protection.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: {
          type: 'STRING',
          description: 'Shell command line to execute'
        },
        workingDir: {
          type: 'STRING',
          description: 'Working directory for execution (defaults to workspace base directory)'
        },
        timeoutMs: {
          type: 'INTEGER',
          description: 'Execution timeout limit in milliseconds (defaults to 30000)'
        }
      },
      required: ['command']
    }
  }
];

/**
 * Returns Gemini API function declarations array
 *
 * @returns {Array<object>}
 */
export function getToolDeclarations() {
  return JSON.parse(JSON.stringify(TOOL_DECLARATIONS));
}

/**
 * Retrieves a tool function by its registered name
 *
 * @param {string} name
 * @returns {Function|undefined}
 */
export function getTool(name) {
  return TOOLS_MAP[name];
}

/**
 * Safely dispatches a tool call with security authorization check and error handling.
 *
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @param {object} [context={}] - Execution context (e.g. securityGuard, baseDir, logger)
 * @returns {Promise<{ success?: boolean, error?: boolean, result?: any, message?: string }>}
 */
export async function dispatchToolCall(name, args = {}, context = {}) {
  const tool = getTool(name);

  if (!tool) {
    return {
      error: true,
      message: `Tool "${name}" is not recognized. Available tools: ${Object.keys(TOOLS_MAP).join(', ')}`
    };
  }

  // Authorize via SecurityGuard if present in context
  if (context.securityGuard && typeof context.securityGuard.authorize === 'function') {
    try {
      const auth = await context.securityGuard.authorize(name, args);
      if (!auth.allowed) {
        return {
          error: true,
          message: auth.reason || `Security guard blocked execution of tool "${name}".`
        };
      }
    } catch (authErr) {
      return {
        error: true,
        message: `Security check failed: ${authErr.message || String(authErr)}`
      };
    }
  }

  try {
    const result = await tool(args, context);
    return {
      success: true,
      result
    };
  } catch (err) {
    return {
      error: true,
      message: err.message || String(err)
    };
  }
}
