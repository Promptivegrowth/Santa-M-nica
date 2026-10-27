'use client';

/**
 * ============================================================================
 *  LOS PROGRAMADOS QUE ESPERAN · confirmar la llegada (uno o varios) o anular
 * ============================================================================
 *  Bultos y kilos llegan puestos con lo anunciado, que es lo que pasa casi
 *  siempre; si al contar no coincide, se corrige en la misma fila antes de
 *  confirmar. Se puede marcar varios y confirmarlos de una vez.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import { confirmarLlegadas, anularProgramado } from './acciones';

export type Programado = {
  id: number; codigo_pallet: string; fecha_llegada: string; producto: string; origen: string;
  proveedor: string | null; bodega: string; camara: string | null; bultos: number; peso_neto_kg: number;
  importacion_id: number | null; autor: string;
};

const fechaDMA = (iso: string) => iso.split('-').reverse().join('/');

export function ListaProgramados({ programados, hoy }: { programados: Programado[]; hoy: string }) {
  const router = useRouter();
  const [trabajando, iniciar] = useTransition();
  const [elegidos, setElegidos] = useState<Set<number>>(new Set());
  const [real, setReal] = useState<Map<number, { bultos: number; kg: number }>>(
    () => new Map(programados.map((p) => [p.id, { bultos: p.bultos, kg: p.peso_neto_kg }])));
  const [anulando, setAnulando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [lotes, setLotes] = useState<Map<number, number>>(new Map());

  const valor = (p: Programado) => real.get(p.id) ?? { bultos: p.bultos, kg: p.peso_neto_kg };

  function confirmar(ids: number[]) {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => confirmarLlegadas(ids.map((id) => {
        const p = programados.find((x) => x.id === id)!;
        const v = valor(p);
        return { id, bultos: v.bultos, peso_neto_kg: v.kg };
      })));
      setAviso({ ok: r.ok, texto: r.mensaje });
      if ('filas' in r) {
        setLotes((m) => { const n = new Map(m); for (const f of r.filas) if (f.lote_id) n.set(f.id, f.lote_id); return n; });
        setElegidos(new Set());
      }
      router.refresh();
    });
  }

  function anular(id: number) {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => anularProgramado(id, motivo));
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setAnulando(null); setMotivo(''); }
      router.refresh();
    });
  }

  const malos = [...elegidos].filter((id) => {
    const v = real.get(id);
    return !v || !(v.bultos > 0) || !Number.isInteger(v.bultos) || !(v.kg > 0);
  });

  return (
    <section className="panel mb-espacio" data-bloque="programados">
      <div className="panel-cabecera">
        <span className="panel-titulo">Esperando llegada · {programados.length}</span>
        <div className="panel-acciones">
          <button type="button" className="btn btn-primario btn-chico" data-accion="confirmar-seleccionados"
                  disabled={trabajando || elegidos.size === 0 || malos.length > 0}
                  title={malos.length ? 'Corrija los bultos o kilos marcados: tienen que ser mayores que cero' : undefined}
                  onClick={() => confirmar([...elegidos])}>
            <Icono nombre="ingresos" tamano={14} />
            {trabajando ? 'Confirmando…' : `Confirmar llegada de ${elegidos.size} seleccionado${elegidos.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      {aviso && (
        <div style={{ padding: '0 1rem' }}>
          <div className={`ficha-aviso ${aviso.ok ? 'ficha-aviso-ok' : 'ficha-aviso-critico'}`} role={aviso.ok ? 'status' : 'alert'} data-aviso="programados">
            <Icono nombre={aviso.ok ? 'calidad' : 'alerta'} tamano={17} />
            <span>{aviso.texto}</span>
          </div>
        </div>
      )}

      {programados.length === 0 ? (
        <div className="vacio">
          <strong>No hay ingresos programados</strong>
          <span>
            Se programan desde <Link href="/almacenes/ingresos/importar">Importar desde Excel</Link>, poniendo en «Llega el» la
            fecha en que se espera el pallet.{lotes.size ? ' Los que acaba de confirmar ya están en stock.' : ''}
          </span>
        </div>
      ) : (
        <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
          <table className="datos">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" aria-label="Elegir todos"
                         checked={elegidos.size === programados.length && programados.length > 0}
                         onChange={(e) => setElegidos(e.target.checked ? new Set(programados.map((p) => p.id)) : new Set())} />
                </th>
                <th>Llega el</th><th>Pallet</th><th>Producto</th><th>Origen</th><th>Bodega · cámara</th>
                <th className="num">Bultos que llegaron</th><th className="num">Kg que llegaron</th><th></th>
              </tr>
            </thead>
            <tbody>
              {programados.map((p) => {
                const v = valor(p);
                const atrasado = p.fecha_llegada < hoy;
                const distinto = v.bultos !== p.bultos || Math.abs(v.kg - p.peso_neto_kg) > 0.0005;
                return (
                  <tr key={p.id} data-programado={p.id} data-pallet={p.codigo_pallet}>
                    <td>
                      <input type="checkbox" checked={elegidos.has(p.id)} aria-label={`Elegir ${p.codigo_pallet}`}
                             onChange={() => setElegidos((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                    </td>
                    <td>
                      {fechaDMA(p.fecha_llegada)}
                      {atrasado && <><br /><span className="pill pill-atencion">Atrasado</span></>}
                      {p.fecha_llegada === hoy && <><br /><span className="pill pill-info">Hoy</span></>}
                    </td>
                    <td className="mono">{p.codigo_pallet}</td>
                    <td style={{ fontSize: '.76rem' }}>{p.producto}</td>
                    <td style={{ fontSize: '.78rem' }}>{p.origen}{p.proveedor ? <><br /><small style={{ color: 'var(--tinta-3)' }}>{p.proveedor}</small></> : null}</td>
                    <td style={{ fontSize: '.78rem' }}>{p.bodega}{p.camara ? ` · ${p.camara}` : ''}</td>
                    <td className="num">
                      <input className="campo mono" type="number" min={1} step={1} style={{ width: '5.5rem' }} name={`bultos_${p.id}`}
                             value={v.bultos} onChange={(e) => setReal((m) => new Map(m).set(p.id, { ...v, bultos: Number(e.target.value) }))} />
                      {distinto && <small style={{ display: 'block', color: 'var(--atencion)' }}>Se anunciaron {p.bultos}</small>}
                    </td>
                    <td className="num">
                      <input className="campo mono" type="number" min={0} step={0.1} style={{ width: '7.5rem' }} name={`kg_${p.id}`}
                             value={v.kg} onChange={(e) => setReal((m) => new Map(m).set(p.id, { ...v, kg: Number(e.target.value) }))} />
                      {distinto && <small style={{ display: 'block', color: 'var(--atencion)' }}>Se anunciaron {p.peso_neto_kg.toLocaleString('es-PE')} kg</small>}
                    </td>
                    <td>
                      {anulando === p.id ? (
                        <span style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input className="campo" style={{ width: '13rem' }} placeholder="Por qué ya no llega" value={motivo} maxLength={300}
                                 name="motivo_anulacion" autoFocus onChange={(e) => setMotivo(e.target.value)} />
                          <button type="button" className="btn btn-peligro btn-chico" data-accion="confirmar-anular"
                                  disabled={trabajando || motivo.trim().length < 5} onClick={() => anular(p.id)}>Anular</button>
                          <button type="button" className="btn btn-sutil btn-chico" onClick={() => setAnulando(null)}>No</button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: '.3rem', flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-secundario btn-chico" data-accion="confirmar-llegada"
                                  disabled={trabajando || !(v.bultos > 0) || !(v.kg > 0)}
                                  onClick={() => confirmar([p.id])}>Confirmar llegada</button>
                          <button type="button" className="btn btn-sutil btn-chico" data-accion="anular-programado"
                                  disabled={trabajando} onClick={() => { setAnulando(p.id); setMotivo(''); }}>Anular</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
