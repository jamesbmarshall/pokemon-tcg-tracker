/**
 * Helpers for writing CSV safely. Any CSV we generate can contain user-controlled text (card
 * notes, labels, grading certificate numbers), so every cell is escaped to neutralise CSV
 * formula injection before it reaches a spreadsheet app.
 */

// Characters that spreadsheet apps (Excel, Sheets, LibreOffice) treat as the start of a formula
// when a cell is opened, per OWASP's CSV injection guidance.
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Escapes a single CSV cell for writing: neutralises formula-injection trigger characters by
 * prefixing a single quote (OWASP guidance), then quotes the cell if it contains a comma, quote,
 * or line break.
 */
export function csvCell(value: string): string {
  const guarded = value.length > 0 && FORMULA_TRIGGERS.has(value[0]) ? `'${value}` : value;
  return /["\n\r,]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Renders rows of cells as a comma-delimited CSV string, escaping every cell with `csvCell()`. */
export function toCsv(rows: (string | number | undefined | null)[][]): string {
  return rows.map((row) => row.map((cell) => csvCell(String(cell ?? ''))).join(',')).join('\n');
}
