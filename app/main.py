from fastapi import FastAPI

from app.config import settings
from app.routers.admin import router as admin_router
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router

app = FastAPI(
    title=settings.app_name,
    description="FastAPI backend for a Minecraft server website and launcher integration.",
    version="0.1.0",
    debug=settings.debug,
)

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(users_router)


@app.get("/health", tags=["health"])
def health_check() -> dict:
    return {"status": "ok"}
