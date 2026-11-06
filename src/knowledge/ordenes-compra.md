---
name: ordenes-compra
description: Úsalo cuando debas validar o crear una orden de compra en SAP; contiene el proceso actual y las reglas RC1-RC10 en lenguaje de negocio.
---
# Conocimiento del proceso: órdenes de compra

## Proceso actual

Cada compra llega a administración por correo con tres piezas: un Excel de solicitud, la cotización del proveedor y el correo de aprobación del líder. La analista digita a mano en SAP proveedor, descripción, centro de costos y subárea, valor, indicador de IVA, aprobador y condiciones de pago, y adjunta el correo de aprobación convertido a PDF.

| Actor | Rol |
|---|---|
| Solicitante | Necesita comprar; envía el paquete por correo. |
| Líder aprobador | Aprueba el gasto respondiendo "Aprobado". |
| Analista administrativa | Crea la OC en SAP; confirma excepciones en el chat. |
| Contabilidad / Auditoría | Consume el log de control (`out/control.csv`). |
| SAP | Sistema de registro (simulado). |

## Qué es una OC en SAP

- Sociedad: `1000`. Organización de compras: `1000`.
- Unidades de medida: `UN` (unidad), `H` (hora), `MES`.
- Indicadores de IVA: `C0`, `C1`, `C2` (definidos en el maestro de indicadores; no asumas la tasa, usa la que devuelvan las herramientas).
- Condiciones de pago: `Z000`, `Z015`, `Z030`, `Z060` (el código indica los días; `Z000` es contado).
- Cada OC lleva proveedor, ítems, centro de costo y subárea, aprobador, indicador de IVA y condiciones de pago.

## Reglas de control (RC1 a RC10)

Bloqueo: impide crear la OC. Confirmación: se permite solo si la analista confirma. Derivado: el agente completó el dato desde un maestro y solo lo informa.

| Regla | Tipo | Código(s) | Significado de negocio | Acción recomendada |
|---|---|---|---|---|
| RC1 | Bloqueo | `PROVEEDOR_INEXISTENTE`, `PROVEEDOR_INACTIVO` | El proveedor no está en el maestro (por NIT o nombre normalizado) o está inactivo. | Si no existe: pedir al solicitante el alta del proveedor (RUT y certificación bancaria) o corregir el NIT. Si está inactivo: pedir su reactivación a quien mantiene el maestro. |
| RC2 | Bloqueo | `APROBACION_AUSENTE`, `APROBACION_SIN_APROBADO`, `APROBADOR_NO_AUTORIZADO` | No hay aprobación, no dice "Aprobado", o quien aprobó no es aprobador del centro de costo. | Pedir al líder la aprobación explícita, o pedir aprobación a un aprobador autorizado del centro de costo dentro de su tope. |
| RC3 | Bloqueo | `MONTO_EXCEDE_TOPE` | El valor total supera el tope del aprobador para ese centro. | Pedir aprobación a un aprobador con tope suficiente o dividir/reducir el alcance con el solicitante. |
| RC4 | Bloqueo | `CENTRO_COSTO_INEXISTENTE`, `SUBAREA_INVALIDA` | El centro de costo no existe o la subárea no pertenece a él. | Pedir al solicitante el centro de costo y subárea correctos. |
| RC5 | Confirmación | `COTIZACION_AUSENTE`, `COTIZACION_DIFIERE` | No hay cotización, o su total difiere más de 2 % del valor de la solicitud. | Mostrar ambos valores y pedir confirmación; sugerir pedir al solicitante la cotización o aclarar la diferencia. |
| RC6 | Confirmación + derivado | `IVA_DERIVADO` | La solicitud no trae indicador de IVA; se tomó el predeterminado del proveedor. | Informar el indicador derivado y pedir confirmación. |
| RC7 | Derivado | (sin código de hallazgo; aparece en `derivados.condiciones_pago`) | La solicitud no trae condiciones de pago; se tomaron las del proveedor. | Solo informar. |
| RC8 | Confirmación | `OC_RETROACTIVA` | Hay factura con fecha anterior a la solicitud: la OC se crea después de la compra. | Pedir confirmación, crear marcada como retroactiva y recordar al solicitante crear la OC antes de comprar. |
| RC9 | Confirmación | `APROBACION_ANTERIOR` | La aprobación es anterior a la fecha de la solicitud. | Mostrar ambas fechas y pedir confirmación; sugerir validar con el líder que la aprobación aplica a esta solicitud. |
| RC10 | Bloqueo | `MONTO_INCONSISTENTE` | Cantidad por valor unitario no iguala el valor total (tolerancia de 1 unidad monetaria). | Pedir al solicitante corregir la solicitud. |

## OC retroactivas

Una OC retroactiva es la que se crea después de que ya llegó la factura, saltándose la cotización y el control previo. La dirección quiere medir qué porcentaje de OC lo son (`out/control.csv`, columna `retroactiva`). Por eso solo se crean con confirmación explícita y quedan marcadas `retroactiva = true`. La política (tolerar con marca o rechazar) la decide la dirección, no el agente.

## Evidencia e idempotencia

- Evidencia: la aprobación se guarda en `out/<caso>/aprobacion.txt` (y `.pdf` si está disponible) con encabezados (de, para, fecha, asunto), cuerpo y `sha256` del contenido, para sustentar el gasto ante auditoría.
- Trazabilidad: cada valor del payload se puede rastrear a su fuente (solicitud, cotización, maestro o derivado) en `out/<caso>/trazabilidad.json`.
- Idempotencia: crear dos veces la misma solicitud devuelve el número de OC existente (`idempotente: true`), no una segunda OC.
- Cada intento (creado, bloqueado o pendiente) queda en `out/control.csv`.

## Códigos de error de herramienta

`CASO_NO_ENCONTRADO`, `PAQUETE_INCOMPLETO`, `JSON_INVALIDO`, `MONTO_INVALIDO`, `ARGS_INVALIDOS`, `BLOQUEADO`, `CONFIRMACION_REQUERIDA`, `PAYLOAD_ALTERADO`, `SAP_ERROR`, `INTERNO`. Explícalos con el `mensaje` y la `sugerencia` de la herramienta; por ejemplo, un paquete incompleto se resuelve pidiendo al solicitante el adjunto faltante.
