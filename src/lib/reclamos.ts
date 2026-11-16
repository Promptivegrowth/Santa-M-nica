/**
 * ============================================================================
 *  RECLAMOS DE CLIENTES · lo que comparten la bandeja, los indicadores y el
 *  Excel de Aseguramiento de Calidad (090, propuesta COT-2026-11-253)
 * ============================================================================
 *  Un solo lugar dice:
 *   · quién atiende (clasifica, investiga y cierra) y quién solo consulta,
 *   · cómo se nombra cada estado,
 *   · el semáforo de plazos: Vencido, Por vencer (2 días o menos), En plazo,
 *     Sin clasificar (todavía no tiene plazo) y Cerrado,
 *   · cómo se cargan los reclamos con sus relaciones aplanadas.
 *
 *  Los reclamos los lee el usuario con SU sesión: la política de la base
 *  (reclamos_lectura) decide quién los ve.
 * ============================================================================
 */
import type { crearClienteServidor } from '@/lib/supabase/servidor';
import { hoyEnLima, desplazarDias } from '@/lib/fechas';
import { uno } from '@/lib/relaciones';

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;

/** Clasificar, investigar y cerrar con PDF: Calidad y Gerencia (reclamo_actualizar). */
export const ROLES_ATIENDEN_RECLAMOS = ['gerencia', 'calidad'];
/** Consultar: además quienes atienden al cliente. Misma lista que la política. */
export const ROLES_VEN_RECLAMOS = ['gerencia', 'operaciones', 'comercial', 'comex', 'calidad'];

export const ESTADOS_RECLAMO: Record<string, string> = {
  pendiente: 'Pendiente',
  en_revision: 'En revisión',
  en_investigacion: 'En investigación',
  cerrado: 'Cerrado',
};

export type Semaforo = 'vencido' | 'por_vencer' | 'en_plazo' | 'sin_clasificar' | 'cerrado';

export const SEMAFORO: Record<Semaforo, { texto: string; tono: 'ok' | 'atencion' | 'critico' | 'info' | 'neutro' }> = {
  vencido:        { texto: 'Vencido',        tono: 'critico' },
  por_vencer:     { texto: 'Por vencer',     tono: 'atencion' },
  en_plazo:       { texto: 'En plazo',       tono: 'ok' },
  sin_clasificar: { texto: 'Sin clasificar', tono: 'info' },
  cerrado:        { texto: 'Cerrado',        tono: 'neutro' },
};

export function semaforoReclamo(r: { estado: string; fecha_limite: string | null }, hoy = hoyEnLima()): Semaforo {
  if (r.estado === 'cerrado') return 'cerrado';
  if (!r.fecha_limite) return 'sin_clasificar';
  if (r.fecha_limite < hoy) return 'vencido';
  if (r.fecha_limite <= desplazarDias(hoy, 2)) return 'por_vencer';
  return 'en_plazo';
}

/** Días calendario entre dos instantes (para el tiempo de cierre). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.max(0, (new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000);
}

export type FilaReclamo = {
  id: number;
  numero: string;
  creado_en: string;
  fecha: string;
  estado: string;
  fecha_limite: string | null;
  cerrado_en: string | null;
  pedido_id: number;
  proforma: string;
  cliente_id: number;
  cliente: string;
  cliente_codigo: string;
  motivo_id: number;
  motivo: string;
  clasificacion: string | null;
  plazo_dias: number | null;
  packing_list_id: number | null;
  contenedor: string | null;
  contacto_nombre: string;
  contacto_correo: string;
  semaforo: Semaforo;
  dias_cierre: number | null;
  /** Cerrado a más tardar el día límite. null si no se cerró o no tenía plazo. */
  cerrado_en_plazo: boolean | null;
};

export type FiltrosReclamo = {
  cliente?: string;
  proforma?: string;
  motivo?: string;
  estado?: string;
  desde?: string;
  hasta?: string;
};

/**
 * Los reclamos con su cliente, proforma, motivo, clasificación y contenedor.
 * Los filtros de texto (cliente, proforma) se aplican después: son nombres de
 * tablas relacionadas y el volumen de reclamos es pequeño.
 */
export async function cargarReclamos(
  supabase: Cliente, f: FiltrosReclamo = {}
): Promise<{ filas: FilaReclamo[]; error: string | null }> {
  let q = supabase
    .from('reclamos')
    .select(
      'id, numero, creado_en, estado, fecha_limite, cerrado_en, pedido_id, cliente_id, motivo_id, packing_list_id, contacto_nombre, contacto_correo, ' +
      'clientes(razon_social, codigo), pedidos(numero_proforma), reclamo_motivos(nombre_es), reclamo_clasificaciones(nombre, plazo_dias), ' +
      'packing_lists!reclamos_packing_list_id_fkey(codigo, contenedor)'
    )
    .order('creado_en', { ascending: false })
    .limit(2000);
  if (f.estado === 'abiertos') q = q.neq('estado', 'cerrado');
  else if (f.estado) q = q.eq('estado', f.estado);
  if (f.motivo) q = q.eq('motivo_id', Number(f.motivo));
  //  Las fechas del filtro son días de Lima: se comparan con el instante del registro.
  if (f.desde) q = q.gte('creado_en', `${f.desde}T00:00:00-05:00`);
  if (f.hasta) q = q.lte('creado_en', `${f.hasta}T23:59:59.999-05:00`);

  const { data, error } = await q;
  if (error) return { filas: [], error: error.message };

  const filasCrudas = (data ?? []) as unknown as Record<string, unknown>[];

  /* La referencia del contenedor tal como la ve el cliente (SM26-623/1). */
  const idsPacking = [...new Set(filasCrudas.map((r) => r.packing_list_id).filter(Boolean))] as number[];
  const referencias = new Map<number, string>();
  if (idsPacking.length) {
    const { data: vc } = await supabase
      .from('v_pedido_contenedores').select('packing_list_id, referencia').in('packing_list_id', idsPacking);
    for (const v of vc ?? []) referencias.set(Number(v.packing_list_id), String(v.referencia));
  }

  const hoy = hoyEnLima();
  const cliente = (f.cliente ?? '').trim().toLowerCase();
  const proforma = (f.proforma ?? '').trim().toLowerCase();

  const filas = filasCrudas.map((r): FilaReclamo => {
    const cli = uno<Record<string, unknown>>(r.clientes);
    const ped = uno<Record<string, unknown>>(r.pedidos);
    const mot = uno<Record<string, unknown>>(r.reclamo_motivos);
    const cla = uno<Record<string, unknown>>(r.reclamo_clasificaciones);
    const pk = uno<Record<string, unknown>>(r.packing_lists);
    const packingId = r.packing_list_id == null ? null : Number(r.packing_list_id);
    const estado = String(r.estado);
    const fechaLimite = (r.fecha_limite as string | null) ?? null;
    const cerradoEn = (r.cerrado_en as string | null) ?? null;
    const creado = String(r.creado_en);
    const diaCierre = cerradoEn ? new Date(cerradoEn).toLocaleDateString('en-CA', { timeZone: 'America/Lima' }) : null;
    return {
      id: Number(r.id),
      numero: String(r.numero),
      creado_en: creado,
      fecha: new Date(creado).toLocaleDateString('en-CA', { timeZone: 'America/Lima' }),
      estado,
      fecha_limite: fechaLimite,
      cerrado_en: cerradoEn,
      pedido_id: Number(r.pedido_id),
      proforma: String(ped?.numero_proforma ?? '—'),
      cliente_id: Number(r.cliente_id),
      cliente: String(cli?.razon_social ?? '—'),
      cliente_codigo: String(cli?.codigo ?? ''),
      motivo_id: Number(r.motivo_id),
      motivo: String(mot?.nombre_es ?? '—'),
      clasificacion: (cla?.nombre as string) ?? null,
      plazo_dias: cla?.plazo_dias == null ? null : Number(cla.plazo_dias),
      packing_list_id: packingId,
      contenedor: packingId
        ? referencias.get(packingId) ?? ([pk?.codigo, pk?.contenedor].filter(Boolean).join(' · ') || `#${packingId}`)
        : null,
      contacto_nombre: String(r.contacto_nombre ?? ''),
      contacto_correo: String(r.contacto_correo ?? ''),
      semaforo: semaforoReclamo({ estado, fecha_limite: fechaLimite }, hoy),
      dias_cierre: cerradoEn ? diasEntre(creado, cerradoEn) : null,
      cerrado_en_plazo: cerradoEn && fechaLimite && diaCierre ? diaCierre <= fechaLimite : null,
    };
  });

  return {
    filas: filas.filter((r) =>
      (!cliente || r.cliente.toLowerCase().includes(cliente) || r.cliente_codigo.toLowerCase().includes(cliente)) &&
      (!proforma || r.proforma.toLowerCase().includes(proforma))),
    error: null,
  };
}

/** Las variables que acepta cada plantilla de correo, para mostrarlas al editarla. */
export const VARIABLES_PLANTILLA: Record<string, string[]> = {
  accesos: ['contacto', 'codigo_cliente', 'numero_proforma', 'llave', 'correo_acceso', 'clave_acceso', 'portal_url'],
  proforma: ['contacto', 'numero', 'vendedor'],
  cotizacion: ['contacto', 'numero', 'vendedor'],
  reclamo_codigo: ['nombre', 'numero_proforma', 'codigo'],
  reclamo_registrado: ['nombre', 'numero', 'numero_proforma', 'motivo'],
  reclamo_nuevo: ['numero', 'cliente', 'numero_proforma', 'motivo', 'nombre', 'correo', 'enlace'],
  reclamo_cierre: ['nombre', 'numero', 'numero_proforma', 'conclusion', 'nota_pdf'],
};
