'use client';

/**
 * Subir y ver los archivos de un despacho: la guía de remisión final en PDF
 * (punto 15) y las fotos de la carga (punto 17). El archivo va directo del
 * navegador al repositorio privado; el servidor solo lo registra.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { crearClienteNavegador } from '@/lib/supabase/navegador';
import { Icono } from '@/components/estructura/Icono';
import { registrarArchivoDespacho, borrarArchivoDespacho } from '../archivos';

export type ArchivoVisible = {
  id: number;
  nombre: string;
  url: string | null;
  descarga: string | null;
  tamano_bytes: number;
  subido_en: string;
  subido_por: string | null;
  descripcion: string | null;
};

const tamano = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
/** Un nombre de archivo que sirve como ruta: sin tildes, sin espacios raros. */
const limpio = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);

export function ArchivosDespacho({
  despachoId, tipo, archivos, puede,
}: {
  despachoId: number;
  tipo: 'guia' | 'foto';
  archivos: ArchivoVisible[];
  puede: boolean;
}) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [quitando, iniciarQuitar] = useTransition();
  const esGuia = tipo === 'guia';

  async function subir(lista: FileList | null) {
    if (!lista?.length) return;
    setAviso(null);
    const supabase = crearClienteNavegador();
    let bien = 0;
    const malos: string[] = [];
    for (const [i, f] of [...lista].entries()) {
      setSubiendo(`Subiendo ${i + 1} de ${lista.length}: ${f.name}…`);
      const permitidos = esGuia ? ['application/pdf'] : ['image/jpeg', 'image/png'];
      if (!permitidos.includes(f.type)) { malos.push(`${f.name}: ${esGuia ? 'tiene que ser PDF' : 'tiene que ser JPG o PNG'}`); continue; }
      if (f.size > 15 * 1024 * 1024) { malos.push(`${f.name}: pasa de 15 MB`); continue; }
      const ruta = `despacho-${despachoId}/${tipo}/${Date.now()}-${limpio(f.name)}`;
      const { error } = await supabase.storage.from('despachos').upload(ruta, f, { contentType: f.type, upsert: false });
      if (error) { malos.push(`${f.name}: ${error.message}`); continue; }
      const r = await registrarArchivoDespacho({
        despacho_id: despachoId, tipo, ruta, nombre: f.name, tipo_mime: f.type, tamano_bytes: f.size,
      });
      if (r.ok) bien += 1; else malos.push(`${f.name}: ${r.mensaje}`);
    }
    setSubiendo(null);
    if (entrada.current) entrada.current.value = '';
    setAviso({
      ok: malos.length === 0,
      texto: [bien ? `${bien} archivo${bien === 1 ? '' : 's'} guardado${bien === 1 ? '' : 's'}.` : '', ...malos].filter(Boolean).join(' · '),
    });
    router.refresh();
  }

  return (
    <div className="archivos-despacho" data-archivos={tipo}>
      {puede && (
        <div className="archivos-subir">
          {/* El selector del navegador, vestido de botón: el nativo dice «Ningún
              archivo seleccionado» en el idioma del navegador y no se entiende. */}
          <label className="btn btn-secundario btn-chico" data-subiendo={subiendo ? 'si' : 'no'}>
            <Icono nombre="mas" tamano={14} />
            {esGuia ? 'Adjuntar la guía (PDF)' : 'Agregar fotos'}
            <input ref={entrada} type="file" name={`archivo-${tipo}`} className="sr-solo"
                   accept={esGuia ? 'application/pdf' : 'image/jpeg,image/png'}
                   multiple={!esGuia}
                   disabled={!!subiendo}
                   onChange={(e) => void subir(e.target.files)} />
          </label>
          <small>{esGuia ? 'PDF, hasta 15 MB.' : 'JPG o PNG, varias a la vez, hasta 15 MB cada una.'}</small>
        </div>
      )}
      {subiendo && <p role="status" className="archivos-estado">{subiendo}</p>}
      {aviso && <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'form-mensaje ok' : 'form-mensaje error'}>{aviso.texto}</p>}

      {archivos.length === 0 ? (
        <p className="archivos-vacio">{esGuia ? 'Todavía no se adjuntó la guía final.' : 'Todavía no hay fotos de la carga.'}</p>
      ) : esGuia ? (
        <ul className="archivos-lista">
          {archivos.map((a) => (
            <li key={a.id} data-archivo={a.id}>
              <Icono nombre="reportes" tamano={16} />
              <span className="archivos-nombre">
                <strong>{a.nombre}</strong>
                <small>{tamano(a.tamano_bytes)} · {new Date(a.subido_en).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false })}{a.subido_por ? ` · ${a.subido_por}` : ''}</small>
              </span>
              {a.url && <a className="btn btn-sutil btn-chico" href={a.url} target="_blank" rel="noreferrer" data-ver="guia">Ver</a>}
              {a.descarga && <a className="btn btn-secundario btn-chico" href={a.descarga} data-descargar="guia">Descargar</a>}
              {puede && (
                <button type="button" className="btn btn-sutil btn-chico" disabled={quitando}
                        onClick={() => iniciarQuitar(async () => { const r = await borrarArchivoDespacho(a.id); setAviso({ ok: r.ok, texto: r.mensaje }); router.refresh(); })}>
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="archivos-fotos">
          {archivos.map((a) => (
            <li key={a.id} data-archivo={a.id}>
              {a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer" title={a.nombre}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={`Foto de la carga: ${a.nombre}`} loading="lazy" />
                </a>
              ) : <span className="archivos-sin-vista">{a.nombre}</span>}
              <span className="archivos-pie">
                <small>{a.nombre}</small>
                {puede && (
                  <button type="button" className="enlace-boton" disabled={quitando}
                          onClick={() => iniciarQuitar(async () => { const r = await borrarArchivoDespacho(a.id); setAviso({ ok: r.ok, texto: r.mensaje }); router.refresh(); })}>
                    Quitar
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
