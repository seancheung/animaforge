#!/bin/sh
set -eu

node <<'NODE'
const config = require("./knexfile.cjs");
config.migrations.directory =
  process.env.MIGRATION_PATH ?? config.migrations.directory;

const db = require("knex")(config);

db.migrate
  .latest()
  .then(() => db.destroy())
  .catch(async (error) => {
    console.error(error);
    await db.destroy();
    process.exit(1);
  });
NODE

exec "$@"
