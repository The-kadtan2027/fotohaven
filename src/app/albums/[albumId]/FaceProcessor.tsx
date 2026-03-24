"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as faceapi from "face-api.js";

type FaceProcessorPhoto = {
  id: string;
  url: string;
  faceProcessed: boolean;
};

type FaceProcessorProps = {
  photos: FaceProcessorPhoto[];
};

let modelLoadPromise: Promise<void> | null = null;

async function ensureModelsLoaded() {
  if (!modelLoadPromise) {
    modelLoadPromise = (async () => {
      console.log("[FaceProcessor] Loading models from /models...");
      await faceapi.nets.ssdMobilenetv1.loadFromUri("/models");
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models");
      await faceapi.nets.faceRecognitionNet.loadFromUri("/models");
      console.log("[FaceProcessor] Models loaded.");
    })();
  }
  await modelLoadPromise;
}

export default function FaceProcessor({ photos }: FaceProcessorProps) {
  const queue = useMemo(
    () => photos.filter((photo) => !photo.faceProcessed),
    [photos]
  );

  const [processed, setProcessed] = useState(0);
  const [running, setRunning] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [completeCount, setCompleteCount] = useState<number | null>(null);

  const shouldStopRef = useRef(false);

  useEffect(() => {
    shouldStopRef.current = false;
    setDismissed(false);
    setProcessed(0);
    setCompleteCount(null);

    if (queue.length === 0) {
      setRunning(false);
      return;
    }

    let cancelled = false;

    async function run() {
      setRunning(true);
      await ensureModelsLoaded();

      let successCount = 0;
      for (const photo of queue) {
        if (cancelled || shouldStopRef.current) break;

        try {
          const response = await fetch(photo.url);
          if (!response.ok) {
            throw new Error(`Failed to fetch photo ${photo.id}`);
          }

          const blob = await response.blob();
          const bitmap = await createImageBitmap(blob);

          try {
            const detections = await faceapi
              .detectAllFaces(
                bitmap as any,
                new faceapi.SsdMobilenetv1Options({
                  minConfidence: 0.3,
                  inputSize: 416,
                } as any)
              )
              .withFaceLandmarks(true)
              .withFaceDescriptors();

            const faces = detections.map((det) => ({
              descriptor: Array.from(det.descriptor),
              boundingBox: {
                x: det.detection.box.x,
                y: det.detection.box.y,
                width: det.detection.box.width,
                height: det.detection.box.height,
              },
            }));

            const saveResponse = await fetch(`/api/photos/${photo.id}/faces`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ faces }),
            });

            if (!saveResponse.ok) {
              throw new Error(`Failed to save faces for ${photo.id}`);
            }

            successCount += 1;
            setProcessed((prev) => prev + 1);
            console.log(
              `[FaceProcessor] Processed ${photo.id}: ${faces.length} face(s)`
            );
          } finally {
            bitmap.close();
          }
        } catch (error) {
          console.error(`[FaceProcessor] Failed photo ${photo.id}`, error);
        }
      }

      if (!cancelled && !shouldStopRef.current) {
        setCompleteCount(successCount);
      }
      setRunning(false);
    }

    run().catch((error) => {
      console.error("[FaceProcessor] Fatal processing error", error);
      setRunning(false);
    });

    return () => {
      cancelled = true;
      shouldStopRef.current = true;
    };
  }, [queue]);

  if (queue.length === 0 || dismissed) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 200,
        background: "var(--espresso)",
        color: "#fff",
        padding: "10px 12px",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        minWidth: 260,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 12 }}>
        {running
          ? `Processing faces (${processed}/${queue.length})`
          : completeCount !== null
            ? `Face processing complete (${completeCount} photos)`
            : `Processing faces (${processed}/${queue.length})`}
      </span>
      {running && (
        <button
          onClick={() => {
            shouldStopRef.current = true;
            setRunning(false);
            setDismissed(true);
          }}
          style={{
            border: "1px solid rgba(255,255,255,0.3)",
            background: "transparent",
            color: "#fff",
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
