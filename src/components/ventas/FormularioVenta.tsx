'use client';

/**
 * ============================================================================
 *  FORMULARIO DE VENTA · sirve para cotización y para pedido directo
 * ============================================================================
 *  Es el mismo formulario en los dos casos —cliente, productos, precio,
 *  descuento, totales— así que se define UNA vez y se le dice en qué modo
 *  trabaja. Lo único que cambia son tres campos:
 *
 *    COTIZACIÓN          PEDIDO DIRECTO
 *    validez en días     orden de compra del cliente
 *                        prioridad
 *                        fechas de solicitud y compromiso
 *
 *  ¿Por qué existen los dos caminos?
 *  Porque en Santa Mónica unos clientes negocian el precio antes de pedir y
 *  otros piden directo. Obligar a inventarse una cotización para el segundo
 *  caso ensuciaría el indicador de conversión, que es justo lo que se quiere
 *  medir.
 *
 *  Tres cosas que se cuidaron en la experiencia:
 *   1. QUE NO HAYA QUE ADIVINAR NADA. Al elegir un producto, el sistema
 *      consulta solo el precio que le toca a ese cliente por ese volumen y
 *      muestra cuánto hay disponible.
 *   2. QUE AVISE ANTES DE EQUIVOCARSE. Si la cantidad supera lo disponible,
 *      la línea se marca en ámbar al instante.
 *   3. QUE LOS TOTALES SE VEAN SIEMPRE. La barra inferior queda fija.
 * ============================================================================
 */
import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  crearCotizacion,
  actualizarCotizacion,
  consultarPrecio,
} from '@/app/(erp)/ventas/cotizaciones/acciones';
import { crearPedidoDirecto } from '@/app/(erp)/ventas/pedidos/acciones';
import { Icono } from '@/components/estructura/Icono';
import { num, dinero, tm } from '@/lib/formato';

export type Modo = 'cotizacion' | 'pedido';

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
type LineaUI = {
  clave: string;
  sku_presentacion_id: number;
  cantidad_tm: number;
  precio_lista_tm: number;
  precio_tm: number;
  descuento_pct: number;
  disponible_kg: number;
  consultando: boolean;
};

/**
 * Datos de una cotización que ya existe, para volver a abrirla y corregirla.
 * Cuando llegan, el formulario deja de «crear» y pasa a «actualizar»: mismos
 * campos, mismas validaciones, distinto destino al guardar. Se reutiliza el
 * componente en lugar de escribir un segundo formulario casi idéntico, porque
 * dos formularios se desincronizan a la primera regla nueva.
 */
export type DatosEdicion = {
  id: number;
  numero: string;
  cliente_id: number;
  vendedor_id: number | null;
  destino_id: number | null;
  lista_id: number | null;
  moneda: 'USD' | 'PEN';
  tipo_cambio: number;
  incoterm: 'EXW' | 'FOB' | 'CFR' | 'CIF' | 'DAP';
  validez_dias: number;
  observaciones: string | null;
  lineas: {
    sku_presentacion_id: number;
    cantidad_tm: number;
    precio_lista_tm: number;
    precio_tm: number;
    descuento_pct: number;
  }[];
};

const nuevaClave = () => Math.random().toString(36).slice(2, 9);
const hoyISO = () => new Date().toISOString().slice(0, 10);
const enDiasISO = (dias: number) =>
  new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

export function FormularioVenta({
  modo,
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
  edicion,
}: {
  modo: Modo;
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
  /** Presente solo cuando se está corrigiendo una cotización existente. */
  edicion?: DatosEdicion;
}) {
  const router = useRouter();
  const [guardando, iniciar] = useTransition();
  const esPedido = modo === 'pedido';
  const esEdicion = !!edicion;

  /* ----------------------------------------------------------------------
     Cabecera común.
     Cada campo arranca con el valor guardado si estamos editando, y con el
     valor por defecto si estamos creando. Es el único sitio donde el modo
     edición cambia algo: de ahí en adelante el formulario se comporta igual.
     ---------------------------------------------------------------------- */
  const [clienteId, setClienteId] = useState<number | ''>(edicion?.cliente_id ?? '');
  const [vendedorId, setVendedorId] = useState<number | ''>(edicion?.vendedor_id ?? '');
  const [destinoId, setDestinoId] = useState<number | ''>(edicion?.destino_id ?? '');
  const [listaId, setListaId] = useState<number | ''>(edicion?.lista_id ?? listas[0]?.id ?? '');
  const [moneda, setMoneda] = useState<'USD' | 'PEN'>(edicion?.moneda ?? 'USD');
  const [tipoCambio, setTipoCambio] = useState(edicion?.tipo_cambio ?? tipoCambioDefecto);
  const [incoterm, setIncoterm] = useState<'EXW' | 'FOB' | 'CFR' | 'CIF' | 'DAP'>(
    edicion?.incoterm ?? 'FOB'
  );
  const [observaciones, setObservaciones] = useState(edicion?.observaciones ?? '');

  /* ---- Solo cotización ---- */
  const [validez, setValidez] = useState(edicion?.validez_dias ?? validezDefecto);

  /* ---- Solo pedido ---- */
  const [ocCliente, setOcCliente] = useState('');
  const [prioridad, setPrioridad] = useState<'baja' | 'normal' | 'alta' | 'urgente'>('normal');
  const [fechaSolicitada, setFechaSolicitada] = useState(hoyISO());
  const [fechaComprometida, setFechaComprometida] = useState(enDiasISO(21));

  /* ---- Líneas ---- */
  const [lineas, setLineas] = useState<LineaUI[]>(() =>
    (edicion?.lineas ?? []).map((l) => ({
      ...l,
      clave: nuevaClave(),
      // El disponible se recalcula al tocar la línea; al abrir se muestra el
      // del catálogo, que ya viene cargado en `unidades`.
      disponible_kg: unidades.find((u) => u.id === l.sku_presentacion_id)?.disponible_kg ?? 0,
      consultando: false,
    }))
  );
  const [busqueda, setBusqueda] = useState('');
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  const cliente = clientes.find((c) => c.id === clienteId);

  /* ---- Buscador de productos: filtra en el navegador, sin esperas ---- */
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
      setMensaje({ ok: false, texto: 'Ese producto ya está en la lista. Modifique su cantidad.' });
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

  /** Al cambiar la cantidad puede cambiar el tramo de la escala de precio. */
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
      setMensaje({ ok: false, texto: 'Elija el cliente.' });
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
    if (esPedido && fechaComprometida < fechaSolicitada) {
      setMensaje({ ok: false, texto: 'La fecha comprometida no puede ser anterior a la de solicitud.' });
      return;
    }

    // Se descartan las tres ayudas de pantalla —la clave de React, el
    // disponible y el indicador de consulta en curso— porque son del
    // formulario, no del documento que se guarda.
    const lineasLimpias = lineas.map(({ clave: _c, disponible_kg: _d, consultando: _q, ...l }) => l);

    iniciar(async () => {
      const r = esEdicion
        ? await actualizarCotizacion(edicion.id, {
            cliente_id: Number(clienteId),
            vendedor_id: vendedorId ? Number(vendedorId) : null,
            destino_id: destinoId ? Number(destinoId) : null,
            lista_id: listaId ? Number(listaId) : null,
            moneda,
            tipo_cambio: tipoCambio,
            incoterm,
            validez_dias: validez,
            observaciones: observaciones.trim() || null,
            lineas: lineasLimpias,
          })
        : esPedido
        ? await crearPedidoDirecto({
            cliente_id: Number(clienteId),
            vendedor_id: vendedorId ? Number(vendedorId) : null,
            destino_id: destinoId ? Number(destinoId) : null,
            moneda,
            tipo_cambio: tipoCambio,
            incoterm,
            oc_cliente: ocCliente.trim() || null,
            prioridad,
            fecha_solicitada: fechaSolicitada,
            fecha_comprometida: fechaComprometida,
            observaciones: observaciones.trim() || null,
            lineas: lineasLimpias,
          })
        : await crearCotizacion({
            cliente_id: Number(clienteId),
            vendedor_id: vendedorId ? Number(vendedorId) : null,
            destino_id: destinoId ? Number(destinoId) : null,
            lista_id: listaId ? Number(listaId) : null,
            moneda,
            tipo_cambio: tipoCambio,
            incoterm,
            validez_dias: validez,
            observaciones: observaciones.trim() || null,
            lineas: lineasLimpias,
          });

      if (r.ok) {
        setMensaje({ ok: true, texto: r.mensaje });
        // Se deja casi un segundo para que el usuario lea la confirmación
        // antes de que la pantalla cambie debajo de sus manos.
        setTimeout(() => {
          if (esEdicion) router.push(`/ventas/cotizaciones/${edicion.id}`);
          else if (esPedido) router.push(`/ventas/pedidos/${r.id}`);
          else router.push(`/ventas/cotizaciones/${r.id}`);
        }, 900);
      } else {
        setMensaje({ ok: false, texto: r.mensaje });
      }
    });
  }

  const rutaVolver = esEdicion
    ? `/ventas/cotizaciones/${edicion.id}`
    : esPedido
    ? '/ventas/pedidos'
    : '/ventas/cotizaciones';
  const textoGuardar = esEdicion
    ? 'Guardar cambios'
    : esPedido
    ? 'Registrar pedido'
    : 'Guardar cotización';

  return (
    <div className="form-venta">
      {/* ══════ CABECERA ══════ */}
      <section className="panel mb-espacio">
        <div className="panel-cabecera">
          <span className="panel-titulo">
            {esPedido ? 'Datos del pedido' : 'Datos de la cotización'}
          </span>
        </div>
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
                  setMensaje({
                    ok: false,
                    texto: 'Se limpiaron las líneas: los precios dependen del cliente.',
                  });
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
            <select
              className="campo"
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Venta directa</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </label>

          <label className="form-campo">
            <span className="etiqueta">Destino</span>
            <select
              className="campo"
              value={destinoId}
              onChange={(e) => setDestinoId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Sin definir</option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre} · {d.pais}</option>)}
            </select>
          </label>

          {!esPedido && (
            <label className="form-campo">
              <span className="etiqueta">Lista de precio</span>
              <select
                className="campo"
                value={listaId}
                onChange={(e) => setListaId(e.target.value ? Number(e.target.value) : '')}
              >
                {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>
            </label>
          )}

          {esPedido && (
            <label className="form-campo">
              <span className="etiqueta">Orden de compra del cliente</span>
              <input
                className="campo" type="text" maxLength={40}
                placeholder="PO-12345"
                value={ocCliente}
                onChange={(e) => setOcCliente(e.target.value)}
              />
            </label>
          )}

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
            <select
              className="campo"
              value={incoterm}
              onChange={(e) => setIncoterm(e.target.value as typeof incoterm)}
            >
              <option value="FOB">FOB · hasta subirlo al barco</option>
              <option value="CFR">CFR · flete incluido</option>
              <option value="CIF">CIF · flete y seguro</option>
              <option value="EXW">EXW · en planta</option>
              <option value="DAP">DAP · entregado en destino</option>
            </select>
          </label>

          {!esPedido && (
            <label className="form-campo">
              <span className="etiqueta">Validez (días)</span>
              <input
                className="campo" type="number" min="1" max="365"
                value={validez}
                onChange={(e) => setValidez(Number(e.target.value))}
              />
            </label>
          )}

          {esPedido && (
            <>
              <label className="form-campo">
                <span className="etiqueta">Prioridad</span>
                <select
                  className="campo"
                  value={prioridad}
                  onChange={(e) => setPrioridad(e.target.value as typeof prioridad)}
                >
                  <option value="baja">Baja</option>
                  <option value="normal">Normal</option>
                  <option value="alta">Alta</option>
                  <option value="urgente">Urgente</option>
                </select>
              </label>

              <label className="form-campo">
                <span className="etiqueta">Fecha de solicitud</span>
                <input
                  className="campo" type="date"
                  value={fechaSolicitada}
                  onChange={(e) => setFechaSolicitada(e.target.value)}
                />
              </label>

              <label className="form-campo">
                <span className="etiqueta">Fecha comprometida</span>
                <input
                  className="campo" type="date"
                  value={fechaComprometida}
                  min={fechaSolicitada}
                  onChange={(e) => setFechaComprometida(e.target.value)}
                />
                {fechaComprometida < fechaSolicitada && (
                  <span className="form-aviso-campo">No puede ser anterior a la solicitud.</span>
                )}
              </label>
            </>
          )}

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
          <span className="form-nota-cab">El precio se resuelve solo según cliente y volumen</span>
        </div>

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
          <Link href={rutaVolver} className="btn btn-secundario">Cancelar</Link>
          <button type="button" className="btn btn-primario" onClick={guardar} disabled={guardando}>
            <Icono nombre="guardar" tamano={15} />
            {guardando ? 'Guardando…' : textoGuardar}
          </button>
        </div>
      </div>

      {mensaje && (
        <p className={mensaje.ok ? 'form-mensaje ok' : 'form-mensaje error'} role="status">
          {mensaje.texto}
        </p>
      )}
    </div>
  );
}
