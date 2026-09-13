# Plan vigente de validación y lanzamiento

_Estado: activo; se ejecuta en paralelo al desarrollo técnico_

_Última actualización: 2026-09-13_

La [Especificación de Inkendar](sellable-mvp-spec.md) gobierna alcance y orden. Este plan gobierna la evidencia comercial y los requisitos previos al uso de datos reales o a una venta.

## Hipótesis

Estudios de dos a seis artistas pueden pagar por operar consultas, propuestas de fecha, citas y portfolios desde un panel gestionado sin cambiar entre sus canales y calendarios.

La hipótesis provisional de precio es 149 €/mes, 690 € de implantación y 99 €/mes durante seis meses para pilotos. Sigue en estado `PROPOSED` hasta obtener evidencia.

## Trabajo que puede comenzar

La base técnica, el CI, los contratos de dominio, las pruebas, el aislamiento local y los adaptadores falsos pueden desarrollarse mientras continúa la validación. No se necesitan datos reales de clientes para este trabajo.

## Gates antes de datos reales

- política de privacidad y términos básicos revisados;
- acuerdo de tratamiento y residencia de proveedores evaluados;
- aislamiento multi-tenant y RLS comprobados;
- logs y memoria sin datos personales, imágenes privadas ni secretos;
- recuperación y eliminación operativas.

## Gates antes de vender o ampliar pilotos

- Facebook Messenger supera la prueba bidireccional o se retira de la promesa;
- un estudio cualificado confirma el problema y participa en el piloto;
- Google Calendar consulta y confirma sin citas falsas;
- el recorrido conversación → propuesta → elección → confirmación → aviso funciona de extremo a extremo;
- onboarding manual repetible y coste de soporte medido;
- todas las capacidades anunciadas funcionan en producción.

## Evidencia a registrar

- fecha, perfil y tamaño del estudio entrevistado;
- proceso actual y problema observado;
- tiempo administrativo percibido;
- objeciones y alternativas utilizadas;
- prueba de intención: piloto, acceso autorizado o compromiso de pago;
- resultados técnicos `PASS`, `PARTIAL` o `FAIL` con evidencia reproducible.

Los datos personales y comerciales se mantienen fuera del repositorio y de Engram.
