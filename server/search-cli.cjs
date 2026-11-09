const { search } = require('./search-core.cjs');

try {
  const input = process.argv[2] ?? require('node:fs').readFileSync(0, 'utf8');
  process.stdout.write(JSON.stringify(search(JSON.parse(input))) + '\n');
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
