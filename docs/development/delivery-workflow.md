# Flujo de desarrollo, revisión e integración

_Estado: aceptado_

_Última actualización: 2026-09-14_

Este documento define cómo se entrega código en Inkendar. Complementa la [especificación viva](../product/sellable-mvp-spec.md) y la [arquitectura de aplicación](../architecture/application-architecture.md).

Este repositorio aplica el flujo al software. La landing mantiene su propio workflow en `marcosAlvarezCalabria/inkendar`.

## 1. Modelo operativo

Cada cambio de comportamiento pasa por dos agentes con responsabilidades separadas y por un control automático:

```text
Spec y criterios de aceptación
            ↓
Agente de implementación
            ↓
Rama corta + Pull Request
            ↓
Agente de integración y revisión
            ↓
GitHub Actions
            ↓
Merge a main con CI verde
```

Los agentes trabajan de forma secuencial sobre un cambio. No editan simultáneamente el mismo worktree.

## 2. Agente de implementación

Responsabilidades:

- confirmar el slice y sus criterios de aceptación;
- crear una rama `codex/<tema>` de vida corta;
- aplicar TDD con RED–GREEN–REFACTOR;
- mantener los límites del monolito modular;
- añadir pruebas de regresión antes de corregir defectos reproducibles;
- ejecutar las comprobaciones enfocadas;
- actualizar la especificación y decisiones afectadas;
- entregar un resumen del cambio, pruebas y riesgos.

No integra ni sube cambios directamente a `main`.

## 3. Agente de integración y CI

Responsabilidades:

- revisar el diff completo y la coherencia con la spec;
- comprobar arquitectura, permisos, migraciones, seguridad y cambios accidentales;
- ejecutar la validación completa disponible;
- crear o actualizar el Pull Request;
- mantener GitHub Actions y las reglas de protección;
- vigilar los checks hasta obtener un resultado final;
- integrar únicamente cuando el PR y el CI están en estado válido.

No cambia reglas de producto ni debilita pruebas para conseguir un resultado verde. Si el fallo pertenece al comportamiento, devuelve el cambio al agente de implementación. Si pertenece al pipeline, corrige el pipeline y vuelve a ejecutarlo.

## 4. CI obligatorio

El workflow se ejecuta en cada Pull Request y en cada push a `main`, con permiso de solo lectura sobre el contenido. Utiliza Node.js 24 LTS, pnpm 10.22.0 y la caché de pnpm basada en `pnpm-lock.yaml`. La validación mínima actual es:

```text
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

`pnpm run check` agrupa esas cuatro comprobaciones. A medida que se implemente producto se incorporarán como checks requeridos:

- pruebas unitarias del dominio;
- pruebas de casos de uso;
- pruebas de integración de Supabase y RLS;
- lint;
- typecheck;
- build de las aplicaciones afectadas;
- los pocos E2E críticos acordados.

Un comando no se añade al CI hasta existir en el repositorio y poder ejecutarse localmente.

## 5. Protección de `main`

Después de instalar el primer workflow estable se configura `main` con:

- Pull Request obligatorio;
- checks de CI requeridos;
- conversaciones de revisión resueltas;
- rama actualizada antes del merge cuando el volumen lo permita;
- `force push` y eliminación desactivados;
- historial lineal mediante squash merge.

Si las limitaciones del plan de GitHub impiden exigir una aprobación independiente, se conserva la revisión del agente de integración y se mantienen obligatorios los checks disponibles.

## 6. Handoff mínimo

El agente de implementación entrega:

- objetivo y criterios satisfechos;
- archivos y contratos modificados;
- prueba RED observada;
- comprobaciones verdes ejecutadas;
- migración o compatibilidad cuando corresponda;
- riesgos y limitaciones reales.

El agente de integración deja registrado:

- resultado de la revisión;
- checks ejecutados y sus resultados;
- enlace al PR;
- resultado final del CI;
- commit integrado o motivo del bloqueo.

## 7. Presupuesto de contexto por agente

Cada chat de agente trabaja sobre un único slice y tiene un presupuesto operativo máximo de **32.000 tokens**. Si el slice no cabe con margen, se divide antes de empezar. No se sacrifica evidencia, pruebas o seguridad para permanecer dentro del límite.

Los agentes nuevos se crean sin heredar el historial completo de la conversación. Su paquete inicial contiene únicamente:

- objetivo concreto y resultado esperado;
- criterios de aceptación del slice;
- rutas de la spec, ADR y documentos aplicables;
- rama, commit base y estado relevante;
- archivos inicialmente relacionados;
- pruebas que deben fallar o pasar;
- decisiones abiertas y riesgos conocidos.

El paquete inicial no supera 1.500 palabras. Los archivos se leen desde el repositorio y se amplían bajo demanda; no se copian documentos completos dentro del prompt si basta con indicar su ruta.

Cuando un chat se acerca al límite o descubre un segundo objetivo:

1. termina o estabiliza el slice actual sin dejar cambios ambiguos;
2. escribe un handoff de hasta 1.500 palabras;
3. registra decisiones nuevas en la spec o ADR correspondiente;
4. inicia un chat nuevo sin historial heredado;
5. el nuevo agente verifica el handoff contra Git, pruebas y documentos antes de continuar.

El handoff no sustituye las fuentes de verdad. Ante una diferencia, prevalecen el código comprobado, las pruebas, la spec vigente, las ADR aceptadas y el estado Git, en ese orden según el asunto.

### Memoria auxiliar con Engram

Engram se usa como índice local y persistente para recuperar contexto relevante sin copiar el historial completo al chat. Al comenzar un slice, el agente consulta el proyecto `inkendar.app` y recupera únicamente las memorias relacionadas con el objetivo. La recuperación inicial se limita a un máximo de 10 resultados y debe mantenerse dentro del paquete de contexto acordado.

Al terminar, el agente guarda solo decisiones duraderas, descubrimientos, correcciones verificadas y el resumen de handoff. Cada memoria indica qué cambió, por qué, dónde está la evidencia y qué se aprendió. No se guardan conversaciones completas, código fuente, salidas crudas de herramientas, secretos ni datos de clientes.

Engram no es fuente de verdad. Toda memoria usada para decidir o implementar se contrasta con Git, pruebas, la spec y las ADR vigentes. Si existe contradicción, se corrige o elimina la memoria y prevalece la evidencia del repositorio.

## 8. Definition of Done de entrega

Un cambio está integrado cuando:

- cumple la spec y los criterios del slice;
- la revisión no tiene observaciones bloqueantes;
- todos los checks requeridos pasan sobre el commit final;
- la documentación viva está sincronizada;
- el PR se integra sin saltarse protecciones;
- `main` queda verde después del merge.

## 9. Registro de cambios

| Fecha | Cambio | Motivo |
|---|---|---|
| 2026-09-13 | Se adopta el flujo de dos agentes, PR y CI obligatorio | Separar creación y revisión, automatizar la evidencia y proteger `main`. |
| 2026-09-13 | Se limita cada chat de agente a un slice y 32.000 tokens | Reducir contexto irrelevante y reiniciar mediante handoffs verificables antes de mezclar objetivos. |
| 2026-09-13 | Se adopta Engram en modo piloto como memoria auxiliar local | Recuperar solo decisiones relevantes entre sesiones sin convertir la memoria automática en fuente de verdad. |
| 2026-09-13 | Se implementa el primer workflow del software | Ejecutar instalación limpia, lint, tipos, pruebas y build sobre Node.js 24 con permisos mínimos y caché reproducible. |
| 2026-09-14 | Se migra el toolchain del software a pnpm 10.22.0 | Unificar el gestor con la landing y fijar instalación, workspaces, lockfile y caché de CI reproducibles. |
