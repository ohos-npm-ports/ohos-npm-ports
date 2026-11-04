import assert from 'node:assert/strict';

export default function test({ requirePackage }) {
  const { time } = requirePackage('@datadog/pprof');
  function hotLoop() {
    const start = Date.now();
    let value = 0;
    while (Date.now() - start < 200) {
      for (let index = 0; index < 1000; index++) value += Math.sqrt(index);
    }
    return value;
  }
  time.start({ intervalMicros: 1000, durationMillis: 60000 });
  hotLoop();
  const profile = time.stop();
  const strings = profile.stringTable.strings;
  assert.ok(profile.sample.length > 0, 'no profiler samples');
  assert.ok(strings.includes('hotLoop'), 'hotLoop frame missing');
  return { result: { sampled: true, hotLoop: true }, assets: [] };
}
