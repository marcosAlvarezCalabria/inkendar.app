# Despliegue SSR en Cloudflare Workers

_Última actualización: 2026-09-23_

Inkendar empaqueta React Router 8 SSR con el plugin oficial de Cloudflare para Vite. El Worker sirve el BFF y delega el resto de peticiones al manejador de React Router; los assets cliente se publican desde `apps/inkendar/build/client`. Supabase Cloud continúa siendo la fuente de Postgres, Auth y Storage: este despliegue no crea ni migra datos a Cloudflare.

## Estado operativo actual

El PR #42 está abierto, limpio y con CI verde en `c2727ee129c9a27f34781fffd45c27a8c2f34903` (`validate` y `database`, run `35879758897`). La configuración, los builds, los dry-runs y el preview local están verificados, pero no existe todavía ningún despliegue de Inkendar en Cloudflare. Tampoco se han creado proyectos Supabase Cloud para Inkendar, configurado secretos remotos, aplicado migraciones Cloud ni registrado los callbacks `workers.dev` en Google.

El siguiente operador debe fusionar primero el PR #42 y seguir [el handoff de despliegue](handoff-2026-09-23-cloudflare-deployment.md). No debe interpretar un dry-run, una URL prevista o un CI verde como servicio publicado.

## Prerrequisitos externos

- una cuenta Cloudflare con el subdominio `workers.dev` `calalva82` y permisos para Workers;
- un proyecto Supabase Cloud de staging y otro de producción, o una decisión explícita y revisada para compartir proyecto;
- Cloudflare Images activado en la cuenta y en cada Worker que use el binding `IMAGES`.

Cloudflare Images Free permite hasta 5.000 transformaciones únicas por mes. Al superar ese límite, las transformaciones nuevas fallan con el error `9422`; el plan Free no cobra el exceso. Cada combinación de imagen origen y parámetros del binding cuenta como transformación única por mes, mientras `.info()` no cuenta. Superar ese uso exige valorar Images Paid según la tarifa vigente. `wrangler deploy --dry-run` valida la configuración y el binding declarado, pero no habilita Images, no crea recursos y no demuestra disponibilidad en la cuenta. Verificar el plan y habilitar Images antes del primer despliegue real.

## Configuración y secretos

`wrangler.jsonc` versiona solo nombres, orígenes públicos y bindings. No se versionan valores locales ni secretos. `INKENDAR_APP_ORIGIN` ya está fijado por entorno:

| Entorno | Origen |
|---|---|
| local | `http://127.0.0.1:5173` |
| staging | `https://inkendar-staging.calalva82.workers.dev` |
| production | `https://inkendar.calalva82.workers.dev` |

Configurar con `wrangler secret put` en `staging` y `production`:

- `SUPABASE_URL`;
- `SUPABASE_PUBLISHABLE_KEY` (o temporalmente `SUPABASE_ANON_KEY` mientras el proyecto todavía la use);
- `SUPABASE_SERVICE_ROLE_KEY`;
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

Nunca ejecutar `supabase db reset` contra un proyecto Cloud. Las migraciones aplicadas no se revierten borrando archivos: un rollback de datos o esquema exige una migración compensatoria revisada y, si hay pérdida o corrupción, el procedimiento de restore de Supabase.

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

El despliegue es una acción manual separada de esta preparación:

```bash
pnpm run deploy:staging
pnpm run deploy:production
```

Producción despliega el Worker `inkendar` en `https://inkendar.calalva82.workers.dev`; staging despliega `inkendar-staging` en `https://inkendar-staging.calalva82.workers.dev`. Ambos conservan `workers_dev=true`; producción desactiva preview URLs para que el único origen operativo sea estable. Antes de promocionar, verificar que Google OAuth y Supabase aceptan el origen/callback exactos. Un dominio personalizado es una mejora futura y requerirá una decisión y migración explícitas de origen, OAuth y cookies.

## Observabilidad y rollback

Wrangler habilita logs y traces de Workers con muestreo completo inicialmente. Revisar errores, latencia y coste tras el piloto y reducir el muestreo si el volumen lo exige. No registrar cookies, tokens, payloads OAuth, claves Supabase, configuración Chatwoot ni contenido de clientes.

Si falla una promoción:

1. detener nuevas promociones y capturar el version ID sano;
2. ejecutar `pnpm exec wrangler rollback --env production --config apps/inkendar/wrangler.jsonc` y seleccionar/indicar la versión sana conforme al runbook de Wrangler vigente;
3. repetir `/healthz`, `/readyz`, login y el recorrido afectado;
4. si el fallo incluye esquema, aplicar una migración compensatoria o el restore autorizado de Supabase; el rollback del Worker no revierte Postgres;
5. rotar cualquier secreto que pudiera haberse expuesto y registrar el incidente sin sus valores.

No se debe usar rollback como sustituto de migraciones compatibles hacia delante y hacia atrás durante una promoción gradual.
