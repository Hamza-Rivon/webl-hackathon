/**
 * S3 Service for Workers
 *
 * Handles downloading and uploading files from/to S3.
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream, createReadStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { config } from '../config.js';

const s3Client = new S3Client({
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

export const s3Service = {
  /**
   * Download a file from S3 to local filesystem
   */
  async downloadFile(key: string, localPath: string): Promise<void> {
    await mkdir(dirname(localPath), { recursive: true });

    const command = new GetObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
    });

    const response = await s3Client.send(command);
    const body = response.Body as Readable;

    await pipeline(body, createWriteStream(localPath));
  },

  /**
   * Upload a file from local filesystem to S3
   */
  async uploadFile(
    localPath: string,
    key: string,
    contentType: string
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
      Body: createReadStream(localPath),
      ContentType: contentType,
    });

    await s3Client.send(command);
  },

  /**
   * Upload a buffer to S3
   */
  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await s3Client.send(command);
  },

  /**
   * Get a signed URL for downloading a file (for Mux ingestion)
   */
  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
    });

    return getSignedUrl(s3Client, command, { expiresIn });
  },
};
