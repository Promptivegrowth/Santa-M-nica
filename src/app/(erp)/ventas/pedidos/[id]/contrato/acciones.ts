'use server';

/**
 * ============================================================================
 *  GENERAR EL CONTRATO DE UNA PROFORMA
 * ============================================================================
 *  Lo que llega de la pantalla son los campos variables ya revisados. Aquí se
 *  vuelven a validar y se guardan TAL CUAL, con su número y su revisión. El
 *  número y la revisión los pone el servidor —no la pantalla—: dos personas
 *  generando a la vez no pueden sacar el mismo.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { puedeVender, type Rol } from '@/lib/navegacion';
import { nombreRol, listaDeRoles } from '@/lib/permisosVentas';
import { numeroContrato, fechaBilingue, revisarDatosContrato, type DatosContrato } from '@/lib/contratoVenta';
import { hoyEnLima } from '@/lib/fechas';
import { resolverFirmante } from '@/lib/firmanteDocumento';

type Resultado = { ok: true; id: number; numero: string; mensaje: string } | { ok: false; mensaje: string };

/** Recorta cada texto: un contrato no necesita párrafos de diez mil caracteres. */
function limpiar(d: DatosContrato): DatosContrato {
  const t = (s: unknown, max = 1500) => String(s ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
  return {
    numero: '', proforma: '', fecha: '',
    vendedor: { nombre: t(d.vendedor?.nombre, 200), direccion: t(d.vendedor?.direccion, 400) },
    comprador: { nombre: t(d.comprador?.nombre, 200), direccion: t(d.comprador?.direccion, 400), documento: t(d.comprador?.documento, 120) },
    producto: { en: t(d.producto?.en), es: t(d.producto?.es) },
    cantidad: t(d.cantidad, 200), precio: t(d.precio, 800), empaque: t(d.empaque, 300),
    periodo: { en: t(d.periodo?.en, 100), es: t(d.periodo?.es, 100) },
    puertoCarga: t(d.puertoCarga, 100), puertoDescarga: t(d.puertoDescarga, 100),
    //  083 · El puerto de descarga en castellano («VIGO, ESPAÑA»); vacío = el mismo del inglés.
    puertoDescargaEs: t(d.puertoDescargaEs ?? d.puertoDescarga, 100),
    pago: { en: t(d.pago?.en, 600), es: t(d.pago?.es, 600) },
    banco: {
      nombre: t(d.banco?.nombre, 120), direccion: t(d.banco?.direccion, 300), pais: t(d.banco?.pais, 80),
      swift: t(d.banco?.swift, 20), cuenta: t(d.banco?.cuenta, 60), beneficiario: t(d.banco?.beneficiario, 200),
    },
    documentoF: { en: t(d.documentoF?.en, 200), es: t(d.documentoF?.es, 200) },
  };
}

export async function generarContrato(pedidoId: number, recibidos: DatosContrato): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!puedeVender(usuario.rol as Rol)) {
    return {
      ok: false,
      mensaje: `${nombreRol(usuario.rol)} no genera contratos: lo hacen ${listaDeRoles(['gerencia', 'operaciones', 'comercial', 'comex'])}.`,
    };
  }

  const supabase = await crearClienteServidor();
  const { data: ped } = await supabase
    .from('pedidos').select('numero_proforma, cotizacion_id, creado_por, ciclo, cotizaciones(aprobada_en)').eq('id', pedidoId).maybeSingle();
  if (!ped) return { ok: false, mensaje: 'Ese pedido no existe.' };
  if (ped.ciclo === 'cancelado') return { ok: false, mensaje: `El pedido ${ped.numero_proforma} está cancelado.` };

  const datos = limpiar(recibidos);
  const problema = revisarDatosContrato(datos);
  if (problema) return { ok: false, mensaje: problema };

  /* ---- Número y revisión: los decide el servidor ---- */
  const { count } = await supabase.from('contratos').select('id', { count: 'exact', head: true }).eq('pedido_id', pedidoId);
  const revision = count ?? 0;
  datos.proforma = String(ped.numero_proforma);
  datos.numero = numeroContrato(datos.proforma, revision);
  datos.fecha = fechaBilingue(hoyEnLima());
  /*
   * Quién firma: lo decide el servidor, nunca la pantalla (083). Quien aprobó
   * la cotización si subió su firma («Mi firma»); si no, Gerencia de
   * Configuración. Se guarda en el contrato quién es; la imagen se busca al
   * descargar.
   */
  const [{ data: params }, firmante] = await Promise.all([
    supabase.from('parametros').select('clave, valor').in('clave', ['empresa_ruc']),
    resolverFirmante(supabase, ped),
  ]);
  const pm = new Map((params ?? []).map((x) => [String(x.clave), String(x.valor ?? '')]));
  datos.firmante = {
    nombre: firmante.nombre, cargo: firmante.cargo, ruc: pm.get('empresa_ruc') ?? '',
    usuarioId: firmante.usuarioId, motivo: firmante.motivo,
  };

  const { data, error } = await supabase
    .from('contratos')
    .insert({
      numero: datos.numero, pedido_id: pedidoId, cotizacion_id: ped.cotizacion_id ?? null, revision,
      titulo: 'CONTRATO DE VENTA INTERNACIONAL', datos, generado_por: usuario.id,
    })
    .select('id').single();
  if (error || !data) {
    return {
      ok: false,
      mensaje: error?.code === '23505'
        ? 'Alguien generó una revisión de este contrato hace un instante. Vuelva a cargar la página.'
        : `No se pudo guardar el contrato: ${error?.message ?? 'sin permiso'}`,
    };
  }

  await supabase.rpc('registrar_evento', {
    p_entidad: 'pedidos', p_entidad_id: pedidoId, p_tipo: 'contrato_generado',
    p_descripcion: `${usuario.nombre} generó el contrato ${datos.numero} de la proforma ${datos.proforma}.`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  revalidatePath(`/ventas/pedidos/${pedidoId}`);
  revalidatePath(`/ventas/pedidos/${pedidoId}/contrato`);
  if (ped.cotizacion_id) revalidatePath(`/ventas/cotizaciones/${ped.cotizacion_id}`);
  return { ok: true, id: Number(data.id), numero: datos.numero, mensaje: `Contrato ${datos.numero} generado. Ya se puede descargar en PDF y en Word.` };
}

/**
 * 083 · ¿La proforma y el contrato de este pedido llevan certificado de
 * captura? Nace con lo que se negoció en la cotización; aquí se corrige si el
 * cliente cambió de idea. Lo hacen los mismos que generan el contrato.
 *
 * El contrato ya generado no cambia (es la copia firmada): hay que generar
 * una revisión, y la pantalla lo dice.
 */
export async function cambiarCertificadoCaptura(
  pedidoId: number, lleva: boolean,
): Promise<{ ok: boolean; mensaje: string }> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a iniciar sesión.' };
  if (!puedeVender(usuario.rol as Rol)) {
    return {
      ok: false,
      mensaje: `${nombreRol(usuario.rol)} no cambia los documentos de la proforma: lo hacen ${listaDeRoles(['gerencia', 'operaciones', 'comercial', 'comex'])}.`,
    };
  }
  const supabase = await crearClienteServidor();
  const { data: ped } = await supabase.from('pedidos').select('numero_proforma, ciclo').eq('id', pedidoId).maybeSingle();
  if (!ped) return { ok: false, mensaje: 'Ese pedido no existe.' };
  if (ped.ciclo === 'cancelado') return { ok: false, mensaje: `El pedido ${ped.numero_proforma} está cancelado.` };

  const { data, error } = await supabase
    .from('pedidos').update({ certificado_captura: !!lleva }).eq('id', pedidoId).select('id');
  //  Una escritura que la base no deja pasar devuelve 0 filas sin error.
  if (error || !data?.length) {
    return { ok: false, mensaje: `No se pudo guardar: la base no dejó cambiar el pedido ${ped.numero_proforma}. Pídaselo a Gerencia u Operaciones.` };
  }

  await supabase.rpc('registrar_evento', {
    p_entidad: 'pedidos', p_entidad_id: pedidoId, p_tipo: 'certificado_captura',
    p_descripcion: `${usuario.nombre} ${lleva ? 'agregó' : 'quitó'} el certificado de captura de la proforma ${ped.numero_proforma}.`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  revalidatePath(`/ventas/pedidos/${pedidoId}`);
  revalidatePath(`/ventas/pedidos/${pedidoId}/contrato`);
  return {
    ok: true,
    mensaje: lleva
      ? `La proforma ${ped.numero_proforma} ahora lleva el certificado de captura (CATCH CERTIFICATE).`
      : `La proforma ${ped.numero_proforma} ya no lleva el certificado de captura.`,
  };
}
