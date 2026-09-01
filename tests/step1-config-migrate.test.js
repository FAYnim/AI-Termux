import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigManager } from '../src/config/manager.js';

test('migrates ~/.termuxai to ~/.faycli when .faycli missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-home-'));
  const oldDir = path.join(home, '.termuxai');
  fs.mkdirSync(path.join(oldDir, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'config.json'), JSON.stringify({ activeProvider: 'gemini' }));
  fs.writeFileSync(path.join(oldDir, 'sessions', 's1.json'), '{}');

  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const mgr = new ConfigManager();
    const dir = mgr.getConfigDir();
    assert.equal(path.basename(dir), '.faycli');
    assert.ok(fs.existsSync(path.join(dir, 'config.json')), 'config.json copied');
    assert.ok(fs.existsSync(path.join(dir, 'sessions', 's1.json')), 'sessions copied');
    assert.ok(fs.existsSync(oldDir), 'old dir kept as backup');
  } finally {
    process.env.HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('does NOT migrate when .faycli already exists', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'faycli-home2-'));
  const oldDir = path.join(home, '.termuxai');
  const newDir = path.join(home, '.faycli');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'config.json'), JSON.stringify({ activeProvider: 'old' }));
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(newDir, 'config.json'), JSON.stringify({ activeProvider: 'new' }));

  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const mgr = new ConfigManager();
    const dir = mgr.getConfigDir();
    assert.equal(path.basename(dir), '.faycli');
    const cfg = mgr.loadConfig();
    assert.equal(cfg.activeProvider, 'new', 'new dir wins, no overwrite');
  } finally {
    process.env.HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
