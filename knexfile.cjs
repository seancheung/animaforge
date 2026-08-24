const fs = require("node:fs");
const path = require("node:path");

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, "data", "database.sqlite3");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

/** @type {import('knex').Knex.Config} */
module.exports = {
  client: "better-sqlite3",
  connection: { filename: databasePath },
  useNullAsDefault: true,
  migrations: {
    directory: path.join(__dirname, "migrations"),
    extension: "cjs",
    tableName: "knex_migrations",
  },
  pool: {
    afterCreate(connection, done) {
      connection.pragma("foreign_keys = ON");
      connection.pragma("journal_mode = WAL");
      done(null, connection);
    },
  },
};
