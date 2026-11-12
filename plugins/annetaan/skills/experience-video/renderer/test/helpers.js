// Shared by the tests. Not a test itself.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDeps } from '../src/deps.js';
import { parseStory, resolveStory } from '../src/story.js';

const RENDERER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const deps = loadDeps(RENDERER_DIR);

export const FRONT = `---
title: Test
music: { bpm: 120, beats_per_bar: 4 }
---

## Brief

Prose.
`;

// scene(n, yamlText, name?) -> a scene section.
export function scene(n, yamlText, name = 'Name') {
  return `\n## Scene ${n} — ${name}\n\nPurpose.\n\n\`\`\`yaml\n${yamlText.trim()}\n\`\`\`\n`;
}

export const card = (extra = '') => `cuts:\n  - part: card\n    bars: 1\n    lines: [hello]\n${extra}`;

export const parse = (text) => parseStory(text, deps);
export const timelineOf = (text) => resolveStory(parse(text), { storyDir: RENDERER_DIR });
