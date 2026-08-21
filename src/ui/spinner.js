/**
 * Non-blocking Live Terminal Spinner & Status Indicator
 * Designed for Termux CLI without third-party dependencies.
 */

import { ansi } from '../utils/ansi.js';

const DEFAULT_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DEFAULT_INTERVAL = 80;

export class Spinner {
  /**
   * @param {object} [options={}]
   * @param {string} [options.text=''] - Initial status text
   * @param {string[]} [options.frames] - Custom spinner frames
   * @param {number} [options.interval=80] - Animation frame interval (ms)
   * @param {NodeJS.WriteStream} [options.stream=process.stdout] - Output stream
   * @param {boolean} [options.enabled] - Force enable/disable
   */
  constructor(options = {}) {
    this.text = options.text || '';
    this.frames = options.frames || DEFAULT_FRAMES;
    this.interval = options.interval || DEFAULT_INTERVAL;
    this.stream = options.stream || process.stdout;
    this.enabled =
      options.enabled !== undefined
        ? Boolean(options.enabled)
        : Boolean(this.stream && this.stream.isTTY);

    this.frameIndex = 0;
    this.timer = null;
    this.spinning = false;
  }

  /**
   * Starts or resumes spinner animation
   * @param {string} [text]
   * @returns {Spinner}
   */
  start(text) {
    if (text !== undefined) {
      this.text = text;
    }

    if (this.spinning) {
      return this;
    }

    this.spinning = true;
    this.frameIndex = 0;

    if (!this.enabled) {
      if (this.text) {
        this.stream.write(`ℹ ${this.text}\n`);
      }
      return this;
    }

    // Hide cursor if supported
    if (this.stream.isTTY) {
      this.stream.write('\x1b[?25l');
    }

    this.render();

    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.render();
    }, this.interval);

    // Ensure timer doesn't hold event loop open if unref is available
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }

    return this;
  }

  /**
   * Renders the current frame to the terminal
   */
  render() {
    if (!this.enabled || !this.spinning) return;
    const frame = ansi.cyan(this.frames[this.frameIndex]);
    this.stream.write(`\r\x1b[K${frame} ${this.text}`);
  }

  /**
   * Updates spinner text
   * @param {string} text
   * @returns {Spinner}
   */
  update(text) {
    this.text = text || '';
    if (this.spinning && this.enabled) {
      this.render();
    }
    return this;
  }

  /**
   * Stops the spinner animation and clears the line
   * @returns {Spinner}
   */
  stop() {
    if (!this.spinning) return this;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.spinning = false;

    if (this.enabled) {
      this.stream.write('\r\x1b[K');
      if (this.stream.isTTY) {
        this.stream.write('\x1b[?25h'); // Show cursor
      }
    }

    return this;
  }

  /**
   * Stops spinner and prints a success mark
   * @param {string} [text]
   * @returns {Spinner}
   */
  succeed(text) {
    const msg = text !== undefined ? text : this.text;
    this.stop();
    const symbol = ansi.green('✔');
    this.stream.write(`${symbol} ${msg}\n`);
    return this;
  }

  /**
   * Stops spinner and prints a failure mark
   * @param {string} [text]
   * @returns {Spinner}
   */
  fail(text) {
    const msg = text !== undefined ? text : this.text;
    this.stop();
    const symbol = ansi.red('✖');
    this.stream.write(`${symbol} ${msg}\n`);
    return this;
  }

  /**
   * Stops spinner and prints a warning mark
   * @param {string} [text]
   * @returns {Spinner}
   */
  warn(text) {
    const msg = text !== undefined ? text : this.text;
    this.stop();
    const symbol = ansi.yellow('⚠');
    this.stream.write(`${symbol} ${msg}\n`);
    return this;
  }

  /**
   * Stops spinner and prints an info mark
   * @param {string} [text]
   * @returns {Spinner}
   */
  info(text) {
    const msg = text !== undefined ? text : this.text;
    this.stop();
    const symbol = ansi.cyan('ℹ');
    this.stream.write(`${symbol} ${msg}\n`);
    return this;
  }

  /**
   * Returns current spinning status
   * @returns {boolean}
   */
  isSpinning() {
    return this.spinning;
  }
}

/**
 * Factory to create a Spinner instance
 * @param {string|object} [options]
 * @returns {Spinner}
 */
export function createSpinner(options) {
  if (typeof options === 'string') {
    return new Spinner({ text: options });
  }
  return new Spinner(options);
}
