/**
 * ============================================================================
 *  AUDITORÍA · quién cambió qué y cuándo
 * ============================================================================
 *  Esta tabla NO la escribe la aplicación: la escriben disparadores dentro de
 *  PostgreSQL. Eso importa porque significa que el registro no depende de que
 *  el programador se acordara de anotarlo: si la fila cambió, quedó registrada.
 *
 *  Nadie —ni siquiera Gerencia— puede modificar ni borrar esta tabla desde el
 *  sistema: no existe política de escritura para ella.
 *
 *  SIN NOMBRES TÉCNICOS (077)
 *  El filtro y la columna «Tabla» decían «dictamenes_calidad» o
 *  «pedido_lineas», y los campos «ruc_tax_id». Ahora salen con el diccionario
 *  central (src/lib/etiquetas.ts). Y donde antes decía «Sistema» a secas, se
 *  dice de dónde vino el cambio: la tarea automática de cada mañana o un
 *  mantenimiento técnico (columna «origen», migración 077). Las filas viejas,
 *  de antes de esa columna, siguen diciendo «Sistema».
 * ============================================================================
 */
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { num, fechaHora } from '@/lib/formato';
import { TABLAS as NOMBRES_TABLA, etiquetaTabla, etiquetaCampo, CAMPOS_SIN_INTERES } from '@/lib/etiquetas';

/** Quién hizo el cambio cuando no hubo una persona con sesión. */
const NOMBRE_ORIGEN: Record<string, string> = {
  tarea_programada: 'Tarea automática diaria',
  servicio: 'Proceso del sistema',
  mantenimiento: 'Mantenimiento técnico',
};

export const metadata: Metadata = { title: 'Auditoría' };
export const dynamic = 'force-dynamic';
const POR_PAGINA = 50;

export default async function PaginaAuditoria(props: PageProps<'/trazabilidad/auditoria'>) {
  const q = await props.searchParams;
  const usuario = await obtenerUsuarioActual();
  if (!['gerencia', 'operaciones'].includes(usuario?.rol ?? '')) redirect('/panel');

  const supabase = await crearClienteServidor();
  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const tabla = (q.tabla as string) ?? '';
  const accion = (q.accion as string) ?? '';

  let consulta = supabase
    .from('auditoria')
    .select('id, tabla, registro_id, accion, campos_cambiados, ocurrido_en, usuario_id, origen', { count: 'exact' })
    /*
     * 078: fuera las filas en las que lo ÚNICO que cambió fue la fecha de
     * actualización. Son «toques» de otros disparadores (una reserva que
     * recalcula su pedido) y hacían que un mismo cambio saliera tres veces.
     * Desde la 078 la base ya no las escribe; las anteriores se dejan de ver.
     */
    .or('campos_cambiados.is.null,campos_cambiados.not.cd."{actualizado_en,actualizado_por}"');
  if (tabla) consulta = consulta.eq('tabla', tabla);
  if (accion) consulta = consulta.eq('accion', accion);

  const [{ data: filas, count }, { data: usuarios }] = await Promise.all([
    consulta.order('ocurrido_en', { ascending: false })
            .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    supabase.from('usuarios').select('id, nombre'),
  ]);

  const nombrePorId = Object.fromEntries((usuarios ?? []).map((u) => [u.id, u.nombre]));

  //  Todas las tablas vigiladas, por su nombre legible y en orden alfabético.
  const TABLAS = Object.keys(NOMBRES_TABLA)
    .sort((a, b) => etiquetaTabla(a).localeCompare(etiquetaTabla(b), 'es'));

  return (
    <>
      <CabeceraPagina
        titulo="Auditoría del sistema"
        descripcion="Cada cambio de datos del sistema: qué se cambió, cuándo y quién. Se anota solo, al guardar, y nadie lo puede alterar."
      />

      <RejillaKpi>
        <Kpi etiqueta="Registros de auditoría" valor={num(count ?? 0)} tono="marca" href="#eventos" />
        <Kpi etiqueta="Tipos de registro vigilados" valor={num(TABLAS.length)} nota="Todos los críticos" href="#eventos" />
        <Kpi etiqueta="Modificable" valor="No" tono="ok" nota="Nadie puede editarla ni borrarla" href="#eventos" />
      </RejillaKpi>

      <Panel id="eventos" titulo={`${num(count ?? 0)} eventos registrados`}>
        <Filtros
          campos={[
            { tipo: 'select', clave: 'tabla', etiqueta: 'Qué se cambió',
              opciones: TABLAS.map((t) => ({ valor: t, texto: etiquetaTabla(t) })) },
            { tipo: 'select', clave: 'accion', etiqueta: 'Acción',
              opciones: [
                { valor: 'INSERT', texto: 'Creación' },
                { valor: 'UPDATE', texto: 'Modificación' },
                { valor: 'DELETE', texto: 'Eliminación' },
              ] },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Sin registros" mensaje="No hay eventos con estos filtros." />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr><th className="num">Momento</th><th>Acción</th><th>Qué se cambió</th><th>Registro</th><th>Campos modificados</th><th>Usuario</th></tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((a) => (
                    <tr key={a.id as number}>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{fechaHora(a.ocurrido_en as string)}</td>
                      <td>
                        <Etiqueta
                          texto={a.accion === 'INSERT' ? 'Creación' : a.accion === 'UPDATE' ? 'Modificación' : 'Eliminación'}
                          tono={a.accion === 'INSERT' ? 'ok' : a.accion === 'UPDATE' ? 'info' : 'critico'}
                        />
                      </td>
                      <td data-celda="tabla">{etiquetaTabla(a.tabla as string)}</td>
                      <td className="mono">#{a.registro_id as string}</td>
                      <td style={{ fontSize: '.74rem', color: 'var(--tinta-3)', maxWidth: '26rem' }}>
                        {Array.isArray(a.campos_cambiados) && a.campos_cambiados.length
                          ? (a.campos_cambiados as string[])
                              .filter((c) => !CAMPOS_SIN_INTERES.has(c) || (a.campos_cambiados as string[]).length === 1)
                              .map(etiquetaCampo).join(', ')
                          : '—'}
                      </td>
                      <td style={{ fontSize: '.78rem' }}>
                        {a.usuario_id
                          ? (nombrePorId[a.usuario_id as string] ?? 'Usuario')
                          : (NOMBRE_ORIGEN[String(a.origen ?? '')] ?? 'Sistema')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={count ?? 0} />
          </>
        )}
      </Panel>

      <p className="pie-explicativo">
        Todo lo que hace una persona queda con su nombre. Lo que no tiene persona detrás dice de
        dónde vino: <strong>Tarea automática diaria</strong> son los procesos de cada mañana (soltar
        reservas vencidas, actualizar el estado de las facturas, revisar las alertas) y{' '}
        <strong>Mantenimiento técnico</strong> son cargas y correcciones hechas por soporte. Los
        registros anteriores a esta distinción dicen <strong>Sistema</strong>.
      </p>
    </>
  );
}
