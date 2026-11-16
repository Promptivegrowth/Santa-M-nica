'use client';

/**
 * ============================================================================
 *  FORMULARIO DEL RECLAMO · BPMN v4, parte 2
 * ============================================================================
 *  1. Datos del reclamo y del contacto.
 *  2. Verificar el correo con un código de 6 cifras.
 *  3. Evidencia: fotos, videos o PDF, subidos DIRECTO al almacenamiento (no
 *     pasan por el servidor de la aplicación). La base solo deja subir dentro
 *     de la carpeta del ticket que se entregó al verificar el correo, y hasta
 *     10 archivos. Las fotos grandes se comprimen en el celular antes de subir.
 *  4. Registrar → N.° de reclamo en estado Pendiente y comprobante.
 * ============================================================================
 */
import { useMemo, useState, useTransition } from 'react';
import { createClient } from '@supabase/supabase-js';
import { pedirCodigo, verificarCodigo, registrarReclamo } from '../acciones';
import { textos, fechaPortal, type Idioma } from '@/lib/portal/textos';

type Archivo = { nombre: string; tamano: number; estado: 'subiendo' | 'listo' | 'error' };

const TIPOS = /^(image\/|video\/|application\/pdf$)/;

/** Achica una foto a 2000 px y JPEG 0,82 si pesa más de 1,5 MB. Si el navegador no puede, va como está. */
async function comprimir(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 1.5 * 1024 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const escala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(bmp.width * escala);
    lienzo.height = Math.round(bmp.height * escala);
    lienzo.getContext('2d')!.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.82));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return f;
  }
}

function nombreSeguro(n: string) {
  return n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80) || 'archivo';
}

export function FormularioReclamo({
  idioma, numeroProforma, motivos, contenedores, maxMb, supabaseUrl, supabaseAnon,
}: {
  idioma: Idioma;
  numeroProforma: string;
  motivos: { id: number; nombre: string }[];
  contenedores: { id: number; referencia: string; contenedor: string | null }[];
  maxMb: number;
  supabaseUrl: string;
  supabaseAnon: string;
}) {
  const t = textos(idioma);
  // Cliente anónimo y sin sesión: aunque en el mismo navegador haya una sesión del ERP, sube como «anon»
  const almacen = useMemo(() => createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }), [supabaseUrl, supabaseAnon]);

  const [motivoId, setMotivoId] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [contenedorId, setContenedorId] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [verificacion, setVerificacion] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'critico' | 'atencion'; texto: string } | null>(null);
  const [avisoCodigo, setAvisoCodigo] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ numero: string; fecha: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [subiendo, setSubiendo] = useState(false);

  const fallo = (texto: string) => setAviso({ tono: 'critico', texto });

  function enviarCodigo() {
    setAviso(null);
    if (nombre.trim().length < 3 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim())) { fallo(t.faltaContacto); return; }
    iniciar(async () => {
      try {
        const r = await pedirCodigo(nombre.trim(), correo.trim());
        if (!r.ok) { fallo(r.mensaje); return; }
        setVerificacion(r.verificacionId ?? null);
        setTicket(null);
        setAvisoCodigo(r.codigoPrueba ? t.codigoPrueba(r.codigoPrueba) : null);
        setAviso({ tono: 'ok', texto: r.mensaje });
      } catch { fallo(t.errorGeneral); }
    });
  }

  function verificar() {
    if (!verificacion) return;
    setAviso(null);
    iniciar(async () => {
      try {
        const r = await verificarCodigo(verificacion, codigo);
        if (!r.ok) { fallo(r.mensaje); return; }
        setTicket(r.ticket ?? null);
        setAvisoCodigo(null);
        setAviso({ tono: 'ok', texto: r.mensaje });
      } catch { fallo(t.errorGeneral); }
    });
  }

  async function agregar(lista: FileList | null) {
    if (!lista || !ticket) return;
    setAviso(null);
    const nuevos = [...lista];
    if (archivos.filter((a) => a.estado !== 'error').length + nuevos.length > 10) { fallo(t.demasiados); return; }
    setSubiendo(true);
    for (const original of nuevos) {
      if (!TIPOS.test(original.type)) { fallo(t.archivoTipo(original.name)); continue; }
      const f = await comprimir(original);
      if (f.size > maxMb * 1024 * 1024) { fallo(t.archivoGrande(original.name, maxMb)); continue; }
      const indice = Date.now();
      const ruta = `evidencias/${ticket}/${indice}-${nombreSeguro(f.name)}`;
      setArchivos((a) => [...a, { nombre: f.name, tamano: f.size, estado: 'subiendo' }]);
      const { error } = await almacen.storage.from('reclamos').upload(ruta, f, { contentType: f.type, upsert: false });
      setArchivos((a) => a.map((x) => (x.nombre === f.name && x.estado === 'subiendo' ? { ...x, estado: error ? 'error' : 'listo' } : x)));
      if (error) fallo(t.errorSubida(original.name));
    }
    setSubiendo(false);
  }

  function registrar(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    if (!motivoId) { fallo(t.faltaMotivo); return; }
    if (descripcion.trim().length < 10) { fallo(t.faltaDescripcion); return; }
    if (!verificacion || !ticket) { fallo(t.faltaContacto); return; }
    if (!archivos.some((a) => a.estado === 'listo')) { fallo(t.faltaEvidencia); return; }
    iniciar(async () => {
      try {
        const r = await registrarReclamo({
          verificacionId: verificacion, motivoId: Number(motivoId), descripcion,
          packingListId: contenedorId ? Number(contenedorId) : null, observaciones,
        });
        if (!r.ok) { fallo(r.mensaje); return; }
        setHecho({ numero: r.numero!, fecha: r.fecha! });
        window.scrollTo({ top: 0 });
      } catch { fallo(t.errorGeneral); }
    });
  }

  if (hecho) {
    return (
      <section className="pt-tarjeta pt-comprobante" data-comprobante={hecho.numero}>
        <span className="pt-antetitulo">{t.reclamoRegistrado}</span>
        <p className="pt-numero">{hecho.numero}</p>
        <dl className="pt-ficha" style={{ justifyContent: 'center', margin: '0 auto 1rem', width: 'fit-content' }}>
          <dt>{t.proforma}</dt><dd>{numeroProforma}</dd>
          <dt>{t.motivo}</dt><dd>{motivos.find((m) => String(m.id) === motivoId)?.nombre}</dd>
          <dt>{t.estadoActual}</dt><dd>{t.estados.pendiente}</dd>
          <dt>{t.fecha}</dt><dd>{fechaPortal(hecho.fecha, idioma)}</dd>
          <dt>{t.correoContacto}</dt><dd>{correo}</dd>
        </dl>
        <p className="pt-ayuda">{t.comprobante}</p>
        <div className="pt-no-imprimir" style={{ display: 'flex', gap: '.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="pt-btn pt-btn-secundario" onClick={() => window.print()}>{t.imprimir}</button>
          <a className="pt-btn pt-btn-primario" href="/portal/consulta">{t.volverProforma}</a>
        </div>
      </section>
    );
  }

  const ocupado = pendiente || subiendo;

  return (
    <form className="pt-tarjeta" onSubmit={registrar} data-formulario="reclamo-portal">
      <h1>{t.reclamoTitulo}</h1>
      <p className="pt-ayuda">{t.reclamoAyuda}</p>
      {aviso && <p className={`pt-aviso pt-aviso-${aviso.tono}`} role={aviso.tono === 'critico' ? 'alert' : 'status'}>{aviso.texto}</p>}

      <div className="pt-campo">
        <label>{t.numeroProforma}</label>
        <input value={numeroProforma} readOnly className="pt-mono" />
      </div>
      <div className="pt-campo">
        <label htmlFor="motivo">{t.motivo} *</label>
        <select id="motivo" value={motivoId} onChange={(e) => setMotivoId(e.target.value)} required>
          <option value="">{t.elegir}</option>
          {motivos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </div>
      <div className="pt-campo">
        <label htmlFor="descripcion">{t.descripcion} *</label>
        <textarea id="descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={4000} required />
      </div>
      {contenedores.length > 0 && (
        <div className="pt-campo">
          <label htmlFor="contenedor">{t.contenedorOpcional}</label>
          <select id="contenedor" value={contenedorId} onChange={(e) => setContenedorId(e.target.value)}>
            <option value="">{t.todaProforma}</option>
            {contenedores.map((c) => (
              <option key={c.id} value={c.id}>{c.referencia}{c.contenedor ? ` · ${c.contenedor}` : ''}</option>
            ))}
          </select>
        </div>
      )}
      <div className="pt-campo">
        <label htmlFor="observaciones">{t.observaciones}</label>
        <textarea id="observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} maxLength={2000}
                  style={{ minHeight: '3.5rem' }} />
      </div>

      <div className="pt-paso">
        <div className="pt-campo">
          <label htmlFor="nombre">{t.nombreContacto} *</label>
          <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120}
                 disabled={!!ticket} autoComplete="name" />
        </div>
        <div className="pt-campo">
          <label htmlFor="correo">{t.correoContacto} *</label>
          <input id="correo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} maxLength={200}
                 disabled={!!ticket} autoComplete="email" />
        </div>
        {!ticket && (
          <button type="button" className="pt-btn pt-btn-secundario" onClick={enviarCodigo} disabled={ocupado}>
            {pendiente && !verificacion ? t.enviandoCodigo : t.enviarCodigo}
          </button>
        )}
        {avisoCodigo && <p className="pt-aviso pt-aviso-atencion" style={{ marginTop: '.8rem' }} data-aviso="codigo-prueba">{avisoCodigo}</p>}
        {verificacion && !ticket && (
          <div className="pt-campo" style={{ marginTop: '.9rem' }}>
            <label htmlFor="codigo">{t.codigo}</label>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <input id="codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} inputMode="numeric"
                     maxLength={7} className="pt-mono" style={{ maxWidth: '9rem' }} autoComplete="one-time-code" />
              <button type="button" className="pt-btn pt-btn-primario" onClick={verificar} disabled={ocupado || codigo.trim().length < 6}>
                {t.verificar}
              </button>
            </div>
          </div>
        )}
        {ticket && <p className="pt-aviso pt-aviso-ok" style={{ marginTop: '.6rem' }}>✓ {t.correoVerificado} {correo}</p>}
      </div>

      <div className="pt-paso">
        <div className="pt-campo">
          <label htmlFor="evidencia">{t.evidencia} *</label>
          <small className="pt-dato">{t.evidenciaAyuda(maxMb)}</small>
          <input id="evidencia" type="file" multiple accept="image/*,video/*,application/pdf"
                 disabled={!ticket || ocupado} onChange={(e) => { agregar(e.target.files); e.target.value = ''; }} />
        </div>
        {archivos.length > 0 && (
          <ul className="pt-archivos">
            {archivos.map((a, i) => (
              <li key={i}>
                <span>{a.nombre} · {(a.tamano / 1024 / 1024).toFixed(1)} MB</span>
                <span>{a.estado === 'subiendo' ? t.subiendo : a.estado === 'listo' ? '✓' : '✗'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-paso">
        <button type="submit" className="pt-btn pt-btn-primario pt-btn-ancho" disabled={ocupado || !ticket}>
          {pendiente ? t.registrando : t.registrar}
        </button>
      </div>
    </form>
  );
}
