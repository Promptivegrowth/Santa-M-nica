'use server';

/**
 * ============================================================================
 *  SACOS ALTERNATIVOS DE UNA LÍNEA DEL PEDIDO (093)
 * ============================================================================
 *  Isaac (25/11): la proforma tiene que poder decir «BAGS OF 20 KG/21 KG»
 *  para que cámara PT despache con una u otra presentación, o mezclando
 *  (20 % de una y 80 % de otra). La línea sigue vendiéndose en kilos: esto
 *  solo declara qué otros sacos acepta el cliente, y se eligen entre las
 *  presentaciones que existen del producto con el mismo congelamiento.
 *
 *  Se escribe por función (fijar_sacos_alternativos), como la restricción de
 *  peso: Comercial no tiene el UPDATE de pedido_lineas, y no debe tenerlo
 *  para no tocar precio ni cantidad.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { puedeFijarRestriccionPeso } from '@/lib/permisosVentas';
import { uno } from '@/lib/relaciones';
import { leerSacosAlternativos } from '@/lib/sacosAlternativos';

export type Resultado = { ok: true; mensaje: string } | { ok: false; mensaje: string };

export async function guardarSacosAlternativos(pedidoId: number, lineaId: number, kgs: number[]): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!puedeFijarRestriccionPeso(usuario.rol)) {
    return { ok: false, mensaje: 'Los sacos alternativos los fijan Gerencia, Operaciones, Comercial o Comercio Exterior.' };
  }

  const supabase = await crearClienteServidor();

  /* Solo presentaciones que existen del mismo producto y congelamiento. */
  const { data: linea } = await supabase.from('pedido_lineas')
    .select('sku_presentaciones(sku_id, presentaciones(congelamiento))').eq('id', lineaId).maybeSingle();
  const sp = uno(linea?.sku_presentaciones as never) as Record<string, unknown> | undefined;
  if (!sp) return { ok: false, mensaje: 'Esa línea de pedido ya no existe.' };
  const cong = (uno(sp.presentaciones as never) as Record<string, unknown> | undefined)?.congelamiento;
  const { data: pres } = await supabase.from('sku_presentaciones')
    .select('presentaciones(peso_bulto_kg, congelamiento)').eq('sku_id', Number(sp.sku_id)).eq('activo', true);
  const existen = new Set((pres ?? [])
    .map((x) => uno(x.presentaciones as never) as Record<string, unknown> | undefined)
    .filter((p) => p?.congelamiento === cong).map((p) => Number(p!.peso_bulto_kg)));
  const pedidos = [...new Set(kgs.map(Number))];
  const raro = pedidos.find((k) => !existen.has(k));
  if (raro !== undefined) {
    return { ok: false, mensaje: `Este producto no tiene presentación de ${raro} kg en ese congelamiento: elija una de la lista.` };
  }

  const { error } = await supabase.rpc('fijar_sacos_alternativos', { p_linea_id: lineaId, p_kg: pedidos });
  if (error) return { ok: false, mensaje: error.message };

  //  Se lee lo que quedó escrito y eso es lo que se le dice al usuario.
  const { data } = await supabase.from('pedido_lineas').select('sacos_alternativos_kg').eq('id', lineaId).maybeSingle();
  if (!data) return { ok: false, mensaje: 'El cambio no llegó a guardarse. Avise a soporte en vez de volver a intentarlo.' };
  const quedo = leerSacosAlternativos(data.sacos_alternativos_kg);

  revalidatePath(`/ventas/pedidos/${pedidoId}`);
  return {
    ok: true,
    mensaje: quedo.length
      ? `Guardado: la proforma dirá que también acepta sacos de ${quedo.join(' / ')} kg.`
      : 'Guardado: la línea queda solo con su saco.',
  };
}
