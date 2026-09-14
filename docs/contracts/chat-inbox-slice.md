# Contrato del slice: bandeja de conversaciones del owner

_Estado: IN_PROGRESS_

_Última actualización: 2026-09-14_

## Objetivo

Como owner de un estudio quiero leer y responder las conversaciones abiertas desde Inkendar para atender consultas sin salir del panel ni conocer el proveedor de mensajería.

## Alcance

Este slice incorpora una bandeja SSR exclusiva para `OWNER`, paginación de conversaciones, lectura incremental bajo demanda de mensajes y envío de respuestas de texto. Cada estudio se conecta manualmente mediante metadata tenant-scoped y una referencia opaca a una credencial resuelta solo en servidor.

Quedan fuera webhooks, sincronización entrante persistente, asignación automática, creación de casos desde una conversación, IA, adjuntos, notas privadas, nuevos canales, configuración autoservicio y copia local de mensajes. Chatwoot conserva conversaciones y mensajes como fuente de verdad.

## Criterios de aceptación

### Lista privada por estudio

```gherkin
Given un owner autenticado con una conexión activa de su estudio
When abre la bandeja
Then ve únicamente las conversaciones abiertas devueltas por esa conexión
And Inkendar registra solo los identificadores externos necesarios para volver a abrirlas
And la interfaz no menciona Chatwoot ni expone cuenta, token o referencia de credencial
And navega páginas de 25 elementos mediante controles anterior y siguiente

Given un owner sin conexión activa
When abre la bandeja
Then ve un estado vacío genérico que indica que la mensajería aún no está disponible
And no se carga configuración, entorno ni adaptador del proveedor de mensajería
```

### Lectura de mensajes

```gherkin
Given una conversación enlazada previamente con el estudio del owner
When el owner la abre
Then Inkendar obtiene sus mensajes de la fuente de verdad bajo demanda
And representa dirección, contenido de texto y fecha sin persistir el contenido
And la carga inicial contiene como máximo 20 mensajes
And las páginas anteriores usan un único cursor positivo `before` tratado como opaco
And nunca combinan `before` con `after` ni ofrecen de nuevo el mismo cursor

Given un identificador no enlazado o enlazado con otro estudio
When el owner intenta abrirlo
Then recibe recurso no encontrado
And no se consulta la conversación externa
```

### Respuesta idempotente

```gherkin
Given una conversación enlazada con el estudio y una respuesta válida
When el owner la envía
Then Inkendar reserva una operación con una clave opaca única del formulario
And solicita un mensaje saliente público de texto al proveedor
And solo confirma éxito cuando recibe y valida el identificador del mensaje externo

Given dos envíos o reintentos con la misma clave
When la primera operación ya terminó correctamente
Then Inkendar devuelve el resultado registrado
And no crea un segundo mensaje externo

Given que se pierde la respuesta después de iniciar la llamada externa
When el owner repite la misma clave
Then Inkendar no vuelve a enviar silenciosamente
And muestra que el resultado no pudo confirmarse y requiere actualizar la conversación
```

### Validación y errores

```gherkin
Given una respuesta vacía, con solo espacios, controles o más de 4000 caracteres
When se envía el formulario
Then se rechaza antes de consultar credenciales o llamar al proveedor
And se devuelve un error genérico sin el texto presentado

Given un timeout, aborto, respuesta HTTP fallida o payload externo inválido
When la bandeja ejecuta una operación
Then el adaptador traduce el fallo a un error estable y sanitizado
And ningún log o respuesta incluye token, referencia de credencial, mensaje completo, contacto ni payload externo
```

### Autorización, CSRF y caché

```gherkin
Given una petición anónima, ARTIST o de otro tenant
When intenta listar, leer o responder conversaciones
Then el guard OWNER y RLS deniegan el acceso
And no obtiene ni modifica metadata de conexiones, enlaces u operaciones

Given un POST sin Origin verificable, con Origin externo o Sec-Fetch-Site cross-site
When intenta enviar una respuesta
Then se rechaza antes de leer el formulario o llamar a puertos de persistencia y mensajería

Given cualquier respuesta de la bandeja
When el servidor la devuelve
Then incluye Cache-Control private, no-store
And ningún token o secreto se serializa al navegador
```

### Configuración confiable

```gherkin
Given una conexión configurada manualmente
When Inkendar la utiliza
Then Postgres contiene únicamente studio_id, cuenta externa y credential_reference
And el token se resuelve mediante un puerto server-side
And la URL base procede de configuración confiable del despliegue

Given una URL base ausente, no HTTPS, con credenciales, ruta, query o fragmento
When se compone el adaptador
Then la configuración falla cerrada antes de realizar una petición
```

## Diseño técnico

### Contratos externos verificados

El adaptador usa la Application API documentada oficialmente por Chatwoot el 14 de septiembre de 2026:

- `GET /api/v1/accounts/{account_id}/conversations?status=open&page={page}` acepta páginas enteras de 1 a 1000, devuelve hasta 25 filas en `data.payload` y el total en `data.meta.all_count`;
- `GET /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages[?before={cursor}]` devuelve lotes de hasta 20 mensajes en orden ascendente y permite recorrer solo hacia mensajes anteriores;
- `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages` recibe `content`, `message_type: outgoing`, `private: false` y `content_type: text`.

Las tres llamadas autentican mediante `api_access_token`. La documentación del POST no ofrece una clave de idempotencia; Inkendar no envía cabeceras o campos no documentados. El adaptador limita cada llamada con timeout y combina su señal con el `AbortSignal` del request.

### Límites internos

- Dominio valida identificadores y cursores positivos, páginas enteras de 1 a 1000, clave UUID y texto NFKC recortado de 1 a 4000 caracteres sin controles, preservando saltos de línea.
- Aplicación expone tres casos de uso: `listOpenConversations`, `getConversationMessages` y `sendConversationReply`. La composición del `InboxProviderPort` es lazy y solo ocurre tras encontrar una conexión activa en `MessagingRepositoryPort`.
- Infraestructura implementa la metadata y operaciones con Supabase bajo la sesión del request. `ChatwootInboxAdapter` es el único módulo que conoce rutas, cabecera y payloads externos.
- `CredentialResolverPort` recibe `credential_reference`; la implementación inicial resuelve una entrada de un mapa JSON exclusivo del entorno. La URL base procede de `INKENDAR_MESSAGING_BASE_URL` y nunca de Postgres, formularios o cabeceras del request.
- Los handlers React Router extraen siempre `studioId` del acceso OWNER, verifican same-origin antes de una mutación y no aceptan tenant, account ID o credential reference desde el navegador.

### Persistencia mínima

- `integration_connection`: `id`, `studio_id`, `external_account_id`, `credential_reference`, `status`, timestamps. Una conexión de mensajería activa por estudio.
- `conversation_link`: `id`, `studio_id`, `integration_connection_id`, `external_conversation_id`, timestamps. No guarda contacto ni mensajes.
- `outbound_message_operation`: `id`, `studio_id`, `conversation_link_id`, `idempotency_key`, `status`, `external_message_id?`, timestamps. No guarda el texto.

Las tres tablas mantienen lectura RLS exclusiva para OWNER. `anon` y `authenticated` no pueden escribir directamente ni ejecutar las RPCs de mensajería; un cliente `service_role` separado y server-only crea enlaces y operaciones mediante funciones `SECURITY DEFINER`. `claim_outbound_message_operation` valida el tuple estudio, conexión activa, conversación y clave, serializa claves repetidas con la restricción unique y bloqueo de fila, y nunca reabre un estado existente. `transition_outbound_message_operation` permite exclusivamente `PENDING` a `SUCCEEDED`, `FAILED` o `UNKNOWN`; ningún estado final puede volver a transicionar.

### Errores públicos

- `InvalidMessagingInputError`: HTTP 400 y mensaje genérico.
- `MessagingConnectionUnavailableError`: estado vacío en loader o HTTP 503 al responder.
- `ConversationNotFoundError`: HTTP 404.
- `ReplyAlreadyInProgressError`: HTTP 409.
- `ReplyOutcomeUnknownError`: HTTP 409 e indicación de actualizar antes de intentar otra respuesta.
- `MessagingProviderUnavailableError`: HTTP 502 con mensaje genérico.

## Evidencia y gates pendientes

El 14 de septiembre de 2026, las pruebas enfocadas de dominio, aplicación, adaptador Chatwoot y handlers SSR pasaron 51 casos; la subparte RPC/service-role pasó además 34 pruebas enfocadas. La validación completa `npm run check` pasó lint, typecheck, 157 pruebas y build de cliente y servidor. El código del slice está listo para revisión de integración.

El archivo `supabase/tests/chat_inbox.test.sql` contiene 44 aserciones para grants, RLS, aislamiento tenant, idempotencia y transiciones finales. El intento local terminó con `ECONNREFUSED` porque Postgres no estaba activo; no se inició Docker. El slice permanece `IN_PROGRESS` hasta verificar migración/pgTAP contra Postgres real y completar un recorrido sintético real con Chatwoot; no se usaron datos de clientes ni una conexión live.
