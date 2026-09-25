# Contrato técnico: notificaciones de booking, fallback email y scheduler portable

_Estado técnico: `DONE` en código integrado. Scheduler Chatwoot y fallback SMTP quedaron integrados mediante los PR #23 y #24 con CI verde; la prueba live de notificaciones permanece pendiente._

## Necesidad y alcance

Como cliente quiero recibir un aviso genérico cuando la cita se confirma o la oferta caduca, preferentemente por la conversación Chatwoot original y, si no existe una única ruta válida, por el email registrado, para conocer el resultado sin que Inkendar duplique mensajes ni exponga datos privados.

El slice conserva una intención durable única por oferta y evento `CONFIRMED | EXPIRED`, el runner server-only invocable desde CLI o composición de servidor y la operación que materializa ofertas vencidas antes de procesar notificaciones. Reutiliza el adaptador Chatwoot y añade un puerto de email en aplicación con un adaptador SMTP portable. No añade rutas públicas, UI, rechazo, elección libre, aprobación posterior ni una decisión de proveedor cron.

La extensión posterior para solicitudes free-choice `REJECTED` reutiliza este outbox y su política conservadora sin cambiar el alcance histórico de este slice. Su contrato y evidencia viven en [Notificación de rechazo de elección libre](./free-choice-rejection-notification-slice.md).

## Persistencia y estados

- `booking_notification_job` guarda únicamente IDs, tipo de evento, estado técnico, intentos acotados, próximo intento, lease opaco, ID externo confirmado y timestamps. No guarda texto, payloads, tokens ni datos de contacto.
- La unicidad `(studio_id, booking_offer_id, event_type)` materializa una sola intención durable por evento, aunque la transición o el scheduler se repitan.
- Un trigger sobre la transición durable de `booking_offer.status` a `CONFIRMED` o `EXPIRED` inserta la intención en la misma transacción del dominio.
- Estados: `PENDING -> LEASED -> SUCCEEDED`; un rechazo externo confirmado pasa a `FAILED` y puede reclamarse hasta tres intentos con backoff. Una respuesta externa ambigua, un fallo al persistir un éxito o un lease vencido pasan a `UNKNOWN` y nunca se reenvían automáticamente.
- Si el caso no tiene exactamente una `conversation_link` Chatwoot del mismo tenant, el claim obtiene en memoria el email válido del customer del mismo estudio. Si falta el email o la configuración SMTP de ese estudio, el trabajo pasa a `NO_ROUTE` sin afirmar envío.
- `SUCCEEDED`, `UNKNOWN` y `NO_ROUTE` son terminales para este corte. `FAILED` agotado también deja de ser reclamable y requiere revisión.

## Scheduler y límites

El runner recibe reloj, tamaño de lote, duración de lease y presupuesto temporal. Cada valor se valida y acota; procesa como máximo 100 trabajos por invocación, con leases de 10 a 300 segundos y presupuesto de 1 a 30 segundos. Antes del envío llama una RPC global de `service_role` que materializa como máximo el lote indicado de ofertas vencidas.

La caducidad programada conserva las invariantes existentes: solo libera `OPEN` y selecciones todavía anteriores a `INSERTING`; nunca libera `INSERTING` ni `CONFIRMED`. Usa locks por fila con `SKIP LOCKED`, actualiza opción y oferta atómicamente y el trigger materializa la notificación `EXPIRED` exactamente una vez.

Solo RPCs `SECURITY DEFINER`, `search_path = ''` y grants exclusivos de `service_role` pueden materializar expiraciones, reclamar leases o transicionar trabajos. Las tablas no conceden acceso directo a `anon`, `authenticated` ni `service_role`.

## Resolución y envío

El claim resuelve la ruta dentro de Postgres por `booking_offer.tattoo_case_id`. Exactamente un vínculo `conversation_link` con igual `studio_id`, customer, proveedor `chatwoot` y cuenta/conversación válidas produce una ruta `CHATWOOT`, aunque exista email. Con cero o múltiples vínculos, solo un email válido obtenido mediante `offer → tattoo_case → customer` del mismo tenant produce una ruta `EMAIL`. El email se devuelve al proceso server-only únicamente mientras dura el lease y nunca se copia al job.

El runner vuelve a comprobar estudio y account Chatwoot contra `INKENDAR_CHATWOOT_CONNECTIONS_JSON`. Para email resuelve el estudio exacto en `INKENDAR_SMTP_CONNECTIONS_JSON`, cuyo JSON server-only contiene `studioId`, `host`, `port`, `secure`, `from`, `user` y `pass`. La configuración exige SMTP autenticado y TLS —TLS directo cuando `secure=true`, STARTTLS obligatorio cuando es `false`—, timeouts acotados y TLS 1.2 mínimo. Credenciales y valores de configuración no aparecen en errores.

Asunto y cuerpo se generan únicamente en memoria y son genéricos:

- confirmación: comunica que la cita está confirmada y permite responder por Chatwoot o contactar con el estudio por email;
- caducidad: comunica que la propuesta expiró y permite pedir nuevas opciones por el canal elegido.

No incluye nombre, fecha, hora, artista, caso, referencias ni identificadores. Los errores y la salida CLI contienen solo estado, contadores y códigos estables.

Una aceptación SMTP confirmada guarda únicamente un hash SHA-256 opaco del identificador del mensaje con prefijo `smtp_`. Un rechazo SMTP con respuesta recibida pasa a `FAILED` con el backoff y máximo existentes. Red, timeout, respuesta ambigua o fallo al persistir un éxito pasan a `UNKNOWN` sin reenvío automático.

## Criterios de aceptación

```gherkin
Given una oferta que finaliza por primera vez como CONFIRMED
When la misma finalización se reintenta o reconcilia
Then existe exactamente una intención CONFIRMED para esa oferta
And no se persiste el texto ni un payload de Chatwoot
```

```gherkin
Given una oferta OPEN vencida y otra selección cuya operación está INSERTING
When el scheduler materializa expiraciones una o varias veces
Then la oferta OPEN queda EXPIRED y sus opciones RELEASED una sola vez
And la selección INSERTING y las ofertas CONFIRMED permanecen intactas
And existe exactamente una intención EXPIRED para la oferta realmente caducada
```

```gherkin
Given una intención reclamable cuyo caso tiene exactamente una conversación Chatwoot del mismo estudio
And el customer también tiene email
When el runner obtiene el lease y Chatwoot confirma el mensaje
Then envía un texto genérico por esa conversación y marca SUCCEEDED con el ID externo
And no consulta ni usa el transporte SMTP
And una ejecución posterior no vuelve a enviarlo
```

```gherkin
Given cero o múltiples conversaciones Chatwoot y un email válido del customer del mismo estudio
And existe configuración SMTP válida para ese estudio
When el runner obtiene el lease y SMTP acepta el mensaje
Then envía asunto y cuerpo genéricos por email
And marca SUCCEEDED con un identificador externo opaco y no sensible
```

```gherkin
Given cero o múltiples conversaciones Chatwoot
And falta el email del customer o la configuración SMTP del estudio
When el runner resuelve la intención
Then termina NO_ROUTE sin envío ni reintento
And un NO_ROUTE histórico no se reabre automáticamente si la configuración cambia
```

```gherkin
Given una respuesta externa ambigua, un fallo al persistir éxito o un crash con lease vencido
When vuelve a ejecutarse el runner
Then el trabajo queda UNKNOWN para revisión
And ningún canal recibe un reenvío automático
```

```gherkin
Given una conexión que no coincide con el tenant y account reclamados
When el runner intenta resolver el aviso
Then falla cerrado antes del envío
And no afirma que la notificación fue enviada
```

## Plan RED–GREEN–REFACTOR

1. RED de aplicación para límites, mensajes en memoria, éxito convergente, reintento confirmado, ambigüedad y `NO_ROUTE`.
2. RED de infraestructura/CLI para RPCs, configuración server-only, lotes y errores sin contenido.
3. RED pgTAP para intención única, aislamiento tenant, grants, leases, rutas y expiración segura.
4. GREEN mínimo por capas y migración; después REFACTOR, pruebas enfocadas, reset/test de DB si está disponible, `pnpm run check`, revisión de diff y secretos.

## Evidencia local

El scheduler base quedó integrado en `main` mediante el PR #23 y el merge `91d5d7def666c4da5dfbb0a561ea0af2f68cb75a`; sus checks pasaron, sin prueba live.

Para el fallback email, el RED quedó demostrado por 11 fallos de aplicación, el módulo SMTP ausente, dos fallos de normalización Supabase y pgTAP abortando porque `delivery_channel` no existía. Tras GREEN/REFACTOR pasan 49 pruebas enfocadas y 53 aserciones pgTAP del slice después de reconstruir la base local.

La suite acumulada pasó 495 aserciones pgTAP. `pnpm run check` pasó lint, tipos, 366 pruebas Vitest más una integración omitida y build cliente/SSR. `supabase db lint --local --level warning` no encontró errores y `supabase db diff --local` no encontró drift. El PR #24 integró el fallback y GitHub Actions repitió los gates con Node 24.

La prueba live sigue pendiente; la evidencia local y CI no acredita un mensaje real de Chatwoot ni SMTP.

## Fuera de alcance

Este slice original no incluyó rechazos. Elección de un SaaS de email, UI de configuración, recordatorios, Facebook live, endpoint público, proveedor de cron, cola dedicada y prueba live de notificaciones permanecen fuera. La extensión posterior de rechazo free-choice está verificada solo localmente y la capacidad global de booking permanece `IN_PROGRESS` hasta revisión, CI y recorrido operativo.
