'use client';

/**
 * ============================================================================
 *  FORMULARIO DE ACCESO · con inicio rápido por rol
 * ============================================================================
 *  Además del ingreso normal con correo y contraseña, esta pantalla ofrece un
 *  panel de ACCESO RÁPIDO: siete tarjetas, una por cada rol del sistema.
 *  Un clic entra directamente con ese perfil.
 *
 *  ¿Para qué sirve? Durante el desarrollo y las pruebas, permite comprobar en
 *  segundos qué ve y qué puede hacer cada persona del equipo, sin andar
 *  copiando contraseñas. Es una ayuda de la etapa de construcción.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { crearClienteNavegador } from '@/lib/supabase/navegador';
import { Logotipo } from '@/components/marca/Logo';

/** Los siete perfiles sembrados, con lo que hace cada uno. */
const PERFILES = [
  { rol: 'gerencia',    email: 'gerencia@santamonica.pe',    nombre: 'Marco A. León',  cargo: 'Gerencia General',      resumen: 'Ve todo. Configura el sistema, precios y reglas.',            color: '#304F8C' },
  { rol: 'operaciones', email: 'operaciones@santamonica.pe', nombre: 'Oliver Tello',   cargo: 'Jefatura Operaciones',  resumen: 'Autoriza traslados, ajustes y libera reservas.',              color: '#3d67ab' },
  { rol: 'comercial',   email: 'comercial@santamonica.pe',   nombre: 'Andrea Ríos',    cargo: 'Ventas',                resumen: 'Cotiza, registra pedidos y reserva producto.',                color: '#5095BF' },
  { rol: 'comex',       email: 'comex@santamonica.pe',       nombre: 'Paolo Quiñones', cargo: 'Comercio Exterior',     resumen: 'Programa embarques y arma la documentación.',                 color: '#4a90a8' },
  { rol: 'almacen',     email: 'almacen@santamonica.pe',     nombre: 'Luis Palacios',  cargo: 'Jefatura de Almacén',   resumen: 'Registra ingresos, carga contenedores y recibe traslados.',   color: '#53A6A6' },
  { rol: 'calidad',     email: 'calidad@santamonica.pe',     nombre: 'Karina Sotelo',  cargo: 'Calidad',               resumen: 'Observa y libera producto con sustento documental.',          color: '#5aa88f' },
  { rol: 'consulta',    email: 'consulta@santamonica.pe',    nombre: 'Invitado',       cargo: 'Solo lectura',          resumen: 'Solo consulta. No ve costos ni márgenes.',                    color: '#7a8aa3' },
];

const CLAVE_DEMO = 'SantaMonica2026';

export function FormularioAcceso() {
  const router = useRouter();
  const parametros = useSearchParams();
  const destino = parametros.get('destino') || '/panel';

  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  /** Realiza el ingreso contra Supabase y navega al panel. */
  async function ingresar(email: string, password: string, etiqueta?: string) {
    setError(null);
    setEntrando(etiqueta ?? email);

    const supabase = crearClienteNavegador();
    const { error: fallo } = await supabase.auth.signInWithPassword({ email, password });

    if (fallo) {
      // Mensaje entendible: decimos qué pasó y qué hacer.
      setError(
        fallo.message.includes('Invalid login')
          ? 'El correo o la contraseña no coinciden. Verifique e intente de nuevo.'
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
          <Logotipo alto={40} className="logo-invertido" />
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
                placeholder="nombre@santamonica.pe" disabled={ocupado}
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

            {error && (
              <div className="acceso-error" role="alert">{error}</div>
            )}

            <button type="submit" className="btn btn-primario w-full" disabled={ocupado}>
              {ocupado ? 'Verificando…' : 'Entrar'}
            </button>
          </form>

          {/* ---------- Acceso rápido ---------- */}
          <section className="acceso-rapido">
            <div className="acceso-rapido-cabecera">
              <span className="panel-titulo">Acceso rápido por rol</span>
              <span className="acceso-rapido-nota">Ayuda de desarrollo</span>
            </div>
            <p className="acceso-rapido-texto">
              Un clic entra con ese perfil. Sirve para verificar qué ve y qué puede
              hacer cada área.
            </p>

            <div className="acceso-tarjetas">
              {PERFILES.map((p) => (
                <button
                  key={p.rol}
                  type="button"
                  className="tarjeta-rol"
                  disabled={ocupado}
                  onClick={() => ingresar(p.email, CLAVE_DEMO, p.rol)}
                  title={p.resumen}
                >
                  <span className="tarjeta-rol-punto" style={{ background: p.color }} />
                  <span className="tarjeta-rol-datos">
                    <strong>{p.cargo}</strong>
                    <small>{p.nombre}</small>
                  </span>
                  <span className="tarjeta-rol-estado">
                    {entrando === p.rol ? '…' : '→'}
                  </span>
                </button>
              ))}
            </div>
          </section>
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

        /* --- acceso rápido --- */
        .acceso-rapido {
          margin-top: 2rem;
          padding-top: 1.5rem;
          border-top: 1px solid var(--linea);
        }
        .acceso-rapido-cabecera {
          display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
        }
        .acceso-rapido-nota {
          font-family: var(--font-mono);
          font-size: 0.56rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--tinta-3);
          border: 1px solid var(--linea);
          padding: 0.1em 0.4em;
          border-radius: 2px;
        }
        .acceso-rapido-texto {
          font-size: 0.8rem;
          color: var(--tinta-3);
          margin: 0.5rem 0 0.85rem;
        }
        .acceso-tarjetas { display: grid; gap: 0.4rem; }
        .tarjeta-rol {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          width: 100%;
          text-align: left;
          background: var(--superficie);
          border: 1px solid var(--linea);
          border-radius: var(--radio);
          padding: 0.5rem 0.7rem;
          cursor: pointer;
          transition: border-color .12s ease, background .12s ease, transform .12s ease;
        }
        .tarjeta-rol:hover:not(:disabled) {
          border-color: var(--acento-2);
          background: var(--superficie-2);
        }
        .tarjeta-rol:active:not(:disabled) { transform: translateY(1px); }
        .tarjeta-rol:disabled { opacity: 0.55; cursor: not-allowed; }
        .tarjeta-rol-punto {
          width: 0.55rem; height: 0.55rem; border-radius: 50%; flex: none;
        }
        .tarjeta-rol-datos { display: flex; flex-direction: column; flex: 1; min-width: 0; }
        .tarjeta-rol-datos strong { font-size: 0.82rem; font-weight: 600; }
        .tarjeta-rol-datos small { font-size: 0.72rem; color: var(--tinta-3); }
        .tarjeta-rol-estado {
          font-family: var(--font-mono);
          color: var(--tinta-3);
          font-size: 0.85rem;
        }
        .w-full { width: 100%; }
      `}</style>
    </div>
  );
}
