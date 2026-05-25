# Termux Native Face HTTP Rollout Notes

## Default production mode
- `FACE_ENROLLMENT_BACKEND=browser`

## Local native experiment mode
- `FACE_ENROLLMENT_BACKEND=local_native_http`
- `FACE_LOCAL_SERVICE_URL=http://127.0.0.1:5080`

## Remote Python experiment mode
- `FACE_ENROLLMENT_BACKEND=remote_python`
- `FACE_REMOTE_SERVICE_URL=http://<host>:<port>`

## Verified Termux OpenCV findings
- Installed packages:
  - `opencv/x11 4.13.0-2`
  - `opencv-python/x11 4.13.0-2`
  - `python-opencv-python/x11 92-1`
- Repo:
  - `deb https://packages-cf.termux.dev/apt/termux-x11/ x11 main`
- Runtime checks:
  - `hasattr(cv2, "dnn") == True`
  - `hasattr(cv2, "FaceDetectorYN") == True`
  - `hasattr(cv2, "FaceRecognizerSF") == True`
  - `cv2.__version__ == "4.13.0"`
- Functional smoke:
  - YuNet detector loaded successfully
  - SFace recognizer loaded successfully
  - detection on `lena.jpg` found 1 face without error

## Operator rule
- Do not use `pkg` as the OpenCV source for the Termux native backend.
- Use `apt` with the `termux-x11` repo for OpenCV packages.
- Do not claim performance yet; timing numbers are still pending.
