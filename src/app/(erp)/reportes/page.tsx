/**
 * ============================================================================
 *  REPORTES · exportación a Excel con la marca de la empresa
 * ============================================================================
 *  Cada reporte se descarga como un archivo de Excel listo para enviar: trae el
 *  logotipo, los colores de la marca, la fecha de corte, los filtros que se
 *  aplicaron, formato de moneda y totales al pie.
 *
 *  Importante: la exportación respeta los permisos. Un usuario que no puede ver
 *  costos en pantalla tampoco los puede descargar — la restricción se comprueba
 *  en el servidor, no en el botón.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Reportes' };
export const dynamic = 'force-dynamic';

type Reporte = {
  clave: string;
  titulo: string;
  descripcion: string;
  requiereCostos?: boolean;
};

const GRUPOS: { grupo: string; reportes: Reporte[] }[] = [
  {
    grupo: 'Almacén',
    reportes: [
      { clave: 'existencias',   titulo: 'Existencias por lote',   descripcion: 'Todo el stock en cámara, lote por lote, con su antigüedad y disponibilidad.' },
      { clave: 'kardex',        titulo: 'Kardex valorizado',      descripcion: 'Todas las entradas y salidas en orden cronológico, con documento y responsable.' },
      { clave: 'anticuamiento', titulo: 'Anticuamiento',          descripcion: 'Producto ordenado por tiempo en cámara, con su valor inmovilizado.' },
      { clave: 'ocupabilidad',  titulo: 'Ocupabilidad de bodegas',descripcion: 'Capacidad utilizada y disponible en cada almacén.' },
      { clave: 'despachos',     titulo: 'Productividad de despacho', descripcion: 'Tiempos reales de carga por contenedor frente al objetivo.' },
    ],
  },
  {
    grupo: 'Valorizados',
    reportes: [
      { clave: 'valorizado',     titulo: 'Inventario valorizado', descripcion: 'Stock con su costo promedio móvil y valor total.', requiereCostos: true },
      { clave: 'rentabilidad',   titulo: 'Rentabilidad por pedido', descripcion: 'Venta, costo y margen de cada pedido despachado.', requiereCostos: true },
      { clave: 'cuentas_cobrar', titulo: 'Cuentas por cobrar',    descripcion: 'Saldos pendientes con su antigüedad por tramos.', requiereCostos: true },
    ],
  },
  {
    grupo: 'Comercial',
    reportes: [
      { clave: 'disponibilidad', titulo: 'Disponibilidad por producto', descripcion: 'Físico, bloqueado, reservado y disponible por SKU y bodega.' },
      { clave: 'pedidos',        titulo: 'Pedidos y su avance',    descripcion: 'Estado de cumplimiento de cada proforma con su semáforo.' },
      { clave: 'necesidades',    titulo: 'Necesidades de producción', descripcion: 'Lo comprometido que no está cubierto con stock.' },
    ],
  },
];

export default async function PaginaReportes() {
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);

  return (
    <>
      <CabeceraPagina
        titulo="Reportes"
        descripcion="Descargue cualquier reporte en Excel, ya formateado con la marca de la empresa y listo para enviar."
      />

      {GRUPOS.map((g) => (
        <Panel key={g.grupo} titulo={g.grupo} className="mb-espacio">
          <div className="rejilla-reportes">
            {g.reportes.map((r) => {
              const bloqueado = r.requiereCostos && !puedeVerCostos;
              return (
                <div key={r.clave} className="tarjeta-reporte" data-bloqueado={bloqueado ? 'si' : 'no'}>
                  <div className="tarjeta-reporte-texto">
                    <strong>{r.titulo}</strong>
                    <span>{r.descripcion}</span>
                  </div>
                  {bloqueado ? (
                    <span className="pill pill-neutro">Sin permiso</span>
                  ) : (
                    <a
                      href={`/api/reportes/${r.clave}`}
                      className="btn btn-primario"
                      download
                    >
                      <Icono nombre="descargar" tamano={15} />
                      Excel
                    </a>
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
          <li><strong>Filtros automáticos y cabecera congelada</strong>, para trabajar cómodo sobre tablas largas.</li>
          <li><strong>Pie con el usuario que exportó</strong>, como constancia de trazabilidad del documento.</li>
        </ul>
      </Panel>

      <p className="pie-explicativo">
        Los reportes marcados como <strong>Valorizados</strong> incluyen costos y márgenes, por lo
        que solo están disponibles para Gerencia, Operaciones y Comercial. La comprobación se hace
        en el servidor: aunque alguien construyera la dirección de descarga a mano, el sistema la
        rechazaría.
      </p>
    </>
  );
}
