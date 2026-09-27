import { run } from './run.js';

// exitCode instead of process.exit(): lets piped stdout drain before the process ends
run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
