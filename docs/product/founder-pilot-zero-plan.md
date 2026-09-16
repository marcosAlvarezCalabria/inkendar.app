# Piloto cero vigente de canales

_Estado: `PARTIAL`; alcance corregido y desarrollo técnico autorizado_

_Última actualización: 2026-09-16_

## Resultado comprobado

| Capacidad | Estado | Evidencia pendiente |
|---|---|---|
| Chat web mediante Chatwoot | `PASS` | Ninguna para el spike actual. |
| Instagram mediante Chatwoot | `PASS` | Ninguna para el spike actual. |
| Facebook Messenger | `CONNECTED` | Recepción y respuesta bidireccional final. |
| Asignación de conversaciones | `PARTIAL` | Automática pendiente; la asignación manual está validada. |
| WhatsApp | `DEFERRED` | Retirado del MVP y de sus gates. |
| Frontera Chatwoot–Inkendar | `IN_PROGRESS` | Contrato técnico, bandeja paginada, respuesta idempotente y webhook firmado están `DONE`; falta el recorrido live de la PWA con una conexión sintética. |
| Google Calendar | `IN_PROGRESS` | OAuth/listado/asignación y el booking preaprobado pasaron live con datos sintéticos. El primer corte local de notificaciones/scheduler cubre confirmación/caducidad por Chatwoot original con estado durable, pero faltan revisión, CI y prueba live; correo fallback y otros avisos siguen pendientes. |

El plan anterior centrado en WhatsApp Coexistence fue retirado del documento activo porque ya no representa el producto. Su contenido permanece en el historial de Git.

## Cierre del piloto cero

1. Completar Facebook con un mensaje sintético entrante y una respuesta que llegue al canal original.
2. Registrar fecha, cuenta de prueba, resultado y limitaciones sin guardar credenciales ni datos personales.
3. Marcar Facebook como `PASS` o retirar explícitamente el canal de la promesa comercial.
4. Validar el recorrido live de la frontera Chatwoot–Inkendar ya implementada con una conexión sintética.
5. Revisar, integrar y validar live el primer corte de notificaciones/scheduler antes de cerrar Google Calendar y booking como capacidad completa; después completar correo fallback y avisos fuera del corte.

Un resultado parcial ya no bloquea CI, estructura del monolito, contratos, pruebas ni desarrollo con datos sintéticos. Sí bloquea anunciar como disponible cualquier capacidad que no haya pasado su prueba.
