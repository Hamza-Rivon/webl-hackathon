/**
 * S3 Service
 *
 * AWS S3 operations for media storage with signed URLs.
 */
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
    parts: Array<{
        ETag: string;
        PartNumber: number;
    }>;
}
/**
 * Generate S3 key for user voiceover
 */
export declare function getVoiceoverKey(userId: string, episodeId: string, filename: string): string;
/**
 * Generate S3 key for user raw clip
 */
export declare function getRawClipKey(userId: string, episodeId: string, clipId: string): string;
/**
 * Generate S3 key for proxy clip
 */
export declare function getProxyClipKey(userId: string, episodeId: string, clipId: string): string;
/**
 * Generate S3 key for rendered video
 */
export declare function getRenderKey(userId: string, episodeId: string): string;
/**
 * Generate S3 key for thumbnail
 */
export declare function getThumbnailKey(userId: string, episodeId: string): string;
/**
 * Generate S3 key for variation
 */
export declare function getVariationKey(userId: string, episodeId: string, variationNum: number): string;
/**
 * Generate a pre-signed URL for uploading
 */
export declare function getUploadSignedUrl(params: UploadUrlParams): Promise<string>;
/**
 * Generate a pre-signed URL for downloading
 */
export declare function getDownloadSignedUrl(params: DownloadUrlParams): Promise<string>;
/**
 * Check if an object exists
 */
export declare function objectExists(key: string): Promise<boolean>;
/**
 * Delete an object
 */
export declare function deleteObject(key: string): Promise<void>;
/**
 * Copy an object
 */
export declare function copyObject(sourceKey: string, destinationKey: string): Promise<void>;
/**
 * Initialize a multipart upload
 */
export declare function initMultipartUpload(params: MultipartUploadInit): Promise<string>;
/**
 * Get signed URL for a multipart upload part
 */
export declare function getMultipartPartUrl(params: MultipartUploadPart): Promise<string>;
/**
 * Complete a multipart upload
 */
export declare function completeMultipartUpload(params: CompleteMultipartParams): Promise<void>;
/**
 * Abort a multipart upload
 */
export declare function abortMultipartUpload(uploadId: string, key: string): Promise<void>;
//# sourceMappingURL=s3.d.ts.map