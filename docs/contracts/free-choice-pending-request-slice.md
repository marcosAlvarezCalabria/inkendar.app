# Contrato técnico: solicitud pendiente desde elección libre

_Estado técnico: diseño fijado; implementación local en curso. No acredita prueba live, aprobación ni cita._

## Alcance y decisión

Como OWNER quiero emitir o rotar un enlace temporal para un caso `OPEN` y su artista ya asignado, para que ese cliente elija un único hueco real y el estudio reciba una solicitud durable `PENDING_OWNER_APPROVAL` sin afirmar una cita confirmada.

Los enlaces nuevos se identifican por caso, no por artista. El caso debe pertenecer al estudio, permanecer `OPEN` y tener `artist_profile_id` igual al artista elegido. Un caso sin artista falla cerrado: este slice no lo asigna implícitamente. La migración conserva enlaces legacy sin caso para consulta GET, pero su POST siempre responde con el mismo rechazo público genérico. Emitir de nuevo para un caso rota solo ese caso; varios casos del mismo artista pueden mantener enlaces distintos.

GET calcula candidatos con reglas, FreeBusy y holds y entrega por slot `{ selector, startUtc, endUtc, startLocal, endLocal }`. `selector` es un SHA-256 opaco ligado al token y al intervalo canónico; no es un ID y no se persisten 500 candidatos. POST same-origin acepta exactamente un único `selector`, vuelve a resolver el token y recalcular candidatos tras una nueva consulta FreeBusy, encuentra el intervalo por comparación constante y solo entonces solicita la operación atómica de base de datos. No acepta tenant, artista, caso, rango ni timestamps.

La RPC bloquea por estudio/artista, vuelve a comprobar token vigente, caso `OPEN` y artista coherente, excluye holds de ofertas, selecciones, citas y otras solicitudes libres, y crea como máximo una solicitud por acceso. Repetir el mismo selector/intervalo devuelve éxito idempotente; una elección distinta no reemplaza a la ganadora. La caducidad es `min(now + booking_offer_expiry_hours, access.expires_at, slot.start_at)` y la solicitud deja de bloquear cuando vence. FreeBusy precede necesariamente a la transacción: el lock elimina carreras internas, pero no puede impedir que un evento externo aparezca entre la lectura de Google y el commit; por eso el estado sigue pendiente y la aprobación futura deberá revalidar.

## Contrato público y privado

- Antes de seleccionar: DTO público sin PII ni IDs internos, con metadatos actuales y slots con selector opaco.
- Después de seleccionar: `{ state: "PENDING_OWNER_APPROVAL", expiresAt, artistDisplayName, timeZone, selectedSlot }`; no vuelve a ofrecer alternativas.
- Token/configuración inválida, expirada, rotada o legacy, selector stale/no candidato, busy, carrera o conflicto interno convergen en respuesta pública genérica.
- Todas las respuestas conservan `private, no-store`, `no-referrer`, CSP restrictiva y `form-action 'self'`.
- La vista OWNER lista solo contexto privado mínimo: cliente, resumen de caso, artista, intervalo y caducidad. No hay aprobación/rechazo en este slice.

## Criterios de aceptación

```gherkin
Given un OWNER y un caso OPEN de su tenant asignado al artista elegido
When emite o rota un enlace válido
Then el token hash-only queda ligado al caso y artista
And otros casos del mismo artista conservan sus enlaces
And un caso cerrado, ajeno, sin artista o con otro artista falla cerrado
```

```gherkin
Given un enlace nuevo vigente sin selección
When el cliente consulta y envía exactamente un selector candidato same-origin
Then Inkendar reconsulta FreeBusy y holds
And crea atómica y durablemente una solicitud PENDING_OWNER_APPROVAL
And el GET posterior muestra solo estado pendiente, intervalo y caducidad sin PII ni IDs
```

```gherkin
Given una respuesta perdida o doble click con el mismo selector
When el POST se repite
Then devuelve el mismo éxito semántico sin duplicar la solicitud
But dos selecciones competidoras se serializan y solo una gana
```

```gherkin
Given un enlace legacy sin caso, rotado/expirado, un selector manipulado o stale, Google busy o un hold competidor
When se intenta seleccionar
Then no se crea ni reemplaza ninguna solicitud
And la respuesta pública no revela la causa
```

```gherkin
Given una solicitud pendiente no vencida
When se calcula disponibilidad o se crea otro hold para el artista
Then el intervalo queda excluido
When vence
Then deja de bloquear sin necesidad de borrado
```

## Fuera de alcance

Aprobación/rechazo, Google Event, `appointment`, confirmación, notificación, email/Chatwoot, recordatorios y pruebas live.
