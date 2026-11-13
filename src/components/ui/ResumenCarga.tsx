/**
 * ============================================================================
 *  RESUMEN DE LA CARGA · ¿se cargó o no?, en una frase y con el detalle
 * ============================================================================
 *  13/11 · Pedido de Gerencia: al abrir una importación tiene que quedar claro,
 *  sin recorrer la tabla, si el proceso SE CARGÓ o si HUBO ERRORES, de qué
 *  TIPO y cuántos. Lo usan las dos revisiones (ingresos y traslados).
 *
 *  La frase sale de las filas, no del estado de la importación: una
 *  importación «Validada» con filas que no se registraron no está completa.
 *
 *  Los errores se agrupan por columna («PESO NETO · 12 filas»), con un ejemplo
 *  del motivo y los números de fila del Excel: así se ve si es un mismo
 *  problema repetido (corregir el Excel y volver a subirlo) o casos sueltos
 *  (corregirlos aquí).
 * ============================================================================
 */
import { Icono } from '@/components/estructura/Icono';

type FilaResumen = { fila: number; estado: string; errores: { columna: string; mensaje: string }[]; resultado: string | null };

const lista = (n: number[]) => (n.length > 8 ? `${n.slice(0, 8).join(', ')} y ${n.length - 8} más` : n.join(', '));
const plural = (n: number, s: string, p = `${s}s`) => `${n.toLocaleString('es-PE')} ${n === 1 ? s : p}`;

export function ResumenCarga({
  estado, filas, titulos, recienSubida, unidad = 'pallet',
}: {
  /** El estado de la importación: revision · lista · validada. */
  estado: string;
  filas: FilaResumen[];
  /** El título de cada columna, para nombrar el error como en el Excel. */
  titulos: Record<string, string>;
  recienSubida?: boolean;
  unidad?: string;
}) {
  const n = (...e: string[]) => filas.filter((f) => e.includes(f.estado)).length;
  const hechas = n('registrada', 'programada');
  const conError = n('con_error');
  const fallidas = n('fallida');
  const listas = n('valida');
  const enCurso = n('procesando');
  const descartadas = n('descartada');

  /* ---- La frase ---- */
  let tono: 'ok' | 'atencion' | 'critico' | 'info';
  let titulo: string;
  let detalle: string;
  if (filas.length === 0) {
    tono = 'atencion'; titulo = 'La importación no tiene filas';
    detalle = 'Vuelva a subir el archivo desde «Importar desde Excel».';
  } else if (enCurso) {
    tono = 'info'; titulo = 'Cargando…';
    detalle = `${plural(enCurso, 'fila')} se está registrando ahora. Recargue la pantalla en un momento.`;
  } else if (hechas && !listas && !conError && !fallidas) {
    tono = 'ok'; titulo = 'Carga completa';
    detalle = `Se cargaron ${plural(hechas, unidad)} al sistema` + (descartadas ? ` (${plural(descartadas, 'fila descartada', 'filas descartadas')} a propósito).` : '.');
  } else if (hechas && (conError || fallidas)) {
    tono = 'atencion'; titulo = 'Carga parcial';
    detalle = `Se cargaron ${plural(hechas, unidad)}; ${plural(conError + fallidas, 'fila')} no entró por los motivos de abajo.` +
      (listas ? ` Quedan ${plural(listas, 'fila lista', 'filas listas')} por registrar.` : '');
  } else if (conError || fallidas) {
    tono = 'critico'; titulo = hechas ? 'Carga parcial' : 'Todavía no se cargó: hay errores';
    detalle = `${plural(conError + fallidas, 'fila')} con error` + (listas ? ` y ${plural(listas, 'fila lista', 'filas listas')}` : '') +
      '. Nada entra al stock hasta registrar; las filas con error se quedan aquí para corregirlas.';
  } else if (listas) {
    tono = 'info'; titulo = estado === 'lista' ? 'Lista para validar' : 'Archivo revisado sin errores';
    detalle = `${plural(listas, 'fila lista', 'filas listas')} para registrar. Todavía no entró nada al stock.`;
  } else {
    tono = 'atencion'; titulo = 'No hay nada por cargar';
    detalle = 'Todas las filas están descartadas.';
  }
  if (recienSubida) detalle = `Archivo leído: ${plural(filas.length, 'fila')}. ${detalle}`;

  /* ---- Los errores, agrupados por columna ---- */
  const grupos = new Map<string, { filas: number[]; ejemplo: string }>();
  for (const f of filas) {
    if (f.estado === 'con_error') {
      for (const e of f.errores) {
        const g = grupos.get(e.columna) ?? { filas: [], ejemplo: e.mensaje };
        if (!g.filas.includes(f.fila)) g.filas.push(f.fila);
        grupos.set(e.columna, g);
      }
    }
    if (f.estado === 'fallida') {
      const g = grupos.get('__registro') ?? { filas: [], ejemplo: f.resultado ?? 'El sistema no lo aceptó al registrar.' };
      g.filas.push(f.fila);
      grupos.set('__registro', g);
    }
  }
  const tipos = [...grupos.entries()].sort((a, b) => b[1].filas.length - a[1].filas.length);

  return (
    <div className={`ficha-aviso ficha-aviso-${tono}`} role={tono === 'critico' ? 'alert' : 'status'} data-resumen="carga" data-tono={tono}
         style={{ marginBottom: '1rem', alignItems: 'flex-start' }}>
      <Icono nombre={tono === 'ok' ? 'calidad' : tono === 'info' ? 'reloj' : 'alerta'} tamano={17} />
      <div style={{ display: 'grid', gap: '.35rem', minWidth: 0 }}>
        <strong data-campo="titulo">{titulo}</strong>
        <span>{detalle}</span>
        {tipos.length > 0 && (
          <div data-campo="tipos-error">
            <b>Tipos de error:</b>
            <ul style={{ margin: '.2rem 0 0', paddingLeft: '1.1rem' }}>
              {tipos.map(([col, g]) => (
                <li key={col} data-columna={col}>
                  <b>{col === '__registro' ? 'Al registrar' : titulos[col] ?? col}</b> · {plural(g.filas.length, 'fila')} (fila{g.filas.length === 1 ? '' : 's'} {lista(g.filas)}).{' '}
                  <span style={{ color: 'var(--tinta-2)' }}>Ej.: {g.ejemplo}</span>
                </li>
              ))}
            </ul>
            {tipos.length === 1 && tipos[0][1].filas.length > 5 && (
              <small style={{ color: 'var(--tinta-2)' }}>
                Es el mismo problema en muchas filas: suele ser más rápido corregirlo en el Excel y volver a subirlo.
              </small>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
