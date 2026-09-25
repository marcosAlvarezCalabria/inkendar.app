# Especificación de diseño de producto — PWA Inkendar

_Estado: especificación autoritativa de UX/UI, lista para implementación incremental_

_Última actualización: 2026-09-25_

## 1. Autoridad, propósito y fronteras

Este documento fija la experiencia, la jerarquía de información, los estados visuales y los criterios observables de la PWA Inkendar. Permite diseñar e implementar el frontend en paralelo a integraciones incompletas, y revisar después su fidelidad sin confundir una maqueta con comportamiento de producción.

La [especificación vendible del MVP](../product/sellable-mvp-spec.md) continúa siendo la fuente de verdad superior para alcance, reglas, roles, estados de negocio, permisos y progreso. La [arquitectura de aplicación](../architecture/application-architecture.md) gobierna límites técnicos, seguridad, propiedad de datos y adaptadores. Si este documento contradice cualquiera de las dos, se corrige este documento; no se modifica el comportamiento para acomodar el diseño.

Esta especificación sí decide:

- navegación, composición y prioridades de cada pantalla;
- lenguaje visual, interacción, accesibilidad y respuesta a distintos tamaños;
- representación visual de estados ya definidos por producto o por los contratos vigentes;
- contratos de fixtures exclusivamente de presentación para trabajar sin proveedores reales;
- orden recomendado de slices visuales y su definición de terminado.

Esta especificación no decide:

- nuevas reglas de negocio, estados, roles, endpoints, tablas, RPC ni payloads públicos;
- cómo autentican, autorizan o persisten los adaptadores;
- precio, onboarding autoservicio, recuperación de contraseña o capacidades fuera del MVP;
- que una integración o capacidad esté disponible sin la evidencia exigida por la spec canónica.

Las referencias visuales de la landing (`inkendar/PRODUCT.md` y `inkendar/DESIGN.md`) orientan identidad y tono, pero no son fuente de verdad del software. La PWA adopta su personalidad con mayor densidad operativa, legibilidad y sobriedad.

## 2. Principios de producto y lenguaje visual

### 2.1 Principios de experiencia

1. **El trabajo antes que el dashboard.** La primera mirada debe revelar qué requiere atención; no se rellenan pantallas con métricas decorativas.
2. **Estado explícito antes que optimismo.** “Pendiente”, “requiere aprobación”, “confirmada” y “no disponible” nunca se confunden. Una transición ambigua no se presenta como éxito.
3. **Una ficha, un contexto.** Conversación, cliente, caso, artista y cita se relacionan con nombres humanos y enlaces claros, sin exponer identificadores técnicos.
4. **Acción segura y recuperable.** Las mutaciones muestran progreso, conservan el contexto ante error y explican qué puede reintentarse.
5. **Cada rol ve solo lo necesario.** OWNER opera; ARTIST consulta agenda y contexto mínimo; el cliente actúa mediante un enlace opaco sin cuenta.
6. **Móvil primero, escritorio eficiente.** Ninguna capacidad depende de hover, arrastrar o una tabla ancha; el espacio adicional se usa para comparar y mantener contexto.
7. **Proveedor invisible.** La interfaz dice “Conversaciones”, “Calendario” o “Galería”; Chatwoot, Supabase y detalles internos no aparecen como pasos operativos salvo que producto requiera nombrar Google Calendar.

### 2.2 Sistema visual

La interfaz se inspira en una orden de trabajo física: precisa, compacta y tangible, sin caer en estética gótica ni en un SaaS azul genérico.

| Token semántico | Valor inicial | Uso |
|---|---:|---|
| `ink` | `#0B0B0F` | fondo principal y texto sobre papel |
| `charcoal` | `#16161F` | superficies oscuras secundarias |
| `paper` | `#F2F0EA` | tarjetas, formularios y texto sobre oscuro |
| `ember` | `#FF7000` | acción primaria, foco y acento de marca |
| `success` | por validar | confirmación acompañada siempre de texto/icono |
| `warning` | por validar | estados pendientes o que requieren atención |
| `danger` | por validar | error, rechazo o acción destructiva |

Los tres colores semánticos pendientes deben escogerse mediante contraste medido; no se heredan por intuición de la landing.

- Titulares: sans condensada y pesada cuando exista una fuente licenciada y cargable sin degradar rendimiento; fallback documentado.
- Cuerpo y controles: sans de sistema, mínimo 16 px en móvil y sin condensación.
- Bordes: 1 px; radios de 12–16 px; sombras desplazadas discretas, nunca glow ni cristal.
- Espaciado: escala base de 4 px; unidades preferentes 8, 12, 16, 24, 32 y 48 px.
- Iconos: auxiliares; ninguna acción o estado depende solo de un pictograma.
- Animación: breve y funcional para aparición, progreso o reordenación. `prefers-reduced-motion` elimina traslaciones no esenciales.
- Voz: directa, concreta y conocedora del estudio. Evitar “¡Ups!”, jerga técnica y promesas no comprobadas.

## 3. Actores y permisos visibles

### OWNER

Gestiona conversaciones, clientes, casos, Google Calendar, disponibilidad, solicitudes, ofertas y galería. La navegación y la interfaz pueden mostrar estas áreas, pero cada operación continúa autorizada en servidor. La UI nunca usa visibilidad como control de seguridad.

### ARTIST

Consulta en solo lectura sus próximas citas confirmadas y el contexto mínimo aprobado. No ve navegación OWNER, botones de mutación, mensajes completos, configuración, publicación ni otros artistas.

### Cliente invitado

No crea una cuenta. Abre uno de dos enlaces opacos y caducables: opciones preaprobadas o huecos de elección libre. La experiencia pública no revela nombre de cliente, caso, identificadores internos ni eventos privados del calendario.

## 4. Inventario de rutas y conteo de pantallas

El archivo [`apps/inkendar/app/routes.ts`](../../apps/inkendar/app/routes.ts) declara 19 entradas. El inventario de producto cuenta **11 pantallas visuales**: rutas que renderizan contenido y a las que una persona puede llegar como destino. No cuenta redirects, acciones POST, callbacks ni recursos binarios/JSON.

| # | Pantalla | Ruta visual | Actor | Propósito |
|---:|---|---|---|---|
| 1 | Acceso | `/login` | OWNER / ARTIST | iniciar sesión con una cuenta aprovisionada |
| 2 | Panel del estudio | `/app/owner` | OWNER | orientar y entrar en las seis áreas operativas |
| 3 | Conversaciones | `/app/owner/conversations` | OWNER | revisar, vincular y responder conversaciones |
| 4 | Clientes | `/app/owner/customers` | OWNER | crear y mantener clientes |
| 5 | Casos de tatuaje | `/app/owner/cases` | OWNER | crear, asignar y archivar casos |
| 6 | Google Calendar | `/app/owner/calendars` | OWNER | conectar, asignar, configurar disponibilidad y decidir solicitudes |
| 7 | Ofertas de fechas | `/app/owner/offers` | OWNER | crear ofertas preaprobadas, emitir enlaces y seguir estados |
| 8 | Galería privada | `/app/owner/gallery` | OWNER | ingerir, curar, publicar, retirar y restaurar contenido |
| 9 | Agenda del artista | `/app/artist` | ARTIST | consultar próximas citas confirmadas propias |
| 10 | Opciones preaprobadas | `/offers/:token` | Cliente | elegir una opción reservada y ver su estado |
| 11 | Elección libre | `/availability/:token` | Cliente | solicitar un hueco y seguir la decisión del estudio |

Rutas no contadas como pantallas:

| Ruta | Naturaleza | Tratamiento de UI |
|---|---|---|
| `/` | entrada que resuelve sesión/rol | sin layout propio; redirige |
| `/app` | entrada autenticada que resuelve rol | sin layout propio; redirige |
| `/logout` | acción POST | botón dentro del shell; no destino navegable |
| `/availability/:token/select` | acción POST pública | usa el feedback de la pantalla de elección libre |
| `/auth/google/callback` | callback técnico | vuelve a la pantalla de calendarios con feedback seguro |
| `/api/public/studios/:studioSlug/gallery` | recurso JSON | sin UI PWA; contrato público separado |
| `/api/webhooks/chatwoot/:connectionId` | webhook técnico | nunca se enlaza en UI |
| `/app/owner/gallery/thumbnails/:handle` | recurso de imagen privado | se consume dentro de Galería |

No se crea una duodécima pantalla para “inicio”: la ruta `/` no es la landing comercial ni un dashboard público.

## 5. Navegación y arquitectura de información

### 5.1 Shell privado OWNER

En móvil usa una cabecera compacta con identidad de estudio, acceso al menú y estado de conexión solo cuando requiera atención. La navegación principal contiene: Panel, Conversaciones, Clientes, Casos, Calendario, Ofertas y Galería. “Cerrar sesión” queda separado al final.

En tablet y escritorio, la navegación pasa a rail lateral persistente. La cabecera de contenido contiene breadcrumb corto, título, ayuda contextual opcional y una única acción primaria de pantalla. El ítem activo se expresa con texto, contraste, borde y `aria-current="page"`.

El panel OWNER es un índice operativo, no un segundo sistema de navegación. Muestra accesos con una línea de descripción y, cuando los loaders existentes puedan aportarlo sin contratos nuevos, una señal de atención. La ausencia de ese dato no se sustituye por números inventados.

### 5.2 Shell privado ARTIST

No presenta rail ni enlaces OWNER. Cabecera con Inkendar, saludo, etiqueta “Solo lectura” y cierre de sesión; debajo, la agenda. Una futura navegación ARTIST necesita decisión de producto y no se anticipa.

### 5.3 Experiencias públicas

Son páginas autocontenidas, sin navegación interna de la PWA ni enlaces al panel. Incluyen marca discreta, título de estado, explicación, fecha/hora con zona, acción única cuando procede y vía de recuperación mediante contacto con el estudio. No enlazan entre sí ni permiten explorar tokens.

### 5.4 Jerarquía transversal

Cada pantalla privada conserva este orden:

1. identidad de área y título;
2. aviso crítico o feedback de la última acción;
3. acción primaria o bloque de creación;
4. contenido existente;
5. ayuda secundaria y acciones menos frecuentes.

En listados, buscar/filtrar solo se añade cuando el volumen real lo justifique y exista soporte en el loader. Esta especificación no crea parámetros de consulta.

## 6. Especificación por pantalla

### 6.1 Acceso — `/login`

**Objetivo:** permitir acceso con email y contraseña aprovisionados.

**Contenido mínimo:** marca, título “Accede a tu estudio”, explicación breve, email, contraseña, acción “Entrar” y error de autenticación. No mostrar registro, recuperación ni acceso social mientras no formen parte del alcance canónico.

**Interacción:** foco inicial razonable en email; envío con Enter; durante envío, botón ocupado y controles protegidos de doble envío; el error queda junto al formulario, recibe `role="alert"` y no borra el email.

### 6.2 Panel del estudio — `/app/owner`

**Objetivo:** hacer visibles las áreas disponibles y orientar la siguiente acción.

**Contenido mínimo:** saludo, navegación global, seis tarjetas de área con verbo y descripción, cierre de sesión. No usar gráficas, facturación, métricas ni feed de actividad sin fuente real.

**Prioridad:** Conversaciones y solicitudes que requieran acción pueden subir en orden cuando el backend exponga una señal aprobada; el orden base sigue el flujo conversación → cliente/caso → calendario/oferta → contenido.

### 6.3 Conversaciones — `/app/owner/conversations`

**Objetivo:** revisar la bandeja, abrir un hilo, vincularlo y responder sin revelar Chatwoot.

**Contenido mínimo:** lista paginada con contacto, canal, estado, no leídos y fecha; detalle seleccionado con mensajes incrementales; asociación a cliente/caso; caja de respuesta; navegación de página existente.

**Composición:** móvil alterna lista y detalle con retorno explícito; tablet/escritorio usa master-detail. Mantener visible el nombre del contacto y el estado mientras se redacta.

**Estados de dominio:** conversación sin vínculo; vinculada a cliente; vinculada a caso; envío en curso; enviado confirmado; fallo confirmado reintentable; resultado ambiguo que no invita a reenviar automáticamente. Si el proveedor está desconectado, distinguir “bandeja temporalmente no disponible” de “no hay conversaciones”.

### 6.4 Clientes — `/app/owner/customers`

**Objetivo:** crear y mantener el directorio operativo mínimo.

**Contenido mínimo:** alta con nombre, email y teléfono según contrato vigente; lista de clientes; edición; estado `ACTIVE`/`ARCHIVED`; feedback de guardado.

**Composición:** móvil usa tarjetas y formulario en flujo vertical; escritorio separa formulario de alta y listado editable. Archivar no se presenta como borrar. Las validaciones explican campo y corrección.

### 6.5 Casos de tatuaje — `/app/owner/cases`

**Objetivo:** registrar el encargo y relacionarlo con cliente y artista.

**Contenido mínimo:** alta con cliente, resumen, zona, tamaño y artista opcional conforme al contrato vigente; listado; edición; `OPEN`/`ARCHIVED`.

**Estados:** sin artista muestra “Sin asignar”, no vacío; sin cita no se interpreta como error; archivado conserva lectura y una apariencia secundaria. No se inventa un pipeline visual adicional.

### 6.6 Google Calendar — `/app/owner/calendars`

**Objetivo:** concentrar configuración operativa de calendario, disponibilidad y decisión de solicitudes libres.

**Contenido mínimo, en este orden:**

1. estado de conexión y conectar/reconectar/desconectar;
2. asignación de calendario por artista;
3. solicitudes de elección libre que requieren decisión;
4. reglas semanales por artista;
5. previsualización de huecos;
6. emisión/rotación del enlace de elección libre;
7. confirmaciones en curso y reintentos seguros.

La pantalla debe usar subnavegación local o acordeones en móvil para evitar un formulario continuo inmanejable, sin convertirlos en rutas nuevas.

**Estados de dominio:** `ACTIVE`, `REAUTH_REQUIRED`, no conectada; artista sin calendario; solicitud `PENDING_OWNER_APPROVAL`, en aprobación/reconciliación, confirmada o rechazada según los contratos vigentes. “Previsualizar” y “Emitir enlace” nunca se confunden con confirmar cita.

Los campos técnicos actuales de ventanas, UTC o zona IANA pueden conservarse durante el slice funcional, pero el objetivo de diseño es un editor semanal comprensible que serialice exactamente el formulario existente; su sustitución requiere prueba de equivalencia y no cambia el action.

### 6.7 Ofertas de fechas — `/app/owner/offers`

**Objetivo:** crear hasta tres opciones preaprobadas, bloquearlas temporalmente y comunicar un enlace seguro.

**Contenido mínimo:** plazo del estudio, selector de caso y artista, opciones, creación, lista de ofertas, vencimiento, estado de opciones, liberación de vencidas y emisión/rotación del enlace.

**Estados de dominio:** oferta `OPEN`, `SELECTED_PENDING_CONFIRMATION`, `CONFIRMED`, `EXPIRED`; opción `HELD`, `SELECTED`, `CONFIRMED`, `RELEASED`. Cada estado lleva etiqueta textual y explicación de la siguiente acción. El enlace recién emitido se presenta como dato sensible de una sola aparición con copiar y confirmación; no se conserva en historial visual si el loader no lo devuelve.

### 6.8 Galería privada — `/app/owner/gallery`

**Objetivo:** llevar una imagen desde borrador privado hasta publicación o retirada conservando edición y recuperación.

**Contenido mínimo:** requisitos de archivo; ingestión; miniatura; alt; destino galería/portfolio y artista cuando proceda; posición; mover; descartar; publicar/reintentar; retirar/reintentar; descartados recuperables.

**Estados de dominio:** `DRAFT`, `DISCARDED`, `PUBLISHING`, `PUBLISHED`, `RETIRING`, `RETIRED` según visibilidad prevista por los contratos. Las transiciones intermedias muestran que cerrar la pantalla no cancela el proceso. “Descartar” y “Retirar” son acciones distintas y deben explicarse.

Móvil usa una tarjeta por imagen con miniatura 4:3 y acciones en menú o grupos etiquetados; escritorio usa una cuadrícula adaptable, nunca controles dependientes de drag-and-drop. Mover arriba/abajo sigue disponible por teclado.

### 6.9 Agenda del artista — `/app/artist`

**Objetivo:** permitir entender las próximas citas confirmadas propias con una mirada.

**Contenido mínimo:** saludo, “Solo lectura”, citas futuras ordenadas, cliente, resumen, horario localizado con zona, zona corporal y tamaño cuando existan, cierre de sesión.

**Composición:** por defecto agrupar visualmente por día sin alterar el orden del loader. Destacar la próxima cita, no usar calendario mensual. Sin citas: mensaje tranquilo y no una alarma. La interfaz no ofrece edición, acceso al cliente completo ni navegación OWNER.

### 6.10 Opciones preaprobadas — `/offers/:token`

**Objetivo:** permitir al cliente elegir una de hasta tres opciones bloqueadas y conocer la confirmación real.

**Contenido mínimo:** artista, caducidad, zona horaria, opciones con fecha y hora local, explicación de reserva provisional y acción por opción.

**Estados:** `OPEN`, selección pendiente de confirmación, `CONFIRMED`, conflicto, reconexión requerida, revisión y error reintentable según la proyección vigente. Tras pulsar, bloquear doble envío. Nunca afirmar “confirmada” antes del estado confirmado. Token inválido, rotado o vencido comparte una pantalla segura sin revelar cuál condición ocurrió.

### 6.11 Elección libre — `/availability/:token`

**Objetivo:** solicitar un candidato libre y seguir una aprobación humana.

**Contenido mínimo:** artista, zona, validez, candidatos, aviso explícito de aprobación, acción por hueco.

**Estados:** `OPEN` con o sin candidatos, `PENDING_OWNER_APPROVAL`, `APPROVING`, `CONFIRMED`, `REJECTED`, `EXPIRED` y enlace no disponible. Después de elegir, el texto principal es “Solicitud recibida”, no “Reserva”. La pantalla puede recomendar conservar el enlace, pero no promete notificación hasta que ese canal esté verificado.

## 7. Estados transversales

Cada pantalla se diseña y revisa con los siguientes estados, incluso cuando la primera implementación SSR resuelva alguno como navegación completa.

| Estado | Patrón requerido |
|---|---|
| Loading inicial | esqueleto con estructura estable o indicador con nombre de la sección; no spinner aislado indefinido |
| Mutación en curso | botón ocupado, intención textual, doble envío impedido y contenido previo conservado |
| Empty esperado | explica qué falta, por qué importa y ofrece acción solo si el rol puede realizarla |
| Error recuperable | resume el fallo, conserva entradas seguras y permite reintento idempotente cuando el contrato lo admite |
| Error no recuperable | no ofrece un reintento que pueda duplicar efectos; indica revisión/contacto |
| Offline | conserva el shell estático, marca datos como no actualizados y deshabilita mutaciones; no simula éxito |
| Permiso | “Acceso denegado”, sin filtrar existencia de recursos ni ofrecer cambio de rol |
| Sesión vencida | redirige a acceso y, si es seguro, comunica que la sesión terminó; no conserva PII en URL |
| Resultado vacío por proveedor no conectado | se distingue de empty real siempre que el loader lo pueda conocer |

La PWA no cachea permanentemente mensajes, PII ni imágenes privadas. Un diseño offline completo de datos queda fuera mientras el service worker continúe fuera del slice canónico; el patrón visual no autoriza persistencia local.

Los mensajes de feedback usan `aria-live="polite"` para éxito y progreso, `role="alert"` para error inmediato, y mueven el foco solo cuando sea necesario para localizar el resultado o el primer error.

## 8. Responsive

Los breakpoints se eligen por ruptura del contenido, con referencias iniciales de 640 px y 1024 px, no como objetivos rígidos.

### Móvil

- una columna, padding 16 px y controles de al menos 44 × 44 px;
- cabecera compacta y navegación en panel modal con foco atrapado y retorno al disparador;
- formularios con etiquetas encima, acciones principales a ancho completo cuando ayude;
- listas como tarjetas; master-detail como navegación entre vistas;
- acciones críticas no quedan pegadas al borde inferior ni ocultas por teclado/área segura.

### Tablet

- rail contraíble y contenido de una o dos columnas;
- master-detail en conversaciones cuando el ancho permita al menos 320 px por panel;
- formularios complejos por secciones, no cuadrículas densas;
- orientación vertical y horizontal conservan orden y foco.

### Escritorio

- rail persistente de 240–280 px; contenido legible con máximo aproximado de 1440 px;
- dos paneles donde mantener contexto reduzca navegación;
- tablas solo para datos genuinamente tabulares, con alternativa accesible a overflow;
- densidad mayor sin bajar tamaño de texto ni objetivo táctil.

No se soporta una versión distinta por dispositivo: las once pantallas comparten semántica y capacidades.

## 9. Accesibilidad

Objetivo propuesto: **WCAG 2.2 AA**. Su ratificación normativa permanece como decisión abierta; mientras tanto, toda implementación debe cumplir como mínimo:

- HTML semántico, landmarks únicos, jerarquía de encabezados y nombre accesible de controles;
- operación completa por teclado, foco visible de al menos 2 px y orden equivalente al visual;
- contraste mínimo 4.5:1 para texto normal, 3:1 para texto grande y límites/estados esenciales;
- no depender solo de color, icono, posición, hover, gesto ni animación;
- errores asociados a campos mediante texto e IDs; resumen cuando haya varios;
- fechas con `<time datetime>` y formato humano; zona horaria visible en toda decisión de agenda;
- touch targets de 44 × 44 px siempre que no exista excepción justificada;
- reflow sin pérdida a 320 CSS px y zoom al 200 %;
- `prefers-reduced-motion`, contraste forzado y tamaño de texto del usuario respetados;
- carga, cambios y feedback anunciados sin convertir regiones grandes en live regions;
- imágenes de galería con alt obligatorio conforme al contrato; miniaturas decorativas con alt vacío solo cuando el texto adyacente las describa completamente.

La revisión incluye teclado, lector de pantalla representativo, zoom/reflow y contraste automatizado/manual. Un score automático aislado no constituye aceptación.

## 10. Componentes y patrones reutilizables

Los nombres son de diseño; no obligan a crear componentes React uno a uno.

- `AppShell`, `OwnerNav`, `PageHeader`, `Breadcrumbs`, `PublicLinkShell`.
- `WorkCard`, `RecordList`, `RecordCard`, `MasterDetail`, `DayGroup`.
- `StatusBadge` con texto; `AttentionBanner`; `InlineFeedback`; `EmptyState`; `ErrorState`.
- `Field`, `FieldError`, `FormSection`, `ActionBar`, `SubmitButton` ocupado.
- `ConnectionCard`, `ArtistAssignmentCard`, `AvailabilityEditor`.
- `ConversationRow`, `MessageThread`, `ReplyComposer`, `LinkContextForm`.
- `OfferCard`, `SlotChoice`, `ExpiryNotice`, `SensitiveLinkNotice`.
- `GalleryCard`, `LifecycleActions`, `ImageRequirementHint`.
- `ConfirmDialog` solo para consecuencias relevantes; no para cada guardado.

Patrones obligatorios:

- las acciones peligrosas usan verbo y objeto (“Retirar publicación”), no “Aceptar”;
- una acción primaria por región; secundarias visualmente subordinadas;
- badges describen estado, no funcionan como botón;
- toast solo complementa un cambio visible y persistente; nunca es el único registro de error;
- confirmación no se usa para ocultar copy ambiguo: debe explicar efecto y recuperación.

## 11. Frontend paralelo: fixtures y adaptadores de presentación

### 11.1 Regla de frontera

El frontend no llama a Supabase, Chatwoot ni Google directamente. Las rutas React Router conservan sus loaders/actions server-side y componen aplicación/adaptadores según la [arquitectura](../architecture/application-architecture.md). Para trabajo visual paralelo se sustituye únicamente la fuente de datos en el punto de composición de desarrollo o Storybook; no se crean endpoints temporales.

Un fixture de presentación es una muestra tipada de la **proyección que ya consume una vista**, no un nuevo DTO de dominio. Se deriva de los tipos exportados actuales y debe usar `satisfies` para detectar deriva. Cuando una vista aún no tenga proyección estable, el slice visual espera o propone el contrato en la spec canónica correspondiente; no lo consagra aquí.

### 11.2 Contrato mínimo del catálogo de fixtures

Cada pantalla debe poder renderizar estas variantes mediante imports de desarrollo, pruebas de componente o historias, nunca mediante una ruta pública nueva:

```ts
type FixtureScenario<TView, TAction = never> = Readonly<{
  id: string;
  description: string;
  viewport: "mobile" | "tablet" | "desktop";
  view: TView;
  actionResult?: TAction;
  latencyMs?: number;
  transportState?: "online" | "offline" | "error";
}>;
```

Este tipo es orientativo para el harness visual; no forma parte del contrato público ni autoriza campos en loaders/actions.

El catálogo contiene datos totalmente sintéticos y reconocibles: nombres ficticios, emails `example.invalid`, teléfonos reservados y URLs/token no utilizables. Debe cubrir:

- estado poblado representativo;
- empty;
- máximo visual razonable (textos largos, tres opciones, muchos estados);
- error, offline y permiso cuando aplique;
- cada estado de dominio que la pantalla representa;
- zonas horarias y cambio de día para agenda/booking;
- una imagen vertical, una horizontal y alt largo válido para galería.

No se copian respuestas reales de proveedores, secretos, PII ni identificadores de clientes. Los fixtures no se usan como seed de producción ni como evidencia de integración.

### 11.3 Adaptadores y acciones simuladas

Las mutaciones visuales se prueban con un `action`/story handler falso que devuelve exactamente las formas ya aceptadas por la ruta. Debe poder simular éxito confirmado, validación, fallo recuperable, latencia y resultado ambiguo. No escribe en servicios reales y deja visible que el entorno es de desarrollo.

Puertos existentes como `ConversationProviderPort`, `CustomerCasesRepositoryPort`, `ArtistAvailabilityRepositoryPort`, `GoogleFreeBusyPort`, `BookingOfferRepositoryPort` y `ArtistAgendaRepositoryPort` pertenecen a aplicación. Sus fakes sirven para pruebas de caso de uso; los fixtures de UI no los reemplazan ni duplican. El slice elige la capa más estrecha:

- historia/componente: proyección de vista;
- prueba de ruta: handlers/loaders/actions compuestos con fakes existentes;
- integración: adaptador real en entorno desechable.

## 12. Integración progresiva con loaders/actions

1. **Congelar la vista actual.** Extraer la parte puramente visual de la ruta sin cambiar su loader/action ni la forma serializada.
2. **Cubrir escenarios visuales.** Añadir fixtures sintéticos tipados para la proyección actual y revisar responsive/accesibilidad.
3. **Mantener formularios web.** Conservar `Form`, nombres de campo, método, action URL e intents vigentes. La mejora cliente es progresiva; sin JavaScript sigue existiendo un recorrido válido donde el contrato actual lo soporte.
4. **Añadir pending UI.** Derivarla del estado de navegación/fetcher sin resolver negocio en cliente ni afirmar resultados antes de respuesta.
5. **Conectar por pantalla.** Usar el loader/action existente; cualquier falta real se registra como dependencia, no se resuelve inventando endpoint.
6. **Comparar fixture e integración.** Verificar que la proyección real satisface los mismos estados y retirar campos de fixture que no existen.
7. **Endurecer fallos.** Probar permisos, expiración, proveedor indisponible, conflicto y ambigüedad según el contrato de cada slice.

Rutas técnicas y visuales permanecen separadas. Por ejemplo, `/availability/:token/select` es una action del formulario mostrado en `/availability/:token`; no se diseña como página. Igual ocurre con miniaturas, callback Google, webhook y feed público.

## 13. Criterios de aceptación observables

### Escenario: navegación por rol

```gherkin
Dado que una persona autenticada tiene rol OWNER
Cuando entra en /app
Entonces llega al panel OWNER
Y puede identificar las seis áreas operativas
Y no se muestra navegación ARTIST como alternativa de rol
```

```gherkin
Dado que una persona autenticada tiene rol ARTIST
Cuando entra en /app
Entonces llega a su agenda de solo lectura
Y no ve controles de edición ni navegación OWNER
```

### Escenario: acceso denegado

```gherkin
Dado que una persona intenta abrir un área no autorizada
Cuando el guard del servidor rechaza el acceso
Entonces ve un estado “Acceso denegado”
Y la pantalla no revela si existen datos en esa área
```

### Escenario: conversación en móvil

```gherkin
Dado que la bandeja contiene conversaciones
Y la pantalla mide 320 CSS px de ancho
Cuando el OWNER abre una conversación
Entonces puede leer el hilo, volver a la lista y responder sin scroll horizontal
Y el contacto seleccionado permanece identificado
```

### Escenario: empty no equivale a desconexión

```gherkin
Dado que el loader conoce que el proveedor no está disponible
Cuando la vista recibe ese estado
Entonces no muestra el mensaje de lista vacía
Y explica que los datos no pueden cargarse temporalmente
Y ofrece reintento solo si es seguro
```

### Escenario: elección preaprobada

```gherkin
Dado un enlace de oferta OPEN con tres opciones vigentes
Cuando el cliente elige una opción
Entonces el control impide un segundo envío mientras la acción está pendiente
Y la interfaz no afirma confirmación hasta recibir estado CONFIRMED
Y un resultado pendiente explica la recuperación disponible
```

### Escenario: elección libre

```gherkin
Dado un enlace de disponibilidad OPEN con huecos candidatos
Cuando el cliente solicita uno
Entonces ve “Solicitud recibida” y “pendiente de aprobación”
Y no ve “cita confirmada” hasta que el estado sea CONFIRMED
```

### Escenario: fecha y zona

```gherkin
Dado un hueco cuya hora local cae en un día distinto de UTC
Cuando se muestra al OWNER, ARTIST o cliente
Entonces se presenta una fecha y hora humana coherente
Y la zona horaria relevante está visible antes de decidir
```

### Escenario: mutación offline

```gherkin
Dado que la aplicación detecta ausencia de conexión
Cuando una persona intenta una mutación
Entonces la UI no simula éxito ni descarta su contexto seguro
Y explica que debe reconectar antes de enviar
```

### Escenario: galería accesible

```gherkin
Dado un borrador de galería operable con teclado
Cuando el OWNER recorre sus controles sin puntero
Entonces puede editar, mover, publicar o descartar según su estado
Y cada control nombra la acción y la imagen afectada
```

### Escenario: reflow y zoom

```gherkin
Dado cualquiera de las once pantallas
Cuando se visualiza a 320 CSS px o con zoom al 200 por ciento
Entonces no se pierde contenido ni funcionalidad
Y no aparece scroll bidimensional salvo en un componente tabular justificado
```

### Escenario: fixture no altera producción

```gherkin
Dado un escenario visual con datos simulados
Cuando se construye la aplicación de producción
Entonces el escenario no crea una ruta ni un endpoint accesible
Y no incluye credenciales, PII ni respuestas reales de proveedores
```

## 14. Slices paralelizables

Los slices comparten primero tokens, shell y patrones de estado. Después pueden avanzar en paralelo sin cambiar negocio:

1. **Fundación visual y accesible:** tokens, tipografía, foco, botones, campos, feedback, shell y fixtures base.
2. **Autenticación y permisos:** acceso, redirects, sesión vencida y acceso denegado.
3. **Shell OWNER y registros:** panel, clientes y casos.
4. **Conversaciones:** master-detail, vínculo, respuesta y estados de proveedor.
5. **Calendario OWNER:** conexión, asignación, disponibilidad y decisiones.
6. **Booking OWNER:** ofertas, estados, expiración y enlace sensible.
7. **Flujos públicos cliente:** oferta preaprobada y elección libre, compartiendo `PublicLinkShell` y `SlotChoice`.
8. **Galería:** ingestión, curación, ciclo de publicación y recuperación.
9. **Agenda ARTIST:** próxima cita, grupos por día y empty.
10. **Endurecimiento transversal:** responsive, offline visual, a11y, copy, pruebas visuales y comparación con integración.

Dependencias: 2–9 dependen de 1; 5 y 6 comparten patrones pero no necesitan bloquearse; 7 puede avanzar con fixtures mientras 5/6 conectan backend; 10 empieza desde el primer slice y cierra después de todos.

## 15. Definition of done visual

Una pantalla o slice visual está terminado cuando:

- respeta la spec canónica y no añade capacidades, endpoints ni estados;
- renderiza con datos reales del loader/action vigente o declara explícitamente el fixture temporal;
- cubre poblado, loading/pending, empty, error, permiso/offline aplicables y todos sus estados de dominio;
- funciona a 320 px, móvil, tablet y escritorio, y con zoom al 200 %;
- es operable con teclado, conserva foco visible y pasa revisión de nombres, anuncios y contraste;
- las fechas y zonas son comprensibles y ningún estado depende solo del color;
- las mutaciones evitan doble envío, conservan contexto seguro y no declaran éxitos ambiguos;
- sin JavaScript mantiene el recorrido que el contrato SSR existente garantiza;
- los fixtures son sintéticos, tipados, no entran en el bundle/rutas de producción y no contienen secretos ni PII;
- existe evidencia revisable: capturas o historias por viewport/estado, checklist a11y y verificación contra la ruta integrada;
- el diff no altera accidentalmente loaders, actions, contratos, permisos ni cambios preexistentes.

## 16. Decisiones abiertas y dudas de revisión

No se consideran resueltas por esta especificación:

1. Ratificar WCAG 2.2 AA como objetivo normativo y definir navegadores/lectores de pantalla soportados.
2. Seleccionar y licenciar la tipografía condensada de interfaz o confirmar solo fuentes de sistema.
3. Definir tokens finales `success`, `warning` y `danger` mediante pruebas sobre superficies reales.
4. Decidir si el panel OWNER recibe señales de atención agregadas; hoy no existe contrato visual que autorice contadores.
5. Decidir si calendarios y ofertas se separarán en subrutas en una evolución futura; esta versión conserva las rutas reales.
6. Definir si el editor semanal sustituirá el textarea técnico y cuál será su prueba de serialización/equivalencia.
7. Validar live la notificación durable `REJECTED` tras un rechazo de elección libre. El contrato integrado reutiliza el outbox común, prioriza una única ruta Chatwoot del mismo caso y tenant, usa SMTP server-only por estudio como fallback y conserva `NO_ROUTE`/`UNKNOWN`; la evidencia live continúa pendiente.
8. Definir el comportamiento exacto del shell estático offline cuando se implemente el service worker; no se autoriza cachear datos privados.
9. Elegir herramienta de historias y regresión visual conforme al toolchain vigente; el contrato de fixtures no impone Storybook.
10. Validar el sistema con owners, artistas y clientes reales antes de convertir preferencias visuales en evidencia de usabilidad.
