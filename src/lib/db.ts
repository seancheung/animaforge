import fs from "node:fs";
import path from "node:path";
import knex, { type Knex } from "knex";

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), "data", "database.sqlite3");

declare global {
  var __knex: Knex | undefined;
}

function createDatabase() {
  if (!fs.existsSync(databasePath)) {
    throw new Error(
      `The database has not been initialized: ${databasePath}. Run npm run db:migrate first.`,
    );
  }

  return knex({
    client: "better-sqlite3",
    connection: { filename: databasePath },
    useNullAsDefault: true,
    pool: {
      afterCreate(
        connection: { pragma: (value: string) => void },
        done: (error: Error | null, connection: unknown) => void,
      ) {
        connection.pragma("foreign_keys = ON");
        connection.pragma("journal_mode = WAL");
        done(null, connection);
      },
    },
  });
}

export async function getDb() {
  globalThis.__knex ??= createDatabase();
  return globalThis.__knex;
}

export const newId = () => crypto.randomUUID();

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
