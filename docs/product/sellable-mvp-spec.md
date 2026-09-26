# Especificación de Inkendar

_Estado: especificación viva y fuente de verdad para alcance, comportamiento y progreso_

_Versión: 1.30.5_

_Última actualización: 2026-09-26_

_La fase anterior al desarrollo se define en [Plan de validación y lanzamiento](validation-and-launch-plan.md)._

_Ante cualquier contradicción con otros documentos o con las secciones heredadas de este archivo, prevalece la decisión vigente que aparece a continuación._

## Cómo mantener esta especificación

Este documento evoluciona con el producto. Ningún cambio de alcance, comportamiento, roles, datos, integración, precio o arquitectura se considera acordado hasta que quede reflejado aquí.

Cada modificación debe incluir:

1. el comportamiento vigente en la sección correspondiente;
2. la fecha y el estado del cambio;
3. el motivo y la evidencia que lo justifican en el registro de decisiones;
4. los criterios de aceptación afectados;
5. una decisión de arquitectura enlazada cuando cambien fronteras técnicas, persistencia, seguridad o proveedores;
6. el progreso actualizado únicamente después de obtener evidencia verificable.

Estados utilizados:

- `PROPOSED`: definido para discusión, todavía no ratificado;
- `ACCEPTED`: decisión vigente;
- `PLANNED`: incluido y ordenado, sin implementación;
- `IN_PROGRESS`: existe trabajo en curso comprobable;
- `CONNECTED`: proveedor conectado, pendiente de prueba extremo a extremo;
- `PASS`: aceptación verificada;
- `DEFERRED`: retirado del alcance actual sin descartarlo definitivamente;
- `DONE`: implementado, verificado y documentado;
- `SUPERSEDED`: decisión histórica reemplazada por otra decisión vigente.

Las correcciones editoriales pueden agruparse en una entrada. Los cambios de comportamiento deben tener una entrada propia con su motivo.

## Progreso vigente

| Área | Estado | Evidencia o siguiente gate |
|---|---|---|
| Landing comercial de Inkendar | `PASS` | La landing Astro vive en el repositorio independiente [`inkendar`](https://github.com/marcosAlvarezCalabria/inkendar), con CI y despliegue propios; este repositorio no contiene su código. |
| Chat web en Chatwoot | `PASS` | Recepción y respuesta verificadas con datos sintéticos. |
| Instagram en Chatwoot | `PASS` | Recepción y respuesta por el canal original verificadas. |
| Facebook Messenger | `CONNECTED` | Falta la prueba bidireccional final. |
| Operación dentro de Inkendar | `IN_PROGRESS` | El contrato técnico original de conversaciones está `DONE` con CI verde en el run 34883809683. La visualización de imágenes entrantes quedó integrada mediante el [PR #52](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/52) y el squash `c62c9e0`, con `validate` y `database` verdes en el [run post-merge 36244018683](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/36244018683). Falta el recorrido live de la PWA con una conexión Chatwoot sintética. |
| PWA y autenticación | `PASS` | Login email/password, cookies SSR, guards y logout ya tenían smoke Auth/RLS real. Los [PR #45](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/45)–[#48](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/48) integraron la especificación UI, la fundación visual, el comportamiento mobile-first y el fallo seguro de Ofertas. El run post-merge [36231279413](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/36231279413) pasó `validate` y `database` con 590 pruebas y 1 omitida; el 2026-09-26 login OWNER y Ofertas se verificaron en staging a 320 CSS px y después en un teléfono físico. El [PR #50](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/50) integró el shell offline y el bloqueo de mutaciones; el [run post-merge 36238090450](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/36238090450) quedó verde. En staging, un smoke automatizado a 320 CSS px verificó registro/control del service worker, allowlist exacta de tres assets públicos, aviso offline, bloqueo sin perder valores y recuperación al reconectar. La navegación al fallback estático quedó inconclusa por la limitación del simulador de red y la suspensión explícita de accesos sigue pendiente. |
| Clientes y casos de tatuaje | `PASS` | Dominio, aplicación, adaptador Supabase y UI SSR OWNER pasaron `npm run check` con 97 pruebas; migración limpia, seed y 58 aserciones pgTAP del slice pasaron dentro de las 117 aserciones del job `database` en el [run 34774972933](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/34774972933). |
| Agenda privada ARTIST | `DONE` | El PR #25 y CI verde integraron la agenda SSR read-only, RPC mínima tenant-safe y 27 aserciones pgTAP. No se ejecutó prueba live ni se añadieron mutaciones de agenda; el único formulario del shell es el logout global. |
| Alta manual gestionada | `PASS` | El CLI de servidor, Auth Admin, compensación y RPC idempotentes pasaron 32 pruebas enfocadas, `npm run check` con 38 pruebas y 21 aserciones pgTAP dentro del job `database` [run 34756137292](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/34756137292). No incluye login, sesión ni UI de autenticación. |
| Flujo de entrega y CI | `PASS` | `main` exige PR, los checks `validate` y `database`, conversaciones resueltas e historial lineal; ambos jobs pasaron tras integrar el [PR #10](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/10) en el [run 34895446647](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/34895446647). |
| Memoria de agentes | `PASS` | Engram 1.20.0 guarda y recupera memoria del proyecto `inkendar.app`; Codex MCP está configurado y requiere reinicio para cargarlo en nuevos chats. |
| Supabase y aislamiento multi-tenant | `PASS` | La migración, el seed sintético y las 38 aserciones pgTAP pasaron contra Supabase/Postgres real en GitHub Actions [run 34752758528](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/34752758528). |
| Google Calendar y booking | `IN_PROGRESS` | Los PR #35, #37 y #38 integraron elección libre por caso, solicitud durable y decisión OWNER; los PR #39–#41 corrigieron los orígenes públicos sin relajar same-origin. El 2026-09-23 un recorrido sintético live local verificó emisión, selección `PENDING_OWNER_APPROVAL`, aprobación OWNER, creación/reconciliación del evento y terminal público `CONFIRMED`; rechazo también quedó verificado. OAuth/asignación, disponibilidad y flujo preaprobado ya tenían evidencia previa. Scheduler Chatwoot y fallback SMTP están integrados mediante los PR #23 y #24; la notificación durable `REJECTED` quedó integrada mediante el [PR #43](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/43) y el squash `1daf8cc85bbc48a0465496e5f2f95b2289f60a2b`, con `validate` y `database` verdes en el [run post-merge 36126495899](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/36126495899). Toda notificación real sigue pendiente. |
| Galería, portfolios y publicación web | `IN_PROGRESS` | Los PR #26–#34 integraron con CI verde ingestión, curación, publicación, feed, web component, restauración y conservación exacta de posición. El 2026-09-23 se verificaron localmente con datos sintéticos publicación, consumo del componente desde una página externa y el ciclo `DISCARD → RESTORE` sin deriva de posición. No existe todavía evidencia contra Storage Cloud ni pruebas en una web real nueva y otra existente; invalidación CDN específica y GC siguen pendientes. |
| Hosting Cloudflare y salida a producción | `IN_PROGRESS` | El [PR #42](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/42) quedó integrado como `271cb35`. Existe el proyecto Supabase Cloud `inkendar-staging` con migraciones aplicadas y el Worker `inkendar-staging`; el 2026-09-26 se configuraron sus secretos Supabase. Staging ejecuta `main` `81ab2d713a12cc295479a078b8d5b55ed407458b` como versión `5ca5b753-0d26-49a2-80df-6ac2f478b5a9`; `/healthz`, `/readyz` y `/login` devolvieron `200` tras el despliegue. La conexión Chatwoot todavía no está configurada en el Worker y el recorrido live de imágenes continúa pendiente. Producción no se ha desplegado ni configurado; Google, Chatwoot, Storage/Images y los recorridos completos de staging conservan sus gates propios. |
| Piloto externo y disposición a pagar | `PLANNED` | No existe todavía evidencia de uso real autorizado ni pago. |

## Registro de decisiones

| Fecha | ID | Estado | Decisión | Motivo |
|---|---|---|---|---|
| 2026-09-02 | DEC-001 | `ACCEPTED` | Inkendar es el producto e Incamdi la agencia que lo implanta. | Separar la identidad del producto de la prestación profesional. |
| 2026-09-02 | DEC-002 | `ACCEPTED` | El MVP usa web, Instagram y Facebook mediante Chatwoot; WhatsApp queda fuera. | Web e Instagram pasaron el spike y WhatsApp Coexistence añadió una dependencia que bloqueaba la oferta. |
| 2026-09-02 | DEC-003 | `ACCEPTED` | Google Calendar es la agenda operativa y Supabase conserva el dominio. | Evitar construir una agenda propietaria antes de validar el recorrido comercial. |
| 2026-09-10 | DEC-004 | `ACCEPTED` | Chatwoot trabaja detrás de Inkendar y no es visible para owner ni artistas. | Ofrecer una experiencia única y conservar la opción de cambiar el proveedor de mensajería. |
| 2026-09-10 | DEC-005 | `ACCEPTED` | El owner opera canales, clientes, citas, calendarios, galería y portfolios; el artista solo consulta su agenda y el contexto necesario. | Centralizar la atención en el estudio y reducir permisos, formación y coste por agentes. |
| 2026-09-10 | DEC-006 | `ACCEPTED` | El cliente puede elegir entre huecos o recibir hasta tres opciones; las reservas provisionales duran 24 horas por defecto y son configurables. | Dar tiempo para decidir sin bloquear la agenda indefinidamente. |
| 2026-09-10 | DEC-007 | `ACCEPTED` | Si el owner preaprueba opciones, la elección confirma la cita; un hueco elegido libremente requiere aprobación del owner. | Mantener control humano y reducir pasos cuando la disponibilidad ya fue aprobada. |
| 2026-09-10 | DEC-008 | `ACCEPTED` | Inkendar gestiona solo la galería general y las imágenes por artista; el owner publica y los artistas no editan. | Permitir autonomía útil sin construir un CMS o editor de páginas completo. |
| 2026-09-10 | DEC-009 | `ACCEPTED` | Inkendar será una PWA y utilizará un único Supabase Cloud multi-tenant en producción. | Ofrecer móvil, tablet y escritorio con bajo coste operativo y aislamiento mediante Postgres/RLS. |
| 2026-09-10 | DEC-010 | `ACCEPTED` | Construir la aplicación como monolito modular TypeScript. | Mantiene dominio y proveedores desacoplados con una sola operación y fue ratificada antes de implementar. |
| 2026-09-10 | DEC-011 | `PROPOSED` | Hipótesis comercial: 149 €/mes, 690 € de implantación y 99 €/mes durante seis meses para pilotos. | Cubrir proveedores y soporte manteniendo un precio comparable con software gestionado del sector; debe validarse con estudios. |
| 2026-09-10 | DEC-012 | `ACCEPTED` | La landing comercial de Inkendar es independiente de la plataforma y de las webs de los estudios. | Su única función es dar a conocer Inkendar; no contiene ni publica datos de clientes. |
| 2026-09-10 | DEC-013 | `ACCEPTED` | Inkendar publica galerías mediante una interfaz de contenido de solo lectura compatible con webs nuevas y existentes. | Permitir vender una web cuando el estudio no la tiene y conservar Inkendar cuando ya dispone de una. |
| 2026-09-10 | DEC-014 | `ACCEPTED` | Todo comportamiento de producción se desarrolla con TDD mediante RED–GREEN–REFACTOR. | Proteger reglas de reservas, aislamiento, sincronización y permisos desde el inicio y evitar regresiones. |
| 2026-09-13 | DEC-015 | `ACCEPTED` | Cada cambio de código pasa secuencialmente por un agente de implementación, un agente de integración y GitHub Actions antes de entrar en `main`. | Separar creación y revisión, automatizar evidencia y evitar integraciones sin validar. |
| 2026-09-13 | DEC-016 | `ACCEPTED` | Cada chat de agente se limita a un slice y a un presupuesto operativo máximo de 32.000 tokens, sin heredar el historial completo. | Reducir información irrelevante, contradicciones y respuestas basadas en memoria imprecisa; el repositorio conserva la verdad. |
| 2026-09-13 | DEC-017 | `ACCEPTED` | Engram de Gentleman Programming se prueba como memoria auxiliar local de los agentes, con recuperación limitada y verificación obligatoria contra el repositorio. | Conservar decisiones entre sesiones sin cargar historiales completos ni convertir recuerdos automáticos en autoridad. |
| 2026-09-13 | DEC-018 | `ACCEPTED` | Se retira el backlog contradictorio de los documentos activos y se autoriza iniciar la base técnica con datos sintéticos mientras continúa la validación comercial. | Reducir contexto obsoleto y permitir progreso verificable sin anunciar ni operar capacidades que aún no han superado sus gates. |
| 2026-09-13 | DEC-019 | `ACCEPTED` | La landing permanece en el repositorio actual y el software se construye en un repositorio independiente, cada uno con su propio CI y despliegue. | Evitar mezclar ciclos de vida, dependencias y datos del producto con el sitio comercial. |
| 2026-09-13 | DEC-020 | `ACCEPTED` | Este repositorio `inkendar.app` pasa a ser la fuente de verdad del software; el repositorio `inkendar` conserva la landing y su documentación de marketing. | Evitar que dos repositorios mantengan copias divergentes de la spec técnica y del estado de implementación. |
| 2026-09-13 | DEC-021 | `SUPERSEDED` | La base full-stack usa React Router 8 sobre Node.js LTS y npm workspaces, con un adaptador de servidor reemplazable. | Sustituida por DEC-026 únicamente en la elección del gestor de paquetes; React Router, Node.js y el adaptador portable continúan vigentes. |
| 2026-09-13 | DEC-022 | `ACCEPTED` | La identidad inicial usa `auth.users` y tablas tenant-scoped `user_profile`, `membership` y `artist_profile`; los únicos roles son `OWNER` y `ARTIST`, y Postgres RLS aplica el aislamiento mediante helpers privados con `search_path` vacío. | Hacer que el owner administre solo su estudio, limitar al artista a lectura propia y evitar escalación o recursión en políticas antes de conectar UI o Supabase Cloud. |
| 2026-09-13 | DEC-023 | `ACCEPTED` | El alta inicial es una operación gestionada mediante CLI de servidor, Supabase Admin detrás de puertos y RPC transaccionales idempotentes exclusivas de `service_role`; los roles son fijos, un fallo confirmado compensa Auth y un resultado ambiguo conserva la identidad para recuperación segura. | Provisionar pilotos sin superficie pública ni secretos versionados y hacer explícita la recuperación ante la falta de una transacción distribuida entre Auth y Postgres. |
| 2026-09-13 | DEC-024 | `ACCEPTED` | La sesión PWA usa `@supabase/ssr` y cookies en loaders/actions; `auth.getUser()` verifica la identidad y la aplicación exige una membership coherente bajo RLS antes de exponer un shell por rol. | Mantener tokens y autorización fuera del bundle y fallar cerrado ante identidades ambiguas. |
| 2026-09-13 | DEC-025 | `ACCEPTED` | El modelo operativo mínimo usa `customer` con estado `ACTIVE` / `ARCHIVED` y `tattoo_case` con estado `OPEN` / `ARCHIVED`; solo OWNER accede, el artista asignado es opcional y no se borran filas en este slice. | Registrar clientes y casos sin anticipar booking ni un workflow complejo, conservando retirada explícita y aislamiento tenant mediante RLS y FKs compuestas. |
| 2026-09-14 | DEC-026 | `ACCEPTED` | El toolchain de `inkendar.app` usa pnpm 10.22.0, un workspace explícito y un único `pnpm-lock.yaml`; CI instala con lockfile congelado y caché de pnpm. | Unificar el gestor de paquetes con la landing y mantener instalaciones locales y remotas reproducibles sin cambiar la arquitectura ni el comportamiento del producto. |
| 2026-09-14 | DEC-027 | `ACCEPTED` | El primer corte de conversaciones OWNER consulta Chatwoot bajo demanda detrás de `ConversationProviderPort`, pagina sin conexión como vacío privado, conserva vínculos, ingesta y operaciones outbound sin contenido en Supabase y autentica webhooks con firma HMAC, frescura y delivery ID idempotente. | Ocultar el proveedor, evitar copias divergentes de mensajes y conectar conversaciones con clientes/casos manteniendo aislamiento tenant y reintentos observables. |
| 2026-09-14 | DEC-028 | `ACCEPTED` | La conexión Google usa Authorization Code web server, scope incremental `calendar.calendarlist.readonly`, refresh token cifrado con AES-256-GCM y persistencia/RPC exclusivas de `service_role`; cada artista puede tener un calendario de la conexión activa de su estudio. | Preparar disponibilidad y eventos con privilegio mínimo, secretos fuera del navegador y relaciones tenant-safe sin anticipar booking. |
| 2026-09-15 | DEC-029 | `ACCEPTED` | La disponibilidad por artista usa reglas semanales IANA en Supabase y consulta incremental Google FreeBusy con `calendar.events.freebusy`; devuelve candidatos acotados sin leer eventos ni crear citas. | Previsualizar huecos con privilegio mínimo y límites tenant-safe antes de implementar eventos, ofertas o booking. |
| 2026-09-15 | DEC-030 | `ACCEPTED` | Las ofertas preaprobadas guardan de una a tres opciones tenant-safe en Supabase; sus holds bloquean disponibilidad hasta una caducidad por estudio de 24 horas por defecto y se liberan idempotentemente sin crear eventos Google. | Separar el núcleo provisional verificable con datos sintéticos de los slices posteriores de selección pública, confirmación, notificación y sincronización de eventos. |
| 2026-09-15 | DEC-031 | `ACCEPTED` | Una oferta preaprobada vigente puede publicar una única credencial opaca rotatoria de solo lectura: 32 bytes aleatorios, SHA-256 en reposo, ruta por path y respuesta pública mínima sin datos de cliente/caso ni identificadores internos. | Dar al cliente visibilidad segura de opciones reservadas provisionalmente antes de implementar selección, confirmación o eventos Google. |
| 2026-09-15 | DEC-032 | `ACCEPTED` | Cada opción preaprobada usa un selector público UUID v4 separado; una elección vigente se serializa por oferta, conserva una única opción seleccionada como hold y queda `SELECTED_PENDING_CONFIRMATION` hasta el slice idempotente de Google Events. | Permitir selección pública atómica e idempotente sin exponer IDs internos ni contradecir DEC-007 con una confirmación falsa antes de revalidar y escribir Google Calendar. |

| 2026-09-15 | DEC-033 | `ACCEPTED` | Una selección preaprobada exige conexión activa, token y scopes FreeBusy+Events antes de crear o renovar claim, y fija de forma tenant-safe su conexión, calendario, opción, event ID y correlación en una operación durable antes de Google. `READY` continúa sujeto a caducidad; un lock común serializa caducidad y la única transición `READY → INSERTING`. Antes de reusar un intervalo vencido, la creación de ofertas materializa su expiración bajo el advisory lock del artista y locks `offer → operation` ordenados. Tras `INSERTING` la selección y su exclusión sobreviven a `expires_at`, y toda recuperación es solo `Events.get`, nunca otro insert. FreeBusy revalida `[start,end)`, la finalización es atómica y `invalid_grant` usa CAS por generación de credencial. | Evitar duplicados, reoferta de un intervalo ambiguo y confirmaciones falsas ante grants incompletos, crash, creación/caducidad concurrentes, respuestas ambiguas, colisiones, reasignaciones o retries, sin degradar credenciales reconectadas y manteniendo Google como agenda operativa. |
| 2026-09-16 | DEC-034 | `ACCEPTED` | Confirmar o caducar una oferta materializa una intención durable única; un runner server-only y portable caduca lotes acotados y envía confirmaciones/caducidades por la única conversación Chatwoot del mismo caso y tenant. Éxitos convergen, fallos confirmados reintentan como máximo tres veces, resultados ambiguos o leases vencidos quedan `UNKNOWN` sin reenvío, y la falta de una ruta inequívoca queda `NO_ROUTE`. | Chatwoot no documenta idempotencia outbound; separar intención, lease y efecto externo evita duplicados y falsas afirmaciones sin persistir mensajes, payloads, tokens ni PII. |
| 2026-09-16 | DEC-035 | `ACCEPTED` | El runner prefiere exactamente una ruta Chatwoot tenant-safe; con cero o múltiples rutas usa el email válido del customer solo si el estudio dispone de configuración SMTP server-only. SMTP autenticado exige TLS, guarda únicamente un identificador opaco derivado, trata rechazos confirmados como `FAILED` y resultados ambiguos como `UNKNOWN`. | Completar el aviso transaccional sin elegir un SaaS de email, copiar PII al outbox o navegador, ni debilitar la política conservadora frente a duplicados. |
| 2026-09-16 | DEC-036 | `ACCEPTED` | La agenda ARTIST se sirve mediante SSR y una RPC `auth.uid()` de salida mínima que exige identidad coherente, filtra solo citas/opciones `CONFIRMED` propias con `end_at >= now`, ordena y limita a 50; usa la zona IANA de disponibilidad o `UTC` explícito y no concede acceso general a tablas. | Entregar preparación útil en solo lectura sin duplicar Google, revelar PII/IDs o abrir capacidades OWNER al artista. |
| 2026-09-16 | DEC-037 | `ACCEPTED` | La curación privada resuelve assets exclusivamente por handle público opaco y `auth.uid()`; create, update/reassign, move y discard se serializan primero con un único advisory xact lock por estudio, la reasignación anexa al nuevo grupo, el reorder intercambia solo el DRAFT vecino y el descarte conserva fila y objetos en estado `DISCARDED`. | Permitir preparación editorial recuperable sin ciclos de locks, publicación, IDs internos, acceso ARTIST, hard delete ni Storage público; estudios distintos conservan concurrencia independiente. |
| 2026-09-16 | DEC-038 | `ACCEPTED` | La publicación OWNER usa estados forward-only `DRAFT → PUBLISHING → PUBLISHED → RETIRING → RETIRED`, un binding UUID aleatorio inmutable separado del handle y dos efectos Storage reintentables sobre DISPLAY/THUMB. Cada begin auth-bound fija o reutiliza el binding bajo el lock común del estudio antes de Storage; finalize exige estado y binding exactos. | Evitar claves múltiples, masters públicos, falsas publicaciones y retiros no recuperables ante respuestas perdidas o ambiguas, manteniendo metadata y objetos privados fuera del cliente y del bucket público. |
| 2026-09-17 | DEC-039 | `ACCEPTED` | El feed de galería se sirve por un resource route GET/HEAD server-only que resuelve un slug UUID público e inmutable, consulta mediante RPC privilegiada acotada y proyecta solo `PUBLISHED` a un DTO mínimo con URLs DISPLAY/THUMB versionadas; usa ETag, caché pública de 60 s y un límite portable de 120 solicitudes por minuto y slug/proceso. | Integrar webs nuevas o existentes sin exponer tablas, IDs internos, binding, master, rutas privadas ni service role al navegador, acotando tráfico y la ventana de retirada sin inventar infraestructura de edge antes de elegir hosting. |
| 2026-09-17 | DEC-040 | `ACCEPTED` | La instalación rápida usa el custom element `<inkendar-gallery>` y el asset ESM estable `/inkendar-gallery.js`; `studio-slug` es obligatorio, `api-origin` es el único override opcional y el origen se deriva por defecto de `import.meta.url`. El Shadow DOM valida el feed y URLs, usa fetch CORS sin credenciales y expone solo variables CSS documentadas. | Integrar HTML, WordPress y constructores sin depender del framework anfitrión, consultar siempre Inkendar aunque la web viva en otro origen y evitar credenciales, HTML remoto, APIs públicas innecesarias o acoplamiento al proveedor. |
| 2026-09-17 | DEC-041 | `ACCEPTED` | Un OWNER puede listar hasta 100 assets `DISCARDED` de su estudio mediante metadata editorial segura y restaurarlos por handle opaco con `RESTORE`. La transición `DISCARDED → DRAFT` conserva grupo, alt, variantes, binding y la posición ya reservada por la propia fila, toma primero el lock común del estudio y converge sin cambios si el asset ya está `DRAFT`. | Recuperar trabajo privado ante descartes accidentales sin deriva de orden, renumeración histórica, miniaturas de descartados, IDs internos, service role, Storage, hard delete ni reapertura de estados publicados. GC permanece bloqueado hasta acordar retención, grace period y reconciliación tras purga. |
| 2026-09-17 | DEC-042 | `ACCEPTED` | La consulta pública para elección libre usa una credencial rotatoria de 32 bytes por artista, almacenada solo como SHA-256 y ligada a rango, duración y caducidad acotados. Un GET server-only calcula candidatos con reglas, FreeBusy y holds, expone un DTO mínimo y no permite seleccionar, bloquear ni reservar. | Abrir el primer tramo seguro de elección libre reutilizando disponibilidad real sin aceptar tenant/rango del visitante, filtrar eventos o anticipar aprobación y confirmación. |
| 2026-09-18 | DEC-043 | `ACCEPTED` | Los enlaces nuevos de elección libre se rotan por caso OPEN con artista explícito coherente; los legacy sin caso son GET-only. Un selector derivado opaco identifica cada candidato sin persistir el catálogo, POST revalida FreeBusy y una RPC serializada crea una solicitud durable `PENDING_OWNER_APPROVAL` que bloquea disponibilidad hasta su caducidad. | Personalizar el enlace para un cliente/caso sin PII pública, evitar timestamps confiados y carreras internas, y no confundir una solicitud con cita o aprobación. |
| 2026-09-18 | DEC-044 | `ACCEPTED` | Un token de elección libre consumido pierde autoridad de selección al vencer, pero conserva consulta terminal mínima mientras se retengan acceso y solicitud; no puede rotarse. La aprobación OWNER fija binding Google inmutable y una sola autoridad `READY → INSERTING`; `READY` vencido pierde lease y autoridad sin borrar su operación, mientras desde `INSERTING` sólo reconcilia, sobrevive a caducidad y finaliza una única cita/relación. | Evitar reanunciar huecos, perder el resultado del cliente, duplicar eventos o liberar un intervalo ambiguo ante retries, respuesta perdida o carreras approve/reject/expiry. |
| 2026-09-23 | DEC-045 | `ACCEPTED` | El SSR/BFF y sus assets se preparan para Cloudflare Workers con el plugin oficial Vite; Supabase Cloud conserva Postgres/Auth/Storage y la sanitización de imágenes usa un adaptador aislado del binding Cloudflare Images. | Cerrar la elección de hosting sin acoplar dominio o persistencia, retirar `sharp` incompatible con Workers y conservar el contrato de variantes privadas. Habilitación/plan de Images, secretos, staging y despliegue siguen siendo gates operativos. |
| 2026-09-23 | DEC-046 | `ACCEPTED` | El primer despliegue usa los endpoints gratuitos y estables `inkendar.calalva82.workers.dev` e `inkendar-staging.calalva82.workers.dev`; no requiere un dominio comprado. Un dominio personalizado queda como mejora futura no activa. | Permitir validación del MVP sin coste de dominio y mantener alineados origen canónico, acciones SSR y callbacks OAuth literales. |
| 2026-09-25 | DEC-047 | `ACCEPTED` | Rechazar una solicitud free-choice materializa en la misma transacción una intención durable `REJECTED` dentro del outbox común, con fuente XOR oferta/solicitud, ruta Chatwoot inequívoca preferida y fallback SMTP tenant-safe. Conserva los terminales `NO_ROUTE`/`UNKNOWN`, el reintento acotado de rechazos confirmados y la prohibición de persistir contenido o PII. | Avisar al cliente reutilizando la política conservadora ya probada sin crear otro runner, proveedor, endpoint o posibilidad de duplicar envíos ante ambigüedad. |
| 2026-09-26 | DEC-048 | `ACCEPTED` | El service worker precachea exclusivamente `/offline.html`, `/inkendar-mark.svg` y `/manifest.webmanifest`; las navegaciones son network-first y solo caen al HTML estático cuando falla la red. No cachea respuestas navegables, `/app`, APIs, enlaces opacos, mensajes, PII, imágenes privadas ni datos dinámicos. La UI detecta conectividad, marca los datos como posiblemente desactualizados y bloquea formularios no-GET sin perder sus valores hasta reconectar. | Dar una salida offline segura y auditable sin prometer operación offline, duplicar fuentes de datos ni persistir contenido privado en el dispositivo. |
| 2026-09-26 | DEC-049 | `ACCEPTED` | Conversaciones OWNER muestra solo imágenes entrantes JPEG/PNG/WebP junto con su caption cuando existe. Una ruta privada same-origin recupera la imagen desde Chatwoot bajo autorización OWNER/tenant, limita origen/redirecciones, tiempo, tamaño, firma y dimensiones, y responde sin caché; los formatos o bytes inválidos muestran un placeholder accesible. No añade envío de archivos ni persistencia de contenido. | Permitir revisar referencias visuales sin exponer URLs/tokens del proveedor, servir contenido activo o alterar la fuente operativa de mensajes. |
La arquitectura técnica está en [Arquitectura de aplicación](../architecture/application-architecture.md) y el proceso de entrega en [Flujo de desarrollo, revisión e integración](../development/delivery-workflow.md).

## Historial de la especificación

| Fecha | Versión | Mejora o cambio | Por qué |
|---|---|---|---|
| 2026-09-26 | 1.30.5 | Se desplegó `main` `81ab2d713a12cc295479a078b8d5b55ed407458b` en staging como versión `5ca5b753-0d26-49a2-80df-6ac2f478b5a9`; `/healthz`, `/readyz` y `/login` devolvieron `200`. El Worker conserva únicamente los secretos Supabase, por lo que la conexión Chatwoot y la prueba live de imágenes siguen pendientes. Producción no se desplegó. | Registrar la versión operativa observada y sus límites sin atribuir una integración externa todavía no configurada. |
| 2026-09-26 | 1.30.4 | El [PR #52](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/52) integró la lectura de imágenes entrantes por proxy privado como squash `c62c9e0`; `validate` y `database` concluyeron verdes en el [run post-merge 36244018683](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/36244018683). No se ejecutó un recorrido live con Chatwoot ni un despliegue de este cambio. | Registrar la evidencia técnica final sin confundir CI con operación conectada. |
| 2026-09-26 | 1.30.3 | Se implementó localmente la lectura de imágenes entrantes JPEG/PNG/WebP en Conversaciones OWNER mediante proxy privado y validación acotada de bytes/orígenes. Revisión, PR, CI y recorrido live siguen pendientes. | Añadir contexto visual a los mensajes sin entregar URLs autenticadas al navegador ni guardar adjuntos en Inkendar. |
| 2026-09-26 | 1.30.2 | Se desplegó `main` `62db889` en staging como versión `47191259-514f-45b1-8559-f221e8825e97`; `/readyz` devolvió `200` y un smoke automatizado móvil verificó registro/control, allowlist pública, aviso offline, bloqueo con preservación y reconexión. La navegación al fallback estático quedó inconclusa porque los simuladores usados cortaron la navegación antes de entregarla al service worker. | Registrar solo la evidencia operativa observada, sin convertir una limitación del harness en éxito de producto ni tocar producción. |
| 2026-09-26 | 1.30.1 | El shell offline y su guard de mutaciones recibieron revisión independiente en el [PR #50](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/50); el [run 36237373441](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/36237373441) pasó `validate` y `database`. La prueba live continúa pendiente. | Registrar evidencia verificable de integración sin confundir CI con reachability real ni atribuir un despliegue. |
| 2026-09-26 | 1.30.0 | Se implementó localmente un service worker de allowlist pública cerrada, fallback HTML estático para navegaciones fallidas, registro browser-only y un guard accesible que bloquea mutaciones offline preservando los formularios y se retira al reconectar. Pruebas enfocadas verifican registro, conectividad, bloqueo/recuperación y política de caché. Revisión, PR, CI y prueba live permanecen pendientes. | Cerrar la decisión abierta del shell offline sin declarar datos offline ni atribuir evidencia operativa no ejecutada. |
| 2026-09-25 | 1.29.2 | El [PR #43](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/43) integró mediante squash la notificación durable `REJECTED` como `1daf8cc85bbc48a0465496e5f2f95b2289f60a2b`; `validate` y `database` concluyeron `SUCCESS` en el [run post-merge 36126495899](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/36126495899). La prueba live de Chatwoot o SMTP continúa pendiente. | Cerrar la evidencia técnica de integración sin atribuir un envío real ni adelantar el estado global de booking. |
| 2026-09-25 | 1.29.1 | La extensión durable `REJECTED` recibió revisión independiente y el [PR #43](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/43) permanece abierto y revisó la implementación `76f5c1c`; `validate` y `database` concluyeron `SUCCESS` en el [run 36123518176](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/36123518176). Merge y prueba live continúan pendientes. | Registrar evidencia verificable de revisión y CI sin confundir un PR abierto con integración ni atribuir envíos reales. |
| 2026-09-25 | 1.29.0 | Se implementó localmente la intención y entrega conservadora de notificación cuando el OWNER rechaza una solicitud free-choice vigente: outbox tenant-safe sin contenido/PII, Chatwoot preferido, fallback SMTP, `NO_ROUTE`, retries acotados y `UNKNOWN` sin reenvío. Revisión, PR, CI y prueba live permanecen pendientes. | Completar el aviso al cliente sin alterar la idempotencia del rechazo, llamar a Google ni introducir otro scheduler o proveedor. |
| 2026-09-23 | 1.28.0 | Se reconciliaron los estados vigentes de elección libre, galería y despliegue Cloudflare; se registró la evidencia live local ya obtenida y se añadió un handoff verificable para continuar la publicación en otro chat. El PR #42 sigue abierto y no existe despliegue remoto. | Evitar que el siguiente chat repita trabajo integrado o confunda preparación y CI con producción operativa. |
| 2026-09-23 | 1.27.0 | Se sustituyeron los orígenes custom-domain no disponibles por endpoints `workers.dev` exactos para producción y staging, incluidos Wrangler, acciones SSR, OAuth y runbook. No se desplegó ni se afirmó activación live de Images. | Habilitar un primer despliegue sin dominio comprado y eliminar contratos contradictorios. |
| 2026-09-23 | 1.26.0 | Se preparó localmente el artefacto SSR para Cloudflare Workers, entornos staging/production, endpoints operativos, adaptación de imágenes y runbook de despliegue/rollback. Revisión, PR, CI, activación de Images, migraciones Cloud y todo despliegue o prueba live permanecen pendientes. | Elegir y validar técnicamente el hosting sin atribuir evidencia operativa ni mover Supabase Cloud. |
| 2026-09-18 | 1.25.0 | Candidato local de decisión OWNER para elección libre: rechazo durable, aprobación Google recuperable, terminal público mínimo, 42 pruebas pgTAP conductuales y carreras PostgreSQL reales en ambos órdenes approve/reject. Revisión, PR, CI y prueba live permanecen pendientes. | Completar el control humano de DEC-007 sin afirmar despliegue ni evidencia operativa externa. |
| 2026-09-18 | 1.24.0 | El PR #37 integró la solicitud pendiente de elección libre por caso tras revisión, CI, reset limpio, pgTAP y gate de aplicación. No incluyó aprobación, Google Event, notificación ni evidencia live. | Cerrar el corte de selección libre sin confundir la solicitud con una cita confirmada. |
| 2026-09-17 | 1.23.0 | Se implementó localmente el primer corte de elección libre: emisión/rotación OWNER same-origin por artista, token hash-only, configuración acotada, consulta pública de candidatos con FreeBusy y holds, respuesta mínima y cabeceras defensivas. Pasaron 17 tests enfocados, `pnpm run check` con 491 tests y 24 asserts pgTAP transaccionales; revisión, PR, CI y prueba live quedan pendientes, y no existe selección, hold ni aprobación libre. | Permitir consulta segura de huecos sin afirmar ni crear una reserva y mantener explícito el gate posterior de selección/aprobación. |
| 2026-09-17 | 1.22.1 | El PR #31 integró la restauración OWNER y una prueba live sintética confirmó el recorrido, pero reveló que cada ciclo `DISCARD → RESTORE` incrementaba la posición. Se corrige localmente restore para conservar exactamente la posición reservada por la fila, sin normalizar históricos ni alterar otros assets; revisión, PR y CI quedan pendientes. | Evitar deriva de orden aprovechando que el constraint global de unicidad impide reutilizar la posición incluso mientras el asset está `DISCARDED`. |
| 2026-09-17 | 1.22.0 | El PR #30 integró el web component con `validate` y `database` verdes; las pruebas en webs externas y toda evidencia live de Storage siguen pendientes. Se implementó localmente la restauración OWNER de `DISCARDED` a `DRAFT` con listado privado acotado, formulario exacto handle-only, RPC auth-bound tenant-safe, lock común por estudio e idempotencia ante respuesta perdida. GC continúa pendiente de una política explícita. | Cerrar la recuperación editorial sin tocar Storage ni anticipar una purga que todavía no dispone de retención, grace period o reconciliación segura. |
| 2026-09-17 | 1.21.0 | El PR #29 integró el feed/API de galería con `validate` y `database` verdes, sin evidencia live de Storage. Se implementó localmente `<inkendar-gallery>` con contrato mínimo, Shadow DOM accesible, fetch CORS sin credenciales, origen derivado del asset u override explícito, validación defensiva, imágenes responsivas y pipeline reproducible al asset estable; revisión/CI y pruebas en webs externas siguen pendientes. | Completar la vía de instalación rápida sin asumir el dominio del cliente, introducir credenciales o confundir validación sintética con evidencia live. |
| 2026-09-17 | 1.20.0 | El PR #28 integró publicación/retirada recuperable con CI verde, sin evidencia live de Storage. Se implementó localmente el feed/API público read-only con slugs estables, filtrado exclusivo `PUBLISHED`, variantes públicas, ETag/304, caché 60 s, CORS, cabeceras defensivas y límite portable; web component, revisión/PR/CI del feed, pgTAP local —bloqueado por Docker no disponible— y prueba live siguen pendientes. | Entregar el contrato de contenido para webs sin abrir tablas ni filtrar IDs, bindings, masters, privados o secretos, y distinguir evidencia unitaria local de CI y operación live. |
| 2026-09-16 | 1.19.0 | El PR #27 integró la curación privada con CI verde. Se implementó localmente la publicación/retirada OWNER recuperable: estados forward-only, binding público opaco único, begin/finalize tenant-safe, copia server-only de DISPLAY/THUMB WebP a bucket público con upsert/cache 300 s, retirada idempotente y UI SSR de retry. Feed, endpoint público, CDN, componente, revisión/PR/CI y prueba live siguen pendientes. | Publicar únicamente derivados sanitizados y hacer recuperables respuestas Storage ambiguas sin exponer key, paths, URLs, master ni IDs internos. |
| 2026-09-16 | 1.18.0 | El PR #26 integró con CI verde la ingestión privada y el proxy de miniaturas, sin prueba live. Se implementó localmente la curación OWNER de DRAFT mediante handle opaco: alt/destino/artista same-tenant, append al reasignar, MOVE_UP/MOVE_DOWN atómicos y descarte recuperable DISCARDED sin borrar Storage; revisión, PR y CI quedan pendientes. | Completar la preparación privada y ordenable antes de diseñar publicación o cualquier superficie pública. |
| 2026-09-16 | 1.17.0 | Se implementó localmente la ingestión privada OWNER de galería y portfolios: límites 10 MiB/12000 px/40 MP, rechazo de animación, re-encode WebP sin metadata, master sanitizada, display/thumb sin upscale, Storage privado con compensación, RPC ligada a `auth.uid()` y listado SSR/proxy con handle opaco, sin URL firmada en HTML. Publicación y feed siguen fuera de alcance; revisión, PR y CI pendientes. La agenda ARTIST quedó integrada mediante PR #25 y CI verde, sin atribuir prueba live. | Preparar contenido privado tenant-safe antes de abrir cualquier superficie pública y sincronizar el gate real de agenda. |
| 2026-09-16 | 1.16.0 | Se implementó localmente la agenda SSR privada y read-only de ARTIST con salida mínima, límite 50, frontera inclusiva de próximas citas, zona explícita y RPC tenant-safe; revisión, PR y CI siguen pendientes. La UI no ofrece mutaciones de agenda y conserva únicamente el logout global de seguridad de sesión. El fallback SMTP se sincronizó con su integración mediante PR #24 y CI verde, sin atribuirle prueba live. | Preparar al artista con el contexto estrictamente necesario sin acceso a conversaciones, PII, IDs, Google o mutaciones de agenda y eliminar estado documental obsoleto. |
| 2026-09-16 | 1.15.0 | Se implementó localmente el fallback SMTP server-only por estudio: Chatwoot sigue siendo preferido, email se obtiene tenant-safe solo en memoria, falta de ruta/configuración termina `NO_ROUTE`, y rechazos/ambigüedades conservan `FAILED`/`UNKNOWN`. Revisión, PR/CI y prueba live siguen pendientes. | Completar el canal de respaldo con transporte estándar y seguro sin persistir destinatarios, contenido ni credenciales y sin escoger un SaaS de email. |
| 2026-09-16 | 1.14.0 | Se implementó e integró mediante el PR #23 el primer corte server-only de notificaciones y scheduler: intención única al confirmar/caducar, expiración global acotada que preserva `INSERTING`/`CONFIRMED`, ruta Chatwoot original inequívoca, leases, reintentos acotados y terminales `UNKNOWN`/`NO_ROUTE`. PR y CI pasaron; la prueba live sigue pendiente. | Hacer observable y recuperable el aviso de booking sin asumir idempotencia de Chatwoot, persistir contenido ni elegir hosting cron. |
| 2026-09-16 | 1.13.0 | Una prueba live totalmente sintética verificó la conexión con los tres scopes, FreeBusy y exclusión de ocupación, candidatos exactos, oferta de una opción, enlace y selección pública, creación de un único evento privado/opaco sin asistentes, persistencia final `CONFIRMED`/`FINALIZED` y reintento `RECONCILE_ONLY` sin duplicados. | Cerrar la evidencia live del recorrido preaprobado sin atribuir notificaciones, scheduler, elección libre, aprobación posterior, edición o cancelación no verificadas. |
| 2026-09-15 | 1.12.1 | La confirmación recuperable pasó a `DONE` técnico tras integrar el PR #20 como `676aa68088d13ada1474fb029d51d4eee1c3993f`; el run de PR 35031807319 y el run post-merge 35032036887 pasaron Node 24, migraciones limpias, 442 aserciones pgTAP y Auth/RLS. No se ejecutó ninguna prueba live. | Cerrar el gate técnico sin atribuir evidencia de Google Events live ni anticipar notificaciones, scheduler o booking extremo a extremo. |
| 2026-09-15 | 1.12.0 | La confirmación recuperable queda como candidato local `IN_PROGRESS`: claim/lease durable con una sola autoridad de inserción y ambos scopes operativos obligatorios, binding inmutable previo al efecto, `READY` expirable, `INSERTING` recuperable después de `expires_at` y materialización serializada antes de reofertar, además de reconciliación por ID determinista, FreeBusy final, cita/relación atómica, ACL privada `writer|owner` y CAS de generación de credencial. Revisión, integración/CI y pruebas live continúan pendientes. | Corregir grants incompletos, carreras de inserción, caducidad y creación de ofertas, crash/reasignación e `invalid_grant` tardío sin atribuir evidencia live ni anticipar notificaciones, scheduler, elección libre o cancelación. |
| 2026-09-15 | 1.11.1 | La selección pública de una opción preaprobada pasó a `DONE` tras verificar el PR #18 y el CI posterior al merge con Node 24, migraciones limpias, 324 aserciones pgTAP y Auth/RLS; no se ejecutó ninguna prueba live. | Cerrar el gate técnico sin confundir la selección pendiente con confirmación Google ni anticipar FreeBusy final, Events, notificaciones o scheduler. |
| 2026-09-15 | 1.11.0 | Se implementó localmente la selección pública atómica e idempotente de una opción preaprobada, con selector separado, estado pendiente de confirmación, hold elegido activo y caducidad; revisión, CI, Google Events y pruebas live quedan pendientes. | Entregar la intención del cliente de forma segura sin afirmar todavía una cita confirmada ni anticipar la integración Google. |
| 2026-09-15 | 1.10.1 | El acceso público de solo lectura a ofertas vigentes pasó a `DONE` tras verificar el PR #16 y el CI posterior al merge con Node 24, migraciones limpias, pgTAP y Auth/RLS; no se ejecutó ninguna prueba live. | Cerrar el gate técnico sin anticipar selección, eventos, confirmación, notificaciones ni scheduler. |
| 2026-09-15 | 1.10.0 | Se implementó localmente el acceso público de solo lectura a ofertas vigentes con emisión/rotación OWNER, token hash-only, respuesta mínima y cabeceras defensivas; integración, CI, selección y pruebas live quedan pendientes. | Entregar el siguiente corte vertical verificable sin anticipar escritura pública ni confirmar citas. |
| 2026-09-15 | 1.9.1 | El núcleo técnico OWNER de ofertas preaprobadas, holds y caducidad pasó a `DONE` tras verificar el PR #14 y el CI posterior al merge con Node 24, migraciones limpias, pgTAP y Auth/RLS; no se ejecutó ninguna prueba live. | Cerrar el gate técnico sin anticipar selección pública, eventos, confirmación, notificaciones ni scheduler. |
| 2026-09-15 | 1.9.0 | Se implementó localmente el núcleo OWNER de ofertas preaprobadas, holds tenant-safe, plazo configurable y expiración idempotente; la integración/CI y todo recorrido live permanecen pendientes. | Reservar opciones en disponibilidad sin anticipar selección pública, confirmación, eventos, notificaciones ni scheduler. |
| 2026-09-15 | 1.8.1 | La disponibilidad técnica por artista pasó a `DONE` tras verificar el PR #12 con 215 pruebas, build, migraciones limpias, 232 aserciones pgTAP y el CI posterior al merge; FreeBusy live continúa `IN_PROGRESS`. | Cerrar el gate técnico sin atribuir al CI una prueba operativa contra Google. |
| 2026-09-15 | 1.8.0 | Se implementó la configuración OWNER y previsualización técnica de disponibilidad con reglas IANA, FreeBusy incremental y límites de rango/duración; CI y prueba live FreeBusy siguen `IN_PROGRESS`. | Preparar candidatos sin afirmar ni crear citas y registrar por separado la evidencia live ya obtenida de OAuth/listado/asignación. |
| 2026-09-15 | 1.7.2 | Se eliminó progreso duplicado de README y PRODUCT, se sincronizaron el piloto cero, Google y CI con los slices integrados, y se corrigió la separación ya completada de la landing. | Mantener esta especificación como única fuente de verdad sin resúmenes activos contradictorios ni alterar evidencia histórica. |
| 2026-09-14 | 1.7.1 | El contrato técnico de Google OAuth y asignación de calendarios pasó a `DONE` tras verificar rutas SSR, migración limpia, 34 aserciones pgTAP, 188 pruebas y build; el recorrido live con Google continúa `IN_PROGRESS`. | Cerrar la implementación y la persistencia sin atribuir al CI una validación operativa contra el proveedor real. |
| 2026-09-14 | 1.7.0 | Se fijó el contrato de conexión Google OAuth y asignación de un calendario por artista con estado `IN_PROGRESS`. | Habilitar la configuración mínima de Calendar antes de implementar disponibilidad, eventos y booking. |
| 2026-09-14 | 1.6.1 | El contrato técnico de conversaciones OWNER pasó a `DONE` tras verificar en CI migraciones limpias, pgTAP, Auth/RLS, 156 pruebas y build; el recorrido live con Chatwoot continúa `IN_PROGRESS`. | Cerrar la implementación y la persistencia sin atribuir al CI una validación operativa contra el proveedor real. |
| 2026-09-14 | 1.6.0 | Se implementó el corte mínimo OWNER de conversaciones, mensajes, respuesta, vínculo cliente/caso y webhook idempotente; la prueba Postgres real queda pendiente. | Avanzar la operación oculta sobre Chatwoot sin copiar mensajes ni introducir canales o capacidades fuera del MVP. |
| 2026-09-14 | 1.5.2 | El toolchain del software migra de npm a pnpm 10.22.0 con workspace, lockfile y CI sincronizados. | Unificar el gestor con la landing y mantener una instalación reproducible sin alterar contratos de producto. |
| 2026-09-13 | 1.5.1 | Clientes y casos de tatuaje pasaron a `PASS` tras verificar migración limpia, seed, 117 aserciones pgTAP —58 del slice— y el smoke Auth/RLS en CI. | Cerrar el slice con evidencia real de Postgres, aislamiento tenant, permisos y relaciones compuestas sin confundirlo con booking o integraciones posteriores. |
| 2026-09-13 | 1.5.0 | Se implementó el slice owner de clientes y casos con estados mínimos, formularios SSR privados, aislamiento RLS y relaciones tenant compuestas; la prueba Postgres real queda pendiente. | Habilitar el contexto operativo básico sin introducir Chatwoot, archivos, calendario, booking, notificaciones ni acceso del artista. |
| 2026-09-13 | 1.4.1 | La autenticación PWA pasó a `PASS` tras verificar en CI el registro público cerrado y el recorrido Auth/RLS/cookies/guards/logout de OWNER y ARTIST en dos tenants. | Cerrar el slice con evidencia real del proveedor y del aislamiento sin declarar implementados el service worker ni la suspensión explícita de accesos. |
| 2026-09-13 | 1.4.0 | Se implementaron login, cookies SSR, guards, logout y shells por rol; el smoke real quedó en CI pendiente de evidencia verde. | Habilitar acceso básico sin confundir implementación con validación extremo a extremo. |
| 2026-09-13 | 1.3.2 | El alta manual gestionada pasó a `PASS` tras verificar migraciones limpias, seed y 59 aserciones pgTAP en CI. | Cerrar el slice con evidencia real de Supabase/Postgres sin declarar completas la autenticación, la sesión ni su UI. |
| 2026-09-13 | 1.3.1 | El alta manual converge tras una respuesta RPC perdida, evita duplicados y conserva Auth cuando el resultado de persistencia sigue siendo ambiguo. | Impedir que la compensación elimine una identidad vinculada a una transacción ya confirmada. |
| 2026-09-13 | 1.3.0 | Se implementó el CLI y el núcleo del alta manual gestionada, con compensación Auth/DB y pruebas de aplicación e infraestructura; la integración pgTAP queda pendiente del job `database`. | Habilitar la provisión operada de estudios, owners y artistas sin declarar login ni autoservicio disponibles. |
| 2026-09-13 | 1.2.2 | El flujo de entrega pasó a `PASS` tras integrar el primer slice con los checks `validate` y `database` requeridos. | Registrar evidencia de PR, protección de `main` y CI posterior al merge sin confundir el estado técnico con trabajo funcional pendiente. |
| 2026-09-13 | 1.2.1 | Se verificó el aislamiento de identidad con 38 aserciones pgTAP contra Supabase/Postgres real en CI. | Cerrar el gate técnico con evidencia reproducible y conservar la limitación local de Docker como un detalle del entorno. |
| 2026-09-13 | 1.2.0 | Se añadió el primer slice de identidad multi-tenant con esquema versionado, datos sintéticos, RLS y pruebas pgTAP preparadas. | Establecer el aislamiento de estudios antes de añadir UI, integraciones o datos operativos; la prueba real sigue pendiente del daemon local. |
| 2026-09-13 | 1.1.0 | Se añadió la base ejecutable full-stack, el grafo de workspaces y el primer workflow de CI. | Empezar los slices de producto sobre una estructura compilable, portable y comprobada automáticamente. |
| 2026-09-13 | 1.0.0 | Se inicializó el repositorio exclusivo del software y se trasladó aquí su fuente de verdad. | Comenzar la implementación sin mezclar dependencias ni estado con la landing comercial. |
| 2026-09-13 | 0.9.0 | Se separaron definitivamente los repositorios de landing y software. | Permitir CI, dependencias y despliegues independientes para marketing y plataforma. |
| 2026-09-13 | 0.8.0 | Se consolidaron las fuentes activas, se retiró el backlog contradictorio y se separó el gate técnico del comercial. | Empezar el desarrollo con datos sintéticos sin arrastrar roles, canales ni prioridades descartados. |
| 2026-09-13 | 0.7.0 | Se incorporó Engram en modo piloto y se definieron límites de escritura, recuperación y verificación. | Reducir el contexto repetido entre chats manteniendo Git, pruebas y documentos vivos como fuentes de verdad. |
| 2026-09-13 | 0.6.0 | Se limitó el contexto de cada agente y se formalizó el handoff entre chats. | Evitar sesiones largas con contexto mezclado y obligar a verificar decisiones en el repositorio. |
| 2026-09-13 | 0.5.0 | Se adoptó el flujo de dos agentes, Pull Request y CI obligatorio. | Separar implementación e integración y proteger `main` con validación automática. |
| 2026-09-10 | 0.4.0 | Se ratificó el monolito modular y TDD obligatorio para todo comportamiento de producción. | Fijar la disciplina técnica antes del primer slice de implementación. |
| 2026-09-10 | 0.3.0 | Se separó la landing comercial y se definió la publicación de galerías hacia webs nuevas o existentes. | Evitar mezclar marketing de Inkendar con contenido de estudios y hacer opcional la venta de una web. |
| 2026-09-10 | 0.2.0 | Se añadieron gobierno vivo, progreso, roles owner/artista, PWA, Chatwoot oculto, ofertas de fechas, caducidad, galerías y arquitectura propuesta. | Convertir las decisiones de producto en contratos rastreables antes de implementar. |
| 2026-09-02 | 0.1.0 | Se fijaron identidad, canales iniciales, salida de WhatsApp y Google Calendar como agenda operativa. | Ajustar el alcance a la evidencia obtenida en el piloto cero. |

## 0. Decisión vigente

### Identidad

- **Inkendar** es el producto.
- **Incamdi** es la agencia que lo configura, implanta y mantiene durante la validación.
- La landing comercial vive en el repositorio `marcosAlvarezCalabria/inkendar` y no forma parte de este software, las webs ni los datos de los estudios.
- La construcción o renovación de una web se vende aparte por Incamdi cuando el estudio no dispone de una.
- Si el estudio ya tiene web, se conecta a Inkendar sin sustituirla mediante un componente integrable o una API pública de contenido.

### Producto que validamos

El primer producto vendible será un **servicio gestionado**, no un SaaS autoservicio. Incamdi conectará para cada estudio:

- el chat de su web;
- su cuenta profesional de Instagram;
- su página de Facebook/Messenger;
- su Google Calendar.

Las conversaciones se atenderán íntegramente dentro del panel de Inkendar. Chatwoot funcionará como motor de mensajería oculto mediante API y webhooks. El owner no necesitará abrir Chatwoot para operar el estudio.

En el detalle, el owner puede ver imágenes entrantes admitidas con su texto original; los adjuntos no soportados muestran un placeholder. La respuesta del estudio continúa limitada a texto.

Inkendar será una PWA instalable y adaptada a móvil, tablet y escritorio. El owner administrará el estudio; los artistas tendrán una vista privada de solo lectura con su agenda y el contexto necesario para preparar cada tatuaje.

**WhatsApp queda fuera del MVP y de la promesa comercial actual.** Podrá reevaluarse posteriormente mediante WhatsApp Cloud API y Coexistence, pero no bloquea el piloto ni se anunciará como disponible.

La propuesta de valor vigente es:

> Inkendar reúne los mensajes de tu web, Instagram y Facebook en una sola bandeja y los conecta con tu Google Calendar para ayudarte a convertir consultas en citas sin perder contexto.

El recorrido principal es:

```text
Web / Instagram / Facebook
            ↓
     bandeja de Inkendar
            ↓
 owner clasifica y asigna
            ↓
 huecos u opciones de fecha
            ↓
 cliente elige / owner aprueba
            ↓
 cita y aviso de confirmación
```

### Evidencia actual

- **Web: PASS.** El widget de Chatwoot recibe mensajes y permite responder.
- **Instagram: PASS.** Los mensajes llegan y las respuestas regresan al canal original.
- **Facebook Messenger: CONNECTED / pendiente de prueba bidireccional final.**
- **Asignación: PARTIAL.** La atención funciona asignando manualmente la conversación; la asignación automática continúa pendiente de localizar y validar.
- **WhatsApp: DEFERRED.** El flujo manual exige un número dedicado o migrado; conservar el número en la aplicación requiere Coexistence. Se retira del MVP.
- **Google Calendar: IN_PROGRESS.** OAuth, listado y asignación live pasaron con owner sintético el 2026-09-15. El 2026-09-16 una prueba live sintética verificó FreeBusy, oferta preaprobada, enlace, selección pública, Google Events, confirmación persistida y reconciliación sin duplicados. Disponibilidad, ofertas/holds, acceso, selección, confirmación recuperable y scheduler Chatwoot están técnicamente integrados; el fallback SMTP local está `IN_PROGRESS` y pendiente de revisión, CI y live.

Un canal no pasa a `PASS` por estar conectado: debe demostrarse recepción y respuesta de extremo a extremo con datos sintéticos.

### Alcance funcional del MVP gestionado

1. **Alta operada:** Incamdi configura manualmente el espacio aislado del estudio, agentes, bandejas y conexiones.
2. **Chat web:** mensaje entrante y respuesta bidireccional mediante widget en una web HTTPS.
3. **Instagram:** recepción y respuesta mediante la conexión oficial disponible en Chatwoot.
4. **Facebook Messenger:** recepción y respuesta desde la página autorizada por el estudio.
5. **Panel único:** el owner recibe y responde mensajes desde Inkendar; Chatwoot permanece oculto.
6. **Roles:** el owner opera todo el estudio. El artista solo consulta sus citas y el contexto necesario, sin responder clientes ni modificar imágenes.
7. **Google OAuth centralizado:** el owner conecta una cuenta Google del estudio con acceso a un calendario separado por artista y permisos mínimos.
8. **Disponibilidad:** Inkendar combina jornada, zona horaria, duración, márgenes, bloqueos provisionales y `freeBusy`; no muestra títulos ni descripciones de eventos existentes.
9. **Opciones preaprobadas:** el owner puede enviar hasta tres fechas. Se reservan provisionalmente durante 24 horas por defecto; el plazo es configurable por estudio.
10. **Elección libre:** el cliente consulta candidatos mediante un enlace seguro ligado a su caso y puede seleccionar uno; Inkendar revalida FreeBusy y holds y crea una solicitud durable `PENDING_OWNER_APPROVAL`. La solicitud, aprobación/rechazo OWNER, Google Event recuperable y terminal seguro quedaron integrados mediante los PR #37 y #38. La notificación durable de rechazo quedó integrada mediante el PR #43 con CI post-merge verde; la prueba live sigue pendiente.
11. **Confirmación:** una opción preaprobada se confirma al elegirla. Una opción libre requiere visto bueno del owner. En ambos casos Inkendar vuelve a comprobar disponibilidad antes de confirmar.
12. **Caducidad:** al vencer el plazo, se liberan los bloqueos y se avisa al cliente de que los horarios pueden ofrecerse a otra persona.
13. **Notificaciones:** confirmaciones, caducidades y el rechazo de una solicitud free-choice usan una ruta original Chatwoot inequívoca como primera opción y SMTP configurado por estudio como fallback cuando existe email válido. El estado es durable y no existe reenvío automático tras ambigüedad. La extensión de rechazo quedó integrada mediante el PR #43 con CI post-merge verde; la prueba live y los recordatorios continúan pendientes.
14. **Contexto mínimo:** canal y conversación de origen, contacto disponible, resumen, artista, duración, referencias, oferta, cita e identificadores externos.
15. **Publicación web:** el owner administra en Inkendar la galería general y las imágenes asociadas a cada artista. Inkendar publica únicamente el contenido aprobado mediante un feed público de solo lectura. Una web creada por Incamdi o una web existente consumen el mismo contrato.
16. **Privacidad y aislamiento:** cada estudio mantiene separados conversaciones, conexiones, credenciales, calendarios y datos.
17. **Recuperación:** existen procedimientos para permisos caducados, reconexiones, revocación y mensajes, imágenes o reservas fallidos.

Los permisos previstos de Google Calendar son los mínimos que permitan consultar disponibilidad y gestionar eventos autorizados. Los tokens se almacenan únicamente en backend y nunca aparecen en el navegador, logs o documentación.

### Fuentes de verdad por dato

- **Chatwoot:** conversaciones y mensajes durante el MVP gestionado.
- **Google Calendar:** disponibilidad y evento operativo de la cita.
- **Inkendar/Supabase:** estudios, membresías, reglas de disponibilidad, relaciones entre conversación, caso y evento, y auditoría del dominio.

No habrá dos fuentes editables del mismo mensaje o evento. Inkendar almacenará identificadores externos y estado de sincronización, no copias divergentes presentadas como autoritativas.

El caso de tatuaje continúa separado de la cita: un caso puede requerir varias sesiones y una conversación puede existir sin haberse convertido todavía en caso.

### Contrato entre Inkendar y las webs de estudios

Inkendar actúa como fuente de contenido para galerías, no como editor visual de páginas. El owner realiza todas las escrituras desde la PWA autenticada. Las webs solo reciben contenido marcado como publicado.

Existen dos vías comerciales:

1. **Estudio sin web:** Incamdi entrega una web basada en una plantilla adaptable, conectada al feed público de Inkendar.
2. **Estudio con web:** se instala un web component agnóstico del framework o se consume el feed mediante una integración a medida. No es necesario migrar ni rehacer la web.

El contrato público mínimo contiene:

```text
StudioGallery
├── studio_public_slug
├── updated_at
├── gallery_images[]
│   ├── public_id
│   ├── image_variants
│   ├── alt_text
│   ├── position
│   └── published_at
└── artists[]
    ├── artist_public_slug
    ├── display_name
    └── portfolio_images[]
```

El feed no expone usuarios, clientes, casos, conversaciones, calendarios, originales privados ni identificadores internos. Se sirve mediante CDN, admite invalidación al publicar y aplica límites de tráfico. El web component no contiene credenciales administrativas.

La primera integración ofrece dos modos:

- **Web component:** instalación rápida en HTML, WordPress o constructores que admitan scripts; Inkendar controla el comportamiento del bloque y la web puede adaptar variables visuales permitidas.
- **API/feed:** integración para webs a medida; el estudio conserva su diseño y el desarrollador representa los datos publicados.

El flujo es:

```text
Owner publica en Inkendar
          ↓
Supabase guarda original privado y variantes públicas
          ↓
Servicio público entrega solo el contenido publicado
          ↓
Web nueva de Incamdi o web existente del estudio
```

### Criterios críticos vigentes

#### Disponibilidad sin revelar eventos privados

```gherkin
Given un owner que conectó la cuenta Google del estudio y asignó un calendario a un artista
When consulta disponibilidad para una duración concreta
Then Inkendar devuelve únicamente intervalos candidatos libres
And respeta zona horaria, jornada, duración, márgenes y bloqueos provisionales
And no expone títulos ni descripciones de eventos existentes
```

#### Opciones preaprobadas

```gherkin
Given que el owner ofreció hasta tres fechas con una caducidad visible
When el cliente elige una antes del vencimiento
Then Inkendar vuelve a comprobar que continúa libre
And confirma un único evento en el calendario del artista
And libera inmediatamente las demás opciones
And avisa al cliente por el canal configurado
```

#### Caducidad

```gherkin
Given una oferta provisional sin elección del cliente
When alcanza su fecha de vencimiento
Then Inkendar libera todas sus opciones de forma idempotente
And permite ofrecérselas a otros clientes
And informa al cliente de que la oferta ha caducado
```

#### Consulta pública de huecos para elección libre

```gherkin
Given un cliente con un enlace seguro vigente ligado a un artista, rango y duración
When consulta el enlace
Then Inkendar combina reglas, Google FreeBusy y holds vigentes y devuelve solo intervalos candidatos acotados
And muestra artista, zona y caducidad sin eventos, IDs, tokens ni datos de otros tenants
And explica que los huecos son orientativos y requieren aprobación posterior
And no permite seleccionar, bloquear ni crear una reserva en este corte
```

#### Elección libre pendiente de aprobación

```gherkin
Given un cliente con un enlace seguro vigente a los huecos de un artista
When selecciona un intervalo que no fue preaprobado por el owner
Then Inkendar crea una solicitud provisional y avisa al owner
And el owner puede rechazarla o iniciar una aprobación recuperable
And `APPROVING` nunca comunica una cita confirmada
And vuelve a comprobar Google Calendar antes de insertar exactamente un evento privado
And solo `CONFIRMED` muestra confirmación e intervalo en el mismo enlace
```

#### Vista del artista

```gherkin
Given un artista autenticado con identidad coherente
When abre su agenda
Then solo ve sus próximas citas CONFIRMED ordenadas y acotadas
And cada fila contiene intervalo y zona explícitos, nombre visible del cliente, resumen, zona corporal y tamaño si existen
And no contiene contacto, conversaciones, Google, tokens, IDs internos, notas ni referencias
And no puede leer citas de otros artistas o tenants
And no puede responder clientes, confirmar o cancelar citas, ni modificar contenido
```

#### Publicación en una web existente

```gherkin
Given un estudio que ya dispone de una web compatible
And el owner publicó imágenes desde Inkendar
When la web solicita la galería mediante el componente o el feed público
Then recibe únicamente imágenes publicadas y optimizadas de ese estudio
And no recibe datos privados ni credenciales
And una imagen retirada deja de aparecer después de invalidar la caché acordada
```
#### Galería y portfolios

```gherkin
Given un owner autenticado que sube una imagen válida como borrador
When la asigna a la galería general o al portfolio de un artista de su estudio
Then Inkendar verifica bytes y decoder con límites de 10 MiB, 12000 px y 40 megapíxeles
And rechaza animación, multipágina, corrupción y formatos ajenos
And guarda solo una master sanitizada y variantes WebP privadas sin upscale
And la lista usa una ruta same-origin con handle opaco y proxy OWNER
And ninguna URL firmada, token, bucket, path o ID interno aparece en HTML
```

```gherkin
Given un owner autenticado y borradores DRAFT de su estudio
When edita el alt o destino, los mueve un paso o descarta uno desde /app/owner/gallery
Then Inkendar resuelve el asset solo por handle opaco y auth.uid()
And create, reasignación, reorder y descarte toman primero un lock común por estudio antes de row locks, sin bloquear estudios distintos
And el descarte conserva metadata y objetos privados como DISCARDED
And solo DRAFT admite curación; el listado y proxy OWNER incluyen además PUBLISHING, PUBLISHED y RETIRING, pero ocultan DISCARDED y RETIRED
```

```gherkin
Given un owner autenticado y un asset DISCARDED de su estudio identificado solo por handle opaco
When consulta la sección separada de descartados y envía RESTORE mediante POST same-origin
Then Inkendar muestra como máximo 100 descartes con metadata editorial segura y sin miniaturas
And toma primero el lock común del estudio, cambia DISCARDED a DRAFT y conserva exactamente la posición reservada por la fila
And conserva target, artista, alt, variantes privadas y cualquier binding sin tocar Storage
And repetir RESTORE sobre ese asset ya DRAFT converge sin volver a moverlo
```

```gherkin
Given un owner autenticado y un asset DRAFT identificado solo por handle opaco
When solicita PUBLISH mediante POST same-origin
Then Inkendar fija una única publication key aleatoria antes de Storage y cambia a PUBLISHING
And copia únicamente DISPLAY y THUMB WebP a paths derivados de esa key, nunca MASTER
And solo después de verificar ambos uploads finaliza PUBLISHED con published_at
And un retry reutiliza binding y paths; PUBLISHED converge sin tocar Storage
When el owner solicita RETIRE sobre PUBLISHED
Then Inkendar cambia primero a RETIRING, elimina ambos objetos públicos idempotentemente y finaliza RETIRED con retired_at
And un fallo o respuesta ambigua conserva el estado intermedio reintentable y todos los objetos privados
```

### Modelo de entrega y gates

El onboarding será manual. Se empezará con un estudio y se ampliará como máximo a tres–cinco pilotos después de medir:

- tiempo total de configuración;
- tiempo de soporte mensual;
- incidencias de permisos o reconexión;
- mensajes gestionados y consultas convertidas en cita;
- disposición a continuar pagando.

Gates iniciales para ampliar:

- configuración repetible en 90 minutos o menos;
- soporte ordinario de 30 minutos o menos por estudio y mes;
- los tres canales anunciados pasan la prueba bidireccional;
- ninguna exposición de datos entre estudios;
- Google Calendar consulta y crea citas sin confirmaciones falsas;
- al menos un estudio utiliza el recorrido con datos reales autorizados y acepta pagar.

### Orden inmediato

El desarrollo técnico con datos sintéticos puede comenzar mientras se completa la validación comercial. Los gates bloquean datos reales, promesas comerciales y cobro; no bloquean CI, contratos, pruebas ni infraestructura local.

1. Completar en paralelo la prueba bidireccional de Facebook Messenger.
2. Validar, con autorización explícita y cuentas sintéticas, los recorridos live de Chatwoot, Google FreeBusy, Google Events y booking; OAuth, listado y asignación live ya pasaron.
3. Validar live el recorrido completo de notificaciones/scheduler ya integrado y completar avisos todavía fuera de alcance.
4. Revisar e integrar la corrección de estabilidad de posición en restore; la restauración recuperable OWNER ya quedó integrada mediante el PR #31 y tuvo prueba live sintética el 2026-09-17, mientras la evidencia live de Storage sigue pendiente.
5. Probar el web component integrado en una web nueva y otra existente.
6. Verificar privacidad, exportación, monitorización y onboarding antes de datos reales.
7. Ejecutar el recorrido completo con un estudio piloto cualificado antes de cobrar.
### Fuera del MVP vigente

- WhatsApp y cualquier promesa de Coexistence;
- conexiones no oficiales mediante sesiones de WhatsApp Web;
- reserva completamente automática o decidida por IA;
- una agenda propietaria que sustituya Google Calendar;
- Apple Calendar, Outlook y otros proveedores;
- pagos, consentimientos médicos, campañas, POS, inventario, contabilidad;
- onboarding y billing autoservicio;
- aplicación móvil nativa y self-hosting.

## Condiciones para piloto y venta

Antes de utilizar datos reales deben estar comprobados aislamiento, privacidad, tratamiento de datos, eliminación, recuperación y ausencia de información sensible en logs y memoria.

Antes de cobrar deben funcionar de extremo a extremo las capacidades anunciadas, existir onboarding y soporte documentados, y al menos un estudio piloto cualificado debe aceptar continuar pagando. La hipótesis de precio permanece propuesta hasta entonces.

## Métricas de validación

- estudios que completan onboarding y reciben su primera consulta;
- tiempo hasta la primera revisión del owner;
- consultas convertidas en caso y en cita;
- ofertas elegidas, caducadas o rechazadas;
- tiempo administrativo antes y después;
- incidencias de permisos, calendario y notificaciones;
- tiempo mensual de soporte por estudio;
- intención de pago y continuidad del piloto.

No se consideran éxito el número de pantallas, campos o automatizaciones construidas.

## Política de detalle

Esta spec conserva decisiones de producto y criterios transversales. Cada slice sustantivo añade o enlaza su contrato técnico y sus pruebas antes de implementar. El material retirado continúa disponible en Git y solo se consulta cuando se necesita evidencia histórica.
