# Contrato del slice: acceso autenticado a la PWA

_Estado: IN_PROGRESS_

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
- El composition root vive en `apps/inkendar/app` y convierte cada `Request` en un adaptador con cabeceras `Set-Cookie` propagables.
- `/login` acepta solo email/password y devuelve un único mensaje público para cualquier rechazo de credenciales.
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
- GREEN enfocado: 4 suites y 26 pruebas pasaron para coherencia, error genérico, adaptador, cookies, guards, retorno seguro y logout.
- `npm run check` pasó lint, tipos, 64 pruebas, una integración condicionada omitida y build cliente/SSR.
- `supabase-auth.integration.test.ts` prueba un owner sintético con Auth, cookies, RLS y logout dentro del job `database`.
- Limitación local: `supabase start` no quedó listo en 90 segundos y `npm run db:test` devolvió `ECONNREFUSED` a `127.0.0.1:54322`. El extremo real no se declara `PASS` hasta que CI termine verde.
- El build no contiene `service_role`; esa credencial se limita a procesos de servidor aislados.
