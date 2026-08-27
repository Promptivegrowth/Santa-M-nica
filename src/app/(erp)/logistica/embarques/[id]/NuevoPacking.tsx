'use client';

/**
 * ============================================================================
 *  CREAR UN CONTENEDOR PARA ESTE EMBARQUE
 * ============================================================================
 *  Un embarque puede llevar varios contenedores. Cada uno es un packing list
 *  con su matrícula, su precinto y su plano de estiba propio.
 *
 *  La capacidad viene puesta con la del contenedor estándar de la casa —22
 *  filas de 61 sacos, la del PLANO_POT_761— y se puede cambiar: no todos los
 *  contenedores son iguales.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { crearPacking } from '../acciones';

export function NuevoPacking({
  embarqueId,
  supervisores,
  puede,
}: {
  embarqueId: number;
  supervisores: { id: string; nombre: string }[];
  puede: boolean;
}) {
  const router = useRouter();
  const [guardando, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(false);

  const [contenedor, setContenedor] = useState('');
  const [precinto, setPrecinto] = useState('');
  const [filas, setFilas] = useState(22);
  const [sacos, setSacos] = useState(61);
  const [supervisor, setSupervisor] = useState('');
  const [turno, setTurno] = useState<'dia' | 'noche'>('dia');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'mal'; texto: string } | null>(null);

  function crear() {
    setAviso(null);
    iniciar(async () => {
      const r = await crearPacking({
        embarque_id: embarqueId,
        contenedor: contenedor || null,
        precinto: precinto || null,
        filas_contenedor: filas,
        sacos_por_fila: sacos,
        supervisor_id: supervisor || null,
        turno,
        fecha_carga: null,
      });
      if (!r.ok) { setAviso({ tipo: 'mal', texto: r.mensaje }); return; }
      router.push(`/logistica/packing/${r.id}`);
      router.refresh();
    });
  }

  if (!puede) return null;

  return (
    <>
      <button type="button" className="btn btn-primario" onClick={() => setAbierto(!abierto)}>
        <Icono nombre="packing" tamano={15} />
        {abierto ? 'Cancelar' : 'Nuevo contenedor'}
      </button>

      {aviso && (
        <div className={`ficha-aviso ${aviso.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'} documento-mensaje`}
             role={aviso.tipo === 'ok' ? 'status' : 'alert'}>
          <Icono nombre="alerta" tamano={17} />
          <span>{aviso.texto}</span>
        </div>
      )}

      {abierto && (
        <div className="traslado-panel documento-mensaje">
          <strong>Nuevo contenedor</strong>
          <p>
            Se crea vacío. Después se le cargan los pallets y se arma su plano de estiba.
          </p>

          <div className="form-rejilla">
            <label className="form-campo">
              <span>N.º de contenedor</span>
              <input className="campo mono" value={contenedor} maxLength={20}
                     onChange={(e) => setContenedor(e.target.value.toUpperCase())}
                     placeholder="MSDU0000000" autoFocus />
            </label>
            <label className="form-campo">
              <span>Precinto</span>
              <input className="campo mono" value={precinto} maxLength={20}
                     onChange={(e) => setPrecinto(e.target.value.toUpperCase())}
                     placeholder="PRE000000" />
            </label>
            <label className="form-campo">
              <span>Filas del contenedor</span>
              <input className="campo mono" type="number" min={1} max={60} value={filas}
                     onChange={(e) => setFilas(Number(e.target.value))} />
              <small>El estándar de la casa son 22.</small>
            </label>
            <label className="form-campo">
              <span>Sacos por fila</span>
              <input className="campo mono" type="number" min={1} max={200} value={sacos}
                     onChange={(e) => setSacos(Number(e.target.value))} />
              <small>El estándar son 61. Caben {(filas * sacos).toLocaleString('es-PE')} sacos.</small>
            </label>
            <label className="form-campo">
              <span>Supervisor de carga</span>
              <select className="campo" value={supervisor} onChange={(e) => setSupervisor(e.target.value)}>
                <option value="">Sin asignar</option>
                {supervisores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
            <label className="form-campo">
              <span>Turno</span>
              <select className="campo" value={turno} onChange={(e) => setTurno(e.target.value as 'dia' | 'noche')}>
                <option value="dia">Día</option>
                <option value="noche">Noche</option>
              </select>
            </label>
          </div>

          <div className="acciones-fila">
            <button type="button" className="btn btn-primario" onClick={crear} disabled={guardando}>
              <Icono nombre="guardar" tamano={15} />
              {guardando ? 'Creando…' : 'Crear contenedor'}
            </button>
            <button type="button" className="btn btn-sutil" onClick={() => setAbierto(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
