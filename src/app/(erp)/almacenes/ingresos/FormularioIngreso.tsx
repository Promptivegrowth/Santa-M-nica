'use client';

/**
 * ============================================================================
 *  REGISTRAR UN INGRESO A CÁMARA
 * ============================================================================
 *  Es el formulario que más se usa de todo el sistema: cada pallet que sale de
 *  planta pasa por aquí. Por eso está pensado para llenarse rápido y seguido,
 *  con el teclado y sin ir a buscar datos a otra pantalla.
 *
 *  TRES DECISIONES QUE SE NOTAN AL USARLO
 *
 *  · Al guardar NO se va a ninguna parte: se queda listo para el siguiente
 *    pallet, con la bodega, la fecha, el turno y el producto ya puestos, y
 *    solo el código y los pesos en blanco. Un turno son treinta pallets del
 *    mismo producto; volver al listado entre uno y otro sería castigo.
 *
 *  · El peso se puede escribir en total o por bulto. En cámara se pesa de las
 *    dos maneras según la balanza, y hacer la multiplicación a mano es donde
 *    aparecen los errores de un cero.
 *
 *  · El costo se propone con el del último ingreso del mismo producto. Casi
 *    siempre es el mismo, y cuando no lo es, quien lo cambia sabe por qué.
 * ============================================================================
 */
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import {
  registrarIngreso, camarasDeAlmacen, costoSugerido,
  type DatosIngreso,
} from './acciones';

export type OpcionProducto = {
  id: number;
  codigo: string;
  descripcion: string;
  peso_bulto_kg: number;
};

const cifra = (n: number, d = 1) =>
  n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });

export function FormularioIngreso({
  productos,
  almacenes,
  plantas,
  lineas,
  codigoPropuesto,
  hoy,
}: {
  productos: OpcionProducto[];
  almacenes: { id: number; nombre: string }[];
  plantas: { id: number; nombre: string }[];
  lineas: { id: number; nombre: string }[];
  codigoPropuesto: string;
  hoy: string;
}) {
  const router = useRouter();
  const [guardando, iniciar] = useTransition();

  const [d, setD] = useState<DatosIngreso>({
    codigo_pallet: codigoPropuesto,
    sku_presentacion_id: 0,
    almacen_id: almacenes[0]?.id ?? 0,
    camara_id: null,
    fecha_produccion: hoy,
    turno: 'dia',
    proceso: 'propia',
    planta_id: null,
    linea_procesadora_id: null,
    bultos: 0,
    peso_neto_kg: 0,
    costo_unitario: 0,
    observaciones: '',
  });

  /** Si se escribe el peso por bulto, el total se calcula solo. */
  const [modoPeso, setModoPeso] = useState<'total' | 'porBulto'>('total');
  const [pesoBulto, setPesoBulto] = useState(0);

  const [camaras, setCamaras] = useState<{ id: number; nombre: string }[]>([]);
  const [camarasDe, setCamarasDe] = useState(0);
  const [problema, setProblema] = useState<{ mensaje: string; campo?: string } | null>(null);
  const [hechos, setHechos] = useState<string[]>([]);

  const producto = productos.find((p) => p.id === d.sku_presentacion_id);

  /* Las cámaras dependen de la bodega: se piden al servidor al cambiarla. */
  useEffect(() => {
    if (!d.almacen_id) return;
    let vigente = true;
    camarasDeAlmacen(d.almacen_id).then((lista) => {
      if (vigente) { setCamaras(lista); setCamarasDe(d.almacen_id); }
    });
    return () => { vigente = false; };
  }, [d.almacen_id]);

  const camarasVisibles = camarasDe === d.almacen_id ? camaras : [];

  function campo<K extends keyof DatosIngreso>(k: K, v: DatosIngreso[K]) {
    setD((previo) => {
      const siguiente = { ...previo, [k]: v };
      // Cambiar de bodega invalida la cámara: pertenecía a la anterior.
      if (k === 'almacen_id') siguiente.camara_id = null;
      return siguiente;
    });
    setProblema(null);
  }

  /** Al elegir producto se propone el costo del último ingreso igual. */
  function elegirProducto(id: number) {
    campo('sku_presentacion_id', id);
    const p = productos.find((x) => x.id === id);
    if (p && modoPeso === 'porBulto') setPesoBulto(p.peso_bulto_kg);
    if (id) {
      costoSugerido(id).then((c) => {
        // Solo se propone si el usuario no escribió uno: no se pisa lo suyo.
        setD((previo) => (previo.costo_unitario > 0 ? previo : { ...previo, costo_unitario: c }));
      });
    }
  }

  function cambiarBultos(n: number) {
    setD((previo) => ({
      ...previo,
      bultos: n,
      peso_neto_kg: modoPeso === 'porBulto' ? Math.round(n * pesoBulto * 1000) / 1000 : previo.peso_neto_kg,
    }));
    setProblema(null);
  }

  function cambiarPesoBulto(kg: number) {
    setPesoBulto(kg);
    setD((previo) => ({ ...previo, peso_neto_kg: Math.round(previo.bultos * kg * 1000) / 1000 }));
    setProblema(null);
  }

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setProblema(null);

    iniciar(async () => {
      const r = await registrarIngreso(d);
      if (!r.ok) { setProblema({ mensaje: r.mensaje, campo: r.campo }); return; }

      /*
       * Se queda en la misma pantalla, con lo que se repite ya puesto. Solo se
       * limpia lo que cambia de un pallet al siguiente: el código, los bultos
       * y el peso.
       */
      setHechos((previos) => [r.mensaje, ...previos].slice(0, 8));
      setD((previo) => ({
        ...previo,
        codigo_pallet: siguienteCodigo(previo.codigo_pallet),
        bultos: 0,
        peso_neto_kg: 0,
        observaciones: '',
      }));
      router.refresh();
    });
  }

  const error = (nombre: string) => (problema?.campo === nombre ? 'si' : undefined);

  return (
    <form className="form-maestro" onSubmit={enviar}>
      {problema && (
        <div className="ficha-aviso ficha-aviso-critico" role="alert">
          <Icono nombre="alerta" tamano={17} />
          <span>{problema.mensaje}</span>
        </div>
      )}

      {/* ---------------- Qué entró ---------------- */}
      <fieldset className="form-bloque">
        <legend>Qué entró</legend>
        <div className="form-rejilla">
          <label className="form-campo">
            <span>Código de pallet <b className="req">*</b></span>
            <input className="campo mono" value={d.codigo_pallet} data-error={error('codigo_pallet')}
                   onChange={(e) => campo('codigo_pallet', e.target.value)}
                   maxLength={30} required autoFocus />
            <small>Es su matrícula. No se puede repetir.</small>
          </label>

          <label className="form-campo form-campo-ancho">
            <span>Producto <b className="req">*</b></span>
            <select className="campo" value={d.sku_presentacion_id || ''} data-error={error('sku_presentacion_id')}
                    onChange={(e) => elegirProducto(Number(e.target.value))} required>
              <option value="">Elija el producto…</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>{p.codigo} · {p.descripcion}</option>
              ))}
            </select>
            {producto && (
              <small>Bulto estándar de {cifra(producto.peso_bulto_kg)} kg.</small>
            )}
          </label>
        </div>
      </fieldset>

      {/* ---------------- Cuánto ---------------- */}
      <fieldset className="form-bloque">
        <legend>Cuánto</legend>

        <div className="form-modo">
          <span>El peso se escribe:</span>
          <label>
            <input type="radio" checked={modoPeso === 'total'}
                   onChange={() => setModoPeso('total')} />
            Total del pallet
          </label>
          <label>
            <input type="radio" checked={modoPeso === 'porBulto'}
                   onChange={() => {
                     setModoPeso('porBulto');
                     const kg = pesoBulto || producto?.peso_bulto_kg || 0;
                     cambiarPesoBulto(kg);
                   }} />
            Por bulto, y se multiplica
          </label>
        </div>

        <div className="form-rejilla">
          <label className="form-campo">
            <span>Bultos <b className="req">*</b></span>
            <input className="campo mono" type="number" min={1} step={1}
                   value={d.bultos || ''} data-error={error('bultos')}
                   onChange={(e) => cambiarBultos(Number(e.target.value))} required />
          </label>

          {modoPeso === 'porBulto' && (
            <label className="form-campo">
              <span>Kilos por bulto</span>
              <input className="campo mono" type="number" min={0} step={0.001}
                     value={pesoBulto || ''}
                     onChange={(e) => cambiarPesoBulto(Number(e.target.value))} />
              <small>Se propone el estándar de la presentación.</small>
            </label>
          )}

          <label className="form-campo">
            <span>Peso neto total (kg) <b className="req">*</b></span>
            <input className="campo mono" type="number" min={0} step={0.001}
                   value={d.peso_neto_kg || ''} data-error={error('peso_neto_kg')}
                   onChange={(e) => campo('peso_neto_kg', Number(e.target.value))}
                   readOnly={modoPeso === 'porBulto'} required />
            {modoPeso === 'porBulto' && d.bultos > 0 && (
              <small>{d.bultos} × {cifra(pesoBulto, 3)} kg = <b>{cifra(d.peso_neto_kg, 1)} kg</b></small>
            )}
            {modoPeso === 'total' && d.bultos > 0 && d.peso_neto_kg > 0 && (
              <small>Salen {cifra(d.peso_neto_kg / d.bultos, 2)} kg por bulto.</small>
            )}
          </label>

          <label className="form-campo">
            <span>Costo por kg (US$)</span>
            <input className="campo mono" type="number" min={0} step={0.0001}
                   value={d.costo_unitario || ''} data-error={error('costo_unitario')}
                   onChange={(e) => campo('costo_unitario', Number(e.target.value))} />
            <small>
              Se propone el del último ingreso de este producto. Con él se recalcula el costo
              promedio de la bodega.
            </small>
          </label>
        </div>

        {d.peso_neto_kg > 0 && d.costo_unitario > 0 && (
          <p className="form-pista">
            Valor de este pallet: <b>US$ {cifra(d.peso_neto_kg * d.costo_unitario, 2)}</b>
          </p>
        )}
      </fieldset>

      {/* ---------------- De dónde y a dónde ---------------- */}
      <fieldset className="form-bloque">
        <legend>De dónde salió y a dónde entra</legend>
        <div className="form-rejilla">
          <label className="form-campo">
            <span>Fecha de producción <b className="req">*</b></span>
            <input className="campo" type="date" max={hoy}
                   value={d.fecha_produccion} data-error={error('fecha_produccion')}
                   onChange={(e) => campo('fecha_produccion', e.target.value)} required />
            <small>Con ella se calcula la antigüedad y la vida útil.</small>
          </label>

          <label className="form-campo">
            <span>Turno</span>
            <select className="campo" value={d.turno}
                    onChange={(e) => campo('turno', e.target.value as DatosIngreso['turno'])}>
              <option value="dia">Día</option>
              <option value="noche">Noche</option>
            </select>
          </label>

          <label className="form-campo">
            <span>Proceso</span>
            <select className="campo" value={d.proceso}
                    onChange={(e) => campo('proceso', e.target.value as DatosIngreso['proceso'])}>
              <option value="propia">Producción propia</option>
              <option value="maquila">Maquila</option>
            </select>
          </label>

          <label className="form-campo">
            <span>Planta</span>
            <select className="campo" value={d.planta_id ?? ''}
                    onChange={(e) => campo('planta_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Sin especificar</option>
              {plantas.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          </label>

          <label className="form-campo">
            <span>Línea procesadora</span>
            <select className="campo" value={d.linea_procesadora_id ?? ''}
                    onChange={(e) => campo('linea_procesadora_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Sin especificar</option>
              {lineas.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
            <small>Sirve para rastrear un problema hasta la línea que lo produjo.</small>
          </label>

          <label className="form-campo">
            <span>Bodega <b className="req">*</b></span>
            <select className="campo" value={d.almacen_id || ''} data-error={error('almacen_id')}
                    onChange={(e) => campo('almacen_id', Number(e.target.value))} required>
              {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>

          <label className="form-campo">
            <span>Cámara</span>
            <select className="campo" value={d.camara_id ?? ''} data-error={error('camara_id')}
                    onChange={(e) => campo('camara_id', e.target.value ? Number(e.target.value) : null)}
                    disabled={camarasVisibles.length === 0}>
              <option value="">
                {camarasVisibles.length === 0 ? 'Esta bodega no tiene cámaras cargadas' : 'Sin especificar'}
              </option>
              {camarasVisibles.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>

          <label className="form-campo form-campo-ancho">
            <span>Observaciones</span>
            <input className="campo" value={d.observaciones ?? ''}
                   onChange={(e) => campo('observaciones', e.target.value)}
                   placeholder="Algo fuera de lo normal en este pallet" maxLength={200} />
          </label>
        </div>
      </fieldset>

      <div className="form-acciones">
        <button type="submit" className="btn btn-primario" disabled={guardando}>
          <Icono nombre="ingresos" tamano={15} />
          {guardando ? 'Registrando…' : 'Registrar ingreso'}
        </button>
        <span className="form-pista" style={{ margin: 0 }}>
          Al guardar se queda listo para el siguiente pallet, con la bodega, la fecha y el producto
          ya puestos.
        </span>
      </div>

      {/* ---------------- Lo que se lleva registrado ---------------- */}
      {hechos.length > 0 && (
        <div className="ingresos-hechos">
          <h4>Registrados en esta sesión · {hechos.length}</h4>
          <ul>
            {hechos.map((h, i) => (
              <li key={i}><Icono nombre="ingresos" tamano={13} /> {h}</li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

/**
 * Sube en uno el correlativo del código, conservando el formato.
 *
 * Los códigos terminan en cuatro dígitos («SM 26 08 0168»). Si el que hay no
 * termina en números, se devuelve vacío para que quien registra lo escriba: es
 * preferible una casilla en blanco a un código inventado.
 */
function siguienteCodigo(actual: string): string {
  const m = /^(.*?)(\d+)$/.exec(actual.trim());
  if (!m) return '';
  const ancho = m[2].length;
  return m[1] + String(Number(m[2]) + 1).padStart(ancho, '0');
}
