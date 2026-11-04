'use client';

/**
 * ============================================================================
 *  DOCUMENTOS Y COMENTARIOS DEL EMBARQUE («Observaciones ERP 4», 08 y 09)
 * ============================================================================
 *  Una tarjeta por clase de documento (etiqueta, packing declarado, packing
 *  real, otros). Arriba, la versión VIGENTE —la última que se subió— con
 *  «Ver» y «Descargar»; debajo, las anteriores, que no se pierden: el packing
 *  va y vuelve con el cliente y SANIPES, y hay que poder decir qué se mandó
 *  cuándo. Cada subida admite un comentario corto.
 *
 *  Al lado, la bitácora de comentarios del embarque: quién dijo qué y cuándo.
 * ============================================================================
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import {
  AYUDA_DOCUMENTO, FORMATOS_DOCUMENTO, NOMBRE_DOCUMENTO, ORDEN_DOCUMENTOS, type TipoDocumentoEmbarque,
} from '@/lib/documentosEmbarque';
import { quitarDocumentoEmbarque, comentarEmbarque } from '../documentos';
import { subirDocumentoEmbarque } from '../subirDocumento';
import '../../programacion.css';

export type DocumentoVisible = {
  id: number;
  tipo: TipoDocumentoEmbarque;
  nombre: string;
  url: string | null;
  descarga: string | null;
  tamano_bytes: number;
  subido_en: string;
  subido_por: string | null;
  comentario: string | null;
  /** Lo puede quitar este usuario (lo subió él, o es Gerencia u Operaciones). */
  quitable: boolean;
};

export type ComentarioVisible = { id: number; texto: string; autor: string; creado_en: string };

const tamano = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
/*
 * La hora de Lima escrita a mano, sin Intl: el servidor y el navegador
 * formatean distinto con toLocaleString y React avisaba de la diferencia al
 * hidratar. Lima no tiene horario de verano: siempre UTC−5.
 */
const dos = (n: number) => String(n).padStart(2, '0');
const cuando = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - 5 * 3600 * 1000);
  return `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`;
};

export function DocumentosEmbarque({
  embarqueId, documentos, puede, noPuede,
}: {
  embarqueId: number;
  documentos: DocumentoVisible[];
  /** Puede subir (rol y embarque no cancelado). */
  puede: boolean;
  /** Si no puede, por qué (se muestra en vez de los botones). */
  noPuede: string | null;
}) {
  return (
    <div className="docs-embarque" data-bloque="documentos-embarque">
      {noPuede && <p className="docs-nota">{noPuede}</p>}
      <div className="docs-rejilla">
        {ORDEN_DOCUMENTOS.map((tipo) => (
          <TarjetaDocumento key={tipo} embarqueId={embarqueId} tipo={tipo} puede={puede}
                            versiones={documentos.filter((d) => d.tipo === tipo)} />
        ))}
      </div>
    </div>
  );
}

function TarjetaDocumento({
  embarqueId, tipo, versiones, puede,
}: {
  embarqueId: number;
  tipo: TipoDocumentoEmbarque;
  versiones: DocumentoVisible[];
  puede: boolean;
}) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [comentario, setComentario] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [quitando, iniciarQuitar] = useTransition();
  const [verAnteriores, setVerAnteriores] = useState(false);

  //  La más reciente primero: esa es la vigente.
  const [vigente, ...anteriores] = [...versiones].sort((a, b) => b.subido_en.localeCompare(a.subido_en));

  async function subir(lista: FileList | null) {
    const f = lista?.[0];
    if (!f) return;
    setAviso(null);
    setSubiendo(true);
    const r = await subirDocumentoEmbarque(embarqueId, tipo, f, comentario);
    setSubiendo(false);
    if (entrada.current) entrada.current.value = '';
    setAviso({ ok: r.ok, texto: r.mensaje });
    if (r.ok) { setComentario(''); router.refresh(); }
  }

  function quitar(id: number) {
    iniciarQuitar(async () => {
      const r = await accionSegura(() => quitarDocumentoEmbarque(id));
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) router.refresh();
    });
  }

  return (
    <section className="docs-tarjeta" data-documento={tipo} data-versiones={versiones.length}>
      <header>
        <strong>{NOMBRE_DOCUMENTO[tipo]}</strong>
        <small>{AYUDA_DOCUMENTO[tipo]}</small>
      </header>

      {vigente ? (
        <Fila d={vigente} etiqueta={anteriores.length ? `Vigente · versión ${versiones.length}` : 'Vigente'}
              quitando={quitando} onQuitar={quitar} />
      ) : (
        <p className="docs-vacio">Todavía no se subió.</p>
      )}

      {anteriores.length > 0 && (
        <>
          <button type="button" className="enlace-boton docs-anteriores-boton" onClick={() => setVerAnteriores(!verAnteriores)}>
            {verAnteriores ? 'Ocultar' : 'Ver'} {anteriores.length} versi{anteriores.length === 1 ? 'ón anterior' : 'ones anteriores'}
          </button>
          {verAnteriores && (
            <ul className="docs-anteriores">
              {anteriores.map((d, i) => (
                <li key={d.id}>
                  <Fila d={d} etiqueta={`Versión ${anteriores.length - i}`} quitando={quitando} onQuitar={quitar} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {puede && (
        <div className="docs-subir">
          <input className="campo" name={`comentario-${tipo}`} maxLength={500} value={comentario}
                 onChange={(e) => setComentario(e.target.value)}
                 placeholder={vigente ? 'Qué cambia en esta versión (opcional)' : 'Comentario (opcional)'} />
          {/* El selector del navegador vestido de botón: el nativo dice «Ningún archivo seleccionado». */}
          <label className="btn btn-secundario btn-chico" data-subiendo={subiendo ? 'si' : 'no'}>
            <Icono nombre="mas" tamano={14} />
            {subiendo ? 'Subiendo…' : vigente ? 'Subir nueva versión' : 'Subir'}
            <input ref={entrada} type="file" name={`archivo-${tipo}`} className="sr-solo"
                   accept={FORMATOS_DOCUMENTO[tipo].accept} disabled={subiendo}
                   onChange={(e) => void subir(e.target.files)} />
          </label>
          <small>{FORMATOS_DOCUMENTO[tipo].texto.replace('tiene que ser ', '')}, hasta 15 MB.</small>
        </div>
      )}
      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'form-mensaje ok' : 'form-mensaje error'} data-aviso={`documento-${tipo}`}>
          {aviso.texto}
        </p>
      )}
    </section>
  );
}

function Fila({ d, etiqueta, quitando, onQuitar }: {
  d: DocumentoVisible; etiqueta: string; quitando: boolean; onQuitar: (id: number) => void;
}) {
  return (
    <div className="docs-fila" data-archivo={d.id}>
      <span className="docs-nombre">
        <strong title={d.nombre}><Icono nombre="reportes" tamano={14} /> {d.nombre}</strong>
        <small>
          {etiqueta} · {tamano(d.tamano_bytes)} · {cuando(d.subido_en)}{d.subido_por ? ` · ${d.subido_por}` : ''}
        </small>
        {d.comentario && <em>«{d.comentario}»</em>}
      </span>
      <span className="docs-botones">
        {d.url && <a className="btn btn-sutil btn-chico" href={d.url} target="_blank" rel="noreferrer" data-ver={d.id}>Ver</a>}
        {d.descarga && <a className="btn btn-secundario btn-chico" href={d.descarga} data-descargar={d.id}>Descargar</a>}
        {d.quitable && (
          <button type="button" className="btn btn-sutil btn-chico" disabled={quitando} onClick={() => onQuitar(d.id)}>Quitar</button>
        )}
      </span>
    </div>
  );
}

/* ==========================================================================
   LA BITÁCORA DE COMENTARIOS
   ========================================================================== */
export function ComentariosEmbarque({
  embarqueId, comentarios, puede,
}: {
  embarqueId: number;
  comentarios: ComentarioVisible[];
  puede: boolean;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, iniciar] = useTransition();

  function enviar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => comentarEmbarque(embarqueId, texto));
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setTexto(''); router.refresh(); }
    });
  }

  return (
    <div className="docs-comentarios" data-bloque="comentarios-embarque">
      {comentarios.length === 0 ? (
        <p className="docs-vacio">Todavía no hay comentarios.</p>
      ) : (
        <ol className="docs-hilo">
          {comentarios.map((c) => (
            <li key={c.id} data-comentario={c.id}>
              <small><strong>{c.autor}</strong> · {cuando(c.creado_en)}</small>
              <p>{c.texto}</p>
            </li>
          ))}
        </ol>
      )}
      {puede && (
        <div className="docs-nuevo-comentario">
          <textarea className="campo" name="comentario_embarque" rows={2} maxLength={1000} value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder="Por ejemplo: el cliente aprobó la etiqueta; SANIPES pidió corregir el peso declarado…" />
          <div className="acciones-fila">
            <button type="button" className="btn btn-primario btn-chico" data-accion="comentar"
                    disabled={guardando || !texto.trim()} title={!texto.trim() ? 'Escriba el comentario primero' : undefined}
                    onClick={enviar}>
              {guardando ? 'Guardando…' : 'Agregar comentario'}
            </button>
            <small>Queda con su nombre y la hora; no se edita ni se borra.</small>
          </div>
        </div>
      )}
      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'form-mensaje ok' : 'form-mensaje error'} data-aviso="comentario">
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
