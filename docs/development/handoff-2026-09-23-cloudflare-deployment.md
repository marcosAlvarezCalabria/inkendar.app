# Handoff: primer despliegue Cloudflare de Inkendar

_Fecha: 2026-09-23_

## Objetivo único del siguiente chat

Publicar de forma segura primero staging y después producción, sin comprar dominio:

- staging: `https://inkendar-staging.calalva82.workers.dev`;
- producción: `https://inkendar.calalva82.workers.dev`.

No desarrollar otra feature durante este slice. El runbook autoritativo es [cloudflare-workers-deployment.md](cloudflare-workers-deployment.md).

## Estado verificable al cerrar este chat

- `main` termina en `dc03521` (PR #41).
- PR abierto: [#42](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/42), rama `codex/cloudflare-production`, HEAD `c2727ee129c9a27f34781fffd45c27a8c2f34903`, estado `CLEAN`.
- CI del PR: run `35879758897`, jobs `validate` y `database` exitosos.
- Validación independiente con Node 24.19.0: 52/52 pruebas enfocadas; suite completa 556 pasadas y 1 omitida; lint, typecheck y build verdes; build→dry-run de staging y producción verdes.
- Preview local: `/healthz` respondió 200; `/readyz` respondió 503 de forma esperada sin secretos ni binding remoto real.
- No se hizo merge, despliegue, migración Cloud ni creación de recursos remotos de Inkendar.

La cuenta Cloudflare ya está autenticada en este equipo y su subdominio público es `calalva82`. Supabase CLI también quedó autenticada. La lista de Supabase no contiene un proyecto Inkendar; los proyectos existentes pertenecen a otras aplicaciones y no deben reutilizarse ni modificarse.

## Decisiones vigentes

- Cloudflare Workers ejecuta React Router 8 SSR/BFF y sirve assets.
- Supabase Cloud conserva Postgres, Auth y Storage.
- Cloudflare Images reemplaza únicamente al adaptador `sharp`; conserva el contrato de variantes privadas.
- El primer despliegue usa `workers.dev`; no requiere comprar dominio.
- Cloudflare Images Free admite hasta 5.000 transformaciones únicas al mes; al superar el límite, nuevas transformaciones fallan con `9422` y el plan Free no cobra el exceso. Verificar disponibilidad real antes del smoke.
- `INKENDAR_APP_ORIGIN` es obligatorio; producción falla cerrada si falta. No derivar confianza de `Host` ni cabeceras reenviadas.
- Los callbacks Google OAuth y orígenes son literales, sin comodines.

## Secuencia obligatoria

1. Verificar de nuevo PR #42 y pedir al usuario que lo fusione; no integrar directamente en `main`.
2. Sincronizar `main` y registrar el SHA fusionado que se va a publicar.
3. Decidir con el usuario si staging y producción usarán dos proyectos Supabase separados. Preferencia segura: separados; no reutilizar proyectos ajenos.
4. Crear/enlazar los proyectos autorizados. Ejecutar `supabase db push --linked --dry-run`, revisar backup/restore y solo después `db push`. Nunca ejecutar `db reset` remoto ni incluir seed de desarrollo.
5. Configurar URL del sitio y redirects exactos en Supabase Auth para cada entorno.
6. Registrar en Google OAuth exactamente los callbacks `workers.dev` documentados en el runbook.
7. Configurar secretos Cloudflare mediante entrada segura, nunca en argumentos, logs, Markdown o Git: `SUPABASE_URL`, clave publicable, `SUPABASE_SERVICE_ROLE_KEY`, credenciales Google, `GOOGLE_TOKEN_ENCRYPTION_KEY` y configuración Chatwoot si se habilita.
8. Confirmar Cloudflare Images Free/binding y desplegar staging desde el commit fusionado.
9. Exigir `/healthz=200` y `/readyz=200`; verificar login/logout, OWNER/ARTIST, OAuth/asignación, disponibilidad, elección/aprobación, subida/publicación/retirada sintética y feed/componente. No usar datos reales de clientes.
10. Solo con staging verde, desplegar exactamente la misma revisión a producción y repetir los flujos críticos. Registrar version/deployment IDs y versión sana para rollback.

## Límites y recuperación

El scheduler de notificaciones sigue siendo un proceso externo al Worker; no declarar notificaciones operativas sin ejecutar ese runner y una prueba live. Un rollback del Worker no revierte migraciones Supabase: cualquier cambio de esquema debe ser compatible o tener migración compensatoria/restore autorizado. No anunciar producción por un HTTP 200 aislado; login, mutaciones same-origin, Google y galería deben funcionar en el origen efectivo.

El checkout principal local tenía una modificación del usuario en `supabase/config.toml` para puertos locales; preservarla y no incluirla en el despliegue. No copiar `.env.local`, tokens, claves, contraseñas ni datos sintéticos locales al repositorio o al handoff.
