# Contrato técnico: notificación de rechazo de elección libre

_Estado técnico: candidato `76f5c1c` revisado en el [PR #43](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/43), que permanece abierto; `validate` y `database` pasaron en el [run 36123518176](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/36123518176). Merge y envío live permanecen pendientes._

## Necesidad y alcance

Como cliente cuya solicitud de elección libre fue rechazada por el OWNER quiero recibir un aviso durable y genérico por el canal disponible, para conocer el resultado sin que Inkendar duplique mensajes ni persista contenido o datos de contacto.

El slice extiende el outbox y runner server-only ya existentes. No añade endpoints, UI, scheduler, proveedor, recordatorios ni notificación al OWNER. El rechazo de dominio conserva su contrato actual: solo una solicitud `PENDING_OWNER_APPROVAL` vigente puede pasar a `REJECTED`, la repetición exacta converge, el hold queda liberado y Google no participa.

## Persistencia y compatibilidad

- `booking_notification_event_type` añade únicamente `REJECTED`.
- `booking_notification_job` continúa siendo el outbox común y guarda una fuente XOR: `booking_offer_id` para `CONFIRMED | EXPIRED` o `free_choice_request_id` para `REJECTED`. Nunca guarda mensaje, payload, token, asunto, destinatario ni otro contenido o PII.
- La unicidad `(studio_id, free_choice_request_id, event_type)` materializa exactamente una intención aunque el rechazo OWNER se repita. Una FK compuesta mantiene request y job dentro del mismo tenant.
- Un trigger sobre la primera transición durable de `free_choice_pending_request.status` a `REJECTED` inserta la intención dentro de la misma transacción. Reintentos que ya observan `REJECTED` no crean otra fila.
- Las filas históricas de ofertas conservan su identidad, estados y comportamiento; no hay backfill porque una notificación posterior a rechazos históricos no tendría autorización temporal ni expectativa de entrega acordada.

## Ruta, entrega y recuperación

El claim resuelve el caso desde la fuente del job y aplica sin cambios la política existente. Exactamente una `conversation_link` Chatwoot del mismo estudio, customer y caso produce `CHATWOOT` y tiene prioridad. Con cero o múltiples vínculos, un email válido del customer del mismo tenant produce `EMAIL`; la falta de email termina `NO_ROUTE`. La ausencia de configuración SMTP exacta para el estudio también transiciona el lease a `NO_ROUTE` en el proceso server-only.

El contenido se genera solo en memoria y es genérico. Chatwoot comunica que la solicitud de cita no fue aceptada y permite responder para revisar alternativas. Email usa un asunto genérico de solicitud no aceptada y permite contactar con el estudio. No contiene cliente, caso, intervalo, artista, tenant, referencias ni identificadores.

Un éxito confirmado converge a `SUCCEEDED` con el identificador externo permitido. Un rechazo confirmado de Chatwoot o SMTP pasa a `FAILED` con el mismo máximo de tres intentos y backoff acotado. Red, timeout, respuesta ambigua, fallo al persistir el éxito o lease vencido pasan a `UNKNOWN` sin reenvío automático. `NO_ROUTE`, `UNKNOWN`, `SUCCEEDED` y `FAILED` agotado conservan la terminalidad existente.

Las RPC permanecen `SECURITY DEFINER`, con `search_path = ''`, grants exclusivos de `service_role` y sin acceso directo a la tabla para `anon`, `authenticated` o `service_role`.

## Criterios de aceptación

```gherkin
Given una solicitud free-choice PENDING_OWNER_APPROVAL vigente
When el OWNER la rechaza una o más veces
Then la solicitud queda REJECTED y su hold se libera sin llamar a Google
And existe exactamente una intención durable REJECTED ligada a esa solicitud y tenant
And el outbox no contiene contenido, tokens ni datos de contacto
```

```gherkin
Given una intención REJECTED cuyo caso tiene exactamente una conversación Chatwoot tenant-safe
And el customer también tiene email
When el runner reclama el trabajo y Chatwoot confirma el mensaje
Then envía únicamente el texto genérico de rechazo por esa conversación
And marca SUCCEEDED sin consultar SMTP
And una ejecución posterior no vuelve a enviarlo
```

```gherkin
Given una intención REJECTED con cero o múltiples conversaciones Chatwoot
And existe email válido same-tenant y SMTP server-only para el estudio exacto
When SMTP acepta el mensaje genérico
Then el runner marca SUCCEEDED con un identificador opaco
And ni email, asunto ni cuerpo quedan persistidos
```

```gherkin
Given una intención REJECTED sin ruta o configuración utilizable
When el runner intenta resolverla
Then termina NO_ROUTE sin afirmar envío ni reintentar automáticamente
```

```gherkin
Given un rechazo externo confirmado, un resultado ambiguo, un fallo al persistir éxito o un lease vencido
When el runner procesa o recupera la intención REJECTED
Then solo el rechazo confirmado puede reintentarse hasta tres intentos
And cualquier ambigüedad queda UNKNOWN sin reenvío automático
```

```gherkin
Given una conversación, customer o solicitud de otro tenant
When se resuelve una intención REJECTED
Then esa relación no puede convertirse en ruta
And el sistema falla cerrado sin exponer ni enviar datos cross-tenant
```

## Plan RED–GREEN–REFACTOR

1. RED de aplicación/adaptador para evento `REJECTED` y copy genérico en Chatwoot/SMTP.
2. RED pgTAP para intención única, XOR/FK tenant-safe, prioridad Chatwoot, fallback email, `NO_ROUTE`, leases y ausencia de PII.
3. GREEN mínimo mediante migración forward-only, normalización del adaptador y copy en memoria.
4. REFACTOR con pruebas enfocadas, reset/pgTAP, gates completos y revisión de compatibilidad, secretos y cambios accidentales.


## Evidencia local y CI

El RED de aplicación/adaptador ejecutó 29 pruebas y falló exactamente en los tres comportamientos ausentes: copy Chatwoot `REJECTED`, copy SMTP `REJECTED` y normalización Supabase del evento. El RED pgTAP confirmó que faltaban el valor de enum, la fuente `free_choice_request_id` y el trigger transaccional.

Tras GREEN/REFACTOR:

- seis archivos Vitest enfocados pasan 60/60 pruebas;
- tres archivos pgTAP enfocados pasan 145/145 aserciones después de un reset limpio;
- la suite pgTAP completa pasa 948/948 aserciones;
- `pnpm run check` pasa lint, tipos, 559 pruebas Vitest más una omitida y build cliente/SSR;
- `supabase db lint --local --level warning` no encuentra errores y `supabase db diff --local` no encuentra drift.
La revisión independiente no encontró observaciones bloqueantes. La implementación `76f5c1c` fue revisada en el [PR #43](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/43), que permanece abierto; los checks requeridos `validate` y `database` concluyeron `SUCCESS` en el [run 36123518176](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/36123518176). Esta evidencia no acredita merge ni un mensaje real de Chatwoot o SMTP.

## Fuera de alcance

Notificación al OWNER, recordatorios, UI de configuración o estado, endpoint público nuevo, proveedor cron, SaaS de email, cola dedicada, backfill de rechazos históricos y pruebas live de Chatwoot o SMTP.
