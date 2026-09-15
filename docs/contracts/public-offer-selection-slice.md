# Contrato técnico: selección pública de una opción preaprobada

_Estado técnico: `IN_PROGRESS`. Existe implementación local pendiente de revisión independiente, Pull Request y CI; este slice no acredita confirmación Google ni pruebas live._

## Alcance

Como cliente con un enlace vigente a una oferta preaprobada quiero elegir exactamente una de sus opciones reservadas, para comunicar mi selección sin que Inkendar afirme todavía una cita confirmada antes de completar la escritura idempotente en Google Calendar.

Cada `booking_option` recibe al crearse un selector público UUID v4 aleatorio, estable e independiente de su `id`. El `GET /offers/:token` de una oferta `OPEN` expone por opción solo `{ selector, startUtc, endUtc }`; nunca expone `booking_option.id`, `offer_id`, `studio_id` ni otro identificador interno. Token y selector se validan en forma canónica antes de componer persistencia.

`POST /offers/:token` es same-origin, acepta únicamente un cuerpo `application/x-www-form-urlencoded` acotado con un solo campo `selector`, no redirige y no refleja token ni selector. La aplicación envía a Supabase solo SHA-256 del token y el selector. Una RPC transaccional `SECURITY DEFINER`, `search_path = ''` y exclusiva de `service_role` bloquea la oferta resuelta por hash y tiempo. Si está `OPEN`, mueve la oferta a `SELECTED_PENDING_CONFIRMATION`, la opción `HELD` elegida a `SELECTED` y las demás a `RELEASED`. El intervalo elegido continúa siendo un hold activo hasta la confirmación futura o la caducidad.

Repetir el mismo selector sobre la misma oferta devuelve el mismo éxito semántico. Una selección diferente, incluso concurrente, no sustituye a la ganadora y produce una respuesta genérica que no revela qué opción fue elegida. Token inválido, mal formado, rotado, desconocido o vencido conserva la respuesta pública uniforme de no disponibilidad.

Un `GET` posterior con el mismo token puede devolver `SELECTION_PENDING_CONFIRMATION` y únicamente el artista, zona, caducidad y el intervalo elegido. La UI dice «selección recibida, pendiente de confirmación» y nunca «cita confirmada». La gestión OWNER puede reflejar el estado sin permitir confirmarlo.

`list_active_booking_holds` incluye tanto opciones `HELD` de ofertas `OPEN` como la opción `SELECTED` de ofertas `SELECTED_PENDING_CONFIRMATION`, siempre con `expires_at > now`. `expire_booking_offers` materializa también selecciones pendientes vencidas: oferta `EXPIRED`, opción elegida y alternativas todavía activas `RELEASED`, de forma atómica e idempotente.

Todas las respuestas GET/POST, de éxito o error, conservan `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex, nofollow` y CSP restrictiva compatible con el formulario same-origin. React escapa el contenido. Token y selector no se registran, serializan en errores ni aparecen en redirects.

## Contrato técnico

- Estados aditivos: oferta `OPEN | SELECTED_PENDING_CONFIRMATION | EXPIRED`; opción `HELD | SELECTED | RELEASED`.
- Estado público: `OPEN | SELECTION_PENDING_CONFIRMATION`, deliberadamente distinto de una confirmación.
- Selector: UUID v4 canónico en minúsculas, generado por Postgres para cada opción y único globalmente; no es el `id` interno.
- `PublicBookingOfferView` es una unión discriminada: `OPEN` entrega de una a tres opciones con selector; `SELECTION_PENDING_CONFIRMATION` entrega un único intervalo sin selector.
- El puerto público añade `selectByTokenHash({ tokenHash, selector, nowUtc })`; el browser nunca llama Supabase directamente.
- La RPC `select_public_booking_offer(text,text,timestamptz)` valida entradas, resuelve y bloquea una única oferta vigente, aplica la transición completa y distingue internamente éxito idempotente, conflicto y no disponibilidad sin devolver la opción ganadora.
- El body POST máximo es 256 bytes y contiene exactamente un campo; cuerpos sin longitud confiable también se leen con límite real.

## Criterios de aceptación

```gherkin
Given una oferta OPEN vigente con entre una y tres opciones HELD
When un visitante abre su enlace público
Then cada opción incluye un selector opaco UUID v4 independiente
And no recibe booking_option.id ni ningún otro identificador interno
```

```gherkin
Given una oferta OPEN vigente y el selector de una de sus opciones HELD
When el cliente envía POST same-origin a /offers/:token
Then la oferta pasa atómicamente a SELECTED_PENDING_CONFIRMATION
And la opción elegida pasa a SELECTED y conserva su hold activo
And todas las demás opciones pasan a RELEASED
And la respuesta no redirige ni expone token, selector o IDs internos
```

```gherkin
Given una oferta con una selección pendiente
When se repite el mismo selector
Then la operación devuelve éxito idempotente sin cambiar la elección
When otra petición intenta seleccionar una opción distinta
Then no reemplaza la elección ganadora
And recibe un rechazo genérico que no revela cuál fue elegida
```

```gherkin
Given una selección pendiente que no ha vencido
When el OWNER calcula disponibilidad
Then el intervalo SELECTED continúa apareciendo como hold activo
When la oferta alcanza su vencimiento y se ejecuta la expiración
Then la oferta queda EXPIRED y su opción SELECTED queda RELEASED atómicamente
And repetir la expiración no vuelve a modificarla
```

```gherkin
Given un token o selector mal formado, una petición cross-origin, un body sobredimensionado o campos adicionales
When se intenta seleccionar públicamente
Then Inkendar falla cerrado antes de la mutación privilegiada cuando corresponde
And conserva respuestas genéricas y todas las cabeceras defensivas
And no registra, refleja ni redirige la credencial o el selector
```

```gherkin
Given una selección pública aceptada en este slice
When el cliente vuelve a abrir el enlace
Then ve solo «selección recibida, pendiente de confirmación» y el intervalo elegido
And no se comunica ni persiste una cita confirmada
```

## Fuera de alcance

No incluye elección libre, aprobación OWNER, revalidación final de FreeBusy, Google Events, confirmación de cita, notificaciones, scheduler ni pruebas live. El slice posterior de Google completará la confirmación exigida por DEC-007; hasta entonces la selección preaprobada permanece explícitamente pendiente.
