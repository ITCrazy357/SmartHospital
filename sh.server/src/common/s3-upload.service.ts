import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { extname } from 'path';

@Injectable()
export class S3UploadService {
  private readonly logger = new Logger(S3UploadService.name);

  private readonly supabase: SupabaseClient;
  private readonly bucket: string;
  private readonly supabaseUrl: string;

  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL ?? '';
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'smart-hospital';

    // Ưu tiên secret key mới, hỗ trợ thêm service_role key cũ
    const secretKey =
      process.env.SUPABASE_SECRET_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      '';

    if (!this.supabaseUrl) {
      throw new Error('Thiếu biến môi trường SUPABASE_URL');
    }

    if (!secretKey) {
      throw new Error(
        'Thiếu SUPABASE_SECRET_KEY hoặc SUPABASE_SERVICE_ROLE_KEY',
      );
    }

    this.supabase = createClient(this.supabaseUrl, secretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  /**
   * Upload file lên Supabase Storage.
   * Trả về public URL để lưu vào database.
   */
  async upload(file: Express.Multer.File, prefix = 'uploads'): Promise<string> {
    let extension = extname(file.originalname).toLowerCase();

    if (!extension || extension.length > 6) {
      extension = this.extFromMime(file.mimetype);
    }

    const objectPath = `${prefix}/${randomUUID()}${extension}`;

    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      this.logger.error(`Upload Supabase Storage thất bại: ${error.message}`);

      throw new InternalServerErrorException(
        `Không thể tải ảnh lên hệ thống: ${error.message}`,
      );
    }

    const { data } = this.supabase.storage
      .from(this.bucket)
      .getPublicUrl(objectPath);

    if (!data.publicUrl) {
      throw new InternalServerErrorException(
        'Không thể tạo public URL cho ảnh',
      );
    }

    return data.publicUrl;
  }

  /**
   * Xóa file trên Supabase Storage bằng public URL hoặc object path.
   */
  async delete(urlOrKey: string): Promise<void> {
    try {
      const objectPath = this.extractObjectPath(urlOrKey);

      if (!objectPath) {
        return;
      }

      const { error } = await this.supabase.storage
        .from(this.bucket)
        .remove([objectPath]);

      if (error) {
        this.logger.warn(`Không xóa được file ${objectPath}: ${error.message}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Lỗi không xác định';

      this.logger.warn(`Không xóa được file ${urlOrKey}: ${message}`);
    }
  }

  private extractObjectPath(urlOrKey: string): string | null {
    if (!urlOrKey) {
      return null;
    }

    try {
      const url = new URL(urlOrKey);

      // Không cố xóa URL cũ thuộc AWS hoặc dịch vụ khác
      if (!url.href.startsWith(this.supabaseUrl)) {
        return null;
      }

      const marker = `/storage/v1/object/public/${this.bucket}/`;

      const markerIndex = url.pathname.indexOf(marker);

      if (markerIndex === -1) {
        return null;
      }

      const encodedPath = url.pathname.slice(markerIndex + marker.length);

      return decodeURIComponent(encodedPath);
    } catch {
      // Không phải URL thì coi là object path trực tiếp
      return urlOrKey;
    }
  }

  private extFromMime(mimetype: string): string {
    switch (mimetype) {
      case 'image/png':
        return '.png';

      case 'image/webp':
        return '.webp';

      case 'image/gif':
        return '.gif';

      case 'image/jpeg':
      case 'image/jpg':
      default:
        return '.jpg';
    }
  }
}
