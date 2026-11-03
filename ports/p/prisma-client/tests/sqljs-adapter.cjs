const path = require("path");
const initSqlJs = require("sql.js");

// ColumnTypeEnum values from @prisma/driver-adapter-utils.
const ColumnType = { Int32: 0, Int64: 1, Double: 3, Boolean: 5, Text: 7, Bytes: 13 };

function columnType(value) {
  if (typeof value === "boolean") return ColumnType.Boolean;
  if (typeof value === "bigint") return ColumnType.Int64;
  if (typeof value === "number") return Number.isInteger(value) ? ColumnType.Int32 : ColumnType.Double;
  if (value instanceof Uint8Array) return ColumnType.Bytes;
  return ColumnType.Text;
}

function createAdapter(SQL) {
  const db = new SQL.Database();
  const adapter = {
    provider: "sqlite",
    adapterName: "ohos-prisma-client-smoke",
    async queryRaw(query) {
      const args = query.args ?? [];
      const stmt = db.prepare(query.sql);
      if (args.length) stmt.bind(args);
      const columnNames = stmt.getColumnNames();
      const rows = [];
      while (stmt.step()) rows.push(stmt.get());
      stmt.free();
      const columnTypes = columnNames.map((_, i) => columnType(rows.find((row) => row[i] != null)?.[i]));
      return { columnNames, columnTypes, rows };
    },
    async executeRaw(query) {
      db.run(query.sql, query.args ?? []);
      return db.getRowsModified();
    },
    async executeScript(script) {
      db.exec(script);
    },
    async startTransaction() {
      db.run("BEGIN");
      return {
        provider: "sqlite",
        adapterName: adapter.adapterName,
        options: { usePhantomQuery: false },
        queryRaw: adapter.queryRaw,
        executeRaw: adapter.executeRaw,
        commit: async () => db.run("COMMIT"),
        rollback: async () => db.run("ROLLBACK"),
      };
    },
    async dispose() {
      db.close();
    },
  };
  return adapter;
}

async function connect() {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(path.dirname(require.resolve("sql.js/dist/sql-wasm.js")), file),
  });
  return createAdapter(SQL);
}

module.exports = { connect };
