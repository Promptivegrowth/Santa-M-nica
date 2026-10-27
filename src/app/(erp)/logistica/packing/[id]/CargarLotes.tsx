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
import { accionSegura } from '@/lib/accionSegura';
import './despachar.css';
import {
  lotesCargables, agregarLoteAlPacking, quitarLoteDelPacking,
  type LoteCargable,
} from '../acciones';

const cifra = (n: number, d = 0) =>
  n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Cómo se lee el motivo de una diferencia al despachar (075). */
const MOTIVO_TEXTO: Record<string, string> = {
  muestreo: 'Muestreo',
  merma: 'Sacos dañados / merma',
  no_entro: 'No entró en el contenedor',
  otro: 'Otro',
};

export type PalletCargado = {
  lote_id: number;
  pallet: string;
  producto: string;
  /** Lo que hay en el contenedor; ya despachado, lo que SALIÓ. */
  bultos: number;
  peso: number;
  /** Lo que se cargó: distinto de lo de arriba solo si al despachar salió otra cosa. */
  bultos_cargados: number;
  peso_cargado: number;
  motivo: string | null;
  detalle: string | null;
  /** Si Calidad lo bloqueó después de cargarlo, por qué. */
  bloqueo: string | null;
};

/** Un fallo de red no rompe la pantalla: vuelve como un resultado más (accionSegura). */
const conRed = <T,>(f: () => Promise<T>) => accionSegura(f);

export function CargarLotes({
  packingId,
  cargados,
  puede,
  despachado = false,
}: {
  packingId: number;
  cargados: PalletCargado[];
  puede: boolean;
  /** Ya salió: se enseña lo cargado contra lo que salió. */
  despachado?: boolean;
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
      const r = await conRed(() => lotesCargables(packingId));
      if (!Array.isArray(r)) { setAviso({ tipo: 'mal', texto: r.mensaje }); return; }
      setCandidatos(r);
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
      const r = await conRed(() => agregarLoteAlPacking(
        packingId, elegido.lote_id, bultos, bultos * elegido.kg_por_bulto
      ));
      setAviso({ tipo: r.ok ? 'ok' : 'mal', texto: r.mensaje });
      if (r.ok) {
        setElegido(null);
        router.refresh();
        const lista = await conRed(() => lotesCargables(packingId));
        if (Array.isArray(lista)) setCandidatos(lista);
      }
    });
  }

  function quitar(loteId: number) {
    setAviso(null);
    iniciarGuardado(async () => {
      const r = await conRed(() => quitarLoteDelPacking(packingId, loteId));
      setAviso({ tipo: r.ok ? 'ok' : 'mal', texto: r.mensaje });
      if (r.ok) {
        router.refresh();
        if (candidatos) {
          const lista = await conRed(() => lotesCargables(packingId));
          if (Array.isArray(lista)) setCandidatos(lista);
        }
      }
    });
  }

  const apartados = (candidatos ?? []).filter((l) => l.reservado_para);
  const libres = (candidatos ?? []).filter((l) => !l.reservado_para);

  /**
   * Carga de una vez todos los pallets apartados para este embarque.
   *
   * Es el caso normal: si alguien ya decidió qué mercadería es de qué cliente,
   * el contenedor lleva eso. Hacerlo pallet por pallet solo añade clics y
   * ocasiones de saltarse uno.
   */
  function agregarTodosApartados() {
    setAviso(null);
    iniciarGuardado(async () => {
      let bien = 0;
      const fallos: string[] = [];
      for (const l of apartados) {
        const r = await conRed(() => agregarLoteAlPacking(
          packingId, l.lote_id, l.bultos_disponibles, l.kg_disponibles
        ));
        if (r.ok) bien += 1;
        else fallos.push(`${l.codigo_pallet}: ${r.mensaje}`);
        if ('sinConexion' in r) break;
      }
      setAviso({
        tipo: bien > 0 ? 'ok' : 'mal',
        texto: bien > 0
          ? `${bien} pallet${bien === 1 ? '' : 's'} cargado${bien === 1 ? '' : 's'}.` +
            (fallos.length ? ` No se pudo con: ${fallos.join(' · ')}` : ' Ahora repártalos en el plano de estiba.')
          : `No se pudo cargar ninguno. ${fallos.join(' · ')}`,
      });
      router.refresh();
      const lista = await conRed(() => lotesCargables(packingId));
      if (Array.isArray(lista)) setCandidatos(lista);
      setElegido(null);
    });
  }

  const totalBultos = cargados.reduce((s, l) => s + l.bultos, 0);
  const totalKg = cargados.reduce((s, l) => s + l.peso, 0);
  /* Ya despachado y con alguna diferencia: se enseña cargado contra salido (075). */
  const conDiferencias = despachado && cargados.some((l) => l.motivo);

  return (
    <div className="cargar">
      <div className="cargar-barra">
        <span className="cargar-cifras">
          <b>{cargados.length}</b> pallet{cargados.length === 1 ? '' : 's'} ·{' '}
          <b>{cifra(totalBultos)}</b> bultos · <b>{cifra(totalKg / 1000, 2)}</b> TM
          {despachado ? (conDiferencias ? ' despachados' : ' · salió todo lo cargado') : ''}
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
          <table className="datos" data-cuadro="pallets-cargados">
            <thead>
              <tr>
                <th>Pallet</th><th>Producto</th>
                {conDiferencias ? (
                  <>
                    <th className="num">Cargado</th><th className="num">Despachado</th><th>Diferencia y motivo</th>
                  </>
                ) : (
                  <><th className="num">Bultos</th><th className="num">Peso</th></>
                )}
                {puede && <th></th>}
              </tr>
            </thead>
            <tbody>
              {cargados.map((l) => (
                <tr key={l.lote_id} data-lote={l.lote_id} data-bloqueado={l.bloqueo ? 'si' : 'no'}
                    data-diferencia={l.motivo ? 'si' : 'no'}>
                  <td className="mono">
                    {l.pallet}
                    {l.bloqueo && (
                      <span className="marca-bloqueo" title={`Bloqueado por Calidad: ${l.bloqueo}. No puede salir.`}>
                        Bloqueado por Calidad
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: '.78rem' }}>
                    {l.producto}
                    {l.bloqueo && <span className="marca-diferencia" style={{ color: 'var(--critico)' }}>{l.bloqueo}: no puede salir.</span>}
                  </td>
                  {conDiferencias ? (
                    <>
                      <td className="num mono">{cifra(l.bultos_cargados)} b · {cifra(l.peso_cargado, 1)} kg</td>
                      <td className="num mono">{cifra(l.bultos)} b · {cifra(l.peso, 1)} kg</td>
                      <td style={{ fontSize: '.76rem' }}>
                        {l.motivo ? (
                          <>
                            <b>−{cifra(l.bultos_cargados - l.bultos)} b · −{cifra(l.peso_cargado - l.peso, 1)} kg</b>{' '}
                            {MOTIVO_TEXTO[l.motivo] ?? l.motivo}{l.detalle ? `: ${l.detalle}` : ''}
                          </>
                        ) : 'Salió todo'}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="num mono">{cifra(l.bultos)}</td>
                      <td className="num mono">{cifra(l.peso, 1)} kg</td>
                    </>
                  )}
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
          {/*
            Dos grupos, y el orden no es estético: lo apartado para los pedidos
            de este embarque es lo que hay que cargar —alguien ya decidió que
            esa mercadería es de ese cliente—. El stock libre es para
            completar, y va debajo.
          */}
          {apartados.length > 0 && (
            <>
              <div className="cargar-grupo">
                <div>
                  <strong>Apartado para los pedidos de este embarque</strong>
                  <span>Es lo que corresponde cargar. Ya está comprometido con su cliente.</span>
                </div>
                {apartados.length > 1 && (
                  <button type="button" className="btn btn-primario btn-chico"
                          onClick={agregarTodosApartados} disabled={guardando}>
                    <Icono nombre="packing" tamano={14} />
                    {guardando ? 'Cargando…' : `Cargar los ${apartados.length}`}
                  </button>
                )}
              </div>

              <div className="tabla-envoltorio">
                <table className="datos">
                  <thead>
                    <tr>
                      <th>Pallet</th><th>Producto</th><th>Para</th>
                      <th className="num">Apartado</th><th className="num">Bultos</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {apartados.map((l) => (
                      <tr key={l.lote_id} data-elegido={elegido?.lote_id === l.lote_id ? 'si' : 'no'}>
                        <td className="mono">{l.codigo_pallet}</td>
                        <td style={{ fontSize: '.76rem' }}>{l.producto}</td>
                        <td style={{ fontSize: '.72rem', color: 'var(--acento)' }}>{l.reservado_para}</td>
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
            </>
          )}

          <div className="cargar-grupo">
            <div>
              <strong>Otro stock libre en la bodega</strong>
              <span>
                Sin apartar y sin bloqueo de calidad, del <b>más antiguo al más nuevo</b>. Sirve
                para completar el contenedor.
              </span>
            </div>
          </div>

          {libres.length === 0 ? (
            <p className="cargar-vacio">
              No queda stock libre en esa bodega: o está todo apartado para otros pedidos, o
              bloqueado por calidad, o ya está en este contenedor.
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
                  {libres.map((l) => (
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
