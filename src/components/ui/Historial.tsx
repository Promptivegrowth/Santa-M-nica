/**
 * ============================================================================
 *  HISTORIAL · la línea de tiempo de cualquier ficha
 * ============================================================================
 *  Este componente se monta igual en un lote, un pedido, una reserva, un
 *  traslado, un embarque o una factura. Siempre muestra lo mismo: qué pasó,
 *  cuándo, quién lo hizo y qué cambió exactamente.
 *
 *  Los datos vienen de la función historial_entidad() de la base de datos, que
 *  mezcla dos fuentes:
 *   · eventos   → hechos del negocio, redactados para que los lea una persona.
 *   · auditoria → el cambio de datos, con el valor anterior y el posterior.
 *
 *  Es UN solo componente reutilizado, no ocho implementaciones distintas: así
 *  la trazabilidad se ve y se comporta igual en todo el sistema.
 *
 *  SIN NOMBRES TÉCNICOS (077)
 *  La auditoría guarda nombres de columna («ruc_tax_id», «fecha_carga») y el
 *  historial los mostraba tal cual: «Modificado: fecha_programada». Ahora se
 *  traducen con el diccionario central (src/lib/etiquetas.ts) y, cuando el
 *  dato es corto, se dice también de qué a qué cambió. Los textos de eventos
 *  viejos que traían claves («· pendiente_validacion») se leen con
 *  textoLegible().
 * ============================================================================
 */
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { fecha, fechaHora, haceTiempo } from '@/lib/formato';
import { CAMPOS_SIN_INTERES, ESTADOS, etiquetaCampo, textoLegible } from '@/lib/etiquetas';
import { Vacio } from './Pagina';

type Detalle = { antes?: Record<string, unknown> | null; despues?: Record<string, unknown> | null; campos?: string[] | null };

/** Un valor suelto, dicho corto; null si no conviene mostrarlo (largo, id, objeto). */
function valorCorto(campo: string, v: unknown): string | null {
  if (v === null || v === undefined || v === '') return 'vacío';
  if (campo.endsWith('_id') || campo === 'id') return null;          // un número interno no le dice nada a nadie
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'number') return v.toLocaleString('es-PE', { maximumFractionDigits: 3 });
  if (typeof v !== 'string') return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v)) return null;               // un usuario (uuid)
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fecha(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return fechaHora(v);
  if (ESTADOS[v]) return ESTADOS[v].toLowerCase();
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v).toLocaleString('es-PE', { maximumFractionDigits: 3 });
  if (v.length > 50) return null;
  return `«${v}»`;
}

/**
 * Qué dice una fila de auditoría, en palabras. Devuelve null si el único cambio
 * es de los que se mueven solos (la fecha de actualización): no es noticia.
 */
function describirCambio(accion: string, d: Detalle): string | null {
  if (accion === 'INSERT') return 'Ficha creada';
  if (accion === 'DELETE') return 'Registro eliminado';

  const antes = d.antes ?? {};
  const despues = d.despues ?? {};
  const campos = (d.campos && d.campos.length
    ? d.campos
    : Object.keys(despues).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
  ).filter((c) => !CAMPOS_SIN_INTERES.has(c));
  if (campos.length === 0) return null;

  const partes = campos.map((c) => {
    const nombre = etiquetaCampo(c);
    const a = valorCorto(c, antes[c]);
    const b = valorCorto(c, despues[c]);
    //  Con pocos campos se dice de qué a qué; con muchos, solo cuáles.
    return campos.length <= 4 && a !== null && b !== null ? `${nombre} (de ${a} a ${b})` : nombre;
  });
  return `Se cambió ${partes.join(', ')}`;
}

export async function Historial({
  entidad,
  entidadId,
}: {
  /** Nombre de la tabla: 'pedidos', 'lotes', 'reservas', 'traslados'… */
  entidad: string;
  entidadId: number;
}) {
  const supabase = await crearClienteServidor();
  const { data: eventos, error } = await supabase.rpc('historial_entidad', {
    p_entidad: entidad,
    p_entidad_id: entidadId,
  });

  if (error) {
    return (
      <Vacio
        titulo="No se pudo cargar el historial"
        mensaje="Vuelva a intentarlo. Si el problema persiste, avise a soporte."
      />
    );
  }

  const filas = ((eventos ?? []) as Record<string, unknown>[])
    .map((e) => {
      const esAuditoria = e.origen === 'auditoria';
      const texto = esAuditoria
        ? describirCambio(String(e.tipo ?? ''), (e.detalle ?? {}) as Detalle)
        : textoLegible(String(e.descripcion ?? ''));
      return { e, esAuditoria, texto };
    })
    .filter((f) => f.texto !== null);

  if (filas.length === 0) {
    return (
      <Vacio
        titulo="Sin movimientos registrados"
        mensaje="Esta ficha todavía no ha tenido cambios después de su creación."
      />
    );
  }

  return (
    <ol className="linea-tiempo">
      {filas.map(({ e, esAuditoria, texto }, i) => {
        const severidad = String(e.severidad ?? 'info');
        return (
          <li key={i} className="linea-tiempo-item" data-severidad={severidad}>
            <span className="linea-tiempo-punto" aria-hidden />
            <div className="linea-tiempo-cuerpo">
              <p className="linea-tiempo-texto">{texto}</p>
              <p className="linea-tiempo-meta">
                <strong>{String(e.usuario ?? 'Sistema')}</strong>
                <span>·</span>
                <time dateTime={String(e.ocurrido_en)} title={fechaHora(e.ocurrido_en as string)}>
                  {haceTiempo(e.ocurrido_en as string)}
                </time>
                {/*
                  Antes decía «registro técnico», que no le dice nada a nadie.
                  Es el apunte automático que deja el sistema cada vez que se
                  guarda la ficha: qué dato cambió y quién lo cambió.
                */}
                {esAuditoria && (
                  <span className="linea-tiempo-marca"
                        title="Apunte automático del sistema al guardar la ficha: qué dato cambió y quién lo cambió.">
                    cambio de datos
                  </span>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
