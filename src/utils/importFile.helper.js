const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const csv = require('csv-parser');
const { normalizeRow } = require('./utils.helper');

async function readInputFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.csv') {
    const rows = [];
    await pipeline(
      fs.createReadStream(filePath),
      csv({ mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim() }),
      async function (source) {
        for await (const row of source) {
          if (Object.values(row).some(value => value !== '')) {
            rows.push(normalizeRow(row));
          }
        }
      }
    );
    return rows;
  }

  if (extension === '.xlsx' || extension === '.xls') {
    // CSV imports do not need to load the Excel parser.
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: null }).map(row => {
      // Decode Excel serial dates explicitly; JavaScript treats numbers as milliseconds.
      for (const column of ['dob', 'policy_start_date', 'policy_end_date']) {
        if (typeof row[column] === 'number') {
          const date = XLSX.SSF.parse_date_code(row[column], {
            date1904: workbook.Workbook?.WBProps?.date1904
          });
          row[column] = date
            ? new Date(Date.UTC(date.y, date.m - 1, date.d, date.H, date.M, date.S, Math.round(date.u * 1000)))
            : new Date(NaN);
        }
      }
      return normalizeRow(row);
    });
  }

  throw new Error(`Unsupported file format: ${extension}`);
}

module.exports = { readInputFile };
