import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it('leaves a normal value untouched', () => {
    expect(csvCell('Pikachu')).toBe('Pikachu');
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])('neutralises a cell starting with %j by prefixing a single quote', (trigger) => {
    const cell = csvCell(`${trigger}SUM(A1:A9)`);
    // The guard char itself may force quoting (e.g. \r), so strip CSV quoting before comparing.
    const unquoted = cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
    expect(unquoted.startsWith("'")).toBe(true);
    expect(unquoted).toBe(`'${trigger}SUM(A1:A9)`);
  });

  it('does not treat a trigger character in the middle of a cell as dangerous', () => {
    expect(csvCell('Charizard-Holo')).toBe('Charizard-Holo');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
  });

  it('quotes a cell containing an embedded comma', () => {
    expect(csvCell('Pikachu, the Mouse')).toBe('"Pikachu, the Mouse"');
  });

  it('quotes a cell containing an embedded newline', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('quotes a cell containing an embedded carriage return', () => {
    expect(csvCell('line1\rline2')).toBe('"line1\rline2"');
  });
});

describe('toCsv', () => {
  it('renders a header and rows, escaping each cell', () => {
    expect(toCsv([['Set', 'Reason'], ['Base, Set', '=HYPERLINK("http://evil")']])).toBe('Set,Reason\n"Base, Set","\'=HYPERLINK(""http://evil"")"');
  });

  it('coerces numbers, null and undefined to strings', () => {
    expect(toCsv([[1, null, undefined]])).toBe('1,,');
  });
});
