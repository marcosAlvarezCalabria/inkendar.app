# Contrato técnico: enlace público de disponibilidad para elección libre

_Estado técnico: implementado y verificado localmente, pendiente de revisión, PR y CI. Este documento fijó el primer corte antes del código de producción; no acredita prueba live ni una reserva._

## Alcance

Como OWNER autenticado quiero emitir o rotar un enlace temporal ligado a un artista de mi estudio, un rango UTC y una duración, para que un cliente consulte huecos candidatos calculados con las reglas, ocupación Google y holds ya existentes sin acceder a una cuenta.

El enlace usa el mismo formato opaco aprobado para ofertas: 32 bytes criptográficamente aleatorios codificados como base64url canónico sin padding (43 caracteres, al menos 256 bits). El token en claro aparece solo en la respuesta de emisión/rotación y Supabase persiste únicamente su SHA-256. Existe como máximo una credencial vigente por artista; emitirla otra vez sustituye atómicamente hash y configuración e invalida el enlace anterior.

La configuración ligada al enlace es mínima e inmutable hasta la siguiente rotación: `artistProfileId`, `rangeStart`, `rangeEnd`, `durationMinutes` y `expiresAt`. El rango es positivo, futuro y de hasta 31 días; la duración es un entero de 15 a 480 minutos; la caducidad es posterior al reloj de servidor y no supera el final del rango. La consulta pública no acepta tenant, artista, rango, duración ni paginación aportados por el visitante y devuelve como máximo los 500 candidatos definidos por disponibilidad.

La emisión es `POST` same-origin y auth-bound desde `/app/owner/calendars`. Antes de devolver el token, una RPC transaccional comprueba OWNER y tenant, artista del mismo estudio, reglas presentes, asignación `writer|owner`, conexión `ACTIVE`, refresh token y scope `calendar.events.freebusy`. Un anónimo, ARTIST, artista ajeno o configuración incompatible falla cerrado sin componer secretos.

`GET /availability/:token` valida el token antes de componer `service_role`, resuelve por hash un contexto server-only y vuelve a comprobar vigencia y compatibilidad. El contexto interno contiene exclusivamente lo necesario para FreeBusy y cálculo: nombre del artista, reglas, asignación, credencial cifrada, generación de credencial y holds que solapan el rango. La aplicación descifra en servidor, consulta solo `freeBusy` y devuelve al navegador `{ expiresAt, artistDisplayName, timeZone, rangeStart, rangeEnd, durationMinutes, slots }`, donde cada slot contiene únicamente `{ startUtc, endUtc, startLocal, endLocal }`.

Token inválido, desconocido, rotado o expirado, artista/asignación/conexión incompatible y scope ausente producen el mismo `404` público. `invalid_grant` marca `REAUTH_REQUIRED` mediante CAS ligado al hash y generación vigentes y también falla cerrado; timeout, red, 429, 5xx o respuesta Google inválida producen un `503` genérico. Ninguna respuesta revela eventos, títulos, descripciones, IDs internos/de proveedor, tokens, hashes, tenant, cliente o caso.

Todas las respuestas públicas llevan `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex, nofollow` y una CSP restrictiva. No hay formulario público, `POST`, selector, hold, aprobación, evento ni notificación en este slice.

## Contrato técnico

- `FreeChoiceAvailabilityAccessRepositoryPort.rotateAccess` persiste hash y configuración solo tras autorización OWNER tenant-safe.
- `PublicFreeChoiceAvailabilityRepositoryPort.getContextByTokenHash` resuelve el contexto server-only y `markReauthRequired` aplica CAS sin aceptar un tenant del cliente.
- `createFreeChoiceAvailabilityService.issue` devuelve el token una única vez; `getPublic` reutiliza `candidateSlots`, `GoogleFreeBusyPort` y `GoogleTokenProtectorPort` y proyecta el DTO mínimo.
- La migración aditiva crea `free_choice_availability_access` con una fila por artista y RPC `SECURITY DEFINER`, `search_path = ''`, exclusivas de `service_role`; tablas y funciones no son accesibles desde `anon` o `authenticated`.
- Los intervalos conservan semántica semiabierta `[start,end)` y los holds activos/confirmados se excluyen con la misma función vigente de disponibilidad.

## Criterios de aceptación

```gherkin
Given un OWNER autenticado, un artista de su estudio y una configuración compatible de reglas, calendario y FreeBusy
When emite el enlace con rango, duración y caducidad válidos
Then Inkendar devuelve una credencial de 256 bits solo en esa respuesta
And persiste únicamente SHA-256 y la configuración acotada
And una nueva emisión invalida inmediatamente la credencial anterior
```

```gherkin
Given un anónimo, un ARTIST, un OWNER de otro tenant o un artista ajeno
When intenta emitir o rotar el enlace
Then Inkendar falla cerrado antes de exponer datos o componer secretos cuando corresponde
And Postgres rechaza transaccionalmente cualquier cruce de tenant
```

```gherkin
Given un enlace vigente con reglas, asignación y conexión compatibles
When un cliente abre /availability/:token
Then Inkendar consulta Google FreeBusy una sola vez para el rango fijado
And calcula como máximo 500 candidatos excluyendo busy y holds existentes
And devuelve solo caducidad, artista, zona, rango, duración e intervalos candidatos
And indica que son huecos orientativos sujetos a aprobación del estudio
```

```gherkin
Given un token inválido, expirado o rotado, o una configuración que perdió reglas, asignación, conexión o scope
When se consulta el enlace
Then la respuesta es el mismo 404 genérico con cabeceras defensivas
And no revela qué condición falló
```

```gherkin
Given una credencial Google revocada después de emitir el enlace
When FreeBusy responde invalid_grant
Then la conexión se marca REAUTH_REQUIRED solo si conserva la generación resuelta
And el cliente recibe una respuesta pública genérica sin token, IDs ni detalles del proveedor
```

## Fuera de alcance

No incluye elegir un slot, crear un hold u oferta, solicitar datos del cliente, aprobación OWNER, revalidación final, Google Events, cita, notificaciones, recordatorios ni pruebas live. Los candidatos no constituyen una reserva ni una promesa de disponibilidad futura.
