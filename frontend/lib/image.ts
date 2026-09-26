// Downscale + re-encode a photo in the browser before it is uploaded, so vision
// payloads stay small and fast (Reader OCR, photos in Mika chat). Takes the picked
// File or an existing data: URL (to cut a thumbnail from an already-shrunk image).
export function downscaleImage(src: Blob | string, maxDim = 1600, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const done = () => {
      if (typeof src !== "string") URL.revokeObjectURL(url);
    };
    const img = new Image();
    img.onload = () => {
      done();
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      // A transparent PNG (a screenshot of a dark-mode app) would turn black as JPEG.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      done();
      reject(new Error("bad image"));
    };
    img.src = url;
  });
}

/** Image files among what was pasted or dropped. */
export function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = item instanceof File ? item : item.kind === "file" ? item.getAsFile() : null;
    if (file && (file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name))) out.push(file);
  }
  return out;
}
