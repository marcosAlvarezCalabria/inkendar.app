# Contrato técnico: conexión Google OAuth y calendarios por artista

_Estado técnico: `IN_PROGRESS` hasta que el agente de integración verifique CI. El recorrido con una cuenta Google real permanece `CONNECTED` o `IN_PROGRESS` hasta disponer de credenciales y evidencia live._

## Necesidad y alcance

Como owner autenticado quiero conectar la cuenta Google operativa del estudio, consultar sus calendarios accesibles y asignar uno a cada artista para preparar los slices posteriores de disponibilidad y booking.

Este slice incluye Authorization Code procesado por servidor, estado OAuth de un solo uso, persistencia cifrada del refresh token, listado en vivo de `CalendarList` y asignación o desasignación por artista. No consulta `freeBusy`, no lee títulos ni descripciones de eventos, no crea eventos y no implementa booking ni notificaciones.

## Criterios de aceptación

- Dado un OWNER autenticado, cuando inicia la conexión desde `/app/owner/calendars`, entonces el servidor crea un `state` aleatorio ligado a `studioId` y `userId`, con diez minutos de vida y un único consumo, y redirige exclusivamente al endpoint de autorización de Google.
- Dado un usuario ARTIST o anónimo, cuando intenta iniciar, completar o gestionar la integración, entonces el guard existente falla cerrado antes de componer OAuth, `service_role` o secretos.
- Dado un callback en `/auth/google/callback`, cuando `state` falta, ha expirado, ya se consumió, pertenece a otro usuario o estudio, Google devuelve un error, o falta `code`, entonces no se intercambian tokens y se vuelve al panel con un código de resultado seguro.
- Dado un callback válido, cuando Google entrega un refresh token y el scope requerido, entonces el servidor cifra el token con AEAD y una clave independiente, activa la conexión del estudio y no serializa ni registra credenciales.
- Dada una conexión activa, cuando el owner abre el panel, entonces se consultan los calendarios directamente a Google y solo se presentan identificador, nombre, zona horaria, rol de acceso y marca de calendario principal.
- Dado un artista del estudio y un calendario actualmente accesible mediante esa conexión, cuando el owner guarda la selección, entonces queda exactamente una asignación. Puede cambiarla o retirarla. Una relación cross-tenant o con una conexión inactiva se rechaza también en Postgres.
- Dado que faltan variables Google, cuando se visita una ruta ajena a calendarios, entonces la aplicación continúa funcionando; la configuración solo se valida después del guard OWNER al componer este módulo.

## Contratos HTTP y UI

- `GET /app/owner/calendars`: loader SSR privado. Devuelve estado de conexión, calendarios accesibles y artistas con su asignación. Los errores del proveedor se traducen a mensajes seguros y `Cache-Control: private, no-store`.
- `POST /app/owner/calendars`: mutación same-origin con `intent=connect|disconnect|assign`. `connect` inicia OAuth; `disconnect` intenta revocar el refresh token y siempre retira localmente credenciales y asignaciones; `assign` recibe `artistProfileId` y `calendarId`, donde `calendarId` vacío desasigna.
- `GET /auth/google/callback`: callback registrado. Exige una sesión OWNER coherente, consume `state` antes del exchange y redirige solo a `/app/owner/calendars?result=<valor permitido>`.

Los orígenes canónicos son `http://127.0.0.1:3000` en desarrollo y `https://app.inkendar.es` en producción. `GOOGLE_OAUTH_REDIRECT_URI` debe ser exactamente uno de:

- `http://127.0.0.1:3000/auth/google/callback`
- `https://app.inkendar.es/auth/google/callback`

No se deriva el redirect de `Host` ni de cabeceras de proxy.

## OAuth, scopes y recuperación

Se solicita acceso offline con autorización incremental (`include_granted_scopes=true`) y únicamente `https://www.googleapis.com/auth/calendar.calendarlist.readonly` en este slice. Es el scope específico que autoriza `CalendarList.list`; no concede lectura de eventos. Los slices que realmente consulten ocupación o escriban citas pedirán en contexto `https://www.googleapis.com/auth/calendar.events.freebusy` y `https://www.googleapis.com/auth/calendar.events`, respectivamente. No se solicitan identidad, email, perfil, contactos ni el scope global `calendar`.

Google documenta PKCE S256 para aplicaciones instaladas, pero su contrato oficial vigente de aplicaciones web de servidor no admite `code_challenge` ni `code_verifier` entre los parámetros publicados. Este cliente web confidencial usa client secret solo en servidor y no inventa una extensión no documentada; el contrato se revisará si Google incorpora PKCE al flujo web server.

El inicio usa `access_type=offline`, `prompt=consent` y autorización incremental para recuperar un refresh token incluso al reconectar. `writerWithoutPrivateAccess`, `writer` y `owner` son los roles oficiales de `CalendarList` que permiten escribir y por tanto asignar el calendario; los roles de solo lectura se muestran como metadata pero no se pueden asignar.

Solo `invalid_grant` recibido al refrescar el access token aporta evidencia de credencial inválida y cambia la conexión a `REAUTH_REQUIRED`. Ese estado conserva el refresh token cifrado y las asignaciones existentes, pero bloquea listado y cambios hasta reconectar. Una caída, límite o respuesta inválida del proveedor devuelve un error seguro sin mutar la conexión ni las asignaciones. La reconexión sustituye de forma atómica el token cifrado y conserva las selecciones. La desconexión explícita intenta revocar cualquier token retenido, incluso en `REAUTH_REQUIRED`, y después elimina siempre credenciales y asignaciones locales.

Fuentes oficiales consultadas:

- [OAuth 2.0 para aplicaciones web de servidor](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Scopes de Google Calendar](https://developers.google.com/workspace/calendar/api/auth)
- [CalendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)
- [PKCE S256 documentado para aplicaciones instaladas](https://developers.google.com/identity/protocols/oauth2/native-app)

## Persistencia y límites de confianza

`google_oauth_attempt` guarda únicamente el hash SHA-256 del state, tenant, usuario, expiración y consumo. `google_calendar_connection` contiene estado mínimo (`ACTIVE`, `REAUTH_REQUIRED`, `DISCONNECTED`), scopes concedidos y refresh token cifrado en formato versionado con AES-256-GCM; la clave `GOOGLE_TOKEN_ENCRYPTION_KEY` es Base64 estándar canónico con padding, que decodifica exactamente 32 bytes y nunca se persiste. `artist_calendar_assignment` referencia por claves compuestas al artista y a la conexión del mismo estudio y mantiene una fila por artista.

Las tres tablas tienen RLS habilitada y no conceden acceso a `anon` ni `authenticated`. Las operaciones sensibles pasan por un cliente de servidor con `service_role` compuesto solo tras autorización OWNER. Las RPC mutadoras son `SECURITY DEFINER`, fijan `search_path = ''`, comprueban tenant, conexión activa y artista, revocan `public`, `anon` y `authenticated`, y conceden únicamente `service_role`.

Variables de servidor:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`

## Evidencia y gates

La implementación debe conservar evidencia RED previa y cubrir dominio/aplicación, OAuth/AEAD, adaptador Supabase, handlers/UI y pgTAP. El agente de implementación ejecuta pruebas enfocadas y `pnpm run check`; intenta Supabase local si está disponible. Solo el agente de integración puede marcar el contrato `DONE` tras migración limpia, pgTAP y CI verdes. Ninguna prueba sintética acredita una conexión Google live.
