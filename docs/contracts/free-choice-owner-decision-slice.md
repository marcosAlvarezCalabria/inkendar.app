# Contrato: decisión OWNER de elección libre

_Estado técnico: `DONE`. El PR #38 integró aprobación/rechazo, recuperación Google y terminal público con CI verde. El 2026-09-23 se verificaron con datos sintéticos el rechazo y el recorrido de aprobación hasta evento confirmado y terminal público `CONFIRMED`._

## Necesidad

Como OWNER quiero aprobar o rechazar una solicitud durable `PENDING_OWNER_APPROVAL`, para cerrar la elección del cliente sin convertirla en cita antes de confirmar exactamente un evento privado en Google.

## Contrato

La mutación privada same-origin acepta solo `requestId` e `intent=approve|reject`; estudio y usuario proceden de la sesión OWNER. `REJECT` solo transiciona una solicitud pendiente y vigente a `REJECTED`, libera su hold atómicamente y es idempotente. `APPROVE` fija antes de Google un binding inmutable request/caso/artista/conexión/calendario/eventId/correlación, exige asignación compatible, conexión activa y scopes FreeBusy+Events, revalida Google FreeBusy y conflictos locales excluyendo el hold propio, y obtiene una única autoridad durable `READY -> INSERTING`.

`READY` no sobrevive a la caducidad de la solicitud: claim, management o release materializan `EXPIRED`, limpian el lease y conservan la operación durable sin autoridad de insert. Desde `INSERTING` la solicitud permanece `APPROVING` aunque venza. Toda recuperación usa `Events.get` contra el binding original; nunca hace un segundo insert. Un evento exacto `private`, `opaque`, sin asistentes y sin PII finaliza atómicamente una cita y su relación externa; mismatch o ambigüedad conservan el estado seguro. `invalid_grant` usa CAS por generación.

El GET público por el mismo token expone solo `PENDING_OWNER_APPROVAL`, `APPROVING`, `CONFIRMED`, `REJECTED` o `EXPIRED`, con intervalo únicamente mientras sigue pendiente o confirmada. La caducidad termina la autoridad de seleccionar, no la consulta del resultado: el token consumido no puede rotarse y sigue resolviendo mientras se conserven la solicitud y su acceso; un proceso de retención futuro podrá eliminar ambos y convertir después la respuesta en el 404 genérico. `APPROVING` nunca expone intervalo ni afirma cita. Ningún estado expone IDs, cliente, caso, tenant, calendario ni estado interno de Google.

La notificación al cliente posterior a un rechazo no forma parte de esta decisión de dominio. Una [extensión independiente del outbox](./free-choice-rejection-notification-slice.md), actualmente candidata local, observa la transición durable sin cambiar su idempotencia, la liberación del hold ni la ausencia de llamadas a Google.

## Aceptación

```gherkin
Scenario: OWNER rechaza una solicitud vigente
  Given una solicitud PENDING_OWNER_APPROVAL de su estudio
  When el OWNER envía REJECT
  Then queda REJECTED de forma durable e idempotente
  And el intervalo deja de bloquear disponibilidad
  And no se llama a Google

Scenario: OWNER aprueba con Google libre
  Given permisos, asignación y scopes válidos
  When el OWNER aprueba y FreeBusy no contiene ocupación externa
  Then se fija INSERTING antes de insertar
  And se crea exactamente un evento private/opaque sin asistentes ni PII
  And cita, relación externa y estado CONFIRMED se persisten atómicamente

Scenario: respuesta de inserción perdida
  Given una operación INSERTING con identidad inmutable
  When el retry recibe una respuesta ambigua
  Then consulta Events.get y nunca ejecuta un segundo insert

Scenario: caducidad, rechazo o reserva compiten con aprobación
  Given operaciones concurrentes sobre el mismo artista e intervalo
  When se serializan bajo el orden de locks aprobado
  Then solo una transición adquiere autoridad
  And INSERTING nunca se libera ni se reoferta

Scenario: configuración o evento incompatibles
  Given scopes insuficientes, invalid_grant, reasignación posterior o un evento que no coincide
  When se intenta aprobar o recuperar
  Then Inkendar falla cerrado sin crear reemplazo ni afirmar confirmación
```

## Evidencia local

El reset forward-only local aplica la migración candidata. La suite pgTAP conductual cubre autorización OWNER/ARTIST/cross-tenant, rechazo idempotente y liberación, binding, scopes, leases `READY/INSERTING/FINALIZED`, fencing, preservación tras caducidad, conflictos locales, finalización única, retry y XOR de citas. Un harness con dos conexiones PostgreSQL reales fuerza ambos órdenes `APPROVE ↔ REJECT` y `READY ↔ expiry` y converge sin deadlock. Las pruebas de aplicación/adaptadores/rutas cubren DTO terminal, ausencia de filtraciones, payload Google exacto, reconciliación y ausencia de segundo insert. Esta evidencia es local y sintética: no equivale a CI ni a una operación live contra Google.
