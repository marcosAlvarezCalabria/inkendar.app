# Contrato técnico: confirmación recuperable con Google Calendar

_Estado técnico: `IN_PROGRESS` (candidato local). El candidato incorpora exclusión mutua externa, binding durable, ACL privada, CAS de credencial, recuperación de `INSERTING` después de la caducidad original y serialización con la creación posterior de ofertas. Integración/CI y la prueba live de Google Events y del booking extremo a extremo permanecen `IN_PROGRESS`._

## Necesidad y alcance

Como cliente que eligió una opción preaprobada vigente quiero que Inkendar confirme exactamente ese intervalo una sola vez en el calendario asignado al artista, para recibir una confirmación real aunque una respuesta de Google o de Supabase se pierda.

Este slice empieza después de `SELECTED_PENDING_CONFIRMATION`. Revalida únicamente el intervalo elegido mediante FreeBusy, crea o reconcilia un evento normal de Google y finaliza en una transacción la cita y su relación externa mínima. No incluye elección libre, aprobación OWNER, notificaciones, scheduler, edición/cancelación del evento ni pruebas live.

## Estados y propiedad de datos

- Oferta: `OPEN -> SELECTED_PENDING_CONFIRMATION -> CONFIRMED`; `OPEN` o una pendiente todavía `READY` pueden pasar a `EXPIRED`, pero `INSERTING` queda pendiente recuperable y `CONFIRMED` nunca caduca.
- Opción: `HELD -> SELECTED -> CONFIRMED`; las alternativas pasan a `RELEASED`. La expiración libera `HELD` y `SELECTED` provisionales, pero nunca una selección `INSERTING` ni una `CONFIRMED`.
- Vista pública: `OPEN | SELECTION_PENDING_CONFIRMATION | CONFIRMED`. Solo `CONFIRMED` permite mostrar «Cita confirmada».
- Google Calendar sigue siendo la fuente editable del evento confirmado y de su ocupación. Supabase conserva la relación de dominio, el identificador externo, la correlación opaca y el instante de confirmación; la opción elegida queda como evidencia histórica, no como una segunda agenda editable.
- Después de confirmar, el intervalo deja de ser un hold temporal, pero la opción histórica `CONFIRMED` continúa como exclusión conservadora ligada a la cita. Google sigue siendo la única agenda editable: Supabase no duplica fechas en `appointment` ni permite editar el intervalo por una segunda vía.
- Esta defensa es deliberadamente más cerrada que depender solo de FreeBusy: si el evento se mueve o elimina fuera de Inkendar, el intervalo original permanece bloqueado hasta un futuro flujo explícito de reconciliación/cancelación. Evita reofertarlo durante una ambigüedad, a costa de poder requerir revisión manual.

## Identidad, evento y reconciliación

El ID de Google se deriva de forma determinista del UUID interno de la opción mediante SHA-256 con separación de dominio y base32hex minúscula. Usa solo `a-v` y `0-9`, mide entre 5 y 1024 caracteres y nunca contiene el UUID original. Una segunda derivación separada produce una correlación opaca que se guarda como `extendedProperties.private.inkendar_booking`; no contiene IDs de cliente, caso, oferta u opción.

Cada intento sigue este orden observable:

1. carga solo la selección tenant-safe asociada al hash del enlace y deriva la identidad estable;
2. reclama en Supabase una operación durable con lease y fija inmutablemente `studio/offer/option/connection/calendar/eventId/correlation`; el claim inicial valida vigencia, tenant, conexión `ACTIVE`, ambos scopes y una asignación probada con rol `writer` u `owner`;
3. un lease vigente entrega la operación a un único worker. Otro request devuelve retry sin llamar Google. Un lease `READY` solo puede recuperarse mientras la oferta sigue vigente; un lease `INSERTING` expirado se recupera aun después de `expires_at`, siempre en modo `RECONCILE_ONLY`;
4. el worker llama primero a `Events.get` usando siempre el destino fijado, aunque la asignación actual haya cambiado;
5. si existe, exige coincidencia exacta de ID, intervalo, estado no cancelado, `opaque`, `private`, resumen genérico y correlación privada, sin asistentes; solo entonces finaliza localmente;
6. solo ante `404`, y si ninguna inserción fue iniciada antes, consulta FreeBusy con `timeMin=start`, `timeMax=end` y semántica `[start,end)`;
7. si no hay solape, realiza una transición CAS durable a `INSERTING` antes de `Events.insert`. Esa transición se concede una sola vez por operación y cerca la autoridad de leases expirados;
8. llama a `Events.insert` con el ID derivado, `start.dateTime` inclusivo, `end.dateTime` exclusivo, `summary="Cita Inkendar"`, `transparency="opaque"`, `visibility="private"` y la propiedad privada; omite asistentes, cliente, caso, descripción y recurrencia;
9. valida la respuesta. Ante resultado ambiguo de insert realiza una reconciliación `Events.get`. Después de `INSERTING`, un recovery solo reconcilia: si GET sigue ausente falla cerrado para revisión y nunca emite una segunda inserción;
10. finaliza mediante una RPC atómica e idempotente que valida el binding durable, crea una sola `appointment`, una sola relación Google y mueve oferta/opción a `CONFIRMED`.

Una coincidencia parcial es una colisión/mismatch y falla cerrada. Un payload malformado, calendario inesperado, error por calendario, red, timeout, 429 o 5xx nunca se interpreta como confirmación. Solo `invalid_grant` al refrescar intenta marcar la conexión `REAUTH_REQUIRED`, mediante compare-and-set contra la generación opaca de la credencial realmente usada; un fallo tardío de una generación anterior no degrada una reconexión más nueva. Asignación, opción seleccionada y enlace se conservan.

## OAuth incremental y recuperación pública

La autorización añade `https://www.googleapis.com/auth/calendar.events` a los scopes existentes y conserva `include_granted_scopes=true`. El claim exige antes de fijar o renovar una operación una conexión `ACTIVE`, refresh token y los dos scopes operativos `calendar.events.freebusy` y `calendar.events`; `calendar.calendarlist.readonly` se conserva como parte de la concesión incremental. Una concesión antigua sin cualquiera de los scopes operativos no llama Events ni FreeBusy: deja la selección pendiente y pide al estudio reconectar. La reconexión conserva la asignación existente.

Si ya existe una operación durable y la conexión pierde cualquiera de esos scopes, el claim devuelve `RECONNECT_REQUIRED` sin renovar el lease ni modificar `READY`, `INSERTING` o el binding original. Una reconexión posterior recupera exactamente esa operación; nunca consulta de nuevo la asignación mutable para `beginInsert`.

El listado mantiene metadata de todos los roles conocidos, incluido `writerWithoutPrivateAccess`, pero una asignación apta para confirmaciones privadas solo puede guardarse con `writer` u `owner`. Las asignaciones históricas sin capacidad probada se muestran como incompatibles, no se usan para un claim inicial y deben guardarse de nuevo eligiendo un calendario apto.

`POST /offers/:token` acepta o bien el selector canónico de una opción abierta, o bien un único `intent=confirm` para reintentar una selección pendiente. Tras seleccionar intenta confirmar en la misma operación. Un retry del selector ganador o de `intent=confirm` reutiliza la misma identidad; nunca inserta con otro ID ni sustituye la elección.

Las respuestas públicas mantienen las cabeceras defensivas existentes. Conflicto de disponibilidad, reconexión requerida, colisión y ambigüedad muestran estados seguros y no exponen proveedor, token, selector ni IDs internos. El GET conserva una selección `INSERTING` como pendiente recuperable aun después de `expires_at`, sin presentar la caducidad original como plazo vigente; el estado confirmado sigue disponible y muestra únicamente artista, zona, intervalo e instante de confirmación.

## Persistencia y límites de confianza

- `appointment` contiene una relación tenant-safe única con caso, artista, oferta y opción, estado `CONFIRMED` e instante de confirmación.
- `appointment_google_event` contiene una relación uno-a-uno con conexión, calendario, ID de evento, correlación y sincronización. No copia resumen, descripción, asistentes ni contenido editable del evento.
- `booking_confirmation_operation` conserva antes de Google el binding inmutable y la máquina `READY -> INSERTING -> FINALIZED`, junto con un lease opaco. `READY` sigue siendo provisional: la caducidad libera oferta/opción y después `beginInsert` devuelve falso. `INSERTING` es irreversible ante cualquier error, incluido `invalid_grant`, sobrevive a `expires_at`, mantiene la exclusión local y solo permite reconciliar; no existe RPC ni puerto para devolverlo a `READY`.
- `google_calendar_connection.credential_generation` aumenta en cada activación/reconexión sin derivarse del token ni revelarlo. Todas las transiciones por `invalid_grant` comparan esa generación.
- Las tablas tienen RLS y ningún grant directo para browser o `service_role`; solo RPCs `SECURITY DEFINER`, `search_path=''`, exclusivas de `service_role`.
- La RPC de preparación resuelve el token por hash y devuelve contexto interno solo al backend. El claim valida la asignación actual una vez; la finalización valida el binding durable en lugar de consultar una asignación mutable.
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
And dos intentos concurrentes conceden autoridad de inserción a uno solo
And el otro devuelve retry o reconcilia después sin llamar Events.insert concurrentemente
```

```gherkin
Given una operación READY cuyo lease expira o se libera
When la oferta alcanza expires_at y se materializa la caducidad
Then la oferta queda EXPIRED y la opción SELECTED queda RELEASED
And beginInsert devuelve falso aunque se presente el lease anterior
And el enlace, el contexto y el claim dejan de estar disponibles

Given un crash después de la transición durable a INSERTING
When la oferta supera expires_at y se ejecuta la caducidad
Then oferta y opción permanecen SELECTED_PENDING_CONFIRMATION y SELECTED
And el intervalo sigue excluido de nuevas ofertas y aparece entre los holds
And el enlace y el contexto siguen mostrando un estado pendiente recuperable

When el lease sigue vigente
Then otro worker recibe BUSY
When el lease expira y se reintenta
Then el retry consulta Events.get en el calendario originalmente fijado
And si el evento no existe queda pendiente para revisión sin una segunda inserción
And si existe y coincide puede finalizar CONFIRMED aunque haya pasado expires_at
```

```gherkin
Given una selección READY cuyo plazo vence mientras otro worker intenta beginInsert
When una creación posterior solicita un intervalo solapado
Then create_booking_offer conserva primero el lock advisory del artista
And materializa bajo locks offer→operation las ofertas vencidas en orden de ID
And si beginInsert ganó, observa INSERTING y rechaza el nuevo intervalo con 23P01
And si la creación ganó, expira y libera la selección previa antes de crear y beginInsert devuelve false aunque conserve un p_now anterior
And ambos órdenes terminan antes de 10 segundos sin deadlock
```

```gherkin
Given que el calendario del artista cambia de A a B después del claim
When se recupera una confirmación ambigua
Then Events.get usa siempre la conexión y el calendario A fijados
And nunca crea el evento en B
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
Given una conexión ACTIVE con token y asignación writer u owner
But la concesión carece de calendar.events.freebusy o calendar.events
When se intenta reclamar una confirmación nueva
Then el resultado es RECONNECT_REQUIRED
And no se crea operación, lease ni binding

Given una operación durable cuyo binding ya fue fijado
But la concesión actual carece de cualquiera de los dos scopes operativos
When se reintenta después de vencer el lease
Then el resultado es RECONNECT_REQUIRED
And lease, estado y binding permanecen idénticos

Given una concesión antigua sin cualquiera de los scopes operativos o un refresh invalid_grant
When se intenta confirmar
Then la opción seleccionada y su enlace se conservan
And se exige reconexión sin afirmar confirmación
And solo invalid_grant cambia la conexión a REAUTH_REQUIRED
And un invalid_grant tardío no modifica una generación reconectada
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

La evidencia anterior quedó obsoleta tras los defectos encontrados en revisión. Las vueltas de corrección demostraron RED funcional tanto para la carrera `create_booking_offer`/`beginInsert` como para el claim con `calendar.events` pero sin `calendar.events.freebusy`: este último creaba una operación nueva y renovaba el lease de una operación existente. Después pasó el gate local completo con 314 pruebas Vitest (más una integración omitida), lint, typecheck y build, y 442 aserciones pgTAP sobre la base local migrada forward-only; el lint SQL no encontró errores. `scripts/booking-confirmation-races.integration.ps1` volvió a pasar con dos conexiones reales los cuatro órdenes begin/create y begin/expiry, `lock_timeout=8s`, `statement_timeout=9s`, sin deadlock y con cleanup sintético. Revisión de integración y CI siguen pendientes, por lo que el estado no avanza a `DONE`.

No se usaron credenciales ni cuenta Google y no se ejecutó una prueba live. Revisión, integración/CI, Google Events live y el recorrido extremo a extremo permanecen `IN_PROGRESS`.
