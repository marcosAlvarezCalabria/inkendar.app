# Contrato del slice: suspensión de acceso ARTIST

_Estado: IN_PROGRESS — implementación y validación locales; revisión independiente, PR y CI pendientes_

_Última actualización: 2026-09-26_

## Objetivo

Como OWNER activo quiero suspender y restaurar el acceso de un ARTIST de mi estudio para retirar permisos sin borrar su identidad ni su historial.

## Criterios de aceptación

```gherkin
Given un OWNER activo con una única membership coherente
When abre Equipo y accesos
Then ve los miembros de su estudio y el estado ACTIVE o SUSPENDED de cada uno
And solo los ARTIST ofrecen una acción de suspensión o restauración

Given un ARTIST activo con sesión o token vigente
When el OWNER de su estudio suspende su membership
Then su siguiente login o petición privada queda denegada
And tampoco puede ejecutar directamente get_artist_agenda
And auth.users, membership, perfiles, casos, citas e historial permanecen

Given ese ARTIST suspendido
When el mismo OWNER lo restaura
Then la misma identidad puede volver a acceder sin nueva provisión

Given un actor ARTIST, OWNER suspendido o con memberships ambiguas, un target OWNER,
      self, ID inválido o tenant ajeno
When intenta cambiar el estado de acceso
Then la operación falla cerrada sin revelar datos ni alterar filas
```

## Contrato técnico

- `membership.status` admite solo `ACTIVE | SUSPENDED`, con `ACTIVE` por defecto. `access_changed_at` y `access_changed_by` conservan el último cambio efectivo; repetir la misma transición no reescribe la fila. Este slice no crea un registro de auditoría genérico.
- El OWNER lee las memberships de su tenant con su sesión SSR. La UI `/app/owner/team` usa tarjetas de una columna y acciones táctiles etiquetadas; los OWNER aparecen sin acción.
- El POST exige origen confiable, método y campos exactos `intent` y `membershipId`. No acepta `studioId` ni `ownerId`. Todas las respuestas privadas usan `Cache-Control: private, no-store` y saneamiento de errores.
- `public.set_artist_access(uuid, membership_status)` es `SECURITY DEFINER`, fija `search_path=''`, deriva el actor de `auth.uid()`, exige una sola membership OWNER activa y perfil coherente, y bloquea una membership ARTIST coherente del mismo tenant antes de cambiarla. Solo `authenticated` puede ejecutarla; `anon`, `public` y `service_role` no.
- `authenticated` conserva SELECT de membership bajo RLS, pero pierde INSERT/UPDATE/DELETE directos. `service_role` conserva la provisión gestionada. `private.is_studio_owner` y `private.is_studio_artist` exigen ACTIVE; el SELECT propio de membership también. `get_artist_agenda` verifica ACTIVE dentro de su RPC, incluso con token anterior a la suspensión.
- La suspensión no toca Auth, perfiles, clientes, casos, opciones, citas, Storage ni proveedores externos. La restauración cambia solo la membership y su marca de último cambio.

## Evidencia y gate

- RED: pruebas de dominio mostraron que OWNER y ARTIST suspendidos seguían autorizados; pgTAP falló sin el nuevo estado/RPC. Las suites nuevas de aplicación, infraestructura, handler y UI también se añadieron antes de sus módulos.
- GREEN local con Node 24/pnpm 10.22: pruebas enfocadas, lint, typecheck, suite TypeScript completa (642 aprobadas, 1 omitida), build y pgTAP completo (31 archivos, 987 aserciones) pasan. El archivo nuevo tiene 39 aserciones.
- Pendientes: revisión independiente del diff, CI del PR y cualquier recorrido live. No se afirma despliegue ni disponibilidad en staging/producción.
