from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.bootstrap import ensure_bootstrap_admin
from app.config import get_settings
from app.db import close_pool, init_pool
from app.migrations import run_migrations
from app.routers import auth, billing, cron, health, internal


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_pool = await init_pool()
    executed = await run_migrations(db_pool)
    await ensure_bootstrap_admin()
    app.state.migrations_executed = executed
    yield
    await close_pool()


settings = get_settings()
app = FastAPI(title="stock2-api", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(billing.router, prefix="/billing", tags=["billing"])
app.include_router(cron.router, prefix="/cron", tags=["cron"])
app.include_router(internal.router, prefix="/internal", tags=["internal"])
