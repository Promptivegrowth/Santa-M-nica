'use client';

/**
 * ============================================================================
 *  LOS TOPES DE PESO, EDITABLES DESDE EL CALENDARIO
 * ============================================================================
 *  Oliver describió el problema así: el peso máximo que admite el contenedor
 *  llega por correo, a veces a última hora, y para entonces el contenedor ya
 *  se está cargando.
 *
 *  Por eso el formulario está AQUÍ, en el planificador, y no escondido en la
 *  ficha del embarque: es la pantalla que Comercial ya tiene abierta cuando
 *  llega ese correo, y el sitio donde Almacén va a mirar antes de cargar.
 *
 *  Se abre plegado. Un embarque normal no necesita tope, y un formulario
 *  desplegado en cada tarjeta convertiría el calendario en un muro de campos.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { guardarTopeEmbarque } from './acciones';

export function TopesEmbarque({
  embarqueId,
  numero,
  netoKg,
  brutoKg,
  nota,
  puede,
  yaSalio,
}: {
  embarqueId: number;
  numero: string;
  /** Solo el tope PROPIO de este embarque. El heredado del destino no se edita aquí. */
  netoKg: number | null;
  brutoKg: number | null;
  nota: string | null;
  puede: boolean;
  yaSalio: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [guardando, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  /*
   * Los pesos se escriben en TONELADAS porque es como habla el negocio —«no
   * más de 26 toneladas»— y se guardan en kilos, que es como está el resto del
   * sistema. La conversión se hace aquí para que nadie tenga que contar ceros.
   */
  const aTm = (kg: number | null) => (kg === null ? '' : String(kg / 1000));

  const [neto, setNeto] = useState(aTm(netoKg));
  const [bruto, setBruto] = useState(aTm(brutoKg));
  const [texto, setTexto] = useState(nota ?? '');

  if (!puede || yaSalio) return null;

  function guardar() {
    setAviso(null);
    iniciar(async () => {
      const r = await guardarTopeEmbarque({
        embarque_id: embarqueId,
        peso_neto_max_kg: neto.trim() === '' ? null : Number(neto) * 1000,
        peso_bruto_max_kg: bruto.trim() === '' ? null : Number(bruto) * 1000,
        nota_comercial: texto.trim() || null,
      });
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) {
        setAbierto(false);
        router.refresh();
      }
    });
  }

  if (!abierto) {
    return (
      <>
        <button type="button" className="btn btn-sutil btn-chico cal-tope-abrir"
                onClick={() => setAbierto(true)}>
          <Icono nombre="configuracion" tamano={13} />
          {netoKg !== null || brutoKg !== null || nota ? 'Editar topes y nota' : 'Fijar topes de peso'}
        </button>
        {aviso && (
          <p className="cal-tarjeta-alerta" data-tono={aviso.ok ? 'ok' : 'critico'}>{aviso.texto}</p>
        )}
      </>
    );
  }

  return (
    <div className="cal-topes">
      <strong>Topes de {numero}</strong>
      <span className="cal-topes-ayuda">
        Lo que confirme aquí manda sobre la regla del destino. Déjelo vacío para volver a ella.
      </span>

      <div className="cal-topes-campos">
        <label>
          <span>Neto máx. (TM)</span>
          <input className="campo mono" type="number" step="0.1" min="0"
                 value={neto} onChange={(e) => setNeto(e.target.value)} placeholder="26" />
        </label>
        <label>
          <span>Bruto máx. (TM)</span>
          <input className="campo mono" type="number" step="0.1" min="0"
                 value={bruto} onChange={(e) => setBruto(e.target.value)} placeholder="27.5" />
          <small>Producto más empaque</small>
        </label>
      </div>

      <label className="cal-topes-nota">
        <span>Nota para Almacén</span>
        <input className="campo" type="text" maxLength={300}
               value={texto} onChange={(e) => setTexto(e.target.value)}
               placeholder="Bultos de máximo 30 kg · confirmado por la naviera el 3/09" />
      </label>

      {aviso && (
        <p className="cal-tarjeta-alerta" data-tono={aviso.ok ? 'ok' : 'critico'}>{aviso.texto}</p>
      )}

      <div className="cal-topes-acciones">
        <button type="button" className="btn btn-primario btn-chico"
                onClick={guardar} disabled={guardando}>
          <Icono nombre="guardar" tamano={13} />
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" className="btn btn-sutil btn-chico"
                onClick={() => { setAbierto(false); setAviso(null); }} disabled={guardando}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
