import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { SecurityGuard } from '../src/security/guard.js';
import { executeCommandTool } from '../src/tools/execute_command.js';
import { listDirTool } from '../src/tools/list_dir.js';
import { patchFileTool } from '../src/tools/patch_file.js';
import { readFileTool } from '../src/tools/read_file.js';
import { dispatchToolCall, getTool, getToolDeclarations } from '../src/tools/registry.js';
import { writeFileTool } from '../src/tools/write_file.js';

describe('Local Actuator Tools (src/tools/)', () => {
  let tempBaseDir;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-tools-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('write_file tool', () => {
    test('should write text content to a new file', async () => {
      const res = await writeFileTool(
        { filePath: 'test.txt', content: 'Hello World!' },
        { baseDir: tempBaseDir },
      );
      assert.equal(res.success, true);
      assert.equal(res.bytesWritten, 12);

      const saved = fs.readFileSync(path.join(tempBaseDir, 'test.txt'), 'utf-8');
      assert.equal(saved, 'Hello World!');
    });

    test('should auto-create nested directories when writing', async () => {
      const res = await writeFileTool(
        { filePath: 'nested/dir/structure/file.js', content: 'console.log(42);' },
        { baseDir: tempBaseDir },
      );
      assert.equal(res.success, true);
      assert.equal(res.createdDirs, true);

      const saved = fs.readFileSync(
        path.join(tempBaseDir, 'nested/dir/structure/file.js'),
        'utf-8',
      );
      assert.equal(saved, 'console.log(42);');
    });

    test('should overwrite existing file atomically', async () => {
      const target = 'existing.txt';
      await writeFileTool(
        { filePath: target, content: 'Initial version' },
        { baseDir: tempBaseDir },
      );
      const res = await writeFileTool(
        { filePath: target, content: 'Updated version' },
        { baseDir: tempBaseDir },
      );

      assert.equal(res.success, true);
      const saved = fs.readFileSync(path.join(tempBaseDir, target), 'utf-8');
      assert.equal(saved, 'Updated version');
    });
  });

  describe('read_file tool', () => {
    test('should read entire file content', async () => {
      const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      fs.writeFileSync(path.join(tempBaseDir, 'sample.txt'), content);

      const res = await readFileTool({ filePath: 'sample.txt' }, { baseDir: tempBaseDir });
      assert.equal(res.content, content);
      assert.equal(res.totalLines, 5);
      assert.equal(res.startLine, 1);
      assert.equal(res.endLine, 5);
      assert.equal(res.truncated, false);
    });

    test('should slice line ranges accurately', async () => {
      const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
      fs.writeFileSync(path.join(tempBaseDir, 'sample.txt'), content);

      const res = await readFileTool(
        { filePath: 'sample.txt', startLine: 2, endLine: 4 },
        { baseDir: tempBaseDir },
      );
      assert.equal(res.content, 'Line 2\nLine 3\nLine 4');
      assert.equal(res.startLine, 2);
      assert.equal(res.endLine, 4);
      assert.equal(res.totalLines, 5);
    });

    test('should detect binary files and return metadata instead of text', async () => {
      const binFile = path.join(tempBaseDir, 'image.png');
      fs.writeFileSync(binFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      const res = await readFileTool({ filePath: 'image.png' }, { baseDir: tempBaseDir });
      assert.equal(res.isBinary, true);
      assert.match(res.message, /Binary file detected/i);
    });

    test('should throw error for non-existent file or directory target', async () => {
      await assert.rejects(async () => {
        await readFileTool({ filePath: 'missing.txt' }, { baseDir: tempBaseDir });
      }, /File not found/);

      fs.mkdirSync(path.join(tempBaseDir, 'a_folder'));
      await assert.rejects(async () => {
        await readFileTool({ filePath: 'a_folder' }, { baseDir: tempBaseDir });
      }, /Path is a directory/);
    });
  });

  describe('patch_file tool', () => {
    test('should perform exact search and replace on unique substring', async () => {
      const content = `function add(a, b) {\n  return a - b;\n}`;
      fs.writeFileSync(path.join(tempBaseDir, 'calc.js'), content);

      const res = await patchFileTool(
        {
          filePath: 'calc.js',
          searchString: 'return a - b;',
          replaceString: 'return a + b;',
        },
        { baseDir: tempBaseDir },
      );

      assert.equal(res.success, true);
      const updated = fs.readFileSync(path.join(tempBaseDir, 'calc.js'), 'utf-8');
      assert.equal(updated, `function add(a, b) {\n  return a + b;\n}`);
    });

    test('should throw error if searchString is not found', async () => {
      fs.writeFileSync(path.join(tempBaseDir, 'test.js'), 'const x = 10;');

      await assert.rejects(async () => {
        await patchFileTool(
          {
            filePath: 'test.js',
            searchString: 'const y = 20;',
            replaceString: 'const y = 30;',
          },
          { baseDir: tempBaseDir },
        );
      }, /searchString was not found/);
    });

    test('should throw error if searchString occurs multiple times', async () => {
      const content = `console.log("hello");\nconsole.log("hello");`;
      fs.writeFileSync(path.join(tempBaseDir, 'dup.js'), content);

      await assert.rejects(async () => {
        await patchFileTool(
          {
            filePath: 'dup.js',
            searchString: 'console.log("hello");',
            replaceString: 'console.log("world");',
          },
          { baseDir: tempBaseDir },
        );
      }, /occurs 2 times/);
    });
  });

  describe('list_dir tool', () => {
    test('should list directory tree structure and filter ignored patterns', async () => {
      fs.mkdirSync(path.join(tempBaseDir, 'src'));
      fs.mkdirSync(path.join(tempBaseDir, 'node_modules', 'foo'), { recursive: true });
      fs.mkdirSync(path.join(tempBaseDir, '.git'));
      fs.writeFileSync(path.join(tempBaseDir, 'src', 'index.js'), 'console.log(1);');
      fs.writeFileSync(path.join(tempBaseDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempBaseDir, 'node_modules', 'foo', 'index.js'), 'ignore me');

      const res = await listDirTool({ dirPath: '.' }, { baseDir: tempBaseDir });
      assert.ok(res.tree);
      assert.equal(res.totalFiles, 2); // src/index.js + package.json (node_modules & .git ignored)
      assert.equal(res.totalDirs, 1); // src

      assert.ok(res.tree.includes('index.js'));
      assert.ok(res.tree.includes('package.json'));
      assert.ok(!res.tree.includes('node_modules'));
      assert.ok(!res.tree.includes('.git'));
    });

    test('should respect max recursion depth', async () => {
      fs.mkdirSync(path.join(tempBaseDir, 'lvl1', 'lvl2', 'lvl3'), { recursive: true });
      fs.writeFileSync(path.join(tempBaseDir, 'lvl1', 'lvl2', 'lvl3', 'deep.txt'), 'deep');

      const resDepth1 = await listDirTool({ dirPath: '.', depth: 1 }, { baseDir: tempBaseDir });
      assert.ok(resDepth1.tree.includes('lvl1/'));
      assert.ok(!resDepth1.tree.includes('lvl2/'));
    });
  });

  describe('execute_command tool', () => {
    test('should execute shell command and capture stdout and exitCode 0', async () => {
      const res = await executeCommandTool(
        { command: 'node -e "console.log(\'test-output-123\')"' },
        { baseDir: tempBaseDir },
      );
      assert.equal(res.exitCode, 0);
      assert.equal(res.timedOut, false);
      assert.match(res.stdout, /test-output-123/);
      assert.ok(res.durationMs >= 0);
    });

    test('should capture non-zero exitCode and stderr on failure', async () => {
      const res = await executeCommandTool(
        { command: 'node -e "process.stderr.write(\'custom-error\'); process.exit(42)"' },
        { baseDir: tempBaseDir },
      );
      assert.equal(res.exitCode, 42);
      assert.match(res.stderr, /custom-error/);
    });

    test('should abort execution and mark timedOut when timeout is reached', async () => {
      const res = await executeCommandTool(
        {
          command: 'node -e "setTimeout(() => {}, 5000)"',
          timeoutMs: 150,
        },
        { baseDir: tempBaseDir },
      );
      assert.equal(res.timedOut, true);
      assert.equal(res.exitCode, 124);
      assert.match(res.stderr, /timed out after 150 ms/i);
    });

    test('should handle output truncation when limits are exceeded', async () => {
      const res = await executeCommandTool(
        { command: 'node -e "console.log(\'A\'.repeat(2000))"' },
        { baseDir: tempBaseDir, maxOutputSizeBytes: 500 },
      );
      assert.equal(res.truncated, true);
      assert.ok(res.stdout.includes('Output truncated'));
    });
  });

  describe('Tool Registry & Gemini Function Declarations', () => {
    test('should provide valid Gemini function declarations for all 5 tools', () => {
      const decls = getToolDeclarations();
      assert.equal(decls.length, 5);

      const names = decls.map((d) => d.name);
      assert.deepEqual(names.sort(), [
        'execute_command',
        'list_dir',
        'patch_file',
        'read_file',
        'write_file',
      ]);

      for (const decl of decls) {
        assert.ok(decl.name);
        assert.ok(decl.description);
        assert.ok(decl.parameters);
        assert.equal(decl.parameters.type, 'OBJECT');
        assert.ok(decl.parameters.properties);
      }
    });

    test('should retrieve registered tools via getTool()', () => {
      assert.equal(typeof getTool('read_file'), 'function');
      assert.equal(typeof getTool('write_file'), 'function');
      assert.equal(typeof getTool('patch_file'), 'function');
      assert.equal(typeof getTool('list_dir'), 'function');
      assert.equal(typeof getTool('execute_command'), 'function');
      assert.equal(getTool('non_existent'), undefined);
    });

    test('should dispatch tool call successfully', async () => {
      const res = await dispatchToolCall(
        'write_file',
        { filePath: 'dispatch.txt', content: 'Dispatched successfully' },
        { baseDir: tempBaseDir },
      );
      assert.equal(res.success, true);
      assert.equal(res.result.success, true);

      const readRes = await dispatchToolCall(
        'read_file',
        { filePath: 'dispatch.txt' },
        { baseDir: tempBaseDir },
      );
      assert.equal(readRes.success, true);
      assert.equal(readRes.result.content, 'Dispatched successfully');
    });

    test('should block unauthorized tool calls through SecurityGuard in dispatchToolCall', async () => {
      const guard = new SecurityGuard({
        baseDir: tempBaseDir,
        confirmationHandler: async () => false, // reject risky action
      });

      const res = await dispatchToolCall(
        'execute_command',
        { command: 'rm dangerous.txt' },
        { baseDir: tempBaseDir, securityGuard: guard },
      );

      assert.equal(res.error, true);
      assert.match(res.message, /User denied execution/i);
    });

    test('should handle unknown tool gracefully without throwing', async () => {
      const res = await dispatchToolCall('unknown_magic_tool', {});
      assert.equal(res.error, true);
      assert.match(res.message, /not recognized/i);
    });
  });
});
