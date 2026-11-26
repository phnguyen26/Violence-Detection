
<h1 align="center">Detex</h1>
<p align="center"><strong>Browser cameras → YOLO violence detection → real-time alerts. No extra hardware.</strong></p>
<p align="center">WebRTC live streaming · Temporal smoothing · Firestore alerts · TensorRT accelerated · MIT licensed</p>

<p align="center">
  <!-- <a href="../../actions"><img src="https://img.shields.io/github/actions/workflow/status/phnguyen06/Violence-Detection/checks.yml?branch=main&label=CI" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/phnguyen06/Violence-Detection" alt="License"></a> -->
  <img src="https://img.shields.io/badge/python-%3E%3D3.11-blue" alt="Python">
  <img src="https://img.shields.io/badge/react-19-61dafb" alt="React">
  <img src="https://img.shields.io/badge/TensorRT-11.4-76b900?logo=nvidia&logoColor=white" alt="TensorRT">
  <a href="https://huggingface.co/spaces/phnguyencs/Violence-Detection"><img src="https://img.shields.io/badge/🤗%20Hugging%20Face-Space-yellow" alt="Hugging Face Space"></a>
</p>

---

## Demo

<p align="center">
  <video src="https://github.com/phnguyen26/Violence-Detection/releases/download/1.0/demo.webm" width="720" controls></video>
 
  <!-- Option B: clickable thumbnail while video URL is not yet available -->
  <!-- <a href="https://github.com/phnguyen06/Violence-Detection/raw/main/demo.webm">
    <img src="web/src/assets/hero.png" alt="Demo — click to download/view video" width="720"/>
  </a>
  <br/><em>▶ Click to watch the demo</em> -->
</p>

---

## How It Works

1. A signed-in user registers a camera — the browser opens a camera link on any phone or device.
2. **WebRTC** carries live video to viewers; a **WebSocket** relays signaling and periodically sampled JPEG frames to the server.
3. A dedicated **subprocess** loads YOLO once and processes frames in configurable batches, keeping GPU inference off the ASGI event loop.
4. A **temporal smoothing buffer** (EMA + IoU matching) filters per-frame detections across a sliding window to eliminate flicker.
5. When smoothed confidence exceeds the threshold and the cooldown has elapsed, a **Firestore alert** is created with a snapshot image, confidence score, and timestamp.
6. All connected viewers receive detection overlays and alert notifications in real time.

---

## Features

- **Browser cameras** — register a camera and open its link on any phone; no app install required.
- **WebRTC live viewing** — peer-to-peer video with detection boxes overlaid on the viewer side.
- **Camera sharing** — pair viewers with a share code or QR link; owner controls access.
- **YOLO inference** — Ultralytics YOLO with optional TensorRT engine for GPU-accelerated detection.
- **Temporal smoothing** — EMA confidence and IoU-tracked bounding boxes suppress flickering detections across frames.
- **Alert history** — snapshots saved to Firestore; review, acknowledge, and browse past incidents with a lightbox UI.
- **Sound alert** — audible notification on the dashboard when a new alert fires.

---

<!-- ## Quick Start

### Docker Compose (recommended)

```bash
cp .env.example .env          # fill in Firebase credentials
docker compose up -d
```

- Dashboard: `http://localhost:8080`
- API: `http://localhost:7860`

> Requires an NVIDIA GPU and the NVIDIA Container Toolkit for inference.
> Mount a compatible `.engine` file or export one first (see [Export](#export-model)).

### Local (development)

**Backend**

```bash
python -m pip install -r requirements-dev.txt
python server.py --no-ssl --weights best.engine --port 8765
```

**Frontend**

```bash
cd web
cp .env.example .env          # fill in Firebase config
npm ci
npm run dev
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ENVIRONMENT` | `local` | `local` or `staging` enables `/docs`; any other value disables it |
| `HOST` / `PORT` | `0.0.0.0` / `8765` | Bind address (CLI); Docker uses `7860` |
| `WEIGHTS` | `best.engine` | Path to YOLO weights (`.pt` or TensorRT `.engine`) |
| `CORS_ORIGINS` | `*` | Comma-separated allowed browser origins |
| `VIOLENCE_THRESHOLD` | `0.6` | Minimum smoothed confidence to trigger an alert |
| `ALERT_COOLDOWN_SECONDS` | `30` | Minimum seconds between alerts per camera |
| `FRAME_TIMEOUT_SECONDS` | `15` | Frame stream inactivity timeout |
| `INFERENCE_BATCH_SIZE` | `4` | Maximum frames per YOLO batch |
| `FRAME_QUEUE_SIZE` | `12` | Per-camera frame queue depth; older frames are dropped |

Firebase credentials: set `FIREBASE_SERVICE_ACCOUNT` (path to JSON), `FIREBASE_CREDENTIALS_JSON` (inline JSON), or Application Default Credentials. Never commit service account files.

--- -->

## Architecture

| Layer | Technology |
|-------|-----------|
| Web dashboard | React 19, TypeScript, Vite |
| API & streaming | FastAPI, WebSockets, WebRTC signaling |
| Inference | Ultralytics YOLO, TensorRT, OpenCV |
| Temporal smoothing | EMA + IoU buffer (custom, `src/inference/postprocess.py`) |
| Identity & storage | Firebase Authentication, Cloud Firestore |
| Packaging | Docker, Nginx reverse proxy |

```
Browser (camera)
      │  JPEG frames (WebSocket)
      ▼
FastAPI ──► Inference subprocess (YOLO / TensorRT)
      │           │
      │     Temporal buffer (EMA smoothing)
      │           │
      ├──► Firestore alert + snapshot
      │
Browser (viewer)
      │  WebRTC video + detection overlay (WebSocket)
```

<p align="center">
  <img src="runs/detex-workflow.svg" alt="Detex" width="720"/>
</p>

<!-- ## Export Model

```bash
# Export best.pt → TensorRT engine for your GPU
python export.py --weights best.pt --device 0
```

The `.engine` file is hardware-specific — export on the same machine that runs inference.

---

## Development

**Lint & format (backend)**

```bash
ruff check .
ruff format --check .
```

**Tests**

```bash
python -m unittest discover -s tests -v
```

Persistence tests require a Firestore emulator:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 python -m unittest discover -s tests -v
```

**Frontend**

```bash
cd web
npm run build
npm run lint
```

CI runs both backend and frontend checks on every push — see [`.github/workflows/`](.github/workflows/).

---

## Firestore Index

Provision the composite index on the `alerts` collection before deploying:

```
device_id  ASC
timestamp  DESC
```

The index definition is in [`firestore.indexes.json`](firestore.indexes.json).

---

## License

MIT — see [LICENSE](LICENSE). -->
