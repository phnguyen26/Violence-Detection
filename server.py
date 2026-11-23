import argparse
import logging
from pathlib import Path

import uvicorn

from src.config import settings
from src.inference.config import settings as inference_settings
from src.main import app


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", default=settings.port, type=int)
    parser.add_argument("--weights", default=inference_settings.weights)
    return parser.parse_args()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    args = parse_args()
    app.state.weights = args.weights
    uvicorn.run(
        "src.main:app",
        host=args.host,
        port=args.port
    )
