/**
 * ============================================================================
 *  RETIRO SANITARIO (RECALL)
 * ============================================================================
 *  El escenario: SANIPES inmoviliza un lote. Hay que responder, en minutos:
 *
 *    ¿A quién se lo vendimos? ¿En qué contenedores salió? ¿A qué destinos?
 *    ¿Cuánto queda todavía en cámara y hay que inmovilizar ahora mismo?
 *
 *  Sobre el Excel actual esa consulta tomaría un día de trabajo. Aquí es una
 *  pantalla. Devuelve tres bloques:
 *
 *    DESPACHADO             lo que ya salió: cliente, destino, contenedor
 *    EN BODEGA              lo que queda y hay que inmovilizar
 *    RESERVADO              lo apartado para pedidos que aún no salieron
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { BuscadorTrazabilidad } from '../Buscador';
import { tm, num, fechaHora } from '@/lib/formato';

export const metadata: Metadata = { title: 'Retiro sanitario' };
export const dynamic = 'force-dynamic';

export default async function PaginaRetiro(props: PageProps<'/trazabilidad/retiro'>) {
  const q = await props.searchParams;
  const texto = ((q.q as string) ?? '').trim();
  const supabase = await crearClienteServidor();

  // Se busca el lote por su código de pallet o de lote
  const { data: lotes } = texto.length >= 2
    ? await supabase
        .from('lotes')
        .select('id, codigo_pallet, codigo_lote, fecha_produccion')
        .or(`codigo_pallet.ilike.%${texto}%,codigo_lote.ilike.%${texto}%`)
        .limit(10)
    : { data: null };

  const loteId = q.lote ? Number(q.lote) : (lotes && lotes.length === 1 ? (lotes[0].id as number) : null);

  const { data: alcance } = loteId
    ? await supabase.rpc('recall_lote', { p_lote_id: loteId })
    : { data: null };

  const filas = (alcance ?? []) as Record<string, unknown>[];
  const despachado = filas.filter((f) => String(f.categoria).startsWith('DESPACHADO'));
  const enBodega = filas.filter((f) => String(f.categoria).startsWith('EN BODEGA'));
  const reservado = filas.filter((f) => String(f.categoria).startsWith('RESERVADO'));

  const kgDespachado = despachado.reduce((s, f) => s + Number(f.peso_kg ?? 0), 0);
  const kgBodega = enBodega.reduce((s, f) => s + Number(f.peso_kg ?? 0), 0);
  const kgReservado = reservado.reduce((s, f) => s + Number(f.peso_kg ?? 0), 0);
  const clientes = new Set(despachado.map((f) => f.cliente).filter(Boolean)).size;

  return (
    <>
      <CabeceraPagina
        titulo="Retiro sanitario"
        descripcion="Indique un lote y el sistema devuelve todo su alcance: a qué clientes salió, en qué contenedores, y cuánto queda por inmovilizar."
        volver={{ href: '/trazabilidad', texto: 'Volver a trazabilidad' }}
      />

      <BuscadorTrazabilidad valorInicial={texto} />

      {/* Si la búsqueda devolvió varios lotes, hay que elegir uno */}
      {lotes && lotes.length > 1 && !q.lote && (
        <Panel titulo={`${lotes.length} lotes coinciden · elija uno`} className="mb-espacio">
          <ul className="lista-simple">
            {lotes.map((l) => (
              <li key={l.id as number}>
                <Link href={`/trazabilidad/retiro?q=${encodeURIComponent(texto)}&lote=${l.id}`} className="enlace-dato">
                  {l.codigo_pallet as string}
                </Link>
                <span>lote {(l.codigo_lote as string) ?? '—'}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {loteId && (
        <>
          <RejillaKpi>
            <Kpi etiqueta="Ya despachado" valor={tm(kgDespachado)} sufijo="TM" tono="critico"
                 nota={`${clientes} cliente(s) afectado(s)`} />
            <Kpi etiqueta="Queda en bodega" valor={tm(kgBodega)} sufijo="TM" tono="atencion"
                 nota="Inmovilizar de inmediato" />
            <Kpi etiqueta="Reservado sin salir" valor={tm(kgReservado)} sufijo="TM" tono="atencion"
                 nota="Bloquear antes de que salga" />
            <Kpi etiqueta="Contenedores afectados"
                 valor={num(new Set(despachado.map((f) => f.contenedor).filter(Boolean)).size)} tono="critico" />
          </RejillaKpi>

          <Panel titulo={`Producto ya despachado · ${despachado.length} registros`} className="mb-espacio">
            {despachado.length === 0 ? (
              <Vacio titulo="Nada salió" mensaje="Este lote no ha sido despachado a ningún cliente." />
            ) : (
              <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                <table className="datos">
                  <thead>
                    <tr><th>Cliente</th><th>Destino</th><th>Contenedor</th><th>Packing</th><th>Guía</th><th className="num">Fecha</th><th className="num">Peso</th></tr>
                  </thead>
                  <tbody>
                    {despachado.map((f, i) => (
                      <tr key={i}>
                        <td><strong style={{ fontWeight: 600 }}>{String(f.cliente ?? '—')}</strong></td>
                        <td>{String(f.destino ?? '—')}</td>
                        <td className="mono">{String(f.contenedor ?? '—')}</td>
                        <td className="mono">{String(f.packing ?? '—')}</td>
                        <td className="mono">{String(f.guia ?? '—')}</td>
                        <td className="num">{fechaHora(f.fecha as string)}</td>
                        <td className="num">{tm(f.peso_kg as number)} TM</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="rejilla-2">
            <Panel titulo="Queda en bodega · inmovilizar">
              {enBodega.length === 0 ? (
                <Vacio titulo="Sin saldo" mensaje="No queda producto de este lote en cámara." />
              ) : (
                <ul className="lista-simple">
                  {enBodega.map((f, i) => (
                    <li key={i}>
                      <strong>{String(f.almacen ?? '—')}</strong>
                      <span>{num(f.bultos as number)} bultos · {tm(f.peso_kg as number)} TM</span>
                      <Etiqueta texto="Inmovilizar" tono="critico" />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel titulo="Reservado sin salir · bloquear">
              {reservado.length === 0 ? (
                <Vacio titulo="Sin reservas" mensaje="No hay pedidos con este lote apartado." />
              ) : (
                <ul className="lista-simple">
                  {reservado.map((f, i) => (
                    <li key={i}>
                      <strong>{String(f.cliente ?? '—')}</strong>
                      <span>{String(f.packing ?? '')} · {tm(f.peso_kg as number)} TM</span>
                      <Etiqueta texto="Bloquear" tono="atencion" />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}

      {!loteId && !texto && (
        <Panel titulo="Para qué sirve esta pantalla">
          <p className="pie-explicativo" style={{ padding: '1rem' }}>
            Si la autoridad sanitaria inmoviliza un producto, hay que saber de inmediato a quién se
            le vendió y qué queda en casa. Escriba arriba el código del pallet o del lote afectado y
            el sistema reconstruye el alcance completo del retiro en segundos, incluyendo los
            contenedores que ya salieron y los clientes que los recibieron.
          </p>
        </Panel>
      )}
    </>
  );
}
