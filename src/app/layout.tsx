/**
 * ============================================================================
 *  LAYOUT RAÍZ · Santa Mónica ERP
 * ============================================================================
 *  Envuelve toda la aplicación. Aquí se cargan las tres tipografías del
 *  sistema de diseño y se fija el idioma y el tema.
 *
 *  Las tres tipografías y su papel:
 *   · Archivo       → títulos y cifras grandes. Industrial, aguanta números.
 *   · Inter         → texto de interfaz. Diseñada para pantallas densas.
 *   · JetBrains Mono→ códigos, lotes, contenedores y toda columna numérica.
 * ============================================================================
 */
import type { Metadata, Viewport } from 'next';
import { Archivo, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const fuenteTitulo = Archivo({
  variable: '--fuente-titulo',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
});

/*
 * Inter en lugar de Source Sans 3.
 *
 * El motivo es concreto: Source Sans tiene la altura de la x baja y trazos
 * finos, y en una tabla de doce puntos sobre fondo claro cuesta leerla. Inter
 * se diseño justo para eso —interfaces densas, tamaños pequenos— y tiene la
 * x mucho mas alta, asi que a igual tamano se lee bastante mejor sin perder
 * formalidad: es una grotesca neutra, no una fuente con caracter.
 */
const fuenteTexto = Inter({
  variable: '--fuente-texto',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const fuenteMono = JetBrains_Mono({
  variable: '--fuente-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Santa Mónica ERP',
    template: '%s · Santa Mónica ERP',
  },
  description:
    'Sistema de gestión de ventas, almacenes y despachos de Industrial Pesquera Santa Mónica.',
  icons: { icon: '/logo.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#304F8C' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1120' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="es-PE"
      className={`${fuenteTitulo.variable} ${fuenteTexto.variable} ${fuenteMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Aplica el tema guardado ANTES de que pinte la página.
          Sin esto, quien usa tema oscuro vería un destello blanco al entrar.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('tema-sm');if(t){document.documentElement.setAttribute('data-tema',t);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
