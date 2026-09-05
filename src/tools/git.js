/**
 * Tools: git_status, git_diff, git_add_commit
 * Spawn the git binary with an argv array (never a shell string) so file
 * paths cannot inject shell metacharacters.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

const GIT_TIMEOUT_MS = 15000;

/**
 * Run git with argv args in cwd. Resolves { code, stdout, stderr }.
 * Rejects only when the git binary itself cannot spawn or times out.
 */
function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS}ms`));
    }, GIT_TIMEOUT_MS);
    child.stdout.on('data', (c) => {
      stdout += c.toString('utf-8');
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString('utf-8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`git is not available: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function resolveCwd(args, context) {
  return path.resolve(context.baseDir || process.cwd(), args.workingDir || '.');
}

/** Ensures cwd is a git work tree; throws a model-readable error otherwise. */
async function assertGitRepo(cwd) {
  const check = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  if (check.code !== 0) {
    throw new Error(
      `"${cwd}" is not a git repository: ${check.stderr.trim() || 'git rev-parse failed'}`,
    );
  }
}

/**
 * @param {object} args
 * @param {string} [args.workingDir]
 * @param {object} [context]
 */
export async function gitStatusTool(args = {}, context = {}) {
  const cwd = resolveCwd(args, context);
  await assertGitRepo(cwd);
  const { code, stdout, stderr } = await runGit(['status', '--porcelain=v1', '-b'], cwd);
  if (code !== 0) {
    throw new Error(`git status failed: ${stderr.trim()}`);
  }

  const lines = stdout.split('\n').filter(Boolean);
  let branch = '(detached)';
  const changes = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      // "## main...origin/main" or "## HEAD (no branch)"
      branch = line.slice(3).split('...')[0].trim();
      continue;
    }
    changes.push({ status: line.slice(0, 2).trim() || '??', path: line.slice(3) });
  }

  return { branch, isDirty: changes.length > 0, changes, raw: stdout };
}

/**
 * @param {object} args
 * @param {string} [args.file] - limit diff to one path
 * @param {boolean} [args.staged=false] - diff the index instead of work tree
 * @param {string} [args.workingDir]
 * @param {object} [context]
 */
export async function gitDiffTool(args = {}, context = {}) {
  const cwd = resolveCwd(args, context);
  await assertGitRepo(cwd);
  const gitArgs = ['diff'];
  if (args.staged) gitArgs.push('--cached');
  if (args.file) gitArgs.push('--', args.file);
  const { code, stdout, stderr } = await runGit(gitArgs, cwd);
  if (code !== 0) {
    throw new Error(`git diff failed: ${stderr.trim()}`);
  }
  return { diff: stdout, hasChanges: stdout.trim().length > 0 };
}

/**
 * @param {object} args
 * @param {string} args.message - commit message (required)
 * @param {string[]} [args.files=['.']] - paths to stage
 * @param {string} [args.workingDir]
 * @param {object} [context]
 */
export async function gitAddCommitTool(args = {}, context = {}) {
  const { message, files = ['.'] } = args;
  if (!message || typeof message !== 'string') {
    throw new Error('Missing or invalid "message" argument (commit message string)');
  }
  const fileList = (Array.isArray(files) ? files : [files]).map(String);
  const cwd = resolveCwd(args, context);
  await assertGitRepo(cwd);

  const add = await runGit(['add', '--', ...fileList], cwd);
  if (add.code !== 0) {
    throw new Error(`git add failed: ${add.stderr.trim()}`);
  }

  const commit = await runGit(['commit', '-m', message], cwd);
  const committed = commit.code === 0;
  return {
    committed,
    message: committed ? message : null,
    output: `${commit.stdout}${commit.stderr}`.trim(),
  };
}
