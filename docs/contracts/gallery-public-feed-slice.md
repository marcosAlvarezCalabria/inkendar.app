# Feed público de galería

_Estado técnico: `DONE`; integrado mediante PR #29 en `main` con los checks `validate` y `database` verdes, sin evidencia live de Storage_

## Requisito

Como visitante de la web de un estudio quiero leer su galería y portfolios publicados mediante un contrato estable para ver únicamente contenido aprobado sin acceder a datos privados de Inkendar.

## Contrato observable

```gherkin
Given un slug público canónico de un estudio con assets PUBLISHED
When una web solicita GET /api/public/studios/:studioSlug/gallery
Then recibe un StudioGallery con studio_public_slug, updated_at, gallery_images y artists
And cada imagen contiene solo public_id, variantes públicas DISPLAY y THUMB, alt_text, position y published_at
And cada artista contiene artist_public_slug, display_name y portfolio_images
And el orden es determinista y la respuesta contiene como máximo 100 imágenes
```

```gherkin
Given assets DRAFT, PUBLISHING, PUBLISHED, RETIRING, RETIRED o DISCARDED
When se resuelve el feed público
Then solo PUBLISHED es elegible
And comenzar RETIRE excluye el asset de la siguiente lectura de origen
And ningún master, path privado, binding, ID interno, usuario, cliente, caso, conversación o calendario aparece en la respuesta
```

```gherkin
Given una respuesta pública vigente
When el cliente repite GET con un If-None-Match que coincide con su ETag
Then recibe 304 sin cuerpo
And conserva el mismo ETag, Cache-Control y cabeceras defensivas
And una publicación o retirada cambia el cuerpo y el ETag
```

```gherkin
Given un slug mal formado o desconocido, un fallo de persistencia o un método distinto de GET o HEAD
When se solicita el endpoint
Then un slug no resoluble devuelve 404 uniforme y un fallo interno devuelve 503 genérico
And los métodos no admitidos devuelven 405 con Allow GET, HEAD
And ninguna respuesta contiene secretos, IDs internos, paths privados o detalle del proveedor
```

```gherkin
Given más de 120 solicitudes para el mismo slug dentro de una ventana de 60 segundos en un proceso
When llega otra solicitud
Then el endpoint responde 429 con Retry-After y cabeceras RateLimit medibles
And no consulta persistencia
```

## Contrato HTTP y DTO

- Ruta: `GET | HEAD /api/public/studios/:studioSlug/gallery`. No existe action ni escritura pública.
- `studioSlug`, `studio_public_slug`, `artist_public_slug` y `public_id` son UUID públicos canónicos separados de IDs internos. Los slugs se generan una vez y no se pueden actualizar.
- Éxito `200 application/json`:

```text
StudioGallery
├── studio_public_slug
├── updated_at
├── gallery_images[]
│   ├── public_id
│   ├── image_variants
│   │   ├── display { url, width, height, mime_type }
│   │   └── thumb   { url, width, height, mime_type }
│   ├── alt_text
│   ├── position
│   └── published_at
└── artists[]
    ├── artist_public_slug
    ├── display_name
    └── portfolio_images[]
```

- `gallery_images` se ordena por `position`, `published_at`, `public_id`; `artists` por `display_name`, `artist_public_slug`; cada portfolio usa el mismo orden de imagen. El límite de 100 se aplica al total del estudio antes de agrupar.
- Las URLs apuntan únicamente a `gallery-public/<publication-key>/<display|thumb>.webp`. Son inmutables porque el binding no cambia y un asset retirado no se republica. El RPC puede entregar paths públicos al backend, pero el DTO no expone path, bucket ni publication key como campos.
- `updated_at` avanza con cambios del lifecycle público. No incorpora edición de borradores como señal pública.
- Todas las respuestas usan `Cache-Control: public, max-age=60, s-maxage=60, must-revalidate`, `ETag`, `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` y CSP `default-src 'none'; frame-ancestors 'none'`. Sesenta segundos queda por debajo del máximo de 300 s de los objetos y acota la visibilidad de una retirada en caché; el origen excluye `RETIRING` inmediatamente.
- El ETag es fuerte y deriva del cuerpo JSON exacto. `If-None-Match` admite listas, tags débiles equivalentes y `*`. HEAD devuelve las mismas cabeceras que GET sin cuerpo.
- El limitador portable es una ventana fija de 120 solicitudes por slug y 60 segundos por proceso, con memoria acotada. Expone `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; 429 añade `Retry-After`. La caché compartida/limitación de edge podrá reforzarlo cuando se elija hosting, sin sustituir este límite comprobable.

## Persistencia y seguridad

- `studio.public_slug` y `artist_profile.public_slug` son UUID únicos, `NOT NULL`, con default aleatorio y trigger de inmutabilidad. No reutilizan `id`, `user_id` ni publication binding.
- `get_public_studio_gallery(uuid, integer)` es `SECURITY DEFINER`, `STABLE`, fija `search_path=''`, limita `1..100` y se concede solo a `service_role`. `anon` y `authenticated` no leen tablas ni ejecutan el RPC directamente; el resource route server-only es la frontera pública.
- El RPC filtra exactamente `status='PUBLISHED'`, exige DISPLAY y THUMB WebP y construye salida tenant-scoped desde el estudio resuelto por slug. No acepta `studio_id`, usuario ni tenant del cliente.
- La aplicación crea el cliente privilegiado únicamente en servidor. La respuesta del adaptador se valida y se proyecta campo a campo; datos extra de Supabase se descartan. `SUPABASE_SERVICE_ROLE_KEY` nunca se serializa, registra ni importa en código de navegador.
- `404`, `429` y `503` son genéricos. No se usan datos reales ni se atribuye evidencia live de Storage.

## Fuera de alcance

Web component, edición pública, upload, restore, GC, republicación, invalidación específica de proveedor/CDN, prueba live de Storage y selección del hosting o WAF definitivos.
