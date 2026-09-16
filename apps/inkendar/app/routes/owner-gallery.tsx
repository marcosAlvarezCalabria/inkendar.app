import { Link, useActionData, useLoaderData } from "react-router";
import type { GalleryDraftView } from "@inkendar/application";
import type { Route } from "./+types/owner-gallery";
import { ownerGalleryHandlers } from "../owner-gallery.server.js";

export type GalleryArtistOption = Readonly<{ id: string; displayName: string }>;
export type OwnerGalleryData = Readonly<{ artists: readonly GalleryArtistOption[]; drafts: readonly (GalleryDraftView & Readonly<{ thumbnailSrc: string }>)[] }>;
export function meta(): Route.MetaDescriptors { return [{ title: "Galería privada | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }; }
export async function loader({ request }: Route.LoaderArgs) { return ownerGalleryHandlers.loader(request); }
export async function action({ request }: Route.ActionArgs) { return ownerGalleryHandlers.action(request); }

export default function OwnerGallery() { const error = (useActionData() as { error?: string } | undefined)?.error; return <OwnerGalleryView data={useLoaderData() as OwnerGalleryData} {...(error ? { error } : {})} />; }

export function OwnerGalleryView({ data, error }: Readonly<{ data: OwnerGalleryData; error?: string }>) {
  return <main className="shell-page">
    <header className="section-header"><div><p className="eyebrow">Inkendar · Owner</p><h1>Galería privada</h1></div><Link to="/app/owner">Volver al panel</Link></header>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <section className="shell-panel" aria-labelledby="gallery-upload-title"><h2 id="gallery-upload-title">Añadir borrador</h2><p>JPEG, PNG o WebP. Máximo 10 MiB, 12000 × 12000 y 40 megapíxeles. Inkendar elimina metadata y conserva únicamente variantes privadas sanitizadas.</p>
      <form method="post" encType="multipart/form-data" className="record-form">
        <label>Imagen<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
        <label>Texto alternativo<input name="altText" minLength={1} maxLength={160} required /></label>
        <label>Destino<select name="target" defaultValue="GALLERY" required><option value="GALLERY">Galería general</option><option value="ARTIST_PORTFOLIO">Portfolio de artista</option></select></label>
        <label>Artista<select name="artistProfileId" defaultValue=""><option value="">Sin artista</option>{data.artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.displayName}</option>)}</select></label>
        <button type="submit">Guardar borrador privado</button>
      </form>
    </section>
    <section className="records" aria-labelledby="gallery-drafts-title"><h2 id="gallery-drafts-title">Borradores privados</h2>{data.drafts.length ? <ul className="gallery-grid">{data.drafts.map((draft) => <li className="shell-panel" key={draft.thumbnailHandle}><img src={draft.thumbnailSrc} alt={draft.altText} width={draft.width} height={draft.height} /><h3>{draft.target === "GALLERY" ? "Galería general" : draft.artistDisplayName ?? "Portfolio"}</h3><p>Posición {draft.position} · {draft.width} × {draft.height}</p></li>)}</ul> : <p>Todavía no hay borradores.</p>}</section>
  </main>;
}
