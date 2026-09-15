# Contrato técnico: confirmación recuperable con Google Calendar

_Estado técnico: `DONE`. La implementación sintética local pasó 308 pruebas Vitest (una integración omitida de forma esperada), build y 49 aserciones pgTAP del slice dentro de 373; la revisión/integración y la prueba live de Google Events y del booking extremo a extremo permanecen `IN_PROGRESS`._

## Necesidad y alcance

Como cliente que eligió una opción preaprobada vigente quiero que Inkendar confirme exactamente ese intervalo una sola vez en el calendario asignado al artista, para recibir una confirmación real aunque una respuesta de Google o de Supabase se pierda.

Este slice empieza después de `SELECTED_PENDING_CONFIRMATION`. Revalida únicamente el intervalo elegido mediante FreeBusy, crea o reconcilia un evento normal de Google y finaliza en una transacción la cita y su relación externa mínima. No incluye elección libre, aprobación OWNER, notificaciones, scheduler, edición/cancelación del evento ni pruebas live.

## Estados y propiedad de datos

- Oferta: `OPEN -> SELECTED_PENDING_CONFIRMATION -> CONFIRMED`; `OPEN` o pendiente pueden pasar a `EXPIRED`, pero `CONFIRMED` nunca caduca.
- Opción: `HELD -> SELECTED -> CONFIRMED`; las alternativas pasan a `RELEASED`. La expiración solo libera `HELD` o `SELECTED`, nunca `CONFIRMED`.
- Vista pública: `OPEN | SELECTION_PENDING_CONFIRMATION | CONFIRMED`. Solo `CONFIRMED` permite mostrar «Cita confirmada».
- Google Calendar sigue siendo la fuente editable del evento confirmado y de su ocupación. Supabase conserva la relación de dominio, el identificador externo, la correlación opaca y el instante de confirmación; la opción elegida queda como evidencia histórica, no como una segunda agenda editable.
- Después de confirmar, el intervalo deja de ser un hold temporal, pero la opción histórica `CONFIRMED` continúa como exclusión conservadora ligada a la cita. Google sigue siendo la única agenda editable: Supabase no duplica fechas en `appointment` ni permite editar el intervalo por una segunda vía.
- Esta defensa es deliberadamente más cerrada que depender solo de FreeBusy: si el evento se mueve o elimina fuera de Inkendar, el intervalo original permanece bloqueado hasta un futuro flujo explícito de reconciliación/cancelación. Evita reofertarlo durante una ambigüedad, a costa de poder requerir revisión manual.

## Identidad, evento y reconciliación

El ID de Google se deriva de forma determinista del UUID interno de la opción mediante SHA-256 con separación de dominio y base32hex minúscula. Usa solo `a-v` y `0-9`, mide entre 5 y 1024 caracteres y nunca contiene el UUID original. Una segunda derivación separada produce una correlación opaca que se guarda como `extendedProperties.private.inkendar_booking`; no contiene IDs de cliente, caso, oferta u opción.

Cada intento sigue este orden observable:

1. carga el contexto tenant-safe asociado al hash del enlace y deriva la identidad estable;
2. exige conexión `ACTIVE`, calendario asignado y los scopes `calendar.events.freebusy` y `calendar.events`;
3. llama primero a `Events.get(calendarId,eventId)`;
4. si existe, exige coincidencia exacta de ID, intervalo, estado no cancelado, `opaque`, `private`, resumen genérico y correlación privada, sin asistentes; solo entonces finaliza localmente;
5. solo ante `404` consulta FreeBusy con `timeMin=start`, `timeMax=end` y semántica `[start,end)`;
6. si no hay solape, llama a `Events.insert` con el ID derivado, `start.dateTime` inclusivo, `end.dateTime` exclusivo, `summary="Cita Inkendar"`, `transparency="opaque"`, `visibility="private"` y la propiedad privada; omite asistentes, cliente, caso, descripción y recurrencia;
7. valida la respuesta. Ante conflicto o resultado ambiguo de insert realiza una reconciliación `Events.get`; si todavía no existe o no puede verificarse, mantiene el estado pendiente;
8. finaliza mediante una RPC atómica e idempotente que crea una sola `appointment`, una sola relación Google y mueve oferta/opción a `CONFIRMED`.

Una coincidencia parcial es una colisión/mismatch y falla cerrada. Un payload malformado, calendario inesperado, error por calendario, red, timeout, 429 o 5xx nunca se interpreta como confirmación. Solo `invalid_grant` al refrescar marca la conexión `REAUTH_REQUIRED`; asignación, opción seleccionada y enlace se conservan.

## OAuth incremental y recuperación pública

La autorización añade `https://www.googleapis.com/auth/calendar.events` a los scopes existentes y conserva `include_granted_scopes=true`. Una concesión antigua sin este scope no llama Events ni FreeBusy: deja la selección pendiente y pide al estudio reconectar. La reconexión conserva la asignación existente.

`POST /offers/:token` acepta o bien el selector canónico de una opción abierta, o bien un único `intent=confirm` para reintentar una selección pendiente. Tras seleccionar intenta confirmar en la misma operación. Un retry del selector ganador o de `intent=confirm` reutiliza la misma identidad; nunca inserta con otro ID ni sustituye la elección.

Las respuestas públicas mantienen las cabeceras defensivas existentes. Conflicto de disponibilidad, reconexión requerida, colisión y ambigüedad muestran estados seguros y no exponen proveedor, token, selector ni IDs internos. El GET confirmado sigue disponible después de `expires_at` y muestra únicamente artista, zona, intervalo e instante de confirmación.

## Persistencia y límites de confianza

- `appointment` contiene una relación tenant-safe única con caso, artista, oferta y opción, estado `CONFIRMED` e instante de confirmación.
- `appointment_google_event` contiene una relación uno-a-uno con conexión, calendario, ID de evento, correlación y sincronización. No copia resumen, descripción, asistentes ni contenido editable del evento.
- Las tablas tienen RLS y ningún grant directo para browser o `service_role`; solo RPCs `SECURITY DEFINER`, `search_path=''`, exclusivas de `service_role`.
- La RPC de preparación resuelve el token por hash y devuelve contexto interno solo al backend. La finalización vuelve a bloquear y validar oferta, opción, tenant, conexión y asignación antes de escribir todo atómicamente.
- La finalización concurrente del mismo evento es idempotente. Una relación existente con calendario, evento o correlación distintos falla cerrada y no cambia estados.

## Criterios de aceptación

```gherkin
Given una selección preaprobada vigente y una concesión con ambos scopes
When se intenta confirmar y el ID determinista no existe en Google
Then Inkendar consulta FreeBusy para exactamente [start,end)
And si está libre inserta un evento privado y opaco sin PII ni asistentes
And solo después de verificarlo finaliza cita, relación y estados CONFIRMED atómicamente
```

```gherkin
Given que Google creó el evento pero se perdió la respuesta o la finalización local
When se reintenta la confirmación
Then Events.get es la primera operación de Calendar
And una coincidencia exacta finaliza sin consultar FreeBusy ni volver a insertar
And dos intentos concurrentes convergen en una cita y un evento
```

```gherkin
Given que el ID determinista existe con otro intervalo, correlación o contrato
When se intenta reconciliar
Then Inkendar lo trata como colisión
And no modifica ni reemplaza el evento
And no comunica una cita confirmada
```

```gherkin
Given que FreeBusy devuelve cualquier intervalo que solapa la selección
When se intenta confirmar
Then Inkendar no llama Events.insert
And conserva la selección pendiente
And la UI comunica de forma segura que el horario requiere revisión
```

```gherkin
Given una concesión antigua sin calendar.events o un refresh invalid_grant
When se intenta confirmar
Then la opción seleccionada y su enlace se conservan
And se exige reconexión sin afirmar confirmación
And solo invalid_grant cambia la conexión a REAUTH_REQUIRED
```

```gherkin
Given una cita ya finalizada
When vence la caducidad original o se repite selección y confirmación
Then la cita, oferta y opción continúan CONFIRMED
And la reconciliación usa el mismo eventId sin duplicar ni sustituir
And la disponibilidad conserva una exclusión local inmutable además de observar Google, sin crear una segunda agenda editable
```

## Fuentes oficiales verificadas el 2026-09-15

- [Events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Events.get](https://developers.google.com/workspace/calendar/api/v3/reference/events/get)
- [Freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Scopes de Google Calendar](https://developers.google.com/workspace/calendar/api/auth)
- [Propiedades extendidas](https://developers.google.com/workspace/calendar/api/guides/extended-properties)

## Evidencia y gates

El gate técnico local pasó el 2026-09-15 con 308 pruebas Vitest (una integración omitida de forma esperada), lint, typecheck, build y 49 aserciones pgTAP nuevas dentro de 373. La prueba de concurrencia hace converger dos intentos sobre una sola identidad determinista; pgTAP verifica bloqueo, unicidad, retry idempotente, mismatch, RLS/grants, expiración y exclusión confirmada.

No se usaron credenciales ni cuenta Google y no se ejecutó una prueba live. Revisión, integración/CI, Google Events live y el recorrido extremo a extremo permanecen `IN_PROGRESS`.
