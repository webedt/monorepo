/**
 * MinIO client initialization for internal-api-server
 */

import { Client as MinioClient } from 'minio';
import {
  MINIO_ENDPOINT,
  MINIO_PORT,
  MINIO_USE_SSL,
  MINIO_ROOT_USER,
  MINIO_ROOT_PASSWORD,
  MINIO_BUCKET
} from '../../config/env.js';
import { logger } from '@webedt/shared';

let minioClient: MinioClient | null = null;

/**
 * Get or create the MinIO client instance
 */
export function getMinioClient(): MinioClient {
  if (!minioClient) {
    if (!MINIO_ENDPOINT) {
      throw new Error('MinIO configuration required: MINIO_ENDPOINT not set');
    }

    minioClient = new MinioClient({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: MINIO_USE_SSL,
      accessKey: MINIO_ROOT_USER || 'minioadmin',
      secretKey: MINIO_ROOT_PASSWORD || 'minioadmin',
    });

    logger.info(`MinIO client initialized: ${MINIO_ENDPOINT}:${MINIO_PORT}`, {
      component: 'MinioClient'
    });
  }

  return minioClient;
}

/**
 * Get the configured bucket name
 */
export function getBucket(): string {
  return MINIO_BUCKET;
}

/**
 * Initialize the MinIO bucket (call on startup)
 */
export async function initializeBucket(): Promise<void> {
  const client = getMinioClient();
  const bucket = getBucket();

  try {
    const exists = await client.bucketExists(bucket);
    if (!exists) {
      await client.makeBucket(bucket);
      logger.info(`Created MinIO bucket: ${bucket}`, { component: 'MinioClient' });
    } else {
      logger.info(`Using existing MinIO bucket: ${bucket}`, { component: 'MinioClient' });
    }
  } catch (error) {
    logger.error('Failed to initialize MinIO bucket', error, { component: 'MinioClient' });
    throw error;
  }
}
