import asyncio
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src import database
from src.alerts.router import router as alerts_router
from src.config import AppSettings, settings
from src.devices.router import router as devices_router
from src.inference import service as inference_service
from src.inference.config import settings as inference_settings
from src.models import ErrorResponse
from src.streaming import service as streaming_service
from src.streaming.router import router as streaming_router


@asynccontextmanager #must have to use async with
async def lifespan(app: FastAPI):
    app.state.db = await asyncio.to_thread(database.initialize_firebase)
    # print("Init db done")
    pool = ProcessPoolExecutor(
        max_workers=1,
        mp_context=multiprocessing.get_context("spawn"),
        initializer=inference_service.load_model,
        initargs=(getattr(app.state, "weights", inference_settings.weights),),
    )
    # print("init pool done")
    app.state.inference_pool = pool
    try:
        await asyncio.get_running_loop().run_in_executor(pool, inference_service.ready)
        # print("model ready")
        yield
    finally:
        tasks = [
            session.inference_task
            for session in streaming_service.sessions.values()
            if session.inference_task
        ]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.to_thread(pool.shutdown, wait=True, cancel_futures=True)
        streaming_service.sessions.clear()
        streaming_service.device_sessions.clear()
        await asyncio.to_thread(app.state.db.close)
        app.state.db = None


def create_app(config: AppSettings = settings) -> FastAPI:
    app = FastAPI(
        title="Detex API",
        lifespan=lifespan,
        openapi_url="/openapi.json" if config.environment in {"local", "staging"} else None,
        #just openapi metadata, not every exception beconming this model response
        responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 503)},
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            origin.strip() for origin in config.cors_origins.split(",") if origin.strip()
        ],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(devices_router)
    app.include_router(alerts_router)
    app.include_router(streaming_router)
    return app


app = create_app()
