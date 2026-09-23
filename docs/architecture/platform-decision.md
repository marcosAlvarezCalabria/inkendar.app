# Decisión de plataforma de Inkendar

_Estado: aceptada_

_Última actualización: 2026-09-23_

La [Especificación de Inkendar](../product/sellable-mvp-spec.md) define el comportamiento y la [Arquitectura de aplicación](application-architecture.md) define la estructura implementable.

## Decisión

- PWA React y TypeScript dentro de un monolito modular.
- React Router 8 en modo framework con renderizado de servidor sobre Cloudflare Workers mediante el plugin oficial de Cloudflare para Vite.
- API/BFF en el mismo producto desplegable.
- pnpm 10.22.0 y sus workspaces para expresar los módulos internos sin añadir una herramienta de orquestación.
- Node.js 24 LTS en desarrollo y CI; producción usa el runtime Workers con las APIs Node soportadas por su fecha de compatibilidad.
- Supabase Cloud para Postgres, autenticación, almacenamiento y migraciones.
- Cloudflare Images, detrás de un adaptador de infraestructura, solo para inspeccionar y re-encodear los derivados privados que antes procesaba `sharp`.
- Chatwoot como motor oculto para chat web, Instagram y Facebook.
- Google Calendar como fuente operativa de disponibilidad y eventos.
- Adaptadores separados para cada proveedor; el dominio no importa SDK ni DTO externos.
- La PWA y su backend viven en este repositorio; la landing Astro permanece en `marcosAlvarezCalabria/inkendar` con CI y despliegue independientes.
- Feed público de solo lectura para galerías y portfolios publicados.

El MVP utiliza un proyecto Supabase multi-tenant con `studio_id`, RLS y pruebas de aislamiento. No se crea un proyecto por estudio y no se opera Supabase self-hosted durante la validación.

El hosting SSR aceptado es Cloudflare Workers en `app.inkendar.es`. Supabase Cloud sigue siendo independiente del Worker. La activación y facturación de Cloudflare Images, la configuración de secretos y el smoke de staging son gates previos al primer despliegue; esta decisión no afirma que producción esté desplegada.

## Límites

- El owner es el único rol operativo del estudio.
- El artista tiene acceso de solo lectura a su agenda y contexto asignado.
- El cliente utiliza enlaces opacos y temporales sin cuenta.
- WhatsApp y adaptadores directos de Meta quedan fuera del MVP.
- Tokens de Google y Chatwoot permanecen cifrados en backend.
- Conversaciones y mensajes pertenecen a Chatwoot; eventos confirmados y ocupación pertenecen a Google Calendar; el dominio y la auditoría pertenecen a Supabase.

## Motivo

Esta combinación permite validar el producto con una sola operación, conservar reglas relacionales y sustituir proveedores mediante adaptadores. React Router genera un manejador de servidor y recursos cliente sobre APIs web; el plugin de Cloudflare integra ese manejador y los assets con Workers. Supabase continúa fuera de esa frontera.

Workers concentra el SSR/BFF y assets sin mover el dominio, Postgres, Auth o Storage fuera de Supabase. El contrato de imágenes permanece en aplicación y el binding queda aislado en infraestructura. Los runners programados continúan como procesos server-only independientes hasta decidir su scheduler; no se convierten implícitamente en cron de Workers.
