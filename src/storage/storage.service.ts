import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type UploadedObject = {
  key: string;
  size: number;
  contentType: string;
};

/**
 * Thin wrapper over the S3-compatible Neon Object Storage bucket.
 *
 * - `upload()` stores an object (migration + future upload endpoint).
 * - `signGetUrl()` mints a presigned GET URL so images can be served from a
 *   private bucket without exposing credentials. Results are cached in memory
 *   until shortly before expiry, since signing is pure computation and the
 *   same URLs are requested on every list/detail call.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly presignTtlSeconds: number;
  private readonly presignCache = new Map<string, { url: string; expiresAt: number }>();

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('AWS_ENDPOINT_URL_S3');
    const region = config.get<string>('AWS_REGION');
    const accessKeyId = config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('AWS_SECRET_ACCESS_KEY');

    if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'Missing AWS_ENDPOINT_URL_S3 / AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env',
      );
    }

    this.bucket = config.get<string>('S3_BUCKET') ?? 'assets';
    this.presignTtlSeconds = Number(config.get<string>('S3_PRESIGN_TTL_SECONDS') ?? 7 * 24 * 3600);
    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // required for a custom S3 endpoint
    });
  }

  getBucket(): string {
    return this.bucket;
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<UploadedObject> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
      }),
    );
    return { key, size: body.byteLength, contentType };
  }

  /** True when the object already exists (used by the migration to skip work). */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (err && (err as { name?: string }).name === 'NotFound') return false;
      throw err;
    }
  }

  async signGetUrl(key: string): Promise<string> {
    const cached = this.presignCache.get(key);
    const now = Date.now();
    // Refresh 5 minutes before the signed URL stops working.
    if (cached && cached.expiresAt - 5 * 60_000 > now) {
      return cached.url;
    }

    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: this.presignTtlSeconds },
    );
    this.presignCache.set(key, { url, expiresAt: now + this.presignTtlSeconds * 1000 });
    return url;
  }

  /** Batch helper: preserves input order, deduplicates identical keys. */
  async signMany(keys: Array<string | null>): Promise<Array<string | null>> {
    const unique = [...new Set(keys.filter((k): k is string => Boolean(k)))];
    const signed = new Map<string, string>();
    for (const key of unique) {
      signed.set(key, await this.signGetUrl(key));
    }
    return keys.map((key) => (key ? (signed.get(key) ?? null) : null));
  }
}