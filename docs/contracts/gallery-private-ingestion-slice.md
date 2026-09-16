# Ingestión privada y asignación de galería

_Estado técnico: DONE integrado mediante PR #26 y CI verde; sin prueba live_

## Requisito

Como owner autenticado quiero subir una imagen y asignarla a la galería general o al portfolio de un artista de mi estudio para preparar contenido privado antes de publicarlo.

## Contrato observable

```gherkin
Given un OWNER autenticado y una petición multipart same-origin
When sube un JPEG, PNG o WebP decodificable de hasta 10 MiB, 12000x12000 y 40 megapíxeles con alt normalizado de 1..160 caracteres
Then Inkendar aplica orientación, elimina metadata mediante re-encode y guarda únicamente master, display y thumb WebP privados
And display usa ancho máximo 1600, thumb ancho máximo 480, ambos sin upscale y calidad estable 82/78
And persiste el borrador solo después de completar los tres uploads
```

```gherkin
Given una imagen corrupta, animada/multipágina, de formato distinto, con MIME simulado o que supera cualquier límite
When el OWNER intenta subirla
Then Inkendar la rechaza antes de persistir objetos o metadata
And responde con un error genérico que no contiene filename, path, bucket ni detalle del proveedor
```

```gherkin
Given un destino ARTIST_PORTFOLIO
When el artista no pertenece al mismo estudio, falta o fue manipulado
Then la operación falla cerrada sin conservar objetos ni filas
```

```gherkin
Given que falla o queda ambiguo cualquier upload o la persistencia final
When se ejecuta la operación
Then Inkendar no afirma que el asset esté completo
And intenta eliminar todos los objetos del intento sin exponer sus paths
And un posible huérfano privado queda como riesgo explícito para reconciliación futura
```

```gherkin
Given un OWNER autenticado
When abre /app/owner/gallery
Then ve como máximo 100 borradores de su estudio en orden estable por posición y creación
And cada miniatura usa una ruta same-origin con handle opaco separado de IDs internos
And un resource route OWNER resuelve el handle mediante `auth.uid()`, firma y descarga solo en servidor
And el HTML no contiene URL firmada, token, paths internos, bucket, IDs internos ni errores del proveedor
```

## Límites y tipos

- `target`: `GALLERY | ARTIST_PORTFOLIO`; `artistProfileId` es nulo para `GALLERY` y obligatorio para portfolio.
- Entrada: exactamente un `File`; bytes máximos `10 * 1024 * 1024`; formatos decodificados `jpeg | png | webp`; una sola página/frame; ancho y alto `1..12000`; producto máximo `40_000_000`.
- Salida WebP server-only: master sanitizada a tamaño original, calidad 88; display calidad 82 y ancho máximo 1600; thumb calidad 78 y ancho máximo 480. Ninguna variante hace upscale y ninguna conserva EXIF, ICC, XMP o GPS.
- Paths: `<studio UUID>/<asset UUID>/<variant>.webp`. No contienen filename del usuario. Bucket privado `gallery-private`; no se persisten binarios ni URLs firmadas. La UI recibe solo `thumbnailHandle` (UUID público aleatorio) y ruta `/app/owner/gallery/thumbnails/:handle`.
- Persistencia de ingestión: cada asset nace `DRAFT` y recibe `max(position)+1` en su grupo, con metadata por variante, timestamps y FKs/checks compuestos tenant-safe. La evolución posterior a `DISCARDED` pertenece al contrato de curación enlazado abajo. Tablas sin grants directos; RPCs `SECURITY DEFINER`, `search_path=''`, concedidas solo a `authenticated`, ligadas a `auth.uid()` y revocadas a `service_role`. `service_role` se usa exclusivamente para objetos Storage tras el guard OWNER.
- Lectura de miniatura: el resolver exige OWNER del tenant, asset `DRAFT` y variante `THUMB`; la URL firmada dura 30 segundos y permanece server-only. El fetch acepta únicamente el origen Supabase configurado y el prefijo del bucket privado, prohíbe redirects, exige `image/webp`, tamaño persistido máximo 10 MiB y timeout de 3 segundos. La respuesta proxy usa `private, no-store` y `nosniff`.
- Consistencia: Storage y Postgres no forman una transacción. Los uploads preceden al insert; cualquier fallo activa compensación best-effort. Una respuesta Storage ambigua puede dejar un huérfano privado, nunca una fila completa ni contenido público.

## Evolución y fuera de alcance

La edición, reasignación, reorder y descarte recuperable posteriores se definen en [Curación privada de borradores de galería](gallery-draft-curation-slice.md). Publicación/retirada, feed público, CDN/cache, web component, API pública, hard delete y cualquier escritura ARTIST continúan fuera de este contrato.
