# Inkendar App

PWA y backend de Inkendar para operar conversaciones, casos de tatuaje, propuestas de fecha, citas, agenda de artistas y contenido publicado por estudios.

## Estado

La base técnica ejecutable está en construcción. El repositorio contiene una aplicación React Router full-stack con renderizado de servidor, manifiesto PWA, workspaces para los límites del monolito modular y CI. Todavía no implementa autenticación, persistencia, integraciones ni comportamiento de producto.

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
