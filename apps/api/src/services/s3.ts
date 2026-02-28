/**
 * S3 Service
 *
 * Handles all S3 operations including signed URLs for uploads.
 */

import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost, PresignedPost } from '@aws-sdk/s3-presigned-post';
import { config } from '../config/index.js';

const s3Client = new S3Client({
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

interface CompletedPart {
  ETag: string;
  PartNumber: number;
}

export const s3Service = {
  /**
   * Get a presigned POST URL for uploading a file
   */
  async getPresignedUploadUrl(key: string, contentType: string): Promise<PresignedPost> {
    return createPresignedPost(s3Client, {
      Bucket: config.s3.bucketName,
      Key: key,
      Conditions: [
        ['content-length-range', 0, 5 * 1024 * 1024 * 1024], // Max 5GB
        ['starts-with', '$Content-Type', contentType],
      ],
      Fields: {
        'Content-Type': contentType,
      },
      Expires: 3600, // 1 hour
    });
  },

  /**
   * Initiate a multipart upload for large files
   */
  async initiateMultipartUpload(key: string, contentType: string): Promise<string> {
    const command = new CreateMultipartUploadCommand({
      Bucket: config.s3.bucketName,
      Key: key,
      ContentType: contentType,
    });

    const response = await s3Client.send(command);
    return response.UploadId!;
  },

  /**
   * Get a signed URL for uploading a part of a multipart upload
   */
  async getMultipartUploadUrl(
    key: string,
    uploadId: string,
    partNumber: number
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: config.s3.bucketName,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
  },

  /**
   * Complete a multipart upload
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[]
  ): Promise<void> {
    const command = new CompleteMultipartUploadCommand({
      Bucket: config.s3.bucketName,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
      },
    });

    await s3Client.send(command);
  },

  /**
   * Get a signed URL for downloading a file
   */
  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    // For CloudFront-enabled buckets, return CloudFront URL
    if (config.s3.cloudfrontUrl) {
      return `${config.s3.cloudfrontUrl}/${key}`;
    }

    const command = new GetObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
    });

    return getSignedUrl(s3Client, command, { expiresIn });
  },

  /**
   * Upload a buffer directly to S3
   */
  async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: metadata,
    });

    await s3Client.send(command);
  },
};
