'use client';

/**
 * ============================================================================
 *  FORMULARIO DE NUEVA COTIZACIÓN
 * ============================================================================
 *  Es la pantalla más interactiva del sistema, así que se cuidaron tres cosas:
 *
 *  1. QUE NO HAYA QUE ADIVINAR NADA
 *     Al elegir un producto, el sistema consulta solo el precio que le
 *     corresponde a ese cliente por ese volumen, y muestra cuánto hay
 *     disponible. El vendedor no tiene que llamar al almacén.
 *
 *  2. QUE AVISE ANTES DE EQUIVOCARSE
 *     Si la cantidad supera lo disponible, la línea se marca en ámbar al
 *     instante. No se bloquea —a veces se cotiza producción futura— pero
 *     queda advertido.
 *
 *  3. QUE LOS TOTALES SE VEAN SIEMPRE
 *     La barra inferior queda fija con el total, el IGV y las toneladas,
 *     actualizándose con cada tecla.
 * ============================================================================
 */
import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { crearCotizacion, consultarPrecio, type LineaCotizacion } from '../acciones';
import { Icono } from '@/components/estructura/Icono';
import { num, dinero, tm } from '@/lib/formato';

type Unidad = {
  id: number;
  sku: string;
  especie: string;
  formato: string;
  corte: string;
  presentacion: string;
  disponible_kg: number;
};

type Opcion = { id: number; nombre: string; extra?: string };

/** Una línea en pantalla: lo que se guarda más lo que ayuda a decidir. */
type LineaUI = LineaCotizacion & {
  clave: string;
  disponible_kg: number;
  consultando: boolean;
};

const nuevaClave = () => Math.random().toString(36).slice(2, 9);

export function FormularioCotizacion({
  clientes,
  vendedores,
  destinos,
  listas,
  unidades,
  igv,
  validezDefecto,
  tipoCambioDefecto,
  topeDescuento,
  puedeAutorizarDescuento,
}: {
  clientes: (Opcion & { pais: string; moneda: string; bloqueado: boolean })[];
  vendedores: Opcion[];
  destinos: (Opcion & { pais: string })[];
  listas: (Opcion & { moneda: string; incoterm: string })[];
  unidades: Unidad[];
  igv: number;
  validezDefecto: number;
  tipoCambioDefecto: number;
  topeDescuento: number;
  puedeAutorizarDescuento: boolean;
}) {
  const router = useRouter();
  const [guardando, iniciar] = useTransition();

  /* ---- Cabecera ---- */
  const [clienteId, setClienteId] = useState<number | ''>('');
  const [vendedorId, setVendedorId] = useState<number | ''>('');
  const [destinoId, setDestinoId] = useState<number | ''>('');
  const [listaId, setListaId] = useState<number | ''>(listas[0]?.id ?? '');
  const [moneda, setMoneda] = useState<'USD' | 'PEN'>('USD');
  const [tipoCambio, setTipoCambio] = useState(tipoCambioDefecto);
  const [incoterm, setIncoterm] = useState<'EXW' | 'FOB' | 'CFR' | 'CIF' | 'DAP'>('FOB');
  const [validez, setValidez] = useState(validezDefecto);
  const [observaciones, setObservaciones] = useState('');

  /* ---- Líneas ---- */
  const [lineas, setLineas] = useState<LineaUI[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  const cliente = clientes.find((c) => c.id === clienteId);

  /* ---- Buscador de productos ---- */
  const resultados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return unidades
      .filter((u) =>
        `${u.sku} ${u.especie} ${u.formato} ${u.corte} ${u.presentacion}`.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [busqueda, unidades]);

  /* ---- Totales, recalculados con cada cambio ---- */
  const totales = useMemo(() => {
    const subtotal = lineas.reduce(
      (s, l) => s + l.cantidad_tm * l.precio_tm * (1 - l.descuento_pct / 100),
      0
    );
    const toneladas = lineas.reduce((s, l) => s + l.cantidad_tm, 0);
    const impuesto = subtotal * (igv / 100);
    return { subtotal, impuesto, total: subtotal + impuesto, toneladas };
  }, [lineas, igv]);

  /** Agrega un producto y consulta su precio para este cliente. */
  async function agregar(u: Unidad) {
    if (!clienteId) {
      setMensaje({ ok: false, texto: 'Elija primero el cliente: el precio depende de él.' });
      return;
    }
    if (lineas.some((l) => l.sku_presentacion_id === u.id)) {
      setMensaje({ ok: false, texto: 'Ese producto ya está en la cotización. Modifique su cantidad.' });
      return;
    }

    const clave = nuevaClave();
    const cantidadInicial = 25;

    setLineas((ls) => [
      ...ls,
      {
        clave,
        sku_presentacion_id: u.id,
        cantidad_tm: cantidadInicial,
        precio_lista_tm: 0,
        precio_tm: 0,
        descuento_pct: 0,
        disponible_kg: u.disponible_kg,
        consultando: true,
      },
    ]);
    setBusqueda('');
    setMensaje(null);

    // El precio lo resuelve la base de datos, no el navegador
    const { precio, disponible_kg } = await consultarPrecio(u.id, Number(clienteId), cantidadInicial);
    setLineas((ls) =>
      ls.map((l) =>
        l.clave === clave
          ? { ...l, precio_lista_tm: precio, precio_tm: precio, disponible_kg, consultando: false }
          : l
      )
    );
  }

  function actualizar(clave: string, cambios: Partial<LineaUI>) {
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)));
  }

  function quitar(clave: string) {
    setLineas((ls) => ls.filter((l) => l.clave !== clave));
  }

  /** Al cambiar la cantidad puede cambiar el tramo de precio. */
  async function recalcularPrecio(clave: string, cantidad: number) {
    const linea = lineas.find((l) => l.clave === clave);
    if (!linea || !clienteId) return;
    actualizar(clave, { consultando: true });
    const { precio } = await consultarPrecio(linea.sku_presentacion_id, Number(clienteId), cantidad);
    setLineas((ls) =>
      ls.map((l) =>
        l.clave === clave
          ? {
              ...l,
              precio_lista_tm: precio,
              // Si el usuario no había tocado el precio a mano, se actualiza
              precio_tm: l.precio_tm === l.precio_lista_tm ? precio : l.precio_tm,
              consultando: false,
            }
          : l
      )
    );
  }

  function guardar() {
    setMensaje(null);

    if (!clienteId) {
      setMensaje({ ok: false, texto: 'Elija el cliente al que va dirigida la cotización.' });
      return;
    }
    if (!lineas.length) {
      setMensaje({ ok: false, texto: 'Agregue al menos un producto.' });
      return;
    }
    const sinCantidad = lineas.findIndex((l) => !(l.cantidad_tm > 0));
    if (sinCantidad >= 0) {
      setMensaje({ ok: false, texto: `La cantidad de la línea ${sinCantidad + 1} debe ser mayor que cero.` });
      return;
    }

    iniciar(async () => {
      const r = await crearCotizacion({
        cliente_id: Number(clienteId),
        vendedor_id: vendedorId ? Number(vendedorId) : null,
        destino_id: destinoId ? Number(destinoId) : null,
        lista_id: listaId ? Number(listaId) : null,
        moneda,
        tipo_cambio: tipoCambio,
        incoterm,
        validez_dias: validez,
        observaciones: observaciones.trim() || null,
        lineas: lineas.map(({ clave, disponible_kg, consultando, ...l }) => l),
      });

      if (r.ok) {
        setMensaje({ ok: true, texto: r.mensaje });
        setTimeout(() => router.push('/ventas/cotizaciones'), 900);
      } else {
        setMensaje({ ok: false, texto: r.mensaje });
      }
    });
  }

  return (
    <div className="form-cot">
      {/* ══════ CABECERA ══════ */}
      <section className="panel mb-espacio">
        <div className="panel-cabecera"><span className="panel-titulo">Datos de la cotización</span></div>
        <div className="form-rejilla">
          <label className="form-campo form-ancho">
            <span className="etiqueta">Cliente *</span>
            <select
              className="campo"
              value={clienteId}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : '';
                setClienteId(id);
                const c = clientes.find((x) => x.id === id);
                if (c) {
                  setMoneda(c.moneda as 'USD' | 'PEN');
                  setIncoterm(c.moneda === 'PEN' ? 'EXW' : 'FOB');
                }
                // Los precios dependen del cliente: hay que rehacerlos
                if (lineas.length) {
                  setLineas([]);
                  setMensaje({ ok: false, texto: 'Se limpiaron las líneas: los precios dependen del cliente.' });
                }
              }}
            >
              <option value="">— Elija un cliente —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id} disabled={c.bloqueado}>
                  {c.nombre} · {c.pais}{c.bloqueado ? ' (bloqueado)' : ''}
                </option>
              ))}
            </select>
            {cliente?.bloqueado && (
              <span className="form-aviso-campo">Este cliente tiene el crédito bloqueado.</span>
            )}
          </label>

          <label className="form-campo">
            <span className="etiqueta">Vendedor</span>
            <select className="campo" value={vendedorId} onChange={(e) => setVendedorId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Venta directa</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </label>

          <label className="form-campo">
            <span className="etiqueta">Destino</span>
            <select className="campo" value={destinoId} onChange={(e) => setDestinoId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Sin definir</option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre} · {d.pais}</option>)}
            </select>
          </label>

          <label className="form-campo">
            <span className="etiqueta">Lista de precio</span>
            <select className="campo" value={listaId} onChange={(e) => setListaId(e.target.value ? Number(e.target.value) : '')}>
              {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          </label>

          <label className="form-campo">
            <span className="etiqueta">Moneda</span>
            <select className="campo" value={moneda} onChange={(e) => setMoneda(e.target.value as 'USD' | 'PEN')}>
              <option value="USD">Dólares (USD)</option>
              <option value="PEN">Soles (PEN)</option>
            </select>
          </label>

          <label className="form-campo">
            <span className="etiqueta">Tipo de cambio</span>
            <input
              className="campo" type="number" step="0.001" min="0.001"
              value={tipoCambio}
              onChange={(e) => setTipoCambio(Number(e.target.value))}
            />
          </label>

          <label className="form-campo">
            <span className="etiqueta">Incoterm</span>
            <select className="campo" value={incoterm} onChange={(e) => setIncoterm(e.target.value as typeof incoterm)}>
              <option value="FOB">FOB · hasta subirlo al barco</option>
              <option value="CFR">CFR · flete incluido</option>
              <option value="CIF">CIF · flete y seguro</option>
              <option value="EXW">EXW · en planta</option>
              <option value="DAP">DAP · entregado en destino</option>
            </select>
          </label>

          <label className="form-campo">
            <span className="etiqueta">Validez (días)</span>
            <input
              className="campo" type="number" min="1" max="365"
              value={validez}
              onChange={(e) => setValidez(Number(e.target.value))}
            />
          </label>

          <label className="form-campo form-ancho">
            <span className="etiqueta">Observaciones</span>
            <input
              className="campo" type="text" maxLength={300}
              placeholder="Condiciones especiales, plazos de entrega, notas para el cliente…"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
            />
          </label>
        </div>
      </section>

      {/* ══════ PRODUCTOS ══════ */}
      <section className="panel mb-espacio">
        <div className="panel-cabecera">
          <span className="panel-titulo">Productos · {lineas.length} línea(s)</span>
          <span className="form-nota-cab">
            El precio se resuelve solo según cliente y volumen
          </span>
        </div>

        {/* --- Buscador --- */}
        <div className="form-buscador">
          <Icono nombre="buscar" tamano={15} className="form-buscador-lupa" />
          <input
            className="campo form-buscador-input"
            type="search"
            placeholder={clienteId ? 'Escriba el SKU, el corte o la especie…' : 'Elija primero el cliente'}
            value={busqueda}
            disabled={!clienteId}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          {resultados.length > 0 && (
            <ul className="form-resultados">
              {resultados.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => agregar(u)}>
                    <span className="form-res-sku">{u.sku}</span>
                    <span className="form-res-nombre">
                      {u.especie} · {u.formato} · {u.corte}
                      <small>{u.presentacion}</small>
                    </span>
                    <span className={`form-res-stock ${u.disponible_kg > 0 ? 'hay' : 'nohay'}`}>
                      {u.disponible_kg > 0 ? `${tm(u.disponible_kg)} TM` : 'sin stock'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* --- Líneas --- */}
        {lineas.length === 0 ? (
          <div className="vacio">
            <strong>Sin productos todavía</strong>
            <span>Busque arriba por código de SKU, corte o especie y haga clic para agregarlo.</span>
          </div>
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Cantidad (TM)</th>
                  <th className="num">Disponible</th>
                  <th className="num">Precio lista</th>
                  <th className="num">Desc. %</th>
                  <th className="num">Precio final</th>
                  <th className="num">Importe</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => {
                  const u = unidades.find((x) => x.id === l.sku_presentacion_id);
                  const importe = l.cantidad_tm * l.precio_tm * (1 - l.descuento_pct / 100);
                  const excede = l.cantidad_tm * 1000 > l.disponible_kg;
                  const descAlto = l.descuento_pct > topeDescuento;
                  return (
                    <tr key={l.clave} data-alerta={excede || descAlto ? 'si' : 'no'}>
                      <td>
                        <span className="mono" style={{ color: 'var(--tinta-3)' }}>{u?.sku}</span>{' '}
                        {u?.especie} · {u?.formato}
                        <br />
                        <span style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>
                          {u?.corte} · {u?.presentacion}
                        </span>
                      </td>
                      <td className="num">
                        <input
                          className="campo form-mini"
                          type="number" min="0.001" step="0.5"
                          value={l.cantidad_tm}
                          onChange={(e) => actualizar(l.clave, { cantidad_tm: Number(e.target.value) })}
                          onBlur={(e) => recalcularPrecio(l.clave, Number(e.target.value))}
                        />
                      </td>
                      <td className="num">
                        <span style={{ color: excede ? 'var(--atencion)' : 'var(--tinta-3)' }}>
                          {tm(l.disponible_kg)} TM
                        </span>
                        {excede && <><br /><span className="pill pill-atencion">Excede</span></>}
                      </td>
                      <td className="num">
                        {l.consultando ? <span className="cargando">…</span> : num(l.precio_lista_tm, 2)}
                      </td>
                      <td className="num">
                        <input
                          className="campo form-mini"
                          type="number" min="0" max="100" step="0.5"
                          value={l.descuento_pct}
                          onChange={(e) => actualizar(l.clave, { descuento_pct: Number(e.target.value) })}
                        />
                        {descAlto && !puedeAutorizarDescuento && (
                          <><br /><span className="pill pill-critico">Requiere autorización</span></>
                        )}
                      </td>
                      <td className="num">
                        <input
                          className="campo form-mini form-mini-ancho"
                          type="number" min="0" step="0.01"
                          value={l.precio_tm}
                          onChange={(e) => actualizar(l.clave, { precio_tm: Number(e.target.value) })}
                        />
                      </td>
                      <td className="num"><strong>{dinero(importe, moneda, 2)}</strong></td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sutil form-quitar"
                          onClick={() => quitar(l.clave)}
                          aria-label={`Quitar la línea ${i + 1}`}
                          title="Quitar esta línea"
                        >
                          <Icono nombre="papelera" tamano={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ══════ BARRA DE TOTALES ══════ */}
      <div className="form-totales">
        <div className="form-totales-cifras">
          <div><span>Toneladas</span><strong>{num(totales.toneladas, 3)} TM</strong></div>
          <div><span>Subtotal</span><strong>{dinero(totales.subtotal, moneda, 2)}</strong></div>
          <div><span>IGV ({igv} %)</span><strong>{dinero(totales.impuesto, moneda, 2)}</strong></div>
          <div className="destacado"><span>Total</span><strong>{dinero(totales.total, moneda, 2)}</strong></div>
        </div>
        <div className="form-totales-acciones">
          <Link href="/ventas/cotizaciones" className="btn btn-secundario">Cancelar</Link>
          <button type="button" className="btn btn-primario" onClick={guardar} disabled={guardando}>
            <Icono nombre="guardar" tamano={15} />
            {guardando ? 'Guardando…' : 'Guardar cotización'}
          </button>
        </div>
      </div>

      {mensaje && (
        <p className={mensaje.ok ? 'form-mensaje ok' : 'form-mensaje error'} role="status">
          {mensaje.texto}
        </p>
      )}

      <style jsx>{`
        .form-cot { padding-bottom: 5rem; }

        .form-rejilla {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
          gap: 0.85rem;
          padding: 1rem;
        }
        .form-campo { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
        .form-ancho { grid-column: 1 / -1; }
        @media (min-width: 900px) { .form-ancho { grid-column: span 2; } }
        .form-aviso-campo { font-size: 0.72rem; color: var(--critico); margin-top: 0.2rem; }
        .form-nota-cab { font-size: 0.72rem; color: var(--tinta-3); }

        /* --- Buscador de productos --- */
        .form-buscador { position: relative; padding: 0.85rem 1rem; border-bottom: 1px solid var(--linea); }
        .form-buscador :global(.form-buscador-lupa) {
          position: absolute;
          inset-inline-start: 1.6rem;
          top: 1.35rem;
          color: var(--tinta-3);
          pointer-events: none;
        }
        .form-buscador-input { padding-inline-start: 2.1rem; }
        .form-resultados {
          position: absolute;
          inset-inline: 1rem;
          top: calc(100% - 0.4rem);
          z-index: 20;
          list-style: none;
          margin: 0;
          padding: 0.25rem;
          background: var(--superficie);
          border: 1px solid var(--linea-2);
          border-radius: var(--radio);
          box-shadow: var(--sombra);
          max-height: 20rem;
          overflow-y: auto;
        }
        .form-resultados button {
          display: grid;
          grid-template-columns: 3rem 1fr auto;
          gap: 0.6rem;
          align-items: center;
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          padding: 0.45rem 0.55rem;
          border-radius: 3px;
          cursor: pointer;
          color: var(--tinta);
          font-family: var(--font-sans);
        }
        .form-resultados button:hover { background: var(--acento-suave); }
        .form-res-sku {
          font-family: var(--font-mono);
          font-size: 0.72rem;
          color: var(--tinta-3);
        }
        .form-res-nombre { font-size: 0.82rem; min-width: 0; }
        .form-res-nombre small {
          display: block;
          font-size: 0.71rem;
          color: var(--tinta-3);
        }
        .form-res-stock {
          font-family: var(--font-mono);
          font-size: 0.7rem;
          white-space: nowrap;
        }
        .form-res-stock.hay { color: var(--ok); }
        .form-res-stock.nohay { color: var(--tinta-3); }

        /* --- Líneas --- */
        .form-cot :global(tr[data-alerta='si']) {
          background: color-mix(in srgb, var(--atencion) 7%, transparent);
        }
        .form-cot :global(.form-mini) {
          width: 5.2rem;
          padding: 0.22rem 0.4rem;
          font-size: 0.8rem;
          text-align: right;
          font-family: var(--font-mono);
        }
        .form-cot :global(.form-mini-ancho) { width: 6.5rem; }
        .form-quitar { padding: 0.25rem; color: var(--tinta-3); }
        .form-quitar:hover { color: var(--critico); }

        /* --- Barra de totales, fija abajo --- */
        .form-totales {
          position: sticky;
          bottom: 0;
          z-index: 15;
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          align-items: center;
          justify-content: space-between;
          padding: 0.75rem 1rem;
          background: color-mix(in srgb, var(--superficie) 94%, transparent);
          backdrop-filter: blur(8px);
          border: 1px solid var(--linea-2);
          border-radius: var(--radio);
          box-shadow: var(--sombra);
        }
        .form-totales-cifras { display: flex; flex-wrap: wrap; gap: 1.5rem; }
        .form-totales-cifras > div { display: flex; flex-direction: column; }
        .form-totales-cifras span {
          font-family: var(--font-mono);
          font-size: 0.58rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--tinta-3);
        }
        .form-totales-cifras strong {
          font-family: var(--font-titulo);
          font-size: 1rem;
          font-variant-numeric: tabular-nums;
        }
        .form-totales-cifras .destacado strong { font-size: 1.25rem; color: var(--acento); }
        .form-totales-acciones { display: flex; gap: 0.45rem; align-items: center; }

        .form-mensaje {
          margin: 0.85rem 0 0;
          padding: 0.65rem 0.85rem;
          border-radius: var(--radio);
          font-size: 0.85rem;
          max-width: none;
        }
        .form-mensaje.ok {
          background: var(--ok-suave);
          color: var(--ok);
          border: 1px solid color-mix(in srgb, var(--ok) 30%, transparent);
        }
        .form-mensaje.error {
          background: var(--critico-suave);
          color: var(--critico);
          border: 1px solid color-mix(in srgb, var(--critico) 30%, transparent);
        }
      `}</style>
    </div>
  );
}
