import sharp from "sharp";
import type { GalleryImageProcessorPort, GalleryProcessedVariant, GalleryVariantKind, ProcessedGalleryImage } from "@inkendar/application";
import { InvalidGalleryInputError } from "@inkendar/domain";

export const GALLERY_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const GALLERY_MAX_DIMENSION = 12_000;
export const GALLERY_MAX_PIXELS = 40_000_000;
export class InvalidGalleryImageError extends InvalidGalleryInputError { readonly imageCode = "INVALID_GALLERY_IMAGE"; }

export class SharpGalleryImageProcessor implements GalleryImageProcessorPort {
  async process(bytes: Uint8Array): Promise<ProcessedGalleryImage> {
    if (bytes.byteLength < 1 || bytes.byteLength > GALLERY_MAX_FILE_BYTES) throw new InvalidGalleryImageError();
    try {
      const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const metadata = await sharp(input, { animated: true, failOn: "warning", limitInputPixels: GALLERY_MAX_PIXELS }).metadata();
      if (!isFormat(metadata.format) || !metadata.width || !metadata.height || metadata.width > GALLERY_MAX_DIMENSION || metadata.height > GALLERY_MAX_DIMENSION || metadata.width * metadata.height > GALLERY_MAX_PIXELS || (metadata.pages ?? 1) !== 1) throw new InvalidGalleryImageError();
      const variants = await Promise.all([encode(input, "MASTER", null, 88), encode(input, "DISPLAY", 1600, 82), encode(input, "THUMB", 480, 78)]);
      return { sourceFormat: metadata.format, width: variants[0]!.width, height: variants[0]!.height, variants };
    } catch (error) {
      if (error instanceof InvalidGalleryImageError) throw error;
      throw new InvalidGalleryImageError();
    }
  }
}

async function encode(input: Buffer, kind: GalleryVariantKind, width: number | null, quality: number): Promise<GalleryProcessedVariant> {
  let pipeline = sharp(input, { animated: false, failOn: "warning", limitInputPixels: GALLERY_MAX_PIXELS }).rotate();
  if (width !== null) pipeline = pipeline.resize({ width, withoutEnlargement: true, fit: "inside" });
  const result = await pipeline.webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });
  if (!result.info.width || !result.info.height) throw new InvalidGalleryImageError();
  return { kind, bytes: new Uint8Array(result.data), width: result.info.width, height: result.info.height, mimeType: "image/webp" };
}

function isFormat(value: string | undefined): value is "jpeg" | "png" | "webp" { return value === "jpeg" || value === "png" || value === "webp"; }
