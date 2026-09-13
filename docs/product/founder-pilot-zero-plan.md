# Piloto cero vigente de canales

_Estado: `PARTIAL`; alcance corregido y desarrollo técnico autorizado_

_Última actualización: 2026-09-13_

## Resultado comprobado

| Capacidad | Estado | Evidencia pendiente |
|---|---|---|
| Chat web mediante Chatwoot | `PASS` | Ninguna para el spike actual. |
| Instagram mediante Chatwoot | `PASS` | Ninguna para el spike actual. |
| Facebook Messenger | `CONNECTED` | Recepción y respuesta bidireccional final. |
| Asignación de conversaciones | `PARTIAL` | Automática pendiente; la asignación manual está validada. |
| WhatsApp | `DEFERRED` | Retirado del MVP y de sus gates. |
| Frontera Chatwoot–Inkendar | `PLANNED` | Contrato, webhooks e idempotencia dentro de la PWA. |
| Google Calendar | `PLANNED` | OAuth, `freeBusy`, creación, revocación y fallo controlado. |

El plan anterior centrado en WhatsApp Coexistence fue retirado del documento activo porque ya no representa el producto. Su contenido permanece en el historial de Git.

## Cierre del piloto cero

1. Completar Facebook con un mensaje sintético entrante y una respuesta que llegue al canal original.
2. Registrar fecha, cuenta de prueba, resultado y limitaciones sin guardar credenciales ni datos personales.
3. Marcar Facebook como `PASS` o retirar explícitamente el canal de la promesa comercial.
4. Validar después la frontera Chatwoot–Inkendar con adaptadores y webhooks idempotentes.
5. Ejecutar el spike independiente de Google Calendar antes de confirmar citas reales.

Un resultado parcial ya no bloquea CI, estructura del monolito, contratos, pruebas ni desarrollo con datos sintéticos. Sí bloquea anunciar como disponible cualquier capacidad que no haya pasado su prueba.
