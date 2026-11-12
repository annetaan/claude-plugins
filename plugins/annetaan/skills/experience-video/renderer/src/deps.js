// Loads playwright and yaml from the dependency directory. No other file imports them directly.
import { createRequire } from 'node:module';
import path from 'node:path';

export function loadDeps(depsDir) {
  const req = createRequire(path.join(path.resolve(depsDir), 'package.json'));
  return {
    yaml: req('yaml'),
    // Loaded on first use, so commands that never open a browser (check) never load it.
    get playwright() {
      return req('playwright');
    },
  };
}
