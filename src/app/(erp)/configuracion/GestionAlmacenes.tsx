'use client';

/**
 * ============================================================================
 *  MAESTRO DE ALMACENES · Configuración › Maestros › Almacenes
 * ============================================================================
 *  Alta, edición, desactivación y borrado de almacenes, y lo más importante
 *  desde la reunión con Oliver: QUÉ RECIBE cada uno. Las dos casillas
 *  «Recibe producción» y «Recibe compras» deciden qué bodegas ofrece el
 *  formulario de ingreso según el origen, qué acepta la importación desde
 *  Excel y qué deja pasar la base.
 *
 *  Lo editan Gerencia y Operaciones; los demás lo ven (si llegan aquí) sin
 *  botones. Desactivar exige que no tenga stock; borrar, que nunca se haya
 *  usado. Cuando no se puede, el botón se apaga y dice por qué.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import { crearAlmacen, actualizarAlmacen, borrarAlmacen, type DatosAlmacen } from './accionesAlmacenes';

export type FilaAlmacen = DatosAlmacen & {
  id: number;
  camaras: string[];
  stock_kg: number;
  movimientos: number;
};

type Aviso = { ok: boolean; texto: string } | null;

const VACIO: DatosAlmacen = {
  codigo: '', nombre: '', tipo: 'externo', operador: '', ciudad: '', capacidad_tm: null,
  despachos_dia_max: 4, recibe_produccion: false, recibe_compras: true, activo: true,
};

const tmTexto = (kg: number) => (kg / 1000).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Formulario({
  inicial, nuevo, guardando, alGuardar, alCancelar, conStock,
}: {
  inicial: DatosAlmacen; nuevo: boolean; guardando: boolean; conStock: boolean;
  alGuardar: (d: DatosAlmacen) => void; alCancelar: () => void;
}) {
  const [d, setD] = useState<DatosAlmacen>(inicial);
  const campo = <K extends keyof DatosAlmacen>(k: K, v: DatosAlmacen[K]) => setD((p) => ({ ...p, [k]: v }));
  return (
    <div data-bloque="formulario-almacen" style={{ padding: '1rem', borderBottom: '1px solid var(--linea)', background: 'var(--superficie-2)' }}>
      <div className="form-rejilla" style={{ padding: 0 }}>
        <label className="form-campo">
          <span>Nombre *</span>
          <input className="campo" name="nombre" value={d.nombre} maxLength={80} autoFocus placeholder="Ej.: Frigorífico del Sur"
                 onChange={(e) => campo('nombre', e.target.value)} />
        </label>
        <label className="form-campo">
          <span>Código</span>
          <input className="campo mono" name="codigo" value={d.codigo} maxLength={10} disabled={!nuevo}
                 placeholder={nuevo ? 'Vacío: se arma del nombre' : undefined}
                 onChange={(e) => campo('codigo', e.target.value.toUpperCase())} />
          <small>{nuevo ? 'Corto y sin espacios. No se puede cambiar después.' : 'No se cambia: lo usan los reportes y las plantillas.'}</small>
        </label>
        <label className="form-campo">
          <span>Tipo *</span>
          <select className="campo" name="tipo" value={d.tipo} onChange={(e) => campo('tipo', e.target.value as DatosAlmacen['tipo'])}>
            <option value="propio">Propio (de Santa Mónica)</option>
            <option value="externo">Externo (de un tercero)</option>
          </select>
        </label>
        <label className="form-campo">
          <span>Operador</span>
          <input className="campo" name="operador" value={d.operador} maxLength={80} placeholder="Vacío: el mismo nombre"
                 onChange={(e) => campo('operador', e.target.value)} />
        </label>
        <label className="form-campo">
          <span>Ciudad</span>
          <input className="campo" name="ciudad" value={d.ciudad} maxLength={60} onChange={(e) => campo('ciudad', e.target.value)} />
        </label>
        <label className="form-campo">
          <span>Capacidad (TM)</span>
          <input className="campo mono" name="capacidad_tm" type="number" min={0} step={1} value={d.capacidad_tm ?? ''}
                 onChange={(e) => campo('capacidad_tm', e.target.value === '' ? null : Number(e.target.value))} />
        </label>
        <label className="form-campo">
          <span>Despachos por día (máx.)</span>
          <input className="campo mono" name="despachos_dia_max" type="number" min={1} max={50} step={1} value={d.despachos_dia_max}
                 onChange={(e) => campo('despachos_dia_max', Number(e.target.value))} />
        </label>
      </div>
      <fieldset className="form-bloque" style={{ marginTop: '.8rem' }}>
        <legend>Qué recibe</legend>
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <input type="checkbox" name="recibe_produccion" checked={d.recibe_produccion} onChange={(e) => campo('recibe_produccion', e.target.checked)} />
          <span><strong>Recibe producción</strong> — ingresos de lo que procesó la planta (propia o maquila).</span>
        </label>
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginTop: '.4rem' }}>
          <input type="checkbox" name="recibe_compras" checked={d.recibe_compras} onChange={(e) => campo('recibe_compras', e.target.checked)} />
          <span><strong>Recibe compras</strong> — ingresos de producto terminado comprado a un tercero.</span>
        </label>
        <small style={{ display: 'block', marginTop: '.4rem', color: 'var(--tinta-3)' }}>
          Sin ninguna marcada, el almacén solo recibe stock por traslado (como Depsa, Coinrefri o Emergent Cold).
        </small>
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginTop: '.7rem' }}
               title={conStock && d.activo ? 'Con stock no se puede desactivar: trasládelo primero' : undefined}>
          <input type="checkbox" name="activo" checked={d.activo} disabled={conStock && d.activo}
                 onChange={(e) => campo('activo', e.target.checked)} />
          <span><strong>Activo</strong>{conStock && d.activo ? ' — tiene stock: para desactivarlo, trasládelo primero.' : ' — desactivado deja de ofrecerse, pero su historia queda.'}</span>
        </label>
      </fieldset>
      <div style={{ display: 'flex', gap: '.6rem', marginTop: '.9rem' }}>
        <button type="button" className="btn btn-primario" disabled={guardando} data-accion="guardar-almacen" onClick={() => alGuardar(d)}>
          {guardando ? 'Guardando…' : nuevo ? 'Dar de alta' : 'Guardar cambios'}
        </button>
        <button type="button" className="btn btn-sutil" disabled={guardando} onClick={alCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

export function GestionAlmacenes({ filas, editable }: { filas: FilaAlmacen[]; editable: boolean }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [aviso, setAviso] = useState<Aviso>(null);
  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const [borrando, setBorrando] = useState<number | null>(null);

  function hacer(accion: () => Promise<{ ok: boolean; mensaje: string }>, alTerminar?: () => void) {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(accion);
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { alTerminar?.(); router.refresh(); }
    });
  }

  const columnas = editable ? 10 : 9;

  return (
    <section className="panel" data-bloque="almacenes">
      <div className="panel-cabecera">
        <span className="panel-titulo">Almacenes · {filas.length} ({filas.filter((f) => f.activo).length} activos)</span>
        {editable && !nuevo && (
          <button type="button" className="btn btn-secundario btn-chico" data-accion="nuevo-almacen"
                  onClick={() => { setNuevo(true); setEditando(null); setAviso(null); }}>
            <Icono nombre="mas" tamano={14} /> Nuevo almacén
          </button>
        )}
      </div>

      <p className="pie-explicativo" style={{ padding: '.8rem 1rem 0', margin: 0 }}>
        <strong>Recibe producción</strong> y <strong>Recibe compras</strong> deciden por dónde puede entrar un ingreso a cámara: el
        formulario de ingreso solo ofrece las bodegas que reciben el origen elegido, y la importación desde Excel y la base
        rechazan las demás. Un almacén sin ninguna de las dos recibe stock solo por traslado.
        {editable ? ' Cada cambio queda en Auditoría.' : ' Los editan Gerencia y Operaciones.'}
      </p>

      {aviso && (
        <div style={{ padding: '0 1rem' }}>
          <div className={`ficha-aviso ${aviso.ok ? 'ficha-aviso-ok' : 'ficha-aviso-critico'}`} role={aviso.ok ? 'status' : 'alert'} data-aviso="almacenes">
            <Icono nombre={aviso.ok ? 'calidad' : 'alerta'} tamano={17} />
            <span>{aviso.texto}</span>
          </div>
        </div>
      )}

      {nuevo && (
        <Formulario inicial={VACIO} nuevo guardando={pendiente} conStock={false}
                    alCancelar={() => setNuevo(false)}
                    alGuardar={(d) => hacer(() => crearAlmacen(d), () => setNuevo(false))} />
      )}

      <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
        <table className="datos">
          <thead>
            <tr>
              <th>Código</th><th>Nombre</th><th>Tipo</th><th>Ciudad</th><th className="num">Capacidad</th>
              <th>Recibe producción</th><th>Recibe compras</th><th className="num">Stock</th><th>Estado</th>
              {editable && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((a) => editando === a.id ? (
              <tr key={a.id}>
                <td colSpan={columnas} style={{ padding: 0 }}>
                  <Formulario inicial={a} nuevo={false} guardando={pendiente} conStock={a.stock_kg > 0.001}
                              alCancelar={() => setEditando(null)}
                              alGuardar={(d) => hacer(() => actualizarAlmacen(a.id, d), () => setEditando(null))} />
                </td>
              </tr>
            ) : (
              <tr key={a.id} data-almacen={a.codigo} data-activo={a.activo ? 'si' : 'no'}>
                <td className="mono">{a.codigo}</td>
                <td>
                  <strong>{a.nombre}</strong>
                  {a.camaras.length > 0 && <small style={{ display: 'block', color: 'var(--tinta-3)' }}>{a.camaras.join(', ')}</small>}
                </td>
                <td>{a.tipo === 'propio' ? 'Propio' : 'Externo'}</td>
                <td>{a.ciudad || '—'}</td>
                <td className="num">{a.capacidad_tm === null ? '—' : `${a.capacidad_tm.toLocaleString('es-PE')} TM`}</td>
                <td data-recibe="produccion">{a.recibe_produccion ? <span className="pill pill-ok">Sí</span> : <span className="pill pill-neutro">No</span>}</td>
                <td data-recibe="compras">{a.recibe_compras ? <span className="pill pill-ok">Sí</span> : <span className="pill pill-neutro">No</span>}</td>
                <td className="num">{a.stock_kg > 0 ? `${tmTexto(a.stock_kg)} TM` : '—'}</td>
                <td><span className={`pill ${a.activo ? 'pill-ok' : ''}`}>{a.activo ? 'Activo' : 'Inactivo'}</span></td>
                {editable && (
                  <td>
                    {borrando === a.id ? (
                      <span style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '.8rem' }}>¿Borrar «{a.nombre}»?</span>
                        <button type="button" className="btn btn-peligro btn-chico" disabled={pendiente} data-accion="confirmar-borrar-almacen"
                                onClick={() => hacer(() => borrarAlmacen(a.id), () => setBorrando(null))}>Sí, borrar</button>
                        <button type="button" className="btn btn-sutil btn-chico" disabled={pendiente} onClick={() => setBorrando(null)}>No</button>
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', gap: '.3rem', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-sutil btn-chico" disabled={pendiente} data-accion="editar-almacen"
                                onClick={() => { setEditando(a.id); setNuevo(false); setAviso(null); }}>Editar</button>
                        <button type="button" className="btn btn-sutil btn-chico" data-accion="borrar-almacen"
                                disabled={pendiente || a.movimientos > 0 || a.camaras.length > 0}
                                title={a.movimientos > 0 || a.camaras.length > 0
                                  ? 'Ya tiene historia (movimientos o cámaras): no se borra, se desactiva desde «Editar»'
                                  : `Borrar ${a.nombre}`}
                                onClick={() => { setBorrando(a.id); setAviso(null); }}>Borrar</button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
