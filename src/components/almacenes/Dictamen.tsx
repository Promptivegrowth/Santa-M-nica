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
  motivos: { id: number; nombre: string }[];
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

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setAviso(null);
    iniciar(async () => {
      const r = await registrarDictamen({
        lote_id: loteId,
        tipo,
        estado,
        motivo_id: motivoId,
        motivo_texto: motivoTexto || null,
        sustento_url: sustento || null,
        observaciones: observaciones || null,
      });
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

            <label className="form-campo">
              <span>Sustento</span>
              <input className="campo" value={sustento} onChange={(e) => setSustento(e.target.value)}
                     placeholder="Enlace al informe de laboratorio" maxLength={300} />
            </label>
          </>
        )}

        <label className="form-campo form-campo-ancho">
          <span>Observaciones</span>
          <input className="campo" value={observaciones}
                 onChange={(e) => setObservaciones(e.target.value)}
                 placeholder="Lo que convenga dejar dicho" maxLength={300} />
        </label>
      </div>

      {/* La consecuencia, en presente y antes de guardar. */}
      <div className={`form-consecuencia ${meta.bloquea ? 'local' : 'export'}`}>
        <Icono nombre="alerta" tamano={16} />
        <span><b>{meta.texto}:</b> {meta.consecuencia}</span>
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
