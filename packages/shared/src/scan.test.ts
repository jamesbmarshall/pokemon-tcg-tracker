import { describe, expect, it } from 'vitest';
import { parseScanText } from './scan';

describe('parseScanText', () => {
  it('reads a plain collector number and total', () => {
    const [c] = parseScanText('Some flavour text\n123/198\n©2023 Pokémon');
    expect(c).toMatchObject({ number: '123', total: '198' });
  });

  it('attaches a set code printed after the number', () => {
    const [c] = parseScanText('123/198 SVI');
    expect(c).toMatchObject({ number: '123', total: '198', setCode: 'SVI' });
  });

  it('attaches a set code printed before the number', () => {
    const [c] = parseScanText('OBF 045/197');
    expect(c).toMatchObject({ number: '045', total: '197', setCode: 'OBF' });
  });

  it('fixes an O misread as a zero', () => {
    const [c] = parseScanText('12O/198');
    expect(c).toMatchObject({ number: '120', total: '198' });
  });

  it('fixes a lowercase l misread as a one', () => {
    const [c] = parseScanText('l23/198');
    expect(c).toMatchObject({ number: '123', total: '198' });
  });

  it('reads a Trainer Gallery number', () => {
    const [c] = parseScanText('TG05/TG30');
    expect(c).toMatchObject({ number: 'TG05', total: 'TG30' });
  });

  it('reads a Galarian Gallery number', () => {
    const [c] = parseScanText('GG12/GG70');
    expect(c).toMatchObject({ number: 'GG12', total: 'GG70' });
  });

  it('reads a Shiny Vault number printed without its total', () => {
    const candidates = parseScanText('SV045');
    expect(candidates.some((c) => c.number === 'SV045' && !c.total)).toBe(true);
  });

  it('reads a Scarlet & Violet promo code with a space', () => {
    const [c] = parseScanText('SVP 064');
    expect(c).toMatchObject({ number: '064', setCode: 'PR-SV' });
    expect(c.total).toBeUndefined();
  });

  it('reads a Sword & Shield promo code with no space or trailing P', () => {
    const [c] = parseScanText('SWSH276');
    expect(c).toMatchObject({ number: '276', setCode: 'PR-SW' });
  });

  it('reads an XY promo code', () => {
    const [c] = parseScanText('XY177');
    expect(c).toMatchObject({ number: '177', setCode: 'xyp' });
  });

  it('ignores unrelated noise and still finds the number', () => {
    const [c] = parseScanText('Illustrator: Mitsuhiro Arita\n086/197\n℗ & © 2024 Pokémon/Nintendo/Creatures/GAME FREAK');
    expect(c).toMatchObject({ number: '086', total: '197' });
  });

  it('returns nothing for text with no recognisable number', () => {
    expect(parseScanText('Pikachu uses Thunderbolt')).toEqual([]);
  });

  it('ranks a promo or set-coded match above a bare fraction', () => {
    const candidates = parseScanText('123/198 SVI');
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(candidates.at(-1)!.confidence);
  });

  it('does not double count a subset fraction as a plain fraction too', () => {
    const candidates = parseScanText('TG05/TG30');
    expect(candidates).toHaveLength(1);
  });
});
