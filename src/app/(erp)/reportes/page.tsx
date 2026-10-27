/**
 * ============================================================================
 *  REPORTES · exportación a Excel y a PDF con la marca de la empresa
 * ============================================================================
 *  Cada reporte se descarga como un archivo de Excel listo para trabajar, o
 *  como un PDF apaisado listo para imprimir o adjuntar: los dos traen el
 *  logotipo, la fecha de corte, los filtros que se aplicaron, formato de
 *  moneda y totales al pie. El PDF, además, numera sus páginas («N de M») y
 *  repite la cabecera de la tabla en cada una.
 *
 *  Importante: la exportación respeta los permisos. Un usuario que no puede ver
 *  costos en pantalla tampoco los puede descargar — la restricción se comprueba
 *  en el servidor, no en el botón.
 * ============================================================================
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { BotonesReporte } from '@/components/ui/BotonesReporte';
import { veCostos, rolPuedeVerRuta, NOMBRE_ROL, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Reportes' };
export const dynamic = 'force-dynamic';

type Reporte = {
  clave: string;
  titulo: string;
  descripcion: string;
  /** Lo que dice para quien no ve precios: el archivo le sale sin la columna de importes (076). */
  descripcionSinPrecios?: string;
  requiereCostos?: boolean;
  /** Lo baja quien puede abrir esta pantalla (la API comprueba lo mismo). */
  ruta?: string;
};

const GRUPOS: { grupo: string; reportes: Reporte[] }[] = [
  {
    grupo: 'Almacén',
    reportes: [
      { clave: 'existencias',   titulo: 'Existencias por lote',   descripcion: 'Todo el stock en cámara, lote por lote, con su antigüedad y disponibilidad.' },
      { clave: 'kardex',        titulo: 'Kardex valorizado',      descripcion: 'Todas las entradas y salidas en orden cronológico, con documento y responsable.' },
      { clave: 'anticuamiento', titulo: 'Anticuamiento',          descripcion: 'Producto ordenado por tiempo en cámara, con su valor inmovilizado.', descripcionSinPrecios: 'Producto ordenado por tiempo en cámara, en kilos.' },
      { clave: 'ocupabilidad',  titulo: 'Ocupabilidad de bodegas',descripcion: 'Capacidad utilizada y disponible en cada almacén.' },
      { clave: 'despachos',     titulo: 'Productividad de despacho', descripcion: 'Tiempos reales de carga por contenedor frente al objetivo.' },
    ],
  },
  {
    grupo: 'Valorizados',
    reportes: [
      { clave: 'valorizado',     titulo: 'Inventario valorizado', descripcion: 'Stock con su costo promedio móvil y valor total.', requiereCostos: true },
      { clave: 'rentabilidad',   titulo: 'Rentabilidad por pedido', descripcion: 'Venta, costo y margen de cada pedido despachado.', requiereCostos: true },
    ],
  },
  {
    /* No lleva costos: lo baja quien ve la pantalla de Cuentas por cobrar. */
    grupo: 'Finanzas',
    reportes: [
      { clave: 'cuentas_cobrar', titulo: 'Cuentas por cobrar',    descripcion: 'Saldos pendientes con su antigüedad por tramos.', ruta: '/finanzas/cobrar' },
    ],
  },
  {
    grupo: 'Comercial',
    reportes: [
      { clave: 'disponibilidad', titulo: 'Disponibilidad por producto', descripcion: 'Físico, bloqueado, reservado y disponible por SKU y bodega.' },
      { clave: 'pedidos',        titulo: 'Pedidos y su avance',    descripcion: 'Estado de cumplimiento de cada proforma con su semáforo.', descripcionSinPrecios: 'Estado de cumplimiento de cada proforma con su semáforo, en toneladas (sin importes).' },
      { clave: 'necesidades',    titulo: 'Necesidades de producción', descripcion: 'Lo comprometido que no está cubierto con stock.' },
    ],
  },
];

export default async function PaginaReportes() {
  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;
  const puedeVerCostos = veCostos(rol);

  /** Por qué no puede bajar este reporte, o null si puede. */
  const motivoBloqueo = (r: Reporte): string | null =>
    r.requiereCostos && !puedeVerCostos
      ? 'Trae costos y márgenes: solo Gerencia, Operaciones y Comercial.'
      : r.ruta && !rolPuedeVerRuta(rol, r.ruta)
        ? `${NOMBRE_ROL[rol]} no tiene acceso a la pantalla de este reporte.`
        : null;

  return (
    <>
      <CabeceraPagina
        titulo="Reportes"
        descripcion="Descargue cualquier reporte en Excel o en PDF, ya formateado con la marca de la empresa y listo para enviar."
      />

      {GRUPOS.map((g) => (
        <Panel key={g.grupo} titulo={g.grupo} className="mb-espacio">
          <div className="rejilla-reportes">
            {g.reportes.map((r) => {
              const bloqueo = motivoBloqueo(r);
              return (
                <div key={r.clave} className="tarjeta-reporte" data-bloqueado={bloqueo ? 'si' : 'no'}
                     data-reporte={r.clave}>
                  <div className="tarjeta-reporte-texto">
                    <strong>{r.titulo}</strong>
                    <span>{!puedeVerCostos && r.descripcionSinPrecios ? r.descripcionSinPrecios : r.descripcion}</span>
                  </div>
                  {bloqueo ? (
                    <span className="pill pill-neutro" title={bloqueo}>Sin permiso</span>
                  ) : (
                    /*
                     * Los dos botones de siempre (Excel y PDF): miran la
                     * respuesta antes de bajar, así que un rechazo se lee en
                     * pantalla en vez de descargarse como si fuera el archivo.
                     */
                    <div className="tarjeta-reporte-botones"
                         style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '16rem' }}>
                      <Suspense fallback={null}>
                        <BotonesReporte tipo={r.clave} />
                      </Suspense>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      ))}

      <Panel titulo="Qué trae cada archivo">
        <ul className="lista-caracteristicas">
          <li><strong>Logotipo y colores de la empresa</strong> en la cabecera de la hoja.</li>
          <li><strong>Fecha y hora de corte</strong>, para saber a qué momento corresponde la información.</li>
          <li><strong>Filtros aplicados</strong> escritos en el documento, para que quien lo reciba sepa qué está viendo.</li>
          <li><strong>Formato de moneda y miles</strong> ya aplicado: no hay que arreglar celdas.</li>
          <li><strong>Totales al pie</strong> de las columnas numéricas.</li>
          <li><strong>En Excel:</strong> filtros automáticos y cabecera congelada, para trabajar cómodo sobre tablas largas.</li>
          <li><strong>En PDF:</strong> hoja apaisada, la cabecera de la tabla repetida en cada página y «página N de M» al pie, para imprimir o adjuntar sin que nadie cambie una cifra.</li>
          <li><strong>Pie con el usuario que exportó</strong>, como constancia de trazabilidad del documento.</li>
        </ul>
      </Panel>

      <p className="pie-explicativo">
        Los reportes marcados como <strong>Valorizados</strong> incluyen costos y márgenes, por lo
        que solo están disponibles para Gerencia, Operaciones y Comercial. <strong>Cuentas por
        cobrar</strong> lo baja quien ve esa pantalla. La comprobación se hace en el servidor:
        aunque alguien construyera la dirección de descarga a mano, el sistema la rechazaría.
      </p>
    </>
  );
}
