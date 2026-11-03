const { connect } = require("./sqljs-adapter.cjs");
const { PrismaClient } = require("./generated/client.js");

(async () => {
  const adapter = await connect();
  await adapter.executeScript(
    'CREATE TABLE "Widget" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL)',
  );
  const factory = { provider: "sqlite", adapterName: adapter.adapterName, connect: async () => adapter };
  const prisma = new PrismaClient({ adapter: factory });
  const widget = await prisma.widget.create({ data: { name: "smoke" } });
  const found = await prisma.widget.findUnique({ where: { id: widget.id } });
  if (!found || found.name !== "smoke") throw new Error("read-back failed");
  const count = await prisma.widget.count();
  if (count !== 1) throw new Error("bad count: " + count);
  await prisma.$disconnect();
  console.log("CRUD OK");
})().catch((error) => { console.error(error); process.exit(1); });
