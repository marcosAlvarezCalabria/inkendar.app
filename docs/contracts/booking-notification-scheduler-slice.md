# Contrato técnico: notificaciones de booking y scheduler portable

_Estado técnico: `IN_PROGRESS`. Este corte materializa y procesa avisos de confirmación y caducidad por la conversación Chatwoot original. La revisión, el PR, CI y la prueba live permanecen pendientes._

## Necesidad y alcance

Como cliente que recibió una oferta mediante una conversación quiero recibir por ese mismo canal un aviso genérico cuando la cita se confirma o la oferta caduca, para conocer el resultado sin que Inkendar duplique mensajes ni exponga datos privados.

Este slice añade una intención durable única por oferta y evento `CONFIRMED | EXPIRED`, un runner server-only invocable desde CLI o composición de servidor y una operación de scheduler que materializa ofertas vencidas antes de procesar notificaciones. Reutiliza el adaptador Chatwoot existente. No añade rutas públicas, UI, correo, rechazo, elección libre, aprobación posterior ni una decisión de proveedor cron.

## Persistencia y estados

- `booking_notification_job` guarda únicamente IDs, tipo de evento, estado técnico, intentos acotados, próximo intento, lease opaco, ID externo confirmado y timestamps. No guarda texto, payloads, tokens ni datos de contacto.
- La unicidad `(studio_id, booking_offer_id, event_type)` materializa una sola intención durable por evento, aunque la transición o el scheduler se repitan.
- Un trigger sobre la transición durable de `booking_offer.status` a `CONFIRMED` o `EXPIRED` inserta la intención en la misma transacción del dominio.
- Estados: `PENDING -> LEASED -> SUCCEEDED`; un rechazo externo confirmado pasa a `FAILED` y puede reclamarse hasta tres intentos con backoff. Una respuesta externa ambigua, un fallo al persistir un éxito o un lease vencido pasan a `UNKNOWN` y nunca se reenvían automáticamente.
- Si el caso no tiene exactamente una `conversation_link` Chatwoot del mismo tenant, el trabajo pasa a `NO_ROUTE`. Queda pendiente un futuro fallback, sin afirmar envío.
- `SUCCEEDED`, `UNKNOWN` y `NO_ROUTE` son terminales para este corte. `FAILED` agotado también deja de ser reclamable y requiere revisión.

## Scheduler y límites

El runner recibe reloj, tamaño de lote, duración de lease y presupuesto temporal. Cada valor se valida y acota; procesa como máximo 100 trabajos por invocación, con leases de 10 a 300 segundos y presupuesto de 1 a 30 segundos. Antes del envío llama una RPC global de `service_role` que materializa como máximo el lote indicado de ofertas vencidas.

La caducidad programada conserva las invariantes existentes: solo libera `OPEN` y selecciones todavía anteriores a `INSERTING`; nunca libera `INSERTING` ni `CONFIRMED`. Usa locks por fila con `SKIP LOCKED`, actualiza opción y oferta atómicamente y el trigger materializa la notificación `EXPIRED` exactamente una vez.

Solo RPCs `SECURITY DEFINER`, `search_path = ''` y grants exclusivos de `service_role` pueden materializar expiraciones, reclamar leases o transicionar trabajos. Las tablas no conceden acceso directo a `anon`, `authenticated` ni `service_role`.

## Resolución y envío

El claim resuelve la ruta dentro de Postgres por `booking_offer.tattoo_case_id`: exige exactamente un vínculo `conversation_link` con igual `studio_id`, proveedor `chatwoot` y cuenta/conversación válidas. El runner vuelve a comprobar que la conexión de entorno pertenece al mismo estudio y account antes de construir el adaptador.

El mensaje se genera únicamente en memoria y es genérico:

- confirmación: comunica que la cita está confirmada y permite responder a la conversación;
- caducidad: comunica que la propuesta expiró y permite pedir nuevas opciones.

No incluye nombre, fecha, hora, artista, caso, referencias ni identificadores. Los errores y la salida CLI contienen solo estado, contadores y códigos estables.

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
When el runner obtiene el lease y Chatwoot confirma el mensaje
Then envía un texto genérico por esa conversación y marca SUCCEEDED con el ID externo
And una ejecución posterior no vuelve a enviarlo
```

```gherkin
Given una respuesta externa ambigua o un crash con lease vencido
When vuelve a ejecutarse el runner
Then el trabajo queda UNKNOWN para revisión
And Chatwoot no recibe un reenvío automático
```

```gherkin
Given cero, dos o más conversaciones vinculadas al caso, o una conexión que no coincide con el tenant y account reclamados
When el runner intenta resolver el aviso
Then conserva NO_ROUTE o falla cerrado antes del envío
And no afirma que la notificación fue enviada
```

## Plan RED–GREEN–REFACTOR

1. RED de aplicación para límites, mensajes en memoria, éxito convergente, reintento confirmado, ambigüedad y `NO_ROUTE`.
2. RED de infraestructura/CLI para RPCs, configuración server-only, lotes y errores sin contenido.
3. RED pgTAP para intención única, aislamiento tenant, grants, leases, rutas y expiración segura.
4. GREEN mínimo por capas y migración; después REFACTOR, pruebas enfocadas, reset/test de DB si está disponible, `pnpm run check`, revisión de diff y secretos.

## Evidencia local

El RED quedó demostrado por 12 fallos de aplicación y el módulo Supabase ausente, seguido por pgTAP fallando al no existir `booking_notification_job`. Tras GREEN/REFACTOR pasan 27 pruebas enfocadas de aplicación, adaptador y CLI, y 41 aserciones pgTAP del slice.

La base local se reconstruyó desde cero. La suite acumulada pasó 483 aserciones pgTAP; `pnpm run check` pasó lint, tipos, 341 pruebas Vitest más una integración omitida y build cliente/SSR. `supabase db lint --local --level warning` no encontró errores. La máquina local usa Node 25.2.0 y emite el warning de engine; CI debe repetir el gate con Node 24.

Revisión independiente, PR, CI y prueba live siguen pendientes; esta evidencia no acredita un mensaje real de Chatwoot.

## Fuera de alcance

Correo de respaldo, elección o configuración de fallback, recordatorios, rechazos, Facebook live, UI, endpoint público, proveedor de cron, cola dedicada y prueba live de notificaciones. La capacidad global de booking permanece `IN_PROGRESS` hasta revisión, CI y recorrido operativo.
