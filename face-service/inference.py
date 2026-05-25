# face-service/inference.py
import numpy as np
from pathlib import Path

try:
    import ai_edge_litert.interpreter as tflite
except ImportError:
    try:
        import tflite_runtime.interpreter as tflite
    except ImportError:
        import tensorflow.lite as tflite

_MODEL_PATH = Path(__file__).parent / "models" / "mobilefacenet.tflite"

# Load once at import — this is the warm model kept in RAM
_interpreter = tflite.Interpreter(model_path=str(_MODEL_PATH))
_interpreter.allocate_tensors()

_input_details  = _interpreter.get_input_details()   # shape: [1, 112, 112, 3]
_output_details = _interpreter.get_output_details()  # shape: [1, 512]


def get_embedding(face_112: np.ndarray) -> np.ndarray:
    """
    Args:
        face_112: np.ndarray of shape (112, 112, 3), dtype float32, values in [-1, 1]
    Returns:
        embedding: np.ndarray of shape (512,), L2-normalized, dtype float32
    """
    if face_112.shape != (112, 112, 3):
        raise ValueError(f"Expected (112, 112, 3), got {face_112.shape}")

    # Add batch dimension
    input_data = np.expand_dims(face_112, axis=0).astype(np.float32)

    _interpreter.set_tensor(_input_details[0]['index'], input_data)
    _interpreter.invoke()

    embedding = _interpreter.get_tensor(_output_details[0]['index'])[0]  # (512,)

    # L2 normalize so cosine similarity = dot product
    norm = np.linalg.norm(embedding)
    if norm == 0:
        return embedding
    return (embedding / norm).astype(np.float32)


def warmup():
    """Run one dummy inference to pre-warm the interpreter. Call at startup."""
    dummy = np.zeros((112, 112, 3), dtype=np.float32)
    get_embedding(dummy)
