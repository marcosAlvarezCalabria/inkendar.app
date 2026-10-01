import { useId, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import type { GalleryDiscardedRow, GalleryDraftView } from "@inkendar/application";
import { ownerGalleryHandlers } from "../owner-gallery.server.js";
import { cloudflareContext } from "../cloudflare-context.js";
import { EmptyState, Notice, StatusBadge, type Tone } from "../ui/feedback.js";
import { SubmitButton } from "../ui/forms.js";
import { OwnerShell } from "../ui/shells.js";
import type { Route } from "./+types/owner-gallery";

export type GalleryArtistOption = Readonly<{ id: string; displayName: string }>;
export type GalleryLifecycleStatus = "DRAFT" | "PUBLISHING" | "PUBLISHED" | "RETIRING";
export type OwnerGalleryItem = GalleryDraftView & Readonly<{ status: GalleryLifecycleStatus; thumbnailSrc: string }>;
export type OwnerGalleryData = Readonly<{
  artists: readonly GalleryArtistOption[];
  drafts: readonly OwnerGalleryItem[];
  discarded: readonly GalleryDiscardedRow[];
}>;

type ItemIntent = "UPDATE" | "MOVE_UP" | "MOVE_DOWN" | "DISCARD" | "PUBLISH" | "RETIRE" | "RESTORE";
export type OwnerGalleryPending =
  | Readonly<{ intent: "CREATE_DRAFT" }>
  | Readonly<{ intent: ItemIntent; handle: string }>;

type GalleryTarget = OwnerGalleryItem["target"];

export function meta(): Route.MetaDescriptors { return [{ title: "Galería privada | Inkendar" }]; }
export function headers() { return { "Cache-Control": "private, no-store", "Referrer-Policy": "same-origin", "X-Content-Type-Options": "nosniff" }; }
export async function loader({ request }: Route.LoaderArgs) { return ownerGalleryHandlers.loader(request); }
export async function action({ request, context }: Route.ActionArgs) { return ownerGalleryHandlers.action(request, context.get(cloudflareContext).env); }

export default function OwnerGallery() {
  const error = (useActionData() as { error?: string } | undefined)?.error;
  const navigation = useNavigation();
  return (
    <OwnerShell title="Galería privada" description="Prepara, publica y retira imágenes sin exponer los originales privados.">
      <OwnerGalleryView
        data={useLoaderData() as OwnerGalleryData}
        pending={galleryPendingSubmission(navigation.state, navigation.formData)}
        {...(error ? { error } : {})}
      />
    </OwnerShell>
  );
}

export function OwnerGalleryView({ data, error, pending = null }: Readonly<{
  data: OwnerGalleryData;
  error?: string;
  pending?: OwnerGalleryPending | null;
}>) {
  return (
    <>
      {error ? <Notice tone="danger" title="No se pudo completar el cambio">{error}</Notice> : null}
      <GalleryUpload artists={data.artists} pending={pending?.intent === "CREATE_DRAFT"} />

      <section className="records gallery-section" aria-labelledby="gallery-drafts-title">
        <div className="section-header">
          <div>
            <h2 id="gallery-drafts-title">Imágenes activas</h2>
            <p className="section-intro">Cada estado indica qué ocurrirá después. Solo los borradores pueden editarse, ordenarse o descartarse.</p>
          </div>
        </div>
        {data.drafts.length ? (
          <ul className="gallery-grid" aria-label="Imágenes activas de la galería">
            {data.drafts.map((draft) => (
              <GalleryItem key={draft.thumbnailHandle} draft={draft} artists={data.artists} pending={pending} />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Aún no hay imágenes activas"
            action={<a className="button" href="#gallery-upload">Subir la primera imagen</a>}
          >
            Añade una imagen sanitizada para preparar la galería general o el portfolio de un artista.
          </EmptyState>
        )}
      </section>

      <section className="records gallery-section" aria-labelledby="gallery-discarded-title">
        <div className="section-header">
          <div>
            <h2 id="gallery-discarded-title">Descartados recuperables</h2>
            <p className="section-intro">Descartar aparta un borrador privado y permite restaurarlo. Retirar quita de la web una imagen publicada; son acciones distintas.</p>
          </div>
        </div>
        {data.discarded.length ? (
          <ul className="gallery-discarded-list">
            {data.discarded.map((item) => <DiscardedGalleryItem key={item.handle} item={item} pending={pending} />)}
          </ul>
        ) : (
          <EmptyState title="No hay borradores descartados">
            Los borradores que descartes aparecerán aquí para que puedas restaurarlos.
          </EmptyState>
        )}
      </section>
    </>
  );
}

function GalleryUpload({ artists, pending }: Readonly<{ artists: readonly GalleryArtistOption[]; pending: boolean }>) {
  return (
    <section className="shell-panel gallery-upload" id="gallery-upload" aria-labelledby="gallery-upload-title">
      <h2 id="gallery-upload-title">Añadir borrador</h2>
      <p>JPEG, PNG o WebP. Máximo 10 MiB, 12000 × 12000 y 40 megapíxeles. Inkendar aplica la orientación, elimina metadata y conserva únicamente variantes WebP privadas y sanitizadas.</p>
      <Form method="post" encType="multipart/form-data" className="record-form">
        <input type="hidden" name="intent" value="CREATE_DRAFT" />
        <label>Imagen<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
        <label>Texto alternativo<input name="altText" minLength={1} maxLength={160} required /></label>
        <GalleryMetadataFields artists={artists} initialTarget="GALLERY" initialArtistId="" />
        <SubmitButton pending={pending} pendingLabel="Guardando borrador…">Guardar borrador privado</SubmitButton>
      </Form>
    </section>
  );
}

function GalleryMetadataFields({ artists, initialTarget, initialArtistId }: Readonly<{
  artists: readonly GalleryArtistOption[];
  initialTarget: GalleryTarget;
  initialArtistId: string;
}>) {
  const [target, setTarget] = useState<GalleryTarget>(initialTarget);
  const artistHintId = useId();
  const portfolio = target === "ARTIST_PORTFOLIO";
  return (
    <>
      <label>
        Destino
        <select name="target" value={target} onChange={(event) => setTarget(event.currentTarget.value as GalleryTarget)} required>
          <option value="GALLERY">Galería general</option>
          <option value="ARTIST_PORTFOLIO">Portfolio de artista</option>
        </select>
      </label>
      <label>
        Artista
        <select
          name="artistProfileId"
          defaultValue={initialArtistId}
          disabled={!portfolio}
          required={portfolio}
          aria-describedby={portfolio ? undefined : artistHintId}
        >
          <option value="">{portfolio ? "Selecciona un artista" : "No aplica a la galería general"}</option>
          {artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.displayName}</option>)}
        </select>
        {!portfolio ? <span className="field-hint" id={artistHintId}>El artista solo es obligatorio para un portfolio.</span> : null}
      </label>
    </>
  );
}

function DiscardedGalleryItem({ item, pending }: Readonly<{ item: GalleryDiscardedRow; pending: OwnerGalleryPending | null }>) {
  const destination = item.target === "GALLERY" ? "Galería general" : "Portfolio de artista";
  const restoring = isPending(pending, "RESTORE", item.handle);
  return (
    <li className="shell-panel gallery-discarded-item">
      <div className="record-head">
        <h3>{item.altText}</h3>
        <StatusBadge tone="neutral">Descartado</StatusBadge>
      </div>
      <dl className="gallery-meta">
        <div><dt>Destino</dt><dd>{destination}</dd></div>
        {item.target === "ARTIST_PORTFOLIO" ? <div><dt>Artista</dt><dd>{item.artistDisplayName ?? "Sin artista visible"}</dd></div> : null}
        <div><dt>Descartado</dt><dd><time dateTime={item.discardedAt}>{item.discardedAt.slice(0, 10)}</time></dd></div>
      </dl>
      <p>Este contenido sigue siendo privado. Restaurarlo lo devuelve a borrador; no vuelve a publicarlo.</p>
      <Form method="post" className="record-form">
        <input type="hidden" name="intent" value="RESTORE" />
        <input type="hidden" name="handle" value={item.handle} />
        <SubmitButton
          className="secondary"
          pending={restoring}
          pendingLabel="Restaurando borrador…"
          aria-label={restoring ? `Restaurando ${item.altText}` : `Restaurar ${item.altText}`}
        >
          Restaurar borrador
        </SubmitButton>
      </Form>
    </li>
  );
}

function GalleryItem({ draft, artists, pending }: Readonly<{
  draft: OwnerGalleryItem;
  artists: readonly GalleryArtistOption[];
  pending: OwnerGalleryPending | null;
}>) {
  const lifecycle = lifecyclePresentation(draft.status);
  const destination = draft.target === "GALLERY" ? "Galería general" : `Portfolio de ${draft.artistDisplayName ?? "artista"}`;
  return (
    <li className="shell-panel gallery-draft-card">
      <div className="gallery-thumbnail-frame">
        <img className="gallery-thumbnail" src={draft.thumbnailSrc} alt={draft.altText} width={draft.width} height={draft.height} />
      </div>
      <div className="gallery-card-head">
        <h3>{draft.altText}</h3>
        <StatusBadge tone={lifecycle.tone}>{lifecycle.badge}</StatusBadge>
      </div>
      <dl className="gallery-meta">
        <div><dt>Destino</dt><dd>{destination}</dd></div>
        <div><dt>Artista</dt><dd>{draft.target === "ARTIST_PORTFOLIO" ? draft.artistDisplayName ?? "Sin artista visible" : "No aplica"}</dd></div>
        <div><dt>Posición</dt><dd>{draft.position}</dd></div>
        <div><dt>Tamaño</dt><dd>{draft.width} × {draft.height}</dd></div>
      </dl>
      <div className="gallery-lifecycle-copy">
        <p className="gallery-state-title">{lifecycle.title}</p>
        <p>{lifecycle.nextStep}</p>
      </div>

      {draft.status === "DRAFT" ? (
        <DraftActions draft={draft} artists={artists} pending={pending} />
      ) : null}
      {draft.status === "DRAFT" || draft.status === "PUBLISHING" ? (
        <LifecycleForm
          intent="PUBLISH"
          handle={draft.thumbnailHandle}
          label={draft.status === "DRAFT" ? "Publicar" : "Reintentar publicación"}
          pendingLabel={draft.status === "DRAFT" ? "Publicando…" : "Reintentando publicación…"}
          altText={draft.altText}
          pending={isPending(pending, "PUBLISH", draft.thumbnailHandle)}
        />
      ) : null}
      {draft.status === "PUBLISHED" || draft.status === "RETIRING" ? (
        <LifecycleForm
          intent="RETIRE"
          handle={draft.thumbnailHandle}
          label={draft.status === "PUBLISHED" ? "Retirar" : "Reintentar retirada"}
          pendingLabel={draft.status === "PUBLISHED" ? "Retirando publicación…" : "Reintentando retirada…"}
          altText={draft.altText}
          pending={isPending(pending, "RETIRE", draft.thumbnailHandle)}
        />
      ) : null}
    </li>
  );
}

function DraftActions({ draft, artists, pending }: Readonly<{
  draft: OwnerGalleryItem;
  artists: readonly GalleryArtistOption[];
  pending: OwnerGalleryPending | null;
}>) {
  const updating = isPending(pending, "UPDATE", draft.thumbnailHandle);
  const movingUp = isPending(pending, "MOVE_UP", draft.thumbnailHandle);
  const movingDown = isPending(pending, "MOVE_DOWN", draft.thumbnailHandle);
  const discarding = isPending(pending, "DISCARD", draft.thumbnailHandle);
  return (
    <div className="gallery-draft-actions">
      <Form method="post" className="record-form" aria-label={`Editar ${draft.altText}`}>
        <input type="hidden" name="intent" value="UPDATE" />
        <input type="hidden" name="handle" value={draft.thumbnailHandle} />
        <label>Texto alternativo<input name="altText" defaultValue={draft.altText} minLength={1} maxLength={160} required /></label>
        <GalleryMetadataFields artists={artists} initialTarget={draft.target} initialArtistId={draft.artistProfileId ?? ""} />
        <SubmitButton
          pending={updating}
          pendingLabel="Guardando cambios…"
          aria-label={updating ? `Guardando cambios de ${draft.altText}` : `Guardar cambios de ${draft.altText}`}
        >
          Guardar cambios
        </SubmitButton>
      </Form>
      <div className="record-actions" role="group" aria-label={`Ordenar ${draft.altText}`}>
        <Form method="post">
          <input type="hidden" name="intent" value="MOVE_UP" />
          <input type="hidden" name="handle" value={draft.thumbnailHandle} />
          <SubmitButton
            className="secondary"
            pending={movingUp}
            pendingLabel="Moviendo arriba…"
            aria-label={movingUp ? `Moviendo arriba ${draft.altText}` : `Subir ${draft.altText}`}
          >
            Subir
          </SubmitButton>
        </Form>
        <Form method="post">
          <input type="hidden" name="intent" value="MOVE_DOWN" />
          <input type="hidden" name="handle" value={draft.thumbnailHandle} />
          <SubmitButton
            className="secondary"
            pending={movingDown}
            pendingLabel="Moviendo abajo…"
            aria-label={movingDown ? `Moviendo abajo ${draft.altText}` : `Bajar ${draft.altText}`}
          >
            Bajar
          </SubmitButton>
        </Form>
      </div>
      <Form method="post" className="record-form">
        <input type="hidden" name="intent" value="DISCARD" />
        <input type="hidden" name="handle" value={draft.thumbnailHandle} />
        <p>Descartar aparta este borrador privado sin borrar sus archivos. Podrás restaurarlo más adelante.</p>
        <SubmitButton
          className="secondary"
          pending={discarding}
          pendingLabel="Descartando…"
          aria-label={discarding ? `Descartando borrador ${draft.altText}` : `Descartar borrador ${draft.altText}`}
        >
          Descartar borrador
        </SubmitButton>
      </Form>
    </div>
  );
}

function LifecycleForm({ intent, handle, label, pendingLabel, altText, pending }: Readonly<{
  intent: "PUBLISH" | "RETIRE";
  handle: string;
  label: string;
  pendingLabel: string;
  altText: string;
  pending: boolean;
}>) {
  return (
    <Form method="post" className="record-form gallery-lifecycle-form">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="handle" value={handle} />
      <SubmitButton
        className={intent === "RETIRE" ? "secondary" : undefined}
        pending={pending}
        pendingLabel={pendingLabel}
        aria-label={pending ? `${pendingLabel.replace("…", "")} ${altText}` : `${label} ${altText}`}
      >
        {label}
      </SubmitButton>
    </Form>
  );
}

function lifecyclePresentation(status: GalleryLifecycleStatus): Readonly<{
  badge: string;
  tone: Tone;
  title: string;
  nextStep: string;
}> {
  if (status === "DRAFT") return {
    badge: "Borrador",
    tone: "neutral",
    title: "Privada y editable",
    nextStep: "Completa el texto alternativo, el destino y el orden. Después puedes publicarla o descartarla de forma recuperable.",
  };
  if (status === "PUBLISHING") return {
    badge: "Publicando",
    tone: "pending",
    title: "Publicación en curso",
    nextStep: "Cerrar esta pantalla no cancela el proceso. El reintento conserva la misma publicación y continúa de forma segura.",
  };
  if (status === "PUBLISHED") return {
    badge: "Publicada",
    tone: "success",
    title: "Visible en la integración pública",
    nextStep: "Retirar quita de la web esta imagen publicada y conserva su copia privada.",
  };
  return {
    badge: "Retirando",
    tone: "warning",
    title: "Retirada en curso",
    nextStep: "Cerrar esta pantalla no cancela el proceso. El reintento continúa la misma retirada de forma segura.",
  };
}

function isPending(pending: OwnerGalleryPending | null, intent: ItemIntent, handle: string): boolean {
  return pending?.intent === intent && "handle" in pending && pending.handle === handle;
}

export function galleryPendingSubmission(state: string, formData: FormData | undefined): OwnerGalleryPending | null {
  if (state !== "submitting" || !formData) return null;
  const intent = formData.get("intent");
  if (intent === "CREATE_DRAFT") return { intent };
  const handle = formData.get("handle");
  if (
    typeof handle === "string"
    && (intent === "UPDATE" || intent === "MOVE_UP" || intent === "MOVE_DOWN" || intent === "DISCARD" || intent === "PUBLISH" || intent === "RETIRE" || intent === "RESTORE")
  ) return { intent, handle };
  return null;
}
