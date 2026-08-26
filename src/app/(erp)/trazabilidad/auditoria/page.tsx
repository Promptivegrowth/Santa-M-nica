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
 * ============================================================================
 */
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { num, fechaHora } from '@/lib/formato';

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
    .select('id, tabla, registro_id, accion, campos_cambiados, ocurrido_en, usuario_id', { count: 'exact' });
  if (tabla) consulta = consulta.eq('tabla', tabla);
  if (accion) consulta = consulta.eq('accion', accion);

  const [{ data: filas, count }, { data: usuarios }] = await Promise.all([
    consulta.order('ocurrido_en', { ascending: false })
            .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    supabase.from('usuarios').select('id, nombre'),
  ]);

  const nombrePorId = Object.fromEntries((usuarios ?? []).map((u) => [u.id, u.nombre]));

  const TABLAS = ['pedidos', 'pedido_lineas', 'reservas', 'traslados', 'lotes', 'clientes',
                  'dictamenes_calidad', 'facturas', 'parametros', 'movimientos', 'precios'];

  return (
    <>
      <CabeceraPagina
        titulo="Auditoría del sistema"
        descripcion="Registro técnico de cada cambio. Lo escriben disparadores de la base de datos, no la aplicación, y nadie lo puede alterar."
      />

      <RejillaKpi>
        <Kpi etiqueta="Registros de auditoría" valor={num(count ?? 0)} tono="marca" />
        <Kpi etiqueta="Tablas vigiladas" valor={num(TABLAS.length + 8)} nota="Todas las críticas" />
        <Kpi etiqueta="Modificable" valor="No" tono="ok" nota="Sin política de escritura" />
      </RejillaKpi>

      <Panel titulo={`${num(count ?? 0)} eventos registrados`}>
        <Filtros
          campos={[
            { tipo: 'select', clave: 'tabla', etiqueta: 'Tabla',
              opciones: TABLAS.map((t) => ({ valor: t, texto: t })) },
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
                  <tr><th className="num">Momento</th><th>Acción</th><th>Tabla</th><th>Registro</th><th>Campos modificados</th><th>Usuario</th></tr>
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
                      <td className="mono">{a.tabla as string}</td>
                      <td className="mono">#{a.registro_id as string}</td>
                      <td style={{ fontSize: '.74rem', color: 'var(--tinta-3)', maxWidth: '26rem' }}>
                        {Array.isArray(a.campos_cambiados) && a.campos_cambiados.length
                          ? (a.campos_cambiados as string[]).join(', ')
                          : '—'}
                      </td>
                      <td style={{ fontSize: '.78rem' }}>
                        {a.usuario_id ? (nombrePorId[a.usuario_id as string] ?? 'Usuario') : 'Sistema'}
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
        Los registros marcados como <strong>Sistema</strong> corresponden a operaciones ejecutadas
        por procesos internos (por ejemplo, el sembrado inicial de datos o la expiración automática
        de reservas), que no tienen una sesión de usuario asociada.
      </p>
    </>
  );
}
