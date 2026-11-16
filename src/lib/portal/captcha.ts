/**
 * ============================================================================
 *  CAPTCHA PROPIO DEL PORTAL
 * ============================================================================
 *  Cinco cifras dibujadas como trazos (no como texto: en el SVG no hay ningún
 *  carácter que copiar), cada una con su giro, su desplazamiento y su temblor,
 *  sobre líneas y puntos de ruido. La respuesta nunca llega al navegador: el
 *  servidor la guarda cifrada en la base (portal_captchas), que la comprueba
 *  y la gasta en cada búsqueda.
 *
 *  Es propio para no depender de un tercero el día uno. Si TI prefiere
 *  Cloudflare Turnstile o reCAPTCHA, se cambia solo esta pieza.
 * ============================================================================
 */
import { randomInt } from 'node:crypto';

/*  Siete segmentos sobre una caja de 10 × 18: a arriba, b arriba-der, c abajo-der,
 *  d abajo, e abajo-izq, f arriba-izq, g medio. */
const SEGMENTOS: Record<string, [number, number, number, number]> = {
  a: [0, 0, 10, 0], b: [10, 0, 10, 9], c: [10, 9, 10, 18], d: [0, 18, 10, 18],
  e: [0, 9, 0, 18], f: [0, 0, 0, 9], g: [0, 9, 10, 9],
};
const CIFRAS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
};

const azar = (min: number, max: number) => min + (randomInt(0, 10_000) / 10_000) * (max - min);

export function nuevoCaptcha(): { respuesta: string; svg: string } {
  // Sin «1» ni «7»: con trazos rectos se confunden entre sí
  const posibles = '02345689';
  const respuesta = Array.from({ length: 5 }, () => posibles[randomInt(0, posibles.length)]).join('');
  const ancho = 180, alto = 56;
  const partes: string[] = [];

  for (let i = 0; i < 9; i++) {
    partes.push(`<circle cx="${azar(0, ancho).toFixed(1)}" cy="${azar(0, alto).toFixed(1)}" r="${azar(1, 2.6).toFixed(1)}" fill="#8aa0c2" opacity=".55"/>`);
  }
  for (let i = 0; i < 4; i++) {
    partes.push(`<path d="M${azar(0, 40).toFixed(1)} ${azar(5, 50).toFixed(1)} Q${azar(60, 120).toFixed(1)} ${azar(0, 56).toFixed(1)} ${azar(140, 180).toFixed(1)} ${azar(5, 50).toFixed(1)}" stroke="#6f86ad" stroke-width="${azar(1, 1.8).toFixed(1)}" fill="none" opacity=".6"/>`);
  }

  [...respuesta].forEach((cifra, i) => {
    const x = 16 + i * 32 + azar(-3, 3);
    const y = 12 + azar(-4, 4);
    const giro = azar(-16, 16).toFixed(1);
    const escala = azar(1.15, 1.45).toFixed(2);
    const trazos = [...CIFRAS[cifra]].map((s) => {
      const [x1, y1, x2, y2] = SEGMENTOS[s];
      const t = () => azar(-1.1, 1.1).toFixed(1);
      return `<path d="M${x1} ${y1} L${(x1 + x2) / 2 + Number(t())} ${(y1 + y2) / 2 + Number(t())} L${x2} ${y2}"/>`;
    }).join('');
    partes.push(
      `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${giro} 5 9) scale(${escala}) skewX(${azar(-12, 12).toFixed(1)})" ` +
      `stroke="#1b2c52" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" fill="none">${trazos}</g>`
    );
  });

  partes.push(`<path d="M0 ${azar(18, 38).toFixed(1)} C60 ${azar(0, 56).toFixed(1)} 120 ${azar(0, 56).toFixed(1)} 180 ${azar(18, 38).toFixed(1)}" stroke="#1b2c52" stroke-width="1.2" fill="none" opacity=".45"/>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}"><rect width="100%" height="100%" fill="#f4f7fb"/>${partes.join('')}</svg>`;
  return { respuesta, svg };
}

export function svgComoDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
