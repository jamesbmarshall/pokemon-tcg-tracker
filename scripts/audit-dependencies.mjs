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
let failed = false;
for (const [name, issue] of Object.entries(report.vulnerabilities)) {
  if (!['high', 'critical'].includes(issue.severity)) continue;
  const advisories = issue.via.filter(v => typeof v === 'object');
  // Transitive chains are covered only when their individual underlying advisories are excepted.
  if (!advisories.length || advisories.some(v => !exceptions.some(e => e.url === v.url))) { console.error(`${issue.severity}: ${name} ${issue.range}`); failed = true; }
}
if (failed) process.exit(1);
console.log('Dependency advisory gate passed (including development tools).');
