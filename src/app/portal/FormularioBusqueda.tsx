'use client';

/**
 * Los 3 datos + CAPTCHA. Todo se valida en el servidor: aquí solo se muestra
 * el mensaje que devuelve y, si hay bloqueo, la cuenta regresiva.
 * La Llave se escribe en un campo de contraseña y no se guarda en ningún lado.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { buscarProforma, pedirCaptcha, type Captcha } from './acciones';
import { textos, type Idioma } from '@/lib/portal/textos';

export function FormularioBusqueda({
  idioma, captchaInicial, bloqueadoHasta,
}: { idioma: Idioma; captchaInicial: Captcha | null; bloqueadoHasta: string | null }) {
  const t = textos(idioma);
  const router = useRouter();
  const [captcha, setCaptcha] = useState<Captcha | null>(captchaInicial);
  const [error, setError] = useState('');
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
          codigo: String(d.get('codigo') ?? ''), numero: String(d.get('numero') ?? ''),
          llave: String(d.get('llave') ?? ''), captchaId: captcha?.id ?? '', captcha: String(d.get('captcha') ?? ''),
        });
        if (r.ok) { router.push('/portal/consulta'); return; }
        if (r.sesion === false) { router.replace('/portal/acceso'); return; }
        setError(r.mensaje);
        if (r.captcha !== undefined) setCaptcha(r.captcha);
        if (r.bloqueadoHasta) { setHasta(new Date(r.bloqueadoHasta).getTime()); setAhora(Date.now()); }
        const campo = form.elements.namedItem('captcha') as HTMLInputElement | null;
        if (campo) campo.value = '';
      } catch {
        setError(t.errorGeneral);
      }
    });
  }

  return (
    <form onSubmit={enviar} data-formulario="busqueda-portal" autoComplete="off">
      {bloqueado
        ? <p className="pt-aviso pt-aviso-critico" role="alert">{t.bloqueado(segundos)}</p>
        : error && <p className="pt-aviso pt-aviso-critico" role="alert">{error}</p>}
      <div className="pt-campo">
        <label htmlFor="codigo">{t.codigoCliente}</label>
        <input id="codigo" name="codigo" className="pt-mono" required placeholder="CLI-0123" maxLength={40} />
      </div>
      <div className="pt-campo">
        <label htmlFor="numero">{t.numeroProforma}</label>
        <input id="numero" name="numero" className="pt-mono" required placeholder="SM26-0456" maxLength={60} />
      </div>
      <div className="pt-campo">
        <label htmlFor="llave">{t.llave}</label>
        <input id="llave" name="llave" type="password" className="pt-mono" required placeholder="••••-••••-••••"
               maxLength={40} autoComplete="off" spellCheck={false} />
      </div>
      <div className="pt-campo">
        <label htmlFor="captcha">{t.captcha}</label>
        <div className="pt-captcha">
          {captcha
            ? <img src={captcha.imagen} alt={t.captcha} width={180} height={56} />
            : <span className="pt-aviso pt-aviso-atencion">{t.sesionVencida}</span>}
          <button type="button" className="pt-btn-enlace" onClick={otraImagen} disabled={pendiente}>{t.otraImagen}</button>
        </div>
        <input id="captcha" name="captcha" inputMode="numeric" required maxLength={6} className="pt-mono"
               style={{ maxWidth: '10rem' }} />
      </div>
      <button type="submit" className="pt-btn pt-btn-primario pt-btn-ancho" disabled={pendiente || bloqueado || !captcha}>
        {pendiente ? t.consultando : t.consultar}
      </button>
    </form>
  );
}
