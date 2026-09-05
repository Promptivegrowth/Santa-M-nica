'use client';

/**
 * ============================================================================
 *  FORMULARIO DE PRODUCTO · alta y edición del SKU con sus presentaciones
 * ============================================================================
 *  LO QUE MÁS CONFUNDE DE ESTE MAESTRO
 *  Que un producto son dos cosas a la vez: el SKU —qué es— y la presentación
 *  —cómo viene empacado—. Lo que se cotiza y se despacha es la combinación.
 *
 *  El formulario lo hace explícito: primero se describe el producto, y al
 *  final hay un bloque aparte donde se marcan las presentaciones. Si no se
 *  marca ninguna, no deja guardar, y lo dice con el motivo: un producto sin
 *  presentación aparecería en los listados y nadie podría agregarlo a una
 *  cotización.
 *
 *  El desplegable de formato depende de la especie —«filete de pota» y
 *  «filete de merluza» son formatos distintos—, así que al cambiar la especie
 *  se recarga y se limpia lo que hubiera elegido antes.
 * ============================================================================
 */
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icono } from '@/components/estructura/Icono';
import {
  crearProducto, actualizarProducto, formatosDeEspecie,
  type DatosProducto, type Resultado,
} from './accionesMaestro';

export type ProductoExistente = DatosProducto & { id: number; activo: boolean };

export type Presentacion = {
  id: number;
  codigo: string;
  descripcion: string;
  peso_bulto_kg: number;
  congelamiento: string;
};

const VACIO: DatosProducto = {
  codigo: '', especie_id: 0, formato_id: 0, corte: '',
  clasificacion_comercial: '', empaque: 'sacos', vida_util_meses: 24, presentaciones: [],
};

export function FormularioProducto({
  producto,
  codigoPropuesto,
  especies,
  formatosIniciales,
  presentaciones,
  clasificaciones,
}: {
  producto?: ProductoExistente;
  codigoPropuesto?: string;
  especies: { id: number; nombre: string }[];
  formatosIniciales: { id: number; nombre: string }[];
  presentaciones: Presentacion[];
  /** Las que ya se usan, para sugerirlas sin cerrar la lista. */
  clasificaciones: string[];
}) {
  const router = useRouter();
  const [guardando, iniciar] = useTransition();
  const [d, setD] = useState<DatosProducto>(
    producto ?? { ...VACIO, codigo: codigoPropuesto ?? '' }
  );
  /*
   * Los formatos se guardan junto con la especie a la que pertenecen. Así, al
   * cambiar de especie, la lista correcta se DEDUCE —queda vacía hasta que
   * llegue la nueva— en vez de tener que vaciarla a mano desde el efecto.
   * Vaciarla a mano provocaba un renderizado de más con datos de la especie
   * anterior todavía en pantalla.
   */
  const [cache, setCache] = useState<{ especieId: number; lista: { id: number; nombre: string }[] }>(
    { especieId: producto?.especie_id ?? 0, lista: formatosIniciales }
  );
  const formatos = cache.especieId === d.especie_id ? cache.lista : [];
  const [problema, setProblema] = useState<{ mensaje: string; campo?: string } | null>(null);

  const editando = Boolean(producto);

  /*
   * Los formatos se piden al servidor cuando cambia la especie. Se hace con un
   * efecto porque es una consulta externa, no un cálculo: el componente no
   * puede saber qué formatos tiene una especie sin preguntar.
   */
  useEffect(() => {
    if (!d.especie_id) return;
    let vigente = true;
    formatosDeEspecie(d.especie_id).then((lista) => {
      if (vigente) setCache({ especieId: d.especie_id, lista });
    });
    // Si la especie cambia mientras la consulta viaja, la respuesta vieja se
    // descarta: si no, podría pisar a la nueva por llegar más tarde.
    return () => { vigente = false; };
  }, [d.especie_id]);

  function campo<K extends keyof DatosProducto>(k: K, v: DatosProducto[K]) {
    setD((previo) => {
      const siguiente = { ...previo, [k]: v };
      // Cambiar la especie invalida el formato: pertenecía a la anterior.
      if (k === 'especie_id') siguiente.formato_id = 0;
      return siguiente;
    });
    setProblema(null);
  }

  function alternarPresentacion(id: number) {
    setD((previo) => ({
      ...previo,
      presentaciones: previo.presentaciones.includes(id)
        ? previo.presentaciones.filter((p) => p !== id)
        : [...previo.presentaciones, id],
    }));
    setProblema(null);
  }

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setProblema(null);

    iniciar(async () => {
      const r: Resultado = producto
        ? await actualizarProducto(producto.id, d)
        : await crearProducto(d);

      if (!r.ok) { setProblema({ mensaje: r.mensaje, campo: r.campo }); return; }
      /*
       * Se vuelve al listado filtrado por el código y no a una ficha: la ficha
       * de producto es de una PRESENTACIÓN concreta, y un SKU puede tener
       * varias. El listado las enseña todas, que es lo que se quiere ver
       * después de crear o editar.
       */
      router.push(`/ventas/productos?buscar=${encodeURIComponent(d.codigo.trim())}`);
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

      {/* ---------------- Qué es el producto ---------------- */}
      <fieldset className="form-bloque">
        <legend>Qué es el producto</legend>

        <div className="form-rejilla">
          <label className="form-campo">
            <span>Código SKU <b className="req">*</b></span>
            <input className="campo mono" value={d.codigo} data-error={error('codigo')}
                   onChange={(e) => campo('codigo', e.target.value)}
                   maxLength={20} required />
            {/*
              Se escribe a mano y no lo genera el sistema: la empresa ya maneja
              su propio código en otros dos sistemas, y que aquí sea el mismo es
              lo que permite cruzar la información entre los tres.
            */}
            <small>
              Escriba <b>el mismo código que ya usa la empresa</b>. No se repite, y es el que se
              busca al cotizar y el que sale en la lista de productos.
            </small>
          </label>

          <label className="form-campo">
            <span>Especie <b className="req">*</b></span>
            <select className="campo" value={d.especie_id || ''} data-error={error('especie_id')}
                    onChange={(e) => campo('especie_id', Number(e.target.value))} required>
              <option value="">Elija una especie…</option>
              {especies.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>

          <label className="form-campo">
            <span>Formato <b className="req">*</b></span>
            <select className="campo" value={d.formato_id || ''} data-error={error('formato_id')}
                    onChange={(e) => campo('formato_id', Number(e.target.value))}
                    disabled={!d.especie_id} required>
              <option value="">
                {d.especie_id ? 'Elija un formato…' : 'Primero elija la especie'}
              </option>
              {formatos.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
            <small>Filete, aletas, tentáculo, entera… Depende de la especie.</small>
          </label>

          <label className="form-campo form-campo-ancho">
            <span>Corte <b className="req">*</b></span>
            <input className="campo" value={d.corte} data-error={error('corte')}
                   onChange={(e) => campo('corte', e.target.value)}
                   placeholder='«B» 2000-4000 · TUBO 1500-2000 · ANILLAS MIXTAS' maxLength={120} required />
            <small>Es lo que distingue de verdad un producto de otro. Sale impreso en la cotización.</small>
          </label>

          <label className="form-campo">
            <span>Clasificación comercial <b className="req">*</b></span>
            <input className="campo" list="lista-clasificaciones"
                   value={d.clasificacion_comercial}
                   data-error={error('clasificacion_comercial')}
                   onChange={(e) => campo('clasificacion_comercial', e.target.value)}
                   placeholder="REJOS, RECORTES FRESCOS…" maxLength={60} required />
            <datalist id="lista-clasificaciones">
              {clasificaciones.map((c) => <option key={c} value={c} />)}
            </datalist>
            <small>La familia con la que se agrupa en los reportes. Sugiere las que ya se usan, pero admite una nueva.</small>
          </label>

          <label className="form-campo">
            <span>Empaque</span>
            <select className="campo" value={d.empaque}
                    onChange={(e) => campo('empaque', e.target.value as DatosProducto['empaque'])}>
              <option value="sacos">Sacos</option>
              <option value="cajas">Cajas</option>
              <option value="block">Block</option>
            </select>
          </label>

          <label className="form-campo">
            <span>Vida útil (meses)</span>
            <input className="campo mono" type="number" min={1} max={120}
                   value={d.vida_util_meses ?? ''} data-error={error('vida_util_meses')}
                   onChange={(e) => campo('vida_util_meses', e.target.value ? Number(e.target.value) : null)} />
            <small>Con esto se calcula el anticuamiento. En blanco usa el valor general configurado.</small>
          </label>
        </div>
      </fieldset>

      {/* ---------------- Cómo se vende ---------------- */}
      <fieldset className="form-bloque">
        <legend>En qué presentaciones se vende <b className="req">*</b></legend>
        <p className="form-pista" style={{ marginTop: 0, marginBottom: '.6rem' }}>
          Marque todas las que apliquen. <b>Lo que se cotiza y se despacha es la combinación</b> de
          este producto con una presentación, así que sin al menos una no se podrá vender.
        </p>

        <div className="form-presentaciones" data-error={error('presentaciones')}>
          {presentaciones.map((p) => {
            const elegida = d.presentaciones.includes(p.id);
            return (
              <label key={p.id} className="form-pres" data-elegida={elegida ? 'si' : 'no'}>
                <input type="checkbox" checked={elegida} onChange={() => alternarPresentacion(p.id)} />
                <span>
                  <b>{p.descripcion}</b>
                  <small>
                    {p.codigo} · {p.peso_bulto_kg} kg por bulto · {p.congelamiento}
                  </small>
                </span>
              </label>
            );
          })}
        </div>

        {d.presentaciones.length > 0 && (
          <p className="form-pista">
            {d.presentaciones.length} presentación{d.presentaciones.length === 1 ? '' : 'es'} marcada
            {d.presentaciones.length === 1 ? '' : 's'}.
            {editando && ' Al quitar una que ya tenga lotes, no se borra: se desactiva, para no dejar el Kardex sin referencia.'}
          </p>
        )}
      </fieldset>

      <div className="form-acciones">
        <button type="submit" className="btn btn-primario" disabled={guardando}>
          <Icono nombre="guardar" tamano={15} />
          {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear producto'}
        </button>
        <Link href="/ventas/productos" className="btn btn-sutil">Cancelar</Link>
      </div>
    </form>
  );
}
