'use client';

/**
 * ============================================================================
 *  LA RESTRICCIÓN DE PESO QUE EL CLIENTE LE PONE AL PEDIDO
 * ============================================================================
 *  Oliver describió el problema así: el peso máximo que admite el contenedor
 *  llega por correo, a veces a última hora, y para entonces el contenedor ya
 *  se está cargando.
 *
 *  ESTE FORMULARIO ESTABA EN EL PLANIFICADOR Y SE MOVIÓ AQUÍ.
 *  Se lo preguntamos y respondió: «esa restricción debe registrarse en el
 *  pedido, ya que no hay un maestro; el 90 % de las observaciones son que el
 *  cliente indica a Comercial».
 *
 *  Y tiene razón técnica además de operativa: un embarque puede consolidar dos
 *  pedidos, y entonces escribir el tope «en el embarque» no dice a cuál de los
 *  dos clientes pertenece. En el pedido no hay ambigüedad posible.
 *
 *  El planificador lo sigue enseñando —tomando el más estricto de los pedidos
 *  que lleva cada salida— pero ya no lo edita: enlaza aquí.
 *
 *  Se abre plegado. La mayoría de los pedidos no lleva restricción, y un
 *  formulario desplegado siempre llenaría la ficha de campos vacíos.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { guardarRestriccionPedido } from './accionesRestriccion';

export function RestriccionPeso({
  pedidoId,
  numero,
  netoKg,
  brutoKg,
  nota,
  puede,
  yaSalio,
}: {
  pedidoId: number;
  numero: string;
  /** El límite que indicó el cliente para este pedido. */
  netoKg: number | null;
  brutoKg: number | null;
  nota: string | null;
  puede: boolean;
  /** Ya despachado o cerrado: cambiarlo no afectaría a nada de lo cargado. */
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
      const r = await guardarRestriccionPedido({
        pedido_id: pedidoId,
        peso_neto_max_kg: neto.trim() === '' ? null : Number(neto) * 1000,
        peso_bruto_max_kg: bruto.trim() === '' ? null : Number(bruto) * 1000,
        nota_restricciones: texto.trim() || null,
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
      <strong>Restricción de peso de {numero}</strong>
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
