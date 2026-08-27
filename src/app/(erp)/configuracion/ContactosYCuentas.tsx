'use client';

/**
 * ============================================================================
 *  MAESTRO DE CONTACTOS Y CUENTAS BANCARIAS
 * ============================================================================
 *  Dos tablas editables en la misma pantalla, porque se usan juntas: las dos
 *  salen impresas en la cotización y en la proforma.
 *
 *  La edición es EN LA PROPIA FILA, sin abrir otra pantalla ni un modal. Es
 *  una decisión pensada para lo que de verdad se hace aquí: corregir un
 *  teléfono mal escrito o marcar otro contacto como principal. Obligar a
 *  navegar para cambiar nueve caracteres es lo que hace que la gente no
 *  actualice los datos y acabe usando su libreta.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icono } from '@/components/estructura/Icono';
import {
  crearContacto, actualizarContacto, desactivarContacto, reactivarContacto,
  crearCuenta, actualizarCuenta, cambiarEstadoCuenta,
  type DatosContacto, type DatosCuenta,
} from './accionesContactos';

type Contacto = {
  id: number;
  cliente_id: number;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  email: string | null;
  principal: boolean;
  activo: boolean;
  cliente: string;
};

type Cuenta = {
  id: number;
  banco: string;
  tipo: 'corriente' | 'ahorros' | 'detraccion';
  moneda: 'USD' | 'PEN';
  numero: string;
  cci: string | null;
  swift: string | null;
  titular: string | null;
  principal: boolean;
  activo: boolean;
  observaciones: string | null;
};

const NOMBRE_TIPO: Record<string, string> = {
  corriente: 'Corriente',
  ahorros: 'Ahorros',
  detraccion: 'Detracción',
};

const CONTACTO_VACIO = (clienteId: number): DatosContacto => ({
  cliente_id: clienteId,
  nombre: '',
  cargo: '',
  telefono: '',
  email: '',
  principal: false,
});

const CUENTA_VACIA: DatosCuenta = {
  banco: '',
  tipo: 'corriente',
  moneda: 'USD',
  numero: '',
  cci: '',
  swift: '',
  titular: 'INDUSTRIAL PESQUERA SANTA MÓNICA S.A.C.',
  principal: false,
  observaciones: '',
};

export function ContactosYCuentas({
  contactos,
  cuentas,
  clientes,
  puedeContactos,
  puedeCuentas,
}: {
  contactos: Contacto[];
  cuentas: Cuenta[];
  clientes: { id: number; nombre: string }[];
  puedeContactos: boolean;
  puedeCuentas: boolean;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  /* ---- Contactos ---- */
  const [filtro, setFiltro] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [editandoContacto, setEditandoContacto] = useState<number | null>(null);
  const [nuevoContacto, setNuevoContacto] = useState<DatosContacto | null>(null);
  const [borradorContacto, setBorradorContacto] = useState<DatosContacto | null>(null);

  /* ---- Cuentas ---- */
  const [editandoCuenta, setEditandoCuenta] = useState<number | null>(null);
  const [nuevaCuenta, setNuevaCuenta] = useState<DatosCuenta | null>(null);
  const [borradorCuenta, setBorradorCuenta] = useState<DatosCuenta | null>(null);

  /** Ejecuta una acción y muestra su resultado, sin repetir el mismo bloque. */
  function ejecutar(accion: () => Promise<{ ok: boolean; mensaje: string }>, alTerminar?: () => void) {
    setMensaje(null);
    iniciar(async () => {
      const r = await accion();
      setMensaje({ ok: r.ok, texto: r.mensaje });
      if (r.ok) {
        alTerminar?.();
        router.refresh();
      }
    });
  }

  const texto = filtro.trim().toLowerCase();
  const visibles = contactos.filter((c) => {
    if (!verInactivos && !c.activo) return false;
    if (!texto) return true;
    return `${c.nombre} ${c.cargo ?? ''} ${c.email ?? ''} ${c.telefono ?? ''} ${c.cliente}`
      .toLowerCase()
      .includes(texto);
  });

  return (
    <>
      {mensaje && (
        <div
          className={`ficha-aviso ${mensaje.ok ? 'ficha-aviso-ok' : 'ficha-aviso-critico'}`}
          role="status"
        >
          <Icono nombre={mensaje.ok ? 'calidad' : 'alerta'} tamano={17} />
          <span>{mensaje.texto}</span>
        </div>
      )}

      {/* ══════════════════════ CONTACTOS ══════════════════════ */}
      <section className="panel mb-espacio">
        <div className="panel-cabecera">
          <span className="panel-titulo">
            Contactos de clientes · {visibles.length} de {contactos.length}
          </span>
          <div className="panel-acciones">
            <label className="maestro-interruptor">
              <input
                type="checkbox"
                checked={verInactivos}
                onChange={(e) => setVerInactivos(e.target.checked)}
              />
              Ver desactivados
            </label>
            {puedeContactos && (
              <button
                type="button"
                className="btn btn-primario"
                onClick={() => setNuevoContacto(CONTACTO_VACIO(clientes[0]?.id ?? 0))}
                disabled={!!nuevoContacto || clientes.length === 0}
              >
                <Icono nombre="mas" tamano={15} />
                Nuevo contacto
              </button>
            )}
          </div>
        </div>

        <div className="maestro-filtro">
          <Icono nombre="buscar" tamano={14} />
          <input
            className="campo"
            type="search"
            placeholder="Buscar por nombre, cargo, correo, teléfono o cliente…"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          />
        </div>

        <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
          <table className="datos">
            <thead>
              <tr>
                <th>Cliente</th><th>Nombre</th><th>Cargo</th>
                <th>Teléfono</th><th>Correo</th><th>Principal</th>
                {puedeContactos && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {/* ---- Alta ---- */}
              {nuevoContacto && (
                <tr className="maestro-fila-edicion">
                  <td>
                    <select
                      className="campo"
                      value={nuevoContacto.cliente_id}
                      onChange={(e) =>
                        setNuevoContacto({ ...nuevoContacto, cliente_id: Number(e.target.value) })
                      }
                    >
                      {clientes.map((c) => (
                        <option key={c.id} value={c.id}>{c.nombre}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="campo" autoFocus placeholder="Nombre y apellido"
                      value={nuevoContacto.nombre}
                      onChange={(e) => setNuevoContacto({ ...nuevoContacto, nombre: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="campo" placeholder="Jefe de Compras"
                      value={nuevoContacto.cargo ?? ''}
                      onChange={(e) => setNuevoContacto({ ...nuevoContacto, cargo: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="campo" placeholder="+51 999 999 999"
                      value={nuevoContacto.telefono ?? ''}
                      onChange={(e) => setNuevoContacto({ ...nuevoContacto, telefono: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="campo" type="email" placeholder="nombre@empresa.com"
                      value={nuevoContacto.email ?? ''}
                      onChange={(e) => setNuevoContacto({ ...nuevoContacto, email: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={nuevoContacto.principal}
                      onChange={(e) => setNuevoContacto({ ...nuevoContacto, principal: e.target.checked })}
                    />
                  </td>
                  <td>
                    <div className="acciones-fila">
                      <button
                        type="button" className="btn btn-primario" style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
                        disabled={pendiente}
                        onClick={() => ejecutar(() => crearContacto(nuevoContacto), () => setNuevoContacto(null))}
                      >
                        Guardar
                      </button>
                      <button
                        type="button" className="btn btn-sutil" style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
                        onClick={() => setNuevoContacto(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {visibles.length === 0 && !nuevoContacto && (
                <tr>
                  <td colSpan={7} style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--tinta-3)' }}>
                    No hay contactos que coincidan.
                  </td>
                </tr>
              )}

              {visibles.map((c) =>
                editandoContacto === c.id && borradorContacto ? (
                  <tr key={c.id} className="maestro-fila-edicion">
                    <td style={{ fontSize: '.78rem' }}>{c.cliente}</td>
                    <td>
                      <input
                        className="campo" autoFocus
                        value={borradorContacto.nombre}
                        onChange={(e) => setBorradorContacto({ ...borradorContacto, nombre: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="campo"
                        value={borradorContacto.cargo ?? ''}
                        onChange={(e) => setBorradorContacto({ ...borradorContacto, cargo: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="campo"
                        value={borradorContacto.telefono ?? ''}
                        onChange={(e) => setBorradorContacto({ ...borradorContacto, telefono: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="campo" type="email"
                        value={borradorContacto.email ?? ''}
                        onChange={(e) => setBorradorContacto({ ...borradorContacto, email: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={borradorContacto.principal}
                        onChange={(e) => setBorradorContacto({ ...borradorContacto, principal: e.target.checked })}
                      />
                    </td>
                    <td>
                      <div className="acciones-fila">
                        <button
                          type="button" className="btn btn-primario" style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
                          disabled={pendiente}
                          onClick={() =>
                            ejecutar(
                              () => actualizarContacto(c.id, borradorContacto),
                              () => setEditandoContacto(null)
                            )
                          }
                        >
                          Guardar
                        </button>
                        <button
                          type="button" className="btn btn-sutil" style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
                          onClick={() => setEditandoContacto(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} data-inactiva={!c.activo ? 'si' : undefined}>
                    <td style={{ fontSize: '.78rem' }}>
                      <Link href={`/ventas/clientes/${c.cliente_id}`} className="enlace-ficha">
                        {c.cliente}
                      </Link>
                    </td>
                    <td><strong style={{ fontWeight: 600 }}>{c.nombre}</strong></td>
                    <td style={{ fontSize: '.8rem' }}>{c.cargo ?? '—'}</td>
                    <td className="mono" style={{ fontSize: '.76rem' }}>{c.telefono ?? '—'}</td>
                    <td className="mono" style={{ fontSize: '.76rem' }}>{c.email ?? '—'}</td>
                    <td>
                      {c.principal ? <span className="pill pill-ok">Principal</span> : '—'}
                      {!c.activo && <span className="pill pill-neutro">Inactivo</span>}
                    </td>
                    {puedeContactos && (
                      <td>
                        <div className="acciones-fila">
                          <button
                            type="button" className="accion-btn" title="Editar"
                            onClick={() => {
                              setEditandoContacto(c.id);
                              setBorradorContacto({
                                cliente_id: c.cliente_id,
                                nombre: c.nombre,
                                cargo: c.cargo,
                                telefono: c.telefono,
                                email: c.email,
                                principal: c.principal,
                              });
                            }}
                          >
                            <Icono nombre="configuracion" tamano={14} />
                          </button>
                          {c.activo ? (
                            <button
                              type="button" className="accion-btn accion-btn-peligro"
                              title="Desactivar (no se borra: los documentos que lo citan lo conservan)"
                              disabled={pendiente}
                              onClick={() => ejecutar(() => desactivarContacto(c.id))}
                            >
                              <Icono nombre="papelera" tamano={14} />
                            </button>
                          ) : (
                            <button
                              type="button" className="accion-btn" title="Reactivar"
                              disabled={pendiente}
                              onClick={() => ejecutar(() => reactivarContacto(c.id))}
                            >
                              <Icono nombre="traslados" tamano={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>

        <p className="pie-explicativo" style={{ margin: 0, padding: '.7rem 1rem' }}>
          El contacto <strong>principal</strong> es el que se propone solo al cotizar a ese cliente.
          Nada de esto es obligatorio: una cotización se guarda igual sin contacto.
        </p>
      </section>

      {/* ══════════════════════ CUENTAS BANCARIAS ══════════════════════ */}
      <section className="panel">
        <div className="panel-cabecera">
          <span className="panel-titulo">Cuentas de cobro · {cuentas.length}</span>
          {puedeCuentas && (
            <div className="panel-acciones">
              <button
                type="button"
                className="btn btn-primario"
                onClick={() => setNuevaCuenta({ ...CUENTA_VACIA })}
                disabled={!!nuevaCuenta}
              >
                <Icono nombre="mas" tamano={15} />
                Nueva cuenta
              </button>
            </div>
          )}
        </div>

        <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
          <table className="datos">
            <thead>
              <tr>
                <th>Banco</th><th>Tipo</th><th>Moneda</th><th>Número</th>
                <th>CCI</th><th>SWIFT</th><th>Estado</th>
                {puedeCuentas && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {nuevaCuenta && (
                <FilaCuentaEditable
                  datos={nuevaCuenta}
                  onCambio={setNuevaCuenta}
                  pendiente={pendiente}
                  onGuardar={() => ejecutar(() => crearCuenta(nuevaCuenta), () => setNuevaCuenta(null))}
                  onCancelar={() => setNuevaCuenta(null)}
                />
              )}

              {cuentas.map((c) =>
                editandoCuenta === c.id && borradorCuenta ? (
                  <FilaCuentaEditable
                    key={c.id}
                    datos={borradorCuenta}
                    onCambio={setBorradorCuenta}
                    pendiente={pendiente}
                    onGuardar={() =>
                      ejecutar(() => actualizarCuenta(c.id, borradorCuenta), () => setEditandoCuenta(null))
                    }
                    onCancelar={() => setEditandoCuenta(null)}
                  />
                ) : (
                  <tr key={c.id} data-inactiva={!c.activo ? 'si' : undefined}>
                    <td>
                      <strong style={{ fontWeight: 600 }}>{c.banco}</strong>
                      {c.titular && (
                        <div style={{ fontSize: '.7rem', color: 'var(--tinta-3)' }}>{c.titular}</div>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${c.tipo === 'detraccion' ? 'pill-atencion' : 'pill-neutro'}`}>
                        {NOMBRE_TIPO[c.tipo]}
                      </span>
                    </td>
                    <td className="mono">{c.moneda}</td>
                    <td className="mono" style={{ fontSize: '.78rem' }}>{c.numero}</td>
                    <td className="mono" style={{ fontSize: '.72rem' }}>{c.cci ?? '—'}</td>
                    <td className="mono" style={{ fontSize: '.72rem' }}>{c.swift ?? '—'}</td>
                    <td>
                      {c.principal && <span className="pill pill-ok">Principal</span>}
                      {!c.activo && <span className="pill pill-neutro">De baja</span>}
                      {c.activo && !c.principal && '—'}
                    </td>
                    {puedeCuentas && (
                      <td>
                        <div className="acciones-fila">
                          <button
                            type="button" className="accion-btn" title="Editar"
                            onClick={() => {
                              setEditandoCuenta(c.id);
                              setBorradorCuenta({
                                banco: c.banco, tipo: c.tipo, moneda: c.moneda, numero: c.numero,
                                cci: c.cci, swift: c.swift, titular: c.titular,
                                principal: c.principal, observaciones: c.observaciones,
                              });
                            }}
                          >
                            <Icono nombre="configuracion" tamano={14} />
                          </button>
                          <button
                            type="button"
                            className={`accion-btn ${c.activo ? 'accion-btn-peligro' : ''}`}
                            title={c.activo ? 'Dar de baja' : 'Reactivar'}
                            disabled={pendiente}
                            onClick={() => ejecutar(() => cambiarEstadoCuenta(c.id, !c.activo))}
                          >
                            <Icono nombre={c.activo ? 'papelera' : 'traslados'} tamano={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>

        <p className="pie-explicativo" style={{ margin: 0, padding: '.7rem 1rem' }}>
          Son las cuentas de Santa Mónica: lo que se le dice al cliente dónde pagar. La de{' '}
          <strong>detracción</strong> es la del Banco de la Nación, obligatoria en el régimen SPOT
          para la venta nacional. Una cuenta nunca se borra, se da de baja: los documentos ya
          emitidos deben seguir mostrando la cuenta que decían el día que salieron.
        </p>
      </section>
    </>
  );
}

/**
 * La fila de alta y la de edición de una cuenta son idénticas, así que se
 * define una vez. Repetirla habría garantizado que un campo nuevo se añadiera
 * solo en una de las dos.
 */
function FilaCuentaEditable({
  datos,
  onCambio,
  onGuardar,
  onCancelar,
  pendiente,
}: {
  datos: DatosCuenta;
  onCambio: (d: DatosCuenta) => void;
  onGuardar: () => void;
  onCancelar: () => void;
  pendiente: boolean;
}) {
  return (
    <tr className="maestro-fila-edicion">
      <td>
        <input
          className="campo" autoFocus placeholder="Nombre del banco"
          value={datos.banco}
          onChange={(e) => onCambio({ ...datos, banco: e.target.value })}
        />
      </td>
      <td>
        <select
          className="campo"
          value={datos.tipo}
          onChange={(e) => {
            const tipo = e.target.value as DatosCuenta['tipo'];
            // La detracción solo existe en soles: se ajusta al vuelo en vez
            // de dejar que el usuario lo descubra al guardar.
            onCambio({ ...datos, tipo, moneda: tipo === 'detraccion' ? 'PEN' : datos.moneda });
          }}
        >
          <option value="corriente">Corriente</option>
          <option value="ahorros">Ahorros</option>
          <option value="detraccion">Detracción</option>
        </select>
      </td>
      <td>
        <select
          className="campo"
          value={datos.moneda}
          disabled={datos.tipo === 'detraccion'}
          onChange={(e) => onCambio({ ...datos, moneda: e.target.value as 'USD' | 'PEN' })}
        >
          <option value="USD">USD</option>
          <option value="PEN">PEN</option>
        </select>
      </td>
      <td>
        <input
          className="campo" placeholder="0011-0234-0100…"
          value={datos.numero}
          onChange={(e) => onCambio({ ...datos, numero: e.target.value })}
        />
      </td>
      <td>
        <input
          className="campo" placeholder="20 dígitos"
          value={datos.cci ?? ''}
          onChange={(e) => onCambio({ ...datos, cci: e.target.value })}
        />
      </td>
      <td>
        <input
          className="campo" placeholder="BCONPEPL"
          value={datos.swift ?? ''}
          onChange={(e) => onCambio({ ...datos, swift: e.target.value })}
        />
      </td>
      <td>
        <label className="maestro-interruptor">
          <input
            type="checkbox"
            checked={datos.principal}
            onChange={(e) => onCambio({ ...datos, principal: e.target.checked })}
          />
          Principal
        </label>
      </td>
      <td>
        <div className="acciones-fila">
          <button
            type="button" className="btn btn-primario" style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
            disabled={pendiente}
            onClick={onGuardar}
          >
            Guardar
          </button>
          <button
            type="button" className="btn btn-sutil" style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
            onClick={onCancelar}
          >
            Cancelar
          </button>
        </div>
      </td>
    </tr>
  );
}
