/**
 * ============================================================================
 *  CORREOS ENVIADOS (090, M1/M6/M7 · registro de cada envío)
 * ============================================================================
 *  Cada correo que sale del sistema —accesos al portal, proformas y
 *  cotizaciones desde comex@, avisos de reclamos desde reclamos@— con quién lo
 *  envió, cuándo, a quién y qué decía. La Llave y la contraseña se guardan
 *  enmascaradas: nunca quedan en un registro.
 *
 *  Quién ve qué lo decide la base (correos_lectura): Gerencia y Operaciones,
 *  todos; Comercial y Comercio Exterior, los comerciales; Calidad, los de
 *  reclamos; y cada uno, los que envió.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros } from '@/components/ui/Filtros';
import { fechaHora, num } from '@/lib/formato';
import { CORREO_CONFIGURADO } from '@/lib/correo';

export const metadata: Metadata = { title: 'Correos enviados' };
export const dynamic = 'force-dynamic';

const TIPOS: Record<string, string> = {
  accesos: 'Datos de acceso al portal',
  proforma: 'Proforma',
  cotizacion: 'Cotización',
  reclamo_codigo: 'Código de verificación',
  reclamo_registrado: 'Reclamo registrado',
  reclamo_nuevo: 'Aviso de nuevo reclamo',
  reclamo_cierre: 'Cierre de reclamo',
};

const ESTADOS: Record<string, { texto: string; tono: 'ok' | 'atencion' | 'critico' }> = {
  enviado: { texto: 'Enviado', tono: 'ok' },
  simulado: { texto: 'Simulado (no salió)', tono: 'atencion' },
  error: { texto: 'Error', tono: 'critico' },
};

function enlaceEntidad(entidad: string | null, id: number | null): string | null {
  if (!entidad || !id) return null;
  if (entidad === 'pedidos') return `/ventas/pedidos/${id}`;
  if (entidad === 'cotizaciones') return `/ventas/cotizaciones/${id}`;
  if (entidad === 'reclamos') return `/calidad/reclamos/${id}`;
  return null;
}

export default async function CorreosEnviados(props: PageProps<'/correos'>) {
  const q = await props.searchParams;
  const tipo = typeof q.tipo === 'string' ? q.tipo : '';
  const estado = typeof q.estado === 'string' ? q.estado : '';
  const desde = typeof q.desde === 'string' ? q.desde : '';
  const hasta = typeof q.hasta === 'string' ? q.hasta : '';

  const supabase = await crearClienteServidor();
  let consulta = supabase.from('correos_salida')
    .select('id, tipo, remitente, para, cc, asunto, cuerpo, adjuntos, estado, error, entidad, entidad_id, enviado_por_nombre, creado_en')
    .order('creado_en', { ascending: false })
    .limit(300);
  if (tipo && TIPOS[tipo]) consulta = consulta.eq('tipo', tipo);
  if (estado && ESTADOS[estado]) consulta = consulta.eq('estado', estado);
  if (desde) consulta = consulta.gte('creado_en', `${desde}T00:00:00-05:00`);
  if (hasta) consulta = consulta.lte('creado_en', `${hasta}T23:59:59.999-05:00`);
  const { data, error } = await consulta;
  const filas = data ?? [];

  return (
    <>
      <CabeceraPagina
        titulo="Correos enviados"
        descripcion="Los correos que salieron del sistema: accesos al portal, proformas, cotizaciones y avisos de reclamos. Quién, cuándo, a quién y qué decía."
      />

      {!CORREO_CONFIGURADO() && (
        <p className="form-mensaje" role="status" data-aviso="correo-simulado"
           style={{ background: 'var(--atencion-suave)', color: 'var(--atencion)', margin: '0 0 1rem' }}>
          <strong>Modo simulado.</strong> El envío de correos todavía no está conectado al dominio santamonicafishing.com: cada correo
          queda registrado aquí con su contenido, pero <strong>no sale</strong>. Se activa cuando TI configure el servicio de envío
          (SPF, DKIM y DMARC) y se cargue su clave en el servidor.
        </p>
      )}

      <Panel titulo={`${num(filas.length)} correo${filas.length === 1 ? '' : 's'}`}>
        <Filtros campos={[
          { tipo: 'select', clave: 'tipo', etiqueta: 'Tipo', opciones: Object.entries(TIPOS).map(([v, t]) => ({ valor: v, texto: t })) },
          { tipo: 'select', clave: 'estado', etiqueta: 'Estado', opciones: Object.entries(ESTADOS).map(([v, e]) => ({ valor: v, texto: e.texto })) },
          { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
          { tipo: 'fecha', clave: 'hasta', etiqueta: 'Hasta' },
        ]} />

        {error ? (
          <Vacio titulo="Todavía no está activado" mensaje="El registro de correos necesita la migración 090 en la base. Avise a sistemas." />
        ) : filas.length === 0 ? (
          <Vacio titulo="Sin correos" mensaje="No hay correos con estos filtros." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-cuadro="correos-enviados">
              <thead>
                <tr><th>Fecha</th><th>Tipo</th><th>Para</th><th>Asunto y contenido</th><th>Enviado por</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {filas.map((c) => {
                  const enlace = enlaceEntidad(c.entidad, c.entidad_id);
                  const adjuntos = (Array.isArray(c.adjuntos) ? c.adjuntos : []) as { nombre?: string; tamano?: number }[];
                  const est = ESTADOS[c.estado] ?? { texto: c.estado, tono: 'atencion' as const };
                  return (
                    <tr key={c.id} data-correo={c.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fechaHora(c.creado_en)}</td>
                      <td>
                        {TIPOS[c.tipo] ?? c.tipo}
                        {enlace && <><br /><Link href={enlace} className="enlace-ficha" style={{ fontSize: '.76rem' }}>Ver registro</Link></>}
                      </td>
                      <td style={{ fontSize: '.78rem', maxWidth: '14rem', wordBreak: 'break-all' }}>
                        {(c.para as string[]).join(', ')}
                        {(c.cc as string[]).length > 0 && <><br /><small style={{ color: 'var(--tinta-3)' }}>cc: {(c.cc as string[]).join(', ')}</small></>}
                      </td>
                      <td style={{ maxWidth: '28rem' }}>
                        <details>
                          <summary style={{ cursor: 'pointer' }}>{c.asunto}</summary>
                          <p style={{ fontSize: '.76rem', color: 'var(--tinta-3)', margin: '.3rem 0' }}>De: {c.remitente}</p>
                          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '.8rem', margin: 0, background: 'var(--superficie-2)', padding: '.5rem', borderRadius: 'var(--radio)' }}>{c.cuerpo}</pre>
                          {adjuntos.length > 0 && (
                            <p style={{ fontSize: '.76rem', margin: '.3rem 0 0' }}>
                              Adjuntos: {adjuntos.map((a) => `${a.nombre} (${Math.max(1, Math.round(Number(a.tamano ?? 0) / 1024))} KB)`).join(', ')}
                            </p>
                          )}
                        </details>
                      </td>
                      <td>{c.enviado_por_nombre}</td>
                      <td>
                        <Etiqueta texto={est.texto} tono={est.tono} />
                        {c.error && <><br /><small style={{ color: 'var(--critico)' }}>{c.error}</small></>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
