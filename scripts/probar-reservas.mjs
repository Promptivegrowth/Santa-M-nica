/**
 * ============================================================================
 *  PRUEBA DE LIBERACIÓN DE RESERVAS
 * ============================================================================
 *  Esto comprueba el mecanismo que resuelve el problema central del cliente:
 *  «el producto está, pero figura asignado a alguien que nunca lo llevó».
 *
 *  No se limita a llamar a la función y ver que no da error: mide el stock
 *  DISPONIBLE antes y después, para demostrar que los kilos vuelven de verdad
 *  al circuito de venta.
 *
 *  Se hace y se DESHACE: al terminar, la reserva vuelve a su estado original,
 *  para no ensuciar los datos de demostración.
 * ============================================================================
 */
import { createClient } from '@supabase/supabase-js';
import './db.mjs';

const cli = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

const { data: r } = await cli.from('reservas')
  .select('id, lote_id, peso_neto_kg, estado, almacen_id')
  .eq('estado', 'activa').limit(1).single();

if (!r) { console.log('No hay reservas activas que probar.'); process.exit(0); }

const disponible = async () => {
  const { data } = await cli.from('v_disponibilidad')
    .select('disponible_kg, reservado_kg')
    .eq('almacen_id', r.almacen_id).limit(200);
  return (data ?? []).reduce((s, x) => s + Number(x.disponible_kg ?? 0), 0);
};

const antes = await disponible();

/* --- 1. El motivo corto tiene que ser rechazado por la propia base --- */
const { error: corto } = await cli.rpc('reserva_liberar', { p_reserva_id: r.id, p_motivo: 'no' });
console.log('Motivo demasiado corto rechazado:', corto ? 'SI' : 'NO ← fallo');

/* --- 2. La liberación con motivo válido devuelve el stock --- */
const { error: err } = await cli.rpc('reserva_liberar', {
  p_reserva_id: r.id,
  p_motivo: 'Prueba automatizada de liberacion, se revierte a continuacion',
});
console.log('Liberación con motivo válido:', err ? `FALLO -> ${err.message}` : 'OK');

const despues = await disponible();
console.log(`Disponible en el almacén ${r.almacen_id}: ${antes.toFixed(1)} kg -> ${despues.toFixed(1)} kg`);
console.log(`Peso que estaba apartado: ${Number(r.peso_neto_kg).toFixed(1)} kg`);
console.log('El stock volvió a estar disponible:', despues > antes ? 'SI' : 'NO ← revisar');

/* --- 3. Volver a liberarla debe fallar: ya no está activa --- */
const { error: repetida } = await cli.rpc('reserva_liberar', {
  p_reserva_id: r.id, p_motivo: 'Intento repetido que debe ser rechazado',
});
console.log('Liberar dos veces la misma reserva se rechaza:', repetida ? 'SI' : 'NO ← fallo');

/* --- Deshacer --- */
await cli.from('reservas')
  .update({ estado: 'activa', liberado_por: null, liberado_en: null, motivo_liberacion: null })
  .eq('id', r.id);
const final = await disponible();
console.log(`Revertido. Disponible de nuevo en ${final.toFixed(1)} kg (original ${antes.toFixed(1)}).`);
