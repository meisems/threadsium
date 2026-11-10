// Downsizes a picked image in the browser before upload, so uploads fit the free storage limits and
// phones do not send 8 MB camera files. GIFs are passed through untouched to keep their animation.

export async function prepareImage(file: File, maxEdge: number, maxBytes: number): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new Error("Only PNG, JPEG, WebP and GIF images can be uploaded.");
  }
  if (file.type === "image/gif") {
    if (file.size > maxBytes) throw new Error(`That GIF is larger than ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`);
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image could not be opened. Try a different file.");
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= Math.min(maxBytes, 400 * 1024)) {
    bitmap.close();
    return file;
  }
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize images.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  for (const quality of [0.84, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    const out = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (out && out.size <= maxBytes) return out;
  }
  throw new Error("That image is too large even after resizing. Try a smaller one.");
}
