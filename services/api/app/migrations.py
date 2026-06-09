from pathlib import Path

import asyncpg

MIGRATION_LOCK_ID = 2026060901
MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations" / "postgres"


async def run_migrations(pool: asyncpg.Pool) -> list[str]:
    async with pool.acquire() as conn:
        await conn.execute(
            """
            create table if not exists schema_migrations (
              version text primary key,
              checksum text not null,
              applied_at timestamptz not null default now()
            )
            """
        )
        await conn.execute("select pg_advisory_lock($1)", MIGRATION_LOCK_ID)
        try:
            rows = await conn.fetch("select version from schema_migrations")
            applied = {row["version"] for row in rows}
            executed: list[str] = []
            for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                version = path.name
                if version in applied:
                    continue
                sql_text = path.read_text(encoding="utf-8")
                checksum = str(abs(hash(sql_text)))
                async with conn.transaction():
                    await conn.execute(sql_text)
                    await conn.execute(
                        "insert into schema_migrations(version, checksum) values($1, $2)",
                        version,
                        checksum,
                    )
                executed.append(version)
            return executed
        finally:
            await conn.execute("select pg_advisory_unlock($1)", MIGRATION_LOCK_ID)
