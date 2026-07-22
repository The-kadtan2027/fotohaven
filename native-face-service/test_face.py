from __future__ import annotations

import argparse
import time
from pathlib import Path

import cv2

from opencv_backend import extract_photo_embeddings, get_models, model_paths


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test YuNet + SFace on one image.")
    parser.add_argument("image", help="Path to a test image such as lena.jpg")
    args = parser.parse_args()

    image_path = Path(args.image)
    if not image_path.is_file():
        raise SystemExit(f"Image not found: {image_path}")

    image = cv2.imread(str(image_path))
    if image is None:
        raise SystemExit(f"Failed to load image: {image_path}")

    print(f"OpenCV version: {cv2.__version__}")
    print("[Test 1] Loading YuNet detector...")
    started = time.perf_counter()
    detector, recognizer = get_models()
    detector_ms = (time.perf_counter() - started) * 1000
    print(f"  -> PASS: detector loaded in {detector_ms:.1f} ms")

    print("[Test 2] Loading SFace recognizer...")
    started = time.perf_counter()
    _ = recognizer
    recognizer_ms = (time.perf_counter() - started) * 1000
    print(f"  -> PASS: recognizer ready in {recognizer_ms:.1f} ms")

    print("[Test 3] Running detection + embedding on test image...")
    started = time.perf_counter()
    results = extract_photo_embeddings(image)
    total_ms = (time.perf_counter() - started) * 1000

    print(f"  -> Models: {model_paths()}")
    print(f"  -> Detected {len(results)} face(s) in test image")
    print(f"  -> Total pipeline time: {total_ms:.1f} ms")
    if results:
        print(f"  -> First embedding dim: {len(results[0]['embedding'])}")
        print(f"  -> First bbox: {results[0]['bounding_box']}")
    print("  -> PASS: detection ran without error")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
