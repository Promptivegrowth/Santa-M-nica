/**
 * ============================================================================
 *  CONFIGURACIÓN
 * ============================================================================
 *  Instrucción explícita del cliente: "todo debería ser configurable y las
 *  funciones deben estar activas para que el cliente lo modifique dentro de los
 *  flujos a su gusto".
 *
 *  Por eso NINGÚN umbral, plazo, capacidad o porcentaje del sistema está
 *  escrito en el código: todos viven en la tabla `parametros` y se editan
 *  desde aquí. El cambio surte efecto de inmediato en todas las pantallas.
 *
 *  Ejemplo real: si se baja el umbral de anticuamiento de 12 a 9 meses, en el
 *  siguiente refresco el reporte de antigüedad y las alertas ya usan 9.
 * ============================================================================
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { EditorParametro } from './EditorParametro';
import { InterruptorRegla } from './InterruptorRegla';
import { num, fechaHora } from '@/lib/formato';
import type { Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Configuración' };
export const dynamic = 'force-dynamic';

const PESTANAS = [
  { clave: 'parametros', titulo: 'Parámetros del negocio' },
  { clave: 'reglas',     titulo: 'Motor de reglas' },
  { clave: 'motivos',    titulo: 'Motivos tipificados' },
  { clave: 'maestros',   titulo: 'Maestros' },
  { clave: 'usuarios',   titulo: 'Usuarios y roles' },
];

const NOMBRE_GRUPO: Record<string, string> = {
  inventario: 'Inventario y vida útil',
  comercial: 'Comercial y precios',
  logistica: 'Logística y despacho',
  empresa: 'Datos de la empresa',
  sistema: 'Sistema',
  general: 'General',
};

export default async function PaginaConfiguracion(props: PageProps<'/configuracion'>) {
  const q = await props.searchParams;
  const pestana = (q.t as string) ?? 'parametros';

  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;
  if (!['gerencia', 'operaciones'].includes(rol)) redirect('/panel');

  const supabase = await crearClienteServidor();
  const [{ data: parametros }, { data: reglas }, { data: motivos }, { data: usuarios }, { data: maestros }] =
    await Promise.all([
      supabase.from('parametros').select('*').order('grupo').order('etiqueta'),
      supabase.from('reglas').select('*').order('severidad', { ascending: false }).order('nombre'),
      supabase.from('motivos').select('*').order('ambito').order('nombre'),
      supabase.from('usuarios').select('id, nombre, email, rol, activo, creado_en').order('rol'),
      Promise.all([
        supabase.from('almacenes').select('id', { count: 'exact', head: true }),
        supabase.from('skus').select('id', { count: 'exact', head: true }),
        supabase.from('clientes').select('id', { count: 'exact', head: true }),
        supabase.from('destinos').select('id', { count: 'exact', head: true }),
        supabase.from('vehiculos').select('id', { count: 'exact', head: true }),
        supabase.from('listas_precio').select('id', { count: 'exact', head: true }),
      ]).then(([a, s, c, d, v, l]) => ({
        data: {
          almacenes: a.count ?? 0, skus: s.count ?? 0, clientes: c.count ?? 0,
          destinos: d.count ?? 0, vehiculos: v.count ?? 0, listas: l.count ?? 0,
        },
      })),
    ]);

  /* ---- Parámetros agrupados por área del negocio ---- */
  const porGrupo = new Map<string, typeof parametros>();
  for (const p of parametros ?? []) {
    const g = (p.grupo as string) ?? 'general';
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g)!.push(p);
  }

  /* ---- Motivos agrupados por ámbito ---- */
  const porAmbito = new Map<string, typeof motivos>();
  for (const m of motivos ?? []) {
    const a = m.ambito as string;
    if (!porAmbito.has(a)) porAmbito.set(a, []);
    porAmbito.get(a)!.push(m);
  }

  return (
    <>
      <CabeceraPagina
        titulo="Configuración"
        descripcion="Todo lo que gobierna el comportamiento del sistema se edita aquí. Ningún umbral ni plazo está escrito en el código."
      />

      <nav className="pestanas no-imprimir" aria-label="Secciones de configuración">
        {PESTANAS.map((p) => (
          <Link key={p.clave} href={`/configuracion?t=${p.clave}`} className="pestana"
                data-activa={pestana === p.clave ? 'si' : 'no'}>{p.titulo}</Link>
        ))}
      </nav>

      {/* ══════ PARÁMETROS ══════ */}
      {pestana === 'parametros' && (
        <>
          {[...porGrupo.entries()].map(([grupo, lista]) => (
            <Panel key={grupo} titulo={NOMBRE_GRUPO[grupo] ?? grupo} className="mb-espacio">
              <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                <table className="datos">
                  <thead>
                    <tr><th>Parámetro</th><th>Qué controla</th><th style={{ width: '15rem' }}>Valor</th><th>Última modificación</th></tr>
                  </thead>
                  <tbody>
                    {(lista ?? []).map((p) => (
                      <tr key={p.clave as string}>
                        <td>
                          <strong style={{ fontWeight: 600 }}>{p.etiqueta as string}</strong>
                          <br />
                          <code style={{ fontSize: '.66rem', color: 'var(--tinta-3)' }}>{p.clave as string}</code>
                        </td>
                        <td style={{ fontSize: '.79rem', color: 'var(--tinta-2)', maxWidth: '34rem' }}>
                          {(p.descripcion as string) ?? '—'}
                        </td>
                        <td>
                          <EditorParametro
                            clave={p.clave as string}
                            valorInicial={String(p.valor)}
                            tipo={p.tipo_dato as string}
                            unidad={p.unidad as string | null}
                            editable={rol === 'gerencia' || p.editable_por === 'operaciones'}
                          />
                        </td>
                        <td style={{ fontSize: '.72rem', color: 'var(--tinta-3)' }}>
                          {fechaHora(p.actualizado_en as string)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}

          <p className="pie-explicativo">
            <strong>Pruébelo:</strong> cambie el <em>umbral de anticuamiento</em> de 12 a 6 meses y
            abra el reporte de <Link href="/almacenes/anticuamiento">Anticuamiento</Link>. Verá que
            la cantidad de lotes en alerta cambia de inmediato, sin desplegar nada.
          </p>
        </>
      )}

      {/* ══════ REGLAS ══════ */}
      {pestana === 'reglas' && (
        <Panel titulo={`${(reglas ?? []).length} reglas configuradas`}>
          <p className="pie-explicativo" style={{ padding: '.9rem 1rem 0' }}>
            Cada regla vigila una condición del negocio y genera alertas cuando se cumple.
            Se pueden activar y desactivar sin tocar código.
          </p>
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0, marginTop: '.7rem' }}>
            <table className="datos">
              <thead>
                <tr><th>Regla</th><th>Qué vigila</th><th>Sobre</th><th>Severidad</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {(reglas ?? []).map((r) => (
                  <tr key={r.id as number}>
                    <td><strong style={{ fontWeight: 600 }}>{r.nombre as string}</strong></td>
                    <td style={{ fontSize: '.79rem', color: 'var(--tinta-2)', maxWidth: '32rem' }}>
                      {(r.descripcion as string) ?? '—'}
                      <br />
                      <code style={{ fontSize: '.66rem', color: 'var(--tinta-3)' }}>
                        {JSON.stringify(r.condicion)}
                      </code>
                    </td>
                    <td className="mono">{r.entidad as string}</td>
                    <td>
                      <Etiqueta
                        texto={r.severidad === 'critica' ? 'Crítica' : r.severidad === 'advertencia' ? 'Advertencia' : 'Info'}
                        tono={r.severidad === 'critica' ? 'critico' : r.severidad === 'advertencia' ? 'atencion' : 'info'}
                      />
                    </td>
                    <td>
                      <InterruptorRegla id={r.id as number} activaInicial={r.activa as boolean} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* ══════ MOTIVOS ══════ */}
      {pestana === 'motivos' && (
        <>
          <p className="pie-explicativo" style={{ marginBottom: '.85rem' }}>
            Los motivos evitan el texto libre. Cuando alguien registra un ajuste o bloquea un lote,
            elige de esta lista: así los reportes agrupan bien y se puede medir <em>por qué</em>
            ocurren las cosas. Los marcados como <strong>requiere autorización</strong> exigen la
            firma de un rol superior.
          </p>
          {[...porAmbito.entries()].map(([ambito, lista]) => (
            <Panel key={ambito} titulo={ambito.replace('_', ' ')} className="mb-espacio">
              <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                <table className="datos">
                  <thead><tr><th>Código</th><th>Nombre</th><th>Autorización</th><th>Estado</th></tr></thead>
                  <tbody>
                    {(lista ?? []).map((m) => (
                      <tr key={m.id as number}>
                        <td className="mono">{m.codigo as string}</td>
                        <td>{m.nombre as string}</td>
                        <td>
                          {m.requiere_autorizacion
                            ? <Etiqueta texto="Requiere autorización" tono="atencion" />
                            : <span style={{ color: 'var(--tinta-3)', fontSize: '.78rem' }}>Libre</span>}
                        </td>
                        <td>
                          {m.activo ? <Etiqueta texto="Activo" tono="ok" /> : <Etiqueta texto="Inactivo" tono="neutro" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
        </>
      )}

      {/* ══════ MAESTROS ══════ */}
      {pestana === 'maestros' && (
        <Panel titulo="Catálogos del sistema">
          <div className="rejilla-maestros">
            {[
              { titulo: 'Almacenes', cantidad: maestros?.almacenes, ruta: '/almacenes/existencias', desc: 'Bodegas propias y de terceros, con su capacidad.' },
              { titulo: 'Productos (SKU)', cantidad: maestros?.skus, ruta: '/ventas/disponibilidad', desc: 'Catálogo completo con especie, formato y corte.' },
              { titulo: 'Clientes', cantidad: maestros?.clientes, ruta: '/ventas/clientes', desc: 'Cartera con línea de crédito y condición de pago.' },
              { titulo: 'Destinos', cantidad: maestros?.destinos, ruta: '/logistica/embarques', desc: 'Puertos de destino y su país.' },
              { titulo: 'Vehículos', cantidad: maestros?.vehiculos, ruta: '/logistica/planificador', desc: 'Flota con SOAT y revisión técnica.' },
              { titulo: 'Listas de precio', cantidad: maestros?.listas, ruta: '/ventas/cotizaciones', desc: 'Tarifarios con vigencia y escalas por volumen.' },
            ].map((m) => (
              <Link key={m.titulo} href={m.ruta} className="tarjeta-maestro">
                <span className="tarjeta-maestro-cifra">{num(m.cantidad ?? 0)}</span>
                <strong>{m.titulo}</strong>
                <span className="tarjeta-maestro-desc">{m.desc}</span>
              </Link>
            ))}
          </div>
        </Panel>
      )}

      {/* ══════ USUARIOS ══════ */}
      {pestana === 'usuarios' && (
        <Panel titulo={`${(usuarios ?? []).length} usuarios del sistema`}>
          {(usuarios ?? []).length === 0 ? (
            <Vacio titulo="Sin usuarios" mensaje="No hay usuarios registrados." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Alta</th></tr></thead>
                <tbody>
                  {(usuarios ?? []).map((u) => (
                    <tr key={u.id as string}>
                      <td><strong style={{ fontWeight: 600 }}>{u.nombre as string}</strong></td>
                      <td className="mono">{u.email as string}</td>
                      <td><Etiqueta texto={u.rol as string} tono="info" /></td>
                      <td>{u.activo ? <Etiqueta texto="Activo" tono="ok" /> : <Etiqueta texto="Inactivo" tono="neutro" />}</td>
                      <td style={{ fontSize: '.74rem', color: 'var(--tinta-3)' }}>{fechaHora(u.creado_en as string)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="pie-explicativo" style={{ padding: '.9rem 1rem 1rem' }}>
            El rol de cada usuario gobierna sus permisos <strong>dentro de la base de datos</strong>,
            no solo en la pantalla. Aunque alguien manipulara el navegador, PostgreSQL rechazaría la
            operación que no le corresponde.
          </p>
        </Panel>
      )}
    </>
  );
}
