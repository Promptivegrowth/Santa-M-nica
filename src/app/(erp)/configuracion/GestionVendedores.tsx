'use client';

/**
 * ============================================================================
 *  MAESTRO DE VENDEDORES · Configuración › Maestros › Vendedores
 * ============================================================================
 *  Alta, edición, desactivación y borrado de los vendedores: la venta directa
 *  de Santa Mónica y los intermediarios que traen clientes.
 *
 *  La fila dice cuánto se usó cada uno (clientes, cotizaciones, pedidos): es
 *  lo que decide si se puede borrar o solo desactivar, y el botón lo explica
 *  en vez de desaparecer.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import {
  crearVendedor, actualizarVendedor, cambiarEstadoVendedor, borrarVendedor,
  type DatosVendedor, type TipoVendedor,
} from './accionesVendedores';

export type FilaVendedor = {
  id: number; nombre: string; tipo: TipoVendedor; email: string | null; activo: boolean;
  clientes: number; cotizaciones: number; pedidos: number;
};

type Aviso = { ok: boolean; texto: string } | null;

const TIPO: Record<TipoVendedor, string> = { final: 'Venta directa', intermediario: 'Intermediario' };

function MensajeAviso({ aviso }: { aviso: Aviso }) {
  if (!aviso) return null;
  return (
    <div className={`ficha-aviso ${aviso.ok ? 'ficha-aviso-ok' : 'ficha-aviso-critico'} documento-mensaje`}
         role={aviso.ok ? 'status' : 'alert'} data-aviso="vendedores">
      <Icono nombre={aviso.ok ? 'calidad' : 'alerta'} tamano={17} />
      <span>{aviso.texto}</span>
    </div>
  );
}

/** El mismo formulario para dar de alta y para editar. */
function FormularioVendedor({
  inicial, guardando, alGuardar, alCancelar, textoBoton,
}: {
  inicial: DatosVendedor; guardando: boolean; textoBoton: string;
  alGuardar: (d: DatosVendedor) => void; alCancelar: () => void;
}) {
  const [d, setD] = useState<DatosVendedor>(inicial);
  return (
    <div data-bloque="formulario-vendedor" style={{ padding: '1rem', borderBottom: '1px solid var(--linea)' }}>
      <div className="form-rejilla" style={{ padding: 0 }}>
        <label className="form-campo">
          <span>Nombre *</span>
          <input className="campo" name="nombre" value={d.nombre} maxLength={120} autoFocus
                 placeholder="Ej.: Pacific Seafood Brokers"
                 onChange={(e) => setD({ ...d, nombre: e.target.value })} />
        </label>
        <label className="form-campo">
          <span>Tipo *</span>
          <select className="campo" name="tipo" value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as TipoVendedor })}>
            <option value="intermediario">Intermediario (bróker o agente que trae al cliente)</option>
            <option value="final">Venta directa (la propia empresa)</option>
          </select>
        </label>
        <label className="form-campo">
          <span>Correo</span>
          <input className="campo" name="email" type="email" value={d.email ?? ''} placeholder="opcional"
                 onChange={(e) => setD({ ...d, email: e.target.value || null })} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: '.6rem', marginTop: '.9rem' }}>
        <button type="button" className="btn btn-primario" disabled={guardando} data-accion="guardar-vendedor" onClick={() => alGuardar(d)}>
          {guardando ? 'Guardando…' : textoBoton}
        </button>
        <button type="button" className="btn btn-sutil" disabled={guardando} onClick={alCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

export function GestionVendedores({ filas, editable }: { filas: FilaVendedor[]; editable: boolean }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [aviso, setAviso] = useState<Aviso>(null);
  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const [borrando, setBorrando] = useState<number | null>(null);

  function hacer(accion: () => Promise<{ ok: boolean; mensaje: string }>, alTerminar?: () => void) {
    setAviso(null);
    iniciar(async () => {
      const r = await accion();
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { alTerminar?.(); router.refresh(); }
    });
  }

  const activos = filas.filter((f) => f.activo).length;

  return (
    <section className="panel" data-bloque="vendedores">
      <div className="panel-cabecera">
        <span className="panel-titulo">Vendedores · {filas.length} ({activos} activos)</span>
        {editable && !nuevo && (
          <button type="button" className="btn btn-secundario btn-chico" data-accion="nuevo-vendedor"
                  onClick={() => { setNuevo(true); setEditando(null); setAviso(null); }}>
            <Icono nombre="mas" tamano={14} /> Nuevo vendedor
          </button>
        )}
      </div>

      <p className="pie-explicativo" style={{ padding: '.8rem 1rem 0', margin: 0 }}>
        El vendedor es <strong>por quién llegó la venta</strong>: la venta directa de Santa Mónica o un intermediario
        que trae al cliente. Se elige al cotizar o registrar un pedido, sale impreso en la cotización y permite medir
        cada canal en Rentabilidad › Por vendedor. Uno desactivado deja de ofrecerse, pero sus documentos lo conservan.
      </p>

      <div style={{ padding: '0 1rem' }}><MensajeAviso aviso={aviso} /></div>

      {nuevo && (
        <FormularioVendedor
          inicial={{ nombre: '', tipo: 'intermediario', email: null }}
          guardando={pendiente} textoBoton="Agregar vendedor"
          alCancelar={() => setNuevo(false)}
          alGuardar={(d) => hacer(() => crearVendedor(d), () => setNuevo(false))}
        />
      )}

      <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
        <table className="datos">
          <thead>
            <tr>
              <th>Nombre</th><th>Tipo</th><th>Correo</th>
              <th className="num">Clientes</th><th className="num">Cotizaciones</th><th className="num">Pedidos</th>
              <th>Estado</th>{editable && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((v) => {
              const usos = v.clientes + v.cotizaciones + v.pedidos;
              if (editando === v.id) {
                return (
                  <tr key={v.id}>
                    <td colSpan={editable ? 8 : 7} style={{ padding: 0 }}>
                      <FormularioVendedor
                        inicial={{ nombre: v.nombre, tipo: v.tipo, email: v.email }}
                        guardando={pendiente} textoBoton="Guardar cambios"
                        alCancelar={() => setEditando(null)}
                        alGuardar={(d) => hacer(() => actualizarVendedor(v.id, d), () => setEditando(null))}
                      />
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={v.id} data-vendedor={v.id} data-activo={v.activo ? 'si' : 'no'}>
                  <td><strong>{v.nombre}</strong></td>
                  <td>{TIPO[v.tipo] ?? v.tipo}</td>
                  <td>{v.email ?? '—'}</td>
                  <td className="num">{v.clientes}</td>
                  <td className="num">{v.cotizaciones}</td>
                  <td className="num">{v.pedidos}</td>
                  <td>
                    <span className={`pill ${v.activo ? 'pill-ok' : ''}`}>{v.activo ? 'Activo' : 'Inactivo'}</span>
                  </td>
                  {editable && (
                    <td>
                      {borrando === v.id ? (
                        <span style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '.8rem' }}>¿Borrar «{v.nombre}»?</span>
                          <button type="button" className="btn btn-peligro btn-chico" disabled={pendiente} data-accion="confirmar-borrar-vendedor"
                                  onClick={() => hacer(() => borrarVendedor(v.id), () => setBorrando(null))}>Sí, borrar</button>
                          <button type="button" className="btn btn-sutil btn-chico" disabled={pendiente} onClick={() => setBorrando(null)}>No</button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: '.3rem', flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-sutil btn-chico" disabled={pendiente} data-accion="editar-vendedor"
                                  onClick={() => { setEditando(v.id); setNuevo(false); setAviso(null); }}>Editar</button>
                          <button type="button" className="btn btn-sutil btn-chico" disabled={pendiente}
                                  data-accion={v.activo ? 'desactivar-vendedor' : 'reactivar-vendedor'}
                                  onClick={() => hacer(() => cambiarEstadoVendedor(v.id, !v.activo))}>
                            {v.activo ? 'Desactivar' : 'Reactivar'}
                          </button>
                          <button type="button" className="btn btn-sutil btn-chico" data-accion="borrar-vendedor"
                                  disabled={pendiente || usos > 0}
                                  title={usos > 0 ? 'Ya se usó: no se borra, se desactiva (sus documentos lo conservan)' : `Borrar ${v.nombre}`}
                                  onClick={() => { setBorrando(v.id); setAviso(null); }}>Borrar</button>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
