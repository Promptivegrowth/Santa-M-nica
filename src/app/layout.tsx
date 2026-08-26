/**
 * ============================================================================
 *  LAYOUT RAÍZ · Santa Mónica ERP
 * ============================================================================
 *  Envuelve toda la aplicación. Aquí se cargan las tres tipografías del
 *  sistema de diseño y se fija el idioma y el tema.
 *
 *  Las tres tipografías y su papel:
 *   · Archivo       → títulos y cifras grandes. Industrial, aguanta números.
 *   · Source Sans 3 → texto de interfaz. Humanista, cómoda de leer en tablas.
 *   · JetBrains Mono→ códigos, lotes, contenedores y toda columna numérica.
 * ============================================================================
 */
import type { Metadata, Viewport } from 'next';
import { Archivo, Source_Sans_3, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const fuenteTitulo = Archivo({
  variable: '--fuente-titulo',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
});

const fuenteTexto = Source_Sans_3({
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
