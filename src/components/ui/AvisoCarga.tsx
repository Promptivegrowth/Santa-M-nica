/**
 * ============================================================================
 *  AVISO DE CARGA · el resultado de subir un archivo, dicho con amabilidad
 * ============================================================================
 *  Una tarjeta, no una frase en rojo: el tipo de fallo como título, qué pasó,
 *  qué hacer, y los datos del intento (archivo, tamaño, hora, referencia) para
 *  poder pedir ayuda sin tener que describirlo de memoria.
 * ============================================================================
 */
import { Icono } from '@/components/estructura/Icono';
import { TIPO_FALLO, type TipoFalloCarga } from '@/lib/falloCarga';

export type IntentoCarga = { archivo?: string; bytes?: number; hora?: string; referencia?: string };

const tamano = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function AvisoCarga({ tipo, mensaje, intento }: { tipo?: TipoFalloCarga; mensaje: string; intento?: IntentoCarga }) {
  const t = TIPO_FALLO[tipo ?? 'base'];
  const datos = [
    intento?.archivo && ['Archivo', intento.archivo],
    intento?.bytes !== undefined && ['Tamaño', tamano(intento.bytes)],
    intento?.hora && ['Hora', intento.hora],
    intento?.referencia && ['Referencia', intento.referencia],
  ].filter(Boolean) as [string, string][];

  return (
    <div className="ficha-aviso ficha-aviso-critico" role="alert" data-aviso="carga" data-tipo={tipo ?? 'base'}
         style={{ marginBottom: '.8rem', alignItems: 'flex-start' }}>
      <Icono nombre="alerta" tamano={17} />
      <div style={{ display: 'grid', gap: '.35rem' }}>
        <strong data-campo="tipo">{t.titulo}</strong>
        <span data-campo="mensaje">{mensaje}</span>
        <span data-campo="que-hacer"><b>Qué hacer:</b> {t.queHacer}</span>
        {datos.length > 0 && (
          <small style={{ color: 'var(--tinta-2)' }} data-campo="intento">
            {datos.map(([k, v]) => `${k}: ${v}`).join(' · ')}
          </small>
        )}
      </div>
    </div>
  );
}
