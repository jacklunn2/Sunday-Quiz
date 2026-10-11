// Checks every quiz file before publishing. Run: node tools/validate.mjs
import { readFileSync, existsSync } from 'node:fs';
const dir = new URL('../quizzes/', import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const errors = [];
const manifest = read('index.json').quizzes;
const seen = new Set();
for (const e of manifest) {
  const at = `index.json [${e.id}]`;
  if (seen.has(e.id)) errors.push(`${at}: duplicate id`);
  seen.add(e.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) { errors.push(`${at}: date must be YYYY-MM-DD`); continue; }
  if (new Date(e.date + 'T00:00:00Z').getUTCDay() !== 0) errors.push(`${at}: ${e.date} is not a Sunday`);
  if (!existsSync(new URL(`${e.id}.json`, dir))) { errors.push(`${at}: missing ${e.id}.json`); continue; }
  const q = read(`${e.id}.json`);
  for (const k of ['id', 'number', 'date', 'title']) if (q[k] !== e[k]) errors.push(`${e.id}.json: "${k}" does not match index.json`);
  if (q.questions.length !== e.questionCount) errors.push(`${at}: questionCount is ${e.questionCount}, file has ${q.questions.length}`);
  q.questions.forEach((x, i) => {
    const w = `${e.id}.json question ${i + 1}`;
    if (!x.question?.trim()) errors.push(`${w}: no question text`);
    for (const k of ['category', 'answer', 'explanation', 'source']) if (!x[k]?.trim()) errors.push(`${w}: missing ${k}`);
  });
  if (!e.sample && q.questions.length !== 30) errors.push(`${at}: a published quiz needs 30 questions, this has ${q.questions.length}`);
  console.log(`${e.id}  No. ${e.number}  ${q.questions.length} questions`);
}
if (errors.length) { console.error('\n' + errors.join('\n')); process.exit(1); }
console.log('All quizzes valid.');
