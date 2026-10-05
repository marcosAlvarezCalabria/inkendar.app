# Piloto cero vigente de canales

_Estado: `PARTIAL`; alcance corregido y desarrollo técnico autorizado_

_Última actualización: 2026-10-05_

## Resultado comprobado

| Capacidad | Estado | Evidencia y pendientes |
|---|---|---|
| Chat web mediante Chatwoot | `PASS` | Ninguna para el spike actual. |
| Instagram mediante Chatwoot | `PASS` | Ninguna para el spike actual. |
| Facebook Messenger | `CONNECTED` | Recepción y respuesta bidireccional final. |
| Asignación de conversaciones | `PARTIAL` | Automática pendiente; la asignación manual está validada. |
| WhatsApp | `DEFERRED` | Retirado del MVP y de sus gates. |
| Frontera Chatwoot–Inkendar | `PARTIAL` | Staging verificó listado, detalle y texto bidireccional con datos sintéticos, incluida una conversación Instagram. El 2026-10-05 aceptó y persistió una entrega real del webhook firmado tras el PR #84; faltan una imagen entrante live y el recorrido visual de actualización automática. |
| Google Calendar | `IN_PROGRESS` | OAuth/listado/asignación y el booking preaprobado pasaron live con datos sintéticos. El scheduler Chatwoot quedó integrado mediante el PR #23, sin prueba live. El fallback SMTP por estudio tiene candidato local; faltan revisión, PR/CI y prueba live. |

El plan anterior centrado en WhatsApp Coexistence fue retirado del documento activo porque ya no representa el producto. Su contenido permanece en el historial de Git.

## Cierre del piloto cero

1. Completar Facebook con un mensaje sintético entrante y una respuesta que llegue al canal original.
2. Registrar fecha, cuenta de prueba, resultado y limitaciones sin guardar credenciales ni datos personales.
3. Marcar Facebook como `PASS` o retirar explícitamente el canal de la promesa comercial.
4. Validar live una imagen entrante y el recorrido visual de actualización automática; el webhook firmado, la bandeja, el detalle y el texto bidireccional ya pasaron en staging.
5. Revisar e integrar el fallback SMTP y después validar live el recorrido completo de notificaciones/scheduler antes de cerrar Google Calendar y booking como capacidad completa.

Un resultado parcial ya no bloquea CI, estructura del monolito, contratos, pruebas ni desarrollo con datos sintéticos. Sí bloquea anunciar como disponible cualquier capacidad que no haya pasado su prueba.
