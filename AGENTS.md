# Instrucciones principales del software Inkendar

- Este repositorio contiene exclusivamente la PWA, API/BFF, dominio, infraestructura y contratos públicos del software Inkendar. La landing comercial vive en `https://github.com/marcosAlvarezCalabria/inkendar`.
- Para cualquier feature, corrección, refactorización, cambio arquitectónico, API, base de datos o trabajo de pruebas, carga y sigue `$staff-software-engineer` como skill principal.
- Conserva la arquitectura aprobada: monolito modular TypeScript con dependencias hacia dominio y Supabase, Chatwoot, Google Calendar y notificaciones detrás de adaptadores.
- Aplica TDD RED–GREEN–REFACTOR a todo cambio de comportamiento. Toda corrección reproducible empieza con una prueba de regresión. No inventes pruebas para cambios documentales o mecánicos.
- Usa dos roles secuenciales: implementación en una rama `codex/*`; integración para revisar, validar, gestionar el Pull Request y vigilar CI.
- No integres directamente en `main`: exige Pull Request y checks verdes una vez creado el workflow inicial.
- Limita cada chat de agente a un único slice y a 32.000 tokens como máximo. Crea agentes sin historial heredado y proporciona un paquete inicial de hasta 1.500 palabras.
- Si se alcanza el límite o aparece otro objetivo, estabiliza el slice, documenta decisiones y genera un handoff de hasta 1.500 palabras que el siguiente agente verificará contra Git, pruebas y documentación.
- Usa Engram como memoria auxiliar del proyecto `inkendar.app`: recupera solo memorias relacionadas y guarda únicamente decisiones duraderas, descubrimientos y handoffs. Nunca guardes código completo, secretos, datos de clientes ni salidas crudas.
- La fuente de verdad del producto es `docs/product/sellable-mvp-spec.md`; mantenla sincronizada junto con arquitectura y flujo de entrega.
- No incluyas secretos ni información personal o comercial sensible en el repositorio.
