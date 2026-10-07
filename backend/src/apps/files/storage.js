'use strict';

const {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const config = require('../../core/config');
const AppError = require('../../core/utils/AppError');

// The object store that holds file contents (Garage by default, or any other
// S3-compatible service; see the S3_* settings in core/config). Everything the
// Files app does with file bytes goes through here, so the rest of the app never
// talks to S3 directly.
//
// Contents live at "<S3_KEY_PREFIX>files/<node id>". Names, folders and sharing
// are only in MongoDB: the store just holds bytes under ids nobody can guess.

const settings = config.storage;

// One client for the whole process. Checksums are only sent when S3 requires
// them: Garage and several other S3-compatible stores reject the newer default.
const client = settings && new S3Client({
  endpoint: settings.endpoint,
  region: settings.region,
  forcePathStyle: settings.forcePathStyle,
  credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const configured = () => Boolean(client);

// Every route that touches file contents calls this first, so an install
// without storage answers clearly instead of failing deep inside the SDK.
function assertConfigured() {
  if (!client) {
    throw new AppError(503, 'File storage isn\'t set up on this server yet. Ask a platform admin to configure it.', 'STORAGE_NOT_CONFIGURED');
  }
}

const keyFor = (nodeId) => `${settings?.keyPrefix ?? ''}files/${nodeId}`;
// Where a file's preview image lives: next to its contents.
const thumbKeyFor = (storageKey) => `${storageKey}.thumb`;
const bucket = () => settings.bucket;

// Starts a multipart upload and returns its id. Parts are sent one by one
// (uploadPart) and stitched together at the end (completeUpload).
async function createUpload(key, mime) {
  const out = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: mime }));
  return out.UploadId;
}

// Streams one part straight from the request into the store, without holding it
// in memory. `length` must be the exact number of bytes the stream will give.
// `signal` aborts the transfer (the browser went away mid-part).
async function uploadPart({ key, uploadId, partNumber, body, length, signal }) {
  await client.send(
    new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body, ContentLength: length }),
    { abortSignal: signal },
  );
}

// Every part the store has received for an upload, as [{ PartNumber, Size, ETag }].
// The store lists at most 1000 per call, so this pages through all of them.
async function listParts(key, uploadId) {
  const parts = [];
  let marker;
  do {
    const out = await client.send(new ListPartsCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumberMarker: marker }));
    parts.push(...(out.Parts || []));
    marker = out.IsTruncated ? out.NextPartNumberMarker : undefined;
  } while (marker);
  return parts;
}

// Joins the parts into the final object. parts: [{ PartNumber, ETag }] in order.
async function completeUpload(key, uploadId, parts) {
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucket(),
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })) },
  }));
}

// Throws away an unfinished upload and every part it received.
async function abortUpload(key, uploadId) {
  await client.send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }));
}

// Empty files skip the multipart dance: there's nothing to send in parts.
async function putEmpty(key, mime) {
  await client.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: Buffer.alloc(0), ContentType: mime }));
}

// Opens a file's contents for reading. range: { start, end } (inclusive) for
// part of it, as a video player asks for when seeking. Returns the SDK output,
// whose Body is a readable stream.
// Stores a small object in one go (preview images: a few hundred KB at most).
async function put(key, body, mime) {
  await client.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: mime }));
}

async function read(key, range, signal) {
  return client.send(
    new GetObjectCommand({ Bucket: bucket(), Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }),
    { abortSignal: signal },
  );
}

async function remove(key) {
  await client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

// "Already gone" answers, which count as success when deleting or aborting.
const isGone = (err) => ['NoSuchKey', 'NoSuchUpload', 'NotFound'].includes(err?.name) || err?.$metadata?.httpStatusCode === 404;

module.exports = {
  configured,
  assertConfigured,
  keyFor,
  thumbKeyFor,
  put,
  createUpload,
  uploadPart,
  listParts,
  completeUpload,
  abortUpload,
  putEmpty,
  read,
  remove,
  isGone,
};
