'use client';

/**
 * ============================================================================
 *  EMITIR UN DICTAMEN DE CALIDAD
 * ============================================================================
 *  Se monta igual en la pantalla de Calidad y en la ficha de un lote: es la
 *  misma decisión tomada desde dos sitios distintos.
 *
 *  LO QUE HACE QUE ESTE FORMULARIO SIRVA
 *  Que diga la consecuencia ANTES de guardar. «Observado» y «liberado» suenan
 *  parecido en una lista desplegable, y significan cosas opuestas: uno saca el
 *  producto del inventario vendible y el otro lo devuelve. El aviso de abajo
 *  lo dice con todas las letras, en el momento en que se elige.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import {
  registrarDictamen,
  type TipoDictamen, type EstadoDictamen,
} from '@/app/(erp)/almacenes/calidad/acciones';

const TIPOS: { valor: TipoDictamen; texto: string; ayuda: string }[] = [
  { valor: 'calidad', texto: 'Calidad', ayuda: 'Inspección organoléptica y de aspecto' },
  { valor: 'microbiologia', texto: 'Microbiología', ayuda: 'Análisis de laboratorio' },
  { valor: 'camara', texto: 'Cámara', ayuda: 'Condiciones de conservación' },
  { valor: 'producto_terminado', texto: 'Producto terminado', ayuda: 'Revisión final antes de despachar' },
];

const ESTADOS: { valor: EstadoDictamen; texto: string; bloquea: boolean; consecuencia: string }[] = [
  {
    valor: 'liberado', texto: 'Liberado', bloquea: false,
    consecuencia: 'El lote queda disponible: se puede reservar, trasladar y despachar.',
  },
  {
    valor: 'observado', texto: 'Observado', bloquea: true,
    consecuencia: 'El lote SALE del inventario vendible. No se podrá reservar ni despachar hasta liberarlo.',
  },
  {
    valor: 'inmovilizado', texto: 'Inmovilizado', bloquea: true,
    consecuencia: 'El lote queda retenido. No sale de cámara ni se puede trasladar a otra bodega.',
  },
  {
    valor: 'espera_resultados', texto: 'En espera de resultados', bloquea: true,
    consecuencia: 'Se mandó muestra al laboratorio. Mientras tanto el lote no está disponible.',
  },
];

export function FormularioDictamen({
  loteId,
  pallet,
  motivos,
  puede,
  compacto = false,
}: {
  loteId: number;
  pallet: string;
  /** condiciona_venta: el motivo no bloquea, solo limita a mercado nacional (061). */
  motivos: { id: number; nombre: string; condiciona_venta?: boolean }[];
  puede: boolean;
  /** En la ficha del lote se abre con un botón; en Calidad va siempre visible. */
  compacto?: boolean;
}) {
  const router = useRouter();
  const [guardando, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(!compacto);

  const [tipo, setTipo] = useState<TipoDictamen>('calidad');
  const [estado, setEstado] = useState<EstadoDictamen>('observado');
  const [motivoId, setMotivoId] = useState<number | null>(null);
  const [motivoTexto, setMotivoTexto] = useState('');
  const [sustento, setSustento] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'mal'; texto: string } | null>(null);

  const meta = ESTADOS.find((e) => e.valor === estado)!;

  /*
   * «Solo mercado nacional» NO saca al pallet del inventario: lo deja libre,
   * pero solo para pedidos nacionales (061). Con ese motivo el aviso de abajo
   * no puede decir «sale del inventario vendible», que era lo que decía: hay
   * que decir lo que de verdad pasa.
   */
  const motivoElegido = motivos.find((m) => m.id === motivoId);
  const soloNacional = meta.bloquea && motivoElegido?.condiciona_venta === true;
  const consecuencia = soloNacional
    ? 'El pallet SIGUE disponible, pero solo para pedidos de mercado nacional: no se podrá reservar ni ' +
      'cargar para exportación. Si está apartado para un pedido de exportación, libere antes esa reserva. ' +
      '(Si otro dictamen abierto lo bloquea, sigue bloqueado.)'
    : meta.consecuencia;
  const tituloConsecuencia = soloNacional ? `${meta.texto} · Solo mercado nacional` : meta.texto;

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setAviso(null);
    iniciar(async () => {
      //  Un corte de red vuelve como un aviso más y no borra lo escrito.
      const r = await accionSegura(() => registrarDictamen({
        lote_id: loteId,
        tipo,
        estado,
        //  Al liberar no se manda el motivo de bloqueo que haya quedado elegido
        //  de antes (el campo ni se ve).
        motivo_id: meta.bloquea ? motivoId : null,
        motivo_texto: meta.bloquea ? (motivoTexto || null) : null,
        sustento_url: sustento || null,
        observaciones: observaciones || null,
      }));
      setAviso({ tipo: r.ok ? 'ok' : 'mal', texto: r.mensaje });
      if (r.ok) {
        setMotivoTexto(''); setSustento(''); setObservaciones(''); setMotivoId(null);
        if (compacto) setAbierto(false);
        router.refresh();
      }
    });
  }

  if (!puede) return null;

  if (compacto && !abierto) {
    return (
      <>
        <button type="button" className="btn btn-secundario" onClick={() => setAbierto(true)}>
          <Icono nombre="calidad" tamano={15} />
          Emitir dictamen
        </button>
        {aviso && (
          <div className={`ficha-aviso ${aviso.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'} documento-mensaje`}
               role={aviso.tipo === 'ok' ? 'status' : 'alert'}>
            <Icono nombre="alerta" tamano={16} />
            <span>{aviso.texto}</span>
          </div>
        )}
      </>
    );
  }

  return (
    <form className="dictamen" onSubmit={enviar}>
      {compacto && (
        <div className="dictamen-cab">
          <strong>Dictamen para <span className="mono">{pallet}</span></strong>
          <button type="button" className="btn btn-sutil btn-chico" onClick={() => setAbierto(false)}>
            Cerrar
          </button>
        </div>
      )}

      {aviso && (
        <div className={`ficha-aviso ${aviso.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'}`}
             role={aviso.tipo === 'ok' ? 'status' : 'alert'}>
          <Icono nombre="alerta" tamano={16} />
          <span>{aviso.texto}</span>
        </div>
      )}

      <div className="form-rejilla">
        <label className="form-campo">
          <span>Tipo de dictamen</span>
          <select className="campo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDictamen)}>
            {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
          </select>
          <small>{TIPOS.find((t) => t.valor === tipo)?.ayuda}</small>
        </label>

        <label className="form-campo">
          <span>Resultado</span>
          <select className="campo" value={estado} onChange={(e) => setEstado(e.target.value as EstadoDictamen)}>
            {ESTADOS.map((e) => <option key={e.valor} value={e.valor}>{e.texto}</option>)}
          </select>
        </label>

        {meta.bloquea && (
          <>
            <label className="form-campo">
              <span>Motivo tipificado</span>
              <select className="campo" value={motivoId ?? ''}
                      onChange={(e) => setMotivoId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Elija uno…</option>
                {motivos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </label>

            <label className="form-campo">
              <span>O escríbalo</span>
              <input className="campo" value={motivoTexto}
                     onChange={(e) => setMotivoTexto(e.target.value)}
                     placeholder="Qué se encontró" maxLength={200} />
              <small>Hace falta el tipificado o este. Sin motivo nadie sabrá después si se puede liberar.</small>
            </label>

          </>
        )}

        {/* El sustento vale tanto para bloquear como para liberar: el informe
            que levanta una observación es tan importante como el que la puso. */}
        <label className="form-campo">
          <span>Sustento</span>
          <input className="campo" name="sustento" value={sustento} onChange={(e) => setSustento(e.target.value)}
                 placeholder={meta.bloquea ? 'Enlace al informe de laboratorio' : 'Enlace al informe que libera el pallet'}
                 maxLength={300} />
          <small>Opcional. Pegue el enlace al PDF del informe (por ejemplo, en la carpeta compartida).</small>
        </label>

        <label className="form-campo form-campo-ancho">
          <span>Observaciones</span>
          <input className="campo" value={observaciones}
                 onChange={(e) => setObservaciones(e.target.value)}
                 placeholder="Lo que convenga dejar dicho" maxLength={300} />
        </label>
      </div>

      {/* La consecuencia, en presente y antes de guardar. */}
      <div className={`form-consecuencia ${meta.bloquea && !soloNacional ? 'local' : 'export'}`} data-consecuencia={soloNacional ? 'nacional' : estado}>
        <Icono nombre="alerta" tamano={16} />
        <span><b>{tituloConsecuencia}:</b> {consecuencia}</span>
      </div>

      <div className="form-acciones">
        <button type="submit" className="btn btn-primario" disabled={guardando}>
          <Icono nombre="guardar" tamano={15} />
          {guardando ? 'Registrando…' : 'Registrar dictamen'}
        </button>
      </div>
    </form>
  );
}
