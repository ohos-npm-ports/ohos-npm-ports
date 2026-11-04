import assert from 'node:assert/strict';

export default async function test({ requirePackage }) {
  const sqlite3 = requirePackage('sqlite3');
  const db = new sqlite3.Database(':memory:');
  const run = (sql, parameters = []) => new Promise((resolve, reject) => {
    db.run(sql, parameters, (error) => error ? reject(error) : resolve());
  });
  const get = (sql, parameters = []) => new Promise((resolve, reject) => {
    db.get(sql, parameters, (error, row) => error ? reject(error) : resolve(row));
  });
  try {
    await run('CREATE TABLE ports (name TEXT, value INTEGER)');
    await run('INSERT INTO ports VALUES (?, ?)', ['answer', 42]);
    const row = await get('SELECT name, value FROM ports WHERE name = ?', ['answer']);
    assert.deepEqual(row, { name: 'answer', value: 42 });
    return { result: { memoryCrud: row.value }, assets: [] };
  } finally {
    await new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
  }
}
