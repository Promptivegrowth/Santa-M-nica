/**
 * ============================================================================
 *  FICHA DEL TRASLADO
 * ============================================================================
 *  Mover producto entre bodegas es donde más inventario se pierde de vista: la
 *  mercadería sale de un sitio, tarda horas o días en llegar al otro, y en el
 *  medio no está en ninguno de los dos.
 *
 *  Por eso el traslado tiene cuatro estados y no uno: borrador, autorizado,
 *  en tránsito y aceptado. Mientras está en tránsito, el peso sigue contando
 *  como inventario de la empresa —se ve en «Stock en tránsito»— pero no se
 *  puede reservar ni despachar desde ninguno de los dos almacenes.
 *
 *  La ficha muestra las dos cifras que importan al cerrar: lo que se envió y
 *  lo que se aceptó. Si no coinciden, la diferencia se ve aquí y queda escrita
 *  en el Kardex como merma, con su motivo.
 * ============================================================================
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta, RejillaKpi, Kpi } from '@/components/ui/Pagina';
import { Historial } from '@/components/ui/Historial';
import { EsqueletoKpi, EsqueletoTabla, EsqueletoFicha } from '@/components/ui/Esqueleto';
import { Icono } from '@/components/estructura/Icono';
import { fecha, fechaHora, num, tm, etiquetaEstado } from '@/lib/formato';
import { uno, campo } from '@/lib/relaciones';
import { AccionesTraslado, type LineaRecibo } from './Acciones';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  props: PageProps<'/almacenes/traslados/[id]'>
): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('traslados').select('numero').eq('id', Number(id)).single();
  return { title: data?.numero ?? 'Traslado' };
}

const TONO: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  borrador: 'neutro',
  autorizado: 'info',
  en_transito: 'atencion',
  aceptado: 'ok',
  anulado: 'critico',
};

/**
 * ----------------------------------------------------------------------------
 *  EL CASCARÓN
 * ----------------------------------------------------------------------------
 *  Una sola consulta —la que dice si el registro existe— y la cabecera. El
 *  resto se cuelga de un <Suspense>.
 *
 *  El reparto decide el código HTTP: Next.js empieza a enviar la respuesta al
 *  encontrar el primer <Suspense>, y una cabecera ya enviada no se puede
 *  cambiar. Si toda la página estuviera dentro de un loading.tsx, el
 *  notFound() llegaría tarde y un identificador inventado respondería 200.
 * ----------------------------------------------------------------------------
 */
export default async function FichaTraslado(props: PageProps<'/almacenes/traslados/[id]'>) {
  const { id } = await props.params;
  const trasId = Number(id);

  const supabase = await crearClienteServidor();
  const [{ data: t }, usuarioActual, { data: lineasCab }] = await Promise.all([
    supabase
      .from('traslados')
      .select('*, origen:almacenes!traslados_almacen_origen_id_fkey(id, nombre, tipo), destino:almacenes!traslados_almacen_destino_id_fkey(id, nombre, tipo), transportistas(razon_social), vehiculos(placa), conductores(nombre, licencia), autorizador:usuarios!traslados_autorizado_por_fkey(nombre), despachador:usuarios!traslados_despachado_por_fkey(nombre), aceptador:usuarios!traslados_aceptado_por_fkey(nombre)')
      .eq('id', trasId)
      .single(),
    obtenerUsuarioActual(),
    supabase
      .from('traslado_lineas')
      .select('id, bultos_enviados, peso_enviado_kg, lotes(codigo_pallet, sku_presentaciones(skus(codigo, corte, especies(nombre))))')
      .eq('traslado_id', trasId),
  ]);

  if (!t) notFound();

  const estadoCab = t.estado as string;

  /* Las líneas se piden aquí y no en el cuerpo porque las necesita la
     botonera, que va en la cabecera: al recibir hay que anotar qué llegó de
     cada pallet. */
  const lineasRecibo: LineaRecibo[] = (lineasCab ?? []).map((l: Record<string, unknown>) => {
    const lote = uno<Record<string, unknown>>(l.lotes);
    const sp = uno<Record<string, unknown>>(lote?.sku_presentaciones);
    const sku = uno<Record<string, unknown>>(sp?.skus);
    return {
      linea_id: l.id as number,
      pallet: String(lote?.codigo_pallet ?? '—'),
      producto: `${campo(sku?.especies, 'nombre')} · ${campo(sku, 'corte')}`,
      bultos_enviados: Number(l.bultos_enviados ?? 0),
      peso_enviado: Number(l.peso_enviado_kg ?? 0),
    };
  });

  return (
    <>
      <CabeceraPagina
        titulo={t.numero as string}
        descripcion={`${campo(t.origen, 'nombre')} → ${campo(t.destino, 'nombre')}`}
        volver={{ href: '/almacenes/traslados', texto: 'Volver a traslados' }}
      >
        <Etiqueta texto={etiquetaEstado(estadoCab)} tono={TONO[estadoCab] ?? 'neutro'} />
        <AccionesTraslado
          trasladoId={trasId}
          estado={estadoCab}
          lineas={lineasRecibo}
          rol={usuarioActual?.rol ?? 'consulta'}
        />
      </CabeceraPagina>

      <Suspense fallback={<CargandoCuerpo />}>
        <CuerpoTraslado trasId={trasId} t={t} />
      </Suspense>
    </>
  );
}

function CargandoCuerpo() {
  return (
    <>
      <EsqueletoKpi cantidad={4} />
      <EsqueletoFicha lineas={2} />
      <div className="rejilla-2">
        <EsqueletoFicha lineas={6} />
        <EsqueletoFicha lineas={4} />
      </div>
      <EsqueletoTabla filas={5} columnas={8} conFiltros={false} />
      <span className="sr-solo" role="status">Cargando el traslado…</span>
    </>
  );
}

/** El detalle: cadena de custodia, transporte y los lotes que van dentro. */
async function CuerpoTraslado({ trasId, t }: { trasId: number; t: Record<string, unknown> }) {
  const supabase = await crearClienteServidor();

  const { data: lineas } = await supabase
    .from('traslado_lineas')
    .select('id, bultos_enviados, peso_enviado_kg, bultos_aceptados, peso_aceptado_kg, observacion, lotes(id, codigo_pallet, fecha_produccion, sku_presentaciones(skus(codigo, corte, especies(nombre), formatos(nombre))))')
    .eq('traslado_id', trasId)
    .order('id');

  const estado = t.estado as string;
  const filas = lineas ?? [];

  const enviadoKg = filas.reduce((s, l) => s + Number(l.peso_enviado_kg ?? 0), 0);
  const aceptadoKg = filas.reduce((s, l) => s + Number(l.peso_aceptado_kg ?? 0), 0);
  const enviadoBultos = filas.reduce((s, l) => s + Number(l.bultos_enviados ?? 0), 0);
  const cerrado = estado === 'aceptado';
  const diferencia = cerrado ? aceptadoKg - enviadoKg : 0;

  return (
    <>
      {estado === 'en_transito' && (
        <div className="ficha-aviso ficha-aviso-atencion">
          <Icono nombre="traslados" tamano={17} />
          <span>
            <strong>Esta carga está en camino.</strong> Sus {tm(enviadoKg)} ya salieron de{' '}
            {campo(t.origen, 'nombre')} pero todavía no ingresaron a {campo(t.destino, 'nombre')}.
            Mientras tanto figura en «stock en tránsito»: sigue siendo inventario de la empresa,
            pero no se puede vender desde ninguno de los dos almacenes.
          </span>
        </div>
      )}

      {cerrado && Math.abs(diferencia) > 0.5 && (
        <div className="ficha-aviso ficha-aviso-critico">
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>Llegó {diferencia < 0 ? 'menos' : 'más'} de lo que salió:</strong> se enviaron{' '}
            {tm(enviadoKg)} y se aceptaron {tm(aceptadoKg)}, una diferencia de{' '}
            {tm(Math.abs(diferencia))}. La diferencia se registró como ajuste en el Kardex y es
            visible en la auditoría.
          </span>
        </div>
      )}

      <RejillaKpi>
        <Kpi etiqueta="Lotes trasladados" valor={num(filas.length)} nota={`${num(enviadoBultos)} bultos`} />
        <Kpi etiqueta="Peso enviado" valor={tm(enviadoKg)} />
        <Kpi
          etiqueta="Peso aceptado"
          valor={cerrado ? tm(aceptadoKg) : '—'}
          tono={cerrado ? (Math.abs(diferencia) > 0.5 ? 'critico' : 'ok') : 'neutro'}
          nota={cerrado ? 'Confirmado en destino' : 'Aún no recibido'}
        />
        <Kpi
          etiqueta="Diferencia"
          valor={cerrado ? tm(diferencia) : '—'}
          tono={!cerrado ? 'neutro' : Math.abs(diferencia) > 0.5 ? 'critico' : 'ok'}
        />
      </RejillaKpi>

      {/* ---- Trazabilidad de la cadena de custodia ---- */}
      <Panel titulo="Cadena de custodia" className="mb-espacio">
        <ol className="pasos-traslado">
          {[
            { titulo: 'Creado', quien: null, cuando: t.creado_en, hecho: true },
            { titulo: 'Autorizado', quien: campo(t.autorizador, 'nombre', ''), cuando: t.autorizado_en, hecho: !!t.autorizado_en },
            { titulo: 'Despachado', quien: campo(t.despachador, 'nombre', ''), cuando: t.despachado_en, hecho: !!t.despachado_en },
            { titulo: 'Aceptado en destino', quien: campo(t.aceptador, 'nombre', ''), cuando: t.aceptado_en, hecho: !!t.aceptado_en },
          ].map((p) => (
            <li key={p.titulo} className="paso-traslado" data-hecho={p.hecho ? 'si' : 'no'}>
              <span className="paso-marca" aria-hidden>
                {p.hecho ? <Icono nombre="calidad" tamano={13} /> : <Icono nombre="reloj" tamano={13} />}
              </span>
              <span className="paso-cuerpo">
                <strong>{p.titulo}</strong>
                {p.hecho ? (
                  <small>
                    {fechaHora(p.cuando as string)}
                    {p.quien ? ` · ${p.quien}` : ''}
                  </small>
                ) : (
                  <small>Pendiente</small>
                )}
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      <div className="rejilla-2 mb-espacio">
        <Panel titulo="Datos del traslado">
          <dl className="ficha">
            <div><dt>Número</dt><dd className="mono">{t.numero as string}</dd></div>
            <div><dt>Origen</dt><dd>{campo(t.origen, 'nombre')}</dd></div>
            <div><dt>Destino</dt><dd>{campo(t.destino, 'nombre')}</dd></div>
            <div><dt>Programado para</dt><dd>{t.fecha_programada ? fecha(t.fecha_programada as string) : '—'}</dd></div>
            <div><dt>Guía de remisión</dt><dd className="mono">{(t.guia_numero as string) ?? '—'}</dd></div>
            {t.observaciones ? (
              <div><dt>Observaciones</dt><dd>{t.observaciones as string}</dd></div>
            ) : null}
          </dl>
        </Panel>

        <Panel titulo="Transporte">
          <dl className="ficha">
            <div><dt>Transportista</dt><dd>{campo(t.transportistas, 'razon_social', 'Sin asignar')}</dd></div>
            <div><dt>Vehículo</dt><dd className="mono">{campo(t.vehiculos, 'placa', 'Sin asignar')}</dd></div>
            <div><dt>Conductor</dt><dd>{campo(t.conductores, 'nombre', 'Sin asignar')}</dd></div>
            <div><dt>Licencia</dt><dd className="mono">{campo(t.conductores, 'licencia', '—')}</dd></div>
          </dl>
        </Panel>
      </div>

      <Panel titulo={`Lotes incluidos · ${filas.length}`} className="mb-espacio">
        {filas.length === 0 ? (
          <Vacio titulo="Sin lotes" mensaje="Este traslado todavía no tiene líneas." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Lote</th><th>Producto</th>
                  <th className="num">Bultos env.</th><th className="num">Peso env.</th>
                  <th className="num">Bultos acep.</th><th className="num">Peso acep.</th>
                  <th className="num">Dif.</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((l) => {
                  const lote = uno<Record<string, unknown>>(l.lotes);
                  const sp = uno<Record<string, unknown>>(lote?.sku_presentaciones);
                  const sku = uno<Record<string, unknown>>(sp?.skus);
                  const dif = Number(l.peso_aceptado_kg ?? 0) - Number(l.peso_enviado_kg ?? 0);
                  return (
                    <tr key={l.id as number}>
                      <td className="mono">
                        {lote?.id ? (
                          <Link href={`/almacenes/lotes/${lote.id}`} className="enlace-ficha">
                            {String(lote.codigo_pallet)}
                          </Link>
                        ) : '—'}
                      </td>
                      <td style={{ fontSize: '.78rem' }}>
                        {campo(sku?.especies, 'nombre')} · {campo(sku?.formatos, 'nombre')} ·{' '}
                        {campo(sku, 'corte')}
                      </td>
                      <td className="num">{num(l.bultos_enviados)}</td>
                      <td className="num">{tm(Number(l.peso_enviado_kg))}</td>
                      <td className="num">{l.bultos_aceptados != null ? num(l.bultos_aceptados) : '—'}</td>
                      <td className="num">{l.peso_aceptado_kg != null ? tm(Number(l.peso_aceptado_kg)) : '—'}</td>
                      <td className="num">
                        {l.peso_aceptado_kg == null ? '—'
                          : Math.abs(dif) < 0.001 ? <span style={{ color: 'var(--ok)' }}>0</span>
                          : <span style={{ color: 'var(--critico)' }}>{tm(dif)}</span>}
                      </td>
                      <td>
                        {lote?.id ? (
                          <Link href={`/almacenes/lotes/${lote.id}`} className="accion-btn" title="Ver el lote">
                            <Icono nombre="ver" tamano={15} />
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel titulo="Historial del traslado">
        <Historial entidad="traslados" entidadId={trasId} />
      </Panel>
    </>
  );
}
