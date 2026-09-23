import type { GalleryImageProcessorPort, GalleryProcessedVariant, GalleryVariantKind, ProcessedGalleryImage } from "@inkendar/application";
import { InvalidGalleryInputError } from "@inkendar/domain";

export const GALLERY_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const GALLERY_MAX_DIMENSION = 12_000;
export const GALLERY_MAX_PIXELS = 40_000_000;

type ImageInfo = Readonly<{ format: string; width?: number; height?: number }>;
type ImageTransformationResult = Readonly<{ response(): Response }>;
type ImageTransformer = Readonly<{
  transform(options: Readonly<{ width?: number; fit?: "scale-down" }>): ImageTransformer;
  output(options: Readonly<{ format: "image/webp"; quality: number; anim: false }>): Promise<ImageTransformationResult>;
}>;
export type ImagesBinding = Readonly<{
  info(stream: ReadableStream<Uint8Array>): Promise<ImageInfo>;
  input(stream: ReadableStream<Uint8Array>): ImageTransformer;
}>;

export class InvalidGalleryImageError extends InvalidGalleryInputError { readonly imageCode = "INVALID_GALLERY_IMAGE"; }

export class CloudflareGalleryImageProcessor implements GalleryImageProcessorPort {
  constructor(private readonly images: ImagesBinding) {}

  async process(bytes: Uint8Array): Promise<ProcessedGalleryImage> {
    if (bytes.byteLength < 1 || bytes.byteLength > GALLERY_MAX_FILE_BYTES || isAnimated(bytes)) throw new InvalidGalleryImageError();
    try {
      const metadata = await this.images.info(stream(bytes));
      const sourceFormat = sourceFormatOf(metadata.format);
      const width = metadata.width;
      const height = metadata.height;
      if (!sourceFormat || !width || !height || width > GALLERY_MAX_DIMENSION || height > GALLERY_MAX_DIMENSION || width * height > GALLERY_MAX_PIXELS) throw new InvalidGalleryImageError();
      const variants = await Promise.all([
        this.encode(bytes, "MASTER", undefined, 88),
        this.encode(bytes, "DISPLAY", 1600, 82),
        this.encode(bytes, "THUMB", 480, 78),
      ]);
      return { sourceFormat, width: variants[0]!.width, height: variants[0]!.height, variants };
    } catch (error) {
      if (error instanceof InvalidGalleryImageError) throw error;
      throw new InvalidGalleryImageError();
    }
  }

  private async encode(bytes: Uint8Array, kind: GalleryVariantKind, width: number | undefined, quality: number): Promise<GalleryProcessedVariant> {
    let transformer = this.images.input(stream(bytes));
    transformer = transformer.transform(width === undefined ? { fit: "scale-down" } : { width, fit: "scale-down" });
    const result = await transformer.output({ format: "image/webp", quality, anim: false });
    const response = result.response();
    if (!response.ok || response.headers.get("Content-Type") !== "image/webp") throw new InvalidGalleryImageError();
    const output = new Uint8Array(await response.arrayBuffer());
    const metadata = await this.images.info(stream(output));
    if (metadata.format !== "image/webp" || !metadata.width || !metadata.height) throw new InvalidGalleryImageError();
    return { kind, bytes: output, width: metadata.width, height: metadata.height, mimeType: "image/webp" };
  }
}

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const copy = Uint8Array.from(bytes);
  return new ReadableStream({ start(controller) { controller.enqueue(copy); controller.close(); } });
}

function sourceFormatOf(format: string): "jpeg" | "png" | "webp" | null {
  if (format === "image/jpeg") return "jpeg";
  if (format === "image/png") return "png";
  if (format === "image/webp") return "webp";
  return null;
}

function isAnimated(bytes: Uint8Array): boolean {
  return hasPngAnimationChunk(bytes) || hasWebpAnimationChunk(bytes);
}

function hasPngAnimationChunk(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12 || ascii(bytes, 1, 3) !== "PNG") return false;
  for (let offset = 8; offset + 12 <= bytes.byteLength;) {
    const length = uint32be(bytes, offset);
    if (length === null || length > bytes.byteLength - offset - 12) return false;
    if (ascii(bytes, offset + 4, 4) === "acTL") return true;
    offset += 12 + length;
  }
  return false;
}

function hasWebpAnimationChunk(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return false;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const length = uint32le(bytes, offset + 4);
    if (length === null || length > bytes.byteLength - offset - 8) return false;
    if (ascii(bytes, offset, 4) === "ANIM") return true;
    offset += 8 + length + (length % 2);
  }
  return false;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
function uint32be(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.byteLength) return null;
  return ((bytes[offset]! * 0x1000000) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!) >>> 0;
}
function uint32le(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.byteLength) return null;
  return (bytes[offset]! + (bytes[offset + 1]! << 8) + (bytes[offset + 2]! << 16) + (bytes[offset + 3]! * 0x1000000)) >>> 0;
}
