# Native Face Service

Experimental localhost HTTP face extraction service intended for Termux.

Initial target:
- bind to `127.0.0.1:5080`
- provide `/health`
- provide `/extract`
- later add `/extract-batch`

First runtime target:
- OpenCV DNN
- `FaceDetectorYN`
- `FaceRecognizerSF`

FotoHaven integration rules:
- this service is optional
- browser enrollment remains the default production path
- guest matching remains pure JS cosine similarity in Node.js
- this service is for photographer-side enrollment only

## Verified Termux install path

The working OpenCV path on Android/Termux is `apt` from the `termux-x11` repo, not `pkg`.

Validated environment findings:
- Installed packages:
  - `opencv/x11 4.13.0-2`
  - `opencv-python/x11 4.13.0-2`
  - `python-opencv-python/x11 92-1`
- Configured repo:
  - `deb https://packages-cf.termux.dev/apt/termux-x11/ x11 main`
- Python runtime checks passed:
  - `hasattr(cv2, "dnn") == True`
  - `hasattr(cv2, "FaceDetectorYN") == True`
  - `hasattr(cv2, "FaceRecognizerSF") == True`
  - `cv2.__version__ == "4.13.0"`
- Functional smoke:
  - `test_face.py` loaded YuNet and SFace successfully
  - Detection on `lena.jpg` found 1 face without error

## Required Termux bootstrap

1. Enable the `termux-x11` apt repo if it is not already configured.
2. Install native packages with `apt`, not `pkg`:

```bash
apt update
apt install -y opencv opencv-python python-numpy python clang cmake ninja make pkg-config
```

3. Verify the Python bindings and DNN-backed face APIs:

```bash
python -c "import cv2; print(cv2.__version__); print(hasattr(cv2, 'dnn')); print(hasattr(cv2, 'FaceDetectorYN')); print(hasattr(cv2, 'FaceRecognizerSF'))"
```

4. Only after those checks pass, continue with service implementation and ONNX model wiring.

## Current status

- The install path is now known and reproducible.
- DNN-backed OpenCV face APIs are present on-device.
- Timing benchmarks have not yet been captured in this repo; only functional detection success is confirmed so far.

## Runtime contract

The service mirrors the current localhost proxy expectations:
- `GET /health`
- `POST /search`
- `POST /enroll`
- `GET /enroll/status/{eventId}`

It writes and reads `face_embeddings` in SQLite, matching the existing service-backed proxy contract.

## Bootstrap

From Termux:

```bash
cd ~/fotohaven/native-face-service
bash build.sh
python -m uvicorn main:app --host 127.0.0.1 --port 5080
```

`build.sh` will:
- ensure the `termux-x11` apt repo exists
- install OpenCV and Python prerequisites
- download the official YuNet and SFace ONNX models
- install the lightweight HTTP server dependencies

## Smoke test

After `build.sh`, run:

```bash
python test_face.py /path/to/test.jpg
```

This verifies:
- detector model load
- recognizer model load
- end-to-end detection and embedding extraction timing

## Important limitation

This native service is an experimental service-backed path. The current guest discovery UI in FotoHaven still uses browser `face-api.js` for the active pure-JS flow, so this service does not automatically replace that live path by itself.
