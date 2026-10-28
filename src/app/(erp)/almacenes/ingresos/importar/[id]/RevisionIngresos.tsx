'use client';

/**
 * ============================================================================
 *  REVISIÓN FILA POR FILA · la pantalla de una importación de ingresos
 * ============================================================================
 *  Arriba, las cifras: cuántas filas, cuántas listas, cuántas con error,
 *  cuántas registradas. En la tabla, cada fila con su número de fila del
 *  Excel (para encontrarla en el archivo) y, si tiene error, la columna y el
 *  motivo en palabras.
 *
 *  «Corregir» abre la fila con todas sus columnas: se cambia lo que haga
 *  falta, se guarda, y el servidor la vuelve a revisar con las mismas reglas.
 *  «Descartar» la deja fuera (y se puede restaurar).
 *
 *  Al pie, el botón que toca según quién mira:
 *    · Gerencia u Operaciones: «Validar y registrar N ingresos».
 *    · Almacén: «Dejar lista para validar».
 * ============================================================================
 */
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import {
  COLUMNAS_INGRESO, TITULO_COLUMNA, TEXTO_ESTADO_FILA, TEXTO_ESTADO_IMPORTACION,
  type ErrorColumna, type EstadoFila,
} from '../columnas';
import { corregirFilaIngreso, descartarFilaIngreso, dejarListaParaValidar, validarYRegistrar } from '../acciones';

export type FilaRevision = {
  id: number;
  fila: number;
  datos: Record<string, string>;
  errores: ErrorColumna[];
  estado: EstadoFila;
  resultado: string | null;
  lote_id: number | null;
  programado_id: number | null;
  /** «Llega el» es una fecha futura: se registrará como programado. */
  programar: boolean;
};

type Opciones = {
  productos: string[];
  bodegas: { nombre: string; produccion: boolean; compras: boolean }[];
  camaras: { nombre: string; bodega: string }[];
  plantas: string[];
  lineas: string[];
};

const TONO: Record<EstadoFila, string> = {
  valida: 'pill-ok', con_error: 'pill-critico', descartada: 'pill-neutro', procesando: 'pill-info',
  registrada: 'pill-ok', programada: 'pill-info', fallida: 'pill-critico',
};

type Filtro = 'todas' | 'error' | 'validas' | 'hechas' | 'descartadas';

export function RevisionIngresos({
  importacionId, estado, filas, opciones, puedeValidar, recienSubida,
}: {
  importacionId: number;
  estado: string;
  filas: FilaRevision[];
  opciones: Opciones;
  puedeValidar: boolean;
  recienSubida: boolean;
}) {
  const router = useRouter();
  const [trabajando, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(
    recienSubida ? { ok: true, texto: 'Archivo leído. Revise las filas con error: puede corregirlas aquí mismo o descartarlas.' } : null
  );
  const [filtro, setFiltro] = useState<Filtro>(filas.some((f) => f.estado === 'con_error' || f.estado === 'fallida') ? 'error' : 'todas');
  const [editando, setEditando] = useState<number | null>(null);
  const [progreso, setProgreso] = useState<string | null>(null);

  const c = (...e: EstadoFila[]) => filas.filter((f) => e.includes(f.estado)).length;
  const validas = filas.filter((f) => f.estado === 'valida');
  const nProgramar = validas.filter((f) => f.programar).length;
  const nRegistrar = validas.length - nProgramar;

  const visibles = useMemo(() => filas.filter((f) =>
    filtro === 'todas' ? true
    : filtro === 'error' ? f.estado === 'con_error' || f.estado === 'fallida'
    : filtro === 'validas' ? f.estado === 'valida'
    : filtro === 'hechas' ? f.estado === 'registrada' || f.estado === 'programada' || f.estado === 'procesando'
    : f.estado === 'descartada'), [filas, filtro]);

  function hacer(accion: () => Promise<{ ok: boolean; mensaje: string }>, alTerminar?: () => void) {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(accion);
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) alTerminar?.();
      router.refresh();
    });
  }

  /** Registra por tandas hasta que no quede nada, diciendo cuánto va. */
  function validar() {
    setAviso(null);
    iniciar(async () => {
      let reg = 0, prog = 0, mal = 0, vueltas = 0;
      const total = validas.length;
      setProgreso(`Registrando 0 de ${total}…`);
      while (vueltas++ < 200) {
        const r = await accionSegura(() => validarYRegistrar(importacionId));
        if (!r.ok) { setAviso({ ok: false, texto: r.mensaje }); break; }
        reg += r.registradas; prog += r.programadas; mal += r.fallidas;
        setProgreso(`Registrando ${reg + prog + mal} de ${total}…`);
        if (r.pendientes === 0 || r.procesadas === 0) {
          setAviso({
            ok: mal === 0,
            texto: `Importación validada: ${reg} ingreso${reg === 1 ? '' : 's'} registrado${reg === 1 ? '' : 's'}` +
              (prog ? ` y ${prog} programado${prog === 1 ? '' : 's'}` : '') +
              (mal ? `. ${mal} fila${mal === 1 ? '' : 's'} no se pudo registrar: mire el motivo en la tabla.` : '.') ,
          });
          break;
        }
      }
      setProgreso(null);
      router.refresh();
    });
  }

  const ESTADOS: [Filtro, string, number][] = [
    ['todas', 'Todas', filas.length],
    ['error', 'Con error', c('con_error', 'fallida')],
    ['validas', 'Listas', c('valida')],
    ['hechas', 'Registradas o programadas', c('registrada', 'programada', 'procesando')],
    ['descartadas', 'Descartadas', c('descartada')],
  ];

  return (
    <div data-bloque="revision-importacion" data-estado={estado}>
      <div className="rejilla-kpi">
        {[
          ['Filas leídas', filas.length, 'neutro'],
          ['Listas para registrar', c('valida'), c('valida') ? 'ok' : 'neutro'],
          ['Con error', c('con_error', 'fallida'), c('con_error', 'fallida') ? 'critico' : 'ok'],
          ['Registradas', c('registrada'), 'neutro'],
          ['Programadas', c('programada'), 'neutro'],
        ].map(([t, v, tono]) => (
          <div key={String(t)} className="kpi panel" data-kpi={String(t)}>
            <span className="kpi-valor" data-tono={String(tono)}>{Number(v).toLocaleString('es-PE')}</span>
            <span className="kpi-etiqueta">{String(t)}</span>
          </div>
        ))}
      </div>

      {aviso && (
        <div className={`ficha-aviso ${aviso.ok ? 'ficha-aviso-ok' : 'ficha-aviso-critico'}`} role={aviso.ok ? 'status' : 'alert'}
             data-aviso="importacion" style={{ marginBottom: '1rem' }}>
          <Icono nombre={aviso.ok ? 'calidad' : 'alerta'} tamano={17} />
          <span>{aviso.texto}</span>
        </div>
      )}

      {/* ---------- Lo que toca hacer ---------- */}
      <section className="panel mb-espacio" data-bloque="acciones-importacion">
        <div className="panel-cabecera">
          <span className="panel-titulo">Estado: {TEXTO_ESTADO_IMPORTACION[estado] ?? estado}</span>
        </div>
        <div style={{ padding: '1rem', display: 'flex', gap: '.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {puedeValidar ? (
            <>
              <button type="button" className="btn btn-primario" data-accion="validar-registrar"
                      disabled={trabajando || validas.length === 0} onClick={validar}>
                <Icono nombre="guardar" tamano={15} />
                {progreso ?? (validas.length === 0 ? 'Validar y registrar'
                  : `Validar y registrar ${nRegistrar} ingreso${nRegistrar === 1 ? '' : 's'}` +
                    (nProgramar ? ` y programar ${nProgramar}` : ''))}
              </button>
              <span className="form-pista" style={{ margin: 0 }}>
                {validas.length === 0
                  ? 'No hay filas listas: corrija o descarte las que tienen error.'
                  : 'Se registran solo las filas listas, con las mismas reglas del formulario. Las que tengan error se quedan aquí para corregirlas. ' +
                    (nProgramar ? 'Las que tienen «Llega el» futuro quedan como ingresos programados: no mueven stock hasta confirmar su llegada.' : '')}
              </span>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primario" data-accion="dejar-lista"
                      disabled={trabajando || validas.length === 0 || estado === 'lista'}
                      onClick={() => hacer(() => dejarListaParaValidar(importacionId))}>
                <Icono nombre="guardar" tamano={15} />
                Dejar lista para validar
              </button>
              <span className="form-pista" style={{ margin: 0 }} data-pista="validar">
                {estado === 'lista'
                  ? 'Ya está lista: falta que Gerencia u Operaciones pulse «Validar y registrar». Lo ven en Alertas y en su panel.'
                  : validas.length === 0
                    ? 'No hay filas listas: corrija o descarte las que tienen error.'
                    : `Los ingresos los validan Gerencia u Operaciones. Al dejarla lista se les avisa; el stock entra cuando la validen (${validas.length} fila${validas.length === 1 ? '' : 's'}).`}
              </span>
            </>
          )}
        </div>
      </section>

      {/* ---------- Las filas ---------- */}
      <section className="panel" data-bloque="filas-importacion">
        <nav className="pestanas" aria-label="Filtrar filas" style={{ padding: '.6rem .8rem 0' }}>
          {ESTADOS.map(([k, t, n]) => (
            <button key={k} type="button" className="pestana" data-activa={filtro === k ? 'si' : 'no'} data-filtro={k}
                    onClick={() => setFiltro(k)}>{t} · {n}</button>
          ))}
        </nav>
        <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
          {/*
            Cada fila del Excel es un <tbody> con dos filas de tabla: los datos, y
            debajo, a todo el ancho, lo que pasa con ella (sus errores con la
            columna, o el resultado). Así el motivo se lee entero, sin cortarse
            en una columna angosta del extremo.
          */}
          <table className="datos tabla-importacion">
            <thead>
              <tr>
                <th className="num">Fila</th><th>Estado</th><th>Pallet</th><th style={{ minWidth: '15rem' }}>Producto</th><th>Origen</th>
                <th>Bodega · cámara</th><th className="num">Bultos</th><th className="num">Kg</th>
                <th>F. producción</th><th>Llega el</th><th></th>
              </tr>
            </thead>
            {visibles.length === 0 && (
              <tbody>
                <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--tinta-3)', padding: '1.2rem' }}>No hay filas en este grupo.</td></tr>
              </tbody>
            )}
            {visibles.map((f) => editando === f.id ? (
              <tbody key={f.id} data-fila={f.fila} data-editando="si">
                <tr>
                  <td colSpan={11} style={{ padding: 0 }}>
                    <EditorFila
                      fila={f} opciones={opciones} guardando={trabajando}
                      alCancelar={() => setEditando(null)}
                      alGuardar={(v) => hacer(() => corregirFilaIngreso(f.id, v), () => setEditando(null))}
                    />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody key={f.id} data-fila={f.fila} data-estado={f.estado}>
                <tr>
                  <td className="num mono">{f.fila}</td>
                  <td><span className={`pill ${TONO[f.estado]}`}>{f.estado === 'valida' && f.programar ? 'Lista · programada' : TEXTO_ESTADO_FILA[f.estado]}</span></td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{f.datos.codigo_pallet || '—'}</td>
                  <td style={{ fontSize: '.76rem' }}>{f.datos.producto || '—'}</td>
                  <td style={{ fontSize: '.78rem' }}>{f.datos.origen || '—'}{f.datos.proveedor ? <><br /><small style={{ color: 'var(--tinta-3)' }}>{f.datos.proveedor}</small></> : null}</td>
                  <td style={{ fontSize: '.78rem' }}>{f.datos.bodega || '—'}{f.datos.camara ? ` · ${f.datos.camara}` : ''}</td>
                  <td className="num">{f.datos.bultos || '—'}</td>
                  <td className="num">{f.datos.peso_kg || (f.datos.kg_bulto ? `${f.datos.kg_bulto}/bulto` : '—')}</td>
                  <td>{f.datos.fecha_produccion || '—'}</td>
                  <td>{f.datos.llega_el || '—'}</td>
                  <td>
                    {['valida', 'con_error', 'fallida'].includes(f.estado) && (
                      <span style={{ display: 'inline-flex', gap: '.3rem', flexWrap: 'nowrap' }}>
                        <button type="button" className="btn btn-sutil btn-chico" data-accion="corregir-fila" disabled={trabajando}
                                onClick={() => { setEditando(f.id); setAviso(null); }}>
                          <Icono nombre="editar" tamano={13} /> Corregir
                        </button>
                        <button type="button" className="btn btn-sutil btn-chico" data-accion="descartar-fila" disabled={trabajando}
                                onClick={() => hacer(() => descartarFilaIngreso(f.id, true))}>Descartar</button>
                      </span>
                    )}
                    {f.estado === 'descartada' && (
                      <button type="button" className="btn btn-sutil btn-chico" data-accion="restaurar-fila" disabled={trabajando}
                              onClick={() => hacer(() => descartarFilaIngreso(f.id, false))}>Restaurar</button>
                    )}
                  </td>
                </tr>
                <tr className="fila-detalle">
                  <td></td>
                  <td colSpan={10} style={{ fontSize: '.78rem', paddingTop: 0, whiteSpace: 'normal' }} data-detalle="fila">
                    {f.errores.length > 0 && (f.estado === 'con_error' || f.estado === 'fallida') ? (
                      <ul style={{ margin: 0, paddingLeft: '1rem', color: 'var(--critico)' }}>
                        {f.errores.map((e, i) => (
                          <li key={i} data-columna={e.columna}><b>{TITULO_COLUMNA[e.columna] ?? e.columna}:</b> {e.mensaje}</li>
                        ))}
                      </ul>
                    ) : null}
                    {f.resultado && (
                      <span style={{ color: f.estado === 'fallida' || f.estado === 'con_error' ? 'var(--critico)' : 'var(--tinta-2)' }}>
                        {f.resultado}{' '}
                      </span>
                    )}
                    {f.lote_id && (
                      <Link href={`/almacenes/lotes/${f.lote_id}`} className="enlace-dato" data-enlace="pallet">Ver el pallet</Link>
                    )}
                    {f.programado_id && (
                      <Link href="/almacenes/ingresos/programados" className="enlace-dato" data-enlace="programado">Ver en ingresos programados</Link>
                    )}
                    {f.estado === 'valida' && !f.resultado && (
                      <span style={{ color: 'var(--ok)' }}>
                        {f.programar ? 'Bien. Quedará como ingreso programado: no mueve stock hasta confirmar su llegada.' : 'Bien. Lista para registrar.'}
                      </span>
                    )}
                    {f.estado === 'descartada' && <span style={{ color: 'var(--tinta-3)' }}>Descartada: no se registrará.</span>}
                  </td>
                </tr>
              </tbody>
            ))}
          </table>
        </div>
        <style jsx>{`
          .tabla-importacion :global(tbody > tr:first-child > td) { border-bottom: none; }
          .tabla-importacion :global(tr.fila-detalle > td) { padding-bottom: .7rem; }
        `}</style>
        <p className="pie-explicativo" style={{ padding: '.6rem 1rem 1rem', margin: 0 }}>
          ¿Muchas filas con el mismo error? También puede corregir el Excel y volver a subirlo desde «Importar desde Excel»:
          queda como otra importación y esta se conserva tal como está.
        </p>
      </section>
    </div>
  );
}

/* ==========================================================================
   CORREGIR UNA FILA
   ========================================================================== */
function EditorFila({
  fila, opciones, guardando, alGuardar, alCancelar,
}: {
  fila: FilaRevision; opciones: Opciones; guardando: boolean;
  alGuardar: (v: Record<string, string>) => void; alCancelar: () => void;
}) {
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(COLUMNAS_INGRESO.map((c) => [c.clave, fila.datos[c.clave] ?? ''])));
  const conError = new Map(fila.errores.map((e) => [e.columna, e.mensaje]));
  const cambiar = (k: string, x: string) => setV((p) => ({ ...p, [k]: x }));

  const o = v.origen.toLowerCase();
  const bodegas = opciones.bodegas.filter((b) =>
    o.startsWith('produc') ? b.produccion : o.startsWith('compr') ? b.compras : b.produccion || b.compras);
  const camaras = opciones.camaras.filter((c) => c.bodega === v.bodega);

  /** Un desplegable que conserva el valor actual aunque no esté en la lista: así se ve qué venía mal. */
  const elegir = (k: string, lista: string[], vacio = 'Sin especificar') => (
    <select className="campo" name={k} value={v[k]} data-error={conError.has(k) ? 'si' : undefined}
            onChange={(e) => cambiar(k, e.target.value)}>
      <option value="">{vacio}</option>
      {v[k] && !lista.includes(v[k]) && <option value={v[k]}>{v[k]} (no reconocido)</option>}
      {lista.map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  );

  const control = (k: string) => {
    switch (k) {
      case 'producto': return elegir(k, opciones.productos, 'Elija el producto…');
      case 'origen': return elegir(k, ['Producción', 'Compras'], 'Elija…');
      case 'bodega': return elegir(k, bodegas.map((b) => b.nombre), 'Elija la bodega…');
      case 'camara': return elegir(k, camaras.map((c) => c.nombre));
      case 'turno': return elegir(k, ['Día', 'Noche'], 'Día');
      case 'proceso': return elegir(k, ['Producción propia', 'Maquila'], 'Producción propia');
      case 'planta': return elegir(k, opciones.plantas);
      case 'linea': return elegir(k, opciones.lineas);
      default:
        return (
          <input className={`campo${['codigo_pallet', 'bultos', 'peso_kg', 'kg_bulto', 'costo'].includes(k) ? ' mono' : ''}`}
                 name={k} value={v[k]} data-error={conError.has(k) ? 'si' : undefined}
                 placeholder={k === 'fecha_produccion' || k === 'llega_el' ? 'DD/MM/AAAA' : undefined}
                 onChange={(e) => cambiar(k, e.target.value)} />
        );
    }
  };

  return (
    <div data-bloque="editor-fila" style={{ padding: '1rem', background: 'var(--superficie-2)' }}>
      <strong>Corregir la fila {fila.fila}</strong>
      <div className="form-rejilla" style={{ padding: 0, marginTop: '.6rem' }}>
        {COLUMNAS_INGRESO.map((c) => (
          <label key={c.clave} className={`form-campo${c.clave === 'producto' || c.clave === 'observaciones' ? ' form-campo-ancho' : ''}`}>
            <span>{c.titulo}{c.obligatoria && <b className="req"> *</b>}</span>
            {control(c.clave)}
            {conError.has(c.clave) && <small style={{ color: 'var(--critico)' }} data-error-columna={c.clave}>{conError.get(c.clave)}</small>}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '.6rem', marginTop: '.9rem' }}>
        <button type="button" className="btn btn-primario" disabled={guardando} data-accion="guardar-fila" onClick={() => alGuardar(v)}>
          {guardando ? 'Revisando…' : 'Guardar y volver a revisar'}
        </button>
        <button type="button" className="btn btn-sutil" disabled={guardando} onClick={alCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
