# Contrato del slice: conversaciones OWNER

_Estado tecnico: DONE_

_Recorrido live con Chatwoot: IN_PROGRESS_

_Ultima actualizacion: 2026-09-14_

## Objetivo

Como owner de un estudio quiero consultar y responder conversaciones desde Inkendar y vincularlas con un cliente y, opcionalmente, con uno de sus casos para conservar el contexto operativo sin abrir Chatwoot.

## Alcance

Este slice incorpora una bandeja SSR exclusiva para OWNER con paginacion explicita de conversaciones, lectura de sus mensajes publicos de texto, respuesta publica de texto y un vinculo tenant-scoped con `customer` y `tattoo_case`. Chatwoot permanece como fuente de verdad de conversaciones y mensajes; Inkendar solo persiste identificadores externos, relaciones de dominio y estado tecnico de ingesta.

El webhook acepta unicamente `message_created`, exige la firma oficial de Chatwoot y registra una recepcion idempotente sin copiar contenido. No incorpora asignacion, cambio de estado, adjuntos, notas privadas, busqueda, tiempo real en navegador, WhatsApp, booking, calendario, galeria ni acceso ARTIST.

## Criterios de aceptacion

### Bandeja, detalle y respuesta

```gherkin
Given un usuario autenticado con membresia OWNER y una conexion configurada para su estudio
When abre la bandeja de conversaciones
Then Inkendar solicita al proveedor la pagina indicada, entre 1 y 1000, con todos los estados
And muestra canal, contacto, estado, no leidos y ultima actividad normalizados
And muestra 25 elementos por pagina, el total y controles anterior/siguiente
And indica el cliente y caso vinculados cuando existen
And no expone el token, la URL del proveedor ni su payload bruto
```

```gherkin
Given una conversacion visible para la conexion del estudio
When el owner abre su detalle
Then ve en orden cronologico solo mensajes publicos de texto entrantes y salientes
And la carga inicial contiene como maximo 20 mensajes
And los lotes anteriores usan un unico cursor positivo opaco `before`
And las notas privadas, actividades y contenidos no soportados no se muestran como mensajes del cliente
```

```gherkin
Given una conversacion visible y con capacidad de respuesta
When el owner envia texto valido mediante una peticion same-origin
Then Inkendar reclama atomicamente una clave UUID antes de llamar al proveedor
And Inkendar envia un unico mensaje publico saliente a traves del puerto de conversaciones
And redirige al detalle sin incluir el texto en la URL
```

```gherkin
Given una conversacion inexistente, no respondible o un fallo del proveedor
When el owner consulta o intenta responder
Then recibe un error generico y privado
And no recibe tokens, payloads, nombres de host ni detalles internos del proveedor
```

### Vinculo con cliente y caso

```gherkin
Given una conversacion del estudio y un cliente visible para el owner
When el owner guarda el vinculo con un caso opcional de ese mismo cliente
Then queda una sola relacion para esa conversacion dentro del estudio
And repetir exactamente la operacion converge en la misma relacion
```

```gherkin
Given un cliente o caso de otro estudio, o un caso que pertenece a otro cliente
When se intenta crear el vinculo incluso mediante una escritura privilegiada
Then las claves foraneas compuestas rechazan la relacion
And OWNER, ARTIST y anon no obtienen datos de otro tenant
```

### Webhook autenticado e idempotente

```gherkin
Given un POST con cuerpo bruto, timestamp reciente, delivery ID y firma HMAC-SHA256 validos para una conexion conocida
And un evento message_created cuyo account coincide con la conexion
When Inkendar ingiere el webhook
Then persiste una recepcion tecnica sin contenido del mensaje
And actualiza el ultimo mensaje/actividad del vinculo si la conversacion ya esta vinculada
And responde accepted
```

```gherkin
Given el mismo delivery ID autentico recibido mas de una vez para la misma conexion
When Inkendar procesa los reintentos
Then existe una sola recepcion
And la actualizacion de actividad ocurre como maximo una vez
And cada reintento valido responde duplicate sin error
```

```gherkin
Given una firma ausente o invalida, un timestamp fuera de cinco minutos, un delivery ID ausente, una conexion desconocida, un account distinto o un payload invalido
When se invoca el webhook
Then Inkendar falla cerrado antes de cualquier escritura
And no registra el cuerpo, firma ni secreto
```

### Autorizacion y privacidad

```gherkin
Given un ARTIST, una peticion anonima u otro tenant
When intenta usar la bandeja, responder o leer/escribir conversation_link
Then no obtiene ni altera conversaciones o vinculos
And las rutas OWNER mantienen Cache-Control private, no-store
```

## Contrato tecnico

### Puertos de aplicacion

- `ConversationProviderPort`: `listConversations`, `getConversation`, `sendReply`. Usa IDs externos opacos y DTOs normalizados; no menciona Chatwoot.
- `ConversationLinksRepositoryPort`: lista y guarda vinculos del estudio, comprueba cliente/caso y conserva el estado de ingesta.
- `ConversationWebhookRepositoryPort`: registra atomicamente una entrega normalizada y devuelve `ACCEPTED | DUPLICATE`.
- `ConversationOutboundRepositoryPort`: reclama y transiciona operaciones sin contenido mediante RPCs exclusivas de `service_role`.
- La composicion resuelve una conexion por `studioId` para OWNER o por `connectionId` opaco para webhook. La configuracion y los secretos solo existen en variables de entorno de servidor.

### Modelo persistente

- `conversation_link`: `id`, `studio_id`, `provider`, `external_account_id`, `external_inbox_id`, `external_conversation_id`, `customer_id`, `tattoo_case_id?`, `last_external_message_id?`, `last_activity_at?`, timestamps.
- La unicidad `(studio_id, provider, external_account_id, external_conversation_id)` hace idempotente el vinculo.
- FKs compuestas fijan estudio para cliente y caso, y el caso opcional debe pertenecer al cliente elegido.
- `conversation_webhook_receipt`: `studio_id`, `provider`, `delivery_id`, `event_name`, IDs externos y `received_at`; no almacena contenido ni payload bruto.
- La unicidad `(studio_id, provider, delivery_id)` deduplica reintentos. Una funcion transaccional exclusiva de `service_role` inserta la recepcion y actualiza el vinculo ya existente.
- La actualizacion del vinculo es monotona por fecha e ID de mensaje: una entrega autentica retrasada conserva su recepcion, pero no puede hacer retroceder la ultima actividad conocida.
- `conversation_outbound_operation` conserva cuenta/conversacion, clave UUID, estado y message ID confirmado; `PENDING` solo transiciona una vez a `SUCCEEDED`, `FAILED` o `UNKNOWN`.
- RLS de `conversation_link` concede `select`, `insert` y `update` solo a OWNER del mismo estudio; no hay `delete`. La tabla de recepciones y su RPC no conceden acceso a `anon` o `authenticated`.

### Normalizacion

- IDs de cuenta, bandeja, conversacion, mensaje y timestamps externos son enteros seguros positivos y se representan como cadenas decimales en aplicacion.
- Estados aceptados: `open`, `pending`, `resolved`, `snoozed`; cualquier otro payload del proveedor falla como no valido.
- Canales de UI aceptados: `web`, `instagram`, `facebook` y `unknown`; el adaptador reduce variantes externas sin ampliar capacidades.
- Una respuesta usa NFKC, recorte, conserva saltos internos, rechaza controles no permitidos y admite de 1 a 2.000 caracteres.
- El adaptador solo devuelve mensajes `private = false`, `content_type = text`, con tipo entrante o saliente y contenido no vacio.

### Errores publicos

- `InvalidConversationInputError`: IDs, respuesta o payload normalizado invalidos.
- `ConversationNotFoundError`: la conversacion no existe en la cuenta configurada.
- `ConversationCannotReplyError`: el proveedor declara que no puede responderse.
- `ConversationCustomerNotFoundError`, `ConversationCaseNotFoundError` y `ConversationCaseCustomerMismatchError`: relacion local invalida sin revelar otro tenant.
- `ConversationProviderUnavailableError`: fallo de red, configuracion o contrato externo; no incluye respuesta, URL ni token.
- `InvalidConversationWebhookError`: autenticacion, frescura, delivery, account, evento o cuerpo invalidos; el transporte lo traduce sin detalles sensibles.

Cada formulario lleva una clave UUID. `SUCCEEDED` reutiliza el ID confirmado sin proveedor; `PENDING`, `FAILED` y `UNKNOWN` no reenvian. `FAILED` requiere refrescar para obtener una clave nueva y `UNKNOWN` queda para intervencion manual porque Chatwoot no ofrece idempotencia documentada en esta operacion.

## Fronteras de confianza

- El navegador no es confiable: `studioId` procede exclusivamente del acceso OWNER resuelto en servidor; IDs y formularios se validan; toda mutacion de sesion exige same-origin.
- La configuracion de conexion no es publica: URL base HTTPS, account ID, token, webhook secret y connection ID se validan al componer, y una misma cuenta del mismo origen Chatwoot no puede asignarse a dos estudios; estos valores nunca se serializan al cliente ni se escriben en logs.
- Chatwoot es externo y sus respuestas son no confiables: infraestructura valida status HTTP, JSON y campos antes de normalizarlos.
- El webhook es publico y falla cerrado: acepta como maximo 256 KiB reales, se firma sobre `timestamp.raw_body`, se compara en tiempo constante, se limita a cinco minutos y exige delivery ID antes de parsear o persistir.
- La ruta webhook usa `service_role` solo despues de autenticar y normalizar el evento. Las rutas OWNER usan el cliente Supabase sujeto a cookies/RLS.
- HTML y respuestas con datos privados usan `Cache-Control: private, no-store`; no se guardan mensajes, PII, tokens, firmas ni cuerpos brutos en Postgres, URLs o memoria de agentes.

## Plan RED-GREEN-REFACTOR

1. RED de dominio/aplicacion para normalizacion, filtrado, vinculo, errores y orquestacion OWNER.
2. RED de adaptador Chatwoot y verificador HMAC con respuestas/payloads sinteticos.
3. RED de persistencia, migracion y pgTAP para tenant, FKs compuestas, RLS, RPC y deduplicacion.
4. RED de composicion, resource route webhook y UI/handlers OWNER.
5. GREEN minimo por capa; despues REFACTOR, pruebas enfocadas, `pnpm run check`, prueba DB local si Docker esta disponible y revision del diff.

## Referencias externas verificadas

- [Conversations List](https://developers.chatwoot.com/api-reference/conversations/conversations-list)
- [Conversation Details](https://developers.chatwoot.com/api-reference/conversations/conversation-details)
- [Create New Message](https://developers.chatwoot.com/api-reference/messages/create-new-message)
- [Verifying webhooks](https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks#verifying-webhooks)

Estas referencias fijan solo el contrato del adaptador de infraestructura. La spec, este contrato y los puertos internos siguen siendo la autoridad de Inkendar.

## Evidencia de cierre tecnico

El PR #9 verifico en GitHub Actions la instalacion reproducible, lint, tipos, 156 pruebas y los builds cliente/SSR. El job `database` aplico todas las migraciones sobre Supabase limpio y paso las suites pgTAP acumuladas, incluida `conversation_outbound_idempotency.test.sql`, junto con el smoke autenticado. Evidencia: [run 34883809683](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/34883809683).

Esta evidencia cierra el contrato tecnico. No se ejecuto un recorrido live de la PWA contra una conexion Chatwoot sintetica; esa validacion operativa permanece `IN_PROGRESS` y no se usaron datos de clientes.
