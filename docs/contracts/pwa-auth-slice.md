# Contrato del slice: acceso autenticado a la PWA

_Estado: DONE_

_Última actualización: 2026-09-13_

## Objetivo

Como miembro aprovisionado de un estudio quiero iniciar y cerrar sesión en Inkendar para entrar únicamente en el shell que corresponde a mi rol y tenant.

## Alcance

Este slice conecta React Router SSR con Supabase Auth mediante cookies, resuelve la membresía protegida por RLS y ofrece shells diferenciados para `OWNER` y `ARTIST`. Solo admite identidades creadas por el alta manual gestionada.

Quedan fuera registro público, invitaciones, recuperación de contraseña, agenda, clientes, conversaciones, Chatwoot, Google Calendar, booking, galería y service worker. El shell de artista es informativo y no ofrece escrituras.

## Criterios de aceptación

### Ruta privada anónima

```gherkin
Given una petición sin una sesión autenticada
When abre una ruta privada de la PWA
Then el servidor la redirige al login
And conserva como retorno únicamente la ruta interna solicitada
```

### Credenciales inválidas

```gherkin
Given un email o una contraseña que Supabase Auth no acepta
When se envía el formulario de login
Then se muestra un error genérico
And la respuesta no confirma si la identidad existe
And no registra email, contraseña, tokens ni respuestas sensibles
```

### Entrada por rol y tenant

```gherkin
Given una identidad autenticada con una única membership OWNER coherente
When entra en la PWA
Then accede al shell owner de su tenant
And no puede abrir el shell artista

Given una identidad autenticada con una única membership ARTIST coherente y su artist_profile
When entra en la PWA
Then accede al shell artista de solo lectura de su tenant
And no puede abrir el shell owner
```

### Identidad sin acceso vigente

```gherkin
Given una identidad autenticada sin membership visible y coherente bajo RLS
When intenta entrar en un área privada
Then recibe acceso denegado
And no recibe datos del estudio

Given una respuesta de identidad con usuarios o tenants mezclados, varias memberships o un perfil incoherente
When la aplicación resuelve el acceso
Then falla de forma cerrada
And no devuelve datos privados
```

### Logout

```gherkin
Given una sesión autenticada
When el usuario envía la acción de cerrar sesión
Then Supabase invalida la sesión local
And las cookies actualizadas se devuelven al navegador
And el servidor redirige al login
```

### Mutaciones same-origin

```gherkin
Given una petición de login o logout sin Origin verificable, con Origin externo o con Sec-Fetch-Site cross-site
When alcanza la acción del servidor
Then se rechaza antes de leer credenciales o tocar la sesión
And no se confía en Host ni en cabeceras X-Forwarded aportadas por el cliente
```

### Retorno seguro

```gherkin
Given un parámetro de retorno absoluto, protocol-relative, externo o malformado
When el login termina correctamente
Then se ignora el valor no confiable
And se usa el shell autorizado por rol
```

### Configuración y secretos

```gherkin
Given que falta la URL o la clave pública de Supabase
When se compone el adaptador de autenticación
Then la petición falla cerrada sin iniciar una sesión
And la clave service_role no forma parte de la configuración ni del bundle del navegador

Given que el alta manual crea una identidad confirmada mediante la Admin API
When esa identidad inicia sesión con email y contraseña
Then el proveedor email está disponible para autenticarla
And el registro público continúa deshabilitado por la configuración global de Auth
```

### Caché privada

```gherkin
Given una respuesta de login, logout, acceso denegado o shell privado
When el servidor la devuelve
Then incluye Cache-Control private, no-store
And no existe un service worker que persista datos privados
```

## Contrato técnico

- El dominio decide si una identidad, membership y perfiles forman un acceso coherente `OWNER | ARTIST`; cualquier ambigüedad se deniega.
- Aplicación define puertos para sesión y lectura de acceso. No importa React Router ni Supabase.
- Infraestructura implementa ambos puertos con `@supabase/ssr`, una clave pública y el token de la cookie; `auth.getUser()` valida la identidad con Auth y las lecturas posteriores respetan RLS.
- El composition root vive en `apps/inkendar/app` y convierte cada `Request` en un adaptador con cabeceras `Set-Cookie` propagables, también cuando una ruta privada rota la sesión.
- Las cookies Auth son `HttpOnly`, `SameSite=Lax`, `Path=/` y `Secure` en producción; local y test conservan HTTP sin `Secure`. Los atributos se imponen sobre cada escritura de Supabase, incluida renovación y borrado.
- `/login` acepta solo email/password y devuelve un único mensaje público para cualquier rechazo de credenciales.
- `POST /login` y `POST /logout` exigen un `Origin` HTTP(S) idéntico al origen confiable; `Sec-Fetch-Site`, cuando existe, debe ser `same-origin`. `INKENDAR_APP_ORIGIN` fija el origen canónico detrás de proxy, sin ruta ni barra final.
- `/app`, `/app/owner` y `/app/artist` se protegen en loaders SSR. El servidor no serializa la membership completa: solo los campos mínimos del shell autorizado.
- `/logout` acepta únicamente `POST` y usa logout de alcance local.
- Las rutas privadas y de autenticación devuelven `Cache-Control: private, no-store`.

## Plan RED-GREEN-REFACTOR

1. RED de dominio/aplicación: roles válidos, ausencia, duplicidad, perfiles incoherentes y errores genéricos.
2. RED de rutas: retorno interno seguro, redirect anónimo, acceso por rol, denegación y logout.
3. GREEN con puertos, adaptador Supabase SSR, composition root y UI mínima accesible.
4. Integración desechable contra Supabase local para login real, cookies, RLS y logout.
5. REFACTOR, validación enfocada, `npm run check`, `npm run db:test`, smoke del build y revisión de secretos.

## Evidencia de implementación

- RED de dominio/aplicación e infraestructura/rutas: 4 suites fallaron por los módulos todavía ausentes.
- GREEN enfocado de continuidad: 2 suites y 22 pruebas pasan para cookies endurecidas, propagación de rotación, CSRF, guards, retorno seguro y logout; la integración condicionada compila y queda omitida sin Supabase local.
- `supabase-auth.integration.test.ts` cubre OWNER y ARTIST sintéticos en dos tenants, guards cruzados, lecturas bajo RLS, cookies de login/logout y cleanup comprobado en `finally` dentro del job `database`.
- El mismo smoke exige que el registro público por email siga rechazado antes de comprobar que identidades confirmadas mediante Admin API pueden autenticarse por contraseña.
- `npm run check` pasó lint, tipos, 75 pruebas (más la integración condicionada omitida) y build cliente/SSR. En GitHub Actions, 59 aserciones pgTAP y el smoke real de Auth con ambos roles, RLS, guards, cookies y logout pasaron en el job `database` del [run 34762663413](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/34762663413).
- El build no contiene `service_role`; esa credencial se limita a procesos de servidor aislados.
