# Publicación y retirada recuperable de galería

_Estado técnico: IN_PROGRESS local_

## Requisito

Como OWNER autenticado quiero publicar las variantes sanitizadas de una pieza y retirarlas de forma durable para mostrar solo contenido listo sin exponer masters, rutas privadas ni identidad interna.

## Contrato observable

```gherkin
Given un OWNER autenticado y un asset DRAFT de su estudio identificado en el navegador solo por su handle opaco
When envía POST same-origin con la intención exacta PUBLISH
Then Inkendar fija una única publication key aleatoria separada del handle y de todos los IDs internos
And cambia DRAFT a PUBLISHING bajo el lock común del estudio antes de tocar Storage
And copia únicamente DISPLAY y THUMB WebP sanitizados a gallery-public
And finaliza atómicamente como PUBLISHED con published_at
And responde mediante PRG 303 sin exponer key, paths, URLs ni detalle del proveedor
```

```gherkin
Given una publicación PUBLISHING cuyo upload o finalize falló, fue ambiguo o perdió la respuesta
When el OWNER repite PUBLISH con el mismo handle
Then Inkendar reutiliza exactamente el binding y los dos paths públicos existentes
And sobrescribe idempotentemente DISPLAY y THUMB con upsert
And nunca genera otra publication key ni publica MASTER
And si el asset ya es PUBLISHED converge con éxito sin tocar Storage
```

```gherkin
Given un OWNER autenticado y un asset PUBLISHED de su estudio
When envía POST same-origin con la intención exacta RETIRE
Then Inkendar cambia primero a RETIRING bajo el lock común del estudio y deja de ser elegible para cualquier feed futuro
And elimina idempotentemente los objetos públicos DISPLAY y THUMB
And finaliza atómicamente como RETIRED con retired_at sin borrar objetos privados
And un fallo o resultado ambiguo conserva RETIRING para reintento con el mismo binding
And si ya es RETIRED converge con éxito sin tocar Storage
```

```gherkin
Given un ARTIST, anónimo, service_role, otro tenant, un handle desconocido o una transición no permitida
When intenta publicar, retirar o finalizar
Then la operación falla cerrada sin cambiar estado, binding ni objetos
And el error público es genérico y no contiene proveedor, key, path o URL
```

```gherkin
Given el listado OWNER de galería privada
When contiene assets DRAFT, PUBLISHING, PUBLISHED, RETIRING, RETIRED o DISCARDED
Then muestra solo DRAFT, PUBLISHING, PUBLISHED y RETIRING con estado textual
And el proxy privado de THUMB continúa autorizado para esos cuatro estados
And solo DRAFT puede editarse, reordenarse o descartarse
And ofrece publicar/reintentar publicación o retirar/reintentar retirada según el estado
```

## Contrato técnico

- Estados forward-only: `DRAFT -> PUBLISHING -> PUBLISHED -> RETIRING -> RETIRED`; `DISCARDED` permanece terminal. No existe vuelta a `DRAFT`, republicación de `RETIRED`, restore ni hard delete en este slice.
- El formulario acepta únicamente `intent` y `handle` para `PUBLISH` y `RETIRE`. No acepta estudio, usuario, asset interno, status, key, path ni URL.
- Los RPC `begin_gallery_publish`, `finalize_gallery_publish`, `begin_gallery_retire` y `finalize_gallery_retire` son `SECURITY DEFINER`, `search_path=''`, concedidos solo a `authenticated`, ligados a `auth.uid()` y OWNER del tenant. Todos toman `private.lock_gallery_studio(studio_id)` antes de row locks.
- `begin_gallery_publish` fija una sola binding inmutable antes de Storage. Solo el backend recibe publication key, paths privados y metadata persistida de DISPLAY/THUMB, junto con `<publication-key>/display.webp` y `<publication-key>/thumb.webp`. `PUBLISHED` devuelve una convergencia sin trabajo Storage.
- El downloader service-role acepta solo DISPLAY/THUMB privados, `image/webp`, tamaño exacto persistido entre 1 y 10 MiB, timeout 3 s, origen/prefijo configurado y cero redirects. MASTER nunca se descarga ni se copia.
- `gallery-public` es un bucket separado, público para lectura y sin políticas de escritura para cliente. El backend sube `image/webp` con `upsert:true` y `cacheControl:"300"` únicamente en `PUBLISHING`; valida toda respuesta y no persiste bytes ni URLs.
- `finalize_gallery_publish` exige estado/binding exactos y fija `PUBLISHED/published_at` en una transacción. Cualquier fallo o ambigüedad deja `PUBLISHING`; el retry sobrescribe los mismos paths. Puede existir temporalmente un objeto de nombre aleatorio sin indexar durante `PUBLISHING`; Inkendar no lo declara publicado antes de `PUBLISHED` y no promete invalidación CDN.
- `begin_gallery_retire` cambia `PUBLISHED` a `RETIRING` antes de Storage y reutiliza el binding en retries. El backend elimina ambos paths de modo idempotente; `finalize_gallery_retire` fija `RETIRED/retired_at`. Nunca elimina las variantes privadas.
- La composición de publicación y retirada está separada de ingestión/curación. El cliente service-role de Storage se instancia de forma lazy solo después de POST confiable, auth OWNER y un begin que devuelve trabajo. Lecturas y curación no requieren la key de servicio.
- Listado y proxy privado incluyen exactamente `DRAFT`, `PUBLISHING`, `PUBLISHED` y `RETIRING`; `RETIRED` y `DISCARDED` quedan ocultos. Todos los éxitos usan PRG 303 y todos los errores externos son genéricos.

## Fuera de alcance

Feed o endpoint público, web component, URLs públicas en HTML, invalidación CDN, master público, escritura ARTIST, restore, GC, edición/reorder de publicados, republicación de retirados y pruebas contra datos live.
