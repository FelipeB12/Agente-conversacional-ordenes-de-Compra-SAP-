/** Control rules RC1-RC10 (PRD §7.3) as a pure function; codes are frozen for the prompt author. */
import type { Derivados, Hallazgo, Maestros, Paquete, ResultadoValidacion } from "../types.js"
import { buscarProveedor } from "./maestros.js"

const fmt = (n: number) => n.toLocaleString("es-CO")

/** Applies every rule; `apta` is true iff there are no bloqueos. */
export function validarPaquete(p: Paquete, m: Maestros): ResultadoValidacion {
  const bloqueos: Hallazgo[] = []
  const confirmaciones: Hallazgo[] = []
  const derivados: Derivados = {}
  let retroactiva = false
  const s = p.solicitud

  // RC1
  const prov = buscarProveedor(m.proveedores, s.proveedor_nit, s.proveedor_nombre)
  if (!prov) {
    bloqueos.push({
      regla: "RC1",
      tipo: "bloqueo",
      codigo: "PROVEEDOR_INEXISTENTE",
      detalle: `El proveedor '${s.proveedor_nombre}'${s.proveedor_nit ? ` (NIT ${s.proveedor_nit})` : ""} no existe en el maestro de proveedores.`,
      accion_sugerida: "Solicitar el alta del proveedor en el maestro antes de crear la OC.",
      valores: { proveedor_nombre: s.proveedor_nombre, proveedor_nit: s.proveedor_nit ?? null },
    })
  } else if (!prov.activo) {
    bloqueos.push({
      regla: "RC1",
      tipo: "bloqueo",
      codigo: "PROVEEDOR_INACTIVO",
      detalle: `El proveedor '${prov.nombre}' (${prov.codigo_sap}) está inactivo en el maestro.`,
      accion_sugerida: "Solicitar la reactivación del proveedor o elegir otro proveedor.",
      valores: { codigo_sap: prov.codigo_sap },
    })
  }

  // RC2 / RC3 / RC4
  const cc = m.centrosCosto.find((c) => c.centro_costo === s.centro_costo)
  if (!cc) {
    bloqueos.push({
      regla: "RC4",
      tipo: "bloqueo",
      codigo: "CENTRO_COSTO_INEXISTENTE",
      detalle: `El centro de costo '${s.centro_costo}' no existe en el maestro.`,
      accion_sugerida: "Pedir al solicitante el centro de costo correcto.",
      valores: { centro_costo: s.centro_costo },
    })
  } else if (!cc.subareas.includes(s.subarea)) {
    bloqueos.push({
      regla: "RC4",
      tipo: "bloqueo",
      codigo: "SUBAREA_INVALIDA",
      detalle: `La subárea '${s.subarea}' no pertenece al centro de costo ${s.centro_costo}.`,
      accion_sugerida: `Pedir al solicitante una subárea válida: ${cc.subareas.join(", ")}.`,
      valores: { subarea: s.subarea, centro_costo: s.centro_costo },
    })
  }

  const ap = p.aprobacion
  if (!ap) {
    bloqueos.push({
      regla: "RC2",
      tipo: "bloqueo",
      codigo: "APROBACION_AUSENTE",
      detalle: "No se recibió el correo de aprobación.",
      accion_sugerida: "Pedir al solicitante el correo de aprobación de su líder.",
    })
  } else {
    if (!ap.aprobado) {
      bloqueos.push({
        regla: "RC2",
        tipo: "bloqueo",
        codigo: "APROBACION_SIN_APROBADO",
        detalle: "El correo de aprobación no contiene la palabra 'Aprobado'.",
        accion_sugerida: "Pedir al aprobador una respuesta que diga explícitamente 'Aprobado'.",
        valores: { de: ap.de },
      })
    }
    if (cc) {
      const email = ap.de.trim().toLowerCase()
      const aprobador = cc.aprobadores.find((a) => a.email.toLowerCase() === email)
      if (!aprobador) {
        bloqueos.push({
          regla: "RC2",
          tipo: "bloqueo",
          codigo: "APROBADOR_NO_AUTORIZADO",
          detalle: `${ap.de} no es aprobador del centro de costo ${s.centro_costo}.`,
          accion_sugerida: `Pedir la aprobación de uno de los aprobadores autorizados: ${cc.aprobadores.map((a) => a.email).join(", ")}.`,
          valores: { de: ap.de, centro_costo: s.centro_costo, aprobadores_permitidos: cc.aprobadores.map((a) => a.email).join(", ") },
        })
      } else if (s.valor_total > aprobador.tope) {
        bloqueos.push({
          regla: "RC3",
          tipo: "bloqueo",
          codigo: "MONTO_EXCEDE_TOPE",
          detalle: `El valor total ${fmt(s.valor_total)} excede el tope de ${fmt(aprobador.tope)} de ${aprobador.email}.`,
          accion_sugerida: "Obtener la aprobación de un aprobador con tope suficiente.",
          valores: { valor_total: s.valor_total, tope: aprobador.tope, aprobador: aprobador.email },
        })
      }
    }
    // RC9
    if (ap.fecha.slice(0, 10) < s.fecha_solicitud.slice(0, 10)) {
      confirmaciones.push({
        regla: "RC9",
        tipo: "confirmacion",
        codigo: "APROBACION_ANTERIOR",
        detalle: `La aprobación (${ap.fecha.slice(0, 10)}) es anterior a la fecha de la solicitud (${s.fecha_solicitud}).`,
        accion_sugerida: "Confirmar con el analista que la aprobación sigue vigente para esta solicitud.",
        valores: { fecha_aprobacion: ap.fecha.slice(0, 10), fecha_solicitud: s.fecha_solicitud },
      })
    }
  }

  // RC5
  if (!p.cotizacion) {
    confirmaciones.push({
      regla: "RC5",
      tipo: "confirmacion",
      codigo: "COTIZACION_AUSENTE",
      detalle: "No se recibió cotización del proveedor.",
      accion_sugerida: "Confirmar si se continúa sin cotización o pedirla al solicitante.",
    })
  } else {
    const dif = Math.abs(p.cotizacion.total - s.valor_total) / s.valor_total
    if (dif > 0.02) {
      const pct = Math.round(dif * 10000) / 100
      confirmaciones.push({
        regla: "RC5",
        tipo: "confirmacion",
        codigo: "COTIZACION_DIFIERE",
        detalle: `La cotización (${fmt(p.cotizacion.total)}) difiere ${pct}% de la solicitud (${fmt(s.valor_total)}); el payload usará el valor de la solicitud.`,
        accion_sugerida: "Confirmar con el analista el valor de la solicitud o pedir una cotización actualizada.",
        valores: { valor_solicitud: s.valor_total, valor_cotizacion: p.cotizacion.total, diferencia_pct: pct },
      })
    }
  }

  // RC6 / RC7
  if (!s.indicador_iva && prov) {
    derivados.indicador_iva = {
      valor: prov.indicador_iva_default,
      fuente: "maestro.proveedores",
      regla: "RC6",
      detalle: `La solicitud no trae indicador de IVA; se usó el del proveedor (${prov.indicador_iva_default}).`,
    }
    confirmaciones.push({
      regla: "RC6",
      tipo: "confirmacion",
      codigo: "IVA_DERIVADO",
      detalle: `La solicitud no trae indicador de IVA; se derivó ${prov.indicador_iva_default} del maestro de proveedores.`,
      accion_sugerida: "Confirmar que el indicador de IVA derivado es el correcto.",
      valores: { indicador_iva: prov.indicador_iva_default },
    })
  }
  if (!s.condiciones_pago && prov) {
    derivados.condiciones_pago = {
      valor: prov.condiciones_pago_default,
      fuente: "maestro.proveedores",
      regla: "RC7",
      detalle: `La solicitud no trae condiciones de pago; se usó la del proveedor (${prov.condiciones_pago_default}).`,
    }
  }

  // RC8
  if (p.factura && p.factura.fecha < s.fecha_solicitud) {
    retroactiva = true
    confirmaciones.push({
      regla: "RC8",
      tipo: "confirmacion",
      codigo: "OC_RETROACTIVA",
      detalle: `La factura ${p.factura.numero} (${p.factura.fecha}) es anterior a la solicitud (${s.fecha_solicitud}): la OC sería retroactiva.`,
      accion_sugerida: "Confirmar con el analista la creación retroactiva; quedará registrada en el control.",
      valores: { factura: p.factura.numero, fecha_factura: p.factura.fecha, fecha_solicitud: s.fecha_solicitud },
    })
  }

  // RC10
  const calculado = s.cantidad * s.valor_unitario
  if (Math.abs(calculado - s.valor_total) > 1) {
    bloqueos.push({
      regla: "RC10",
      tipo: "bloqueo",
      codigo: "MONTO_INCONSISTENTE",
      detalle: `cantidad × valor unitario (${fmt(calculado)}) no coincide con el valor total (${fmt(s.valor_total)}).`,
      accion_sugerida: "Pedir al solicitante corregir cantidad, valor unitario o valor total.",
      valores: { calculado, valor_total: s.valor_total },
    })
  }

  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva }
}
