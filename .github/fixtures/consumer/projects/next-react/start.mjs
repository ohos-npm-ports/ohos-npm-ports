import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tools = createRequire(require.resolve('consumer-deps/package.json'));
process.argv.splice(1, 1, tools.resolve('next/dist/bin/next'), 'start');
tools('next/dist/bin/next');
