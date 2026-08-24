# AnimaForge

AnimaForge is a local AI workspace for long-form fiction writing and document translation. It is built with Next.js, Tailwind CSS, React Query, Knex, and better-sqlite3.

## Features

- Project, character, and chapter management with project-level model overrides
- Chapter block editing, autosave, client-side undo/redo, and a dedicated reading view
- Swipe history with version switching and deletion confirmation
- AI-assisted block and chapter synopsis generation
- Checkpoint and summary blocks with automatic stale-state propagation
- Configurable generation context and checkpoint truncation
- Streaming support for OpenAI Chat Completions-compatible and Anthropic Messages-compatible APIs
- Configurable task models and reply-length limits for writing, summarization, and chat
- A project-aware creative assistant with references, attachments, tool activity, and revisionable proposals
- Project review and revision workflows with blueprint-driven, windowed generation
- Token usage and cost tracking by feature and project
- Standalone TXT and Markdown translation projects with multiple target-language blueprints per source file
- Hierarchical long-document analysis, global translation blueprints, and four-stage rolling-window translation
- A persistent background queue with window-level resume, bounded multi-project concurrency, pause, and cancellation
- Preservation of source line endings and Markdown structure, with downloadable intermediate outputs

## Local Development

Install dependencies, initialize the database, and start the development server:

```bash
npm install
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The database is stored at `data/database.sqlite3` by default. The application does not create the database or its tables at runtime, so initialize it before starting the application.

Use the following commands to manage the database schema:

```bash
npm run db:migrate   # Apply pending migrations
npm run db:status    # Show migration status
npm run db:rollback  # Roll back the latest migration batch
```

Set `DATABASE_PATH` to override the database file location.

Add LLM services and models under **Settings**, then select the default models for writing and summarization tasks. API keys are stored as plaintext in the local SQLite database. Do not commit the `data` directory.

## Docker

Prebuilt images for `linux/amd64` and `linux/arm64` are published to the GitHub Container Registry. Pull and run the latest image with a named volume for persistent SQLite data:

```bash
docker pull ghcr.io/seancheung/animaforge:latest

docker run -d \
  --name animaforge \
  --restart unless-stopped \
  -p 3000:3000 \
  -v animaforge-data:/app/data \
  ghcr.io/seancheung/animaforge:latest
```

Open [http://localhost:3000](http://localhost:3000) after the container starts. The entrypoint applies pending Knex migrations on every startup before launching the application. The default database is `/app/data/database.sqlite3`, so the `/app/data` volume must be persisted.

To use a host directory instead of a named volume, mount an absolute path to `/app/data`:

```bash
docker run -d \
  --name animaforge \
  -p 3000:3000 \
  -v /absolute/path/to/data:/app/data \
  ghcr.io/seancheung/animaforge:latest
```

The following environment variables can override the container defaults:

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_PATH` | `/app/data/database.sqlite3` | SQLite database file used by the application and migrations |
| `MIGRATION_PATH` | `/app/migrations` | Directory containing the Knex migration scripts |

When overriding either path, mount the corresponding database or migration directory into the container. For example, a custom read-only migration directory can be provided with `-v /absolute/path/to/migrations:/custom-migrations:ro -e MIGRATION_PATH=/custom-migrations`.

## Verification

```bash
npm run check
npm run build
```
