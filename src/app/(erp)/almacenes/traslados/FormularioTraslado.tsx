'use client';

/**
 * ============================================================================
 *  NUEVO TRASLADO ENTRE BODEGAS
 * ============================================================================
 *  Hasta ahora los traslados solo nacían desde Logística, al consolidar un
 *  embarque. Mover producto de una cámara a otra por cualquier otra razón
 *  (liberar espacio, acercarlo a la planta, juntar un producto) no tenía
 *  pantalla.
 *
 *  Este formulario arma el BORRADOR. No mueve nada: después siguen las mismas
 *  tres firmas de siempre —autorizar, despachar y recibir en destino—, en la
 *  ficha del traslado.
 *
 *  QUÉ SE OFRECE
 *  Solo lo disponible de la bodega de origen: ni lo bloqueado por Calidad ni
 *  lo apartado para un pedido. La acción del servidor lo vuelve a comprobar y
 *  la base de datos revisa cada línea (migración 069).
 * ============================================================================
 */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { crearTraslado, lotesEnBodega, type LoteTrasladable, type PalletsTrasladables } from './acciones';

type Opcion = { id: number; nombre: string };
type Vehiculo = { id: number; placa: string; transportista_id: number | null };
type Conductor = { id: number; nombre: string; transportista_id: number | null };

const cifra = (n: number, d = 1) =>
  n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });

export function FormularioTraslado({
  almacenes,
  transportistas,
  vehiculos,
  conductores,
  hoy,
}: {
  almacenes: Opcion[];
  transportistas: Opcion[];
  vehiculos: Vehiculo[];
  conductores: Conductor[];
  hoy: string;
}) {
  const router = useRouter();
  const [guardando, iniciar] = useTransition();
  const [cargando, iniciarCarga] = useTransition();

  const [origen, setOrigen] = useState(0);
  const [destino, setDestino] = useState(0);
  const [guia, setGuia] = useState('');
  const [fecha, setFecha] = useState('');
  const [transportista, setTransportista] = useState(0);
  const [vehiculo, setVehiculo] = useState(0);
  const [conductor, setConductor] = useState(0);
  const [observaciones, setObservaciones] = useState('');

  const [pallets, setPallets] = useState<PalletsTrasladables | null>(null);
  const [filtro, setFiltro] = useState('');
  /** Lo elegido: por pallet, cuántos bultos y kilos van. */
  const [elegidos, setElegidos] = useState<Map<number, { bultos: number; kg: number }>>(new Map());
  const [problema, setProblema] = useState<string | null>(null);

  function cambiarOrigen(id: number) {
    setOrigen(id);
    setElegidos(new Map());
    setPallets(null);
    setProblema(null);
    if (id === destino) setDestino(0);
    if (!id) return;
    iniciarCarga(async () => setPallets(await lotesEnBodega(id)));
  }

  const visibles = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    const lista = pallets?.lotes ?? [];
    const filtrados = t ? lista.filter((l) => `${l.codigo_pallet} ${l.producto}`.toLowerCase().includes(t)) : lista;
    /* Los elegidos, arriba: que se vea qué lleva el traslado sin buscarlo. */
    return [...filtrados].sort((a, b) => Number(elegidos.has(b.lote_id)) - Number(elegidos.has(a.lote_id)));
  }, [pallets, filtro, elegidos]);

  /** Kilos por bulto REALES del pallet (no el estándar): así el total cuadra. */
  const kgPorBulto = (l: LoteTrasladable) => (l.fisico_bultos > 0 ? l.fisico_kg / l.fisico_bultos : l.kg_por_bulto);

  function alternar(l: LoteTrasladable) {
    setElegidos((m) => {
      const n = new Map(m);
      if (n.has(l.lote_id)) n.delete(l.lote_id);
      else n.set(l.lote_id, { bultos: l.bultos, kg: Math.round(Math.min(l.disponible_kg, l.bultos * kgPorBulto(l)) * 1000) / 1000 });
      return n;
    });
    setProblema(null);
  }

  function cambiarBultos(l: LoteTrasladable, bultos: number) {
    const b = Math.max(0, Math.trunc(bultos));
    const kg = b === l.bultos ? Math.min(l.disponible_kg, l.bultos * kgPorBulto(l)) : b * kgPorBulto(l);
    setElegidos((m) => new Map(m).set(l.lote_id, { bultos: b, kg: Math.round(kg * 1000) / 1000 }));
  }

  function cambiarKg(l: LoteTrasladable, kg: number) {
    setElegidos((m) => new Map(m).set(l.lote_id, { bultos: m.get(l.lote_id)?.bultos ?? 0, kg: Math.max(0, kg) }));
  }

  const lineas = [...elegidos.entries()].map(([lote_id, v]) => ({ lote_id, bultos: v.bultos, peso_kg: v.kg }));
  const totalKg = lineas.reduce((s, l) => s + l.peso_kg, 0);
  const totalBultos = lineas.reduce((s, l) => s + l.bultos, 0);
  const porLote = new Map((pallets?.lotes ?? []).map((l) => [l.lote_id, l]));
  const lineaMal = lineas.find((x) => {
    const l = porLote.get(x.lote_id);
    return !l || x.bultos <= 0 || x.peso_kg <= 0 || x.bultos > l.bultos || x.peso_kg > l.disponible_kg + 0.001;
  });

  const listo = origen > 0 && destino > 0 && origen !== destino && lineas.length > 0 && !lineaMal;

  const vehiculosVisibles = transportista ? vehiculos.filter((v) => v.transportista_id === transportista) : vehiculos;
  const conductoresVisibles = transportista ? conductores.filter((c) => c.transportista_id === transportista) : conductores;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setProblema(null);
    iniciar(async () => {
      const r = await crearTraslado({
        almacen_origen_id: origen,
        almacen_destino_id: destino,
        guia_numero: guia.trim() || null,
        fecha_programada: fecha || null,
        transportista_id: transportista || null,
        vehiculo_id: vehiculo || null,
        conductor_id: conductor || null,
        observaciones: observaciones.trim() || null,
        lineas,
      });
      if (!r.ok) { setProblema(r.mensaje); return; }
      router.push(`/almacenes/traslados/${r.id}?creado=1`);
    });
  }

  return (
    <form className="form-maestro" onSubmit={enviar} data-formulario="traslado">
      {problema && (
        <div className="ficha-aviso ficha-aviso-critico" role="alert">
          <Icono nombre="alerta" tamano={17} />
          <span>{problema}</span>
        </div>
      )}

      {/* ---------------- De dónde a dónde ---------------- */}
      <fieldset className="form-bloque">
        <legend>De dónde a dónde</legend>
        <div className="form-rejilla">
          <label className="form-campo">
            <span>Bodega de origen <b className="req">*</b></span>
            <select className="campo" name="origen" value={origen || ''}
                    onChange={(e) => cambiarOrigen(Number(e.target.value))}>
              <option value="">Elija de dónde sale…</option>
              {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>
          <label className="form-campo">
            <span>Bodega de destino <b className="req">*</b></span>
            <select className="campo" name="destino" value={destino || ''}
                    onChange={(e) => setDestino(Number(e.target.value))}>
              <option value="">Elija a dónde va…</option>
              {almacenes.filter((a) => a.id !== origen).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>
          <label className="form-campo">
            <span>Guía de remisión</span>
            <input className="campo mono" name="guia" value={guia} maxLength={40}
                   placeholder="EG07-0000000" onChange={(e) => setGuia(e.target.value)} />
            <small>Opcional ahora. Es obligatoria al despachar; si la pone aquí, ya viene escrita.</small>
          </label>
          <label className="form-campo">
            <span>Programado para</span>
            <input className="campo" type="date" name="fecha" min={hoy} value={fecha}
                   onChange={(e) => setFecha(e.target.value)} />
          </label>
        </div>
      </fieldset>

      {/* ---------------- Qué pallets ---------------- */}
      <fieldset className="form-bloque">
        <legend>Qué pallets <b className="req">*</b></legend>

        {!origen ? (
          <p className="form-pista">Elija primero la bodega de origen: aparecerán sus pallets disponibles.</p>
        ) : cargando || !pallets ? (
          <p className="form-pista">Cargando los pallets de la bodega…</p>
        ) : (
          <>
            <div className="form-rejilla">
              <label className="form-campo form-campo-ancho">
                <span>Buscar en esta bodega</span>
                <input className="campo" name="filtro_pallets" value={filtro}
                       placeholder="Código de pallet, SKU, especie o corte"
                       onChange={(e) => setFiltro(e.target.value)} />
                <small>
                  {pallets.lotes.length} pallets disponibles.
                  {pallets.bloqueados > 0 && ` ${pallets.bloqueados} no aparecen porque están bloqueados por Calidad.`}
                  {pallets.reservadosEnteros > 0 && ` ${pallets.reservadosEnteros} no aparecen porque están enteros apartados para pedidos.`}
                </small>
              </label>
            </div>

            {visibles.length === 0 ? (
              <p className="form-pista">No hay pallets disponibles que coincidan.</p>
            ) : (
              <div className="tabla-envoltorio traslado-pallets" style={{ marginTop: '.6rem' }}>
                <table className="datos">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Pallet</th>
                      <th>Producto</th>
                      <th className="num">Meses</th>
                      <th className="num">Disponible</th>
                      <th className="num">Bultos a mover</th>
                      <th className="num">Kilos a mover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((l) => {
                      const v = elegidos.get(l.lote_id);
                      const mal = !!v && (v.bultos <= 0 || v.bultos > l.bultos || v.kg <= 0 || v.kg > l.disponible_kg + 0.001);
                      return (
                        <tr key={l.lote_id} data-elegido={v ? 'si' : 'no'} data-mal={mal ? 'si' : 'no'}>
                          <td>
                            <input type="checkbox" checked={!!v} onChange={() => alternar(l)}
                                   aria-label={`Trasladar el pallet ${l.codigo_pallet}`} />
                          </td>
                          <td className="mono">{l.codigo_pallet}</td>
                          <td style={{ fontSize: '.78rem' }}>
                            {l.producto}
                            {l.solo_nacional && <><br /><span className="pill pill-atencion">Solo mercado nacional</span></>}
                          </td>
                          <td className="num">{cifra(l.meses)}</td>
                          <td className="num mono" style={{ fontSize: '.78rem' }}>
                            {l.bultos} bultos · {cifra(l.disponible_kg)} kg
                            {l.disponible_kg < l.fisico_kg - 0.001 && (
                              <small style={{ display: 'block', color: 'var(--tinta-3)' }}>
                                de {l.fisico_bultos} · {cifra(l.fisico_kg)} kg (el resto está reservado)
                              </small>
                            )}
                          </td>
                          <td className="num">
                            {v ? (
                              <input className="campo mono" type="number" min={1} max={l.bultos} step={1}
                                     style={{ width: '5.5rem' }} value={v.bultos}
                                     onChange={(e) => cambiarBultos(l, Number(e.target.value))} />
                            ) : '—'}
                          </td>
                          <td className="num">
                            {v ? (
                              <input className="campo mono" type="number" min={0} step={0.1}
                                     style={{ width: '7.5rem' }} value={v.kg}
                                     onChange={(e) => cambiarKg(l, Number(e.target.value))} />
                            ) : '—'}
                            {v && v.kg > l.disponible_kg + 0.001 && (
                              <small style={{ display: 'block', color: 'var(--critico)' }}>
                                Más de lo disponible ({cifra(l.disponible_kg)} kg)
                              </small>
                            )}
                            {v && v.bultos > l.bultos && (
                              <small style={{ display: 'block', color: 'var(--critico)' }}>
                                Más bultos de los disponibles ({l.bultos})
                              </small>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {lineas.length > 0 && (
          <p className="form-pista" data-pista="total">
            Van <b>{lineas.length} pallet{lineas.length === 1 ? '' : 's'}</b>: {totalBultos} bultos · {cifra(totalKg)} kg
            ({cifra(totalKg / 1000, 2)} TM).
          </p>
        )}
      </fieldset>

      {/* ---------------- Transporte ---------------- */}
      <fieldset className="form-bloque">
        <legend>Transporte (opcional)</legend>
        <div className="form-rejilla">
          <label className="form-campo">
            <span>Transportista</span>
            <select className="campo" value={transportista || ''}
                    onChange={(e) => { setTransportista(Number(e.target.value)); setVehiculo(0); setConductor(0); }}>
              <option value="">Sin asignar</option>
              {transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
          <label className="form-campo">
            <span>Vehículo</span>
            <select className="campo" value={vehiculo || ''} onChange={(e) => setVehiculo(Number(e.target.value))}>
              <option value="">Sin asignar</option>
              {vehiculosVisibles.map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}
            </select>
          </label>
          <label className="form-campo">
            <span>Conductor</span>
            <select className="campo" value={conductor || ''} onChange={(e) => setConductor(Number(e.target.value))}>
              <option value="">Sin asignar</option>
              {conductoresVisibles.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="form-campo form-campo-ancho">
            <span>Observaciones</span>
            <input className="campo" value={observaciones} maxLength={200}
                   placeholder="Por qué se traslada (liberar espacio, acercarlo a la planta…)"
                   onChange={(e) => setObservaciones(e.target.value)} />
          </label>
        </div>
      </fieldset>

      <div className="form-acciones">
        <button type="submit" className="btn btn-primario" disabled={guardando || !listo} data-accion="crear-traslado">
          <Icono nombre="traslados" tamano={15} />
          {guardando ? 'Creando…' : 'Crear traslado'}
        </button>
        <span className="form-pista" style={{ margin: 0 }} data-pista="falta">
          {!listo
            ? `Falta: ${[
                !origen && 'la bodega de origen',
                !destino && 'la bodega de destino',
                lineas.length === 0 && 'elegir al menos un pallet',
                lineaMal && 'corregir los bultos o kilos marcados en rojo',
              ].filter(Boolean).join(', ')}.`
            : 'Se crea en borrador y no mueve stock: falta que Gerencia u Operaciones lo autorice, que Almacén lo despache y que el destino lo reciba.'}
        </span>
      </div>

      <style jsx>{`
        .traslado-pallets { max-height: 32rem; overflow: auto; }
        .traslado-pallets :global(tr[data-elegido='si']) { background: var(--fondo-2, rgba(0,0,0,.03)); }
      `}</style>
    </form>
  );
}
