#!/usr/bin/env node
const { applyMigrations, resolveDbPath } = require("./db");

function main() {
  const { applied } = applyMigrations();
  if (!applied.length) {
    console.log(`No migrations to apply. Database at ${resolveDbPath()}`);
    return;
  }
  console.log(`Applied migrations: ${applied.join(", ")}`);
  console.log(`Database ready at ${resolveDbPath()}`);
}

main();
