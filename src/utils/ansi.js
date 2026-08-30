/**
 * Zero-dependency ANSI formatting and color utility
 * Lightweight, fast (< 0.1ms overhead)
 */

let colorsEnabled =
  !process.env.NO_COLOR && (Boolean(process.env.FORCE_COLOR) || Boolean(process.stdout?.isTTY));

export function setColorEnabled(enabled) {
  colorsEnabled = Boolean(enabled);
}

export function isColorEnabled() {
  return colorsEnabled;
}

function wrap(startCode, endCode) {
  return (str) => {
    if (!colorsEnabled || str === undefined || str === null) {
      return String(str ?? '');
    }
    return `\x1b[${startCode}m${str}\x1b[${endCode}m`;
  };
}

export const ansi = {
  // Styles
  reset: wrap(0, 0),
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  inverse: wrap(7, 27),
  strikethrough: wrap(9, 29),

  // Standard Colors
  black: wrap(30, 39),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  white: wrap(37, 39),
  gray: wrap(90, 39),
  grey: wrap(90, 39),

  // Bright Colors
  redBright: wrap(91, 39),
  greenBright: wrap(92, 39),
  yellowBright: wrap(93, 39),
  blueBright: wrap(94, 39),
  magentaBright: wrap(95, 39),
  cyanBright: wrap(96, 39),
  whiteBright: wrap(97, 39),

  // Background Colors
  bgBlack: wrap(40, 49),
  bgRed: wrap(41, 49),
  bgGreen: wrap(42, 49),
  bgYellow: wrap(43, 49),
  bgBlue: wrap(44, 49),
  bgMagenta: wrap(45, 49),
  bgCyan: wrap(46, 49),
  bgWhite: wrap(47, 49),
  bgGray: wrap(100, 49),
};

/**
 * Remove all ANSI escape codes from a string
 * @param {string} str
 * @returns {string}
 */
export function stripAnsi(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
