/**
 * ============================================================================
 *  RECORDATORIO · LOS COMPROBANTES AÚN NO VAN A SUNAT (078)
 * ============================================================================
 *  Decisión del cliente: el comprobante se sigue llamando «Factura
 *  electrónica» (así lo verá cuando se conecte con SUNAT), pero mientras esa
 *  conexión no exista hay que recordarlo arriba de Facturación, en la ficha
 *  del comprobante y en la vista previa de «Emitir comprobante» del pedido.
 *
 *  Es un aviso INFORMATIVO (azul, el de la casa), no de error: no impide nada.
 *  Sin dependencias del servidor, así sirve también en componentes de cliente.
 * ============================================================================
 */
import { Icono } from '@/components/estructura/Icono';

export function AvisoSunat({ style }: { style?: React.CSSProperties }) {
  return (
    <div className="ficha-aviso ficha-aviso-info" role="status" data-aviso="sunat" style={style}>
      <Icono nombre="alerta" tamano={17} />
      <span>
        <strong>Recordatorio:</strong> los comprobantes todavía no se envían ni se sincronizan con
        SUNAT. Esa conexión llegará en una actualización posterior.
      </span>
    </div>
  );
}
