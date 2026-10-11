#!/usr/bin/env node
// Parses every deployment template in deploy/ and deploy/home-assistant/ to catch syntax errors
// before they reach a NAS, add-on store or app store that won't tell you nearly as clearly.
//
//   node scripts/validate-deploy-templates.mjs
//   npm run validate:deploy
//
// YAML is parsed with js-yaml. XML has no parser in the dependency tree worth adding just for a
// syntax check (see the README note on this script), so it gets a small well-formedness check
// instead: balanced/properly-nested tags, matching quotes in attributes, and a single root
// element. That's enough to catch the mistakes a hand-edited template actually makes (an unclosed
// tag, a stray `&` that should be `&amp;`, mismatched quotes) without a new runtime dependency.
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('..', import.meta.url));

const yamlFiles = [
  ...globSync('deploy/**/*.yml', { cwd: root }),
  ...globSync('deploy/**/*.yaml', { cwd: root }),
].sort();

const xmlFiles = [...globSync('deploy/**/*.xml', { cwd: root })].sort();

if (yamlFiles.length === 0 && xmlFiles.length === 0) {
  console.error('validate-deploy-templates: found no files to check under deploy/ — did the glob break?');
  process.exit(1);
}

let failed = false;

for (const relPath of yamlFiles) {
  const file = join(root, relPath);
  const text = readFileSync(file, 'utf8');
  // loadAll: several of these files (Docker Compose) are single documents, but this also covers
  // any future file that uses `---` document separators without special-casing it.
  try {
    yaml.loadAll(text);
    console.log(`ok    ${relPath}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL  ${relPath}`);
    console.error(`      ${err.message}`);
  }
}

/**
 * A deliberately small well-formedness check: not a validating XML parser, just enough to catch
 * the mistakes a hand-edited template actually makes. It does not check DTDs, namespaces or
 * entity declarations, and it is not a substitute for Unraid's own "Validate"/"Scan" submission
 * step, which is the real authority on whether a template is acceptable.
 */
function checkXmlWellFormed(text) {
  // Strip comments and the XML declaration/CDATA sections before scanning tags, so `<` and `>`
  // inside them (e.g. in this script's own doc comments elsewhere) can't confuse the tag scanner.
  const stripped = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?xml[\s\S]*?\?>/g, '');

  const tagPattern = /<\/?([a-zA-Z_][\w.-]*)((?:\s+[\w.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
  const stack = [];
  let match;
  let lastIndex = 0;
  while ((match = tagPattern.exec(stripped))) {
    lastIndex = tagPattern.lastIndex;
    const [full, name, , selfClosing] = match;
    const isClosing = full.startsWith('</');
    if (isClosing) {
      const expected = stack.pop();
      if (expected !== name) {
        return `mismatched closing tag </${name}>, expected </${expected ?? '(nothing open)'}>`;
      }
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  // Anything after the last recognised tag that still contains a stray `<` or `>` suggests a tag
  // the pattern above couldn't parse (bad attribute quoting, an unescaped `<`, etc).
  const tail = stripped.slice(lastIndex);
  if (/[<>]/.test(tail.replace(/\s+/g, ''))) {
    return `unparsed content containing '<' or '>' near the end of the file: ${JSON.stringify(tail.trim().slice(0, 80))}`;
  }
  if (stack.length > 0) {
    return `unclosed tag(s): ${stack.join(', ')}`;
  }
  return null;
}

for (const relPath of xmlFiles) {
  const file = join(root, relPath);
  const text = readFileSync(file, 'utf8');
  const problem = checkXmlWellFormed(text);
  if (problem) {
    failed = true;
    console.error(`FAIL  ${relPath}`);
    console.error(`      ${problem}`);
  } else {
    console.log(`ok    ${relPath}`);
  }
}

if (failed) {
  console.error('\nvalidate-deploy-templates: one or more files failed to parse.');
  process.exit(1);
}
console.log(`\nvalidate-deploy-templates: ${yamlFiles.length} YAML and ${xmlFiles.length} XML file(s) OK.`);
