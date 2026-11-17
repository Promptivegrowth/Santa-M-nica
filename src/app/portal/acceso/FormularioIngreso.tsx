'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { iniciarSesion } from '../acciones';
import { textos, type Idioma } from '@/lib/portal/textos';
import { Icono } from '@/components/estructura/Icono';

export function FormularioIngreso({ idioma }: { idioma: Idioma }) {
  const t = textos(idioma);
  const router = useRouter();
  const [error, setError] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [pendiente, iniciar] = useTransition();

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    setError('');
    iniciar(async () => {
      try {
        const r = await iniciarSesion(String(datos.get('email') ?? ''), String(datos.get('clave') ?? ''));
        if (r.ok) { router.replace('/portal'); router.refresh(); }
        else setError(r.mensaje);
      } catch {
        setError(t.errorGeneral);
      }
    });
  }

  return (
    <form onSubmit={enviar} data-formulario="acceso-portal">
      {error && <p className="pt-aviso pt-aviso-critico" role="alert">{error}</p>}
      <div className="pt-campo">
        <label htmlFor="email">{t.correoAcceso}</label>
        <input id="email" name="email" type="email" autoComplete="username" inputMode="email"
               placeholder="nombre@empresa.com" required />
      </div>
      <div className="pt-campo">
        <label htmlFor="clave">{t.contrasena}</label>
        <div className="pt-clave">
          <input id="clave" name="clave" type={verClave ? 'text' : 'password'} autoComplete="current-password"
                 autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          <button type="button" className="pt-clave-ojo" onClick={() => setVerClave((v) => !v)}
                  aria-label={verClave ? t.ocultarClave : t.mostrarClave} title={verClave ? t.ocultarClave : t.mostrarClave}
                  aria-pressed={verClave} aria-controls="clave" data-accion="ver-clave">
            <Icono nombre={verClave ? 'ocultar' : 'ver'} tamano={19} />
          </button>
        </div>
      </div>
      <button type="submit" className="pt-btn pt-btn-primario pt-btn-ancho pt-btn-grande" disabled={pendiente}>
        {pendiente ? t.ingresando : t.ingresar}
      </button>
    </form>
  );
}
