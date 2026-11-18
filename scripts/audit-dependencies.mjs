#!/usr/bin/env node
/** Fail closed on registry errors, new high/critical advisories, and stale exceptions. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const exceptions = JSON.parse(readFileSync(new URL('../security/advisory-exceptions.json', import.meta.url), 'utf8'));
const now = Date.now();
for (const e of exceptions) if (!e.url?.startsWith('https://github.com/advisories/') || !e.reason || !e.owner || !Number.isFinite(Date.parse(e.expires)) || Date.parse(e.expires) <= now || Date.parse(e.expires) > now + 90 * 86400000) throw new Error('Invalid, expired or excessively long advisory exception');
const audit = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (audit.error || !audit.stdout) throw new Error('Dependency audit could not complete');
const report = JSON.parse(audit.stdout);
if (report.error || !report.metadata?.vulnerabilities || !report.vulnerabilities) throw new Error('Dependency audit returned an incomplete result');
/**
 * npm lists a dependant's `via` as package names (strings) and only the vulnerable package itself
 * as advisory objects. Follow the names down to every underlying advisory the entry inherits.
 */
function underlyingAdvisories(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const issue = report.vulnerabilities[name];
  if (!issue) return [];
  return issue.via.flatMap(v => (typeof v === 'object' ? [v] : underlyingAdvisories(v, seen)));
}
let failed = false;
for (const [name, issue] of Object.entries(report.vulnerabilities)) {
  if (!['high', 'critical'].includes(issue.severity)) continue;
  // Like the gate itself, only high and critical advisories need an exception; moderate ones
  // inherited along the chain are below the threshold whether direct or transitive.
  const advisories = underlyingAdvisories(name).filter(v => ['high', 'critical'].includes(v.severity));
  // Transitive chains are covered only when their individual underlying advisories are excepted.
  // An entry that resolves to no high or critical advisory at all fails closed.
  if (!advisories.length || advisories.some(v => !exceptions.some(e => e.url === v.url))) { console.error(`${issue.severity}: ${name} ${issue.range}`); failed = true; }
}
if (failed) process.exit(1);
console.log('Dependency advisory gate passed (including development tools).');
