// npm install, then: node repro.js [path to a jest bin, default the installed jest] [most runs, default 25]
// Writes a project of one test file per worker, each requiring the same 1,000 small modules, runs jest on it with an
// empty cache directory each time and a worker per CPU but one, until a run loses a suite to EPERM reading the cache,
// and prints the jest it ran and how each run went, quoting what jest prints when a cache read or write meets EPERM.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const jestBin = path.resolve(process.argv[2] || require.resolve('jest/bin/jest'));
const runs = Number(process.argv[3] || 25);
const sharedModules = 1000;
const workers = Math.max(os.cpus().length - 1, 1);
const testFiles = workers;

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-cache-race-'));
fs.mkdirSync(path.join(project, 'shared'));
fs.mkdirSync(path.join(project, 'tests'));
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'jest-cache-race', private: true }));
for (let module = 0; module < sharedModules; module += 1) {
  const functions = Array.from(
    { length: 5 },
    (_, at) => `exports.value${at} = function (input) {\n  return { at: ${at}, input, doubled: input * 2, text: '${module}-${at}-' + input };\n};`,
  );
  fs.writeFileSync(path.join(project, 'shared', `module-${module}.js`), `${functions.join('\n\n')}\n`);
}
const requires = Array.from({ length: sharedModules }, (_, module) => `const module${module} = require('../shared/module-${module}.js');`);
const uses = Array.from({ length: sharedModules }, (_, module) => `module${module}.value0(1)`);
for (let file = 0; file < testFiles; file += 1) {
  fs.writeFileSync(
    path.join(project, 'tests', `case-${file}.test.js`),
    `${requires.join('\n')}\n\ntest('case ${file}', () => {\n  expect([${uses.join(', ')}]).toHaveLength(${sharedModules});\n});\n`,
  );
}

// jest's bin hands a run to a jest installed where it runs, so the version is asked where the runs run.
const version = spawnSync(process.execPath, [jestBin, '--version'], { cwd: project, encoding: 'utf8' }).stdout.trim();
console.log(`jest ${version} from ${jestBin}`);
console.log(`node ${process.version} on ${os.type()} ${os.release()}, ${os.cpus().length} CPUs, ${workers} workers`);
console.log(`project ${project}: ${testFiles} test files, each requiring the same ${sharedModules} modules`);

function outcomeOf(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const quote = (marker) => {
    const at = lines.findIndex((line) => line.includes(marker));
    return at < 0 ? [] : lines.slice(at, at + 2).filter((line) => line.length > 0);
  };
  const reading = quote('failed to read cache file');
  if (reading.length > 0 && reading.some((line) => line.includes('EPERM'))) {
    return { verdict: 'EPERM reading the cache', quoted: reading };
  }
  const writing = quote('failed to cache transform results');
  if (writing.length > 0 && writing.some((line) => line.includes('EPERM'))) {
    return { verdict: 'EPERM writing the cache', quoted: writing };
  }
  if (output.includes('Test suite failed to run')) {
    return { verdict: 'a suite failed to run for another reason', quoted: quote('Test suite failed to run') };
  }
  return { verdict: 'clean', quoted: [] };
}

let lostToRead = false;
let ranRuns = 0;
for (let run = 1; run <= runs; run += 1) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-cache-race-cache-'));
  const result = spawnSync(
    process.execPath,
    [jestBin, '--ci', '--rootDir', project, '--cacheDirectory', cache, '--maxWorkers', String(workers)],
    { cwd: project, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const { verdict, quoted } = outcomeOf(output);
  const suites = output.split(/\r?\n/).find((line) => line.startsWith('Test Suites:')) || 'no summary';
  console.log(`run ${run}: ${verdict} · ${suites}`);
  for (const line of quoted) {
    console.log(`    ${line}`);
  }
  fs.rmSync(cache, { recursive: true, force: true });
  ranRuns = run;
  if (verdict === 'EPERM reading the cache') {
    lostToRead = true;
    break;
  }
}
console.log(
  lostToRead
    ? `run ${ranRuns} of at most ${runs} lost a suite to EPERM reading the cache`
    : `none of ${ranRuns} runs lost a suite to EPERM reading the cache`,
);
fs.rmSync(project, { recursive: true, force: true });
