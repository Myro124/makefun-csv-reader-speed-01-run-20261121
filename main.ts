// make.fun program/v1 driver for the local draft.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');
const { run } = await import(new URL('./solve.js', import.meta.url).href) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];
const answers = new Array(cases.length);
for (let i = 0; i < cases.length; i++) answers[i] = run(cases[i].input);
writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
