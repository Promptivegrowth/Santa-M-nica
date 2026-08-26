/**
 * ============================================================================
 *  PANEL PRINCIPAL · "Control Tower"
 * ============================================================================
 *  La primera pantalla del día. Está organizada para responder, en este orden,
 *  las tres preguntas que plantea la especificación del cliente:
 *
 *    NIVEL 1 · ¿Qué ocurrió?      → los indicadores de arriba
 *    NIVEL 2 · ¿Qué problema tengo? → alertas, pedidos en riesgo, bloqueos
 *    NIVEL 3 · ¿Qué debo hacer?   → los accesos directos a cada acción
 *
 *  Todo se calcula en el servidor. El navegador recibe los datos ya resumidos,
 *  no miles de filas para sumar.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { PanelGraficos } from './PanelGraficos';
import { tm, dinero, num, fecha, haceTiempo } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Control Tower' };

// Los datos cambian con cada operación: no tiene sentido cachear esta pantalla.
export const dynamic = 'force-dynamic';

export default async function PaginaPanel() {
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;
  const puedeVerCostos = veCostos(rol);

  // Todas las consultas salen a la vez: así la pantalla tarda lo que tarda la
  // más lenta, y no la suma de todas.
  const [
    { data: inventario },
    { data: kpi },
    { data: ocupabilidad },
    { data: mensual },
    { data: anticuamiento },
    { data: alertas },
    { data: pedidosRiesgo },
    { data: topClientes },
  ] = await Promise.all([
    supabase.from('v_resumen_inventario').select('*').single(),
    supabase.from('v_kpi_ventas').select('*').single(),
    supabase.from('v_ocupabilidad').select('*').order('ocupado_tm', { ascending: false }),
    supabase.from('v_movimiento_mensual').select('*').order('mes'),
    // Usamos la vista RESUMIDA: la detallada trae una fila por lote y la API
    // corta en 1.000 filas, lo que daría un total incompleto.
    supabase.from('v_anticuamiento_resumen').select('*').order('orden'),
    supabase.from('alertas').select('id, severidad, titulo, mensaje, entidad, entidad_id, generada_en')
      .eq('atendida', false).order('severidad', { ascending: false })
      .order('generada_en', { ascending: false }).limit(8),
    supabase.from('v_pedidos_tablero').select('id, numero_proforma, cliente, venta, moneda, tm_pedidas, tm_faltantes, fecha_comprometida, semaforo, prioridad')
      .in('semaforo', ['riesgo', 'bloqueado']).order('fecha_comprometida').limit(8),
    supabase.from('v_rentabilidad_pedido').select('cliente, venta').in('ciclo', ['despachado', 'cerrado']),
  ]);

  /* ---- Agregaciones ligeras que no justifican una vista propia ---- */

  // Anticuamiento: los cuatro rangos ya vienen sumados desde la base de datos
  const NOMBRE_RANGO: Record<string, string> = {
    '<12': 'Menos de 12 meses',
    '12-18': '12 a 18 meses',
    '18-24': '18 a 24 meses',
    '>24': 'Más de 24 meses',
  };
  const porRango = (anticuamiento ?? []).map((a) => ({
    nombre: NOMBRE_RANGO[a.rango as string] ?? (a.rango as string),
    valor: Number(a.fisico_kg ?? 0),
  }));
  // Todo lo que pasó el primer rango está por encima del umbral de alerta
  const tmSobreUmbral = (anticuamiento ?? [])
    .filter((a) => a.rango !== '<12')
    .reduce((s, a) => s + Number(a.fisico_kg ?? 0), 0);

  // Top 8 clientes por venta despachada
  const ventaPorCliente = new Map<string, number>();
  for (const r of topClientes ?? []) {
    ventaPorCliente.set(r.cliente, (ventaPorCliente.get(r.cliente) ?? 0) + Number(r.venta ?? 0));
  }
  const top = [...ventaPorCliente.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([nombre, valor]) => ({ etiqueta: nombre.length > 26 ? nombre.slice(0, 25) + '…' : nombre, valor }));

  const inv = inventario ?? { fisico_kg: 0, disponible_kg: 0, reservado_kg: 0, bloqueado_kg: 0, preparacion_kg: 0, valor_total: 0, lotes: 0 };
  const k = kpi ?? { venta_comprometida: 0, venta_mes: 0, backlog: 0, pedidos_abiertos: 0, pedidos_en_riesgo: 0, pedidos_atrasados: 0, pedidos_urgentes: 0, margen_pct: 0, venta_en_riesgo: 0, pedidos_bloqueados: 0 };

  return (
    <>
      <CabeceraPagina
        titulo={`Buen día, ${usuario?.nombre.split(' ')[0] ?? ''}`}
        descripcion="Estado de la operación al día de hoy. Lo que necesita su atención está marcado en color."
      >
        <Link href="/alertas" className="btn btn-secundario">Ver todas las alertas</Link>
      </CabeceraPagina>

      {/* ══════ NIVEL 1 · ¿Qué ocurrió? ══════ */}
      <RejillaKpi>
        <Kpi
          etiqueta="Stock físico"
          valor={tm(inv.fisico_kg)}
          sufijo="TM"
          nota={`${num(inv.lotes)} lotes en cámara`}
          href="/almacenes/existencias"
        />
        <Kpi
          etiqueta="Disponible para vender"
          valor={tm(inv.disponible_kg)}
          sufijo="TM"
          tono="ok"
          nota="Descontando reservas y bloqueos"
          href="/ventas/disponibilidad"
        />
        <Kpi
          etiqueta="Reservado"
          valor={tm(Number(inv.reservado_kg) + Number(inv.preparacion_kg))}
          sufijo="TM"
          nota="Apartado para pedidos"
          href="/almacenes/existencias"
        />
        <Kpi
          etiqueta="Bloqueado por calidad"
          valor={tm(inv.bloqueado_kg)}
          sufijo="TM"
          tono={Number(inv.bloqueado_kg) > 0 ? 'critico' : 'neutro'}
          nota="No se puede comprometer"
          href="/almacenes/calidad"
        />
        {puedeVerCostos && (
          <Kpi
            etiqueta="Valor del inventario"
            valor={dinero(inv.valor_total, 'USD', 0)}
            tono="marca"
            nota="A costo promedio"
            href="/almacenes/valorizado"
          />
        )}
        <Kpi
          etiqueta="Venta comprometida"
          valor={dinero(k.venta_comprometida, 'USD', 0)}
          nota={`${num(k.pedidos_abiertos)} pedidos abiertos`}
          href="/ventas/pedidos"
        />
      </RejillaKpi>

      {/* ══════ NIVEL 2 · ¿Qué problema tengo? ══════ */}
      <div className="rejilla-3" style={{ marginBottom: '.85rem' }}>
        <Kpi
          etiqueta="Pedidos en riesgo"
          valor={num(k.pedidos_en_riesgo)}
          tono={Number(k.pedidos_en_riesgo) > 0 ? 'atencion' : 'ok'}
          nota={`${dinero(k.venta_en_riesgo, 'USD', 0)} en juego`}
          href="/ventas/control"
        />
        <Kpi
          etiqueta="Pedidos atrasados"
          valor={num(k.pedidos_atrasados)}
          tono={Number(k.pedidos_atrasados) > 0 ? 'critico' : 'ok'}
          nota="Pasaron su fecha comprometida"
          href="/ventas/control"
        />
        <Kpi
          etiqueta="Stock sobre el umbral de antigüedad"
          valor={tm(tmSobreUmbral)}
          sufijo="TM"
          tono={tmSobreUmbral > 0 ? 'atencion' : 'ok'}
          nota="Más de 12 meses en cámara"
          href="/almacenes/anticuamiento"
        />
      </div>

      {/* ══════ Gráficos ══════ */}
      <PanelGraficos
        mensual={(mensual ?? []).map((m) => ({
          periodo: m.periodo as string,
          ingresos: Number(m.ingresos_tm ?? 0),
          despachos: Number(m.despachos_tm ?? 0),
        }))}
        composicion={[
          { nombre: 'Disponible', valor: Number(inv.disponible_kg) },
          { nombre: 'Reservado', valor: Number(inv.reservado_kg) + Number(inv.preparacion_kg) },
          { nombre: 'Bloqueado', valor: Number(inv.bloqueado_kg) },
        ]}
        anticuamiento={porRango}
        ocupabilidad={(ocupabilidad ?? []).map((o) => ({
          almacen: o.almacen as string,
          pct: Number(o.ocupabilidad_pct ?? 0),
          ocupado: Number(o.ocupado_tm ?? 0),
          capacidad: Number(o.capacidad_tm ?? 0),
        }))}
        topClientes={top}
        mostrarVenta={puedeVerCostos}
      />

      {/* ══════ NIVEL 3 · ¿Qué debo hacer? ══════ */}
      <div className="rejilla-2" style={{ marginTop: '.85rem' }}>
        <Panel titulo="Necesita atención" acciones={<Link href="/alertas" className="btn btn-sutil">Ver todas</Link>}>
          {(alertas ?? []).length === 0 ? (
            <Vacio titulo="Todo en orden" mensaje="No hay alertas pendientes en este momento." />
          ) : (
            <ul className="lista-alertas">
              {(alertas ?? []).map((a) => (
                <li key={a.id}>
                  <Etiqueta
                    texto={a.severidad === 'critica' ? 'Crítica' : a.severidad === 'advertencia' ? 'Atención' : 'Info'}
                    tono={a.severidad === 'critica' ? 'critico' : a.severidad === 'advertencia' ? 'atencion' : 'info'}
                  />
                  <div className="lista-alertas-texto">
                    <strong>{a.titulo}</strong>
                    <span>{a.mensaje}</span>
                  </div>
                  <time>{haceTiempo(a.generada_en as string)}</time>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel titulo="Pedidos que requieren decisión" acciones={<Link href="/ventas/control" className="btn btn-sutil">Ver control</Link>}>
          {(pedidosRiesgo ?? []).length === 0 ? (
            <Vacio titulo="Sin pedidos en riesgo" mensaje="Ningún pedido está bloqueado ni atrasado." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none' }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Proforma</th><th>Cliente</th>
                    <th className="num">Falta</th><th>Compromiso</th><th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {(pedidosRiesgo ?? []).map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/ventas/pedidos/${p.id}`} className="enlace-dato">
                          {p.numero_proforma}
                        </Link>
                      </td>
                      <td title={p.cliente as string}>
                        {(p.cliente as string).length > 22 ? (p.cliente as string).slice(0, 21) + '…' : p.cliente}
                      </td>
                      <td className="num">{num(p.tm_faltantes, 1)} TM</td>
                      <td className="mono">{fecha(p.fecha_comprometida as string)}</td>
                      <td>
                        <Etiqueta
                          texto={p.semaforo === 'bloqueado' ? 'Bloqueado' : 'En riesgo'}
                          tono={p.semaforo === 'bloqueado' ? 'critico' : 'atencion'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
