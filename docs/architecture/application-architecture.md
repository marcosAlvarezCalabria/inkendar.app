# Arquitectura de aplicación de Inkendar

_Estado: aceptada_

_Última actualización: 2026-09-17_

_La fuente de verdad del comportamiento y el alcance es [Especificación de Inkendar](../product/sellable-mvp-spec.md). Este documento explica cómo construirlo y debe actualizarse cuando cambie una frontera, dependencia o decisión técnica._

## 1. Decisión

Construir Inkendar como una **PWA sobre un monolito modular TypeScript**, con una sola aplicación operativa y límites internos explícitos. Utilizar Supabase Cloud como plataforma gestionada de datos, autenticación y archivos. La PWA y su backend viven en este repositorio. La landing comercial permanece en `marcosAlvarezCalabria/inkendar` y no participa en el flujo de datos de estudios.

```text
Landing Inkendar                   Plataforma Inkendar
marketing independiente            app.inkendar.es
sin datos de estudios              PWA React + TypeScript
                                            │
                                         API/BFF
                                            │
                      ┌─────────────────────┼────────────────────┐
                      │                     │                    │
                 Supabase               Chatwoot          Google Calendar
              dominio y archivos       mensajería        huecos y eventos
                      │
              Public Content API
                      │
          ┌───────────┴───────────┐
          │                       │
  Web creada por Incamdi   Web existente del estudio
```

La PWA no llamará directamente a Chatwoot ni a Google. El backend de Inkendar validará permisos, ejecutará los casos de uso y ocultará tokens y contratos de terceros. Las lecturas directas desde Supabase solo se admitirán cuando RLS garantice el mismo contrato de autorización.

### Base técnica ejecutable

La primera base utiliza:

- React Router 8 en modo framework para renderizado de servidor, rutas de UI y futuros resource routes del API/BFF;
- el servidor Node oficial de React Router como adaptador inicial portable;
- React 19 y TypeScript 6;
- pnpm workspaces para `apps/inkendar` y los paquetes internos;
- Node.js 24 LTS en CI, con compatibilidad declarada para la última línea 22.22.x de mantenimiento;
- Vitest para TDD y una prueba de arquitectura que comprueba el grafo de dependencias declarado por los workspaces.

El manifiesto web establece la base instalable. El service worker y la política de caché se implementarán con el primer slice PWA que pueda probar qué recursos son públicos y cuáles contienen datos privados.

### Base de identidad y aislamiento

El primer slice de persistencia utiliza Supabase CLI 2.117.0 fijada en el proyecto, migraciones SQL versionadas y datos sintéticos. `auth.users` conserva la identidad autenticada; `studio` es la raíz de cada tenant, y `user_profile`, `membership` y `artist_profile` incluyen `studio_id` con claves compuestas que impiden relacionar filas de estudios distintos y que ligan cada membership a la identidad exacta de su user profile.

`membership_role` admite exclusivamente `OWNER` y `ARTIST`. El alta inicial del estudio pertenece al proceso operado con credenciales de servicio: un usuario autenticado no puede crear un tenant antes de tener una membresía owner. El owner administra únicamente las filas de su estudio. El artista solo consulta su propia membresía y perfiles cuando conserva una membresía `ARTIST` activa; no recibe escrituras ni acceso al registro del estudio.

Las políticas resuelven el rol mediante funciones `SECURITY DEFINER` en el schema no expuesto `private`. Las funciones fijan `search_path = ''`, cualifican objetos, exponen únicamente ejecución a `authenticated` y se evalúan con el `studio_id` de cada fila. Esto evita tanto la recursión sobre `membership` como la reutilización de una autorización entre tenants.

La prueba de aceptación vive en `supabase/tests/identity_rls.test.sql` y cambia a los roles reales `authenticated` y `anon` sobre Postgres. Sus 38 aserciones pasaron contra Supabase/Postgres real en GitHub Actions; la indisponibilidad del daemon Docker local no bloquea esta evidencia reproducible.

### Alta manual gestionada

La provisión inicial se ejecuta desde un CLI de servidor operado por Incamdi. El CLI ofrece únicamente `create-studio-owner` y `add-artist`, obtiene contraseña y credenciales de servicio desde el entorno y no acepta un rol. No existe endpoint público para estas operaciones.

La aplicación depende de `IdentityAdminPort` y `OnboardingRepositoryPort`. El adaptador de infraestructura usa Supabase Auth Admin para crear una identidad confirmada y después invoca una función Postgres transaccional. Las funciones SQL fijan `OWNER` o `ARTIST`, usan `search_path` vacío y solo conceden ejecución a `service_role`; la entrada de artista contiene un UUID validado y la función exige que el estudio exista.

Auth y Postgres no comparten una transacción. Las RPC serializan por identidad y son idempotentes para el mismo payload: un reintento devuelve los IDs ya persistidos. El adaptador reintenta una vez si pierde la respuesta; si el resultado sigue siendo ambiguo, conserva Auth y devuelve `ProvisioningOutcomeUnknownError` con el identificador técnico necesario para intervención. Solo elimina la identidad recién creada ante un fallo confirmado de Postgres; si esa compensación falla, devuelve `ProvisioningCompensationFailedError`. Ningún error incluye contraseña, token, email ni respuesta del proveedor.

Este módulo provisiona identidades y filas coherentes, pero no implementa login, sesión, recuperación de contraseña, invitaciones ni UI de autenticación.

### Acceso autenticado a la PWA

React Router compone un adaptador por petición con `@supabase/ssr`, clave pública y cookies HTTP. Aplicación depende de puertos de sesión y lectura de membership; infraestructura usa `auth.getUser()` y consulta perfiles con el mismo cliente sujeto a RLS. Dominio acepta únicamente una membership coherente con identidad, tenant y perfiles. Los loaders protegen cada shell, devuelven `private, no-store` y no serializan tokens ni la membership completa. `service_role` se limita al alta manual y a la prueba de integración aislada.

### Clientes y casos de tatuaje

El panel SSR del owner ofrece listas y formularios para customer y tattoo_case. Los handlers obtienen studioId del acceso OWNER resuelto en servidor, validan same-origin antes de leer mutaciones y devuelven Cache-Control: private, no-store. No existe endpoint público ni acceso del artista a estos datos.

Aplicación depende de CustomerCasesRepositoryPort; infraestructura adapta Supabase/PostgREST con la sesión del request. customer y tattoo_case incluyen studio_id, RLS exclusiva de OWNER y relaciones compuestas que impiden vincular un caso con cliente o artista de otro estudio incluso mediante una escritura privilegiada.

El modelo evita borrado y workflows anticipados: clientes usan ACTIVE / ARCHIVED, casos OPEN / ARCHIVED, y la asignación de artista es opcional. Referencias, archivos, calendario, booking y notificaciones permanecen fuera del slice.

### Conversaciones OWNER

_Estado tecnico del slice: `DONE`. GitHub Actions verifico 156 pruebas, build, migraciones limpias y pgTAP en el run 34883809683. El recorrido live de la PWA con Chatwoot permanece `IN_PROGRESS`._

La bandeja SSR OWNER resuelve la conexion por `studioId` despues del guard. Si el estudio no tiene conexion devuelve una pagina vacia `private, no-store` sin cargar proveedor, credenciales ni `service_role`. Las conversaciones recorren paginas 1..1000 de 25 filas con `all_count`; el detalle carga hasta 20 mensajes publicos de texto y usa un cursor positivo `before`.

Supabase conserva `conversation_link` para customer/tattoo_case, `conversation_webhook_receipt` para entregas firmadas y `conversation_outbound_operation` sin contenido para idempotencia. Las RPC outbound son exclusivas de `service_role`, se componen lazy tras OWNER y serializan una clave UUID: `SUCCEEDED` reutiliza el resultado, `PENDING` bloquea concurrencia y `FAILED`/`UNKNOWN` son finales. Un reintento consciente despues de `FAILED` usa una clave nueva; `UNKNOWN` requiere intervencion manual.

El webhook conserva HMAC-SHA256, frescura de cinco minutos, delivery ID, limite real de 256 KiB, account esperado y actualizacion monotona. RLS y FKs compuestas mantienen el vinculo tenant-safe; mensajes, secretos y payloads brutos no se persisten ni se serializan.

### Conexión Google Calendar

_Estado técnico del slice: `DONE`; OAuth, listado y asignación live pasaron localmente el 2026-09-15 con owner sintético._

El panel SSR OWNER inicia Authorization Code para aplicaciones web de servidor y recibe el callback fijo `/auth/google/callback`. El estado OAuth es aleatorio, ligado al estudio y usuario, expira y se consume una sola vez antes del exchange. La configuración, el cliente Google y `service_role` se componen de forma lazy después del guard OWNER. El redirect URI se valida contra los dos valores canónicos registrados y no se deriva de cabeceras del request.

Aplicación depende de puertos para OAuth/Calendar y persistencia; infraestructura adapta los endpoints oficiales y Supabase. El refresh token se cifra con AES-256-GCM y una clave de entorno independiente. Las tablas de intentos, conexión y asignación no conceden acceso al browser; las mutaciones privilegiadas usan RPC `SECURITY DEFINER`, `search_path` vacío y ejecución exclusiva de `service_role`.

El corte OAuth inicial pide `calendar.calendarlist.readonly` y lista metadata de calendarios sin leer eventos. El listado conserva metadata de todos los roles conocidos, pero solo `writer` y `owner` pueden asignarse porque la confirmación privada debe reconciliar sus propiedades; `writerWithoutPrivateAccess` se muestra como incompatible. Disponibilidad añade incrementalmente `calendar.events.freebusy` y confirmación añade `calendar.events`; una concesión antigua conserva asignación y selección pendiente, pero debe reconectar y volver a validar una asignación histórica sin rol probado. Una asignación referencia un único calendario por artista y exige artista, conexión activa y estudio coincidentes. La conexión mantiene una generación opaca que aumenta al reconectar; `invalid_grant` solo marca `REAUTH_REQUIRED` mediante CAS sobre la generación utilizada, conserva asignaciones y no degrada una credencial más nueva. Desconectar intenta revocar cualquier token retenido y después retira credenciales y asignaciones locales.

### Disponibilidad por artista

_Estado técnico del slice: `DONE`; el PR #12 y el CI posterior al merge verificaron código, build, migraciones limpias y pgTAP. FreeBusy live quedó verificado con datos sintéticos el 2026-09-16._

El dominio enumera los días civiles IANA que intersectan el rango UTC y resuelve folds con inicio temprano/final tardío y gaps avanzando al primer minuto válido; genera slots desde reglas y busy UTC sin depender de Google ni Supabase. Aplicación coordina ArtistAvailabilityRepositoryPort y GoogleFreeBusyPort; infraestructura implementa FreeBusy y RPC owner-bound. Las asignaciones, reglas y conexión deben pertenecer al mismo estudio; títulos y descripciones de eventos no cruzan la frontera.

### Consulta pública de elección libre

Los enlaces nuevos quedan ligados a un `tattoo_case` OPEN con artista ya asignado; la fila histórica nullable conserva enlaces anteriores solo para consulta. El navegador recibe selectores SHA-256 derivados de token e intervalo, nunca IDs ni timestamps de entrada confiados. POST reconsulta FreeBusy y materializa después una `free_choice_pending_request` bajo el mismo advisory lock estudio/artista. La solicitud `PENDING_OWNER_APPROVAL` es un hold durable e idempotente con caducidad acotada por configuración, enlace e inicio del slot. El lock evita carreras internas, pero no elimina la ventana entre FreeBusy y un evento externo; la aprobación futura debe revalidar. Casos sin artista fallan cerrado y el panel OWNER muestra solo cliente, caso, artista, intervalo y caducidad.

_Estado técnico: implementado y verificado localmente; pendiente de revisión, PR y CI. No existe prueba live ni selección/aprobación en este corte._

`FreeChoiceAvailabilityAccessRepositoryPort` rota una credencial base64url de 32 bytes por artista desde un POST OWNER same-origin; Supabase conserva solo SHA-256 junto a rango UTC, duración y caducidad acotados. La RPC de emisión exige OWNER/tenant, reglas, asignación `writer|owner`, conexión `ACTIVE`, refresh token y scope `calendar.events.freebusy`. La tabla y las tres RPC quedan sin acceso directo de `anon` o `authenticated`, con `SECURITY DEFINER`, `search_path=''` y ejecución exclusiva de `service_role`.

`GET /availability/:token` valida forma antes de componer privilegios, resuelve un contexto server-only por hash y vuelve a comprobar configuración y vigencia. Aplicación descifra solo en servidor, ejecuta una consulta FreeBusy para el rango fijado, combina la ocupación con la misma semántica vigente de holds y usa el dominio existente para producir como máximo 500 slots. El DTO público contiene únicamente caducidad, nombre del artista, zona, rango, duración e intervalos UTC/locales; tokens, hashes, tenant, IDs, eventos y detalles privados no cruzan al navegador. Token/configuración/scope/reconnect incompatibles convergen en 404 genérico, fallo transitorio de Google en 503 genérico e `invalid_grant` usa CAS por hash y generación. No hay POST público, selector, hold, oferta, cita ni notificación.

### Ofertas preaprobadas y holds

_Estado técnico del slice: `DONE`; el PR #14 y el CI posterior al merge verificaron código, build, migraciones limpias, pgTAP y Auth/RLS con datos sintéticos. Una oferta preaprobada de una opción quedó verificada dentro del recorrido live sintético del 2026-09-16._

El módulo de booking introduce `BookingOfferRepositoryPort` y un reloj inyectable en aplicación. Supabase conserva el plazo positivo por estudio —24 horas por defecto—, ofertas `OPEN | SELECTED_PENDING_CONFIRMATION | CONFIRMED | EXPIRED` y opciones `HELD | SELECTED | CONFIRMED | RELEASED`. RPCs `SECURITY DEFINER` exclusivas de `service_role` validan OWNER, tenant, caso `OPEN` y artista, y crean de una a tres opciones en una transacción serializada por estudio/artista para rechazar intervalos solapados, incluida una selección pendiente o cita confirmada.

La disponibilidad carga mediante RPC los holds `HELD` de ofertas `OPEN`, el único `SELECTED` pendiente mientras esté vigente o su operación permanezca `INSERTING`, y la opción histórica de una cita `CONFIRMED`, y los combina con `freeBusy`. La exclusión confirmada es conservadora e inmutable, no una agenda editable duplicada; `appointment` referencia la opción y no copia el intervalo. La expiración materializa de forma atómica e idempotente los estados provisionales `OPEN` o `READY`, pero nunca libera `INSERTING` ni altera confirmadas. Antes de decidir que un intervalo vencido está libre, `create_booking_offer` conserva su advisory lock por estudio/artista y materializa esas expiraciones bajo locks `offer → operation` ordenados por oferta; así serializa una creación posterior con `beginInsert` incluso si este esperaba con un `p_now` anterior. El panel SSR OWNER usa mutaciones same-origin; la selección y aprobación de elección libre, notificaciones y scheduler permanecen fuera.

### Acceso y selección pública de ofertas

_Estado técnico del acceso de solo lectura y de la selección: `DONE`; los PR #16 y #18 y sus CI posteriores al merge verificaron código, build, migraciones limpias, pgTAP y Auth/RLS con datos sintéticos. La emisión del enlace y la selección pública quedaron verificadas dentro del recorrido live sintético del 2026-09-16._

El OWNER emite o rota mediante `POST` same-origin una credencial base64url de 32 bytes para una oferta `OPEN` vigente de su tenant. Aplicación recibe reloj, aleatoriedad y SHA-256 por dependencias; solo el hash llega a una tabla tenant-safe inaccesible al browser. RPCs `SECURITY DEFINER`, con `search_path` vacío y ejecución exclusiva de `service_role`, rotan el hash bajo autorización OWNER y resuelven una vista pública mínima. `/offers/:token` compone persistencia solo tras validar formas canónicas y conserva no-store/no-referrer, errores uniformes y ausencia de redirects.

Cada opción usa un UUID v4 público separado de su ID. El GET abierto entrega ese selector y el intervalo; el POST same-origin acepta exclusivamente un selector o, para una selección ya pendiente, `intent=confirm`. La RPC de selección bloquea la oferta resuelta por hash: la primera elección conserva una opción `SELECTED`, libera las alternativas y mueve la oferta a `SELECTED_PENDING_CONFIRMATION`; la misma elección es idempotente y una competidora no sustituye a la ganadora. El GET posterior expone solo el intervalo elegido como `SELECTION_PENDING_CONFIRMATION`, o `CONFIRMED` únicamente después de reconciliación y finalización reales. Notificaciones permanecen fuera.

### Confirmación recuperable con Google Events

_Estado técnico del slice: `DONE`; el PR #20 y el CI posterior al merge verificaron código, build, migraciones limpias, pgTAP y Auth/RLS con datos sintéticos. Google Events, confirmación y reconciliación live quedaron verificadas con datos sintéticos el 2026-09-16; el corte posterior de notificaciones/scheduler está `IN_PROGRESS`._

Aplicación deriva de la opción un `eventId` SHA-256/base32hex y una correlación privada separados. Una RPC de claim bloquea la oferta y, antes de crear o renovar una operación, exige la conexión fijada `ACTIVE`, token y los scopes `calendar.events.freebusy` y `calendar.events`; si falta alguno devuelve `RECONNECT_REQUIRED` sin tocar lease, estado ni binding. El claim inicial persiste antes de Google el tuple inmutable estudio/artista/oferta/opción/conexión/calendario/evento/correlación. Un lease `READY` puede recuperarse solo antes de `expires_at`; `beginInsert` bloquea primero la oferta y realiza el CAS único `READY → INSERTING`, serializado con la expiración y sin reconsultar la asignación mutable. A partir de `INSERTING`, incluso tras `expires_at`, crash o lease vencida, la selección y su exclusión permanecen recuperables y los siguientes workers reciben `RECONCILE_ONLY`: consultan `Events.get` pero nunca adquieren una segunda autoridad de insert.

Cada intento con claim consulta primero `Events.get`; solo un `404`, modo insertable, FreeBusy libre para exactamente `[start,end)` y `beginInsert` exitoso permiten insertar un evento `private`, `opaque`, sin asistentes ni PII. Una respuesta perdida se reconcilia por la identidad fijada aunque cambie la asignación del artista. Cualquier mismatch, payload inválido o ambigüedad no resuelta mantiene la selección pendiente y nunca reemplaza el evento; `invalid_grant` marca `REAUTH_REQUIRED` solo si coincide la generación de credencial usada.

Supabase finaliza en una sola RPC serializada y tenant-safe: crea una `appointment` única y su relación `appointment_google_event`, y mueve oferta/opción a `CONFIRMED`. Los retries exactos devuelven el instante original; una relación distinta falla cerrada. Las tablas tienen RLS sin acceso directo y las RPCs son `SECURITY DEFINER`, `search_path=''`, exclusivas de `service_role`. La UI pública solo afirma «Cita confirmada» tras leer ese estado persistido.

La evidencia live sintética del 2026-09-16 recorrió una oferta preaprobada de una opción hasta `CONFIRMED`. Google conservó exactamente un evento correlacionado `private`, `opaque`, sin asistentes y con resumen genérico; el reintento `RECONCILE_ONLY` mantuvo el mismo único evento. La persistencia terminó con oferta/opción `CONFIRMED`, una cita, una relación Google y la operación `FINALIZED`. Esta evidencia valida el recorrido ejercitado y su idempotencia observable, no notificaciones, scheduler, elección libre, aprobación posterior, edición ni cancelación.

### Notificaciones de booking y scheduler portable

_Estado técnico: scheduler Chatwoot y fallback SMTP integrados mediante los PR #23 y #24 con CI verde; la prueba live de notificaciones permanece pendiente._

Un trigger transaccional sobre `booking_offer` materializa una sola `booking_notification_job` por oferta y evento `CONFIRMED | EXPIRED`. La tabla guarda IDs, estado, intentos, lease e ID externo confirmado; nunca texto, payloads, tokens ni datos de contacto. Una RPC global de `service_role` caduca como máximo 100 ofertas por invocación con `FOR UPDATE SKIP LOCKED`, libera solo estados provisionales y preserva `INSERTING` y `CONFIRMED`.

Aplicación ejecuta lotes de 1 a 100 con lease y presupuesto temporal acotados. El claim prefiere exactamente una `conversation_link` Chatwoot ligada al mismo customer, `tattoo_case` y tenant. Con cero o múltiples rutas obtiene en memoria el email válido mediante relaciones compuestas tenant-safe; si falta, termina `NO_ROUTE`. No persiste email, asunto, cuerpo ni payload.

El runner verifica estudio y account contra `INKENDAR_CHATWOOT_CONNECTIONS_JSON` antes de reutilizar `ChatwootConversationAdapter`. Para el fallback depende de `BookingNotificationEmailPort`; infraestructura selecciona por estudio una conexión de `INKENDAR_SMTP_CONNECTIONS_JSON` y la adapta con Nodemailer. SMTP usa autenticación, TLS directo o STARTTLS obligatorio, TLS 1.2 mínimo y timeouts acotados. La configuración y las credenciales permanecen exclusivamente en entorno server-only.

Asunto y cuerpo genéricos existen solo durante el envío. Una aceptación SMTP se reduce a un hash opaco `smtp_` del message ID. Un éxito confirmado termina en `SUCCEEDED`; rechazos confirmados reintentan hasta tres veces, mientras red, timeout, respuesta ambigua, fallo al guardar éxito o lease vencido terminan en `UNKNOWN` sin reenvío automático. La falta de configuración SMTP del estudio se transiciona a `NO_ROUTE`, que no se reabre automáticamente.

El ejecutor se invoca con `pnpm run notifications` y no depende de un hosting cron concreto. Rechazos de booking, recordatorios, UI y elección de un SaaS de email quedan fuera.

### Agenda privada ARTIST

_Estado técnico del slice: `DONE`; el PR #25 y su CI verde integraron la implementación y las pruebas. No se ejecutó prueba live._

`/app/artist` conserva el guard SSR `ARTIST`, cookies de sesión y respuestas `private, no-store`. Aplicación depende de `ArtistAgendaRepositoryPort`, recibe un reloj inyectable y fija un máximo de 50 filas. Infraestructura usa el cliente Supabase SSR de la petición; no compone `service_role` ni consulta Google.

La RPC `get_artist_agenda` es `SECURITY DEFINER`, fija `search_path=''`, se concede solo a `authenticated` y resuelve `auth.uid()`. Exige exactamente una membership y una relación coherente ARTIST con `user_profile` y `artist_profile`; OWNER, anon, `service_role` e identidades incompletas fallan cerrado. Conserva los joins compuestos de tenant entre `appointment`, `booking_option`, `tattoo_case` y `customer`, exige cita/opción `CONFIRMED`, incluye `end_at = now`, impide retroceder el reloj mediante `greatest(p_now, now())`, ordena por inicio y limita a 50. No abre acceso general ni escritura a las tablas.

El DTO contiene solo intervalo, nombre visible del customer, resumen, body area y size opcionales y la zona IANA de `artist_availability_rule`; si aún no existe regla, muestra `UTC` explícito. La UI semántica no contiene formularios de agenda ni controles de edición, IDs, contacto, conversaciones, Google, tokens, notas, referencias o estados editables. El único formulario del shell es el `POST /logout` global para cerrar la sesión; no concede ninguna mutación de agenda. Este lector representa la cita persistida en Supabase y no sustituye ni duplica Google Calendar.

## 2. Alternativas consideradas

### A. Monolito modular TypeScript — aceptada

- Landing Astro independiente.
- PWA React con un framework full-stack TypeScript.
- API/BFF y casos de uso en el mismo producto desplegable.
- Supabase para Postgres, Auth, Storage, Realtime y migraciones.
- Adaptadores separados para Chatwoot y Google Calendar.

Es la opción recomendada porque permite entregar rápido, probar el dominio sin infraestructura distribuida y mantener una sola operación. Los módulos pueden extraerse después si el tráfico o la organización lo justifican.

### B. PWA conectada directamente a Supabase

Reduce código de backend, pero empuja reglas de negocio y coordinación entre Chatwoot, Google y la base de datos hacia el cliente o funciones dispersas. Aumenta el riesgo de exponer contratos externos y dificulta operaciones atómicas como reservar, caducar y confirmar una cita.

### C. MERN y microservicios propios

Ofrece control total, pero exige operar autenticación, permisos multi-tenant, almacenamiento, colas, backups y varios despliegues antes de validar el negocio. No aporta valor proporcional al MVP.

## 3. Forma de los repositorios

```text
Este repositorio: inkendar.app
  apps/
    inkendar/              # React Router: PWA, SSR y API/BFF
  packages/
    domain/                # núcleo; no depende de otros workspaces
    application/           # depende solo de domain
    infrastructure/        # depende de application y domain
    public-content/        # depende de application y domain
    ui/                    # depende de application y domain
  supabase/
    migrations/            # esquema versionado
    policies/              # RLS y grants comprobables
    seed/                  # datos sintéticos de desarrollo
  docs/                    # spec, arquitectura y contratos de slices

Repositorio separado: inkendar
  src/                     # landing Astro
  public/                  # recursos de marketing
  scripts/                 # validadores de landing
```

Cada repositorio tiene dependencias, CI, ramas, protección de `main` y despliegue propios. La landing no importa código del dominio ni accede a datos de estudios.
## 4. Módulos funcionales

### Identidad y estudios

Gestiona `studio`, `user`, `membership` y `artist_profile`. El MVP reconoce dos roles:

- `OWNER`: opera todo el estudio y configura integraciones.
- `ARTIST`: consulta únicamente su agenda y los datos necesarios de sus trabajos.

### Conversaciones

Presenta dentro de Inkendar las conversaciones de Chatwoot. Chatwoot permanece oculto para los usuarios del estudio y conserva mensajes y conversaciones como fuente operativa. Inkendar almacena sus identificadores, asignación y relación con cliente y caso.

### Casos de tatuaje

Conserva cliente, resumen, zona corporal, tamaño, referencias, artista asignado y estado. Un caso puede existir sin cita y puede producir varias sesiones.

### Disponibilidad y booking

Calcula opciones con jornada, duración, márgenes, zona horaria y ocupación real de Google Calendar. Expone candidatos de elección libre mediante un enlace hash-only acotado sin mutación pública. Gestiona ofertas preaprobadas, opciones, reservas provisionales, caducidad, confirmación y liberación idempotente; selección y aprobación libres permanecen fuera.

### Contenido web y portfolios

_Estado técnico: ingestión, curación, publicación/retirada, feed/API público, web component y restore OWNER quedaron integrados mediante los PR #26–#31 con CI verde. La prueba live sintética de restore del 2026-09-17 detectó deriva de posición y su corrección está `IN_PROGRESS` local. Sigue sin existir evidencia live de Storage; la prueba en una web nueva y otra existente e invalidación CDN específica permanecen pendientes._

`/app/owner/gallery` autoriza OWNER antes de componer persistencia o Storage, exige multipart same-origin y no acepta tenant ni identidad del navegador. Dominio normaliza alt de 1..160 y destino; aplicación coordina tres objetos privados y solo persiste después de completar uploads. Ante cualquier fallo intenta retirar todos los paths opacos; una respuesta ambigua puede dejar un huérfano privado para reconciliación, nunca una fila completa o contenido publicado.

Sharp decodifica JPEG/PNG/WebP server-only con máximo 10 MiB, 12000×12000 y 40 MP, rechaza multipágina/animación y corrupción, aplica orientación y re-encode sin EXIF/ICC/XMP/GPS. Solo existen master sanitizada WebP calidad 88, display máximo 1600 calidad 82 y thumb máximo 480 calidad 78, sin upscale.

`gallery_asset`, `gallery_variant` y `gallery_publication_binding` usan FKs/checks compuestos, posiciones únicas por grupo y estados `DRAFT | DISCARDED | PUBLISHING | PUBLISHED | RETIRING | RETIRED`; no conceden acceso directo. El binding fija una publication key UUID aleatoria única e inmutable, separada de handle e IDs internos. Las RPC solo se conceden a `authenticated`, resuelven handle+`auth.uid()` y exigen OWNER coherente; `service_role` está revocado en metadata y se limita a Storage server-only. El listado activo entrega un handle público aleatorio, nunca key, path o URL. `/app/owner/gallery/thumbnails/:handle` autoriza OWNER y resuelve `DRAFT | PUBLISHING | PUBLISHED | RETIRING`; descarga THUMB privado con firma de 30 segundos, origen/prefijo fijo, redirects prohibidos, `image/webp`, tamaño persistido máximo 10 MiB y timeout 3 segundos. `RETIRED` permanece oculto; `DISCARDED` aparece únicamente en un listado privado separado de metadata editorial y no resuelve miniatura.

La curación usa formularios SSR sin JavaScript obligatorio y exactamente una intención `UPDATE | MOVE_UP | MOVE_DOWN | DISCARD` con campos exactos; los aliases anteriores se rechazan y `CREATE_DRAFT` permanece separado para ingestión. Editar normaliza alt y valida `GALLERY` sin artista o `ARTIST_PORTFOLIO` same-tenant. Create, update/reassign, move y discard toman primero un mismo advisory xact lock derivado solo de `studio_id`, antes de row locks; esta serialización por estudio elimina ciclos causados por snapshots obsoletos y mantiene estudios distintos independientes. La reasignación anexa al máximo existente. `MOVE_UP | MOVE_DOWN` intercambia con el DRAFT vecino mediante constraint diferida; en bordes no modifica nada. `DISCARD` cambia idempotentemente a `DISCARDED` y conserva privados. Solo DRAFT admite curación; el listado y proxy OWNER abarcan los cuatro estados activos.

Restore añade la intención exacta `RESTORE` con formulario handle-only. El RPC auth-bound toma primero el mismo lock común por estudio y, tras bloquear la fila, permite solo `DISCARDED → DRAFT`; un retry ya `DRAFT` es no-op. La restauración conserva grupo, artista, alt, variantes, binding y exactamente la posición que la propia fila mantiene reservada mediante el constraint global de unicidad. No renumera assets, no compone `service_role` ni toca Storage.

GC, hard delete y borrado de objetos siguen pendientes y bloqueados hasta definir retención, grace period y reconciliación que impida restaurar después de una purga. No se anticipan estados ni columnas para esa política.

`PUBLISH` y `RETIRE` son POST same-origin handle-only. Los begin RPC adquieren el mismo lock de estudio antes del row lock: DRAFT fija una única binding y pasa a PUBLISHING; PUBLISHED pasa a RETIRING; los estados intermedios reutilizan binding y los terminales convergen sin Storage. Los finalize exigen binding y estado exactos para fijar `published_at` o `retired_at`. No existe vuelta a DRAFT ni republicación de RETIRED en este slice.

Storage service-role se compone lazy únicamente tras auth OWNER, formulario exacto y begin con trabajo. Publicación descarga solo DISPLAY/THUMB privados WebP con tamaño persistido 1..10 MiB, timeout 3 s y sin redirects; nunca MASTER. Sube a `gallery-public` con paths `<publication-key>/<display|thumb>.webp`, `upsert:true` y cache 300 s. Retirada elimina esos dos objetos idempotentemente sin tocar privados. Un objeto aleatorio puede existir sin indexar durante PUBLISHING; el sistema no declara publicado antes de PUBLISHED ni promete invalidación CDN.

La lectura pública añade UUID públicos e inmutables separados para estudio y artista. `get_public_studio_gallery` es una RPC `STABLE`, `SECURITY DEFINER`, con `search_path=''`, límite total 100 y ejecución exclusiva de `service_role`; `anon` y `authenticated` no leen tablas ni ejecutan la función. El resource route server-only resuelve solo el slug, valida y proyecta la respuesta, y nunca entrega la key de servicio al navegador.

### Entrega de contenido público

`GET | HEAD /api/public/studios/:studioSlug/gallery` expone únicamente assets `PUBLISHED`, separados en `gallery_images` y `portfolio_images` por artista. Cada imagen contiene `public_id`, URLs públicas DISPLAY/THUMB WebP versionadas, dimensiones, alt, posición y fecha de publicación; no contiene IDs internos, usuarios, clientes, conversaciones, calendarios, masters, paths privados ni binding como campo. El orden es estable y el adaptador descarta cualquier campo adicional de persistencia.

La respuesta JSON permite CORS sin credenciales, usa ETag fuerte y conditional GET, cabeceras defensivas y `Cache-Control: public, max-age=60, s-maxage=60, must-revalidate`. `RETIRING`, `RETIRED`, `PUBLISHING`, `DRAFT` y `DISCARDED` quedan fuera en origen; los 60 segundos acotan la caché por debajo de los 300 s de objetos. Un limitador en memoria acotada permite 120 solicitudes por slug y minuto en cada proceso y devuelve métricas/429; edge/CDN podrá reforzarlo cuando se elija hosting.

`<inkendar-gallery>` vive en un paquete sin framework y se compila antes de la aplicación al asset ESM estable `/inkendar-gallery.js`. Su Shadow DOM consume únicamente el feed anterior con `credentials: omit`, deriva el origen API de `import.meta.url` o del atributo opcional validado `api-origin`, valida el DTO y las URLs públicas, y representa galería/portfolios con THUMB/DISPLAY responsivos y estados accesibles. No importa adaptadores server-only, no persiste datos ni contiene analytics. El contrato público y las variables CSS admitidas están en [Web component público de galería](../contracts/gallery-web-component-slice.md).

### Notificaciones

Las confirmaciones y vencimientos prefieren la única conversación Chatwoot original del caso y usan SMTP por estudio como fallback si existe email válido. Conservan `NO_ROUTE` cuando falta ruta/configuración y `UNKNOWN` ante ambigüedad; ningún estado se presenta como enviado sin confirmación del proveedor. Rechazos y recordatorios quedan para slices posteriores.

### Auditoría

Registra acciones sensibles: conexiones, cambios de rol, publicación de imágenes, ofertas, confirmaciones, cancelaciones y fallos de integración.

## 5. Propiedad de los datos

| Dato | Fuente de verdad |
|---|---|
| Estudios, usuarios, artistas, casos y reglas | Supabase/Postgres |
| Ofertas, reservas provisionales y auditoría | Supabase/Postgres |
| Imágenes privadas y originales | Supabase Storage privado |
| Imágenes publicadas de la web | Supabase Storage/CDN público |
| Conversaciones y mensajes | Chatwoot |
| Disponibilidad ocupada y eventos confirmados | Google Calendar |

Inkendar no mantendrá dos copias editables del mismo mensaje o evento. Guardará identificadores externos, estado de sincronización y la información mínima necesaria para relacionarlos con el dominio.

## 6. Modelo de datos inicial

```text
studio
├── membership ── user
├── artist_profile
├── customer
├── tattoo_case
│   ├── reference_asset
│   ├── conversation_link
│   └── appointment
├── booking_offer
│   └── booking_option
├── availability_rule
├── integration_connection
├── website_media
└── audit_event
```

Todas las tablas de negocio incluyen `studio_id`. Las políticas RLS deben demostrar que un miembro autorizado puede acceder únicamente a su estudio y que usuarios externos y anónimos no pueden leer datos privados.

## 7. Seguridad y privacidad

- Supabase se crea en una región europea disponible y se utiliza un solo proyecto multi-tenant.
- Los tokens de Google y Chatwoot permanecen cifrados en backend y nunca se exponen al navegador, logs o documentación.
- Los enlaces del cliente son opacos, tienen alcance mínimo, caducan y no requieren una cuenta.
- La PWA almacena en caché la aplicación estática; no conserva permanentemente mensajes, datos personales ni imágenes privadas en el dispositivo.
- Las referencias de clientes utilizan URLs firmadas y temporales.
- Al procesar imágenes se eliminan metadatos como GPS antes de almacenarlas o publicarlas.
- Las operaciones de reserva y publicación son auditables e idempotentes.

## 8. Procesos asíncronos

El ejecutor portable implementado en el primer corte puede:

- caducar ofertas y reservas provisionales;
- enviar confirmaciones y avisos de vencimiento por Chatwoot original o fallback SMTP configurado por estudio;
- reintentar únicamente fallos externos confirmados y acotados;
- marcar `UNKNOWN` o `NO_ROUTE` para intervención sin reenvío automático.

No libera eventos Google: los holds son locales y una confirmación `INSERTING`/`CONFIRMED` se conserva. Recordatorios, webhooks recuperables y otros avisos siguen pendientes.

El mecanismo concreto puede comenzar con funciones programadas sobre la plataforma gestionada. Una cola dedicada solo se añadirá cuando el volumen o la fiabilidad medida lo exijan.

## 9. Despliegue inicial

- `inkendar.es`: landing comercial independiente, sin datos de estudios.
- `app.inkendar.es`: PWA y API/BFF de la plataforma. Este origen es el valor confiable por defecto para mutaciones de autenticación; un proxy o dominio alternativo debe fijar explícitamente `INKENDAR_APP_ORIGIN` y no se confía en cabeceras de host reenviadas por el cliente.
- dominio del estudio: web creada por Incamdi o web existente conectada al feed público.
- Supabase Cloud Pro: un proyecto de producción multi-tenant.
- Desarrollo: Supabase local o proyecto gratuito separado.
- Chatwoot: motor de mensajería no visible para el estudio.
- Google Calendar: cuenta central del estudio con un calendario por artista.

El proveedor de alojamiento de la PWA queda abierto hasta comparar coste, región, cron y límites de ejecución. La arquitectura no debe depender de una capacidad exclusiva de un proveedor.

## 10. TDD, calidad y observabilidad

El proceso operativo completo está definido en [Flujo de desarrollo, revisión e integración](../development/delivery-workflow.md). Dos agentes trabajan secuencialmente: uno implementa mediante TDD y otro revisa, ejecuta la validación completa, gestiona el Pull Request y vigila el CI.

Todo comportamiento de producción se implementa mediante RED–GREEN–REFACTOR:

1. **RED:** escribir primero una prueba que falle por el comportamiento ausente o por la regresión.
2. **GREEN:** implementar la solución mínima que satisface el contrato.
3. **REFACTOR:** mejorar el diseño manteniendo todas las pruebas verdes.

La regla se aplica a dominio, casos de uso, permisos, migraciones y defectos. Un slice no comienza con código de producción si su comportamiento observable aún no está expresado por una prueba fallida. Los cambios exclusivamente documentales o mecánicos que no alteran comportamiento no requieren una prueba artificial.

La validación ejecutable actual es:

```text
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

- Pruebas unitarias para reglas de disponibilidad, estados y caducidad.
- Pruebas de casos de uso con adaptadores falsos de Chatwoot y Google.
- Pruebas de integración para migraciones, RLS, webhooks y OAuth.
- Prueba de regresión RED antes de corregir cada defecto reproducible.
- Pocos recorridos E2E para owner, artista y cliente invitado.
- Correlation ID en webhooks, reservas y notificaciones.
- Métricas de fallos, reintentos, ofertas caducadas y confirmaciones.

## 11. Consecuencias

La recomendación añade un backend propio delgado, pero concentra allí autorización, reglas y coordinación externa. Evita que el navegador conozca secretos o decida estados críticos. También mantiene la complejidad operativa por debajo de una arquitectura de microservicios y permite sustituir Chatwoot, Google o Supabase mediante adaptadores cuando exista una razón real.

## 12. Registro de cambios

| Fecha | Cambio | Motivo |
|---|---|---|
| 2026-09-16 | Agenda privada ARTIST mediante SSR y RPC mínima ligada a `auth.uid()` | Mostrar solo próximas citas confirmadas propias y contexto de preparación sin PII, IDs, Google directo ni mutaciones. |
| 2026-09-16 | Fallback SMTP server-only por estudio detrás de un puerto de aplicación | Avisar cuando no existe una única ruta Chatwoot sin persistir PII/credenciales ni acoplarse a un SaaS de email. |
| 2026-09-16 | Intención durable y runner portable para confirmación/caducidad por Chatwoot original | Ejecutar notificaciones sin persistir contenido ni duplicar envíos ante resultados ambiguos, preservando el hosting cron como decisión abierta. |
| 2026-09-16 | Evidencia live sintética de FreeBusy, booking preaprobado y reconciliación Google Events sin duplicados | Registrar el gate operativo verificado sin ampliar el alcance a notificaciones, scheduler u otros flujos no probados. |
| 2026-09-13 | Esquema inicial de identidad, helpers privados y RLS multi-tenant | Fijar una frontera de autorización comprobable antes de incorporar UI, proveedores o datos operativos. |
| 2026-09-10 | Primera propuesta de arquitectura de aplicación | Convertir las decisiones de producto en una estructura implementable y comparar alternativas antes de escribir el panel. |
| 2026-09-10 | Separación de la landing y contrato de contenido web | Conectar galerías con webs nuevas o existentes sin mezclar marketing de Inkendar ni exponer datos privados. |
| 2026-09-10 | Ratificación del monolito modular y TDD | Fijar una arquitectura operable y pruebas previas al código de producción para todos los cambios de comportamiento. |
| 2026-09-13 | Flujo de dos agentes y CI | Separar implementación e integración y exigir validación automática antes de `main`. |
| 2026-09-13 | React Router 8, Node 24 y npm workspaces como base ejecutable | Unir PWA y API/BFF en un despliegue portable, expresar los límites internos y habilitar validación automática sin añadir infraestructura de producto. |
| 2026-09-13 | CLI de alta manual, puertos de provisión y compensación Auth/Postgres | Habilitar el servicio gestionado sin endpoint público y conservar roles, secretos y operaciones privilegiadas en el servidor. |
| 2026-09-13 | Clientes y casos OWNER con estados mínimos, RLS y FKs tenant compuestas | Registrar contexto operativo básico sin borrar datos, abrir acceso del artista ni anticipar booking e integraciones. |
| 2026-09-14 | pnpm 10.22.0 y un único lockfile para todos los workspaces | Unificar el toolchain con la landing y hacer reproducibles la instalación local y los dos jobs de CI. |
| 2026-09-14 | Frontera de conversaciones OWNER, vínculo tenant-safe y webhook Chatwoot autenticado | Ocultar Chatwoot, conservarlo como fuente de mensajes y hacer observables/deduplicables los reintentos sin almacenar contenido. |
| 2026-09-14 | OAuth Google server-side, token AEAD y calendario por artista | Preparar Calendar con privilegio mínimo, configuración lazy y aislamiento multi-tenant antes de implementar disponibilidad y eventos. |
| 2026-09-15 | Disponibilidad semanal por artista y FreeBusy incremental | Generar candidatos tenant-safe sin leer eventos ni anticipar ofertas, holds o booking. |
| 2026-09-15 | Ofertas preaprobadas y holds tenant-safe con caducidad configurable | Reservar provisionalmente opciones y excluirlas de disponibilidad sin acoplar selección, eventos, confirmación ni notificaciones. |
| 2026-09-15 | Acceso público hash-only de solo lectura a ofertas vigentes | Mostrar opciones reservadas provisionalmente mediante una credencial rotatoria sin exponer datos del cliente/caso ni anticipar selección o confirmación. |
| 2026-09-15 | Selección pública atómica con selector por opción y estado pendiente de confirmación | Registrar una única elección preaprobada, conservar su hold y liberar alternativas sin exponer IDs ni afirmar una cita antes de Google Events. |
| 2026-09-15 | Confirmación recuperable con ID Google determinista, FreeBusy final y RPC atómica | Converger ante retries y respuestas ambiguas sin duplicar/reemplazar eventos ni comunicar confirmación antes de persistirla. |
