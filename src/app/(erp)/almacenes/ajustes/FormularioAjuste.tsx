'use client';

/**
 * ============================================================================
 *  REGISTRAR UN AJUSTE, UNA MERMA O UNA MUESTRA
 * ============================================================================
 *  Cuatro preguntas, en el orden en que se las hace quien está en cámara:
 *  ¿qué pallet?, ¿qué pasó?, ¿cuánto? y ¿por qué?
 *
 *  LO QUE HACE QUE SIRVA
 *  Que diga ANTES de guardar cómo queda el pallet: con cuántos bultos y kilos,
 *  si se come kilos reservados para un pedido y si está bloqueado por Calidad.
 *  Un ajuste no se puede deshacer —el Kardex no se edita—: solo se compensa
 *  con otro, que también queda a la vista. Por eso se mira antes.
 *
 *  Los tipos que el rol no puede registrar se ven apagados y dicen por qué; la
 *  base de datos lo rechazaría igual (stock_ajustar, migración 069).
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import {
  registrarAjuste, posicionesDePallet,
  type TipoAjuste, type PosicionPallet,
} from './acciones';

export type MotivoAjuste = {
  id: number;
  nombre: string;
  tipos: TipoAjuste[];
  requiere_autorizacion: boolean;
};

const cifra = (n: number, d = 1) =>
  n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });

const AUTORIZAN = ['gerencia', 'operaciones'];

const TIPOS: {
  valor: TipoAjuste; titulo: string; ayuda: string; signo: 1 | -1;
  roles: string[]; porQueNo: string; boton: string;
}[] = [
  {
    valor: 'ajuste_positivo', titulo: 'Ajuste que suma', signo: 1,
    ayuda: 'Hay más de lo que dice el sistema: conteo físico, error de registro.',
    roles: AUTORIZAN, porQueNo: 'Los ajustes los registra y autoriza Gerencia u Operaciones.',
    boton: 'Registrar ajuste',
  },
  {
    valor: 'ajuste_negativo', titulo: 'Ajuste que resta', signo: -1,
    ayuda: 'Hay menos de lo que dice el sistema: conteo físico, error de registro.',
    roles: AUTORIZAN, porQueNo: 'Los ajustes los registra y autoriza Gerencia u Operaciones.',
    boton: 'Registrar ajuste',
  },
  {
    valor: 'salida_merma', titulo: 'Merma', signo: -1,
    ayuda: 'Se perdió producto: daño en cámara, vida útil vencida, derivado a harina.',
    roles: ['gerencia', 'operaciones', 'almacen'], porQueNo: 'Las mermas las registran Gerencia, Operaciones o Almacén.',
    boton: 'Registrar merma',
  },
  {
    valor: 'salida_muestra', titulo: 'Muestra', signo: -1,
    ayuda: 'Sale para análisis: SGS, Intertek o control de producto terminado.',
    roles: ['gerencia', 'operaciones', 'almacen', 'calidad'], porQueNo: '',
    boton: 'Registrar muestra',
  },
];

export function FormularioAjuste({
  motivos,
  rol,
  posicionesIniciales,
}: {
  motivos: MotivoAjuste[];
  rol: string;
  /** Si se llega desde la ficha del pallet, sus posiciones ya vienen cargadas. */
  posicionesIniciales: PosicionPallet[];
}) {
  const router = useRouter();
  const [trabajando, iniciar] = useTransition();
  const [buscando, iniciarBusqueda] = useTransition();

  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<PosicionPallet[] | null>(
    posicionesIniciales.length > 1 ? posicionesIniciales : null
  );
  const [pos, setPos] = useState<PosicionPallet | null>(
    posicionesIniciales.length === 1 ? posicionesIniciales[0] : null
  );

  const tiposPermitidos = TIPOS.filter((t) => t.roles.includes(rol));
  const [tipo, setTipo] = useState<TipoAjuste>(tiposPermitidos[0]?.valor ?? 'salida_muestra');
  const [bultos, setBultos] = useState(0);
  const [peso, setPeso] = useState(0);
  const [motivoId, setMotivoId] = useState(0);
  const [detalle, setDetalle] = useState('');
  const [tocarReservas, setTocarReservas] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'mal' | 'confirmar'; texto: string } | null>(null);
  const [hecho, setHecho] = useState<{ texto: string; loteId: number } | null>(null);

  const meta = TIPOS.find((t) => t.valor === tipo)!;
  const puedeAutorizar = AUTORIZAN.includes(rol);
  const motivosDelTipo = motivos.filter((m) => m.tipos.includes(tipo));

  /* ---- Cómo queda el pallet ---- */
  const bultosDespues = pos ? pos.bultos + meta.signo * bultos : 0;
  const kgDespues = pos ? pos.fisico_kg + meta.signo * peso : 0;
  const quedaNegativo = !!pos && (bultosDespues < 0 || kgDespues < -0.001);
  const kilosSinBultos = !!pos && !quedaNegativo && bultosDespues === 0 && kgDespues > 0.001;
  const bultosSinKilos = !!pos && !quedaNegativo && bultosDespues > 0 && kgDespues <= 0.001;
  const excesoReservado = pos && meta.signo === -1 ? pos.reservado_kg - Math.max(kgDespues, 0) : 0;
  /* También si la base lo pidió: las cifras de la pantalla pueden haber
     envejecido (otro usuario reservó mientras se llenaba el formulario). */
  const tocaReservas = excesoReservado > 0.001 || aviso?.tipo === 'confirmar';
  const restaSinStock = !!pos && meta.signo === -1 && pos.bultos === 0 && pos.fisico_kg <= 0;

  function buscar() {
    setAviso(null);
    iniciarBusqueda(async () => {
      const lista = await posicionesDePallet({ texto });
      setResultados(lista);
      if (lista.length === 1) setPos(lista[0]);
    });
  }

  function elegirTipo(t: TipoAjuste) {
    setTipo(t);
    setMotivoId(0);
    setTocarReservas(false);
    setAviso(null);
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!pos) return;
    setAviso(null);
    iniciar(async () => {
      const r = await registrarAjuste({
        lote_id: pos.lote_id,
        almacen_id: pos.almacen_id,
        tipo,
        bultos,
        peso_kg: peso,
        motivo_id: motivoId,
        detalle,
        tocar_reservas: tocarReservas,
      });
      if (!r.ok) {
        setAviso({ tipo: r.confirmar ? 'confirmar' : 'mal', texto: r.mensaje });
        return;
      }
      setHecho({ texto: r.mensaje, loteId: r.lote_id });
      setBultos(0); setPeso(0); setDetalle(''); setMotivoId(0); setTocarReservas(false);
      /* Las cifras del pallet cambiaron: se vuelven a leer. */
      const nuevas = await posicionesDePallet({ loteId: pos.lote_id });
      setPos(nuevas.find((x) => x.almacen_id === pos.almacen_id) ?? null);
      router.refresh();
    });
  }

  const listoParaGuardar =
    !!pos && peso > 0 && bultos >= 0 && motivoId > 0 && detalle.trim().length >= 10 &&
    !quedaNegativo && !kilosSinBultos && !bultosSinKilos && !restaSinStock &&
    (!tocaReservas || (puedeAutorizar && tocarReservas)) && meta.roles.includes(rol);

  /* Por qué el botón está apagado, dicho al lado del botón. */
  const faltan = [
    !pos && 'elegir el pallet',
    !(peso > 0) && 'los kilos',
    !motivoId && 'el motivo',
    detalle.trim().length < 10 && 'explicar qué pasó (10 caracteres)',
    tocaReservas && puedeAutorizar && !tocarReservas && 'confirmar que se reducen las reservas',
  ].filter(Boolean) as string[];

  return (
    <form className="form-maestro" onSubmit={enviar} data-formulario="ajuste">
      {hecho && (
        <div className="ficha-aviso ficha-aviso-info" role="status">
          <Icono nombre="guardar" tamano={17} />
          <span>
            {hecho.texto}{' '}
            <Link href={`/almacenes/lotes/${hecho.loteId}`} className="enlace-ficha">Ver el pallet</Link>
          </span>
        </div>
      )}

      {/* ---------------- Qué pallet ---------------- */}
      <fieldset className="form-bloque" data-bloque="pallet">
        <legend>Qué pallet <b className="req">*</b></legend>

        {pos ? (
          <div className="ajuste-pallet">
            <div>
              <strong className="mono">{pos.pallet}</strong> · {pos.almacen}
              <small>{pos.producto}</small>
            </div>
            <dl>
              <div><dt>Físico</dt><dd>{pos.bultos} bultos · {cifra(pos.fisico_kg)} kg</dd></div>
              <div><dt>Reservado</dt><dd>{cifra(pos.reservado_kg)} kg</dd></div>
              <div><dt>Bloqueado por Calidad</dt><dd>{cifra(pos.bloqueado_kg)} kg</dd></div>
              <div><dt>Disponible</dt><dd>{cifra(pos.disponible_kg)} kg</dd></div>
            </dl>
            <button type="button" className="btn btn-sutil" onClick={() => { setPos(null); setHecho(null); }}>
              Cambiar de pallet
            </button>
          </div>
        ) : (
          <>
            <div className="form-rejilla">
              <label className="form-campo form-campo-ancho">
                <span>Código de pallet</span>
                <input className="campo mono" value={texto} name="buscar_pallet"
                       placeholder="Por ejemplo SM 26 02 0168 (al menos 3 caracteres)"
                       onChange={(e) => setTexto(e.target.value)}
                       onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } }} />
              </label>
              <div className="form-campo" style={{ alignSelf: 'end' }}>
                <button type="button" className="btn btn-secundario" onClick={buscar}
                        disabled={buscando || texto.trim().length < 3}>
                  <Icono nombre="buscar" tamano={14} />
                  {buscando ? 'Buscando…' : 'Buscar pallet'}
                </button>
              </div>
            </div>

            {resultados && (resultados.length === 0 ? (
              <p className="form-pista">No hay ningún pallet con ese código en las bodegas.</p>
            ) : (
              <div className="tabla-envoltorio" style={{ marginTop: '.6rem' }}>
                <table className="datos">
                  <thead>
                    <tr>
                      <th>Pallet</th><th>Producto</th><th>Almacén</th>
                      <th className="num">Bultos</th><th className="num">Físico</th>
                      <th className="num">Reservado</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultados.map((r) => (
                      <tr key={`${r.lote_id}-${r.almacen_id}`}>
                        <td className="mono">{r.pallet}</td>
                        <td style={{ fontSize: '.78rem' }}>{r.producto}</td>
                        <td style={{ fontSize: '.78rem' }}>{r.almacen}</td>
                        <td className="num">{r.bultos}</td>
                        <td className="num">{cifra(r.fisico_kg)} kg</td>
                        <td className="num">{cifra(r.reservado_kg)} kg</td>
                        <td>
                          <button type="button" className="btn btn-sutil" onClick={() => setPos(r)}>Elegir</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )}
      </fieldset>

      {/* ---------------- Qué pasó ---------------- */}
      <fieldset className="form-bloque" data-bloque="tipo">
        <legend>Qué pasó <b className="req">*</b></legend>
        <div className="origen-opciones" role="radiogroup" aria-label="Tipo de movimiento">
          {TIPOS.map((t) => {
            const permitido = t.roles.includes(rol);
            return (
              <label key={t.valor} className="origen-opcion"
                     data-elegida={tipo === t.valor ? 'si' : 'no'}
                     data-apagada={permitido ? 'no' : 'si'}
                     title={permitido ? undefined : t.porQueNo}>
                <input type="radio" name="tipo_ajuste" value={t.valor}
                       checked={tipo === t.valor} disabled={!permitido}
                       onChange={() => elegirTipo(t.valor)} />
                <span>
                  <strong>{t.titulo} ({t.signo === 1 ? '+' : '−'})</strong>
                  <small>{permitido ? t.ayuda : t.porQueNo}</small>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* ---------------- Cuánto ---------------- */}
      <fieldset className="form-bloque" data-bloque="cuanto">
        <legend>Cuánto {meta.signo === 1 ? 'suma' : 'resta'}</legend>
        <div className="form-rejilla">
          <label className="form-campo">
            <span>Bultos <b className="req">*</b></span>
            <input className="campo mono" type="number" min={0} step={1} name="bultos"
                   value={Number.isFinite(bultos) ? bultos : 0}
                   onChange={(e) => { setBultos(Math.max(0, Math.trunc(Number(e.target.value)))); setAviso(null); }} />
            <small>Cero si solo cambia el peso.</small>
          </label>
          <label className="form-campo">
            <span>Kilos <b className="req">*</b></span>
            <input className="campo mono" type="number" min={0} step={0.1} name="peso_kg"
                   value={peso || ''}
                   onChange={(e) => { setPeso(Math.max(0, Number(e.target.value))); setAviso(null); }} />
            {pos && pos.kg_por_bulto > 0 && bultos > 0 && (
              <small>
                {bultos} × {cifra(pos.kg_por_bulto)} kg (bulto estándar) = {cifra(bultos * pos.kg_por_bulto)} kg.{' '}
                <button type="button" className="enlace-dato" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                        onClick={() => setPeso(Math.round(bultos * pos.kg_por_bulto * 1000) / 1000)}>
                  Usar ese peso
                </button>
              </small>
            )}
          </label>
        </div>

        {pos && (bultos > 0 || peso > 0) && (
          <p className="form-pista" data-pista="queda">
            Después: <b>{bultosDespues} bultos · {cifra(kgDespues)} kg</b> en {pos.almacen}
            {' '}(ahora {pos.bultos} bultos · {cifra(pos.fisico_kg)} kg).
          </p>
        )}
        {restaSinStock && (
          <p className="traslado-alerta"><Icono nombre="alerta" tamano={15} />Este pallet no tiene stock en esta bodega: no hay nada que restar.</p>
        )}
        {quedaNegativo && (
          <p className="traslado-alerta"><Icono nombre="alerta" tamano={15} />El pallet quedaría en negativo: no se puede restar más de lo que tiene.</p>
        )}
        {kilosSinBultos && (
          <p className="traslado-alerta"><Icono nombre="alerta" tamano={15} />Quedarían {cifra(kgDespues)} kg sin ningún bulto: si sale todo el pallet, reste también todos sus kilos.</p>
        )}
        {bultosSinKilos && (
          <p className="traslado-alerta"><Icono nombre="alerta" tamano={15} />Quedarían {bultosDespues} bultos sin peso: reste también los bultos.</p>
        )}
        {pos && pos.bloqueado_kg > 0 && (
          <p className="form-pista">
            Este pallet está bloqueado por Calidad: se puede registrar su merma o su muestra igual (el producto
            existe), pero sigue sin poder venderse hasta que Calidad lo libere.
          </p>
        )}
      </fieldset>

      {/* ---------------- Lo reservado ---------------- */}
      {pos && tocaReservas && !quedaNegativo && (
        <div className="ficha-aviso ficha-aviso-atencion" data-aviso="reservas">
          <Icono nombre="reservas" tamano={17} />
          <span>
            <strong>Esto toca kilos reservados.</strong> Después quedarían {cifra(Math.max(kgDespues, 0))} kg y hay{' '}
            {cifra(pos.reservado_kg)} kg apartados para{' '}
            {[...new Set(pos.reservas.map((r) => r.pedido))].join(', ')}. Si sigue, esas reservas se reducen en{' '}
            {cifra(excesoReservado)} kg (primero la más nueva) y esos pedidos quedan con menos stock apartado.
            {puedeAutorizar ? (
              <label style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem', alignItems: 'center' }}>
                <input type="checkbox" name="tocar_reservas" checked={tocarReservas}
                       onChange={(e) => setTocarReservas(e.target.checked)} />
                Entiendo: reducir esas reservas en {cifra(excesoReservado)} kg.
              </label>
            ) : (
              <> <b>Solo Gerencia u Operaciones pueden reducir reservas:</b> pídales que lo registren.</>
            )}
          </span>
        </div>
      )}

      {/* ---------------- Por qué ---------------- */}
      <fieldset className="form-bloque" data-bloque="motivo">
        <legend>Por qué <b className="req">*</b></legend>
        <div className="form-rejilla">
          <label className="form-campo form-campo-ancho">
            <span>Motivo <b className="req">*</b></span>
            <select className="campo" name="motivo" value={motivoId || ''}
                    onChange={(e) => { setMotivoId(Number(e.target.value)); setAviso(null); }}>
              <option value="">Elija el motivo…</option>
              {motivosDelTipo.map((m) => {
                const apagado = m.requiere_autorizacion && !puedeAutorizar;
                return (
                  <option key={m.id} value={m.id} disabled={apagado}>
                    {m.nombre}{apagado ? ' (requiere autorización de Gerencia u Operaciones)' : ''}
                  </option>
                );
              })}
            </select>
            {motivosDelTipo.length > 0 && motivosDelTipo.every((m) => m.requiere_autorizacion) && !puedeAutorizar && (
              <small>
                Todos los motivos de este tipo requieren autorización: avise a Operaciones para que lo registre.
              </small>
            )}
          </label>
          <label className="form-campo form-campo-ancho">
            <span>Qué pasó, en sus palabras <b className="req">*</b></span>
            <textarea className="campo" name="detalle" rows={2} maxLength={300} value={detalle}
                      placeholder="Por ejemplo: en el conteo del martes faltaban 2 cajas rotas en la fila 3"
                      onChange={(e) => { setDetalle(e.target.value); setAviso(null); }} />
            <small>Al menos 10 caracteres. Queda en el Kardex y en el historial del pallet.</small>
          </label>
        </div>
      </fieldset>

      {aviso && (
        <div className={`ficha-aviso ${aviso.tipo === 'mal' ? 'ficha-aviso-critico' : 'ficha-aviso-atencion'}`} role="alert">
          <Icono nombre="alerta" tamano={17} />
          <span>{aviso.texto}</span>
        </div>
      )}

      <div className="form-acciones">
        <button type="submit" className="btn btn-primario" disabled={trabajando || !listoParaGuardar}
                data-accion="registrar-ajuste">
          <Icono nombre="guardar" tamano={15} />
          {trabajando ? 'Registrando…' : meta.boton}
        </button>
        <span className="form-pista" style={{ margin: 0 }} data-pista="falta">
          {!listoParaGuardar && faltan.length > 0
            ? `Falta: ${faltan.join(', ')}.`
            : 'No se puede deshacer: el Kardex no se edita. Si se equivoca, se compensa con otro ajuste.'}
        </span>
      </div>

      <style jsx>{`
        .ajuste-pallet {
          display: grid; gap: .6rem; grid-template-columns: minmax(12rem, 1fr) 2fr auto; align-items: center;
        }
        .ajuste-pallet small { display: block; color: var(--tinta-3); font-size: .74rem; }
        .ajuste-pallet dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: .4rem; margin: 0; }
        .ajuste-pallet dt { font-size: .68rem; color: var(--tinta-3); }
        .ajuste-pallet dd { margin: 0; font-weight: 600; font-size: .82rem; }
        @media (max-width: 760px) { .ajuste-pallet { grid-template-columns: 1fr; } }
        :global(.origen-opcion[data-apagada='si']) { opacity: .55; cursor: not-allowed; }
      `}</style>
    </form>
  );
}
