# Inkendar App

PWA y backend de Inkendar para operar conversaciones, casos de tatuaje, propuestas de fecha, citas, agenda de artistas y contenido publicado por estudios.

## Estado

La base técnica ejecutable está en construcción. El repositorio contiene React Router full-stack, el esquema de identidad aislado por RLS y el alta manual gestionada de estudios, owners y artistas. La provisión no equivale a un login: sesión, UI de autenticación, service worker e integraciones siguen pendientes.

## Requisitos

- Node.js 24 LTS (también se admite la última línea 22.22.x de mantenimiento).
- npm 11.

## Desarrollo

```bash
npm ci
npm run dev
```

La aplicación se sirve en la URL que indique React Router. La validación local completa es:

```bash
npm run check
```

Ese comando ejecuta lint, comprobación de tipos de todos los workspaces, pruebas y build de producción. El artefacto resultante separa `apps/inkendar/build/client` y `apps/inkendar/build/server` y se puede ejecutar con `npm start`.
## Alta manual gestionada

El alta se ejecuta solo desde un entorno de servidor autorizado. Configura `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `INKENDAR_ONBOARDING_PASSWORD` como variables de entorno; no guardes sus valores en el repositorio ni pases la contraseña como argumento.

```bash
npm run onboard -- create-studio-owner \
  --studio-name "Studio Example" \
  --display-name "Owner Example" \
  --email "owner@example.test"

npm run onboard -- add-artist \
  --studio-id "00000000-0000-4000-8000-000000000000" \
  --display-name "Artist Example" \
  --email "artist@example.test"
```

Los comandos fijan `OWNER` y `ARTIST` respectivamente; no existe una opción de rol. El segundo comando solo admite un UUID y la transacción rechaza estudios inexistentes. Si Postgres falla después de crear Auth, el caso de uso intenta eliminar esa identidad; un fallo de compensación devuelve `PROVISIONING_COMPENSATION_FAILED` para intervención operativa.

Este CLI usa credenciales privilegiadas. No se importa desde rutas HTTP ni se distribuye al navegador.


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
