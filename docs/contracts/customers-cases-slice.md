# Contrato del slice: clientes y casos de tatuaje

_Estado: IN_PROGRESS_

_Última actualización: 2026-09-13_

## Objetivo

Como owner de un estudio quiero registrar clientes y casos de tatuaje para conservar el contexto operativo mínimo dentro de mi tenant y asignar opcionalmente un artista del mismo estudio.

## Alcance

Este slice incorpora gestión SSR exclusiva para OWNER, casos de uso, un adaptador Supabase sujeto a la sesión, tablas privadas y RLS. No añade Chatwoot, referencias o archivos, calendario, booking, notificaciones ni acceso del artista a clientes o casos. No se borran filas: el owner puede retirarlas mediante un estado explícito.

## Criterios de aceptación

### Crear y mantener un cliente

```gherkin
Given un usuario autenticado con membresía OWNER en un estudio
When crea un cliente con nombre válido y contacto opcional
Then el nombre se normaliza
And el email y el teléfono presentes se normalizan
And el cliente queda ACTIVE dentro del estudio del owner

Given un cliente del estudio del owner
When el owner cambia nombre, contacto o estado
Then solo se actualizan esos campos
And ARCHIVED retira el cliente sin borrarlo
```

### Crear y mantener un caso

```gherkin
Given un cliente del estudio del owner
When crea un caso con resumen válido, zona y tamaño opcionales y un artista opcional del mismo estudio
Then el caso queda OPEN y vinculado al cliente dentro del mismo tenant

Given un caso del estudio del owner
When el owner cambia resumen, zona, tamaño, estado o artista
Then puede asignar o desasignar únicamente un artista de ese estudio
And ARCHIVED retira el caso sin borrarlo
```

### Aislamiento y autorización

```gherkin
Given un owner de otro estudio, un ARTIST o una petición anónima
When intenta leer o escribir clientes o casos
Then no obtiene ni altera filas privadas
And no puede usar las rutas owner

Given una escritura privilegiada que intenta vincular un caso con un cliente o artista de otro tenant
When Postgres valida la relación
Then la clave foránea compuesta rechaza la escritura
```

### Validación y privacidad

```gherkin
Given datos inválidos, un contacto ya usado en el estudio o un recurso no visible
When el owner envía el formulario
Then recibe respectivamente un error genérico de validación, duplicidad o recurso no encontrado
And el error no incluye nombre, email, teléfono, resumen ni detalles del proveedor

Given una respuesta del panel owner
When el servidor la devuelve
Then incluye Cache-Control private, no-store
And no incluye datos personales en URL, logs ni caché persistente
```

## Contrato técnico

- `customer`: `id`, `studio_id`, `name`, `email?`, `phone?`, `status: ACTIVE | ARCHIVED`, timestamps. Email y teléfono no nulos son únicos por estudio.
- `tattoo_case`: `id`, `studio_id`, `customer_id`, `summary`, `body_area?`, `size?`, `artist_profile_id?`, `status: OPEN | ARCHIVED`, timestamps.
- Nombre, resumen, zona y tamaño usan NFKC, recorte y espacios internos simples. Email usa NFKC, recorte y minúsculas. Teléfono admite formato internacional `+` con 8 a 15 dígitos y elimina espacios, guiones y paréntesis antes de validarlo.
- Actualizaciones de cliente: `name`, `email`, `phone`, `status`. Actualizaciones de caso: `summary`, `bodyArea`, `size`, `artistProfileId`, `status`.
- Las escrituras reciben `studioId` exclusivamente desde el acceso OWNER resuelto en servidor. Los IDs son UUID opacos y pueden viajar como campos de formulario; ningún dato personal viaja en URL.
- Errores públicos: `InvalidCustomerCaseInputError`, `DuplicateCustomerError`, `CustomerNotFoundError`, `TattooCaseNotFoundError` y `ArtistNotFoundError`. Sus mensajes no incorporan entradas ni respuestas de Supabase.
- Aplicación depende de `CustomerCasesRepositoryPort`. El adaptador Supabase vive en infraestructura y ejecuta lecturas y escrituras con la sesión del request, bajo RLS.
- RLS concede acceso a `customer` y `tattoo_case` solo a OWNER del mismo `studio_id`. ARTIST y anon no reciben acceso efectivo.
- Las claves candidatas `(id, studio_id)` y FKs compuestas conservan tenant para `tattoo_case.customer_id` y `tattoo_case.artist_profile_id`. Los campos de tenant, estado y relaciones tienen índices adecuados.

## Plan RED-GREEN-REFACTOR

1. RED de dominio y aplicación: normalización, campos opcionales, duplicidad, recursos ausentes, asignación y retirada.
2. RED de infraestructura y handlers SSR: mapeo de filas/errores, guards OWNER, mutaciones same-origin, respuestas privadas y errores sin PII.
3. RED de persistencia: migración y pgTAP para esquema, FKs compuestas, RLS y denegaciones reales.
4. GREEN mínimo por capa y UI accesible de listas, alta y edición.
5. REFACTOR, pruebas enfocadas, `npm run check`, Supabase/pgTAP real cuando esté disponible, build/smoke y revisión de secretos/diff.

## Evidencia de implementación

- RED de dominio y aplicación: 2 suites fallaron porque los módulos del slice aún no existían.
- GREEN de dominio y aplicación: 12/12 pruebas enfocadas pasaron.
- RED de infraestructura y handlers SSR: 2 suites fallaron porque los adaptadores aún no existían; después, 22/22 pruebas enfocadas del slice pasaron en 5 suites.
- Validación completa: `npm run check` pasó lint, tipos, 97 pruebas (1 integración condicionada omitida) y build cliente/SSR.
- Persistencia preparada: la migración `202609130003_customers_cases.sql` y 36 aserciones pgTAP cubren esquema, restricciones, owner CRUD, ARTIST, anon y cross-tenant.
- Limitación: Supabase local no quedó disponible. `npm run db:test` recibió `ECONNREFUSED 127.0.0.1:54322` y `npm run db:start` no produjo estado después de 90 segundos, por lo que el estado continúa `IN_PROGRESS` hasta ejecutar Postgres real en CI.
