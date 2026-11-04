'use client';

/**
 * ============================================================================
 *  LA LISTA DE PROGRAMACIÓN · como su Excel, con filtro en cada columna (084)
 * ============================================================================
 *  «Observaciones ERP 4», puntos 10 y 11. Oliver: la vista que más van a
 *  usar es la LISTA, no el calendario. Una fila por embarque con lo que hoy
 *  llevan en su hoja: semana, despacho, zarpe, N.º de packing, booking,
 *  naviera, operador logístico, almacén…
 *
 *  CÓMO SE FILTRA
 *  Debajo de cada título hay un filtro: en las columnas de texto se escribe
 *  y la lista se acota al momento («contiene», sin importar tildes ni
 *  mayúsculas); en las de pocos valores (semana, naviera, operador, almacén,
 *  estado…) se elige de un desplegable con los valores que de verdad hay.
 *  Pulsar un título ordena por esa columna; otra vez, al revés.
 *
 *  Los filtros y el orden se guardan en la dirección web: el enlace se puede
 *  compartir y «Excel» / «PDF» bajan exactamente lo que se está viendo.
 * ============================================================================
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import {
  COLUMNAS_PROGRAMACION, filtrarProgramacion, filtrosDeParametros, opcionesDeColumna, ordenarProgramacion,
  valorTexto, ESTADOS_EMBARQUE, type ColumnaProgramacion, type FilaProgramacion,
} from '@/lib/programacion';
import './programacion.css';

const TONO_ESTADO: Record<string, string> = {
  planificado: 'var(--tinta-2)', confirmado: 'var(--acento)', en_preparacion: 'var(--atencion)',
  despachado: 'var(--ok)', cancelado: 'var(--critico)',
};

export function TablaProgramacion({
  filas,
  descripcionRango,
  conFicha = true,
}: {
  filas: FilaProgramacion[];
  /** «Desde el lunes 02/11/2026», para la barra y la descarga. */
  descripcionRango: string;
  /** Si el número enlaza a la ficha del embarque (quien no puede abrirla, no). */
  conFicha?: boolean;
}) {
  const ruta = usePathname();
  const params = useSearchParams();

  //  Lo escrito en cada filtro: al momento en la tabla, y con una pausa en la dirección.
  const [filtros, setFiltros] = useState<Record<string, string>>(() => filtrosDeParametros(new URLSearchParams(params.toString())));
  const orden = params.get('orden');
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  function llevarALaDireccion(nuevos: Record<string, string>, cambios: Record<string, string | null> = {}) {
    const p = new URLSearchParams(params.toString());
    for (const k of [...p.keys()]) if (k.startsWith('f_')) p.delete(k);
    for (const [k, v] of Object.entries(nuevos)) if (v.trim()) p.set(`f_${k}`, v);
    for (const [k, v] of Object.entries(cambios)) { if (v) p.set(k, v); else p.delete(k); }
    const t = p.toString();
    /*
     * Con la historia del navegador y no con router.replace: los datos ya
     * están aquí y el filtro se aplica en el navegador, así que no hace falta
     * volver a pedirle la página al servidor. Next.js lo integra con
     * useSearchParams (las descargas leen la dirección nueva).
     */
    window.history.replaceState(null, '', `${ruta}${t ? `?${t}` : ''}`);
  }

  function poner(clave: string, valor: string, inmediato = false) {
    const nuevos = { ...filtros, [clave]: valor };
    if (!valor) delete nuevos[clave];
    setFiltros(nuevos);
    if (temporizador.current) clearTimeout(temporizador.current);
    if (inmediato) llevarALaDireccion(nuevos);
    else temporizador.current = setTimeout(() => llevarALaDireccion(nuevos), 400);
  }
  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);

  function ordenarPor(clave: string) {
    const mismo = orden === clave;
    llevarALaDireccion(filtros, { orden: clave, dir: mismo && dir === 'asc' ? 'desc' : 'asc' });
  }

  const visibles = useMemo(
    () => ordenarProgramacion(filtrarProgramacion(filas, filtros), orden, dir),
    [filas, filtros, orden, dir],
  );
  const tmVisibles = visibles.reduce((t, f) => t + f.tm, 0);
  const cuantos = Object.values(filtros).filter((v) => v.trim()).length;

  return (
    <div data-bloque="programacion">
      <div className="prog-barra">
        <span className="prog-cuenta" data-cuenta={visibles.length}>
          <strong>{visibles.length}</strong> de {filas.length} embarque{filas.length === 1 ? '' : 's'} ·{' '}
          <strong>{tmVisibles.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> TM · {descripcionRango}
        </span>
        {cuantos > 0 && (
          <button type="button" className="btn btn-sutil btn-chico" data-accion="limpiar-filtros"
                  onClick={() => { setFiltros({}); llevarALaDireccion({}); }}>
            Quitar {cuantos} filtro{cuantos === 1 ? '' : 's'}
          </button>
        )}
        <span className="prog-espacio" />
        <Descargas />
      </div>

      <div className="prog-tabla-envoltorio">
        <table className="prog-tabla" data-cuadro="programacion">
          <thead>
            <tr>
              {COLUMNAS_PROGRAMACION.map((c) => (
                <th key={c.clave} className={c.numerica ? 'num' : undefined} scope="col"
                    aria-sort={orden === c.clave ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="prog-orden" onClick={() => ordenarPor(c.clave)}
                          title={`Ordenar por ${c.titulo.toLowerCase()}`}>
                    {c.titulo}
                    {orden === c.clave && <span aria-hidden="true">{dir === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
            </tr>
            <tr className="prog-filtros">
              {COLUMNAS_PROGRAMACION.map((c) => (
                <th key={c.clave}>
                  <FiltroColumna columna={c} valor={filtros[c.clave] ?? ''} filas={filas} onCambio={poner} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr>
                <td colSpan={COLUMNAS_PROGRAMACION.length} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--tinta-3)' }}>
                  {filas.length === 0
                    ? 'No hay embarques programados en estas fechas.'
                    : 'Ningún embarque cumple todos los filtros. Quite alguno para ver más.'}
                </td>
              </tr>
            ) : visibles.map((f) => (
              <tr key={f.id} data-embarque={f.id} data-semana-par={f.semana != null && f.semana % 2 === 0 ? 'si' : 'no'}>
                <td className="num"><strong>{f.semana ?? '—'}</strong></td>
                <td className="nowrap">{valorTexto(f, 'fecha_despacho')}</td>
                <td className="nowrap">{valorTexto(f, 'fecha_zarpe') || <span style={{ color: 'var(--tinta-3)' }}>—</span>}</td>
                <td className="mono" data-pl>{f.pl || <span style={{ color: 'var(--tinta-3)' }}>—</span>}</td>
                <td className="mono">
                  {conFicha ? <Link href={`/logistica/embarques/${f.id}`} className="enlace-ficha">{f.numero}</Link> : f.numero}
                  {f.tipo && f.tipo !== 'exportacion' && <small>{f.tipo === 'mercado_nacional' ? 'Mercado nacional' : 'Traslado'}</small>}
                </td>
                <td className="mono">{f.proformas || '—'}</td>
                <td className="envuelve" style={{ minWidth: '12rem' }}>{f.clientes || '—'}</td>
                <td className="envuelve" style={{ minWidth: '8rem' }}>{f.destino || '—'}</td>
                <td>{f.productos || '—'}</td>
                <td className="num">
                  {valorTexto(f, 'tm')}
                  <small>{f.tm_cargada ? 'cargadas' : 'programadas'}</small>
                </td>
                <td className="mono">{f.contenedores || '—'}</td>
                <td className="mono">{f.booking || '—'}</td>
                <td>{f.naviera || '—'}</td>
                <td className="envuelve" style={{ minWidth: '8rem' }}>{f.operador || '—'}</td>
                <td>{f.almacen || '—'}</td>
                <td style={{ color: TONO_ESTADO[f.estado] ?? undefined, fontWeight: 600 }}>{ESTADOS_EMBARQUE[f.estado] ?? f.estado}</td>
                <td>{f.packing}</td>
                <td>
                  <span className="prog-docs">
                    <span className="prog-doc" data-hay={f.docs.etiqueta ? 'si' : 'no'} title="Modelo de etiqueta">Etiqueta{f.docs.etiqueta > 1 ? ` ×${f.docs.etiqueta}` : ''}</span>
                    <span className="prog-doc" data-hay={f.docs.declarado ? 'si' : 'no'} title="Packing declarado (cliente / SANIPES)">PL decl.{f.docs.declarado > 1 ? ` ×${f.docs.declarado}` : ''}</span>
                    <span className="prog-doc" data-hay={f.docs.real ? 'si' : 'no'} title="Packing real (interno)">PL real{f.docs.real > 1 ? ` ×${f.docs.real}` : ''}</span>
                    {f.comentarios > 0 && <span className="prog-doc" data-hay="si" title="Comentarios del embarque">{f.comentarios} coment.</span>}
                  </span>
                </td>
                <td className="nowrap">{valorTexto(f, 'despacho_real') || '—'}</td>
                <td className="envuelve" style={{ minWidth: '14rem' }}>{f.observaciones || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="prog-pie">
        Las TM son las cargadas en el contenedor cuando ya hay packing; si no, las programadas. La semana es la de
        despacho (la escrita en el embarque o, si no se escribió, la de su fecha). «Despacho real» es cuando salió
        de la bodega.
      </p>
    </div>
  );
}

function FiltroColumna({ columna, valor, filas, onCambio }: {
  columna: ColumnaProgramacion;
  valor: string;
  filas: FilaProgramacion[];
  onCambio: (clave: string, valor: string, inmediato?: boolean) => void;
}) {
  const opciones = useMemo(() => (columna.filtro === 'lista' ? opcionesDeColumna(filas, columna.clave) : []), [filas, columna]);
  if (columna.filtro === 'ninguno') return null;
  const nombre = `f_${columna.clave}`;
  if (columna.filtro === 'lista') {
    return (
      <select className="campo prog-filtro" name={nombre} aria-label={`Filtrar ${columna.titulo}`} value={valor}
              data-activo={valor ? 'si' : 'no'} onChange={(e) => onCambio(columna.clave, e.target.value, true)}>
        <option value="">Todos</option>
        {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
        {/* Un filtro que venía en el enlace y ya no tiene filas: se muestra igual para poder quitarlo. */}
        {valor && !opciones.includes(valor) && <option value={valor}>{valor}</option>}
      </select>
    );
  }
  return (
    <input className="campo prog-filtro" name={nombre} aria-label={`Filtrar ${columna.titulo}`} value={valor}
           data-activo={valor ? 'si' : 'no'} placeholder="Filtrar…" onChange={(e) => onCambio(columna.clave, e.target.value)} />
  );
}

/**
 * «Excel» y «PDF» de lo que se ve: llevan la dirección tal cual (rango,
 * filtros de columna y orden). Como en BotonesReporte, se mira la respuesta
 * antes de guardar: un error se dice, no se descarga como si fuera el archivo.
 */
function Descargas() {
  const params = useSearchParams();
  const [bajando, setBajando] = useState<'excel' | 'pdf' | null>(null);
  const [problema, setProblema] = useState<string | null>(null);

  async function bajar(formato: 'excel' | 'pdf') {
    setBajando(formato);
    setProblema(null);
    try {
      const p = new URLSearchParams(params.toString());
      p.set('formato', formato);
      const r = await fetch(`/api/logistica/programacion?${p.toString()}`);
      if (!r.ok) {
        const cuerpo = await r.json().catch(() => ({}));
        setProblema(cuerpo.error ?? `No se pudo generar el archivo (HTTP ${r.status}).`);
        return;
      }
      const nombre = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1]
        ?? `Programacion.${formato === 'excel' ? 'xlsx' : 'pdf'}`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setProblema('No se pudo contactar con el servidor. Revise su internet y vuelva a intentarlo.');
    } finally {
      setBajando(null);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secundario btn-chico" data-descargar="excel" disabled={bajando !== null}
              onClick={() => void bajar('excel')} title="Descargar en Excel lo que se ve, con sus filtros">
        <Icono nombre="descargar" tamano={14} />
        {bajando === 'excel' ? 'Generando…' : 'Excel'}
      </button>
      <button type="button" className="btn btn-secundario btn-chico" data-descargar="pdf" disabled={bajando !== null}
              onClick={() => void bajar('pdf')} title="Descargar en PDF, apaisado y listo para imprimir">
        <Icono nombre="facturas" tamano={14} />
        {bajando === 'pdf' ? 'Generando…' : 'PDF'}
      </button>
      {problema && <span role="alert" className="form-mensaje error" style={{ margin: 0 }}>{problema}</span>}
    </>
  );
}
