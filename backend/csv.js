// Escape CSV cells and neutralize spreadsheet formulas. Keep numeric values numeric.
const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
// Leading whitespace/control characters can be stripped by spreadsheet imports.
const FORMULA = /^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/u;

function cell(value) {
  if (value == null) return '';
  let text = String(value);
  if (FORMULA.test(text) && !NUMBER.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const row = (cells) => cells.map(cell).join(',');

module.exports = { cell, row };
