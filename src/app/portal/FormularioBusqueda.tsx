'use client';

/**
 * Los 3 datos + CAPTCHA. Todo se valida en el servidor: aquí solo se muestra
 * el mensaje que devuelve y, si hay bloqueo, la cuenta regresiva.
 *
 * La Llave NO va en un campo de contraseña: el gestor de contraseñas del
 * navegador tomaba el par «N.° de proforma + Llave» por un login y rellenaba
 * ahí el correo y la clave de la cuenta de seguimiento. Es un campo de texto
 * que se ve con puntos (y un ojo para verla), sin autocompletar, y se escribe
 * sola con el formato XXXX-XXXX-XXXX (la base ignora guiones y mayúsculas).
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { buscarProforma, pedirCaptcha, type Captcha } from './acciones';
import { textos, type Idioma } from '@/lib/portal/textos';
import { Icono } from '@/components/estructura/Icono';

/** Que ningún gestor de contraseñas ni autocompletado toque estos campos. */
const SIN_AUTOCOMPLETAR = {
  autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'characters', spellCheck: false,
  'data-1p-ignore': true, 'data-lpignore': 'true', 'data-form-type': 'other',
} as const;

/** «k7m29qxp4twd» → «K7M2-9QXP-4TWD» mientras se escribe. */
function formatoLlave(v: string): string {
  const limpio = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return limpio.match(/.{1,4}/g)?.join('-') ?? '';
}

export function FormularioBusqueda({
  idioma, captchaInicial, bloqueadoHasta,
}: { idioma: Idioma; captchaInicial: Captcha | null; bloqueadoHasta: string | null }) {
  const t = textos(idioma);
  const router = useRouter();
  const [captcha, setCaptcha] = useState<Captcha | null>(captchaInicial);
  const [error, setError] = useState('');
  const [llave, setLlave] = useState('');
  const [verLlave, setVerLlave] = useState(false);
  const [hasta, setHasta] = useState<number | null>(bloqueadoHasta ? new Date(bloqueadoHasta).getTime() : null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [pendiente, iniciar] = useTransition();

  useEffect(() => {
    if (!hasta) return;
    const id = setInterval(() => {
      const n = Date.now();
      setAhora(n);
      if (n >= hasta) { setHasta(null); setError(''); }
    }, 500);
    return () => clearInterval(id);
  }, [hasta]);

  const segundos = hasta ? Math.max(0, Math.ceil((hasta - ahora) / 1000)) : 0;
  const bloqueado = segundos > 0;

  function otraImagen() {
    iniciar(async () => { setCaptcha(await pedirCaptcha()); });
  }

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    setError('');
    iniciar(async () => {
      try {
        const r = await buscarProforma({
          codigo: String(d.get('sm-codigo-cliente') ?? ''), numero: String(d.get('sm-numero-proforma') ?? ''),
          llave, captchaId: captcha?.id ?? '', captcha: String(d.get('sm-captcha') ?? ''),
        });
        if (r.ok) { router.push('/portal/consulta'); return; }
        if (r.sesion === false) { router.replace('/portal/acceso'); return; }
        setError(r.mensaje);
        if (r.captcha !== undefined) setCaptcha(r.captcha);
        if (r.bloqueadoHasta) { setHasta(new Date(r.bloqueadoHasta).getTime()); setAhora(Date.now()); }
        const campo = form.elements.namedItem('sm-captcha') as HTMLInputElement | null;
        if (campo) campo.value = '';
      } catch {
        setError(t.errorGeneral);
      }
    });
  }

  return (
    <form onSubmit={enviar} data-formulario="busqueda-portal" autoComplete="off" className="pt-busqueda">
      {bloqueado
        ? <p className="pt-aviso pt-aviso-critico" role="alert">{t.bloqueado(segundos)}</p>
        : error && <p className="pt-aviso pt-aviso-critico" role="alert">{error}</p>}
      <div className="pt-busqueda-fila">
        <div className="pt-campo">
          <label htmlFor="codigo">{t.codigoCliente}</label>
          <input id="codigo" name="sm-codigo-cliente" className="pt-mono" required placeholder="CLI-0123" maxLength={40}
                 {...SIN_AUTOCOMPLETAR} />
        </div>
        <div className="pt-campo">
          <label htmlFor="numero">{t.numeroProforma}</label>
          <input id="numero" name="sm-numero-proforma" className="pt-mono" required placeholder="SM26-0456" maxLength={60}
                 {...SIN_AUTOCOMPLETAR} />
        </div>
      </div>
      <div className="pt-campo">
        <label htmlFor="llave">{t.llave}</label>
        <div className="pt-clave">
          <input id="llave" name="sm-llave-seguimiento" className={`pt-mono${verLlave ? '' : ' pt-oculto'}`} required
                 placeholder="XXXX-XXXX-XXXX" maxLength={14} value={llave}
                 onChange={(e) => setLlave(formatoLlave(e.target.value))} {...SIN_AUTOCOMPLETAR} />
          <button type="button" className="pt-clave-ojo" onClick={() => setVerLlave((v) => !v)}
                  aria-label={verLlave ? t.ocultarClave : t.mostrarClave} title={verLlave ? t.ocultarClave : t.mostrarClave}
                  aria-pressed={verLlave} aria-controls="llave" data-accion="ver-llave">
            <Icono nombre={verLlave ? 'ocultar' : 'ver'} tamano={18} />
          </button>
        </div>
      </div>
      <div className="pt-campo">
        <label htmlFor="captcha">{t.captcha}</label>
        <div className="pt-captcha">
          {captcha
            // eslint-disable-next-line @next/next/no-img-element -- imagen en data: generada por el servidor
            ? <img src={captcha.imagen} alt={t.captcha} width={150} height={46} />
            : <span className="pt-aviso pt-aviso-atencion">{t.sesionVencida}</span>}
          <button type="button" className="pt-captcha-otra" onClick={otraImagen} disabled={pendiente}
                  title={t.otraImagen} aria-label={t.otraImagen}>
            <Icono nombre="recargar" tamano={16} />
          </button>
          <input id="captcha" name="sm-captcha" inputMode="numeric" required maxLength={6} className="pt-mono"
                 placeholder="00000" {...SIN_AUTOCOMPLETAR} />
        </div>
      </div>
      <button type="submit" className="pt-btn pt-btn-primario pt-btn-ancho pt-btn-grande" disabled={pendiente || bloqueado || !captcha}>
        <Icono nombre="buscar" tamano={16} />
        {pendiente ? t.consultando : t.consultar}
      </button>
    </form>
  );
}
