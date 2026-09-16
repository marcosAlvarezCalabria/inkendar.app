import { randomUUID } from "node:crypto";
import { GalleryIngestionFailedError, InvalidGalleryInputError, createGalleryService } from "@inkendar/application";
import { GALLERY_MAX_FILE_BYTES, SharpGalleryImageProcessor, createSupabaseGalleryRepository, createSupabasePrivateGalleryStorage, listSupabaseGalleryArtists } from "@inkendar/infrastructure";
import type { AuthorizedAccess } from "@inkendar/domain";
import { authHandlers, isTrustedMutationRequest, type AuthorizedRequestAccess } from "./auth.server.js";

type Service = ReturnType<typeof createGalleryService>;
type Dependencies = Readonly<{ authorize(request: Request): Promise<Response | AuthorizedRequestAccess>; createService(access: AuthorizedAccess, request: Request): Service; listArtists?(request: Request): Promise<readonly { id: string; displayName: string }[]> }>;
const defaults: Required<Dependencies> = { authorize: (request) => authHandlers.requireRole(request, "OWNER"), createService: (_access, request) => createGalleryService({ processor: new SharpGalleryImageProcessor(), repository: createSupabaseGalleryRepository(request, process.env), storage: createSupabasePrivateGalleryStorage(process.env), createId: randomUUID }), listArtists: (request) => listSupabaseGalleryArtists(request, process.env) };

export function createOwnerGalleryHandlers(dependencies: Dependencies = defaults) {
  return {
    async loader(request: Request): Promise<Response> {
      const authorization = await dependencies.authorize(request); if (authorization instanceof Response) return authorization;
      try { const [drafts, artists] = await Promise.all([dependencies.createService(authorization.access, request).list(authorization.access.studioId), (dependencies.listArtists ?? defaults.listArtists)(request)]); return Response.json({ drafts, artists }, { headers: privateHeaders(authorization.headers) }); }
      catch { return Response.json({ error: "No se pudo cargar la galería." }, { status: 500, headers: privateHeaders(authorization.headers) }); }
    },
    async action(request: Request): Promise<Response> {
      if (request.method !== "POST" || !isTrustedMutationRequest(request)) return new Response("Solicitud rechazada", { status: 403, headers: privateHeaders() });
      const contentType = request.headers.get("Content-Type") ?? ""; if (!contentType.toLowerCase().startsWith("multipart/form-data;")) return Response.json({ error: "Revisa los datos del formulario." }, { status: 400, headers: privateHeaders() });
      const declaredLength = Number(request.headers.get("Content-Length") ?? "0"); if (Number.isFinite(declaredLength) && declaredLength > GALLERY_MAX_FILE_BYTES + 64 * 1024) return Response.json({ error: "Revisa los datos del formulario." }, { status: 400, headers: privateHeaders() });
      const authorization = await dependencies.authorize(request); if (authorization instanceof Response) return authorization;
      const headers = privateHeaders(authorization.headers);
      try {
        const form = await request.formData(), file = form.get("image");
        if (!(file instanceof File) || file.size < 1 || file.size > GALLERY_MAX_FILE_BYTES) throw new InvalidGalleryInputError();
        const artist = optional(form, "artistProfileId");
        await dependencies.createService(authorization.access, request).ingest({ studioId: authorization.access.studioId, bytes: new Uint8Array(await file.arrayBuffer()), altText: required(form, "altText"), target: required(form, "target"), artistProfileId: artist?.trim() ? artist.trim() : null });
        headers.set("Location", "/app/owner/gallery"); return new Response(null, { status: 303, headers });
      } catch (error) {
        if (error instanceof InvalidGalleryInputError) return Response.json({ error: "Revisa la imagen y los datos del formulario." }, { status: 400, headers });
        if (error instanceof GalleryIngestionFailedError) return Response.json({ error: "No se pudo guardar la imagen." }, { status: 500, headers });
        return Response.json({ error: "No se pudo guardar la imagen." }, { status: 500, headers });
      }
    },
  };
}
export const ownerGalleryHandlers = createOwnerGalleryHandlers();
function required(form: FormData, name: string): string { const values = form.getAll(name); if (values.length !== 1 || typeof values[0] !== "string" || values[0].length > 4096) throw new InvalidGalleryInputError(); return values[0]; }
function optional(form: FormData, name: string): string | null { const values = form.getAll(name); if (values.length === 0) return null; if (values.length !== 1 || typeof values[0] !== "string" || values[0].length > 4096) throw new InvalidGalleryInputError(); return values[0]; }
function privateHeaders(source?: Headers): Headers { const result = new Headers(source); result.set("Cache-Control", "private, no-store"); result.set("Referrer-Policy", "no-referrer"); result.set("X-Content-Type-Options", "nosniff"); return result; }
