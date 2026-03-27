from ultralytics import YOLO

# Load pretrained model
model = YOLO("yolov8s.pt")

# Train model
model.train(
    data="dataset/data.yaml",   # path to your dataset yaml
    epochs=30,
    imgsz=640,
    batch=4,      # lower batch size for CPU
    device="cpu"  # since you don't have GPU
)