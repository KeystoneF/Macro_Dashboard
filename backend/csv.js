// One writer for every export. Two things have to happen to every cell.
//
// A quote inside a value has to be doubled, which the label columns were not
// doing: a series titled 6" pipe ended the field early and shifted every
// column after it.
//
// And a value opening with =, +, - or @ is a formula to a spreadsheet, not
// text. Provider titles are the input here and search now puts arbitrary FRED
// and Valet titles in reach, so those are prefixed with an apostrophe. A
// negative number opens with - as well, so numbers are matched first and left
// alone: quoting -3.5 as text would break every change column on the board.
const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const FORMULA = /^[=+\-@\t\r]/;

function cell(value) {
  if (value == null) return '';
  let text = String(value);
  if (FORMULA.test(text) && !NUMBER.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const row = (cells) => cells.map(cell).join(',');

module.exports = { cell, row };
