'use client';

/**
 * ============================================================================
 *  CARGAR PALLETS EN EL CONTENEDOR
 * ============================================================================
 *  Antes de repartir sacos en el plano hay que decir QUÉ pallets se van a
 *  cargar. Se ofrecen solo los que sirven: de la misma bodega desde la que
 *  sale el embarque, con saldo disponible y sin bloqueo de calidad.
 *
 *  POR QUÉ SOLO DE ESA BODEGA
 *  Porque un pallet que está en otra cámara exigiría un traslado antes.
 *  Ofrecerlo aquí sería prometer algo que el camión no puede cumplir el día
 *  de la carga.
 *
 *  Los bultos que se proponen salen del peso DISPONIBLE, no del físico: parte
 *  del pallet puede estar apartada para otro pedido.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import {
  lotesCargables, agregarLoteAlPacking, quitarLoteDelPacking,
  type LoteCargable,
} from '../acciones';

const cifra = (n: number, d = 0) =>
  n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });

export function CargarLotes({
  packingId,
  cargados,
  puede,
}: {
  packingId: number;
  cargados: { lote_id: number; pallet: string; producto: string; bultos: number; peso: number }[];
  puede: boolean;
}) {
  const router = useRouter();
  const [cargando, iniciarCarga] = useTransition();
  const [guardando, iniciarGuardado] = useTransition();

  const [candidatos, setCandidatos] = useState<LoteCargable[] | null>(null);
  const [elegido, setElegido] = useState<LoteCargable | null>(null);
  const [bultos, setBultos] = useState(0);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'mal'; texto: string } | null>(null);

  function abrir() {
    setAviso(null);
    iniciarCarga(async () => {
      setCandidatos(await lotesCargables(packingId));
      setElegido(null);
    });
  }

  function elegir(l: LoteCargable) {
    setElegido(l);
    setBultos(l.bultos_disponibles);
    setAviso(null);
  }

  function agregar() {
    if (!elegido) return;
    setAviso(null);
    iniciarGuardado(async () => {
      const r = await agregarLoteAlPacking(
        packingId, elegido.lote_id, bultos, bultos * elegido.kg_por_bulto
      );
      setAviso({ tipo: r.ok ? 'ok' : 'mal', texto: r.mensaje });
      if (r.ok) {
        setElegido(null);
        router.refresh();
        setCandidatos(await lotesCargables(packingId));
      }
    });
  }

  function quitar(loteId: number) {
    setAviso(null);
    iniciarGuardado(async () => {
      const r = await quitarLoteDelPacking(packingId, loteId);
      setAviso({ tipo: r.ok ? 'ok' : 'mal', texto: r.mensaje });
      if (r.ok) { router.refresh(); if (candidatos) setCandidatos(await lotesCargables(packingId)); }
    });
  }

  const totalBultos = cargados.reduce((s, l) => s + l.bultos, 0);
  const totalKg = cargados.reduce((s, l) => s + l.peso, 0);

  return (
    <div className="cargar">
      <div className="cargar-barra">
        <span className="cargar-cifras">
          <b>{cargados.length}</b> pallet{cargados.length === 1 ? '' : 's'} ·{' '}
          <b>{cifra(totalBultos)}</b> bultos · <b>{cifra(totalKg / 1000, 2)}</b> TM
        </span>
        {puede && (
          <button type="button" className="btn btn-secundario btn-chico"
                  onClick={candidatos ? () => setCandidatos(null) : abrir} disabled={cargando}>
            <Icono nombre="mas" tamano={14} />
            {cargando ? 'Buscando…' : candidatos ? 'Cerrar' : 'Agregar pallet'}
          </button>
        )}
      </div>

      {aviso && (
        <div className={`ficha-aviso ${aviso.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'}`}
             role={aviso.tipo === 'ok' ? 'status' : 'alert'}>
          <Icono nombre="alerta" tamano={16} />
          <span>{aviso.texto}</span>
        </div>
      )}

      {/* ---------- Los que ya están cargados ---------- */}
      {cargados.length === 0 ? (
        <p className="cargar-vacio">
          El contenedor está vacío. Agregue los pallets que van a salir y después repártalos en el
          plano de estiba.
        </p>
      ) : (
        <div className="tabla-envoltorio">
          <table className="datos">
            <thead>
              <tr>
                <th>Pallet</th><th>Producto</th>
                <th className="num">Bultos</th><th className="num">Peso</th>
                {puede && <th></th>}
              </tr>
            </thead>
            <tbody>
              {cargados.map((l) => (
                <tr key={l.lote_id}>
                  <td className="mono">{l.pallet}</td>
                  <td style={{ fontSize: '.78rem' }}>{l.producto}</td>
                  <td className="num mono">{cifra(l.bultos)}</td>
                  <td className="num mono">{cifra(l.peso, 1)} kg</td>
                  {puede && (
                    <td>
                      <button type="button" className="btn btn-sutil btn-chico"
                              onClick={() => quitar(l.lote_id)} disabled={guardando}>
                        Quitar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- Los candidatos ---------- */}
      {candidatos && (
        <div className="cargar-panel">
          <p className="cargar-pista">
            Solo pallets de la bodega desde la que sale este embarque, con saldo disponible y sin
            bloqueo de calidad. Van del <b>más antiguo al más nuevo</b>.
          </p>

          {candidatos.length === 0 ? (
            <p className="cargar-vacio">
              No queda ni un pallet cargable en esa bodega: o están todos apartados para otros
              pedidos, o bloqueados por calidad, o ya están en este contenedor.
            </p>
          ) : (
            <div className="tabla-envoltorio">
              <table className="datos">
                <thead>
                  <tr>
                    <th>Pallet</th><th>Producto</th>
                    <th className="num">Meses</th><th className="num">Disponible</th>
                    <th className="num">Bultos</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {candidatos.map((l) => (
                    <tr key={l.lote_id} data-elegido={elegido?.lote_id === l.lote_id ? 'si' : 'no'}>
                      <td className="mono">{l.codigo_pallet}</td>
                      <td style={{ fontSize: '.76rem' }}>{l.producto}</td>
                      <td className="num" style={{ color: l.meses >= 12 ? 'var(--atencion)' : undefined }}>
                        {cifra(l.meses, 1)}
                      </td>
                      <td className="num mono">{cifra(l.kg_disponibles)} kg</td>
                      <td className="num mono">{cifra(l.bultos_disponibles)}</td>
                      <td>
                        <button type="button" className="btn btn-sutil btn-chico" onClick={() => elegir(l)}>
                          {elegido?.lote_id === l.lote_id ? 'Elegido' : 'Elegir'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {elegido && (
            <div className="cargar-confirma">
              <label className="form-campo" style={{ maxWidth: '14rem' }}>
                <span>Bultos de <b className="mono">{elegido.codigo_pallet}</b></span>
                <input className="campo mono" type="number" min={1} max={elegido.bultos_disponibles}
                       value={bultos} onChange={(e) => setBultos(Number(e.target.value))} />
                <small>
                  Hasta {cifra(elegido.bultos_disponibles)} · son{' '}
                  {cifra(bultos * elegido.kg_por_bulto, 1)} kg
                </small>
              </label>
              <div className="acciones-fila">
                <button type="button" className="btn btn-primario" onClick={agregar}
                        disabled={guardando || !(bultos > 0)}>
                  <Icono nombre="guardar" tamano={15} />
                  {guardando ? 'Agregando…' : 'Agregar al contenedor'}
                </button>
                <button type="button" className="btn btn-sutil" onClick={() => setElegido(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
