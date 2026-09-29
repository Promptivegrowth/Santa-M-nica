/**
 * ============================================================================
 *  ALERTAS · lo que el sistema detectó y necesita a alguien
 * ============================================================================
 *  Estas alertas NO están escritas en el código: las genera el motor de reglas
 *  a partir de condiciones que el propio cliente define desde Configuración.
 *
 *  Cada alerta es NAVEGABLE: lleva al registro que la provocó. De nada sirve
 *  saber que «el lote SM 26 02 0001 lleva 19 meses en cámara» si después hay
 *  que buscarlo a mano en otra pantalla.
 *
 *  LAS SEIS PRINCIPALES (documento de mejoras, punto 6)
 *  Arriba, y con la cifra de AHORA MISMO (v_alertas_principales, 059): lo que
 *  vence, lo retenido, la cobertura, lo que se puede despachar ya, el
 *  backorder y lo que va fuera de tiempo. Cada tarjeta abre su detalle. El
 *  resto de avisos sigue debajo, como antes.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { Icono } from '@/components/estructura/Icono';
import { enlaceEntidad, nombreEntidad } from '@/lib/enlaces';
import { num, fechaHora, haceTiempo } from '@/lib/formato';

export const metadata: Metadata = { title: 'Alertas' };
export const dynamic = 'force-dynamic';
const POR_PAGINA = 40;

export default async function PaginaAlertas(props: PageProps<'/alertas'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const severidad = (q.severidad as string) ?? '';
  const entidad = (q.entidad as string) ?? '';
  // El panel agrupa las alertas por tipo y enlaza aquí con el tipo ya puesto:
  // sin este filtro, «43 productos con vida útil vencida» llevaba al listado
  // entero y había que buscarlos entre las trescientas restantes.
  const titulo = (q.titulo as string) ?? '';

  let consulta = supabase.from('alertas').select('*', { count: 'exact' }).eq('atendida', false);
  if (severidad) consulta = consulta.eq('severidad', severidad);
  if (entidad) consulta = consulta.eq('entidad', entidad);
  if (titulo) consulta = consulta.eq('titulo', titulo);

  const [{ data: filas, count }, { data: todas }, { data: tipos }, { data: principales }] = await Promise.all([
    consulta
      .order('severidad', { ascending: false })
      .order('generada_en', { ascending: false })
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    supabase.from('alertas').select('severidad, entidad').eq('atendida', false),
    supabase.from('v_alertas_resumen').select('titulo, cuantas').order('cuantas', { ascending: false }),
    supabase.from('v_alertas_principales').select('*').order('orden'),
  ]);

  /*
   * Los avisos de resumen no apuntan a un registro —hablan de muchos—, así que
   * no tienen ficha. Llevan a la pantalla que los detalla.
   */
  const rutaDeAviso = new Map<string, string>([
    ...(principales ?? []).map((p) => [String(p.aviso), String(p.ruta)] as [string, string]),
    ['Costos del mes sin cargar', '/finanzas/costos?faltantes=si'],
    ['Cotizaciones por vencer', '/ventas/cotizaciones'],
  ]);
  const TONO: Record<string, 'critico' | 'atencion' | 'ok'> = { critica: 'critico', advertencia: 'atencion', ok: 'ok' };

  const criticas = (todas ?? []).filter((a) => a.severidad === 'critica').length;
  const avisos = (todas ?? []).filter((a) => a.severidad === 'advertencia').length;
  const entidades = [...new Set((todas ?? []).map((a) => a.entidad as string))];

  return (
    <>
      <CabeceraPagina
        titulo="Alertas"
        descripcion="Situaciones que el sistema detectó por sí solo. Haga clic en cualquiera para ir directamente al registro que la provocó."
      >
        <Link href="/configuracion?t=reglas" className="btn btn-secundario">
          <Icono nombre="configuracion" tamano={15} />
          Configurar reglas
        </Link>
      </CabeceraPagina>

      {/* ══════ LAS SEIS PRINCIPALES ══════ */}
      <Panel titulo="Alertas principales · en este momento" className="mb-espacio">
        <div data-bloque="principales">
          <RejillaKpi>
            {(principales ?? []).map((p) => (
              <Kpi
                key={String(p.clave)}
                etiqueta={String(p.titulo)}
                valor={num(Number(p.cifra), p.unidad === 'TM' ? 1 : 0)}
                sufijo={String(p.unidad)}
                tono={TONO[String(p.severidad)] ?? 'neutro'}
                nota={String(p.detalle)}
                href={String(p.ruta)}
              />
            ))}
          </RejillaKpi>
        </div>
        <p className="pie-explicativo" style={{ padding: '0 1rem .8rem' }}>
          Las cifras son de ahora mismo, no de la última revisión: si se despacha un pedido o se
          libera un pallet, cambian al volver a entrar. Pulse cualquiera para ver qué la forma.
        </p>
      </Panel>

      <RejillaKpi>
        <Kpi etiqueta="Total pendientes" valor={num((todas ?? []).length)} href="#lista" />
        <Kpi
          etiqueta="Críticas"
          valor={num(criticas)}
          tono={criticas > 0 ? 'critico' : 'ok'}
          nota="Requieren acción hoy"
          href="/alertas?severidad=critica"
        />
        <Kpi
          etiqueta="Advertencias"
          valor={num(avisos)}
          tono={avisos > 0 ? 'atencion' : 'ok'}
          nota="Conviene revisarlas"
          href="/alertas?severidad=advertencia"
        />
      </RejillaKpi>

      <Panel id="lista" titulo={`${num(count ?? 0)} alertas sin atender`}>
        <Filtros
          campos={[
            {
              tipo: 'select', clave: 'severidad', etiqueta: 'Severidad',
              opciones: [
                { valor: 'critica', texto: 'Crítica' },
                { valor: 'advertencia', texto: 'Advertencia' },
                { valor: 'info', texto: 'Informativa' },
              ],
            },
            {
              tipo: 'select', clave: 'entidad', etiqueta: 'Sobre qué',
              opciones: entidades.map((e) => ({ valor: e, texto: nombreEntidad(e) })),
            },
            {
              tipo: 'select', clave: 'titulo', etiqueta: 'Tipo de alerta',
              opciones: (tipos ?? []).map((t) => ({
                valor: t.titulo as string,
                texto: `${t.titulo} (${num(Number(t.cuantas))})`,
              })),
            },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Todo en orden" mensaje="No hay alertas pendientes con estos filtros." />
        ) : (
          <>
            {/*
              Se usa una lista de tarjetas y no una tabla: cada alerta es una
              unidad de acción completa —qué pasa, dónde y a dónde ir— y en una
              tabla el enlace quedaría perdido en una celda del extremo.
            */}
            <ul className="lista-alertas-nav">
              {(filas ?? []).map((a) => {
                const destino = enlaceEntidad(a.entidad as string, a.entidad_id as number)
                  ?? rutaDeAviso.get(a.titulo as string) ?? null;
                const contenido = (
                  <>
                    <span className="alerta-marca" data-sev={a.severidad as string} aria-hidden />
                    <span className="alerta-cuerpo">
                      <span className="alerta-titulo-fila">
                        <strong>{a.titulo as string}</strong>
                        <Etiqueta
                          texto={nombreEntidad(a.entidad as string)}
                          tono="neutro"
                        />
                      </span>
                      <span className="alerta-mensaje">{a.mensaje as string}</span>
                      <time
                        className="alerta-tiempo"
                        dateTime={String(a.generada_en)}
                        title={fechaHora(a.generada_en as string)}
                      >
                        {haceTiempo(a.generada_en as string)}
                      </time>
                    </span>
                    {destino && (
                      <span className="alerta-ir">
                        Ver detalle
                        <Icono nombre="expandir" tamano={14} />
                      </span>
                    )}
                  </>
                );

                return (
                  <li key={a.id as number}>
                    {destino ? (
                      <Link href={destino} className="alerta-fila">{contenido}</Link>
                    ) : (
                      <div className="alerta-fila" data-sinenlace="si">{contenido}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={count ?? 0} />
          </>
        )}
      </Panel>

      <p className="pie-explicativo">
        Cada alerta nace de una regla configurable. Si alguna resulta ruidosa o falta otra, se
        activa, desactiva o ajusta desde{' '}
        <Link href="/configuracion?t=reglas">Configuración → Motor de reglas</Link>, sin tocar código.
      </p>
    </>
  );
}
