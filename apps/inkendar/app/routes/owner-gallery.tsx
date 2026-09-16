import { Link, useActionData, useLoaderData } from "react-router";
import type { GalleryDraftView } from "@inkendar/application";
import type { Route } from "./+types/owner-gallery";
import { ownerGalleryHandlers } from "../owner-gallery.server.js";

export type GalleryArtistOption = Readonly<{ id: string; displayName: string }>;
export type GalleryLifecycleStatus = "DRAFT" | "PUBLISHING" | "PUBLISHED" | "RETIRING";
export type OwnerGalleryItem = GalleryDraftView & Readonly<{ status: GalleryLifecycleStatus; thumbnailSrc: string }>;
export type OwnerGalleryData = Readonly<{ artists: readonly GalleryArtistOption[]; drafts: readonly OwnerGalleryItem[] }>;
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
        <input type="hidden" name="intent" value="CREATE_DRAFT" />
        <label>Imagen<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
        <label>Texto alternativo<input name="altText" minLength={1} maxLength={160} required /></label>
        <label>Destino<select name="target" defaultValue="GALLERY" required><option value="GALLERY">Galería general</option><option value="ARTIST_PORTFOLIO">Portfolio de artista</option></select></label>
        <label>Artista<select name="artistProfileId" defaultValue=""><option value="">Sin artista</option>{data.artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.displayName}</option>)}</select></label>
        <button type="submit">Guardar borrador privado</button>
      </form>
    </section>
    <section className="records" aria-labelledby="gallery-drafts-title"><h2 id="gallery-drafts-title">Borradores privados</h2>{data.drafts.length ? <ul className="gallery-grid">{data.drafts.map((draft) => <GalleryItem key={draft.thumbnailHandle} draft={draft} artists={data.artists} />)}</ul> : <p>Todavía no hay contenido activo.</p>}</section>
  </main>;
}

function GalleryItem({ draft, artists }: Readonly<{ draft: OwnerGalleryItem; artists: readonly GalleryArtistOption[] }>) {
  return <li className="shell-panel gallery-draft-card">
    <img src={draft.thumbnailSrc} alt={draft.altText} width={draft.width} height={draft.height} />
    <h3>{draft.target === "GALLERY" ? "Galería general" : draft.artistDisplayName ?? "Portfolio"}</h3>
    <p>Estado: {statusLabel(draft.status)} · Posición {draft.position} · {draft.width} × {draft.height}</p>
    {draft.status === "DRAFT" ? <>
      <form method="post" className="record-form" aria-label={`Editar ${draft.altText}`}>
        <input type="hidden" name="intent" value="UPDATE" /><input type="hidden" name="handle" value={draft.thumbnailHandle} />
        <label>Texto alternativo<input name="altText" defaultValue={draft.altText} minLength={1} maxLength={160} required /></label>
        <label>Destino<select name="target" defaultValue={draft.target} required><option value="GALLERY">Galería general</option><option value="ARTIST_PORTFOLIO">Portfolio de artista</option></select></label>
        <label>Artista<select name="artistProfileId" defaultValue={draft.artistProfileId ?? ""}><option value="">Sin artista</option>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.displayName}</option>)}</select></label>
        <button type="submit">Guardar cambios</button>
      </form>
      <div className="record-actions" aria-label={`Ordenar ${draft.altText}`}>
        <form method="post"><input type="hidden" name="intent" value="MOVE_UP" /><input type="hidden" name="handle" value={draft.thumbnailHandle} /><button type="submit" className="secondary" aria-label={`Subir ${draft.altText}`}>Subir</button></form>
        <form method="post"><input type="hidden" name="intent" value="MOVE_DOWN" /><input type="hidden" name="handle" value={draft.thumbnailHandle} /><button type="submit" className="secondary" aria-label={`Bajar ${draft.altText}`}>Bajar</button></form>
      </div>
      <form method="post" className="record-form"><input type="hidden" name="intent" value="DISCARD" /><input type="hidden" name="handle" value={draft.thumbnailHandle} /><p>Oculta este borrador de la lista y de sus miniaturas. Podrás recuperarlo más adelante.</p><button type="submit" className="secondary" aria-label={`Descartar borrador ${draft.altText}`}>Descartar borrador</button></form>
    </> : null}
    {draft.status === "DRAFT" || draft.status === "PUBLISHING" ? <LifecycleForm intent="PUBLISH" handle={draft.thumbnailHandle} label={draft.status === "DRAFT" ? "Publicar" : "Reintentar publicación"} altText={draft.altText} /> : null}
    {draft.status === "PUBLISHED" || draft.status === "RETIRING" ? <LifecycleForm intent="RETIRE" handle={draft.thumbnailHandle} label={draft.status === "PUBLISHED" ? "Retirar" : "Reintentar retirada"} altText={draft.altText} /> : null}
  </li>;
}

function LifecycleForm({ intent, handle, label, altText }: Readonly<{ intent: "PUBLISH" | "RETIRE"; handle: string; label: string; altText: string }>) {
  return <form method="post" className="record-form"><input type="hidden" name="intent" value={intent} /><input type="hidden" name="handle" value={handle} /><button type="submit" className="secondary" aria-label={`${label} ${altText}`}>{label}</button></form>;
}
function statusLabel(status: GalleryLifecycleStatus): string { return ({ DRAFT: "Borrador", PUBLISHING: "Publicando", PUBLISHED: "Publicada", RETIRING: "Retirando" })[status]; }
