import { createSupabaseGalleryRepository, createSupabaseGalleryThumbnailReader } from "@inkendar/infrastructure";
import { authHandlers, type AuthorizedRequestAccess } from "./auth.server.js";

type Dependencies = Readonly<{
  authorize(request: Request): Promise<Response | AuthorizedRequestAccess>;
  resolve(request: Request, handle: string): Promise<{ path: string; byteSize: number }>;
  read(path: string, byteSize: number): Promise<{ bytes: Uint8Array; contentType: "image/webp" }>;
}>;

const defaults: Dependencies = {
  authorize: (request) => authHandlers.requireRole(request, "OWNER"),
  resolve: (request, handle) => createSupabaseGalleryRepository(request, process.env).resolveThumbnail(handle),
  read: (path, byteSize) => createSupabaseGalleryThumbnailReader(process.env).read(path, byteSize),
};

export function createOwnerGalleryThumbnailHandler(dependencies: Dependencies = defaults) {
  return async (request: Request, handle: string): Promise<Response> => {
    const authorization = await dependencies.authorize(request);
    if (authorization instanceof Response) return authorization;
    const headers = privateImageHeaders(authorization.headers);
    if (!UUID.test(handle) || !trustedRead(request)) return new Response("Miniatura no disponible", { status: 404, headers });
    try {
      const resolved = await dependencies.resolve(request, handle);
      const image = await dependencies.read(resolved.path, resolved.byteSize);
      headers.set("Content-Type", image.contentType);
      headers.set("Content-Length", image.bytes.byteLength.toString());
      return new Response(Uint8Array.from(image.bytes).buffer, { headers });
    } catch { return new Response("Miniatura no disponible", { status: 404, headers }); }
  };
}

export const ownerGalleryThumbnailHandler = createOwnerGalleryThumbnailHandler();
function trustedRead(request: Request): boolean { const site = request.headers.get("Sec-Fetch-Site"); return site === null || site === "same-origin" || site === "none"; }
function privateImageHeaders(source?: Headers): Headers { const headers = new Headers(source); headers.set("Cache-Control", "private, no-store"); headers.set("X-Content-Type-Options", "nosniff"); headers.set("Referrer-Policy", "no-referrer"); return headers; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
