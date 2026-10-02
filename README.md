# Inkendar App

PWA y backend de Inkendar para operar conversaciones, casos de tatuaje, propuestas de fecha, citas, agenda de artistas y contenido publicado por estudios.

## Separación de superficies

Este repositorio contiene únicamente el panel/PWA y su backend: React Router/TypeScript sobre Cloudflare Workers, con Supabase Cloud para persistencia y aislamiento. La landing comercial es un proyecto independiente en [`marcosAlvarezCalabria/inkendar`](https://github.com/marcosAlvarezCalabria/inkendar), está construida con Astro y se despliega por Netlify. Un build, preview o despliegue de una superficie no valida ni publica la otra.

## Estado

La base técnica ejecutable está en construcción. El estado verificable de cada área, la evidencia de CI y el siguiente gate se mantienen únicamente en la [especificación viva](docs/product/sellable-mvp-spec.md); este README no duplica el progreso por slices.

## Requisitos

- Node.js 24 LTS (también se admite la última línea 22.22.x de mantenimiento).
- pnpm 10.22.0.

## Desarrollo

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

La aplicación se sirve en la URL que indique React Router. La validación local completa es:

```bash
pnpm run check
```

Ese comando ejecuta lint, comprobación de tipos de todos los workspaces, pruebas y build SSR para Cloudflare Workers. El artefacto resultante separa `apps/inkendar/build/client` y `apps/inkendar/build/server`; `pnpm run preview` permite un smoke local del último build.

`INKENDAR_APP_ORIGIN` es obligatorio al desarrollar, validar y desplegar la aplicación. Debe contener el origen externo HTTP(S) exacto (producción usa `https://inkendar.calalva82.workers.dev`, sin ruta ni barra final); React Router permite acciones reenviadas únicamente desde el host exacto derivado de ese valor. Una configuración ausente o inválida impide arrancar o construir la aplicación. La aplicación no deriva esta decisión de `Host`, `Forwarded` ni `X-Forwarded-*`.

La configuración de staging/producción, secretos, migraciones Supabase Cloud, dominio, verificación y rollback se documenta en [Despliegue SSR en Cloudflare Workers](docs/development/cloudflare-workers-deployment.md).

## Alta manual gestionada

El alta se ejecuta solo desde un entorno de servidor autorizado. Configura `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `INKENDAR_ONBOARDING_PASSWORD` como variables de entorno; no guardes sus valores en el repositorio ni pases la contraseña como argumento.

Las claves modernas `sb_secret_*` se envían al Admin API y a las RPC exclusivamente mediante la cabecera `apikey`. Las claves JWT `service_role` heredadas conservan además `Authorization: Bearer` por compatibilidad. Ninguna credencial privilegiada debe usarse desde el navegador.

```bash
pnpm run onboard -- create-studio-owner \
  --studio-name "Studio Example" \
  --display-name "Owner Example" \
  --email "owner@example.test"

pnpm run onboard -- add-artist \
  --studio-id "00000000-0000-4000-8000-000000000000" \
  --display-name "Artist Example" \
  --email "artist@example.test"
```

Los comandos fijan `OWNER` y `ARTIST` respectivamente; no existe una opción de rol. El segundo comando solo admite un UUID y la transacción rechaza estudios inexistentes. Si Postgres falla después de crear Auth, el caso de uso intenta eliminar esa identidad; un fallo de compensación devuelve `PROVISIONING_COMPENSATION_FAILED` para intervención operativa.

Este CLI usa credenciales privilegiadas. No se importa desde rutas HTTP ni se distribuye al navegador.

### Acceso sintético de staging

Tras un alta o reset controlado de staging, guarda únicamente las cuatro variables `INKENDAR_STAGING_OWNER_EMAIL`, `INKENDAR_STAGING_OWNER_PASSWORD`, `INKENDAR_STAGING_ARTIST_EMAIL` e `INKENDAR_STAGING_ARTIST_PASSWORD` en `.env.staging.access`. El patrón `.env.*` está ignorado por Git; restringe además el archivo al usuario local y no incluyas en él claves administrativas, secretos OAuth ni credenciales de proveedores.

El archivo privado es una entrega local temporal, no un gestor de secretos. Copia manualmente las dos credenciales de acceso a tu gestor de contraseñas y no automatices esa importación. Nunca versiones ni compartas el archivo.

### Reset controlado de staging

Un reset remoto es una operación excepcional e irreversible. Antes de ejecutarlo, confirma mediante interfaces de solo lectura que el proyecto enlazado es inequívocamente staging, revisa la paridad completa de migraciones, inventaría solo recuentos agregados y decide explícitamente el punto de recuperación o la renuncia autorizada a él. No uses este procedimiento contra producción.

Cuando el objetivo sea reconstruir staging vacío desde las migraciones vigentes, usa una sola vez `pnpm exec supabase db reset --linked --no-seed --yes`. `--no-seed` es obligatorio: el seed local contiene fixtures de desarrollo y no sustituye el alta gestionada. Después verifica Auth, todas las tablas de aplicación, Storage y huérfanos en cero antes de crear identidades mediante el CLI de onboarding.


## Estructura

```text
apps/inkendar/           PWA y límite HTTP/API-BFF
packages/domain/         reglas puras de negocio
packages/application/    casos de uso, DTO y puertos
packages/infrastructure/ adaptadores de proveedores
packages/public-content/ contenido público integrable
packages/ui/             interfaz compartida
tests/architecture/      límites entre workspaces
```

Las dependencias internas apuntan hacia `domain`: `application` depende de `domain`; los adaptadores dependen de `application` y `domain`; la aplicación compone el conjunto. La prueba de arquitectura rechaza dependencias de workspace fuera de ese grafo.

## Fuentes de verdad

- [Especificación del producto](docs/product/sellable-mvp-spec.md)
- [Arquitectura de aplicación](docs/architecture/application-architecture.md)
- [Decisión de plataforma](docs/architecture/platform-decision.md)
- [Flujo de desarrollo e integración](docs/development/delivery-workflow.md)

La landing comercial vive en [marcosAlvarezCalabria/inkendar](https://github.com/marcosAlvarezCalabria/inkendar).
