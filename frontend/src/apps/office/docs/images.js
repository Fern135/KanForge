import { officeApi } from '../api';

// Images are fetched with the signed-in session (never by public URL) and
// kept as object URLs for the rest of the visit.
const urls = new Map();

export function imageUrl(imageId) {
  if (!urls.has(imageId)) {
    const p = officeApi.image(imageId).then((blob) => URL.createObjectURL(blob));
    p.catch(() => urls.delete(imageId));
    urls.set(imageId, p);
  }
  return urls.get(imageId);
}

export async function imageBlob(imageId) {
  const res = await fetch(await imageUrl(imageId));
  return res.blob();
}

const MAX_SIDE = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const loadBitmap = (blob) => createImageBitmap(blob);

// Shrinks big photos before upload (like Word's "compress pictures"). GIFs are
// kept as-is so animations survive.
async function prepare(file) {
  if (file.type === 'image/gif' && file.size <= MAX_BYTES) {
    const bmp = await loadBitmap(file);
    return { blob: file, width: bmp.width };
  }
  const bmp = await loadBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size <= MAX_BYTES && file.type !== 'image/webp') return { blob: file, width: bmp.width };
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
  return { blob, width: canvas.width };
}

// Uploads an image file and returns what the image node needs.
export async function uploadImageFile(file, maxWidth) {
  if (!ACCEPTED.includes(file.type)) throw new Error('Use a PNG, JPEG, GIF or WebP image.');
  const { blob, width } = await prepare(file);
  if (blob.size > MAX_BYTES) throw new Error('That image is too large, even after shrinking it.');
  const { image } = await officeApi.uploadImage(await toBase64(blob));
  urls.set(image.id, Promise.resolve(URL.createObjectURL(blob)));
  return { imageId: image.id, width: Math.min(width, Math.round(maxWidth)) };
}

// For imported files, whose images arrive as base64 already.
export async function uploadBase64(base64, contentType) {
  const blob = await fetch(`data:${contentType};base64,${base64}`).then((r) => r.blob());
  return uploadImageFile(new File([blob], 'image', { type: contentType }), 10_000);
}
