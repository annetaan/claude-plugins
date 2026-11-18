import { createRequire } from 'node:module';
import path from 'node:path';

export function loadDeps(depsDir) {
  const req = createRequire(path.join(path.resolve(depsDir), 'package.json'));
  return {
    yaml: req('yaml'),
    get playwright() {
      return req('playwright');
    },
  };
}
