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
import { TONO_ESTADO_FACTURA as TONO } from '@/lib/permisosFinanzas';

export const metadata: Metadata = { title: 'Facturación' };
export const dynamic = 'force-dynamic';

/*
 * EL FILTRO DE ESTADO
 * Sale de la vista v_comprobantes (070), que calcula el estado al momento
 * —con el saldo y el día de hoy en Lima— e incluye los anulados.
 *
 *   (vacío)  los vigentes: todo menos los anulados, que es lo que se trabaja;
 *   todas    también los anulados, para auditar;
 *   <estado> solo ese estado, «Anulada» incluido.
 */
const ESTADOS = ['emitida', 'parcialmente_cobrada', 'vencida', 'cobrada', 'anulada'];

export default async function PaginaFacturas(props: PageProps<'/finanzas/facturas'>) {
  const q = await props.searchParams;
  const estado = typeof q.estado === 'string' ? q.estado : '';
  const todas = estado === 'todas';
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
        vista="v_comprobantes"
        ficha={{ base: '/finanzas/facturas', titulo: 'Ver la factura' }}
        parametros={q as Record<string, string | undefined>}
        orden="fecha_emision"
        titulo="Documentos emitidos"
        filtros={[
          { tipo: 'texto', clave: 'buscar', etiqueta: 'Número o cliente', ancho: '13rem' },
          { tipo: 'select', clave: 'estado', etiqueta: 'Estado', textoTodos: 'Vigentes (sin anuladas)',
            opciones: [
              ...ESTADOS.map((e) => ({ valor: e, texto: etiquetaEstado(e) })),
              { valor: 'todas', texto: 'Todas, incluidas las anuladas' },
            ] },
          { tipo: 'fecha', clave: 'desde', etiqueta: 'Emitidas desde' },
        ]}
        filtrosAplicados={[
          { clave: 'buscar', columna: 'numero', operador: 'contiene', columnas: ['numero', 'cliente'] },
          // «todas» no es un estado: quita el filtro en vez de buscar ese valor.
          ...(todas ? [] : [{ clave: 'estado', columna: 'estado', operador: 'igual' as const }]),
          { clave: 'desde', columna: 'fecha_emision', operador: 'desde' },
        ]}
        // Sin estado elegido, los anulados no se muestran; se piden con el filtro.
        fijos={estado ? [] : [{ columna: 'anulada', valor: false }]}
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
            render: (f) => Number(f.saldo) > 0.01
              ? <strong style={{ color: 'var(--atencion)' }}>{dinero(f.saldo as number, f.moneda as 'USD' | 'PEN', 2)}</strong>
              : '—' },
          { clave: 'estado', titulo: 'Estado',
            render: (f) => (
              <span title={f.anulada ? `Anulada el ${fecha(f.anulada_en as string)}: ${String(f.motivo_anulacion ?? 'sin motivo')}` : undefined}>
                <Etiqueta texto={etiquetaEstado(String(f.estado))} tono={TONO[String(f.estado)] ?? 'neutro'} />
              </span>
            ) },
        ]}
        vacio={{
          titulo: 'Sin comprobantes',
          mensaje: estado === 'anulada'
            ? 'No hay comprobantes anulados con estos filtros.'
            : 'No hay documentos con estos filtros. Los anulados se ven eligiendo «Anulada» o «Todas, incluidas las anuladas» en Estado.',
        }}
      />
    </>
  );
}
