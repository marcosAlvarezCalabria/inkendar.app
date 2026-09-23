# Web component público de galería

_Estado técnico: `DONE` en código integrado. El PR #30 pasó revisión y CI; el 2026-09-23 se consumió con datos sintéticos desde una página HTML externa local. Siguen pendientes las pruebas contra Storage Cloud y en webs reales nueva/existente._

## Requisito

Como responsable de una web de estudio quiero instalar la galería publicada por Inkendar con un único script y un elemento HTML para integrarla en HTML, WordPress o un constructor compatible sin adoptar el framework de Inkendar ni manejar credenciales.

## Contrato observable

```gherkin
Given el asset de Inkendar y un `studio-slug` público canónico
When la página conecta `<inkendar-gallery>`
Then el componente consulta GET `/api/public/studios/:studioSlug/gallery` en el origen del asset
And usa CORS con `credentials: omit`
And representa `gallery_images` y los `portfolio_images` de cada artista en el orden recibido
And usa THUMB y DISPLAY como candidatos responsivos con alt, dimensiones, lazy loading y decode async
```

```gherkin
Given una galería sin imágenes, una respuesta fallida o una lectura en curso
When cambia el estado observable
Then el Shadow DOM anuncia un estado loading, empty o error genérico
And el error ofrece retry mediante un botón accesible
And no muestra detalles del proveedor
```

```gherkin
Given una lectura activa
When cambia `studio-slug` o `api-origin`, o se desconecta el elemento
Then el componente aborta la solicitud anterior
And una respuesta obsoleta no modifica el contenido actual
```

```gherkin
Given que el módulo se importa fuera de un navegador o que el custom element ya está registrado
When se evalúa el asset
Then la evaluación no falla
And no intenta registrar dos veces `inkendar-gallery`
```

```gherkin
Given un slug, origen o feed no válido
When el componente valida la entrada
Then no solicita una URL ambigua o peligrosa
And no inserta datos remotos mediante `innerHTML`
And no persiste contenido, añade analytics ni expone secretos, RPC, bindings, paths privados o masters
```

## Instalación y API pública

El tag estable es `inkendar-gallery`. El asset estable se publica con la aplicación en `/inkendar-gallery.js`; el build lo genera desde una única fuente TypeScript antes de construir la aplicación. Sustituye `https://<origen-inkendar>` por el origen real del despliegue y el UUID por el slug público entregado por Inkendar:

```html
<script type="module" src="https://<origen-inkendar>/inkendar-gallery.js"></script>
<inkendar-gallery studio-slug="00000000-0000-4000-8000-000000000000"></inkendar-gallery>
```

El componente observa solo estos atributos:

- `studio-slug` — obligatorio; UUID v4 público canónico del estudio.
- `api-origin` — opcional; origen absoluto de Inkendar (`https`, o `http` únicamente en localhost). Si falta, se deriva de `import.meta.url`, es decir, del origen real del asset ESM. No se usa por defecto `window.location.origin`, porque el elemento puede vivir en otro dominio.

Si un bundler reempaqueta el módulo bajo un origen distinto al de Inkendar, la integración debe declarar `api-origin` explícitamente:

```html
<inkendar-gallery
  studio-slug="00000000-0000-4000-8000-000000000000"
  api-origin="https://<origen-inkendar>"
></inkendar-gallery>
```

No existen eventos, métodos públicos, slots ni atributos de escritura en este slice. El componente consume exclusivamente el `StudioGallery` vigente de `GET /api/public/studios/:studioSlug/gallery` y deja que el navegador gestione la política HTTP de caché/ETag.

## Variables CSS públicas

El Shadow DOM ofrece un tema sobrio y responsivo. La web anfitriona puede definir únicamente:

- `--inkendar-gallery-background`
- `--inkendar-gallery-color`
- `--inkendar-gallery-muted-color`
- `--inkendar-gallery-accent-color`
- `--inkendar-gallery-font-family`
- `--inkendar-gallery-gap`
- `--inkendar-gallery-min-item-width`
- `--inkendar-gallery-radius`

El foco de retry es visible, la estructura usa secciones, encabezados y listas semánticas, y cualquier transición respeta `prefers-reduced-motion`.

## Seguridad y límites

- La respuesta remota se valida antes de representar. Solo se aceptan URLs absolutas `https`, o `http` en localhost, y variantes WebP con dimensiones enteras positivas.
- El fetch usa `GET`, `mode: cors`, `credentials: omit`, `redirect: error` y una señal abortable. No añade cabeceras de autenticación ni evita el comportamiento normal de caché.
- Los datos se insertan con nodos DOM y `textContent`/propiedades seguras, nunca con HTML remoto.
- Loading, empty y error son estados genéricos anunciados; retry repite la misma lectura validada.
- Este slice no incluye edición pública, prueba en otra web, prueba live de Storage, restore/GC, analytics ni proveedor CDN/WAF definitivo.
