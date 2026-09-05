/**
 * Interactive Security Confirmation Dialog (Human-In-The-Loop)
 *
 * Renders a rich, keyboard-navigable confirmation box when the SecurityGuard
 * intercepts a risky action. Follows the same raw-mode pattern as model-menu.js.
 *
 * Navigation:
 *   ↑ / k           — move cursor up
 *   ↓ / j           — move cursor down
 *   1 / y / Y       — shortcut: select "Allow"
 *   2 / n / N       — shortcut: select "Deny"
 *   Enter           — confirm highlighted selection
 *   Esc / Ctrl+C    — abort (treated as Deny)
 *
 * Non-TTY fallback: resolves false (Deny) automatically so unattended
 * pipelines and test runners never hang waiting for keyboard input.
 */

import readline from 'node:readline';
import { ansi } from '../utils/ansi.js';

/** @type {(s: string) => number} strip ANSI then measure visible length */
const visibleLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

/**
 * Pad or truncate a string to an exact visible character width.
 * @param {string} s
 * @param {number} width
 * @returns {string}
 */
function padRight(s, width) {
  const vl = visibleLen(s);
  if (vl >= width) return s;
  return s + ' '.repeat(width - vl);
}

/**
 * Word-wrap a plain string to fit within `maxWidth` characters per line.
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
function wordWrap(text, maxWidth) {
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

const MENU_OPTIONS = [
  {
    index: 0,
    shortLabel: '1. Iya',
    fullLabel: 'Iya  — Izinkan & jalankan tindakan ini',
    value: true,
    color: (s) => ansi.green(s),
    icon: '✔',
  },
  {
    index: 1,
    shortLabel: '2. Tolak',
    fullLabel: 'Tolak — Batalkan tindakan ini (Aman)',
    value: false,
    color: (s) => ansi.red(s),
    icon: '✖',
  },
];

const DEFAULT_SELECTED = 1; // Default: cursor di "Tolak" (aman)

/**
 * Render satu frame penuh dialog ke output stream.
 *
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.description
 * @param {string} [params.target]
 * @param {string} params.question
 * @param {number} params.selected  — index opsi yang sedang dipilih (0 atau 1)
 * @param {NodeJS.WritableStream} params.output
 */
function renderDialog({ title, description, target, question, selected, output }) {
  const INNER_W = 58; // lebar konten di dalam kotak (tanpa border)
  const PAD = ' '; // padding kiri/kanan 1 spasi

  const col = ansi.yellow;
  const border = {
    tl: '╭', tr: '╮',
    bl: '╰', br: '╯',
    h: '─', v: '│',
  };

  const line = (content = '') => {
    const filled = padRight(PAD + content, INNER_W + 1) + PAD;
    return `${col(border.v)}${filled}${col(border.v)}`;
  };

  const divider = () =>
    `${col('├')}${col(border.h.repeat(INNER_W + 2))}${col('┤')}`;

  const topBar = `${col(border.tl)}${col(border.h.repeat(INNER_W + 2))}${col(border.tr)}`;
  const botBar = `${col(border.bl)}${col(border.h.repeat(INNER_W + 2))}${col(border.br)}`;

  const rows = [];

  // ── Judul ──────────────────────────────────────────────────────────────────
  rows.push(topBar);
  const titleStr = ansi.bold(ansi.yellow('⚠  PERINGATAN KEAMANAN'));
  rows.push(line(titleStr));
  if (title) {
    rows.push(line(ansi.dim(title)));
  }
  rows.push(divider());

  // ── Deskripsi ──────────────────────────────────────────────────────────────
  rows.push(line());
  const descLines = wordWrap(description, INNER_W - 2);
  for (const dl of descLines) {
    rows.push(line(ansi.white(dl)));
  }

  // ── Perintah / Target ──────────────────────────────────────────────────────
  if (target) {
    rows.push(line());
    rows.push(line(ansi.dim('┄ Perintah ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄')));
    // Potong dan wrap baris-baris command target
    const targetLines = target.split('\n');
    for (const tl of targetLines) {
      const wrapped = wordWrap(tl.trim(), INNER_W - 4);
      for (const wl of wrapped) {
        rows.push(line(`  ${ansi.cyan(wl)}`));
      }
    }
    rows.push(line(ansi.dim('┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄')));
  }

  // ── Pertanyaan ─────────────────────────────────────────────────────────────
  rows.push(line());
  rows.push(line(ansi.bold(ansi.white(question))));
  rows.push(line());

  // ── Opsi Pilihan ───────────────────────────────────────────────────────────
  for (const opt of MENU_OPTIONS) {
    const isSelected = opt.index === selected;
    const cursor = isSelected ? ansi.bold(ansi.yellow('▸')) : ' ';
    const label = isSelected
      ? ansi.bold(opt.color(`[${opt.shortLabel}]  ${opt.fullLabel.split('—')[1]?.trim() || ''}`.trim()))
      : ansi.dim(`  ${opt.fullLabel}`);
    rows.push(line(`  ${cursor} ${label}`));
  }

  // ── Petunjuk navigasi ──────────────────────────────────────────────────────
  rows.push(line());
  rows.push(divider());
  rows.push(
    line(ansi.dim('↑/↓ pilih  •  Enter konfirmasi  •  Esc/Ctrl+C tolak')),
  );
  rows.push(botBar);

  // Tulis ke output (hapus layar lalu tulis frame baru)
  output.write('\x1b[?25l'); // sembunyikan kursor
  output.write('\x1b[H\x1b[2J'); // clear screen
  output.write('\n' + rows.join('\n') + '\n');
}

/**
 * Bersihkan dialog dari layar dan kembalikan kursor.
 *
 * @param {NodeJS.WritableStream} output
 */
function clearDialog(output) {
  output.write('\x1b[?25h'); // tampilkan kursor
  output.write('\x1b[H\x1b[2J'); // clear screen
}

/**
 * Tampilkan dialog konfirmasi keamanan interaktif.
 *
 * @param {object} options
 * @param {string} [options.title='']           - Sub-judul konteks tindakan
 * @param {string} options.description          - Penjelasan manusiawi tindakan AI
 * @param {string} [options.target]             - Perintah / path / URL yang akan dieksekusi
 * @param {string} [options.question]           - Pertanyaan ke pengguna
 * @param {NodeJS.ReadableStream} [options.input=process.stdin]
 * @param {NodeJS.WritableStream} [options.output=process.stdout]
 * @param {boolean} [options.enabled]           - Override TTY detection
 * @returns {Promise<boolean>}                  true = Iya, false = Tolak
 */
export function showConfirmDialog(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const title = options.title || '';
  const description = options.description || 'AI ingin melakukan tindakan yang memerlukan konfirmasi Anda.';
  const target = options.target || '';
  const question = options.question || 'Apakah Anda mengizinkan tindakan ini?';

  // Deteksi TTY; non-TTY langsung auto-deny (aman)
  const isTTY = Boolean(input?.isTTY && output?.isTTY);
  const enabled = options.enabled !== undefined ? Boolean(options.enabled) : isTTY;

  return new Promise((resolve) => {
    if (!enabled) {
      // Non-TTY fallback: tolak secara otomatis agar aman di pipeline/test
      resolve(false);
      return;
    }

    let selected = DEFAULT_SELECTED;

    if (typeof input.setRawMode === 'function') {
      try { input.setRawMode(true); } catch (_) { /* ignore */ }
    }
    readline.emitKeypressEvents(input);
    if (typeof input.resume === 'function') input.resume();

    const keypressHandler = (_chunk, key) => {
      if (!key) return;

      // Ctrl+C → tolak
      if (key.ctrl && key.name === 'c') {
        done(false);
        return;
      }

      // Esc → tolak
      if (key.name === 'escape') {
        done(false);
        return;
      }

      // Enter → konfirmasi pilihan
      if (key.name === 'return' || key.name === 'enter') {
        done(MENU_OPTIONS[selected].value);
        return;
      }

      // Navigasi atas
      if (key.name === 'up' || key.name === 'k') {
        selected = (selected - 1 + MENU_OPTIONS.length) % MENU_OPTIONS.length;
        render();
        return;
      }

      // Navigasi bawah
      if (key.name === 'down' || key.name === 'j') {
        selected = (selected + 1) % MENU_OPTIONS.length;
        render();
        return;
      }

      // Shortcut angka: 1 = Iya, 2 = Tolak
      if (key.name === '1') { done(true); return; }
      if (key.name === '2') { done(false); return; }

      // Shortcut huruf: y = Iya, n = Tolak
      if (key.sequence === 'y' || key.sequence === 'Y') { done(true); return; }
      if (key.sequence === 'n' || key.sequence === 'N') { done(false); return; }
    };

    const onClose = () => done(false);

    function render() {
      renderDialog({ title, description, target, question, selected, output });
    }

    function done(value) {
      try { input.removeListener('keypress', keypressHandler); } catch (_) {}
      try { input.removeListener('close', onClose); } catch (_) {}
      try {
        if (typeof input.setRawMode === 'function' && input.isTTY) {
          input.setRawMode(false);
        }
      } catch (_) {}
      try {
        if (typeof input.pause === 'function') input.pause();
      } catch (_) {}
      clearDialog(output);
      resolve(value);
    }

    input.on('keypress', keypressHandler);
    input.on('close', onClose);

    render();
  });
}
