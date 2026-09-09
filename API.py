import os
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Any

import cv2
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, status
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import uvicorn

BASE_DIR = Path(__file__).resolve().parent 

WEIGHT_PATH=os.path.join(BASE_DIR,"runs/detect/runs/train/yolo26s-violence/weights/best.pt")

MODEL_WEIGHTS = Path(os.getenv("MODEL_PATH", str(WEIGHT_PATH)))

class_names={
    0 : "fall",
    1 : "normal",
    2 : "violence"
}

app=FastAPI(
    title="Violence Detection API",
    description="API phát hiện hành vi bạo lực và té ngã từ video sử dụng YOLO"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Khởi tạo mô hình
model: Optional[YOLO] = None

try:
    if MODEL_WEIGHTS.exists():
        model = YOLO(str(MODEL_WEIGHTS))
        print(f"[INFO] Load model thành công từ: {MODEL_WEIGHTS}")
    else:
        print(f"[WARN] Không tìm thấy file weights tại: {MODEL_WEIGHTS}")
except Exception as e:
    print(f"[ERROR] Lỗi nạp mô hình: {e}")


def infer_video(
    video_path: str,
    conf_threshold: float = 0.5,
    iou_threshold: float = 0.45,
    frame_stride: int = 2,
    save_annotated_path: Optional[str] = None
):
    if model is None:
        raise RuntimeError("Model chưa được nạp. Hãy kiểm tra đường dẫn file weights.") 
    
    cap=cv2.VideoCapture(video_path)
    if not cap.isOpened():
            raise ValueError("Không thể mở file video. Định dạng không hợp lệ hoặc file bị lỗi.")
    #lay fps
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    #frame
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    #w,h
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    #time
    if(fps >0 ):
        duration_sec=total_frames/fps
    else:
        duration_sec=0.0

    # Thiết lập VideoWriter nếu cần xuất video kết quả
    writer = None
    if save_annotated_path:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(save_annotated_path, fourcc, fps, (width, height))   

    detection_counts = {name: 0 for name in class_names.values()}
    max_confidences = {name: 0.0 for name in class_names.values()}
    incident_timestamps= []

    frame_idx = 0

    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            current_timestamp = round(frame_idx / fps, 2)
            should_infer = (frame_idx % frame_stride == 0)
            annotated_frame = frame
            if should_infer:
                # Chạy inference trên 1 frame
                results = model.predict(
                    source=frame,
                    conf=conf_threshold,
                    iou=iou_threshold,
                    verbose=False
                )
                frame_detections = []
                for box in results[0].boxes:
                    cls_id =int(box.cls[0].item())
                    cls_name=class_names.get(cls_id)
                    confidence = float(box.conf[0].item())
                    if cls_name:
                        detection_counts[cls_name] = detection_counts.get(cls_name, 0) + 1
                        if cls_name in max_confidences and confidence > max_confidences[cls_name]:
                            max_confidences[cls_name] = round(confidence, 4)

                    if cls_name in ["violence","fall"]:
                        frame_detections.append(
                            {
                                "class" : cls_name,
                                "confidence" : round(confidence,4),
                                "box" : [
                                    round(coord,1) for coord in box.xyxy[0].tolist()
                                ]
                            }
                        )
                if frame_detections:
                    incident_timestamps.append(
                        {
                            "frame" : frame_idx,
                            "timestamp_sec" : current_timestamp,
                            "detections" : frame_detections
                        }
                    )
                if writer:
                    annotated_frame = results[0].plot()

            if writer:
                writer.write(annotated_frame)
            frame_idx+=1
    finally:
        cap.release()
        if writer:
            writer.release()


    has_violence = detection_counts.get("violence", 0) > 0
    has_fall = detection_counts.get("fall", 0) > 0
    if has_violence and has_fall:
        status_alert = "ALERT_VIOLENCE_AND_FALL_DETECTED"
    elif has_violence:
        status_alert = "ALERT_VIOLENCE_DETECTED"
    elif has_fall:
        status_alert = "ALERT_FALL_DETECTED"
    else:
        status_alert = "NORMAL"

    return {
        "alert" : status_alert,
        "video_info":{
            "total_frames" : total_frames,
            "process_frame" : frame_idx,
            "fps": round(fps,2),
            "duration_seconds" : round(duration_sec,2),
        },
        "detect_summary" :{
            "counts" : detection_counts,
            "max_confidence" : max_confidences
        },
        "incident_events_count": len(incident_timestamps), 
        "incident_events": incident_timestamps
    }

@app.get("/health", summary="Kiểm tra trạng thái hệ thống")
async def health_check():

    is_model_ready = model is not None
    device_used = "cuda" if (is_model_ready and next(model.model.parameters()).is_cuda) else "cpu"
    
    return {
        "status": "ok",
        "service": "Violence & Fall Detection API",
        "model_loaded": is_model_ready,
        "model_weights": str(MODEL_WEIGHTS),
        "device": device_used,
        "supported_classes": class_names
    }


@app.post("/predict/video", summary="Phát hiện bạo lực/ngã từ file video (đọc raw bytes)")
async def predict_video(
    file: UploadFile = File(..., description="File video định dạng mp4, avi, mov,..."),
    conf: float = Query(0.5, ge=0.0, le=1.0, description="Ngưỡng tin cậy (Confidence)"),
    stride: int = Query(2, ge=1, le=10, description="Bước nhảy frame "),
):

    if model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mô hình chưa được nạp sẵn sàng trên server."
        )

    # Kiểm tra phần mở rộng file
    filename = file.filename or "uploaded_video.mp4"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in [".mp4", ".avi", ".mov", ".mkv", ".webm"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Định dạng video không được hỗ trợ. Vui lòng gửi file .mp4, .avi, .mov hoặc .mkv."
        )

    # 1. Đọc nội dung video dạng raw bytes
    video_bytes: bytes = await file.read()
    if not video_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File tải lên rỗng (0 bytes)."
        )

    # 2. Ghi bytes vào NamedTemporaryFile
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as temp_video_file:
        temp_video_file.write(video_bytes)
        temp_video_path = temp_video_file.name

    try:
        # 3. Gọi hàm inference video
        results = infer_video(
            video_path=temp_video_path,
            conf_threshold=conf,
            frame_stride=stride
        )
        return JSONResponse(content=results)

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi trong quá trình xử lý video: {str(e)}"
        )

    finally:
        # Dọn dẹp file tạm
        if os.path.exists(temp_video_path):
            os.remove(temp_video_path)

@app.post("/predict/video/render", summary="Inference và xuất trả file video đã vẽ bounding box")
async def predict_video_and_render(
    file: UploadFile = File(..., description="File video định dạng mp4, avi, mov,..."),
    conf: float = Query(0.5, ge=0.0, le=1.0, description="Ngưỡng tin cậy (Confidence)"),
    stride: int = Query(1, ge=1, le=5, description="Bước nhảy frame"),
):
    
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mô hình chưa được nạp sẵn sàng."
        )

    filename = file.filename or "video.mp4"
    ext = os.path.splitext(filename)[1].lower()

    video_bytes: bytes = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as temp_in:
        temp_in.write(video_bytes)
        input_path = temp_in.name

    output_path = tempfile.mktemp(suffix=".mp4")

    try:
        infer_video(
            video_path=input_path,
            conf_threshold=conf,
            frame_stride=stride,
            save_annotated_path=output_path
        )

        return FileResponse(
            path=output_path,
            filename=f"detected_{filename}",
            media_type="video/mp4"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi khi render video: {str(e)}"
        )
    finally:
        if os.path.exists(input_path):
            os.remove(input_path)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)