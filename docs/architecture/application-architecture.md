# Arquitectura de aplicación de Inkendar

_Estado: aceptada_

_Última actualización: 2026-09-14_

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

La bandeja SSR OWNER compone `ConversationProviderPort` con el adaptador Chatwoot por `studioId`; el navegador nunca recibe URL, token, secreto ni payload bruto. La primera página normaliza conversaciones, el detalle filtra mensajes públicos de texto y las respuestas se envían una sola vez sin reintento automático ante resultado remoto ambiguo.

Supabase conserva únicamente `conversation_link` para relacionar el identificador externo con customer y tattoo_case del mismo tenant, y `conversation_webhook_receipt` para deduplicación técnica sin contenido. RLS limita vínculos a OWNER y FKs compuestas impiden combinar tenant, cliente y caso incluso con escritura privilegiada.

El resource route público del webhook resuelve una conexión opaca, verifica sobre el cuerpo bruto la firma HMAC-SHA256, una frescura máxima de cinco minutos, delivery ID y account esperado. Solo después crea el adaptador `service_role`; una RPC transaccional devuelve `ACCEPTED` o `DUPLICATE` y actualiza actividad como máximo una vez.

La configuración multi-tenant se inyecta en servidor mediante `INKENDAR_CHATWOOT_CONNECTIONS_JSON` y rechaza asignar la misma cuenta de un mismo origen Chatwoot a estudios distintos. La prueba Postgres local permanece pendiente cuando Docker no está disponible; no se considera evidencia `PASS` hasta ejecutar migración y pgTAP en el job `database`.

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

Calcula opciones con jornada, duración, márgenes, zona horaria y ocupación real de Google Calendar. Gestiona ofertas, opciones, reservas provisionales, caducidad, confirmación y liberación idempotente.

### Contenido web y portfolios

Gestiona únicamente la galería del estudio y las imágenes vinculadas a cada artista. El owner publica desde la PWA. Los originales permanecen privados y un modelo de lectura contiene solo variantes optimizadas y metadatos públicos.

### Entrega de contenido público

Expone el contenido publicado mediante una API cacheable y un web component agnóstico del framework. Las webs creadas por Incamdi y las webs existentes consumen el mismo contrato. Este módulo no recibe escrituras públicas ni comparte tablas privadas.

### Notificaciones

Envía confirmaciones y vencimientos por el canal original cuando el proveedor lo permita. El correo actúa como respaldo configurado. Ningún estado se presenta como enviado si el proveedor no lo confirma.

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

Un ejecutor programado debe:

- caducar ofertas y reservas provisionales;
- liberar en Google Calendar los bloqueos vencidos;
- enviar recordatorios y avisos de vencimiento;
- reintentar webhooks y notificaciones recuperables;
- marcar para intervención humana los fallos que excedan el límite de reintentos.

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
