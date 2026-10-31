import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildComment, main } from './gate-report-comment.mjs';

const changed = ['ports/a/demo', 'ports/b/other'];

test('comment reports successful checks', () => {
  const body = buildComment({ changed, lintResult: 'success', commitResult: 'success' });
  assert.match(body, /静态检查通过/);
  assert.match(body, /2 个/);
  assert.match(body, /ports\/a\/demo, ports\/b\/other/);
  assert.doesNotMatch(body, /❌/);
});

test('comment reports failures and gh posting remains non-fatal', () => {
  const body = buildComment({ changed, lintResult: 'failure', commitResult: 'success' });
  assert.match(body, /静态检查未通过/);
  assert.match(body, /❌/);

  const env = {
    PR: '123',
    REPO: 'owner/repo',
    CHANGED_JSON: JSON.stringify(changed),
    LINT_RESULT: 'failure',
    COMMIT_RESULT: 'success',
  };
  let invocation;
  main({ env, run: (command, args) => { invocation = [command, ...args]; } });
  assert.deepEqual(invocation.slice(0, 5), ['gh', 'pr', 'comment', '123', '--repo']);
  assert.equal(invocation[5], 'owner/repo');
  assert.equal(invocation[6], '--body');
  assert.match(invocation[7], /静态检查未通过/);
  assert.doesNotThrow(() => main({ env, run: () => { throw new Error('offline'); } }));
});
