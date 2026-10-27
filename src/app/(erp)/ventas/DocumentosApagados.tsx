/**
 * ============================================================================
 *  PDF Y EXCEL APAGADOS · para quien ve la ficha pero no descarga documentos
 * ============================================================================
 *  La cotización, la proforma y el comprobante llevan precios. Almacén, Calidad
 *  y Consulta ven la ficha en pantalla, pero no se llevan el documento: la API
 *  de documentos se lo niega (PUEDEN_DESCARGAR_DOCUMENTOS). Antes los botones
 *  salían encendidos y, al pulsarlos, aparecía «Su rol (calidad) no puede…»
 *  junto a un texto sobre documentos que no cuadran, que no tenía nada que
 *  ver. Ahora se ven apagados y dicen por qué al pasar el ratón: es lo mismo
 *  que ya hacía la ficha del comprobante.
 * ============================================================================
 */
import { Icono } from '@/components/estructura/Icono';
import { PUEDEN_DESCARGAR_DOCUMENTOS } from '@/lib/permisosFinanzas';
import { listaDeRoles, nombreRol } from '@/lib/permisosVentas';
import type { Rol } from '@/lib/navegacion';

/** ¿Puede este rol bajar documentos con precios (PDF, Excel, contrato)? */
export function puedeDescargarDocumentos(rol: Rol | string | null | undefined): boolean {
  return PUEDEN_DESCARGAR_DOCUMENTOS.includes((rol ?? 'consulta') as Rol);
}

/** El porqué, con el nombre del rol y quién sí puede. */
export function motivoSinDescarga(rol: Rol | string | null | undefined): string {
  return `${nombreRol(rol)} ve el documento en pantalla, pero no descarga documentos con precios: ` +
    `lo hacen ${listaDeRoles(PUEDEN_DESCARGAR_DOCUMENTOS)}.`;
}

export function DocumentosApagados({ rol, contrato = false }: { rol: Rol | string | null | undefined; contrato?: boolean }) {
  const titulo = motivoSinDescarga(rol);
  return (
    <>
      <button type="button" className="btn btn-secundario" disabled title={titulo} data-documento="pdf" data-apagado="si">
        <Icono nombre="facturas" tamano={15} />PDF
      </button>
      <button type="button" className="btn btn-secundario" disabled title={titulo} data-documento="excel" data-apagado="si">
        <Icono nombre="descargar" tamano={15} />Excel
      </button>
      {contrato && (
        <button type="button" className="btn btn-secundario" disabled data-enlace="contrato" data-apagado="si"
                title={`${nombreRol(rol)} no abre el contrato: lleva precios. Lo generan y descargan ${listaDeRoles(PUEDEN_DESCARGAR_DOCUMENTOS)}.`}>
          Contrato
        </button>
      )}
    </>
  );
}
