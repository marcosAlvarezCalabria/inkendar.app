# Despliegue SSR en Cloudflare Workers

_Última actualización: 2026-09-23_

Inkendar empaqueta React Router 8 SSR con el plugin oficial de Cloudflare para Vite. El Worker sirve el BFF y delega el resto de peticiones al manejador de React Router; los assets cliente se publican desde `apps/inkendar/build/client`. Supabase Cloud continúa siendo la fuente de Postgres, Auth y Storage: este despliegue no crea ni migra datos a Cloudflare.

## Prerrequisitos externos

- una cuenta Cloudflare con la zona `inkendar.es` y permisos para Workers y rutas custom domain;
- `app.inkendar.es` disponible para el entorno de producción;
- un proyecto Supabase Cloud de staging y otro de producción, o una decisión explícita y revisada para compartir proyecto;
- Cloudflare Images activado en la cuenta y en cada Worker que use el binding `IMAGES`.

Cloudflare Images es un producto facturado. Las transformaciones mediante binding cuentan como transformaciones únicas conforme al plan vigente. `wrangler deploy --dry-run` valida la configuración y el binding declarado, pero no activa Images, no crea recursos y no demuestra autorización o facturación. Verificar el plan y activar Images antes del primer despliegue real.

## Configuración y secretos

`wrangler.jsonc` versiona solo nombres, orígenes públicos y bindings. No se versionan valores locales ni secretos. `INKENDAR_APP_ORIGIN` ya está fijado por entorno:

| Entorno | Origen |
|---|---|
| local | `http://127.0.0.1:5173` |
| staging | `https://staging.app.inkendar.es` |
| production | `https://app.inkendar.es` |

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

La URI OAuth registrada para producción debe ser exactamente:

```text
https://app.inkendar.es/auth/google/callback
```

Registrar aparte la URI de staging correspondiente. `INKENDAR_SMTP_CONNECTIONS_JSON` pertenece al runner de notificaciones fuera del Worker y se configura solo en el entorno autorizado que ejecute ese proceso.

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

Producción declara `app.inkendar.es` como custom domain y desactiva `workers.dev` y preview URLs. Antes de promocionar, verificar que la zona está en la misma cuenta, que no existe una ruta conflictiva y que Google OAuth y Supabase aceptan el origen/callback final. Staging usa `workers.dev` hasta provisionar y validar `staging.app.inkendar.es`; cambiarlo a custom domain antes de depender de ese hostname externamente.

## Observabilidad y rollback

Wrangler habilita logs y traces de Workers con muestreo completo inicialmente. Revisar errores, latencia y coste tras el piloto y reducir el muestreo si el volumen lo exige. No registrar cookies, tokens, payloads OAuth, claves Supabase, configuración Chatwoot ni contenido de clientes.

Si falla una promoción:

1. detener nuevas promociones y capturar el version ID sano;
2. ejecutar `pnpm exec wrangler rollback --env production --config apps/inkendar/wrangler.jsonc` y seleccionar/indicar la versión sana conforme al runbook de Wrangler vigente;
3. repetir `/healthz`, `/readyz`, login y el recorrido afectado;
4. si el fallo incluye esquema, aplicar una migración compensatoria o el restore autorizado de Supabase; el rollback del Worker no revierte Postgres;
5. rotar cualquier secreto que pudiera haberse expuesto y registrar el incidente sin sus valores.

No se debe usar rollback como sustituto de migraciones compatibles hacia delante y hacia atrás durante una promoción gradual.
