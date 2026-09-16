# Requisitos vigentes de Inkendar

_Estado: índice activo subordinado a la especificación viva_

_Última actualización: 2026-09-16_

Los contratos y criterios completos están en la [Especificación de Inkendar](sellable-mvp-spec.md). El backlog anterior se retiró porque mezclaba `owner`, `manager` y `artist` con permisos incompatibles y mantenía WhatsApp dentro del producto. El historial de Git conserva ese material para consulta histórica.

## Requisitos confirmados

1. Aislar todos los datos y conexiones por estudio.
2. Permitir que el owner opere web, Instagram y Facebook desde Inkendar con Chatwoot oculto.
3. Permitir que solo el owner cree y modifique clientes, casos, ofertas, citas, calendarios y contenido.
4. Permitir que cada artista consulte únicamente sus próximas citas confirmadas y el contexto mínimo necesario —nombre visible del cliente, resumen, zona corporal y tamaño— sin contacto, conversaciones, IDs internos ni escritura.
5. Mantener separado el caso de tatuaje de sus posibles citas y sesiones.
6. Consultar disponibilidad de Google Calendar sin revelar títulos ni descripciones de eventos.
7. Ofrecer hasta tres fechas preaprobadas con una retención configurable de 24 horas por defecto.
8. Exigir aprobación del owner para un hueco elegido libremente por el cliente.
9. Confirmar de forma idempotente, liberar opciones restantes y avisar al cliente.
10. Permitir que el owner publique galería y portfolios por artista mediante un feed público de solo lectura.
11. Mantener originales y referencias privadas, eliminar metadatos sensibles y generar variantes optimizadas.
12. Registrar auditoría y mostrar fallos de integración sin comunicar éxitos falsos.

## Requisitos de ingeniería

- Monolito modular TypeScript con dependencias dirigidas hacia dominio y aplicación.
- Supabase, Chatwoot, Google Calendar y notificaciones detrás de puertos y adaptadores.
- TDD RED–GREEN–REFACTOR para todo cambio de comportamiento.
- RLS con pruebas allow/deny para base de datos y almacenamiento.
- Secretos y tokens solo en backend; nunca en navegador, logs, documentación o Engram.
- PWA usable desde 320 px y accesible mediante teclado y estados que no dependan solo del color.

Cada slice debe concretar sus propios criterios de aceptación antes de comenzar la prueba RED.
