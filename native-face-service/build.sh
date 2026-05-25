#!/data/data/com.termux/files/usr/bin/bash
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== FotoHaven Native Face Service Bootstrap ==="
echo "Using verified Termux path: apt + termux-x11 OpenCV packages."

TERMUX_APT_DIR="${PREFIX:-/data/data/com.termux/files/usr}/etc/apt/sources.list.d"
X11_REPO_FILE="$TERMUX_APT_DIR/x11.list"

mkdir -p "$TERMUX_APT_DIR"

if ! grep -Rqs "termux-x11" "$TERMUX_APT_DIR" 2>/dev/null; then
  cat > "$X11_REPO_FILE" <<'EOF'
deb https://packages-cf.termux.dev/apt/termux-x11/ x11 main
# deb https://packages.termux.dev/apt/termux-x11/ x11 main
EOF
  echo "Added termux-x11 apt repo: $X11_REPO_FILE"
else
  echo "termux-x11 apt repo already configured."
fi

apt update
apt install -y \
  opencv \
  opencv-python \
  python-numpy \
  python \
  python-pip \
  clang \
  cmake \
  ninja \
  make \
  pkg-config \
  curl

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

mkdir -p models

if [ ! -f models/face_detection_yunet_2023mar.onnx ]; then
  curl -L \
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx" \
    -o models/face_detection_yunet_2023mar.onnx
fi

if [ ! -f models/face_recognition_sface_2021dec.onnx ]; then
  curl -L \
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx" \
    -o models/face_recognition_sface_2021dec.onnx
fi

python - <<'PY'
import cv2

checks = {
    "dnn": hasattr(cv2, "dnn"),
    "FaceDetectorYN": hasattr(cv2, "FaceDetectorYN"),
    "FaceRecognizerSF": hasattr(cv2, "FaceRecognizerSF"),
}

print("OpenCV version:", cv2.__version__)
for name, ok in checks.items():
    print(f"{name}: {ok}")

missing = [name for name, ok in checks.items() if not ok]
if missing:
    raise SystemExit(f"Missing required OpenCV features: {', '.join(missing)}")
PY

echo "Native OpenCV prerequisites installed."
echo "Run service with:"
echo "  python -m uvicorn main:app --host 127.0.0.1 --port 5080"
