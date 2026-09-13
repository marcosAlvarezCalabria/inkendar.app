# Product

_La visión general se conserva aquí. La fuente de verdad para el alcance vendible, las fases y la Definition of Done es `docs/product/sellable-mvp-spec.md`; ante una contradicción prevalece esa especificación._

<!-- impeccable:product-schema 1 -->

## Decisión vigente — 2026-09-10

- **Inkendar** es el producto y **Incamdi** la agencia implementadora.
- El MVP es un servicio gestionado y una PWA, no autoservicio.
- El owner opera web, Instagram y Facebook desde Inkendar; Chatwoot trabaja oculto mediante API y webhooks.
- El owner conecta la cuenta Google central del estudio y asigna un calendario a cada artista.
- El artista solo consulta su agenda y el contexto necesario; no responde clientes ni administra contenido.
- El cliente puede recibir hasta tres fechas preaprobadas o elegir un hueco sujeto a aprobación. Las reservas provisionales duran 24 horas por defecto y el estudio puede configurarlo.
- La landing comercial de Inkendar es independiente de la plataforma y no contiene datos de estudios.
- El owner gestiona la galería general y las imágenes por artista; se publican tanto en webs creadas por Incamdi como en webs existentes mediante un componente o feed.
- Supabase Cloud será la base multi-tenant; WhatsApp queda fuera del MVP.
- Precio provisional interno: 149 €/mes, 690 € de implantación y 99 €/mes durante seis meses para pilotos.
- Web e Instagram pasaron la prueba bidireccional; Facebook está conectado pero pendiente de prueba final; la PWA, Supabase y Google Calendar aún no están implementados.

Las secciones posteriores conservan la visión amplia y capacidades candidatas. Su alcance y orden de entrega quedan subordinados a la [especificación vigente](docs/product/sellable-mvp-spec.md).

## Platform

web

## Users

- Owner del estudio, responsable único de canales, clientes, casos, calendarios, citas y contenido publicado.
- Artista del estudio, con acceso de solo lectura a su agenda y a la información necesaria de sus tatuajes.
- Cliente final, que conversa por los canales del estudio y utiliza enlaces seguros para elegir o confirmar fechas sin crear una cuenta.

## Product Purpose

Ofrecer al owner de cada estudio un panel conectado a su web, Instagram y Facebook que reúna conversaciones, casos, ofertas de fechas, citas e imágenes. Chatwoot opera detrás del producto sin ser visible y Google Calendar conserva la ocupación real de cada artista.

El éxito significa que el owner puede recibir y responder consultas, ofrecer fechas, confirmar citas y publicar portfolios sin alternar entre herramientas, mientras cada artista entiende su trabajo del día con una vista privada de solo lectura.

## Positioning

El panel se entrega como una mejora integrada con las webs y los canales de los estudios, no como una agenda genérica independiente. Cada consulta relevante debe poder convertirse explícitamente en una ficha de trabajo útil para el artista, conservando conversación, asignación, cita e imágenes del cliente en el mismo contexto.

## Operating Context

- Un estudio sin web puede contratar a Incamdi una web conectada al contenido publicado en Inkendar.
- Un estudio con web conserva su sitio y conecta la galería mediante un web component o el feed público.
- Varias webs consumen una plataforma común, pero solo reciben contenido publicado del estudio correspondiente.
- Cada owner conecta la cuenta profesional de Instagram y la página de Facebook del estudio. Los mensajes llegan al panel de Inkendar y pueden asociarse a un cliente o caso.
- El owner puede registrar presencialmente un brief desde el panel; los artistas no operan esta entrada.
- Los formularios actuales pueden incluir nombre del cliente, idea del tatuaje, zona del cuerpo, artista preferido y tamaño aproximado.
- Una solicitud inicial no equivale necesariamente a una cita confirmada; el estudio debe poder revisarla, asignarla y convertirla en cita.
- Los artistas necesitan consultar agenda diaria, imágenes de referencia y datos asociados a su trabajo.
- El stack habitual del propietario es MERN. Las webs públicas pueden utilizar tecnologías distintas, incluido Astro, siempre que puedan conectarse al panel.

## Capabilities and Constraints

Capacidades confirmadas:

- multi-tenancy por estudio con un owner operativo;
- bandeja de Inkendar para web, Instagram y Facebook con Chatwoot oculto;
- casos y asignación a artistas;
- ofertas de hasta tres fechas, bloqueos provisionales configurables y elección mediante enlace seguro;
- Google Calendar central con un calendario por artista;
- vista de solo lectura de agenda y contexto para cada artista;
- galería general y portfolios administrados por el owner y publicados mediante una integración de solo lectura;
- PWA optimizada para móvil, tablet y escritorio.

Decisiones técnicas confirmadas:

- Supabase Cloud como backend gestionado del MVP, en un único proyecto multi-tenant;
- React y TypeScript para la PWA; Astro para la landing y webs públicas;
- Chatwoot como motor oculto de conversaciones mediante API y webhooks;
- Google Calendar como fuente operativa de disponibilidad y eventos;
- tokens e integraciones solo en backend y aislamiento comprobado con RLS;
- arquitectura de aplicación aceptada como monolito modular TypeScript;
- TDD obligatorio mediante RED–GREEN–REFACTOR para todo comportamiento de producción.

Decisiones comerciales confirmadas para la landing de validación:

- nombre público utilizado en la validación: `Inkendar`; la comprobación de dominio y marca continúa pendiente;
- la landing no publica precios por ahora: presenta planes consultables mientras se validan alcance, límites y costes; las hipótesis comerciales permanecen en la especificación interna;
- la landing ofrece una selección piloto limitada y deja claro que la beta todavía no es autoservicio;
- la landing se ofrece en español e inglés mediante un selector explícito que conserva la preferencia del visitante;
- identidad visual oscura, móvil primero, con logo mecánico y naranja corporativo `#FF7000`; permanece separada de Incamdi, que aparece únicamente como equipo desarrollador.

Decisiones abiertas:

- elección del proveedor de alojamiento para la PWA y API/BFF;
- política final de cancelaciones, cambios y recordatorios;
- límites técnicos de imágenes, formatos y proceso de moderación;
- límites definitivos por plan, impuestos, condiciones contractuales del precio fundador y costes de terceros;
- procesamiento de pagos, señales y consentimientos, fuera del primer slice.

## Evidence on Hand

- Existe al menos una web con un formulario que recoge nombre, idea del tatuaje, zona del cuerpo, artista y tamaño aproximado.
- La investigación exploratoria en conversaciones de tatuadores, clientes y reseñas de software respalda como problemas repetidos la fragmentación de contexto, la diferencia entre solicitud y cita, los briefs incompletos, la incertidumbre de comunicación y el control de señales/no-shows. La síntesis histórica permanece en el [repositorio de la landing](https://github.com/marcosAlvarezCalabria/inkendar/blob/main/docs/research/tattoo-artist-voice-of-customer.md).
- No se han aportado todavía datos reales de uso ni pilotos externos. El piloto cero tiene web e Instagram en `PASS`, Facebook conectado pendiente de prueba final y WhatsApp retirado. La evidencia cualitativa no estima porcentajes; las decisiones se revisarán con uso autorizado y feedback voluntario de pilotos.

## Product Principles

1. Una sola ficha debe reunir el contexto necesario para realizar un tatuaje, aunque la conversación haya empezado en la web, Instagram, Facebook o presencialmente.
2. Cada artista debe poder entender su día con una mirada.
3. La integración con una web existente debe ser sencilla y desacoplada de su tecnología.
4. Registrar una consulta delante del cliente debe ser rápido y no exigirle crear una cuenta.
5. Los datos de cada estudio deben permanecer aislados y sus permisos ser explícitos.
6. La plataforma debe poder empezar gestionada en cloud sin cerrar la puerta a self-hosting posterior.
7. Una herramienta usada delante del cliente debe conservar el trabajo, explicar los fallos y permitir recuperarse sin empezar de nuevo.

## Accessibility & Inclusion

El panel debe ser utilizable con teclado, conservar contraste suficiente y comunicar estados sin depender únicamente del color. El nivel normativo objetivo queda por confirmar.
