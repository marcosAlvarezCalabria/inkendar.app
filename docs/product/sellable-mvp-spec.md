# Especificación de Inkendar

_Estado: especificación viva y fuente de verdad para alcance, comportamiento y progreso_

_Versión: 1.4.1_

_Última actualización: 2026-09-13_

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
- `DONE`: implementado, verificado y documentado.

Las correcciones editoriales pueden agruparse en una entrada. Los cambios de comportamiento deben tener una entrada propia con su motivo.

## Progreso vigente

| Área | Estado | Evidencia o siguiente gate |
|---|---|---|
| Landing comercial de Inkendar | `PASS` | La landing Astro funciona, pero es un activo de marketing independiente; su extracción de este proyecto está `PLANNED`. |
| Chat web en Chatwoot | `PASS` | Recepción y respuesta verificadas con datos sintéticos. |
| Instagram en Chatwoot | `PASS` | Recepción y respuesta por el canal original verificadas. |
| Facebook Messenger | `CONNECTED` | Falta la prueba bidireccional final. |
| Operación dentro de Inkendar | `PLANNED` | Chatwoot todavía no está oculto detrás del futuro panel. |
| PWA y autenticación | `PASS` | Login email/password, cookies SSR, guards, logout y shells OWNER/ARTIST pasaron `npm run check` con 75 pruebas y un smoke Auth/RLS real con ambos roles en el job `database` del [run 34762663413](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/34762663413). El service worker continúa fuera del slice y la suspensión explícita de accesos sigue pendiente. |
| Alta manual gestionada | `PASS` | El CLI de servidor, Auth Admin, compensación y RPC idempotentes pasaron 32 pruebas enfocadas, `npm run check` con 38 pruebas y 21 aserciones pgTAP dentro del job `database` [run 34756137292](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/34756137292). No incluye login, sesión ni UI de autenticación. |
| Flujo de entrega y CI | `PASS` | El PR [#2](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/2) se integró por squash con `validate` y `database` verdes; ambos checks son obligatorios en `main`, cuya ejecución [34753177240](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/34753177240) terminó correctamente. |
| Memoria de agentes | `PASS` | Engram 1.20.0 guarda y recupera memoria del proyecto `inkendar.app`; Codex MCP está configurado y requiere reinicio para cargarlo en nuevos chats. |
| Supabase y aislamiento multi-tenant | `PASS` | La migración, el seed sintético y las 38 aserciones pgTAP pasaron contra Supabase/Postgres real en GitHub Actions [run 34752758528](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/34752758528). |
| Google Calendar y booking | `PLANNED` | No existe OAuth, disponibilidad, ofertas ni creación de eventos. |
| Galería, portfolios y publicación web | `PLANNED` | No existe todavía el almacenamiento, feed público ni componente de integración. |
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
| 2026-09-13 | DEC-021 | `ACCEPTED` | La base full-stack usa React Router 8 sobre Node.js LTS y npm workspaces, con un adaptador de servidor reemplazable. | Ejecutar PWA y API/BFF en un solo artefacto portable y expresar los límites del monolito sin acoplar el dominio al alojamiento. |
| 2026-09-13 | DEC-022 | `ACCEPTED` | La identidad inicial usa `auth.users` y tablas tenant-scoped `user_profile`, `membership` y `artist_profile`; los únicos roles son `OWNER` y `ARTIST`, y Postgres RLS aplica el aislamiento mediante helpers privados con `search_path` vacío. | Hacer que el owner administre solo su estudio, limitar al artista a lectura propia y evitar escalación o recursión en políticas antes de conectar UI o Supabase Cloud. |
| 2026-09-13 | DEC-023 | `ACCEPTED` | El alta inicial es una operación gestionada mediante CLI de servidor, Supabase Admin detrás de puertos y RPC transaccionales idempotentes exclusivas de `service_role`; los roles son fijos, un fallo confirmado compensa Auth y un resultado ambiguo conserva la identidad para recuperación segura. | Provisionar pilotos sin superficie pública ni secretos versionados y hacer explícita la recuperación ante la falta de una transacción distribuida entre Auth y Postgres. |
| 2026-09-13 | DEC-024 | `ACCEPTED` | La sesión PWA usa `@supabase/ssr` y cookies en loaders/actions; `auth.getUser()` verifica la identidad y la aplicación exige una membership coherente bajo RLS antes de exponer un shell por rol. | Mantener tokens y autorización fuera del bundle y fallar cerrado ante identidades ambiguas. |

La arquitectura técnica está en [Arquitectura de aplicación](../architecture/application-architecture.md) y el proceso de entrega en [Flujo de desarrollo, revisión e integración](../development/delivery-workflow.md).

## Historial de la especificación

| Fecha | Versión | Mejora o cambio | Por qué |
|---|---|---|---|
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
- **Google Calendar: PLANNED.** La integración todavía no está implementada ni validada.

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
10. **Elección libre:** el cliente puede consultar huecos de un artista mediante un enlace seguro. El hueco elegido queda pendiente hasta la aprobación del owner.
11. **Confirmación:** una opción preaprobada se confirma al elegirla. Una opción libre requiere visto bueno del owner. En ambos casos Inkendar vuelve a comprobar disponibilidad antes de confirmar.
12. **Caducidad:** al vencer el plazo, se liberan los bloqueos y se avisa al cliente de que los horarios pueden ofrecerse a otra persona.
13. **Notificaciones:** confirmaciones, rechazos y caducidades se envían por el canal original cuando sea posible, con correo como respaldo configurado.
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

#### Elección libre pendiente de aprobación

```gherkin
Given un cliente con un enlace seguro vigente a los huecos de un artista
When selecciona un intervalo que no fue preaprobado por el owner
Then Inkendar crea una reserva provisional y avisa al owner
And no comunica una cita confirmada hasta recibir su aprobación
And vuelve a comprobar Google Calendar antes de confirmar
```

#### Vista del artista

```gherkin
Given un artista autenticado
When abre su agenda
Then solo ve sus citas y el contexto necesario para preparar el tatuaje
And no puede leer conversaciones ni citas de otros artistas
And no puede responder clientes, confirmar citas o modificar imágenes
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
Given un owner autenticado que sube una imagen válida
When asigna la imagen a la galería o al portfolio de un artista y la publica
Then Inkendar valida formato, peso y resolución
And elimina metadatos privados y genera variantes optimizadas
And la web muestra la versión publicada en el orden elegido
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

1. Publicar esta línea base documental en el repositorio de software.
2. Crear GitHub Actions y proteger `main`.
3. Completar en paralelo la prueba bidireccional de Facebook Messenger.
4. Definir el contrato y las pruebas RED del primer slice de identidad y aislamiento.
5. Crear la estructura del monolito modular, migraciones iniciales y pruebas RLS.
6. Implementar alta manual de estudio, owner y artistas con permisos de solo lectura para artista.
7. Implementar casos, conversaciones y la frontera oculta con Chatwoot.
8. Implementar Google OAuth, calendarios por artista y disponibilidad.
9. Implementar ofertas, bloqueos, caducidad y confirmación idempotente.
10. Añadir la vista de artista, galería y portfolios administrados por el owner.
11. Implementar el feed público y probarlo en una web nueva y otra existente.
12. Verificar privacidad, exportación, monitorización y onboarding antes de datos reales.
13. Ejecutar el recorrido completo con un estudio piloto cualificado antes de cobrar.
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
