import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { InvalidGalleryImageError, SharpGalleryImageProcessor } from "./sharp-gallery-images.js";

describe("SharpGalleryImageProcessor", () => {
  const processor = new SharpGalleryImageProcessor();

  it("decodes by bytes, strips metadata and generates non-upscaled WebP variants", async () => {
    const input = await sharp({ create: { width: 320, height: 180, channels: 3, background: "#d9a562" } }).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "private" } } }).toBuffer();
    const result = await processor.process(new Uint8Array(input));
    expect(result.sourceFormat).toBe("jpeg");
    expect(result.variants.map((variant) => [variant.kind, variant.width, variant.height])).toEqual([["MASTER", 180, 320], ["DISPLAY", 180, 320], ["THUMB", 180, 320]]);
    for (const variant of result.variants) {
      const metadata = await sharp(variant.bytes).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
    }
  });

  it.each([
    ["corrupt", new Uint8Array([1, 2, 3])],
    ["spoofed SVG", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
  ])("rejects %s bytes", async (_name, bytes) => expect(processor.process(bytes)).rejects.toBeInstanceOf(InvalidGalleryImageError));

  it("rejects animated and over-dimensional images", async () => {
    const animated = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).gif().toBuffer();
    await expect(processor.process(new Uint8Array(animated))).rejects.toBeInstanceOf(InvalidGalleryImageError);
    const headerOnlyPng = await sharp({ create: { width: 12001, height: 1, channels: 3, background: "black" } }).png().toBuffer();
    await expect(processor.process(new Uint8Array(headerOnlyPng))).rejects.toBeInstanceOf(InvalidGalleryImageError);
  });

  it("rejects files over 10 MiB before decoding", async () => {
    await expect(processor.process(new Uint8Array(10 * 1024 * 1024 + 1))).rejects.toBeInstanceOf(InvalidGalleryImageError);
  });
});
