'use client';

/**
 * ============================================================================
 *  APARTAR STOCK PARA UNA LÍNEA DEL PEDIDO
 * ============================================================================
 *  Este es el eslabón que faltaba entre «el cliente aceptó» y «el producto
 *  sale de cámara». Hasta ahora el pedido se quedaba en 0 % de avance para
 *  siempre, porque no había manera de apartar nada.
 *
 *  CÓMO ESTÁ PENSADO
 *  Se abre desde la línea que se quiere cubrir. El sistema trae los lotes que
 *  sirven —del mismo producto, con saldo disponible— y los ordena por
 *  antigüedad: primero lo más viejo, que es lo que se tiene que ir antes para
 *  que no se venza en cámara. Ese criterio hoy lo aplica almacén de memoria.
 *
 *  Al elegir un lote se propone apartar lo que falte, o lo que quede en ese
 *  pallet si es menos. La cifra se puede corregir, pero el valor que llega
 *  puesto es el correcto en el 90 % de los casos.
 *
 *  POR QUÉ SE ELIGE EL LOTE A MANO Y NO LO DECIDE EL SISTEMA
 *  Porque la elección tiene criterio que el programa no conoce: puede convenir
 *  sacar de la bodega desde la que sale el contenedor para no pagar un
 *  traslado, aunque no sea el más antiguo. El sistema ordena y avisa; decide
 *  la persona.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import {
  crearReserva, lotesParaLinea,
  type LoteCandidato, type OpcionesDeLinea,
} from '@/app/(erp)/almacenes/reservas/acciones';

const cifra = (n: number, d = 0) =>
  n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });

export function BotonReservar({
  pedidoLineaId,
  producto,
  puede,
}: {
  pedidoLineaId: number;
  producto: string;
  puede: boolean;
}) {
  const router = useRouter();
  const [cargando, iniciarCarga] = useTransition();
  const [guardando, iniciarGuardado] = useTransition();

  const [opciones, setOpciones] = useState<OpcionesDeLinea | null>(null);
  const [elegido, setElegido] = useState<LoteCandidato | null>(null);
  const [kilos, setKilos] = useState(0);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'mal'; texto: string } | null>(null);

  function abrir() {
    setAviso(null);
    iniciarCarga(async () => {
      const datos = await lotesParaLinea(pedidoLineaId);
      setOpciones(datos);
      setElegido(null);
      setKilos(0);
    });
  }

  function elegir(lote: LoteCandidato) {
    setElegido(lote);
    // Se propone lo que falte, o lo que quede en el pallet si es menos.
    const propuesto = Math.min(opciones?.faltaKg ?? 0, lote.disponible_kg);
    setKilos(Math.round(propuesto * 10) / 10);
    setAviso(null);
  }

  function apartar() {
    if (!elegido) return;
    setAviso(null);

    iniciarGuardado(async () => {
      const r = await crearReserva({
        pedido_linea_id: pedidoLineaId,
        lote_id: elegido.lote_id,
        almacen_id: elegido.almacen_id,
        // Los bultos se derivan del peso: apartar «medio bulto» no existe en
        // cámara, así que se redondea hacia arriba al bulto completo.
        bultos: Math.max(1, Math.ceil(kilos / elegido.kg_por_bulto)),
        peso_neto_kg: kilos,
      });

      if (!r.ok) { setAviso({ tipo: 'mal', texto: r.mensaje }); return; }

      setAviso({ tipo: 'ok', texto: r.mensaje });
      setElegido(null);
      router.refresh();
      // Se recargan los candidatos: el disponible acaba de cambiar.
      const datos = await lotesParaLinea(pedidoLineaId);
      setOpciones(datos);
    });
  }

  if (!puede) return null;

  return (
    <>
      <button
        type="button"
        className="btn btn-secundario btn-chico"
        onClick={opciones ? () => setOpciones(null) : abrir}
        disabled={cargando}
      >
        <Icono nombre="reservas" tamano={14} />
        {cargando ? 'Buscando lotes…' : opciones ? 'Cerrar' : 'Apartar stock'}
      </button>

      {aviso && (
        <div
          className={`ficha-aviso ${aviso.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'} reservar-mensaje`}
          role={aviso.tipo === 'ok' ? 'status' : 'alert'}
        >
          <Icono nombre="alerta" tamano={16} />
          <span>{aviso.texto}</span>
        </div>
      )}

      {opciones && (
        <div className="reservar">
          <div className="reservar-cab">
            <div>
              <strong>{opciones.producto || producto}</strong>
              <span>
                Pedidas {cifra(opciones.pedidoKg / 1000, 2)} TM ·{' '}
                {opciones.faltaKg > 0
                  ? <b className="falta">faltan {cifra(opciones.faltaKg)} kg por apartar</b>
                  : <b className="cubierta">línea cubierta al 100 %</b>}
              </span>
            </div>
          </div>

          {opciones.aviso && (
            <p className="reservar-aviso">
              <Icono nombre="alerta" tamano={15} />
              <span>{opciones.aviso}</span>
            </p>
          )}

          {opciones.candidatos.length === 0 ? (
            <p className="reservar-vacio">
              No hay lotes de este producto con saldo disponible en ninguna bodega.
            </p>
          ) : (
            <>
              <p className="reservar-pista">
                Los lotes salen ordenados del <b>más antiguo al más nuevo</b>: lo que lleva más
                tiempo en cámara es lo que conviene sacar primero.
              </p>

              <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                <table className="datos">
                  <thead>
                    <tr>
                      <th>Pallet</th>
                      <th>Almacén</th>
                      <th className="num">Producido</th>
                      <th className="num">Meses</th>
                      <th className="num">Disponible</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {opciones.candidatos.map((l) => (
                      <tr key={`${l.lote_id}-${l.almacen_id}`}
                          data-elegido={elegido?.lote_id === l.lote_id && elegido?.almacen_id === l.almacen_id ? 'si' : 'no'}>
                        <td className="mono">{l.codigo_pallet}</td>
                        <td style={{ fontSize: '.78rem' }}>{l.almacen}</td>
                        <td className="num mono" style={{ fontSize: '.74rem' }}>
                          {l.fecha_produccion.slice(0, 10).split('-').reverse().join('/')}
                        </td>
                        <td className="num" style={{ color: l.meses >= 12 ? 'var(--atencion)' : undefined }}>
                          {cifra(l.meses, 1)}
                        </td>
                        <td className="num"><strong>{cifra(l.disponible_kg)} kg</strong></td>
                        <td>
                          <button type="button" className="btn btn-sutil btn-chico"
                                  onClick={() => elegir(l)}>
                            Elegir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {elegido && (
            <div className="reservar-confirma">
              <div className="reservar-campo">
                <label htmlFor={`kg-${pedidoLineaId}`}>
                  Kilos a apartar del pallet <b className="mono">{elegido.codigo_pallet}</b>
                </label>
                <input
                  id={`kg-${pedidoLineaId}`}
                  className="campo mono"
                  type="number"
                  min={0}
                  max={Math.min(elegido.disponible_kg, opciones.faltaKg)}
                  step={0.1}
                  value={kilos}
                  onChange={(e) => setKilos(Number(e.target.value))}
                />
                <small>
                  Tope: {cifra(Math.min(elegido.disponible_kg, opciones.faltaKg))} kg
                  {elegido.disponible_kg < opciones.faltaKg
                    ? ' (es lo que queda en el pallet)'
                    : ' (es lo que falta por cubrir)'}
                  {' · '}
                  {/* Se enseña la conversión para que nadie tenga que hacerla a mano */}
                  {Math.max(1, Math.ceil(kilos / elegido.kg_por_bulto))} bultos de {cifra(elegido.kg_por_bulto, 1)} kg
                </small>
              </div>

              <div className="acciones-fila">
                <button type="button" className="btn btn-primario" onClick={apartar}
                        disabled={guardando || !(kilos > 0)}>
                  <Icono nombre="guardar" tamano={15} />
                  {guardando ? 'Apartando…' : 'Apartar'}
                </button>
                <button type="button" className="btn btn-sutil" onClick={() => setElegido(null)}
                        disabled={guardando}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
