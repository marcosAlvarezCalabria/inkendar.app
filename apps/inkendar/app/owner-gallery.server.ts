import { randomUUID } from "node:crypto";
import { GalleryIngestionFailedError, GalleryMutationFailedError, GalleryPublicationFailedError, InvalidGalleryInputError, createGalleryCurationService, createGalleryPublicationService, createGalleryService } from "@inkendar/application";
import { GALLERY_MAX_FILE_BYTES, SharpGalleryImageProcessor, createSupabaseGalleryPublicationRepository, createSupabaseGalleryPublicationStorage, createSupabaseGalleryRepository, createSupabasePrivateGalleryStorage, listSupabaseGalleryArtists } from "@inkendar/infrastructure";
import type { AuthorizedAccess } from "@inkendar/domain";
import { authHandlers, isTrustedMutationRequest, type AuthorizedRequestAccess } from "./auth.server.js";

type Service = ReturnType<typeof createGalleryService>;
type CurationService = ReturnType<typeof createGalleryCurationService>;
type PublicationService = ReturnType<typeof createGalleryPublicationService>;
type Dependencies = Readonly<{
  authorize(request: Request): Promise<Response | AuthorizedRequestAccess>;
  createService(access: AuthorizedAccess, request: Request): Service;
  createCurationService?(access: AuthorizedAccess, request: Request): CurationService;
  createPublicationService?(access: AuthorizedAccess, request: Request): PublicationService;
  listArtists?(request: Request): Promise<readonly { id: string; displayName: string }[]>;
}>;
const defaults: Required<Dependencies> = {
  authorize: (request) => authHandlers.requireRole(request, "OWNER"),
  createService: (_access, request) => createGalleryService({ processor: new SharpGalleryImageProcessor(), repository: createSupabaseGalleryRepository(request, process.env), storage: createSupabasePrivateGalleryStorage(process.env), createId: randomUUID }),
  createCurationService: (_access, request) => createGalleryCurationService(createSupabaseGalleryRepository(request, process.env)),
  createPublicationService: (_access, request) => createGalleryPublicationService(createSupabaseGalleryPublicationRepository(request, process.env), () => createSupabaseGalleryPublicationStorage(process.env)),
  listArtists: (request) => listSupabaseGalleryArtists(request, process.env),
};

export function createOwnerGalleryHandlers(dependencies: Dependencies = defaults) {
  return {
    async loader(request: Request): Promise<Response> {
      const authorization = await dependencies.authorize(request); if (authorization instanceof Response) return authorization;
      try {
        const service = curation(dependencies, authorization.access, request);
        const [drafts, discarded, artists] = await Promise.all([
          service.list(authorization.access.studioId),
          service.listDiscarded(authorization.access.studioId),
          (dependencies.listArtists ?? defaults.listArtists)(request),
        ]);
        return Response.json({ drafts: drafts.map((draft) => ({ ...draft, thumbnailSrc: `/app/owner/gallery/thumbnails/${encodeURIComponent(draft.thumbnailHandle)}` })), discarded, artists }, { headers: privateHeaders(authorization.headers) });
      }
      catch { return Response.json({ error: "No se pudo cargar la galería." }, { status: 500, headers: privateHeaders(authorization.headers) }); }
    },
    async action(request: Request): Promise<Response> {
      if (request.method !== "POST" || !isTrustedMutationRequest(request)) return new Response("Solicitud rechazada", { status: 403, headers: privateHeaders() });
      const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
      const multipart = contentType.startsWith("multipart/form-data;");
      const urlEncoded = contentType.startsWith("application/x-www-form-urlencoded");
      if (!multipart && !urlEncoded) return invalidResponse();
      const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
      const maximumLength = multipart ? GALLERY_MAX_FILE_BYTES + 64 * 1024 : 64 * 1024;
      if (Number.isFinite(declaredLength) && declaredLength > maximumLength) return invalidResponse();
      const authorization = await dependencies.authorize(request); if (authorization instanceof Response) return authorization;
      const headers = privateHeaders(authorization.headers);
      try {
        const form = await request.formData(), intent = required(form, "intent");
        if (intent === "CREATE_DRAFT") {
          if (!multipart) throw new InvalidGalleryInputError();
          exactFields(form, ["intent", "image", "altText", "target", "artistProfileId"]);
          const file = singleFile(form, "image"), artist = optional(form, "artistProfileId");
          if (file.size < 1 || file.size > GALLERY_MAX_FILE_BYTES) throw new InvalidGalleryInputError();
          await dependencies.createService(authorization.access, request).ingest({ studioId: authorization.access.studioId, bytes: new Uint8Array(await file.arrayBuffer()), altText: required(form, "altText"), target: required(form, "target"), artistProfileId: artist?.trim() ? artist.trim() : null });
        } else if (intent === "UPDATE") {
          if (!urlEncoded) throw new InvalidGalleryInputError();
          exactFields(form, ["intent", "handle", "altText", "target", "artistProfileId"]);
          const artist = optional(form, "artistProfileId");
          await curation(dependencies, authorization.access, request).update({ handle: required(form, "handle"), altText: required(form, "altText"), target: required(form, "target"), artistProfileId: artist?.trim() ? artist.trim() : null });
        } else if (intent === "MOVE_UP" || intent === "MOVE_DOWN") {
          if (!urlEncoded) throw new InvalidGalleryInputError();
          exactFields(form, ["intent", "handle"]);
          await curation(dependencies, authorization.access, request).move(required(form, "handle"), intent);
        } else if (intent === "DISCARD") {
          if (!urlEncoded) throw new InvalidGalleryInputError();
          exactFields(form, ["intent", "handle"]);
          await curation(dependencies, authorization.access, request).discard(required(form, "handle"));
        } else if (intent === "RESTORE") {
          if (!urlEncoded) throw new InvalidGalleryInputError();
          exactFields(form, ["intent", "handle"]);
          await curation(dependencies, authorization.access, request).restore(required(form, "handle"));
        } else if (intent === "PUBLISH" || intent === "RETIRE") {
          if (!urlEncoded) throw new InvalidGalleryInputError();
          exactFields(form, ["intent", "handle"]);
          const service = publication(dependencies, authorization.access, request);
          if (intent === "PUBLISH") await service.publish(required(form, "handle"));
          else await service.retire(required(form, "handle"));
        } else throw new InvalidGalleryInputError();
        return redirect(headers);
      } catch (error) {
        if (error instanceof InvalidGalleryInputError) return Response.json({ error: "Revisa los datos del formulario." }, { status: 400, headers });
        if (error instanceof GalleryIngestionFailedError) return Response.json({ error: "No se pudo guardar la imagen." }, { status: 500, headers });
        if (error instanceof GalleryMutationFailedError) return Response.json({ error: "No se pudo actualizar el borrador." }, { status: 500, headers });
        if (error instanceof GalleryPublicationFailedError) return Response.json({ error: "No se pudo cambiar la publicación." }, { status: 500, headers });
        return Response.json({ error: "No se pudo guardar la imagen." }, { status: 500, headers });
      }
    },
  };
}
export const ownerGalleryHandlers = createOwnerGalleryHandlers();
function curation(dependencies: Dependencies, access: AuthorizedAccess, request: Request): CurationService { return (dependencies.createCurationService ?? dependencies.createService)(access, request); }
function publication(dependencies: Dependencies, access: AuthorizedAccess, request: Request): PublicationService { return (dependencies.createPublicationService ?? defaults.createPublicationService)(access, request); }
function required(form: FormData, name: string): string { const values = form.getAll(name); if (values.length !== 1 || typeof values[0] !== "string" || values[0].length > 4096) throw new InvalidGalleryInputError(); return values[0]; }
function optional(form: FormData, name: string): string | null { const values = form.getAll(name); if (values.length === 0) return null; if (values.length !== 1 || typeof values[0] !== "string" || values[0].length > 4096) throw new InvalidGalleryInputError(); return values[0]; }
function singleFile(form: FormData, name: string): File { const values = form.getAll(name); if (values.length !== 1 || !(values[0] instanceof File)) throw new InvalidGalleryInputError(); return values[0]; }
function exactFields(form: FormData, allowed: readonly string[]): void { const names = new Set(allowed); for (const name of form.keys()) if (!names.has(name)) throw new InvalidGalleryInputError(); }
function redirect(headers: Headers): Response { headers.set("Location", "/app/owner/gallery"); return new Response(null, { status: 303, headers }); }
function invalidResponse(): Response { return Response.json({ error: "Revisa los datos del formulario." }, { status: 400, headers: privateHeaders() }); }
function privateHeaders(source?: Headers): Headers { const result = new Headers(source); result.set("Cache-Control", "private, no-store"); result.set("Referrer-Policy", "no-referrer"); result.set("X-Content-Type-Options", "nosniff"); return result; }
