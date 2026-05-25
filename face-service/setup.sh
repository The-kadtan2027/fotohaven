#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=== FotoHaven Face Service Setup ==="

# 1. System packages
pkg install -y python python-pip

# 2. pip packages
pip install fastapi==0.111.0 uvicorn==0.29.0 numpy==1.26.4 Pillow==10.3.0 mtcnn==0.1.1

# 3. tflite-runtime — try official first, fall back to ARM64 wheel
pip install tflite-runtime==2.14.0 || {
  echo "Official wheel failed, trying ARM64 community wheel..."
  # Python 3.11 ARM64 wheel
  pip install \
    https://github.com/prepkg/tflite-runtime-raspberrypi/releases/download/2.14.0/tflite_runtime-2.14.0-cp311-cp311-linux_aarch64.whl
}

# 4. Download MobileFaceNet TFLite model
mkdir -p models
if [ ! -f models/mobilefacenet.tflite ]; then
  echo "Downloading MobileFaceNet model..."
  curl -L \
    "https://github.com/sirius-ai/MobileFaceNet_TF/raw/master/output/MobileFaceNet.tflite" \
    -o models/mobilefacenet.tflite
  echo "Model downloaded: $(du -sh models/mobilefacenet.tflite | cut -f1)"
fi

echo "=== Setup complete. Run: uvicorn main:app --host 127.0.0.1 --port 5001 ==="
