// Native OpenHarmony query-engine (N-API library) and schema-engine (CLI
// binary) for Prisma, built from the commit prisma@5.1.1 pins.
//
// Two ways to consume:
//
// 1. env vars (set before any PrismaClient/CLI call):
//      const engines = require("@ohos-npm-ports/prisma-engines");
//      process.env.PRISMA_QUERY_ENGINE_LIBRARY = engines.queryEngineLibraryPath;
//      process.env.PRISMA_SCHEMA_ENGINE_BINARY = engines.schemaEngineBinaryPath;
//
// 2. npm overrides of @prisma/engines -- this package implements the
//      "@prisma/engines": "npm:@ohos-npm-ports/prisma-engines"
//    interface surface (getEnginesPath / ensureBinariesExist /
//    getCliQueryEngineBinaryType), with the engines exposed under the
//    binaryTarget file names prisma looks up in getEnginesPath().

const path = require("path");

const ENGINES_VERSION = "5.1.1-1.6a3747c37ff169c90047725a05a6ef02e32ac97e";
const DEFAULT_CLI_QUERY_ENGINE_BINARY_TYPE = "library";

function getEnginesPath() {
  return __dirname;
}

async function ensureBinariesExist() {
  const fs = require("fs");
  for (const name of ["libquery_engine.so", "schema-engine"]) {
    fs.accessSync(path.join(getEnginesPath(), name));
  }
}

function getCliQueryEngineBinaryType() {
  return DEFAULT_CLI_QUERY_ENGINE_BINARY_TYPE;
}

module.exports = {
  queryEngineLibraryPath: path.join(__dirname, "libquery_engine.so"),
  schemaEngineBinaryPath: path.join(__dirname, "schema-engine"),
  getEnginesPath,
  ensureBinariesExist,
  getCliQueryEngineBinaryType,
  DEFAULT_CLI_QUERY_ENGINE_BINARY_TYPE,
  enginesVersion: ENGINES_VERSION,
};
