# Despliegue SSR en Cloudflare Workers

_Última actualización: 2026-10-05_

Inkendar empaqueta React Router 8 SSR con el plugin oficial de Cloudflare para Vite. El Worker sirve el BFF y delega el resto de peticiones al manejador de React Router; los assets cliente se publican desde `apps/inkendar/build/client`. Supabase Cloud continúa siendo la fuente de Postgres, Auth y Storage: este despliegue no crea ni migra datos a Cloudflare.

## Estado operativo actual

El [PR #42](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/42) quedó integrado como `271cb35` y habilitó el despliegue separado de staging y producción. Staging está publicado en `https://inkendar-staging.calalva82.workers.dev` sobre el proyecto Supabase Cloud `inkendar-staging`, con migraciones aplicadas y los secretos Supabase requeridos. El 2026-09-26 `/readyz` devolvió `200`; login OWNER y Ofertas pasaron smoke externo a 320 CSS px y en un teléfono físico.

Tras integrar el [PR #50](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/50), `main` `62db889d3d031a3e2df34f0e86057e346b4b3d2f` se desplegó en staging como versión `47191259-514f-45b1-8559-f221e8825e97`. `/readyz` devolvió `200`; los assets offline respondieron `200` y un smoke automatizado a 320 CSS px verificó control, allowlist, bloqueo con preservación y reconexión. La navegación al fallback quedó inconclusa por la limitación del simulador de red. Producción continúa sin despliegue y no debe publicarse sin aprobación explícita. El [handoff del 2026-09-23](handoff-2026-09-23-cloudflare-deployment.md) se conserva como evidencia histórica, no como lista de acciones vigente.

Tras integrar los [PR #52](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/52) y [#53](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/53), `main` `81ab2d713a12cc295479a078b8d5b55ed407458b` se desplegó en staging como versión `5ca5b753-0d26-49a2-80df-6ac2f478b5a9`. La construcción y el dry-run usaron Node 24.19.0, pnpm 10.22.0 y Wrangler 4.136.3; `/healthz`, `/readyz` y `/login` devolvieron `200`. El Worker conserva únicamente los secretos Supabase: `INKENDAR_CHATWOOT_CONNECTIONS_JSON` sigue ausente, por lo que no se atribuye un recorrido live de conversaciones o imágenes. Producción no se desplegó.

Tras integrar el [PR #59](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/59) como squash `641579dcfa978293a200163c2da29e1099a24d1e`, el [run post-merge 36472666798](https://github.com/marcosAlvarezCalabria/inkendar.app/actions/runs/36472666798) dejó `validate` y `database` verdes. `main` se desplegó exclusivamente en `inkendar-staging` como versión `c8fddbc1-cb2b-4f1b-bc49-bee4740427f1`; `/healthz` y `/readyz` devolvieron `200` dos veces. `INKENDAR_CHATWOOT_CONNECTIONS_JSON` quedó configurado como secreto cifrado y se verificaron listado, detalle, recepción y respuesta de texto con datos sintéticos, incluida una conversación Instagram bidireccional. El webhook firmado, una imagen entrante live y la actualización automática siguen pendientes. Producción no se desplegó.

El 2026-10-04 se detectó que `pnpm run deploy:staging`, ejecutado sin un build previo, reutilizaba `apps/inkendar/build/server/wrangler.json` de otro entorno. Ese primer intento publicó accidentalmente el Worker no productivo `inkendar-local` como versión `0172c82b-5de4-4321-8f46-a7ab8cbb1694`; no tocó producción. Después de ejecutar `pnpm run build:staging`, el artefacto confirmó `name=inkendar-staging` y origen de staging, y el despliegue correcto publicó `inkendar-staging` como versión `e5b4a9cf-6f51-44cf-b45f-b96a46520d72`; `/healthz`, `/readyz` y `/login` devolvieron `200`. El wrapper queda corregido para reconstruir siempre el artefacto del entorno solicitado inmediatamente antes de `wrangler deploy`, abortando la publicación si falla el build. Producción continúa bloqueada y sin despliegue.

Ese mismo `main` contiene el [PR #80](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/80), integrado como `c1e734d`, que permite la respuesta válida de Chatwoot cuando su `POST` exitoso omite `account_id`, sin relajar las demás comprobaciones. Un runner local autorizado con configuración temporal entregó exactamente un primer mensaje a Chatwoot/Instagram, pero la omisión dejó la intención en `UNKNOWN`, `attempt_count=1` y sin `external_message_id`. Tras el fix, una nueva solicitud sintética `REJECTED` produjo `{expired:0,claimed:1,sent:1,failed:0,unknown:0,noRoute:0}` y la segunda ejecución idempotente `{expired:0,claimed:0,sent:0,failed:0,unknown:0,noRoute:0}`. La conversación terminó con exactamente dos mensajes, uno por cada prueba y ningún duplicado adicional. Esta prueba acredita el runner local y el proveedor; no valida todavía la pantalla OWNER Conversaciones ni el secreto/configuración Chatwoot del Worker después del reset de staging.

El [PR #84](https://github.com/marcosAlvarezCalabria/inkendar.app/pull/84) se integró como `92242fc` después de que la observabilidad del PR #83 aislara un rechazo `schema_invalid` de una entrega real con firma válida. El fix admite `conversation.account.id` y conserva la forma legada `conversation.account_id`, verificando toda forma presente contra la cuenta configurada. No añadió migraciones. `main` `92242fc741f731036018ce111dbd3c8f3c7da729` se desplegó solo en `inkendar-staging` como versión Worker `573a34cc-9eee-4bcd-9cfb-d3c385e9d07d`; `/healthz`, `/readyz` y `/login` devolvieron `200`. Una única entrega real posterior creó un intento `accepted` y elevó el total de receipts de uno a dos; el intento histórico `schema_invalid` permanece. Esto valida la recepción firmada y la persistencia en staging, sin acreditar una imagen live ni la actualización visual de OWNER. Producción no se desplegó.

## Prerrequisitos externos

- una cuenta Cloudflare con el subdominio `workers.dev` `calalva82` y permisos para Workers;
- el proyecto Supabase Cloud de staging ya existe; producción necesita un proyecto separado o una decisión explícita y revisada antes de publicarse;
- Cloudflare Images activado en la cuenta y en cada Worker que use el binding `IMAGES`.

Cloudflare Images Free permite hasta 5.000 transformaciones únicas por mes. Al superar ese límite, las transformaciones nuevas fallan con el error `9422`; el plan Free no cobra el exceso. Cada combinación de imagen origen y parámetros del binding cuenta como transformación única por mes, mientras `.info()` no cuenta. Superar ese uso exige valorar Images Paid según la tarifa vigente. `wrangler deploy --dry-run` valida la configuración y el binding declarado, pero no habilita Images, no crea recursos y no demuestra disponibilidad en la cuenta. Verificar el plan y habilitar Images antes del primer despliegue real.

## Configuración y secretos

`wrangler.jsonc` versiona solo nombres, orígenes públicos y bindings. No se versionan valores locales ni secretos. `INKENDAR_APP_ORIGIN` ya está fijado por entorno:

| Entorno | Origen |
|---|---|
| local | `http://127.0.0.1:5173` |
| staging | `https://inkendar-staging.calalva82.workers.dev` |
| production | `https://inkendar.calalva82.workers.dev` |

Staging tiene configurados `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, las credenciales Google del recorrido Calendar y `INKENDAR_CHATWOOT_CONNECTIONS_JSON`. Desde el 2026-10-03 los dos bindings de clave Supabase contienen claves modernas `sb_publishable_*` y `sb_secret_*`; las claves JWT legacy `anon` y `service_role` están desactivadas en el proyecto staging tras revalidar OWNER y ARTIST. Los nombres de binding se conservan por compatibilidad interna y no indican el formato de la credencial. Cualquier secreto de un runner nuevo se añade únicamente al ejecutar su recorrido live. Producción no tiene configuración operativa y debe permanecer así hasta aprobación explícita.

Los secretos pendientes o de nuevos entornos se configuran con `wrangler secret put` en el entorno correspondiente:

- `SUPABASE_URL`;
- `SUPABASE_PUBLISHABLE_KEY` con una clave moderna `sb_publishable_*`;
- `SUPABASE_SERVICE_ROLE_KEY` con una clave moderna `sb_secret_*` (el nombre se conserva por compatibilidad interna);
- `GOOGLE_OAUTH_CLIENT_ID`;
- `GOOGLE_OAUTH_CLIENT_SECRET`;
- `GOOGLE_OAUTH_REDIRECT_URI`;
- `GOOGLE_TOKEN_ENCRYPTION_KEY`;
- `INKENDAR_CHATWOOT_CONNECTIONS_JSON`.

Ejemplo, sin escribir el valor en el historial del shell:

```bash
pnpm exec wrangler secret put SUPABASE_URL --env production --config apps/inkendar/wrangler.jsonc
```

Las URI OAuth registradas para el flujo Cloudflare deben ser exactamente:

```text
http://127.0.0.1:5173/auth/google/callback
https://inkendar-staging.calalva82.workers.dev/auth/google/callback
https://inkendar.calalva82.workers.dev/auth/google/callback
```

El callback local heredado `http://127.0.0.1:3000/auth/google/callback` continúa permitido para el flujo Node existente. La allowlist es literal: no admite comodines, hosts alternativos, rutas distintas ni barras finales. `INKENDAR_SMTP_CONNECTIONS_JSON` pertenece al runner de notificaciones fuera del Worker y se configura solo en el entorno autorizado que ejecute ese proceso.

## Migraciones Supabase Cloud

Las migraciones siguen siendo las SQL versionadas en `supabase/migrations`. Antes de desplegar código que dependa de una migración:

1. revisar el proyecto enlazado con `supabase projects list` y `supabase link --project-ref <ref>`;
2. inspeccionar el plan con `supabase db push --linked --dry-run`;
3. obtener o verificar el backup de producción según el plan Supabase;
4. ejecutar `supabase db push --linked` desde un runner autorizado;
5. ejecutar los smoke tests Auth/RLS y solo entonces promocionar el Worker.

No ejecutar `supabase db reset` contra producción ni usarlo como mecanismo de rollback. La única excepción aceptada es una reconstrucción extraordinaria de staging conforme a [DEC-053](../product/sellable-mvp-spec.md): target enlazado inequívoco, paridad y recuentos agregados verificados, punto de recuperación decidido o renuncia explícita, una sola ejecución con `--linked --no-seed --yes`, comprobación posterior en cero y reprovisión mediante el alta gestionada. Las migraciones aplicadas no se revierten borrando archivos: un rollback de datos o esquema exige una migración compensatoria revisada y, si hay pérdida o corrupción, el procedimiento de restore de Supabase.

## Construcción y validación

```bash
pnpm run typegen
pnpm run check
pnpm run build:staging
pnpm run dry-run:staging
pnpm run build:production
pnpm run dry-run:production
```

Los dry-runs escriben artefactos locales bajo `dist/cloudflare-*`; no publican. Para un smoke local del build más reciente:

```bash
pnpm run preview
```

Comprobar:

- `GET /healthz` devuelve `200` y solo `{ "status": "ok" }`;
- `GET /readyz` devuelve `200` cuando existen Supabase, origen e Images, o `503` sin enumerar qué secreto falta;
- login, logout y cookies SSR;
- acceso OWNER y ARTIST tenant-safe;
- callback OAuth y una lectura Calendar sintética;
- subida de imagen sintética y variantes MASTER/DISPLAY/THUMB privadas;
- feed público y retirada de una imagen sintética.

La emulación local de Images es de fidelidad reducida. El smoke real del binding debe hacerse en staging tras activar Images, sin reutilizar material de clientes.

## Promoción y dominio

El despliegue es una acción manual por entorno:

```bash
pnpm run deploy:staging
pnpm run deploy:production
```

Cada comando `deploy:*` vuelve a construir la galería y React Router con `CLOUDFLARE_ENV` e `INKENDAR_APP_ORIGIN` del destino antes de invocar `wrangler deploy`; no depende del contenido previo de `apps/inkendar/build`. Si cualquiera de esos pasos falla, Wrangler no se ejecuta. Producción desplegará el Worker `inkendar` en `https://inkendar.calalva82.workers.dev`; staging despliega `inkendar-staging` en `https://inkendar-staging.calalva82.workers.dev`. Ambos conservan `workers_dev=true`; producción desactiva preview URLs para que el único origen operativo sea estable. Antes de promocionar, verificar que Google OAuth y Supabase aceptan el origen/callback exactos. Un dominio personalizado es una mejora futura y requerirá una decisión y migración explícitas de origen, OAuth y cookies.

## Observabilidad y rollback

Wrangler habilita logs y traces de Workers con muestreo completo inicialmente. Revisar errores, latencia y coste tras el piloto y reducir el muestreo si el volumen lo exige. No registrar cookies, tokens, payloads OAuth, claves Supabase, configuración Chatwoot ni contenido de clientes.

Si falla una promoción:

1. detener nuevas promociones y capturar el version ID sano;
2. ejecutar `pnpm exec wrangler rollback --env production --config apps/inkendar/wrangler.jsonc` y seleccionar/indicar la versión sana conforme al runbook de Wrangler vigente;
3. repetir `/healthz`, `/readyz`, login y el recorrido afectado;
4. si el fallo incluye esquema, aplicar una migración compensatoria o el restore autorizado de Supabase; el rollback del Worker no revierte Postgres;
5. rotar cualquier secreto que pudiera haberse expuesto y registrar el incidente sin sus valores.

No se debe usar rollback como sustituto de migraciones compatibles hacia delante y hacia atrás durante una promoción gradual.
