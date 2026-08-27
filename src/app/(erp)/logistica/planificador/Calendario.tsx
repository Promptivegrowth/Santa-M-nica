'use client';

/**
 * ============================================================================
 *  CALENDARIO DE EMBARQUES · la agenda de salidas, mes a mes
 * ============================================================================
 *  POR QUÉ UN CALENDARIO Y NO UNA LISTA
 *  Una lista contesta «qué sale el martes». Un calendario contesta algo que la
 *  lista no puede: «cómo está repartida la carga del mes». Y esa es la
 *  pregunta que importa aquí, porque el cuello de botella no es un embarque
 *  suelto, es el día en que coinciden cinco. Cuatro bodegas despachando a la
 *  vez ya es el límite práctico; la quinta se ve de un golpe en la cuadrícula
 *  y no leyendo cuarenta renglones.
 *
 *  REPARTO DE TRABAJO ENTRE SERVIDOR Y NAVEGADOR
 *  · Cambiar de mes va por la dirección web: el servidor trae los embarques
 *    de ese mes. Así el enlace se puede compartir y el botón «atrás» funciona.
 *  · Elegir un día es instantáneo, aquí en el navegador: los datos del mes ya
 *    están cargados y no hay nada que pedir.
 *
 *  ACCESIBILIDAD
 *  La cuadrícula es una tabla de verdad, con encabezados de columna, y cada
 *  día es un botón alcanzable con el tabulador y con las flechas del teclado.
 *  Un planificador se usa mucho y con prisa; obligar a apuntar con el ratón a
 *  celdas de treinta píxeles sería castigar a quien lo usa todos los días.
 * ============================================================================
 */
import { useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Icono } from '@/components/estructura/Icono';

export type EmbarqueCalendario = {
  id: number;
  numero: string;
  dia: string;               // 'AAAA-MM-DD'
  estado: string;
  almacen: string;
  destino: string;
  pais: string;
  cliente: string | null;
  contenedor: string | null;
  booking: string | null;
  naviera: string | null;
  tm: number;
  bultos: number;
  /** true si las TM salen del packing real; false si son las comprometidas. */
  cargaReal: boolean;
  pedidos: number;
};

const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Estados de embarque, con el color con que se pintan en la cuadrícula. */
const ESTADOS: Record<string, { texto: string; tono: string }> = {
  planificado:    { texto: 'Planificado',    tono: 'neutro' },
  confirmado:     { texto: 'Confirmado',     tono: 'info' },
  en_preparacion: { texto: 'En preparación', tono: 'atencion' },
  despachado:     { texto: 'Despachado',     tono: 'ok' },
  cancelado:      { texto: 'Cancelado',      tono: 'critico' },
};

/**
 * Construye la retícula del mes: siempre semanas completas de lunes a domingo,
 * rellenando con los días del mes anterior y del siguiente.
 *
 * Se trabaja con cadenas 'AAAA-MM-DD' y no con objetos Date en horas locales:
 * un embarque programado para el 1 de agosto tiene que caer en el 1 de agosto
 * lo mire quien lo mire, y `new Date('2026-08-01')` en un navegador al oeste
 * de Greenwich devuelve el 31 de julio.
 */
function retriculaDelMes(anio: number, mes: number): string[] {
  // Se usa UTC para la aritmética, que no tiene horario de verano ni husos.
  const primero = new Date(Date.UTC(anio, mes, 1));
  // getUTCDay(): 0 = domingo. Se convierte a 0 = lunes.
  const desplazamiento = (primero.getUTCDay() + 6) % 7;
  const inicio = new Date(Date.UTC(anio, mes, 1 - desplazamiento));

  const dias: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicio.getTime() + i * 86400000);
    dias.push(d.toISOString().slice(0, 10));
    // Seis semanas solo si hacen falta: con cinco ya cerró el mes, se corta.
    if (i >= 34 && (i + 1) % 7 === 0) {
      const siguiente = new Date(inicio.getTime() + (i + 1) * 86400000);
      if (siguiente.getUTCMonth() !== mes) break;
    }
  }
  return dias;
}

export function CalendarioEmbarques({
  embarques,
  anio,
  mes,                 // 0-11
  hoy,
  topeSimultaneo,
  recargoDomingo,
}: {
  embarques: EmbarqueCalendario[];
  anio: number;
  mes: number;
  hoy: string;
  topeSimultaneo: number;
  recargoDomingo: number;
}) {
  const dias = useMemo(() => retriculaDelMes(anio, mes), [anio, mes]);

  /** Los embarques de cada día, indexados para no recorrer la lista 42 veces. */
  const porDia = useMemo(() => {
    const mapa = new Map<string, EmbarqueCalendario[]>();
    for (const e of embarques) {
      if (!mapa.has(e.dia)) mapa.set(e.dia, []);
      mapa.get(e.dia)!.push(e);
    }
    return mapa;
  }, [embarques]);

  /*
   * El día elegido arranca en el primero que tenga algo: abrir el calendario
   * con el panel de detalle vacío obliga a un clic antes de ver nada útil.
   */
  const primeroConCarga = dias.find((d) => porDia.has(d)) ?? dias[0];
  const [elegido, setElegido] = useState<string>(
    porDia.has(hoy) ? hoy : primeroConCarga
  );

  const celdas = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  /** Mueve el foco con las flechas, como se espera de una cuadrícula. */
  function teclado(evento: React.KeyboardEvent, dia: string) {
    const salto: Record<string, number> = {
      ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7,
    };
    const paso = salto[evento.key];
    if (paso === undefined) return;

    const i = dias.indexOf(dia);
    const destino = dias[i + paso];
    if (!destino) return;

    evento.preventDefault();
    setElegido(destino);
    celdas.current.get(destino)?.focus();
  }

  const delDia = porDia.get(elegido) ?? [];
  const fechaElegida = new Date(elegido + 'T12:00:00Z');
  const diaSemanaElegido = (fechaElegida.getUTCDay() + 6) % 7;

  /* Navegación de mes: se calcula aquí para no repetir la aritmética. */
  const anterior = mes === 0 ? `${anio - 1}-12` : `${anio}-${String(mes).padStart(2, '0')}`;
  const siguiente = mes === 11 ? `${anio + 1}-01` : `${anio}-${String(mes + 2).padStart(2, '0')}`;

  return (
    <div className="cal">
      {/* ---------------- Cabecera: mes y navegación ---------------- */}
      <div className="cal-barra">
        <div className="cal-mes">
          <strong>{MESES[mes]}</strong>
          <span className="mono">{anio}</span>
        </div>
        <div className="cal-navegacion">
          <Link href={`/logistica/planificador?mes=${anterior}`} className="btn btn-sutil"
                aria-label="Mes anterior" scroll={false}>
            <Icono nombre="volver" tamano={15} />
          </Link>
          <Link href="/logistica/planificador" className="btn btn-sutil" scroll={false}>Hoy</Link>
          <Link href={`/logistica/planificador?mes=${siguiente}`} className="btn btn-sutil"
                aria-label="Mes siguiente" scroll={false}>
            <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
              <Icono nombre="volver" tamano={15} />
            </span>
          </Link>
        </div>
        <div className="cal-leyenda">
          {Object.entries(ESTADOS).map(([clave, e]) => (
            <span key={clave} className="cal-leyenda-item">
              <i data-tono={e.tono} /> {e.texto}
            </span>
          ))}
        </div>
      </div>

      <div className="cal-cuerpo">
        {/* ---------------- La cuadrícula ---------------- */}
        <table className="cal-rejilla">
          <caption className="sr-solo">
            Calendario de embarques de {MESES[mes]} de {anio}. Use las flechas para moverse
            entre días y Entrar para ver el detalle.
          </caption>
          <thead>
            <tr>
              {DIAS_CORTOS.map((d, i) => (
                <th key={d} scope="col" data-domingo={i === 6 ? 'si' : 'no'}>
                  <abbr title={DIAS_LARGOS[i]}>{d}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.ceil(dias.length / 7) }, (_, semana) => (
              <tr key={semana}>
                {dias.slice(semana * 7, semana * 7 + 7).map((dia) => {
                  const lista = porDia.get(dia) ?? [];
                  const delMes = Number(dia.slice(5, 7)) === mes + 1;
                  const esDomingo = (new Date(dia + 'T12:00:00Z').getUTCDay() + 6) % 7 === 6;
                  const bodegas = new Set(lista.map((e) => e.almacen)).size;
                  const sobrecarga = bodegas > topeSimultaneo;
                  const tmDia = lista.reduce((s, e) => s + e.tm, 0);

                  return (
                    <td key={dia}>
                      <button
                        type="button"
                        ref={(n) => { celdas.current.set(dia, n); }}
                        className="cal-dia"
                        data-fuera={delMes ? 'no' : 'si'}
                        data-hoy={dia === hoy ? 'si' : 'no'}
                        data-elegido={dia === elegido ? 'si' : 'no'}
                        data-domingo={esDomingo ? 'si' : 'no'}
                        data-sobrecarga={sobrecarga ? 'si' : 'no'}
                        // Solo el día activo entra en el orden del tabulador: así
                        // se sale del calendario con un tabulador, no con 42.
                        tabIndex={dia === elegido ? 0 : -1}
                        onClick={() => setElegido(dia)}
                        onKeyDown={(ev) => teclado(ev, dia)}
                        aria-pressed={dia === elegido}
                        aria-label={
                          `${Number(dia.slice(8, 10))} de ${MESES[Number(dia.slice(5, 7)) - 1]}` +
                          (lista.length
                            ? `: ${lista.length} embarque${lista.length === 1 ? '' : 's'}, ${tmDia.toFixed(1)} toneladas` +
                              (sobrecarga ? `, ${bodegas} bodegas a la vez, por encima del tope` : '')
                            : ': sin embarques')
                        }
                      >
                        <span className="cal-numero">
                          {Number(dia.slice(8, 10))}
                          {esDomingo && lista.length > 0 && (
                            <i className="cal-recargo" title={`Domingo: recargo del ${recargoDomingo} %`}>
                              +{recargoDomingo}%
                            </i>
                          )}
                        </span>

                        {lista.length > 0 && (
                          <span className="cal-fichas">
                            {/* Se muestran hasta tres; el resto se resume. Con
                                más de tres, la celda deja de ser legible. */}
                            {lista.slice(0, 3).map((e) => (
                              <span key={e.id} className="cal-ficha"
                                    data-tono={ESTADOS[e.estado]?.tono ?? 'neutro'}>
                                <span className="cal-ficha-destino">{e.destino}</span>
                                <span className="cal-ficha-tm">
                                  {e.tm > 0 ? e.tm.toFixed(1) : '—'}
                                  {e.tm > 0 && !e.cargaReal && <i className="cal-previsto">*</i>}
                                </span>
                              </span>
                            ))}
                            {lista.length > 3 && (
                              <span className="cal-mas">+{lista.length - 3} más</span>
                            )}
                          </span>
                        )}

                        {sobrecarga && (
                          <span className="cal-alerta" title={`${bodegas} bodegas despachando a la vez`}>
                            <Icono nombre="alerta" tamano={11} />
                            {bodegas}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {/* ---------------- Panel del día elegido ---------------- */}
        <aside className="cal-detalle" aria-live="polite">
          <div className="cal-detalle-cabecera">
            <div>
              <strong>{DIAS_LARGOS[diaSemanaElegido]}</strong>
              <span className="mono">
                {Number(elegido.slice(8, 10))} de {MESES[Number(elegido.slice(5, 7)) - 1]}
              </span>
            </div>
            {elegido === hoy && <span className="cal-etiqueta-hoy">Hoy</span>}
          </div>

          {diaSemanaElegido === 6 && delDia.length > 0 && (
            <p className="cal-nota cal-nota-atencion">
              Es domingo: estas salidas llevan un recargo del {recargoDomingo} %.
            </p>
          )}

          {(() => {
            const bodegas = new Set(delDia.map((e) => e.almacen)).size;
            if (bodegas <= topeSimultaneo) return null;
            return (
              <p className="cal-nota cal-nota-critica">
                {bodegas} bodegas despachando a la vez, y el tope operativo está en{' '}
                {topeSimultaneo}. Conviene mover algún embarque de día.
              </p>
            );
          })()}

          {delDia.length === 0 ? (
            <p className="cal-vacio">
              No hay salidas programadas este día. Elija otro en el calendario, o revise la{' '}
              <Link href="/logistica/embarques">lista completa de embarques</Link>.
            </p>
          ) : (
            <>
              <div className="cal-resumen">
                <span>
                  <b>{delDia.length}</b> embarque{delDia.length === 1 ? '' : 's'}
                </span>
                <span>
                  <b>{delDia.reduce((s, e) => s + e.tm, 0).toFixed(1)}</b> TM
                </span>
                <span>
                  <b>{delDia.reduce((s, e) => s + e.bultos, 0).toLocaleString('es-PE')}</b> bultos
                </span>
                {delDia.some((e) => !e.cargaReal) && (
                  <span className="cal-resumen-nota">
                    * incluye carga prevista, todavía sin packing
                  </span>
                )}
              </div>

              <ul className="cal-tarjetas">
                {delDia.map((e) => (
                  <li key={e.id} className="cal-tarjeta" data-tono={ESTADOS[e.estado]?.tono ?? 'neutro'}>
                    <div className="cal-tarjeta-alta">
                      <Link href={`/logistica/embarques?buscar=${e.numero}`} className="mono">
                        {e.numero}
                      </Link>
                      <span className="cal-estado" data-tono={ESTADOS[e.estado]?.tono ?? 'neutro'}>
                        {ESTADOS[e.estado]?.texto ?? e.estado}
                      </span>
                    </div>
                    <div className="cal-tarjeta-ruta">
                      {e.almacen} <span aria-hidden="true">→</span> {e.destino}
                      {e.pais ? `, ${e.pais}` : ''}
                    </div>
                    {e.cliente && <div className="cal-tarjeta-cliente">{e.cliente}</div>}
                    {!e.cargaReal && (
                      <p className="cal-tarjeta-nota">
                        {e.pedidos === 0
                          ? 'Todavía no tiene pedidos asignados.'
                          : 'Sin packing cargado: la cifra es la comprometida en el pedido.'}
                      </p>
                    )}
                    <dl className="cal-tarjeta-datos">
                      <div>
                        <dt>{e.cargaReal ? 'Carga real' : 'Carga prevista'}</dt>
                        <dd>{e.tm > 0 ? `${e.tm.toFixed(2)} TM` : 'sin asignar'}</dd>
                      </div>
                      <div>
                        <dt>Bultos</dt>
                        <dd>{e.cargaReal ? e.bultos.toLocaleString('es-PE') : '—'}</dd>
                      </div>
                      {e.contenedor && <div><dt>Contenedor</dt><dd className="mono">{e.contenedor}</dd></div>}
                      {e.booking && <div><dt>Booking</dt><dd className="mono">{e.booking}</dd></div>}
                      {e.naviera && <div><dt>Naviera</dt><dd>{e.naviera}</dd></div>}
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
