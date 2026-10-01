/** Presentation-only gallery fixtures for development and tests. */
import type { OwnerGalleryData, OwnerGalleryPending } from "../../routes/owner-gallery.js";
import type { FixtureScenario } from "./ui-foundation.fixtures.js";

const syntheticThumbnail = (label: string, width: number, height: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#e6e3da"/><path d="M0 ${height * 0.72} L${width * 0.35} ${height * 0.36} L${width * 0.58} ${height * 0.6} L${width} ${height * 0.22} V${height} H0Z" fill="#ffb27a"/><text x="24" y="44" fill="#0b0b0f" font-family="system-ui" font-size="24">${label}</text></svg>`)}`;

export const populatedOwnerGallery = {
  artists: [
    { id: "50000000-0000-4000-8000-000000000001", displayName: "Luz Artista" },
    { id: "50000000-0000-4000-8000-000000000002", displayName: "Rai Artista" },
  ],
  drafts: [
    {
      thumbnailHandle: "90000000-0000-4000-8000-000000000001",
      thumbnailSrc: syntheticThumbnail("Vertical sintética", 480, 720),
      status: "DRAFT", target: "ARTIST_PORTFOLIO", artistProfileId: "50000000-0000-4000-8000-000000000001", artistDisplayName: "Luz Artista",
      altText: "Boceto vertical de una peonía con hojas largas sobre fondo claro", position: 1, width: 480, height: 720,
    },
    {
      thumbnailHandle: "90000000-0000-4000-8000-000000000002",
      thumbnailSrc: syntheticThumbnail("Horizontal sintética", 720, 480),
      status: "PUBLISHING", target: "GALLERY", artistProfileId: null, artistDisplayName: null,
      altText: "Composición horizontal de olas y luna", position: 2, width: 720, height: 480,
    },
    {
      thumbnailHandle: "90000000-0000-4000-8000-000000000003",
      thumbnailSrc: syntheticThumbnail("Publicada sintética", 640, 640),
      status: "PUBLISHED", target: "ARTIST_PORTFOLIO", artistProfileId: "50000000-0000-4000-8000-000000000002", artistDisplayName: "Rai Artista",
      altText: "Retrato botánico publicado", position: 3, width: 640, height: 640,
    },
    {
      thumbnailHandle: "90000000-0000-4000-8000-000000000004",
      thumbnailSrc: syntheticThumbnail("Retirada sintética", 680, 460),
      status: "RETIRING", target: "GALLERY", artistProfileId: null, artistDisplayName: null,
      altText: "Ornamento geométrico en retirada", position: 4, width: 680, height: 460,
    },
  ],
  discarded: [{
    handle: "90000000-0000-4000-8000-000000000099", target: "GALLERY", artistDisplayName: null,
    altText: "Pieza descartada recuperable", discardedAt: "2026-09-17T10:00:00.000Z",
  }],
} satisfies OwnerGalleryData;

export const emptyOwnerGallery = { artists: populatedOwnerGallery.artists, drafts: [], discarded: [] } satisfies OwnerGalleryData;

export type OwnerGalleryFixtureView = Readonly<{
  data: OwnerGalleryData;
  error?: string;
  pending?: OwnerGalleryPending;
}>;

export const ownerGalleryFixtureScenarios = [
  { id: "owner-gallery-mobile", description: "Galería OWNER operable a 320 px", viewport: "compact", view: { data: populatedOwnerGallery, pending: { intent: "UPDATE", handle: "90000000-0000-4000-8000-000000000001" } } },
  { id: "owner-gallery-all-states", description: "Galería OWNER con todo el ciclo visible", viewport: "desktop", view: { data: populatedOwnerGallery } },
  { id: "owner-gallery-empty", description: "Galería OWNER preparada para la primera imagen", viewport: "tablet", view: { data: emptyOwnerGallery } },
  { id: "owner-gallery-error", description: "Galería OWNER con fallo recuperable", viewport: "mobile", view: { data: populatedOwnerGallery, error: "No se pudo guardar la imagen. Revisa los datos y vuelve a intentarlo." }, transportState: "error" },
] satisfies readonly FixtureScenario<OwnerGalleryFixtureView>[];
