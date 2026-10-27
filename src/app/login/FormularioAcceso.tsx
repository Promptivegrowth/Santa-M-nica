'use client';

/**
 * ============================================================================
 *  FORMULARIO DE ACCESO
 * ============================================================================
 *  Cada persona entra con su correo corporativo y su contraseña.
 *
 *  Durante la construcción hubo aquí un panel de «Acceso rápido por rol» que
 *  entraba con un clic como cualquiera de los perfiles de prueba, Gerencia
 *  incluida, con la contraseña común escrita en este mismo archivo. Se retiró
 *  al dar de alta las cuentas reales: con datos reales, esa puerta dejaba
 *  entrar a cualquiera que abriera la página.
 * ============================================================================
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { crearClienteNavegador } from '@/lib/supabase/navegador';
import { Logotipo } from '@/components/marca/Logo';

export function FormularioAcceso() {
  const router = useRouter();
  const parametros = useSearchParams();
  const destino = parametros.get('destino') || '/panel';

  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  /*
   * El sistema trae aquí a una cuenta desactivada que todavía tenía la sesión
   * abierta (?motivo=cuenta-inactiva). Se cierra esa sesión y se dice por qué,
   * en vez de dejar a la persona mirando un login que no entiende.
   */
  const inactiva = parametros.get('motivo') === 'cuenta-inactiva';
  useEffect(() => {
    if (inactiva) crearClienteNavegador().auth.signOut().catch(() => undefined);
  }, [inactiva]);

  /** Realiza el ingreso contra Supabase y navega al panel. */
  async function ingresar(email: string, password: string) {
    setError(null);
    setEntrando(email);

    const supabase = crearClienteNavegador();
    const { error: fallo } = await supabase.auth.signInWithPassword({ email, password });

    if (fallo) {
      // Mensaje entendible: decimos qué pasó y qué hacer.
      setError(
        fallo.message.includes('Invalid login')
          ? 'El correo o la contraseña no coinciden. Verifique e intente de nuevo.'
          : fallo.code === 'user_banned' || /banned/i.test(fallo.message)
            ? 'Su cuenta está desactivada y no puede entrar. Si cree que es un error, consúltelo con Gerencia.'
            : `No se pudo iniciar sesión: ${fallo.message}`
      );
      setEntrando(null);
      return;
    }

    iniciarTransicion(() => {
      router.replace(destino);
      router.refresh();
    });
  }

  const ocupado = entrando !== null || pendiente;

  return (
    <div className="acceso">
      {/* ---------- Panel de marca ---------- */}
      <aside className="acceso-marca">
        <div className="acceso-marca-cabecera">
          <Logotipo alto={40} className="logo-invertido" prioritario />
        </div>

        <div className="acceso-marca-cuerpo">
          <h1>
            Ventas, Almacenes
            <br />y Despachos
          </h1>
          <p>
            El stock que ves es el stock que puedes vender. Reservas con vencimiento,
            traslados con doble firma y trazabilidad completa desde la factura hasta
            el día de producción.
          </p>

          <dl className="acceso-cifras">
            <div><dt>Almacenes</dt><dd>10</dd></div>
            <div><dt>Productos</dt><dd>191</dd></div>
            <div><dt>Trazabilidad</dt><dd>Total</dd></div>
          </dl>
        </div>

        <footer className="acceso-marca-pie">
          Industrial Pesquera Santa Mónica · RUC 20205572229
        </footer>
      </aside>

      {/* ---------- Formulario ---------- */}
      <main className="acceso-panel">
        <div className="acceso-contenido">
          <header className="acceso-titulo">
            <h2>Iniciar sesión</h2>
            <p>Ingrese con su cuenta corporativa.</p>
          </header>

          <form
            className="acceso-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!correo || !clave) {
                setError('Complete el correo y la contraseña para continuar.');
                return;
              }
              ingresar(correo, clave);
            }}
          >
            <div>
              <label className="etiqueta" htmlFor="correo">Correo</label>
              <input
                id="correo" type="email" className="campo" autoComplete="username"
                value={correo} onChange={(e) => setCorreo(e.target.value)}
                placeholder="nombre@santamonicafishing.com" disabled={ocupado}
              />
            </div>

            <div>
              <label className="etiqueta" htmlFor="clave">Contraseña</label>
              <input
                id="clave" type="password" className="campo" autoComplete="current-password"
                value={clave} onChange={(e) => setClave(e.target.value)}
                placeholder="••••••••" disabled={ocupado}
              />
            </div>

            {inactiva && !error && (
              <div className="acceso-error" role="alert">
                Su cuenta está desactivada y no puede entrar. Si cree que es un error, consúltelo con Gerencia.
              </div>
            )}
            {error && (
              <div className="acceso-error" role="alert">{error}</div>
            )}

            <button type="submit" className="btn btn-primario w-full" disabled={ocupado}>
              {ocupado ? 'Verificando…' : 'Entrar'}
            </button>
          </form>

        </div>
      </main>

      <style jsx>{`
        .acceso {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          min-height: 100dvh;
        }
        @media (min-width: 960px) {
          .acceso { grid-template-columns: 42% minmax(0, 1fr); }
        }

        /* --- lado de marca --- */
        .acceso-marca {
          display: none;
          flex-direction: column;
          justify-content: space-between;
          padding: 2.5rem;
          background: linear-gradient(165deg, #1b2c52 0%, #304f8c 52%, #3f7ba3 100%);
          color: #fff;
          position: relative;
          overflow: hidden;
        }
        @media (min-width: 960px) { .acceso-marca { display: flex; } }
        .acceso-marca::after {
          content: '';
          position: absolute;
          right: -22%;
          bottom: -28%;
          width: 78%;
          aspect-ratio: 1;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(83,166,166,.34) 0%, transparent 68%);
          pointer-events: none;
        }
        .acceso-marca-cabecera :global(.logo-invertido) {
          filter: brightness(0) invert(1);
        }
        .acceso-marca-cuerpo { position: relative; z-index: 1; max-width: 30rem; }
        .acceso-marca-cuerpo h1 {
          font-family: var(--font-titulo);
          font-size: clamp(2rem, 3.4vw, 2.9rem);
          font-weight: 700;
          line-height: 1.06;
          letter-spacing: -0.022em;
          margin-bottom: 1rem;
        }
        .acceso-marca-cuerpo p {
          color: rgba(255,255,255,.76);
          font-size: 0.95rem;
          line-height: 1.62;
          max-width: 34ch;
        }
        .acceso-cifras {
          display: flex;
          gap: 2.25rem;
          margin-top: 2.25rem;
        }
        .acceso-cifras dt {
          font-family: var(--font-mono);
          font-size: 0.58rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(255,255,255,.5);
        }
        .acceso-cifras dd {
          font-family: var(--font-titulo);
          font-size: 1.5rem;
          font-weight: 700;
          margin: 0.2rem 0 0;
        }
        .acceso-marca-pie {
          position: relative;
          z-index: 1;
          font-family: var(--font-mono);
          font-size: 0.6rem;
          letter-spacing: 0.08em;
          color: rgba(255,255,255,.45);
        }

        /* --- lado del formulario --- */
        .acceso-panel {
          display: grid;
          place-items: center;
          padding: 2rem 1.25rem 3rem;
          background: var(--fondo);
        }
        .acceso-contenido { width: 100%; max-width: 27rem; }
        .acceso-titulo { margin-bottom: 1.5rem; }
        .acceso-titulo h2 { font-size: 1.5rem; }
        .acceso-titulo p { color: var(--tinta-3); font-size: 0.9rem; margin: 0.25rem 0 0; }
        .acceso-form { display: flex; flex-direction: column; gap: 0.9rem; }
        .acceso-error {
          background: var(--critico-suave);
          color: var(--critico);
          border: 1px solid color-mix(in srgb, var(--critico) 30%, transparent);
          border-radius: var(--radio);
          padding: 0.6rem 0.75rem;
          font-size: 0.82rem;
        }

        .w-full { width: 100%; }
      `}</style>
    </div>
  );
}
