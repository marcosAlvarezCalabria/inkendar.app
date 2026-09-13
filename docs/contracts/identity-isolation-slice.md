# Contrato del slice: identidad y aislamiento multi-tenant

_Estado: IN_PROGRESS_

_Última actualización: 2026-09-13_

## Objetivo

Como owner de un estudio quiero administrar la identidad básica de mi equipo dentro de mi tenant para preparar la operación de Inkendar sin exponer datos a otros estudios.

Como artista quiero consultar únicamente mi membresía y mis perfiles para acceder a mi contexto privado sin obtener capacidades operativas.

## Alcance

Este slice introduce el esquema versionado de `studio`, `user_profile`, `membership` y `artist_profile`, datos sintéticos, Row Level Security y pruebas de integración con Postgres real. Los únicos roles de membresía son `OWNER` y `ARTIST`.

Quedan fuera la UI y los flujos de login, el alta autoservicio de estudios, un proveedor Supabase Cloud, Chatwoot, Google Calendar, booking, galería y cualquier rol manager. El alta inicial se ejecuta mediante una identidad de backend con privilegios de servicio; las políticas de usuario no permiten crear un tenant sin una membresía owner preexistente.

## Criterios de aceptación

### Owner dentro de su estudio

```gherkin
Given un usuario autenticado con membresía OWNER en un estudio
When consulta o modifica studio, membresías y perfiles
Then solo ve y administra filas cuyo studio_id corresponde a su estudio
```

### Artista con acceso propio de solo lectura

```gherkin
Given un usuario autenticado con membresía ARTIST
When consulta membresías y perfiles
Then solo obtiene sus propias filas
And no puede insertar, modificar ni borrar ninguna de ellas
```

### Aislamiento entre estudios

```gherkin
Given dos usuarios autenticados que pertenecen a estudios distintos
When cualquiera consulta o modifica recursos del otro estudio
Then la operación no devuelve ni altera filas privadas del otro estudio
```

### Acceso anónimo

```gherkin
Given una petición sin usuario autenticado
When intenta leer o escribir cualquier tabla privada del slice
Then Postgres rechaza la operación
```

### Contrato de datos

```gherkin
Given las migraciones aplicadas desde cero
When se inspecciona el esquema de identidad
Then las relaciones tenant-scoped contienen studio_id
And sus claves foráneas impiden mezclar recursos de estudios distintos
And membership.role solo admite OWNER o ARTIST
And cada columna usada para autorización o relación tiene un índice adecuado
```

## Contrato técnico

- `auth.users` conserva la identidad de autenticación; `public.user_profile` contiene el perfil tenant-scoped.
- `public.membership` vincula una identidad con un estudio y contiene el rol `OWNER | ARTIST`; su FK compuesta exige que `user_profile_id`, `studio_id` y `user_id` pertenezcan al mismo perfil.
- `public.artist_profile` existe solo para una membresía ARTIST y mantiene una FK compuesta que conserva el tenant.
- `public.studio` es la raíz del tenant. Su `id` es el valor referenciado como `studio_id` por las demás tablas privadas.
- El owner puede `SELECT`, `INSERT`, `UPDATE` y `DELETE` sobre membresías y perfiles de su estudio, y `SELECT`, `UPDATE` y `DELETE` sobre su estudio. La creación inicial de un tenant pertenece al proceso de provisión con rol de servicio.
- El artista recibe únicamente `SELECT` sobre su propia `membership`, `user_profile` y `artist_profile` mediante RLS. No recibe acceso al registro `studio` en este slice.
- `anon` no recibe privilegios sobre las tablas privadas.
- Las políticas consultan roles mediante funciones `SECURITY DEFINER` en un schema no expuesto, con `search_path` vacío, nombres cualificados y permisos de ejecución mínimos para evitar recursión y secuestro de objetos.
- Las pruebas pgTAP cambian a los roles Postgres `authenticated` y `anon`, fijan la identidad JWT y ejecutan consultas y escrituras reales contra las políticas.

## Verificación

- RED de comportamiento: no observado. La prueba se escribió antes de la migración, pero `supabase start` no pudo iniciar porque Docker Desktop no expuso el daemon.
- GREEN de RLS: no declarado. `npm run db:test` terminó con `ECONNREFUSED 127.0.0.1:54322`; la migración y las 38 aserciones quedan preparadas para el agente de integración.
- Validación disponible sin Postgres: `npm test` pasó 6/6 y `npm run check` pasó lint, tipos, tests y build.
