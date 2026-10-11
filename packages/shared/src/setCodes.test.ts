import { describe, expect, it } from 'vitest';
import { STATIC_CODE_INDEX, buildCodeIndex, knownCodes, setIdsForCode } from './setCodes';

describe('setCodes', () => {
  it('maps modern Scarlet & Violet codes to their TCGdex set id', () => {
    expect(setIdsForCode('SVI')).toEqual(['sv01']);
    expect(setIdsForCode('PAL')).toEqual(['sv02']);
    expect(setIdsForCode('OBF')).toEqual(['sv03']);
    expect(setIdsForCode('MEW')).toEqual(['sv03.5']);
    expect(setIdsForCode('PAR')).toEqual(['sv04']);
    expect(setIdsForCode('TEF')).toEqual(['sv05']);
    expect(setIdsForCode('TWM')).toEqual(['sv06']);
    expect(setIdsForCode('SFA')).toEqual(['sv06.5']);
    expect(setIdsForCode('SCR')).toEqual(['sv07']);
    expect(setIdsForCode('SSP')).toEqual(['sv08']);
    expect(setIdsForCode('PRE')).toEqual(['sv08.5']);
    expect(setIdsForCode('JTG')).toEqual(['sv09']);
    expect(setIdsForCode('DRI')).toEqual(['sv10']);
  });

  it('maps Sword & Shield era codes, including ones that share an id with a gallery subset', () => {
    expect(setIdsForCode('BRS')).toEqual(expect.arrayContaining(['swsh9', 'swsh9tg']));
    expect(setIdsForCode('ASR')).toEqual(expect.arrayContaining(['swsh10', 'swsh10tg']));
    expect(setIdsForCode('LOR')).toEqual(expect.arrayContaining(['swsh11', 'swsh11tg']));
    expect(setIdsForCode('SIT')).toEqual(expect.arrayContaining(['swsh12', 'swsh12tg']));
    expect(setIdsForCode('CRZ')).toEqual(expect.arrayContaining(['swsh12.5', 'swsh12.5gg']));
  });

  it('is case-insensitive', () => {
    expect(setIdsForCode('svi')).toEqual(['sv01']);
  });

  it('returns nothing for an unknown code', () => {
    expect(setIdsForCode('ZZZ')).toEqual([]);
  });

  it('lists every known code', () => {
    const codes = knownCodes();
    expect(codes).toContain('SVI');
    expect(codes).toContain('OBF');
    expect(codes.length).toBe(STATIC_CODE_INDEX.size);
  });

  it('folds in live ptcgoCode values from fetched sets, without losing the static fallback', () => {
    const index = buildCodeIndex([{ id: 'sv11', ptcgoCode: 'NEW' }, { id: 'sv01', ptcgoCode: 'SVI' }]);
    expect(setIdsForCode('NEW', index)).toEqual(['sv11']);
    expect(setIdsForCode('SVI', index)).toEqual(['sv01']);
    // A code not covered by the live sets passed in still resolves from the static table.
    expect(setIdsForCode('PAL', index)).toEqual(['sv02']);
  });
});
