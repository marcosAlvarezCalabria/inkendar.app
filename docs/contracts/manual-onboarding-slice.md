# Contrato del slice: alta manual gestionada

_Estado: IN_PROGRESS_

_Última actualización: 2026-09-13_

## Objetivo

Como operador autorizado de Incamdi quiero crear manualmente un estudio con su owner y añadir artistas a un estudio existente para iniciar el servicio gestionado con identidades autenticables y relaciones tenant coherentes, sin habilitar autoservicio ni una superficie pública de provisión.

## Alcance

Este slice incorpora un CLI ejecutado únicamente en servidor, casos de uso de aplicación, puertos de Auth y persistencia, un adaptador de Supabase Admin y operaciones SQL transaccionales accesibles solo con `service_role`. Los comandos fijan el rol según la operación; no aceptan un rol arbitrario. `add-artist` recibe un UUID de estudio validado y la persistencia comprueba que el estudio exista antes de escribir.

Quedan fuera login y UI, endpoints HTTP públicos, autoservicio, invitaciones, recuperación de contraseña, Chatwoot, Google Calendar, booking, galerías y datos reales.

## Criterios de aceptación

### Crear estudio y owner

```gherkin
Given un operador con configuración de servidor válida
When ejecuta el alta con nombre de estudio, email, contraseña y nombre visible válidos
Then se crea una identidad autenticable confirmada
And se crean atómicamente studio, user_profile y membership OWNER coherentes
```

### Añadir artista

```gherkin
Given un estudio existente
When el operador ejecuta el alta de artista con identidad y nombre válidos
Then se crea una identidad autenticable confirmada
And se crean atómicamente user_profile, membership ARTIST y artist_profile en ese estudio
And el rol no puede elegirse desde la entrada
And las políticas vigentes mantienen al artista en solo lectura
```

### Entradas y referencias no válidas

```gherkin
Given datos no confiables con espacios, casing variable o formato inválido
When se prepara una operación de alta
Then los nombres se recortan y los emails se normalizan
And los valores fuera del contrato se rechazan antes de llamar a Supabase
And un estudio inexistente o una identidad duplicada produce un error tipado sin datos sensibles
```

### Fallo parcial

```gherkin
Given que Auth crea una identidad y la transacción de dominio falla
When el caso de uso recibe el fallo
Then intenta eliminar la identidad recién creada
And devuelve un error de provisión sin incluir contraseña, token o email
And si la compensación falla devuelve un error tipado que exige intervención operativa
```

### Resultado de persistencia ambiguo

```gherkin
Given que Postgres confirma la transacción pero la respuesta de la RPC se pierde
When el adaptador reintenta la misma provisión
Then la RPC devuelve los identificadores ya persistidos sin duplicar filas
And si tampoco puede confirmarse el reintento devuelve un error tipado con el userId
And conserva la identidad Auth porque no conoce que Postgres haya hecho rollback
```

### Frontera de seguridad

```gherkin
Given un usuario anon o authenticated
When intenta invocar las operaciones SQL de provisión
Then Postgres rechaza la ejecución
But service_role puede ejecutarlas para el alta inicial
```

## Contrato técnico

- `CreateStudioOwnerInput`: `studioName`, `email`, `password`, `displayName`.
- `AddArtistInput`: `studioId`, `email`, `password`, `displayName`.
- Ninguna entrada contiene `role`; los casos de uso fijan `OWNER` o `ARTIST`.
- El password se obtiene en el CLI exclusivamente de `INKENDAR_ONBOARDING_PASSWORD`; no se acepta como argumento ni se imprime.
- La configuración usa `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del entorno; el adaptador no registra cabeceras, cuerpos ni respuestas de Auth.
- `IdentityAdminPort` crea y elimina identidades confirmadas. `OnboardingRepositoryPort` ejecuta las operaciones atómicas de persistencia.
- Las RPC serializan por `user_id`: repetir owner o artista con los mismos datos devuelve los mismos IDs; reutilizar la identidad con datos o rol distintos devuelve `DUPLICATE_IDENTITY`.
- El adaptador reintenta una vez la misma RPC ante transporte, `5xx` o una respuesta exitosa ilegible. Si no puede resolver el resultado, la aplicación conserva Auth y exige intervención con el `userId`.
- Errores públicos tipados: `InvalidOnboardingInputError`, `DuplicateIdentityError`, `StudioNotFoundError`, `ProvisioningFailedError`, `ProvisioningCompensationFailedError` y `ProvisioningOutcomeUnknownError`.
- Las funciones SQL de provisión se revocan a `public`, `anon` y `authenticated`, y se conceden únicamente a `service_role`.

## Plan RED–GREEN–REFACTOR

1. RED: pruebas de aplicación con fakes para normalización, roles fijos, duplicados, referencias inexistentes y compensación.
2. GREEN: value objects, errores, puertos y casos de uso mínimos.
3. RED/GREEN de infraestructura: pruebas del adaptador HTTP con `fetch` falso y CLI/configuración sin secretos en argumentos ni errores.
4. RED/GREEN de persistencia: migración y pgTAP para atomicidad, permisos y coherencia tenant.
5. REFACTOR y validación: pruebas enfocadas, `npm run check`, `npm run db:test`, revisión de diff y búsqueda de secretos.


## Evidencia de implementación

- RED de aplicación: la suite enfocada falló porque `manual-onboarding.js` todavía no existía.
- RED de infraestructura: las suites del adaptador y del CLI fallaron porque sus módulos todavía no existían.
- GREEN enfocado: 28/28 pruebas de aplicación, compensación, adaptador y CLI pasaron, incluidas respuesta perdida, reintento convergente y conservación de Auth ante ambigüedad persistente.
- GREEN completo: `npm run check` pasó lint, tipos de todos los workspaces, 34/34 pruebas y build cliente/SSR.
- Persistencia preparada: `202609130002_manual_onboarding.sql` contiene dos operaciones transaccionales, serializadas e idempotentes con roles fijos, `search_path` vacío y ejecución limitada a `service_role`; `manual_onboarding.test.sql` contiene 21 aserciones para grants, coherencia, reintento sin duplicados, referencias y rollback.
- Limitación local: `npm run db:test` no conectó porque Postgres local rechazó la conexión en `127.0.0.1:54322`. La ejecución pgTAP queda pendiente del job reproducible `database`; por ello este contrato permanece `IN_PROGRESS`.
- Esta evidencia cubre provisión manual. No implementa ni completa login, sesión o UI de autenticación.
