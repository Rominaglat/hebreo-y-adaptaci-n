"""Bearer-token + webhook-secret guards used by the route handlers."""
from __future__ import annotations

from fastapi import Header, HTTPException, status

from .config import KG_API_TOKEN, KG_WEBHOOK_SECRET, constant_time_eq


async def require_bearer(authorization: str | None = Header(None)) -> None:
    """Accept only `Authorization: Bearer <KG_API_TOKEN>` from the env."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    token = authorization[len("Bearer "):].strip()
    if not constant_time_eq(token, KG_API_TOKEN):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid bearer token")


async def require_webhook_or_bearer(
    authorization: str | None = Header(None),
    x_webhook_secret: str | None = Header(None),
) -> None:
    """Accept either a valid bearer token OR a valid webhook secret. Backend-
    only callers (kg-sync edge function, kg-extract) use the webhook secret."""
    if x_webhook_secret and KG_WEBHOOK_SECRET and constant_time_eq(x_webhook_secret, KG_WEBHOOK_SECRET):
        return
    await require_bearer(authorization)
