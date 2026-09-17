# Restauración recuperable de descartes de galería

_Estado técnico: IN_PROGRESS local; pendiente de revisión, PR y CI; sin prueba live_

## Requisito

Como OWNER autenticado quiero revisar y restaurar imágenes descartadas de mi estudio para recuperar trabajo privado sin recrear archivos ni alterar contenido publicado.

## Contrato observable

```gherkin
Given un OWNER autenticado con assets DISCARDED en su estudio
When abre /app/owner/gallery
Then ve una sección separada con como máximo 100 descartes en orden estable por fecha de descarte, creación y handle
And cada elemento muestra destino, artista cuando aplica, texto alternativo y fecha sin miniatura
And el HTML contiene únicamente el handle público opaco y metadata editorial segura
And no contiene IDs internos, paths, bucket, URL firmada, binding, service_role ni detalle del proveedor
```

```gherkin
Given un OWNER autenticado y un asset DISCARDED de su estudio identificado solo por su handle público opaco
When envía POST same-origin con exactamente intent=RESTORE y handle
Then Inkendar conserva target, artista, alt, variantes privadas y cualquier binding de publicación
And cambia DISCARDED a DRAFT bajo el lock común del estudio
And asigna la posición posterior al máximo existente del mismo grupo
And responde mediante PRG 303 a /app/owner/gallery
```

```gherkin
Given que la respuesta de una restauración se pierde después del commit
When el OWNER repite RESTORE sobre el mismo asset que ya está DRAFT
Then la operación converge con éxito sin volver a moverlo ni cambiar metadata
```

```gherkin
Given un ARTIST, anónimo, service_role, otro tenant, un handle desconocido o un asset PUBLISHING, PUBLISHED, RETIRING o RETIRED
When intenta listar descartes o restaurar
Then la operación falla cerrada con un mensaje genérico
And no modifica assets, variantes, bindings ni objetos Storage
```

```gherkin
Given una petición RESTORE
When no es POST same-origin, repite campos, incluye campos extra o contiene studioId, userId, assetId, status, path o binding
Then Inkendar la rechaza antes de ejecutar la mutación
And responde con el error privado 400 o 403 correspondiente
```

## Contrato técnico

- `RESTORE` acepta exclusivamente formulario URL-encoded con un `intent` y un `handle`; duplicados, extras y aliases se rechazan.
- `list_gallery_discarded_assets` y `restore_gallery_draft` son `SECURITY DEFINER`, usan `search_path=''`, se conceden solo a `authenticated` y resuelven tenant y rol OWNER mediante `auth.uid()`. `anon`, `service_role`, ARTIST, otro tenant y handles desconocidos fallan cerrados.
- El listado recibe el `studio_id` ya autorizado por el guard SSR, repite la autorización auth-bound en Postgres, limita `p_limit` a `1..100` y devuelve únicamente handle, destino, artista visible opcional, alt y `updated_at` como fecha del descarte. No resuelve miniaturas de `DISCARDED`.
- Restore resuelve primero handle y estudio, autoriza OWNER, toma `private.lock_gallery_studio(studio_id)` antes de cualquier row lock y después bloquea el asset. `DISCARDED` pasa a `DRAFT`; `DRAFT` converge sin cambios; cualquier otro estado falla.
- Al restaurar se conserva el grupo original y se calcula `max(position)+1` dentro del mismo estudio, target y artista, incluyendo todas las filas del grupo porque el constraint de posición también las incluye. No se reutiliza la posición histórica ni se toca ningún otro grupo o tenant.
- No se actualizan target, artista, alt, variantes, paths privados, timestamps de publicación ni `gallery_publication_binding`. No se compone `service_role`, no se llama Storage y no se crean ni eliminan objetos.
- La UI separa activos y descartados. Los descartados no muestran miniatura ni formularios de edición, movimiento, descarte, publicación o retirada; ofrecen únicamente `RESTORE`.
- Listados y respuestas conservan `private, no-store`, `no-referrer` y `nosniff`. Validación devuelve 400, origen/método 403, autenticación conserva su flujo y persistencia usa un 500 genérico.

## Concurrencia y evolución

Create, update/reassign, move, discard, publicación y restore comparten el advisory xact lock por estudio antes de row locks. La serialización gruesa mantiene la asignación final y las transiciones deterministas sin ciclos entre operaciones concurrentes.

El GC, hard delete, borrado de Storage y reconciliación después de una purga quedan bloqueados hasta definir retención, grace period y un contrato que impida restaurar contenido ya purgado. Este slice no añade estados, columnas ni efectos anticipatorios para GC.

## Fuera de alcance

Prueba live, edición o republicación de publicados/retirados, restauración de `RETIRED`, cambios del feed/API/componente público, invalidación CDN, GC, hard delete, borrado Storage y escritura ARTIST.
