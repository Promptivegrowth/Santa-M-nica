'use client';

/**
 * ============================================================================
 *  EDITOR DE LA FLOTA
 * ============================================================================
 *  Un mismo formulario para dar de alta o editar un transportista, un
 *  vehículo o un conductor. Se abre por la dirección web (?editar=vehiculo-12
 *  o ?editar=vehiculo-nuevo): así «Editar» es un enlace normal, el botón
 *  «atrás» lo cierra y al guardar se vuelve a la lista sin parámetros.
 *
 *  Y los botones de cada fila: Desactivar / Reactivar y Borrar (este último
 *  solo se enciende si nunca se usó; si no, dice dónde figura).
 *
 *  El servidor vuelve a comprobar todo: formato de placa, RUC, DNI, fechas,
 *  permisos (y la base, con sus políticas).
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  guardarTransportista, guardarVehiculo, guardarConductor, cambiarActivo, eliminarDeFlota,
  type DatosTransportista, type DatosVehiculo, type DatosConductor, type TablaFlota,
} from './acciones';

type Opcion = { id: number; nombre: string };

export type Edicion =
  | { tipo: 'transportista'; id: number | null; datos: DatosTransportista }
  | { tipo: 'vehiculo'; id: number | null; datos: DatosVehiculo }
  | { tipo: 'conductor'; id: number | null; datos: DatosConductor };

const TITULO = { transportista: 'transportista', vehiculo: 'vehículo', conductor: 'conductor' };

export function FormularioFlota({ edicion, transportistas }: { edicion: Edicion; transportistas: Opcion[] }) {
  const router = useRouter();
  const [d, setD] = useState<Record<string, unknown>>(edicion.datos as unknown as Record<string, unknown>);
  const [aviso, setAviso] = useState<{ texto: string; campo?: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  const valor = (k: string) => (d[k] === null || d[k] === undefined ? '' : String(d[k]));
  const poner = (k: string, v: unknown) => { setD((x) => ({ ...x, [k]: v === '' ? null : v })); setAviso(null); };
  const error = (k: string) => (aviso?.campo === k ? 'si' : undefined);
  const texto = (k: string, etiqueta: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, req = false) => (
    <label className="form-campo">
      <span>{etiqueta}{req && <> <b className="req">*</b></>}</span>
      <input className="campo" name={k} value={valor(k)} data-error={error(k)} onChange={(e) => poner(k, e.target.value)} {...extra} />
    </label>
  );
  const selectorTransportista = (req: boolean) => (
    <label className="form-campo">
      <span>Transportista{req && <> <b className="req">*</b></>}</span>
      <select className="campo" name="transportista_id" value={valor('transportista_id')} data-error={error('transportista_id')}
              onChange={(e) => poner('transportista_id', e.target.value ? Number(e.target.value) : null)}>
        <option value="">{req ? 'Elija…' : 'Sin transportista (propio)'}</option>
        {transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
      </select>
    </label>
  );

  function guardar() {
    setAviso(null);
    iniciar(async () => {
      const r =
        edicion.tipo === 'transportista' ? await guardarTransportista(edicion.id, d as unknown as DatosTransportista)
        : edicion.tipo === 'vehiculo' ? await guardarVehiculo(edicion.id, { ...(d as unknown as DatosVehiculo), capacidad_tm: d.capacidad_tm === null ? null : Number(d.capacidad_tm) })
        : await guardarConductor(edicion.id, d as unknown as DatosConductor);
      if (!r.ok) { setAviso({ texto: r.mensaje, campo: r.campo }); return; }
      router.push(`/logistica/flota?hecho=${encodeURIComponent(r.mensaje)}#${edicion.tipo === 'vehiculo' ? 'vehiculos' : edicion.tipo === 'conductor' ? 'conductores' : 'transportistas'}`);
      router.refresh();
    });
  }

  return (
    <div className="traslado-panel" data-bloque="editor-flota" data-tipo={edicion.tipo}
         style={{ maxWidth: 'none', margin: '.8rem 1rem 1rem' }}>
      <strong>{edicion.id ? `Editar ${TITULO[edicion.tipo]}` : `Nuevo ${TITULO[edicion.tipo]}`}</strong>
      <div className="form-rejilla">
        {edicion.tipo === 'transportista' && (<>
          {texto('razon_social', 'Razón social', { maxLength: 120, autoFocus: true }, true)}
          <label className="form-campo">
            <span>Tipo <b className="req">*</b></span>
            <select className="campo" name="tipo" value={valor('tipo') || 'tercero'} onChange={(e) => poner('tipo', e.target.value)}>
              <option value="tercero">Tercero</option>
              <option value="propio">Propio (de la empresa)</option>
            </select>
          </label>
          {texto('ruc', 'RUC', { maxLength: 11, inputMode: 'numeric', placeholder: '20123456789' })}
          {texto('contacto', 'Contacto', { maxLength: 80 })}
          {texto('telefono', 'Teléfono', { maxLength: 30 })}
        </>)}

        {edicion.tipo === 'vehiculo' && (<>
          {texto('placa', 'Placa', { maxLength: 10, autoFocus: true, placeholder: 'C4M-238', style: { textTransform: 'uppercase' } }, true)}
          {selectorTransportista(true)}
          {texto('marca', 'Marca', { maxLength: 40 })}
          {texto('modelo', 'Modelo', { maxLength: 40 })}
          {texto('capacidad_tm', 'Capacidad (TM)', { type: 'number', min: 0, step: '0.1' })}
          {texto('soat_vence', 'SOAT vence', { type: 'date' })}
          {texto('revision_vence', 'Revisión técnica vence', { type: 'date' })}
        </>)}

        {edicion.tipo === 'conductor' && (<>
          {texto('nombre', 'Nombre', { maxLength: 100, autoFocus: true }, true)}
          {texto('dni', 'DNI', { maxLength: 8, inputMode: 'numeric' })}
          {texto('licencia', 'Brevete (licencia)', { maxLength: 20, placeholder: 'Q12345678' })}
          {texto('licencia_vence', 'Brevete vence', { type: 'date' })}
          {selectorTransportista(false)}
          {texto('telefono', 'Teléfono', { maxLength: 30 })}
        </>)}
      </div>
      {edicion.tipo === 'vehiculo' && (
        <p>Con el SOAT o la revisión técnica vencidos para la fecha de salida, el vehículo no se puede asignar a un embarque.</p>
      )}
      <div className="acciones-fila">
        <button type="button" className="btn btn-primario" disabled={pendiente} data-accion="guardar-flota" onClick={guardar}>
          {pendiente ? 'Guardando…' : 'Guardar'}
        </button>
        <Link href="/logistica/flota" className="btn btn-sutil">Cancelar</Link>
      </div>
      {aviso && <p role="alert" className="form-mensaje error">{aviso.texto}</p>}
    </div>
  );
}

/** Desactivar / Reactivar y Borrar, en cada fila. */
export function AccionesFlota({
  tabla, id, activo, usos, editar,
}: {
  tabla: TablaFlota;
  id: number;
  activo: boolean;
  /** Dónde figura («3 embarques, 1 traslado»). Vacío = nunca se usó: se puede borrar. */
  usos: string[];
  editar: string;
}) {
  const router = useRouter();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const hacer = (accion: () => Promise<{ ok: boolean; mensaje: string }>) => iniciar(async () => {
    const r = await accion();
    setAviso({ ok: r.ok, texto: r.mensaje });
    setBorrando(false);
    if (r.ok) router.refresh();
  });

  return (
    <span style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', flexWrap: 'wrap', minWidth: '15rem' }} data-fila-flota={`${tabla}-${id}`}>
      <Link href={editar} className="btn btn-sutil btn-chico" data-accion="editar-flota">Editar</Link>
      <button type="button" className="btn btn-sutil btn-chico" disabled={pendiente} data-accion={activo ? 'desactivar-flota' : 'reactivar-flota'}
              onClick={() => hacer(() => cambiarActivo(tabla, id, !activo))}>
        {activo ? 'Desactivar' : 'Reactivar'}
      </button>
      {!borrando ? (
        <button type="button" className="btn btn-sutil btn-chico" data-accion="borrar-flota"
                disabled={pendiente || usos.length > 0}
                title={usos.length ? `Figura en ${usos.join(', ')}: no se borra, se desactiva.` : 'Nunca se usó: se puede borrar'}
                onClick={() => setBorrando(true)}>
          Borrar
        </button>
      ) : (
        <>
          <button type="button" className="btn btn-peligro btn-chico" disabled={pendiente} data-accion="confirmar-borrar-flota"
                  onClick={() => hacer(() => eliminarDeFlota(tabla, id))}>
            Sí, borrar
          </button>
          <button type="button" className="btn btn-sutil btn-chico" onClick={() => setBorrando(false)}>No</button>
        </>
      )}
      {aviso && (
        <span role={aviso.ok ? 'status' : 'alert'} style={{ flexBasis: '100%', fontSize: '.72rem', color: aviso.ok ? 'var(--ok)' : 'var(--critico)', maxWidth: '22rem' }}>
          {aviso.texto}
        </span>
      )}
    </span>
  );
}
