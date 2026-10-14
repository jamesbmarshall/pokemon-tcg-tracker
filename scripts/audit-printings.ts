/** Read-only catalogue audit. Usage: npm run audit:printings -- --out /tmp/printings.json [set IDs] [--lang en] [--baseline previous.json] */
import { readFileSync, writeFileSync } from 'node:fs';
import { getSets, getSetCards, type Lang } from '../packages/shared/src/catalog';
import { LANGUAGES, isLang, withLang } from '../packages/shared/src/languages';
import { PRINTING_VERSION, standardVariants } from '../packages/shared/src/printings';

const args = process.argv.slice(2);
function option(name: string, fallback?: string) {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const value = args[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  args.splice(at, 2);
  return value;
}
const output = option('--out', '/tmp/poketracker-printings.json')!;
const baselinePath = option('--baseline');
const language = option('--lang', 'en')!;
if (language !== 'all' && !isLang(language)) throw new Error('Unknown language');
const languages: Lang[] = language === 'all' ? LANGUAGES.map((l) => l.code) : [language as Lang];
const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, 'utf8')) : undefined;
const report: { version: number; at: string; language: string; sets: Record<string, unknown>; failures: Record<string, string> } = {
  version: PRINTING_VERSION, at: new Date().toISOString(), language, sets: {}, failures: {},
};
const sets: string[] = [];
const expectedTotals = new Map<string, number>();
for (const lang of languages) {
  try {
    const catalogue = await getSets(lang);
    for (const set of catalogue) expectedTotals.set(set.id, set.total);
    sets.push(...(args.length ? args.map((id) => id.includes(':') ? id : withLang(lang, id)) : catalogue.map((s) => s.id)));
  } catch (error) { report.failures[`language:${lang}`] = String(error); }
}
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < sets.length) {
    const id = sets[cursor++];
    try {
      const cards = await getSetCards(id);
      const masterTotal = cards.reduce((n, c) => n + standardVariants(c).length, 0);
      const allTotal = cards.reduce((n, c) => n + c.variants.length, 0);
      const printings = cards.flatMap((c) => (c.printings ?? []).map((p) => ({ cardId: c.id, name: c.name, ...p })));
      const previous = baseline?.sets?.[id];
      report.sets[id] = {
        cards: cards.length, expectedCards: expectedTotals.get(id), masterTotal, allTotal,
        profile: cards[0]?.printingProfile,
        roles: Object.fromEntries(['core', 'parallel', 'additional', 'unresolved'].map((role) => [role, printings.filter((p) => p.role === role).length])),
        coverage: !cards.length ? 'unavailable' : cards.length < (expectedTotals.get(id) ?? 0) ? 'incomplete' : printings.length > 0 && printings.every((p) => p.status === 'verified') ? 'verified' : 'provisional',
        changed: previous ? JSON.stringify(previous.printings) !== JSON.stringify(printings) : undefined,
        previousMasterTotal: previous?.masterTotal,
        review: printings.filter((p) => p.status === 'unverified'), printings,
      };
      process.stderr.write(`${id}: ${masterTotal} standard / ${allTotal} all printings\n`);
    } catch (error) { report.failures[id] = String(error); }
    if ((Object.keys(report.sets).length + Object.keys(report.failures).length) % 25 === 0) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
}));
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Audit saved to ${output}; ${Object.keys(report.sets).length} sets, ${Object.keys(report.failures).length} failures.`);
if (Object.keys(report.failures).length) process.exitCode = 1;
