export type CompressionFormat = "jpeg" | "webp";

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = url;
  });
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function blobToFile(blob: Blob, originalName: string, format: CompressionFormat) {
  const ext = format === "jpeg" ? "jpg" : "webp";
  const safeName = originalName.replace(/\.[^.]+$/, "");
  return new File([blob], `${safeName}.${ext}`, {
    type: blob.type,
    lastModified: Date.now(),
  });
}

export async function compressImageFile(
  file: File,
  format: CompressionFormat,
  quality: number
): Promise<File> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageFromUrl(objectUrl);
    const canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return file;
    }

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const mimeType = format === "jpeg" ? "image/jpeg" : "image/webp";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, Math.max(0.1, Math.min(1, quality / 100)))
    );

    if (!blob) {
      return file;
    }

    if (blob.size >= file.size) {
      return file;
    }

    return blobToFile(blob, file.name, format);
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function computeDHashFromUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch image for hashing");
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = createCanvas(9, 8);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.drawImage(bitmap, 0, 0, 9, 8);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, 9, 8);
  let hash = BigInt(0);

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = grayscaleAt(data, x, y, 9);
      const right = grayscaleAt(data, x + 1, y, 9);
      hash = (hash << BigInt(1)) | BigInt(left > right ? 1 : 0);
    }
  }

  return hash.toString(16).padStart(16, "0");
}

function grayscaleAt(data: Uint8ClampedArray, x: number, y: number, width: number) {
  const offset = (y * width + x) * 4;
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  return r * 0.299 + g * 0.587 + b * 0.114;
}

export function hammingDistance(left: string, right: string) {
  const xor = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let value = xor;
  let count = 0;

  while (value > BigInt(0)) {
    count += Number(value & BigInt(1));
    value >>= BigInt(1);
  }

  return count;
}
