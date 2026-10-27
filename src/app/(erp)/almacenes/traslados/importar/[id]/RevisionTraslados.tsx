'use client';

/**
 * ============================================================================
 *  REVISIÓN FILA POR FILA · importación de traslados
 * ============================================================================
 *  Misma pantalla que la de ingresos: cifras arriba, cada fila con su número
 *  de fila del Excel y, si no se puede mover, la columna y el motivo. Se
 *  corrige o se descarta aquí mismo. Al pie, «Crear N traslados en
 *  borrador»: se agrupan por bodega de origen → destino (y fecha).
 * ============================================================================
 */
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import { TEXTO_ESTADO_FILA, type ErrorColumna, type EstadoFila } from '../../../ingresos/importar/columnas';
import { COLUMNAS_TRASLADO, TITULO_COLUMNA_TRASLADO } from '../columnas';
import { corregirFilaTraslado, descartarFilaTraslado, crearTrasladosImportados } from '../acciones';

export type FilaRevisionT = {
  id: number; fila: number; datos: Record<string, string>; errores: ErrorColumna[]; estado: EstadoFila;
  resultado: string | null; traslado_id: number | null; traslado: string | null;
};

const TONO: Record<EstadoFila, string> = {
  valida: 'pill-ok', con_error: 'pill-critico', descartada: 'pill-neutro', procesando: 'pill-info',
  registrada: 'pill-ok', programada: 'pill-info', fallida: 'pill-critico',
};

type Filtro = 'todas' | 'error' | 'validas' | 'hechas' | 'descartadas';

export function RevisionTraslados({
  importacionId, filas, bodegas, recienSubida,
}: { importacionId: number; filas: FilaRevisionT[]; bodegas: string[]; recienSubida: boolean }) {
  const router = useRouter();
  const [trabajando, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(
    recienSubida ? { ok: true, texto: 'Archivo leído. Revise las filas con error: puede corregirlas aquí mismo o descartarlas.' } : null);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [editando, setEditando] = useState<number | null>(null);

  const c = (...e: EstadoFila[]) => filas.filter((f) => e.includes(f.estado)).length;
  const validas = filas.filter((f) => f.estado === 'valida');
  /* Cuántos traslados saldrán: uno por origen → destino → fecha. */
  const grupos = new Set(validas.map((f) => `${f.datos.origen}→${f.datos.destino}→${f.datos.fecha ?? ''}`.toLowerCase())).size;

  const visibles = useMemo(() => filas.filter((f) =>
    filtro === 'todas' ? true
    : filtro === 'error' ? f.estado === 'con_error' || f.estado === 'fallida'
    : filtro === 'validas' ? f.estado === 'valida'
    : filtro === 'hechas' ? f.estado === 'registrada' || f.estado === 'procesando'
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

  return (
    <div data-bloque="revision-importacion">
      <div className="rejilla-kpi">
        {[
          ['Filas leídas', filas.length, 'neutro'],
          ['Listas', c('valida'), c('valida') ? 'ok' : 'neutro'],
          ['Con error', c('con_error', 'fallida'), c('con_error', 'fallida') ? 'critico' : 'ok'],
          ['En traslados', c('registrada'), 'neutro'],
          ['Traslados creados', new Set(filas.map((f) => f.traslado_id).filter(Boolean)).size, 'neutro'],
        ].map(([t, v, tono]) => (
          <div key={String(t)} className="kpi panel">
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

      <section className="panel mb-espacio">
        <div style={{ padding: '1rem', display: 'flex', gap: '.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primario" data-accion="crear-traslados" disabled={trabajando || validas.length === 0}
                  onClick={() => hacer(() => crearTrasladosImportados(importacionId))}>
            <Icono nombre="traslados" tamano={15} />
            {trabajando ? 'Creando…' : validas.length === 0 ? 'Crear traslados en borrador'
              : `Crear ${grupos} traslado${grupos === 1 ? '' : 's'} en borrador (${validas.length} pallet${validas.length === 1 ? '' : 's'})`}
          </button>
          <span className="form-pista" style={{ margin: 0 }}>
            {validas.length === 0
              ? 'No hay filas listas: corrija o descarte las que tienen error.'
              : 'Un traslado por cada bodega de origen → destino (y fecha programada). Nacen en borrador: no se mueve nada hasta que Gerencia u Operaciones los autorice y Almacén los despache.'}
          </span>
        </div>
      </section>

      <section className="panel" data-bloque="filas-importacion">
        <nav className="pestanas" aria-label="Filtrar filas" style={{ padding: '.6rem .8rem 0' }}>
          {([['todas', 'Todas', filas.length], ['error', 'Con error', c('con_error', 'fallida')], ['validas', 'Listas', c('valida')],
            ['hechas', 'En traslados', c('registrada', 'procesando')], ['descartadas', 'Descartadas', c('descartada')]] as [Filtro, string, number][])
            .map(([k, t, n]) => (
              <button key={k} type="button" className="pestana" data-activa={filtro === k ? 'si' : 'no'} data-filtro={k}
                      onClick={() => setFiltro(k)}>{t} · {n}</button>
            ))}
        </nav>
        <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
          <table className="datos tabla-importacion">
            <thead>
              <tr><th className="num">Fila</th><th>Estado</th><th>Pallet</th><th>Origen → destino</th>
                <th className="num">Bultos</th><th className="num">Kilos</th><th>Fecha</th><th>Observaciones</th><th></th></tr>
            </thead>
            {visibles.length === 0 && (
              <tbody><tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--tinta-3)', padding: '1.2rem' }}>No hay filas en este grupo.</td></tr></tbody>
            )}
            {visibles.map((f) => editando === f.id ? (
              <tbody key={f.id} data-fila={f.fila} data-editando="si">
                <tr><td colSpan={9} style={{ padding: 0 }}>
                  <EditorFilaT fila={f} bodegas={bodegas} guardando={trabajando} alCancelar={() => setEditando(null)}
                               alGuardar={(v) => hacer(() => corregirFilaTraslado(f.id, v), () => setEditando(null))} />
                </td></tr>
              </tbody>
            ) : (
              <tbody key={f.id} data-fila={f.fila} data-estado={f.estado}>
                <tr>
                  <td className="num mono">{f.fila}</td>
                  <td><span className={`pill ${TONO[f.estado]}`}>{f.estado === 'registrada' ? 'En traslado' : TEXTO_ESTADO_FILA[f.estado]}</span></td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{f.datos.codigo_pallet || '—'}</td>
                  <td style={{ fontSize: '.78rem' }}>{f.datos.origen || '—'} → {f.datos.destino || '—'}</td>
                  <td className="num">{f.datos.bultos || 'Todo'}</td>
                  <td className="num">{f.datos.kilos || (f.datos.bultos ? 'Calculado' : 'Todo')}</td>
                  <td>{f.datos.fecha || '—'}</td>
                  <td style={{ fontSize: '.76rem' }}>{f.datos.observaciones || '—'}</td>
                  <td>
                    {['valida', 'con_error', 'fallida'].includes(f.estado) && (
                      <span style={{ display: 'inline-flex', gap: '.3rem', flexWrap: 'nowrap' }}>
                        <button type="button" className="btn btn-sutil btn-chico" data-accion="corregir-fila" disabled={trabajando}
                                onClick={() => { setEditando(f.id); setAviso(null); }}><Icono nombre="editar" tamano={13} /> Corregir</button>
                        <button type="button" className="btn btn-sutil btn-chico" data-accion="descartar-fila" disabled={trabajando}
                                onClick={() => hacer(() => descartarFilaTraslado(f.id, true))}>Descartar</button>
                      </span>
                    )}
                    {f.estado === 'descartada' && (
                      <button type="button" className="btn btn-sutil btn-chico" data-accion="restaurar-fila" disabled={trabajando}
                              onClick={() => hacer(() => descartarFilaTraslado(f.id, false))}>Restaurar</button>
                    )}
                  </td>
                </tr>
                <tr className="fila-detalle">
                  <td></td>
                  <td colSpan={8} style={{ fontSize: '.78rem', paddingTop: 0, whiteSpace: 'normal' }} data-detalle="fila">
                    {f.errores.length > 0 && (f.estado === 'con_error' || f.estado === 'fallida') && (
                      <ul style={{ margin: 0, paddingLeft: '1rem', color: 'var(--critico)' }}>
                        {f.errores.map((e, i) => <li key={i} data-columna={e.columna}><b>{TITULO_COLUMNA_TRASLADO[e.columna] ?? e.columna}:</b> {e.mensaje}</li>)}
                      </ul>
                    )}
                    {f.resultado && <span style={{ color: f.estado === 'registrada' ? 'var(--tinta-2)' : 'var(--critico)' }}>{f.resultado} </span>}
                    {f.traslado_id && (
                      <Link href={`/almacenes/traslados/${f.traslado_id}`} className="enlace-dato" data-enlace="traslado">Ver {f.traslado ?? 'el traslado'}</Link>
                    )}
                    {f.estado === 'valida' && !f.resultado && <span style={{ color: 'var(--ok)' }}>Bien. Lista para trasladar.</span>}
                    {f.estado === 'descartada' && <span style={{ color: 'var(--tinta-3)' }}>Descartada: no irá en ningún traslado.</span>}
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
      </section>
    </div>
  );
}

function EditorFilaT({
  fila, bodegas, guardando, alGuardar, alCancelar,
}: { fila: FilaRevisionT; bodegas: string[]; guardando: boolean; alGuardar: (v: Record<string, string>) => void; alCancelar: () => void }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(COLUMNAS_TRASLADO.map((c) => [c.clave, fila.datos[c.clave] ?? ''])));
  const conError = new Map(fila.errores.map((e) => [e.columna, e.mensaje]));
  return (
    <div data-bloque="editor-fila" style={{ padding: '1rem', background: 'var(--superficie-2)' }}>
      <strong>Corregir la fila {fila.fila}</strong>
      <div className="form-rejilla" style={{ padding: 0, marginTop: '.6rem' }}>
        {COLUMNAS_TRASLADO.map((c) => (
          <label key={c.clave} className={`form-campo${c.clave === 'observaciones' ? ' form-campo-ancho' : ''}`}>
            <span>{c.titulo}{c.obligatoria && <b className="req"> *</b>}</span>
            {c.clave === 'origen' || c.clave === 'destino' ? (
              <select className="campo" name={c.clave} value={v[c.clave]} data-error={conError.has(c.clave) ? 'si' : undefined}
                      onChange={(e) => setV({ ...v, [c.clave]: e.target.value })}>
                <option value="">Elija la bodega…</option>
                {v[c.clave] && !bodegas.includes(v[c.clave]) && <option value={v[c.clave]}>{v[c.clave]} (no reconocida)</option>}
                {bodegas.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            ) : (
              <input className={`campo${c.clave === 'codigo_pallet' || c.tipo === 'numero' ? ' mono' : ''}`} name={c.clave} value={v[c.clave]}
                     data-error={conError.has(c.clave) ? 'si' : undefined} placeholder={c.tipo === 'fecha' ? 'DD/MM/AAAA' : c.tipo === 'numero' ? 'Vacío: todo' : undefined}
                     onChange={(e) => setV({ ...v, [c.clave]: e.target.value })} />
            )}
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
