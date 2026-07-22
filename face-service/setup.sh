#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=== FotoHaven Face Service Setup ==="
echo "WARNING: Python face-service is experimental and not the default Termux path."
echo "Preferred production mode is browser enrollment or local native HTTP enrollment."
echo "For native Termux OpenCV work, use native-face-service/build.sh with apt + termux-x11."

# Termux / Android builds sometimes need the platform API level exposed for
# Rust-based Python packages such as orjson.
if [ -z "${ANDROID_API_LEVEL:-}" ]; then
  export ANDROID_API_LEVEL="$(getprop ro.build.version.sdk 2>/dev/null || true)"
fi

if [ -n "${ANDROID_API_LEVEL:-}" ]; then
  echo "Using ANDROID_API_LEVEL=$ANDROID_API_LEVEL"
fi

# 1. System packages
pkg install -y \
  python \
  python-pip \
  python-numpy \
  python-pillow \
  libjpeg-turbo \
  libpng \
  clang \
  rust \
  make \
  pkg-config

# 2. Upgrade pip tooling first
python -m pip install --upgrade pip setuptools wheel

# 3. Python packages that should come from pip
python -m pip install fastapi==0.111.0 uvicorn==0.29.0

# 4. TFLite runtime
# Prefer Google's current LiteRT package on modern Python/Termux.
python -m pip install ai-edge-litert || {
  echo "ai-edge-litert install failed, trying tflite-runtime..."
  python -m pip install tflite-runtime==2.14.0 || {
    echo "Official tflite-runtime wheel failed, trying ARM64 cp311 community wheel..."
    python -m pip install \
      https://github.com/prepkg/tflite-runtime-raspberrypi/releases/download/2.14.0/tflite_runtime-2.14.0-cp311-cp311-linux_aarch64.whl
  }
}

# 5. Face detector
# Match the current Python code path: try mtcnn-tflite first, then classic mtcnn.
python -m pip install mtcnn-tflite || {
  echo "mtcnn-tflite install failed, trying classic mtcnn..."
  python -m pip install mtcnn==0.1.1
}

# 6. Download MobileFaceNet TFLite model
mkdir -p models
if [ ! -f models/mobilefacenet.tflite ]; then
  echo "Downloading MobileFaceNet model..."
  curl -L \
    "https://github.com/sirius-ai/MobileFaceNet_TF/raw/master/output/MobileFaceNet.tflite" \
    -o models/mobilefacenet.tflite
  echo "Model downloaded: $(du -sh models/mobilefacenet.tflite | cut -f1)"
fi

echo "=== Setup complete. Run: python -m uvicorn main:app --host 127.0.0.1 --port 5001 ==="
