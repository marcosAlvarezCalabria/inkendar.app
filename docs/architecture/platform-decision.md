# Decisión de plataforma de Inkendar

_Estado: aceptada_

_Última actualización: 2026-09-13_

La [Especificación de Inkendar](../product/sellable-mvp-spec.md) define el comportamiento y la [Arquitectura de aplicación](application-architecture.md) define la estructura implementable.

## Decisión

- PWA React y TypeScript dentro de un monolito modular.
- React Router 8 en modo framework con renderizado de servidor y su adaptador oficial de Node para unir PWA y API/BFF en un artefacto portable.
- API/BFF en el mismo producto desplegable.
- npm workspaces para expresar los módulos internos sin añadir una herramienta de orquestación.
- Node.js 24 LTS en desarrollo y CI; se conserva compatibilidad con la última línea 22.22.x de mantenimiento admitida por React Router 8.
- Supabase Cloud para Postgres, autenticación, almacenamiento y migraciones.
- Chatwoot como motor oculto para chat web, Instagram y Facebook.
- Google Calendar como fuente operativa de disponibilidad y eventos.
- Adaptadores separados para cada proveedor; el dominio no importa SDK ni DTO externos.
- La PWA y su backend viven en este repositorio; la landing Astro permanece en `marcosAlvarezCalabria/inkendar` con CI y despliegue independientes.
- Feed público de solo lectura para galerías y portfolios publicados.

El MVP utiliza un proyecto Supabase multi-tenant con `studio_id`, RLS y pruebas de aislamiento. No se crea un proyecto por estudio y no se opera Supabase self-hosted durante la validación.

## Límites

- El owner es el único rol operativo del estudio.
- El artista tiene acceso de solo lectura a su agenda y contexto asignado.
- El cliente utiliza enlaces opacos y temporales sin cuenta.
- WhatsApp y adaptadores directos de Meta quedan fuera del MVP.
- Tokens de Google y Chatwoot permanecen cifrados en backend.
- Conversaciones y mensajes pertenecen a Chatwoot; eventos confirmados y ocupación pertenecen a Google Calendar; el dominio y la auditoría pertenecen a Supabase.

## Motivo

Esta combinación permite validar el producto con una sola operación, conservar reglas relacionales y sustituir proveedores mediante adaptadores. React Router genera un manejador de servidor y recursos cliente sobre APIs web, y ofrece adaptadores oficiales para distintos runtimes; la aplicación no depende de una función exclusiva de un proveedor. La selección sigue la [documentación de Framework Mode](https://reactrouter.com/start/framework/installation) y el [contrato de adaptadores](https://reactrouter.com/api/other-api/adapter) vigentes al implementar la base.

El proveedor de alojamiento de la PWA continúa abierto. Debe soportar la región, tareas programadas y límites de ejecución necesarios sin introducir una dependencia exclusiva en el dominio.
