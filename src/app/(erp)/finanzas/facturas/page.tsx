/**
 * ============================================================================
 *  FACTURACIÓN
 * ============================================================================
 *  ACLARACIÓN IMPORTANTE: en esta fase el comprobante es un DOCUMENTO INTERNO
 *  con el formato de una factura. No es una factura electrónica válida ante
 *  SUNAT. La emisión oficial está contemplada como fase 2, tal como se acordó
 *  en la cotización.
 *
 *  Lo que sí resuelve hoy: el vínculo uno a uno entre cada venta y su
 *  documento, para que la trazabilidad no se corte al facturar.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { CabeceraPagina, Etiqueta, Panel } from '@/components/ui/Pagina';
import { Listado } from '@/components/ui/Listado';
import { fecha, dinero, etiquetaEstado } from '@/lib/formato';

export const metadata: Metadata = { title: 'Facturación' };
export const dynamic = 'force-dynamic';

const TONO: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  cobrada: 'ok', parcialmente_cobrada: 'atencion', vencida: 'critico',
  emitida: 'info', anulada: 'neutro',
};

export default async function PaginaFacturas(props: PageProps<'/finanzas/facturas'>) {
  const q = await props.searchParams;
  return (
    <>
      <CabeceraPagina
        titulo="Facturación"
        descripcion="Comprobantes emitidos, vinculados uno a uno con su venta. En esta fase son documentos internos con formato de factura."
      />

      <Panel titulo="Sobre estos documentos" className="mb-espacio">
        <p className="pie-explicativo" style={{ padding: '.9rem 1rem' }}>
          Estos comprobantes <strong>no son facturas electrónicas válidas ante SUNAT</strong>.
          Replican el formato para que Comex y Ventas puedan compartirlos con el cliente, y sobre
          todo para mantener la cadena de trazabilidad: desde cualquiera de ellos se llega al
          pedido, al contenedor y a los lotes que salieron. La emisión electrónica oficial está
          prevista como fase 2.
        </p>
      </Panel>

      <Listado
        vista="v_cuentas_cobrar"
        ficha={{ base: '/finanzas/facturas', titulo: 'Ver la factura' }}
        parametros={q as Record<string, string | undefined>}
        orden="fecha_emision"
        titulo="Documentos emitidos"
        filtros={[
          { tipo: 'texto', clave: 'buscar', etiqueta: 'Número o cliente', ancho: '13rem' },
          { tipo: 'select', clave: 'estado', etiqueta: 'Estado',
            opciones: Object.keys(TONO).map((e) => ({ valor: e, texto: etiquetaEstado(e) })) },
          { tipo: 'fecha', clave: 'desde', etiqueta: 'Emitidas desde' },
        ]}
        filtrosAplicados={[
          { clave: 'buscar', columna: 'numero', operador: 'contiene', columnas: ['numero', 'cliente'] },
          { clave: 'estado', columna: 'estado', operador: 'igual' },
          { clave: 'desde', columna: 'fecha_emision', operador: 'desde' },
        ]}
        columnas={[
          { clave: 'numero', titulo: 'Documento', mono: true },
          { clave: 'cliente', titulo: 'Cliente',
            render: (f) => String(f.cliente).length > 30 ? String(f.cliente).slice(0, 29) + '…' : String(f.cliente) },
          { clave: 'pais', titulo: 'País' },
          { clave: 'fecha_emision', titulo: 'Emisión', numerica: true, render: (f) => fecha(f.fecha_emision as string) },
          { clave: 'fecha_vencimiento', titulo: 'Vencimiento', numerica: true, render: (f) => fecha(f.fecha_vencimiento as string) },
          { clave: 'total', titulo: 'Total', numerica: true,
            render: (f) => dinero(f.total as number, f.moneda as 'USD' | 'PEN', 2) },
          { clave: 'cobrado', titulo: 'Cobrado', numerica: true,
            render: (f) => dinero(f.cobrado as number, f.moneda as 'USD' | 'PEN', 2) },
          { clave: 'saldo', titulo: 'Saldo', numerica: true,
            render: (f) => Number(f.saldo) > 0
              ? <strong style={{ color: 'var(--atencion)' }}>{dinero(f.saldo as number, f.moneda as 'USD' | 'PEN', 2)}</strong>
              : '—' },
          { clave: 'estado', titulo: 'Estado',
            render: (f) => <Etiqueta texto={etiquetaEstado(String(f.estado))} tono={TONO[String(f.estado)] ?? 'neutro'} /> },
        ]}
        vacio={{ titulo: 'Sin facturas', mensaje: 'No hay documentos con estos filtros.' }}
      />
    </>
  );
}
