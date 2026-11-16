/**
 * ============================================================================
 *  BANDEJA DE RECLAMOS · Aseguramiento de Calidad (090, M5)
 * ============================================================================
 *  Todos los reclamos que los clientes registran en el portal, con su N.°,
 *  cliente, proforma, contenedor, motivo, estado y plazo. El semáforo dice
 *  cuáles están vencidos y cuáles por vencer (2 días o menos), para atender
 *  primero lo que corre prisa.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta, RejillaKpi, Kpi } from '@/components/ui/Pagina';
import { Filtros } from '@/components/ui/Filtros';
import { fecha, num } from '@/lib/formato';
import { hoyEnLima } from '@/lib/fechas';
import { cargarReclamos, ESTADOS_RECLAMO, SEMAFORO } from '@/lib/reclamos';

export const metadata: Metadata = { title: 'Bandeja de reclamos' };
export const dynamic = 'force-dynamic';

const ORDEN_SEMAFORO = { vencido: 0, por_vencer: 1, sin_clasificar: 2, en_plazo: 3, cerrado: 4 } as const;

export default async function BandejaReclamos(props: PageProps<'/calidad/reclamos'>) {
  const q = await props.searchParams;
  const valor = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : '');
  const filtros = {
    cliente: valor('cliente'), proforma: valor('proforma'), motivo: valor('motivo'),
    estado: valor('estado'), desde: valor('desde'), hasta: valor('hasta'),
  };

  const supabase = await crearClienteServidor();
  const [{ filas, error }, { filas: todas }, { data: motivos }] = await Promise.all([
    cargarReclamos(supabase, filtros),
    cargarReclamos(supabase, {}),
    supabase.from('reclamo_motivos').select('id, nombre_es').order('orden'),
  ]);

  /* Los indicadores miran todos los reclamos, no solo los filtrados. */
  const mes = hoyEnLima().slice(0, 7);
  const abiertos = todas.filter((r) => r.estado !== 'cerrado');
  const vencidos = abiertos.filter((r) => r.semaforo === 'vencido').length;
  const porVencer = abiertos.filter((r) => r.semaforo === 'por_vencer').length;
  const cerradosMes = todas.filter((r) => r.cerrado_en && new Date(r.cerrado_en)
    .toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).startsWith(mes)).length;

  const ordenadas = [...filas].sort((a, b) =>
    ORDEN_SEMAFORO[a.semaforo] - ORDEN_SEMAFORO[b.semaforo] || b.creado_en.localeCompare(a.creado_en));

  return (
    <>
      <CabeceraPagina
        titulo="Bandeja de reclamos"
        descripcion="Los reclamos que registran los clientes en el portal, con su evidencia. Calidad los clasifica, fija el plazo, investiga y cierra con el PDF de respuesta."
      >
        <Link href="/calidad/indicadores" className="btn btn-secundario">Indicadores</Link>
      </CabeceraPagina>

      <RejillaKpi>
        <Kpi etiqueta="Abiertos" valor={num(abiertos.length)} tono="marca" href="?estado=abiertos" />
        <Kpi etiqueta="Vencidos" valor={num(vencidos)} tono={vencidos ? 'critico' : 'ok'} nota="Pasaron su fecha límite" />
        <Kpi etiqueta="Por vencer" valor={num(porVencer)} tono={porVencer ? 'atencion' : 'ok'} nota="Vencen en 2 días o menos" />
        <Kpi etiqueta="Cerrados este mes" valor={num(cerradosMes)} tono="ok" href="?estado=cerrado" />
      </RejillaKpi>

      <Panel titulo={`${num(ordenadas.length)} reclamo${ordenadas.length === 1 ? '' : 's'}`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'cliente', etiqueta: 'Cliente o código', ancho: '12rem' },
            { tipo: 'texto', clave: 'proforma', etiqueta: 'Proforma', ancho: '9rem' },
            {
              tipo: 'select', clave: 'motivo', etiqueta: 'Motivo',
              opciones: (motivos ?? []).map((m) => ({ valor: String(m.id), texto: String(m.nombre_es) })),
            },
            {
              tipo: 'select', clave: 'estado', etiqueta: 'Estado',
              opciones: [{ valor: 'abiertos', texto: 'Abiertos (no cerrados)' },
                ...Object.entries(ESTADOS_RECLAMO).map(([v, t]) => ({ valor: v, texto: t }))],
            },
            { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
            { tipo: 'fecha', clave: 'hasta', etiqueta: 'Hasta' },
          ]}
        />

        {error ? (
          <Vacio titulo="Todavía no está activado" mensaje="La bandeja de reclamos necesita la migración 090 en la base. Avise a sistemas." />
        ) : ordenadas.length === 0 ? (
          <Vacio titulo="Sin reclamos" mensaje="No hay reclamos con estos filtros. Los clientes los registran desde el portal de seguimiento." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-cuadro="bandeja-reclamos">
              <thead>
                <tr>
                  <th>Plazo</th><th>N.°</th><th>Fecha</th><th>Cliente</th><th>Proforma</th>
                  <th>Contenedor</th><th>Motivo</th><th>Estado</th><th>Clasificación</th><th>Fecha límite</th>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((r) => (
                  <tr key={r.id} data-reclamo={r.numero}>
                    <td><Etiqueta texto={SEMAFORO[r.semaforo].texto} tono={SEMAFORO[r.semaforo].tono} /></td>
                    <td className="mono"><Link href={`/calidad/reclamos/${r.id}`} className="enlace-ficha">{r.numero}</Link></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fecha(r.fecha)}</td>
                    <td>{r.cliente}<br /><small style={{ color: 'var(--tinta-3)' }}>{r.cliente_codigo}</small></td>
                    <td className="mono"><Link href={`/ventas/pedidos/${r.pedido_id}`} className="enlace-ficha">{r.proforma}</Link></td>
                    <td className="mono" style={{ fontSize: '.78rem' }}>{r.contenedor ?? 'Toda la proforma'}</td>
                    <td>{r.motivo}</td>
                    <td>{ESTADOS_RECLAMO[r.estado] ?? r.estado}</td>
                    <td>{r.clasificacion ? `${r.clasificacion} (${r.plazo_dias} d)` : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.fecha_limite ? fecha(r.fecha_limite) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
