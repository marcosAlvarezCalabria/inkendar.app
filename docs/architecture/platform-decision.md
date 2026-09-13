# Decisión de plataforma de Inkendar

_Estado: aceptada_

_Última actualización: 2026-09-13_

La [Especificación de Inkendar](../product/sellable-mvp-spec.md) define el comportamiento y la [Arquitectura de aplicación](application-architecture.md) define la estructura implementable.

## Decisión

- PWA React y TypeScript dentro de un monolito modular.
- API/BFF en el mismo producto desplegable.
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

Esta combinación permite validar el producto con una sola operación, conservar reglas relacionales y sustituir proveedores mediante adaptadores. Evita distribuir reglas críticas entre el navegador, funciones aisladas y servicios externos antes de tener volumen real.

El proveedor de alojamiento de la PWA continúa abierto. Debe soportar la región, tareas programadas y límites de ejecución necesarios sin introducir una dependencia exclusiva en el dominio.
