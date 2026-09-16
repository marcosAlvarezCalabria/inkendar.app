# Curación privada de borradores de galería

_Estado técnico: IN_PROGRESS local_

## Requisito

Como OWNER autenticado quiero corregir, reasignar, ordenar y descartar de forma recuperable los borradores de galería de mi estudio para preparar el contenido antes de publicarlo sin exponerlo.

## Contrato observable

```gherkin
Given un OWNER autenticado y un asset DRAFT de su estudio identificado en el navegador solo por su handle público opaco
When edita el texto alternativo y el destino mediante una petición POST same-origin
Then Inkendar normaliza el texto alternativo a 1..160 caracteres
And permite GALLERY sin artista o ARTIST_PORTFOLIO con un artista del mismo estudio
And si cambia de grupo asigna el asset al final del nuevo grupo bajo locks de ambos grupos
And responde con PRG 303 sin exponer IDs internos, paths, URLs firmadas ni datos del proveedor
```

```gherkin
Given un OWNER autenticado y varios DRAFT del mismo grupo
When solicita MOVE_UP o MOVE_DOWN con el handle opaco de uno de ellos
Then Inkendar intercambia atómicamente su posición con el DRAFT vecino inmediato bajo un lock del grupo
And una petición en el borde termina con éxito sin modificar filas
And no cambia el orden de otros grupos, artistas, estudios o estados
```

```gherkin
Given un OWNER autenticado y un asset DRAFT de su estudio
When solicita DISCARD_DRAFT
Then Inkendar cambia su estado a DISCARDED sin borrar la fila ni sus variantes u objetos privados
And repetir el descarte termina con éxito sin cambios adicionales
And el asset deja de aparecer en el listado y su handle deja de resolver una miniatura
And ya no puede editarse ni reordenarse
```

```gherkin
Given un ARTIST, anónimo, service_role, otro tenant, un handle desconocido o un asset que no admite la operación
When intenta editar, mover o descartar
Then la operación falla cerrada con un mensaje genérico
And no modifica ningún asset, variante ni objeto Storage
```

```gherkin
Given una petición de mutación de galería
When no es POST same-origin, repite intent o campos relevantes, mezcla campos de otra intención o incluye studioId, userId, assetId, path o status
Then Inkendar la rechaza antes de componer servicios o leer el formulario completo
And responde con un error privado 400 o 403 sin PII, paths ni detalle del proveedor
```

## Contrato técnico

- Intenciones permitidas: `CREATE_DRAFT`, `UPDATE_DRAFT`, `MOVE_UP`, `MOVE_DOWN` y `DISCARD_DRAFT`. Cada formulario contiene exactamente un `intent`.
- La identidad de asset en HTML y POST es únicamente `handle`, el `public_id` UUID aleatorio ya existente. El servidor no acepta `assetId`, `studioId`, `userId`, `objectPath`, `path`, `status` ni URLs firmadas.
- `CREATE_DRAFT` conserva el multipart actual y acepta solo `intent`, `image`, `altText`, `target` y `artistProfileId`. `UPDATE_DRAFT` acepta solo `intent`, `handle`, `altText`, `target` y `artistProfileId`. Las tres intenciones restantes aceptan solo `intent` y `handle`. Duplicados y campos extra se rechazan.
- Las mutaciones de metadata usan RPCs `SECURITY DEFINER`, `search_path=''`, concedidas únicamente a `authenticated`. Resuelven handle y `auth.uid()` en Postgres, exigen OWNER único del tenant y nunca reciben IDs de estudio o usuario.
- La reasignación toma advisory locks de los grupos anterior y nuevo en orden determinista y asigna `max(position)+1` en el nuevo grupo. Al abandonar o descartar un grupo se conservan huecos; creación y reasignación calculan el máximo sobre todas las filas para mantener la unicidad incluso con descartados.
- El reorder toma un advisory lock por `(studio,target,artist)`, selecciona solo el vecino `DRAFT` inmediato por posición y realiza un swap con constraint de posición diferible. En bordes no modifica datos. La combinación de lock y transacción serializa create/reassign/reorder del grupo.
- `DISCARDED` conserva asset, variantes, paths privados, grupo, posición y timestamps mínimos para una futura restauración o GC. Este slice no implementa restore, GC, hard delete ni llamadas Storage con service role.
- Listado y resolver de miniatura continúan filtrando exclusivamente `DRAFT`, con máximo 100 y headers `private, no-store`. Todos los POST exitosos vuelven a `/app/owner/gallery` mediante 303.
- Los errores de validación son 400; origen/método/rol no autorizado conserva 403 o la respuesta de autenticación; fallos de persistencia son 500. Los cuerpos son mensajes genéricos sin handles ajenos, PII, paths, buckets o proveedor.

## Fuera de alcance

Publicación o retirada, bucket público, feed/CDN, componente web, escritura ARTIST, restore, GC, borrado físico de filas u objetos Storage y cualquier operación live.
