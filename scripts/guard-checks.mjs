// scripts/guard-checks.mjs
import { globby } from 'globby';
import fs from 'node:fs';

const SRC_GLOBS = ['app/**/*.ts','app/**/*.tsx','lib/**/*.ts','lib/**/*.tsx'];

// ONLY flag absolute internal paths (app/, lib/, src/, ~/)
const BAD_IMPORT_REGEX = /from\s+['"](?:(?:app|lib|src)\/|~\/)[^'"]+['"]/g;

const files = await globby(SRC_GLOBS, {
  gitignore: true,
  ignore: ['**/node_modules/**','.next/**','dist/**']
});

let bad = [];
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const matches = txt.match(BAD_IMPORT_REGEX);
  if (matches) bad.push(f);
}

if (bad.length) {
  console.error('Guard checks failed:');
  for (const f of bad) console.error(`- Bad import alias in: ${f}`);
  process.exit(1);
} else {
  console.log('Guard checks passed.');
}
