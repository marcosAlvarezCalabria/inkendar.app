import { describe, expect, it, vi } from "vitest";
import { CloudflareGalleryImageProcessor, InvalidGalleryImageError, type ImagesBinding } from "./cloudflare-gallery-images.js";

function bindingWith(options: Readonly<{ format?: string; width?: number; height?: number }> = {}): ImagesBinding {
  const info = vi.fn()
    .mockResolvedValueOnce({ format: options.format ?? "image/jpeg", width: options.width ?? 320, height: options.height ?? 180 })
    .mockResolvedValue({ format: "image/webp", width: Math.min(options.width ?? 320, 320), height: Math.min(options.height ?? 180, 180) });
  const input = vi.fn((bytes: ReadableStream<Uint8Array>) => {
    const transformer = (transform: Readonly<{ width?: number; fit?: "scale-down" }> = {}) => ({
      transform: vi.fn((next: Readonly<{ width?: number; fit?: "scale-down" }>) => transformer(next)),
      output: vi.fn(async () => ({
        response: vi.fn(() => {
          const width = Math.min(transform.width ?? (options.width ?? 320), options.width ?? 320);
          const height = Math.round((options.height ?? 180) * width / (options.width ?? 320));
          return new Response(bytes, { headers: { "Content-Type": "image/webp", "Cf-Image-Width": String(width), "Cf-Image-Height": String(height) } });
        }),
      })),
    });
    return transformer();
  });
  return { info, input };
}

describe("CloudflareGalleryImageProcessor", () => {
  it("preserves the gallery contract with sanitized non-upscaled WebP variants", async () => {
    const images = bindingWith();
    const result = await new CloudflareGalleryImageProcessor(images).process(new Uint8Array([1, 2, 3]));

    expect(result.sourceFormat).toBe("jpeg");
    expect(result.variants.map(({ kind, width, height, mimeType }) => ({ kind, width, height, mimeType }))).toEqual([
      { kind: "MASTER", width: 320, height: 180, mimeType: "image/webp" },
      { kind: "DISPLAY", width: 320, height: 180, mimeType: "image/webp" },
      { kind: "THUMB", width: 320, height: 180, mimeType: "image/webp" },
    ]);
    expect(images.info).toHaveBeenCalledTimes(4);
    expect(images.input).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["unsupported format", { format: "image/svg+xml" }],
    ["oversized dimension", { width: 12_001 }],
    ["too many pixels", { width: 10_000, height: 5_000 }],
  ])("rejects %s before transforming", async (_name, options) => {
    await expect(new CloudflareGalleryImageProcessor(bindingWith(options)).process(new Uint8Array([1]))).rejects.toBeInstanceOf(InvalidGalleryImageError);
  });

  it("rejects animated WebP before transforming", async () => {
    const animated = new Uint8Array([82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80, 65, 78, 73, 77, 0, 0, 0, 0]);
    const images = bindingWith({ format: "image/webp" });
    await expect(new CloudflareGalleryImageProcessor(images).process(animated)).rejects.toBeInstanceOf(InvalidGalleryImageError);
    expect(images.info).not.toHaveBeenCalled();
  });

  it("rejects animated PNG before transforming", async () => {
    const animated = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0]);
    const images = bindingWith({ format: "image/png" });
    await expect(new CloudflareGalleryImageProcessor(images).process(animated)).rejects.toBeInstanceOf(InvalidGalleryImageError);
    expect(images.info).not.toHaveBeenCalled();
  });

  it("rejects files over 10 MiB before inspecting them", async () => {
    const images = bindingWith();
    await expect(new CloudflareGalleryImageProcessor(images).process(new Uint8Array(10 * 1024 * 1024 + 1))).rejects.toBeInstanceOf(InvalidGalleryImageError);
    expect(images.info).not.toHaveBeenCalled();
  });
});
