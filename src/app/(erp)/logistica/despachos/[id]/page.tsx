/**
 * ============================================================================
 *  FICHA DEL DESPACHO
 * ============================================================================
 *  Hasta octubre el despacho no tenía ficha: la lista mandaba al packing.
 *  Ahora la tiene, porque Oliver pidió dos cosas que viven aquí:
 *
 *    · Punto 15 — adjuntar la guía de remisión FINAL en PDF, verla y
 *      descargarla.
 *    · Punto 17 — un reporte de carga con fotos como evidencia, descargable
 *      y vinculado al despacho.
 *
 *  Y de paso deja a la vista lo que el despacho consolida: el contenedor, el
 *  embarque, el transporte y, pallet por pallet, qué salió para qué proforma.
 * ============================================================================
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, RejillaKpi, Kpi, Vacio } from '@/components/ui/Pagina';
import { Historial } from '@/components/ui/Historial';
import { Icono } from '@/components/estructura/Icono';
import { cargarDespachos } from '@/lib/despachosDatos';
import { fechaHora, fecha, num, tm, etiquetaEstado } from '@/lib/formato';
import { uno } from '@/lib/relaciones';
import { ArchivosDespacho, type ArchivoVisible } from './ArchivosDespacho';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/logistica/despachos/[id]'>): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('despachos').select('numero').eq('id', Number(id)).maybeSingle();
  return { title: data?.numero ?? 'Despacho' };
}

const PUEDEN = ['gerencia', 'operaciones', 'almacen', 'comex'];

export default async function FichaDespacho(props: PageProps<'/logistica/despachos/[id]'>) {
  const { id } = await props.params;
  const despachoId = Number(id);
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();

  const [d] = Number.isInteger(despachoId) && despachoId > 0 ? await cargarDespachos(supabase, { ids: [despachoId] }) : [];
  if (!d) notFound();

  /* ---- Los archivos, con enlaces firmados que caducan en una hora ---- */
  const { data: filas } = await supabase
    .from('despacho_archivos')
    .select('id, tipo, ruta, nombre, tamano_bytes, subido_en, descripcion, usuarios!despacho_archivos_subido_por_fkey(nombre)')
    .eq('despacho_id', despachoId)
    .order('subido_en', { ascending: false });
  const rutas = (filas ?? []).map((a) => String(a.ruta));
  const { data: firmados } = rutas.length
    ? await supabase.storage.from('despachos').createSignedUrls(rutas, 3600)
    : { data: [] };
  const urlDe = new Map((firmados ?? []).map((f) => [String(f.path), f.signedUrl as string | null]));
  const descargas = await Promise.all((filas ?? []).filter((a) => a.tipo === 'guia').map(async (a) => {
    const { data } = await supabase.storage.from('despachos').createSignedUrl(String(a.ruta), 3600, { download: String(a.nombre) });
    return [Number(a.id), data?.signedUrl ?? null] as const;
  }));
  const descargaDe = new Map(descargas);
  const visibles = (tipo: 'guia' | 'foto'): ArchivoVisible[] => (filas ?? []).filter((a) => a.tipo === tipo).map((a) => ({
    id: Number(a.id),
    nombre: String(a.nombre),
    url: urlDe.get(String(a.ruta)) ?? null,
    descarga: descargaDe.get(Number(a.id)) ?? null,
    tamano_bytes: Number(a.tamano_bytes),
    subido_en: String(a.subido_en),
    subido_por: (uno<Record<string, unknown>>(a.usuarios)?.nombre as string) ?? null,
    descripcion: (a.descripcion as string) ?? null,
  }));
  const guias = visibles('guia');
  const fotos = visibles('foto');
  const puede = PUEDEN.includes(usuario?.rol ?? '');

  const totalKg = d.items.reduce((t, i) => t + i.kg, 0);
  const totalBultos = d.items.reduce((t, i) => t + i.bultos, 0);

  return (
    <>
      <CabeceraPagina
        titulo={d.numero}
        descripcion={`${d.almacen ?? '—'} → ${d.destino ?? 'sin destino'} · salió el ${fechaHora(d.fecha_salida)}`}
        volver={{ href: '/logistica/despachos', texto: 'Volver a despachos' }}
      >
        <a href={`/api/despachos/reporte?ids=${d.id}`} className="btn btn-primario" data-accion="reporte-carga">
          <Icono nombre="descargar" tamano={15} />
          Reporte de carga (PDF)
        </a>
      </CabeceraPagina>

      <RejillaKpi>
        <Kpi etiqueta="Toneladas" valor={tm(totalKg, 3)} sufijo="TM" tono="marca" href="#items" />
        <Kpi etiqueta="Bultos" valor={num(totalBultos)} href="#items" />
        <Kpi etiqueta="Pallets" valor={num(d.items.length)} href="#items" />
        <Kpi etiqueta="Guía final" valor={guias.length ? 'Adjunta' : 'Falta'} tono={guias.length ? 'ok' : 'atencion'} href="#guia" />
        <Kpi etiqueta="Fotos de la carga" valor={num(fotos.length)} tono={fotos.length ? 'ok' : 'atencion'} href="#fotos" />
      </RejillaKpi>

      <div className="rejilla-2 mb-espacio">
        <Panel titulo="La operación">
          <dl className="ficha" data-bloque="operacion">
            <div><dt>Embarque</dt><dd>{d.embarque_id ? <Link href={`/logistica/embarques/${d.embarque_id}`} className="enlace-dato mono">{d.embarque}</Link> : '—'}</dd></div>
            <div><dt>Proformas</dt><dd>
              {d.proformas.length === 0 ? '—' : d.proformas.map((p, i) => (
                <span key={p.pedido_id}>{i > 0 ? ', ' : ''}<Link href={`/ventas/pedidos/${p.pedido_id}`} className="enlace-dato mono">{p.numero}</Link>{p.cliente ? ` · ${p.cliente}` : ''}</span>
              ))}
            </dd></div>
            <div><dt>Tipo</dt><dd>{d.tipo_despacho ? etiquetaEstado(d.tipo_despacho) : '—'}</dd></div>
            <div><dt>Destino</dt><dd>{d.destino ?? '—'}</dd></div>
            <div><dt>Booking · naviera</dt><dd>{[d.booking, d.naviera].filter(Boolean).join(' · ') || '—'}</dd></div>
            <div><dt>Encargado</dt><dd>{d.encargado ?? '—'}</dd></div>
          </dl>
        </Panel>
        <Panel titulo="El contenedor y el transporte">
          <dl className="ficha">
            <div><dt>Packing</dt><dd>{d.packing_id ? <Link href={`/logistica/packing/${d.packing_id}`} className="enlace-dato mono">{d.packing}</Link> : '—'}</dd></div>
            <div><dt>Contenedor · precinto</dt><dd className="mono">{[d.contenedor, d.precinto].filter(Boolean).join(' · ') || '—'}</dd></div>
            <div><dt>Guía de remisión</dt><dd className="mono">{d.guia ?? '—'}</dd></div>
            <div><dt>DAM</dt><dd className="mono">{d.dam ?? '—'}</dd></div>
            <div><dt>Carga</dt><dd>{d.fecha_carga ? fecha(d.fecha_carga) : '—'}{d.hora_inicio ? ` · ${d.hora_inicio.slice(0, 5)}–${(d.hora_fin ?? '').slice(0, 5)}` : ''}{d.turno ? ` · turno ${d.turno}` : ''}</dd></div>
            <div><dt>Supervisor</dt><dd>{d.supervisor ?? '—'}</dd></div>
            <div><dt>Transportista</dt><dd>{[d.transportista, d.placa, d.conductor].filter(Boolean).join(' · ') || '—'}</dd></div>
          </dl>
        </Panel>
      </div>

      {/* ---- Punto 15: la guía final ---- */}
      <Panel id="guia" titulo="Guía de remisión final (PDF)" className="mb-espacio">
        <div style={{ padding: '.7rem 1rem 1rem' }}>
          <ArchivosDespacho despachoId={d.id} tipo="guia" archivos={guias} puede={puede} />
        </div>
      </Panel>

      {/* ---- Punto 17: las fotos de la carga ---- */}
      <Panel id="fotos" titulo={`Fotos de la carga · ${fotos.length}`} className="mb-espacio">
        <div style={{ padding: '.7rem 1rem 1rem' }}>
          <p className="pie-explicativo" style={{ marginTop: 0 }}>
            Son la evidencia del reporte de carga: el contenedor vacío, el precinto, la estiba, la
            temperatura. Salen en el PDF en el orden en que se subieron.
          </p>
          <ArchivosDespacho despachoId={d.id} tipo="foto" archivos={[...fotos].reverse()} puede={puede} />
        </div>
      </Panel>

      <Panel id="items" titulo={`Qué salió · ${d.items.length} pallets`} className="mb-espacio">
        {d.items.length === 0 ? (
          <Vacio titulo="Sin ítems" mensaje="El packing de este despacho no tiene pallets registrados." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-cuadro="items-despacho">
              <thead><tr><th>Pallet</th><th>SKU</th><th>Producto</th><th>Proforma</th><th className="num">Bultos</th><th className="num">Peso</th></tr></thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id}>
                    <td className="mono"><Link href={`/almacenes/lotes/${i.lote_id}`} className="enlace-ficha">{i.pallet}</Link></td>
                    <td className="mono">{i.sku}</td>
                    <td style={{ fontSize: '.78rem' }}>{i.producto}</td>
                    <td className="mono">{i.pedido_id ? <Link href={`/ventas/pedidos/${i.pedido_id}`} className="enlace-ficha">{i.proforma}</Link> : '—'}</td>
                    <td className="num">{num(i.bultos)}</td>
                    <td className="num">{tm(i.kg, 3)} TM</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 600 }}><td colSpan={4}>Total</td><td className="num">{num(totalBultos)}</td><td className="num">{tm(totalKg, 3)} TM</td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      <Panel titulo="Historial del despacho">
        <Historial entidad="despachos" entidadId={d.id} />
      </Panel>
    </>
  );
}
