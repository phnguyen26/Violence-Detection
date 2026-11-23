---
title: Violence Detection
emoji: 😻
colorFrom: green
colorTo: gray
sdk: docker
pinned: false
license: mit
---

# Detex — Violence Detection

Detex turns browser cameras into a live monitoring system that detects potential
violence with YOLO and presents alerts in a web dashboard.

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Technology](#technology)
- [Repository Structure](#repository-structure)

## Features

- **Browser cameras:** Register a camera and open its camera link on a phone or another device.
- **Live monitoring:** View multiple cameras with detection boxes and confidence scores.
- **Camera sharing:** Pair viewers using share codes or QR links, with owner-controlled access.
- **Violence detection:** Analyze sampled frames and smooth detections across frames to reduce flicker.
- **Alerts:** Save detection snapshots, review alert history, and acknowledge incidents.

## How It Works

1. A signed-in user registers a camera and connects its browser camera feed.
2. WebRTC carries live video to viewers; WebSockets relay signaling and sampled frames.
3. A dedicated inference process runs YOLO, then temporal smoothing filters detections.
4. Qualifying detections create Firestore alerts with snapshots, confidence scores, and timestamps.
5. Connected viewers receive detection updates and alerts in the dashboard.

## Technology

| Area | Technologies |
| --- | --- |
| Web dashboard | React, TypeScript, Vite |
| API and streaming | FastAPI, WebSockets, WebRTC |
| Detection | Ultralytics YOLO, TensorRT, OpenCV |
| Identity and storage | Firebase Authentication, Cloud Firestore |
| Packaging | Docker |

## Repository Structure

| Path | Purpose |
| --- | --- |
| `web/` | Camera interface, monitoring dashboard, and alert history |
| `src/auth/`, `src/devices/` | Authentication, camera registration, pairing, and access management |
| `src/streaming/`, `src/inference/` | Live sessions, frame processing, and detection smoothing |
| `src/alerts/` | Alert persistence, retrieval, and acknowledgement |
| `infer_video.py`, `simulate_camera.py`, `export.py` | Video inference, camera simulation, and model export |
| `tests/` | API, detection, streaming, and Firestore emulator checks |
