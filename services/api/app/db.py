import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

import asyncpg

from app.config import get_settings

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()

T = TypeVar("T")


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is not None:
        return _pool
    async with _pool_lock:
        if _pool is None:
            settings = get_settings()
            _pool = await asyncpg.create_pool(
                dsn=settings.database_url,
                min_size=1,
                max_size=10,
                max_inactive_connection_lifetime=300,
            )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def reset_pool() -> None:
    global _pool
    old_pool = _pool
    _pool = None
    if old_pool is not None:
        try:
            await asyncio.wait_for(old_pool.close(), timeout=5)
        except Exception:  # noqa: BLE001
            old_pool.terminate()


async def pool() -> asyncpg.Pool:
    if _pool is None:
        return await init_pool()
    return _pool


async def fetch(query: str, *args) -> list[asyncpg.Record]:
    return await _with_reconnect(lambda db: db.fetch(query, *args))


async def fetchrow(query: str, *args) -> asyncpg.Record | None:
    return await _with_reconnect(lambda db: db.fetchrow(query, *args))


async def fetchval(query: str, *args):
    return await _with_reconnect(lambda db: db.fetchval(query, *args))


async def execute(query: str, *args) -> str:
    return await _with_reconnect(lambda db: db.execute(query, *args))


async def transaction(work: Callable[[asyncpg.Connection], Awaitable[T]]) -> T:
    async def run(db: asyncpg.Pool) -> T:
        async with db.acquire() as conn:
            async with conn.transaction():
                return await work(conn)

    return await _with_reconnect(run)


async def _with_reconnect(work: Callable[[asyncpg.Pool], Awaitable[T]]) -> T:
    last_error: Exception | None = None
    for attempt in range(2):
        db = await pool()
        try:
            return await work(db)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == 0 and _is_reconnectable_error(exc):
                await reset_pool()
                continue
            raise
    raise last_error or RuntimeError("Database operation failed")


def _is_reconnectable_error(exc: Exception) -> bool:
    if isinstance(
        exc,
        (
            asyncpg.PostgresConnectionError,
            asyncpg.CannotConnectNowError,
            ConnectionError,
            OSError,
        ),
    ):
        return True
    if isinstance(exc, asyncpg.InterfaceError):
        message = str(exc).lower()
        return "connection is closed" in message or "pool is closed" in message
    return False
