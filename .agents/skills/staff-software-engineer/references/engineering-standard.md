# Estándar de ingeniería

Lee este documento para features, bugs no triviales, refactors, cambios de arquitectura, persistencia, seguridad o contratos públicos.

## 1. Spec-Driven Development proporcional

Antes del código de producción, deja suficientemente claros estos elementos según el riesgo del cambio:

1. **Requisitos:** actor, necesidad y valor. Para comportamiento sustantivo, usa `Como [actor] / quiero [acción] / para [valor]`.
2. **Criterios de aceptación:** expresa escenarios observables en Gherkin (`Given / When / Then`) e incluye happy path, alternativas y bordes relevantes.
3. **Diseño técnico:** fija interfaces públicas, DTOs, esquemas, errores y límites entre componentes. No diseñes detalles que el slice actual no necesita.
4. **Plan incremental:** ordena slices que puedan implementarse y verificarse sin dejar el repositorio en un estado roto.

Trata nombres, tipos, argumentos, propiedades y esquemas explícitamente aprobados como contratos. Si una modificación del contrato es necesaria, explica por qué y gestiona compatibilidad o migración antes de cambiarlo. No inventes endpoints o parámetros "por si acaso".

Define requisitos no funcionales solo cuando sean relevantes y hazlos medibles: latencia, carga, consistencia, disponibilidad, observabilidad, privacidad y seguridad. Deriva los valores de requisitos reales; no impongas bcrypt, JWT ni una cifra de rendimiento universal sin contexto.

## 2. Test-Driven Development

Para lógica nueva y regresiones, usa RED-GREEN-REFACTOR cuando sea práctico:

1. **RED:** escribe una prueba que falle por el comportamiento ausente o defectuoso, no por un error de configuración.
2. **GREEN:** implementa la solución mínima correcta para satisfacer el contrato.
3. **REFACTOR:** mejora nombres, estructura y duplicación manteniendo las pruebas verdes.

Usa triangulación cuando exista una frontera de negocio significativa: prueba el límite exacto y casos representativos a ambos lados. No fuerces tres pruebas redundantes cuando no exista tal frontera.

Distribuye las pruebas según el riesgo:

- Dominio: muchas pruebas unitarias puras, rápidas y sin infraestructura.
- Aplicación/casos de uso: pruebas de aceptación con fakes o stubs en los puertos externos.
- Infraestructura: integraciones con adaptadores reales o entornos desechables cuando aporten confianza.
- API/E2E: pocos flujos críticos desde el límite público.

Evita tests acoplados a detalles privados, snapshots indiscriminados y mocks que reproduzcan la implementación. Una corrección de bug debe incluir una prueba que demuestre la regresión siempre que sea razonable.

## 3. Clean Architecture con criterio

Respeta primero la arquitectura del repositorio. Para un servicio TypeScript/Node.js nuevo sin una estructura establecida, usa como punto de partida:

```text
src/
  domain/          # Entidades, value objects, eventos y errores de negocio
  application/     # Casos de uso, DTOs y puertos
  infrastructure/  # Adaptadores de DB, HTTP, colas, CLI y servicios externos
  composition/     # Composition root e inyección de dependencias
```

Mantén el dominio independiente de frameworks, bases de datos y transporte. Haz que las dependencias apunten hacia el núcleo y concentra el ensamblaje en el composition root.

No conviertas cada función en una interfaz ni crees capas vacías. Introduce puertos en fronteras externas, cuando existan implementaciones intercambiables o cuando aislar una dependencia mejore de forma concreta la prueba y el mantenimiento.

## 4. Programación defensiva y seguridad

- Valida datos no confiables en el borde adecuado y evita repetir validación sin valor dentro de capas ya tipadas.
- Usa errores de dominio/aplicación tipados y tradúcelos a códigos de transporte en el adaptador correspondiente.
- Mantén secretos fuera del código y de la documentación versionada.
- Reutiliza mecanismos de autenticación, autorización y criptografía ya establecidos y vigentes en el proyecto; no cambies el modelo de seguridad incidentalmente.
- Para cambios destructivos de datos o incompatibles, prepara migración, rollback y verificación antes de ejecutarlos.

## 5. Definition of done

Un slice está terminado cuando:

- cumple los criterios de aceptación y el contrato aprobado;
- las pruebas relevantes pasan y la regresión queda cubierta cuando corresponde;
- lint, typecheck y build pasan si forman parte del proyecto;
- los archivos están en la capa adecuada sin dependencias invertidas;
- documentación y contexto quedan sincronizados;
- el diff no contiene cambios accidentales, secretos ni ampliaciones de alcance;
- las limitaciones o verificaciones no ejecutadas se comunican explícitamente.
