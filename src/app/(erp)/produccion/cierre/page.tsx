/**
 * ============================================================================
 *  CIERRE SEMANAL DE PRODUCCIÓN · «Avance de plan»
 * ============================================================================
 *  La hoja «1. RESUMEN T» del Excel de Marco, dentro del sistema, con las
 *  columnas como las definió Oliver (migración 063):
 *    · Marco ingresa al inicio del mes los planes (MP, producción, ventas);
 *    · Oliver ingresa al final del mes la materia prima real;
 *    · el ERP pone la producción real, el stock al inicio del mes y las
 *      ventas a la fecha de pota y merluza; las harinas residuales, que no
 *      son productos del ERP, se ingresan;
 *    · porcentajes y proyección lineal —(real ÷ 20) × 26— se calculan solos.
 *  Bajo el 90 % se marca en rojo, como en su Excel. Se exporta a Excel.
 *
 *  Lo ven Marco y Oliver: el permiso personal de Objetivos mensuales.
 * ============================================================================
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { hoyEnLima, desplazarDias } from '@/lib/fechas';
import { num, fechaHora, fechaLarga } from '@/lib/formato';
import { gestionDelMes, UMBRAL_ALERTA, type FilaCierre } from '@/lib/cierre';
import { cargarCierre, type Categoria } from '@/lib/cierreDatos';
import { uno } from '@/lib/relaciones';
import { CeldaCierre } from './CeldaCierre';

export const metadata: Metadata = { title: 'Cierre de producción' };
export const dynamic = 'force-dynamic';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CAMPO: Record<string, string> = {
  plan_mp: 'Plan MP', real_mp: 'Real MP', plan_prod: 'Prod. Plan', plan_ventas: 'Plan Ventas',
  real_prod: 'Prod. Real', stock_inicial: 'Stock Real', ventas: 'Ventas',
};

const tn = (v: number | null | undefined) => (v === null || v === undefined ? '' : num(v, 1));
const porc = (v: number | null) => (v === null ? '' : `${num(v * 100, 0)}%`);
/** «(214)» para los negativos, como en el Excel. */
const dif = (v: number | null) => (v === null ? '' : v < 0 ? `(${num(-v, 0)})` : num(v, 0));

export default async function PaginaCierre(props: PageProps<'/produccion/cierre'>) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) redirect('/login');
  if (usuario.ve_objetivos !== true) redirect(`/panel?sinacceso=${encodeURIComponent('/produccion/cierre')}`);

  const q = await props.searchParams;
  const hoy = hoyEnLima();
  const m = /^(\d{4})-(\d{2})$/.exec((q.mes as string) ?? '');
  const anio = m ? Number(m[1]) : Number(hoy.slice(0, 4));
  const mes = m ? Math.min(Math.max(Number(m[2]), 1), 12) : Number(hoy.slice(5, 7));
  const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
  const mover = (n: number) => {
    const t = anio * 12 + (mes - 1) + n;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  };

  /*
   * «Actualizado al» es AYER, como en el Excel (=HOY()-1). En un mes pasado,
   * el último día de ese mes.
   */
  const ultimoDia = `${periodo}-${String(new Date(Date.UTC(anio, mes, 0)).getUTCDate()).padStart(2, '0')}`;
  const ayer = desplazarDias(hoy, -1);
  const actualizado = periodo < hoy.slice(0, 7) ? ultimoDia : ayer;
  //  Un mes ya cerrado se gestionó entero: 100 %.
  const cerrado = periodo < hoy.slice(0, 7);
  const gestion = cerrado ? { transcurridos: gestionDelMes(anio, mes, ultimoDia).total, total: gestionDelMes(anio, mes, ultimoDia).total }
    : gestionDelMes(anio, mes, actualizado);

  const supabase = await crearClienteServidor();
  const [{ filas, total, dias }, { data: historial }] = await Promise.all([
    cargarCierre(supabase, anio, mes),
    supabase.from('cierre_historial')
      .select('id, categoria_id, campo, antes, despues, usuario_nombre, registrado_en, anio, mes, cierre_categorias(nombre)')
      .order('registrado_en', { ascending: false }).order('id', { ascending: false }).limit(25),
  ]);

  /** Una celda de dato: editable si se ingresa, o el número si viene del ERP. */
  const dato = (c: Categoria, f: FilaCierre, campo: keyof FilaCierre) => {
    const delErp = c.especie !== null && ['real_prod', 'stock_inicial', 'ventas'].includes(campo as string);
    if (delErp) {
      return <span title="Del ERP" data-valor={f[campo] ?? ''}>{tn(f[campo] as number | null)}</span>;
    }
    return (
      <CeldaCierre categoriaId={c.id} anio={anio} mes={mes} campo={campo as string}
                   valor={f[campo] as number | null} etiqueta={`${c.nombre} · ${CAMPO[campo as string]}`} />
    );
  };
  const rojo = (v: number | null) => (v !== null && v < UMBRAL_ALERTA ? 'si' : undefined);

  return (
    <>
      <CabeceraPagina
        titulo="Cierre semanal de producción"
        descripcion="Avance del plan del mes: materia prima, producción y ventas contra lo planificado, con la proyección a fin de mes. Lo ven Marco y Oliver."
      >
        <a href={`/api/cierre/excel?mes=${periodo}`} className="btn btn-secundario" data-accion="exportar">
          <Icono nombre="descargar" tamano={15} />
          Exportar a Excel
        </a>
      </CabeceraPagina>

      <div className="costos-periodo">
        <Link href={`/produccion/cierre?mes=${mover(-1)}`} className="btn btn-sutil btn-chico">← {MESES[(mes + 10) % 12]}</Link>
        <strong>{MESES[mes - 1]} {anio}</strong>
        <Link href={`/produccion/cierre?mes=${mover(1)}`} className="btn btn-sutil btn-chico">{MESES[mes % 12]} →</Link>
      </div>

      <Panel titulo="Avance de plan" className="mb-espacio">
        <div className="cierre-cabecera">
          <span>Actualizado al: <strong data-actualizado={actualizado}>{fechaLarga(actualizado)}</strong></span>
          <span>Gestión al: <strong data-gestion>{num((gestion.transcurridos / gestion.total) * 100, 0)}%</strong>
            <small> · {gestion.transcurridos} de {gestion.total} días hábiles</small></span>
          <span><small>Proyección lineal = real ÷ {dias.proyeccion} × {dias.mes}</small></span>
        </div>

        {filas.length === 0 ? (
          <Vacio titulo="Sin categorías" mensaje="No hay categorías configuradas para el cierre." />
        ) : (
          <div className="tabla-envoltorio obj-tabla" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos cierre" data-cuadro="cierre">
              <thead>
                <tr>
                  <th className="obj-nombre">Categoría</th>
                  <th className="num">Plan MP (T)</th>
                  <th className="num">Real MP (T)</th>
                  <th className="num">%Cump</th>
                  <th className="num">Ped/Ent. (T)</th>
                  <th className="num">Prod. Plan (T)</th>
                  <th className="num">Prod. Real (T)</th>
                  <th className="num">%Cump</th>
                  <th className="num">Stock Real (T)</th>
                  <th className="num">Plan Ventas (T)</th>
                  <th className="num">Ventas (T)</th>
                  <th className="num">Proy Lineal Prod. (T)</th>
                  <th className="num">%Cum. Proy Lineal Prod</th>
                  <th className="num">Proy Lineal Ventas (T)</th>
                  <th className="num">% Ventas al día</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(({ categoria: c, fila: f }) => (
                  <tr key={c.id} data-categoria={c.codigo}>
                    <td className="obj-nombre">{c.nombre}{c.especie === null && <small>se ingresa todo</small>}</td>
                    <td className="num">{dato(c, f, 'plan_mp')}</td>
                    <td className="num">{dato(c, f, 'real_mp')}</td>
                    <td className="num" data-col="cump_mp" data-rojo={rojo(f.cump_mp)}>{porc(f.cump_mp)}</td>
                    <td className="num" data-col="dif_mp">{dif(f.dif_mp)}</td>
                    <td className="num">{dato(c, f, 'plan_prod')}</td>
                    <td className="num" data-col="real_prod">{dato(c, f, 'real_prod')}</td>
                    <td className="num" data-col="cump_prod" data-rojo={rojo(f.cump_prod)}>{porc(f.cump_prod)}</td>
                    <td className="num" data-col="stock_inicial">{dato(c, f, 'stock_inicial')}</td>
                    <td className="num">{dato(c, f, 'plan_ventas')}</td>
                    <td className="num" data-col="ventas">{dato(c, f, 'ventas')}</td>
                    <td className="num" data-col="proy_prod">{tn(f.proy_prod)}</td>
                    <td className="num" data-col="cump_proy_prod" data-rojo={rojo(f.cump_proy_prod)}>{porc(f.cump_proy_prod)}</td>
                    <td className="num" data-col="proy_ventas">{tn(f.proy_ventas)}</td>
                    <td className="num" data-col="cump_ventas">{porc(f.cump_ventas)}</td>
                  </tr>
                ))}
                <tr className="cierre-total" data-categoria="total">
                  <td className="obj-nombre"><strong>Total general</strong></td>
                  <td className="num">{tn(total.plan_mp)}</td>
                  <td className="num">{tn(total.real_mp)}</td>
                  <td></td><td></td>
                  <td className="num">{tn(total.plan_prod)}</td>
                  <td className="num">{tn(total.real_prod)}</td>
                  <td></td>
                  <td className="num">{tn(total.stock_inicial)}</td>
                  <td className="num">{tn(total.plan_ventas)}</td>
                  <td className="num">{tn(total.ventas)}</td>
                  <td className="num">{tn(total.proy_prod)}</td>
                  <td></td>
                  <td className="num">{tn(total.proy_ventas)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="pie-explicativo" style={{ padding: '.6rem 1rem .9rem' }}>
          <strong>Al inicio del mes</strong> Marco ingresa Plan MP, Prod. Plan y Plan Ventas (se pueden corregir
          después). <strong>Al final del mes</strong> Oliver ingresa el Real MP. Prod. Real, Stock Real (el del día 1)
          y Ventas (lo despachado a la fecha) de pota y merluza salen del sistema; los de las harinas residuales se
          ingresan. Los porcentajes se marcan en rojo bajo el 90 %. El 20 y el 26 de la proyección se cambian en
          Configuración → Parámetros. Todo cambio queda en el historial.
        </p>
      </Panel>

      <Panel id="historial" titulo="Últimos cambios" className="mb-espacio">
        {(historial ?? []).length === 0 ? (
          <Vacio titulo="Sin cambios" mensaje="Todavía no se ha ingresado ningún dato." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-cuadro="historial">
              <thead><tr><th>Fecha</th><th>Usuario</th><th>Categoría</th><th>Dato</th><th>Mes</th><th className="num">Antes</th><th className="num">Después</th></tr></thead>
              <tbody>
                {(historial ?? []).map((h) => (
                  <tr key={h.id as number}>
                    <td style={{ fontSize: '.74rem', whiteSpace: 'nowrap' }}>{fechaHora(h.registrado_en as string)}</td>
                    <td>{(h.usuario_nombre as string) ?? '—'}</td>
                    <td>{String(uno<Record<string, unknown>>(h.cierre_categorias)?.nombre ?? '')}</td>
                    <td>{CAMPO[h.campo as string] ?? String(h.campo)}</td>
                    <td>{MESES[(h.mes as number) - 1]} {h.anio as number}</td>
                    <td className="num mono">{h.antes === null ? '—' : num(Number(h.antes), 3)}</td>
                    <td className="num mono">{h.despues === null ? 'quitado' : num(Number(h.despues), 3)}</td>
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
