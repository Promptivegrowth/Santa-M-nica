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
 *   · auditoria → el cambio técnico, con el valor anterior y el posterior.
 *
 *  Es UN solo componente reutilizado, no ocho implementaciones distintas: así
 *  la trazabilidad se ve y se comporta igual en todo el sistema.
 * ============================================================================
 */
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { fechaHora, haceTiempo } from '@/lib/formato';
import { Vacio } from './Pagina';

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

  if (!eventos || eventos.length === 0) {
    return (
      <Vacio
        titulo="Sin movimientos registrados"
        mensaje="Esta ficha todavía no ha tenido cambios después de su creación."
      />
    );
  }

  return (
    <ol className="linea-tiempo">
      {eventos.map((e: Record<string, unknown>, i: number) => {
        const severidad = String(e.severidad ?? 'info');
        const esAuditoria = e.origen === 'auditoria';
        return (
          <li key={i} className="linea-tiempo-item" data-severidad={severidad}>
            <span className="linea-tiempo-punto" aria-hidden />
            <div className="linea-tiempo-cuerpo">
              <p className="linea-tiempo-texto">{String(e.descripcion ?? '')}</p>
              <p className="linea-tiempo-meta">
                <strong>{String(e.usuario ?? 'Sistema')}</strong>
                <span>·</span>
                <time dateTime={String(e.ocurrido_en)} title={fechaHora(e.ocurrido_en as string)}>
                  {haceTiempo(e.ocurrido_en as string)}
                </time>
                {esAuditoria && <span className="linea-tiempo-marca">registro técnico</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
