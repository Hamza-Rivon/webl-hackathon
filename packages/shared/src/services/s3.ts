/**
 * S3 Service
 *
 * AWS S3 operations for media storage with signed URLs.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { isSafeS3Key } from '../utils/security.js';

// Configuration
const AWS_REGION = process.env.AWS_REGION || 'eu-west-3';
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'webl-media';
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL || '';

// Signed URL expiration times (in seconds)
const UPLOAD_URL_EXPIRY = 60 * 60; // 1 hour for uploads
const DOWNLOAD_URL_EXPIRY = 60 * 60 * 24; // 24 hours for downloads

// S3 Client singleton
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }
  return s3Client;
}

// ----- Types -----

export interface UploadUrlParams {
  key: string;
  contentType: string;
  expiresIn?: number;
}

export interface DownloadUrlParams {
  key: string;
  expiresIn?: number;
}

export interface MultipartUploadInit {
  key: string;
  contentType: string;
}

export interface MultipartUploadPart {
  uploadId: string;
  key: string;
  partNumber: number;
}

export interface CompleteMultipartParams {
  uploadId: string;
  key: string;
  parts: Array<{ ETag: string; PartNumber: number }>;
}

// ----- S3 Path Helpers -----

/**
 * Generate S3 key for user voiceover
 */
export function getVoiceoverKey(userId: string, episodeId: string, filename: string): string {
  return `users/${userId}/voiceovers/${episodeId}/${filename}`;
}

/**
 * Generate S3 key for user raw clip
 */
export function getRawClipKey(userId: string, episodeId: string, clipId: string): string {
  return `users/${userId}/clips/${episodeId}/raw/${clipId}.mp4`;
}

/**
 * Generate S3 key for proxy clip
 */
export function getProxyClipKey(userId: string, episodeId: string, clipId: string): string {
  return `users/${userId}/clips/${episodeId}/proxy/${clipId}_proxy.mp4`;
}

/**
 * Generate S3 key for rendered video
 */
export function getRenderKey(userId: string, episodeId: string): string {
  return `users/${userId}/renders/${episodeId}/final.mp4`;
}

/**
 * Generate S3 key for thumbnail
 */
export function getThumbnailKey(userId: string, episodeId: string): string {
  return `users/${userId}/renders/${episodeId}/thumbnail.jpg`;
}

/**
 * Generate S3 key for variation
 */
export function getVariationKey(userId: string, episodeId: string, variationNum: number): string {
  return `users/${userId}/renders/${episodeId}/variations/v${variationNum}.mp4`;
}

// ----- Core S3 Operations -----

/**
 * Generate a pre-signed URL for uploading
 */
export async function getUploadSignedUrl(params: UploadUrlParams): Promise<string> {
  const { key, contentType, expiresIn = UPLOAD_URL_EXPIRY } = params;

  if (!isSafeS3Key(key)) {
    throw new Error('Invalid S3 key');
  }

  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Generate a pre-signed URL for downloading
 */
export async function getDownloadSignedUrl(params: DownloadUrlParams): Promise<string> {
  const { key, expiresIn = DOWNLOAD_URL_EXPIRY } = params;

  if (!isSafeS3Key(key)) {
    throw new Error('Invalid S3 key');
  }

  // Use CloudFront if available
  if (CLOUDFRONT_URL) {
    return `${CLOUDFRONT_URL}/${key}`;
  }

  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Check if an object exists
 */
export async function objectExists(key: string): Promise<boolean> {
  if (!isSafeS3Key(key)) {
    throw new Error('Invalid S3 key');
  }

  const client = getS3Client();
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete an object
 */
export async function deleteObject(key: string): Promise<void> {
  if (!isSafeS3Key(key)) {
    throw new Error('Invalid S3 key');
  }

  const client = getS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
    })
  );
}

/**
 * Copy an object
 */
export async function copyObject(sourceKey: string, destinationKey: string): Promise<void> {
  if (!isSafeS3Key(sourceKey) || !isSafeS3Key(destinationKey)) {
    throw new Error('Invalid S3 key');
  }

  const client = getS3Client();
  await client.send(
    new CopyObjectCommand({
      Bucket: S3_BUCKET_NAME,
      CopySource: `${S3_BUCKET_NAME}/${sourceKey}`,
      Key: destinationKey,
    })
  );
}

// ----- Multipart Upload Operations -----

/**
 * Initialize a multipart upload
 */
export async function initMultipartUpload(params: MultipartUploadInit): Promise<string> {
  const { key, contentType } = params;

  if (!isSafeS3Key(key)) {
    throw new Error('Invalid S3 key');
  }

  const client = getS3Client();
  const response = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    })
  );

  if (!response.UploadId) {
    throw new Error('Failed to initialize multipart upload');
  }

  return response.UploadId;
}

/**
 * Get signed URL for a multipart upload part
 */
export async function getMultipartPartUrl(params: MultipartUploadPart): Promise<string> {
  const { uploadId, key, partNumber } = params;

  if (!isSafeS3Key(key)) {
    throw new Error('Invalid S3 key');
  }

  const client = getS3Client();
  const command = new UploadPartCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });

  return getSignedUrl(client, command, { expiresIn: UPLOAD_URL_EXPIRY });
}

/**
 * Complete a multipart upload
 */
export async function completeMultipartUpload(params: CompleteMultipartParams): Promise<void> {
  const { uploadId, key, parts } = params;

  if (!isSafeS3Key(key)) {
    throw new Error('Invalid S3 key');
  }

  const client = getS3Client();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  );
}

/**
 * Abort a multipart upload
 */
export async function abortMultipartUpload(uploadId: string, key: string): Promise<void> {
  if (!isSafeS3Key(key)) {
    throw new Error('Invalid S3 key');
  }

  const client = getS3Client();
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
    })
  );
}
