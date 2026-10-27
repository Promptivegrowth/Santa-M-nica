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
import { SubirFirma } from './SubirFirma';
import { InterruptorAprobador } from './InterruptorAprobador';
import { InterruptorObjetivos } from './InterruptorObjetivos';
import { InterruptorCostos } from './InterruptorCostos';
import { InterruptorRegla } from './InterruptorRegla';
import { ContactosYCuentas } from './ContactosYCuentas';
import { NuevoUsuario, SelectorRol, AccesoUsuario } from './GestionUsuarios';
import { GestionVendedores, type FilaVendedor } from './GestionVendedores';
//  074 · Almacenes se edita aquí (qué recibe cada uno, alta, desactivar).
import { GestionAlmacenes, type FilaAlmacen } from './GestionAlmacenes';
import { cargarAlmacenes } from './datosAlmacenes';
import { Icono } from '@/components/estructura/Icono';
import { num, fecha, fechaHora } from '@/lib/formato';
import { etiquetaClave } from '@/lib/etiquetas';
import { NOMBRE_ROL, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Configuración' };
export const dynamic = 'force-dynamic';

const PESTANAS = [
  { clave: 'parametros', titulo: 'Parámetros del negocio' },
  { clave: 'reglas',     titulo: 'Motor de reglas' },
  { clave: 'motivos',    titulo: 'Motivos tipificados' },
  { clave: 'maestros',   titulo: 'Maestros' },
  { clave: 'contactos',  titulo: 'Contactos y cuentas' },
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

/**
 * Los siete catálogos del sistema.
 *
 * Dos de ellos ya tienen pantalla propia —Clientes es una cartera completa y
 * Vehículos es la Flota, con el estado de sus documentos—, así que su tarjeta
 * lleva allí en vez de repetir una tabla peor. Los otros cuatro se abren aquí
 * mismo: son maestros pequeños que nadie consulta a diario y no justifican una
 * entrada propia en el menú.
 */
type Catalogo =
  /** Ya tiene pantalla propia: la tarjeta solo lleva allí. */
  | { clave: string; titulo: string; desc: string; ruta: string }
  /** Se abre aquí mismo, leyendo la tabla que se indique. */
  | { clave: string; titulo: string; desc: string; tabla: string; columnas: string; orden: string };

const CATALOGOS: Catalogo[] = [
  {
    clave: 'almacenes', titulo: 'Almacenes',
    desc: 'Bodegas propias y de terceros: capacidad y si reciben producción o compras. Se editan aquí.',
    tabla: 'almacenes',
    columnas: 'id, codigo, nombre, tipo, operador, ciudad, capacidad_tm, despachos_dia_max, activo',
    orden: 'codigo',
  },
  {
    clave: 'skus', titulo: 'Productos (SKU)',
    desc: 'Catálogo completo con especie, formato y corte.',
    tabla: 'skus',
    columnas: 'id, codigo, especies(nombre), formatos(nombre), corte, activo',
    orden: 'codigo',
  },
  {
    clave: 'clientes', titulo: 'Clientes',
    desc: 'Cartera con línea de crédito y condición de pago.',
    ruta: '/ventas/clientes',
  },
  {
    clave: 'destinos', titulo: 'Destinos',
    desc: 'Puertos de destino y su país.',
    tabla: 'destinos',
    columnas: 'id, puerto, pais, activo',
    orden: 'puerto',
  },
  {
    clave: 'vehiculos', titulo: 'Vehículos',
    desc: 'Flota con SOAT y revisión técnica.',
    ruta: '/logistica/flota',
  },
  {
    clave: 'listas', titulo: 'Listas de precio',
    desc: 'Tarifarios con vigencia y escalas por volumen.',
    tabla: 'listas_precio',
    columnas: 'id, nombre, moneda, incoterm, vigente_desde, vigente_hasta, activo',
    orden: 'nombre',
  },
  /*
   * El único catálogo de esta pestaña que se EDITA aquí mismo (alta, cambios,
   * desactivar y borrar): antes los vendedores solo se cargaban por base de
   * datos. Su tabla la dibuja GestionVendedores, no la tabla genérica.
   */
  {
    clave: 'vendedores', titulo: 'Vendedores',
    desc: 'Venta directa e intermediarios que traen al cliente. Se editan aquí.',
    tabla: 'vendedores',
    columnas: 'id, nombre, tipo, email, activo',
    orden: 'nombre',
  },
];

/** Los ámbitos del maestro de motivos, dichos para el usuario. */
const NOMBRE_AMBITO: Record<string, string> = {
  ingreso: 'Ingreso a cámara',
  salida: 'Salida de cámara',
  ajuste: 'Ajustes de stock',
  bloqueo: 'Dictámenes de calidad (observación y bloqueo)',
  liberacion_reserva: 'Liberación de reservas',
};

/** Signo de una condición, en palabras. */
const SIGNO: Record<string, string> = { '>': 'más de', '>=': 'desde', '<': 'menos de', '<=': 'hasta', '=': 'igual a' };

/** Lo que mide cada regla, en palabras, y en qué unidad. */
const MEDIDA: Record<string, { texto: string; unidad: string }> = {
  meses_almacenado: { texto: 'Meses en cámara', unidad: 'meses' },
  dias_para_vencer: { texto: 'Días para que venza la reserva', unidad: 'días' },
  dias_sin_movimiento: { texto: 'Días sin movimiento', unidad: 'días' },
  margen_pct: { texto: 'Margen del pedido', unidad: '%' },
  dias_vencida: { texto: 'Días vencida', unidad: 'días' },
  dias_en_transito: { texto: 'Días en tránsito', unidad: 'días' },
};

/** Convierte nombre_de_columna en «Nombre de columna». */
function etiquetaColumna(clave: string): string {
  const texto = clave.replace(/_/g, ' ').replace(/\bid\b/g, '').trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Pinta un valor suelto sin saber de antemano de qué tipo es.
 *
 * Es lo que permite que la tabla de catálogos sirva para los cuatro sin
 * escribir cuatro tablas: se le da un dato y devuelve algo legible.
 */
function celda(valor: unknown): React.ReactNode {
  if (valor === null || valor === undefined || valor === '') return '—';

  if (typeof valor === 'boolean') {
    return <Etiqueta texto={valor ? 'Activo' : 'Inactivo'} tono={valor ? 'ok' : 'neutro'} />;
  }

  // Las fechas llegan como texto ISO; se muestran en el formato de aquí.
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) return fecha(valor);

  if (typeof valor === 'number') return num(valor, Number.isInteger(valor) ? 0 : 1);

  /*
   * Una relación llega como objeto —{ nombre: 'Pota' }— o como lista de ellos.
   * Se aplanan a sus valores para que la celda diga «Pota» y no
   * «[object Object]», que fue justo lo que apareció al probarlo.
   */
  if (Array.isArray(valor)) return valor.map(celda).filter((v) => v !== '—').join(' · ') || '—';
  if (typeof valor === 'object') {
    const dentro = Object.values(valor as Record<string, unknown>)
      .filter((v) => v !== null && typeof v !== 'object');
    return dentro.length ? dentro.join(' · ') : '—';
  }

  return String(valor);
}

export default async function PaginaConfiguracion(props: PageProps<'/configuracion'>) {
  const q = await props.searchParams;
  const pestana = (q.t as string) ?? 'parametros';
  // Qué catálogo está abierto dentro de la pestaña de Maestros.
  const catalogo = (q.m as string) ?? '';

  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;
  if (!['gerencia', 'operaciones'].includes(rol)) redirect('/panel');

  const supabase = await crearClienteServidor();
  const [{ data: parametros }, { data: reglas }, { data: motivos }, { data: usuarios }, { data: maestros }] =
    await Promise.all([
      supabase.from('parametros').select('*').order('grupo').order('etiqueta'),
      supabase.from('reglas').select('*').order('severidad', { ascending: false }).order('nombre'),
      supabase.from('motivos').select('*').order('ambito').order('nombre'),
      supabase.from('usuarios').select('id, nombre, email, rol, almacen_id, activo, aprueba_cotizaciones, ve_objetivos, carga_costos, debe_cambiar_clave, creado_en').order('activo', { ascending: false }).order('rol').order('nombre'),
      Promise.all([
        supabase.from('almacenes').select('id', { count: 'exact', head: true }),
        supabase.from('skus').select('id', { count: 'exact', head: true }),
        supabase.from('clientes').select('id', { count: 'exact', head: true }),
        supabase.from('destinos').select('id', { count: 'exact', head: true }),
        supabase.from('vehiculos').select('id', { count: 'exact', head: true }),
        supabase.from('listas_precio').select('id', { count: 'exact', head: true }),
        supabase.from('vendedores').select('id', { count: 'exact', head: true }),
      ]).then(([a, s, c, d, v, l, ve]) => ({
        data: {
          almacenes: a.count ?? 0, skus: s.count ?? 0, clientes: c.count ?? 0,
          destinos: d.count ?? 0, vehiculos: v.count ?? 0, listas: l.count ?? 0,
          vendedores: ve.count ?? 0,
        },
      })),
    ]);

  /* ----------------------------------------------------------------------
     Lo que solo necesitan dos pestañas: la última pasada del evaluador de
     reglas y los almacenes (para el rol Almacén de un usuario).
     ---------------------------------------------------------------------- */
  const [{ data: evaluacion }, { data: almacenesBd }] = await Promise.all([
    pestana === 'reglas'
      ? supabase.from('reglas_evaluacion').select('regla_id, evaluada_en, abiertas, medible')
      : Promise.resolve({ data: null }),
    pestana === 'usuarios'
      ? supabase.from('almacenes').select('id, nombre').eq('activo', true).order('nombre')
      : Promise.resolve({ data: null }),
  ]);
  const evalPorRegla = new Map(
    ((evaluacion ?? []) as { regla_id: number; evaluada_en: string; abiertas: number; medible: boolean }[])
      .map((e) => [Number(e.regla_id), e])
  );
  const almacenes = ((almacenesBd ?? []) as { id: number; nombre: string }[]).map((x) => ({ id: Number(x.id), nombre: String(x.nombre) }));

  /* ----------------------------------------------------------------------
     Contactos y cuentas.

     Solo se piden si se está en su pestaña: son 178 contactos y no tiene
     sentido traerlos para cambiar un umbral de anticuamiento.
     ---------------------------------------------------------------------- */
  const [{ data: contactosBd }, { data: cuentasBd }, { data: clientesBd }] =
    pestana === 'contactos'
      ? await Promise.all([
          supabase
            .from('contactos')
            .select('id, cliente_id, nombre, cargo, telefono, email, principal, activo, clientes(razon_social)')
            .order('cliente_id')
            .order('principal', { ascending: false })
            .limit(500),
          supabase
            .from('cuentas_bancarias')
            .select('*')
            .order('activo', { ascending: false })
            .order('principal', { ascending: false })
            .order('banco'),
          supabase.from('clientes').select('id, razon_social').eq('activo', true).order('razon_social'),
        ])
      : [{ data: null }, { data: null }, { data: null }];

  /* ----------------------------------------------------------------------
     Filas del catálogo abierto.

     Solo se piden si hace falta: entrar a Configuración a cambiar un umbral
     no tiene por qué traerse los 191 productos.
     ---------------------------------------------------------------------- */
  const abierto = CATALOGOS.find((c) => c.clave === catalogo && 'tabla' in c);

  /*
   * El `select` se arma con una cadena que sale de CATALOGOS, no de un literal,
   * asi que Supabase no puede deducir la forma de la respuesta y la deja en su
   * tipo generico. Se declara aqui lo que de verdad llega —filas con claves de
   * texto— porque la tabla de abajo se dibuja recorriendo esas claves.
   */
  let filasCatalogo: Record<string, unknown>[] = [];

  /*
   * Vendedores: además de sus datos, cuántas veces se usó cada uno. Decide si
   * se puede borrar (nunca usado) o solo desactivar.
   */
  let filasVendedores: FilaVendedor[] = [];
  if (pestana === 'maestros' && catalogo === 'vendedores') {
    const { data: vend } = await supabase.from('vendedores').select('id, nombre, tipo, email, activo')
      .order('activo', { ascending: false }).order('nombre');
    const contar = async (tabla: 'clientes' | 'cotizaciones' | 'pedidos', id: number) =>
      (await supabase.from(tabla).select('id', { count: 'exact', head: true }).eq('vendedor_id', id)).count ?? 0;
    filasVendedores = await Promise.all((vend ?? []).map(async (v) => {
      const [clientes, cotizaciones, pedidos] = await Promise.all([
        contar('clientes', v.id as number), contar('cotizaciones', v.id as number), contar('pedidos', v.id as number),
      ]);
      return {
        id: v.id as number, nombre: v.nombre as string, tipo: v.tipo as FilaVendedor['tipo'],
        email: (v.email as string) ?? null, activo: Boolean(v.activo), clientes, cotizaciones, pedidos,
      };
    }));
  }

  let filasAlmacenes: FilaAlmacen[] = [];
  if (pestana === 'maestros' && catalogo === 'almacenes') filasAlmacenes = await cargarAlmacenes(supabase);

  if (pestana === 'maestros' && abierto && 'tabla' in abierto && catalogo !== 'vendedores' && catalogo !== 'almacenes') {
    const { data } = await supabase
      .from(abierto.tabla).select(abierto.columnas).order(abierto.orden).limit(300);
    filasCatalogo = (data ?? []) as unknown as Record<string, unknown>[];
  }

  /*
   * Las columnas se deducen del contenido en vez de declararse a mano: si el
   * día de mañana un catálogo gana un campo, sale solo.
   *
   * Se toma la UNIÓN de las claves de todas las filas, no las de la primera.
   * Si la primera fila tuviera vacío un campo que las demás rellenan, mirando
   * solo a esa se perdería la columna entera.
   *
   * Se descarta el identificador, que no le dice nada a nadie. Las relaciones
   * —la especie de un SKU, por ejemplo— sí se quedan: son justo lo que hace
   * legible el catálogo, y celda() sabe aplanarlas.
   */
  const columnasCatalogo = [
    ...filasCatalogo.reduce((claves, fila) => {
      for (const k of Object.keys(fila)) if (k !== 'id') claves.add(k);
      return claves;
    }, new Set<string>()),
  ];

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
                          {/*
                            Quién lo cambia, dicho igual para todos: «comercial»
                            ya no aparece (Comercial no entra a Configuración;
                            077 pasó esos parámetros a Operaciones).
                          */}
                          <span style={{ fontSize: '.68rem', color: 'var(--tinta-3)' }} data-quien={p.clave as string}>
                            {p.editable_por === 'gerencia' ? 'Lo cambia solo Gerencia' : 'Lo cambian Gerencia y Operaciones'}
                          </span>
                          <br />
                          <code style={{ fontSize: '.62rem', color: 'var(--tinta-3)' }}>{p.clave as string}</code>
                        </td>
                        <td style={{ fontSize: '.79rem', color: 'var(--tinta-2)', maxWidth: '34rem' }}>
                          {(p.descripcion as string) ?? '—'}
                        </td>
                        <td>
                          {/*
                            La firma escaneada no se teclea: se sube. Un campo
                            de texto con treinta kilobytes de imagen dentro no
                            se puede ni leer ni corregir.
                          */}
                          {p.clave === 'firmante_firma' || p.clave === 'firmante_firma_contrato' ? (
                            <SubirFirma
                              clave={p.clave as 'firmante_firma' | 'firmante_firma_contrato'}
                              valorInicial={String(p.valor ?? '')}
                              editable={rol === 'gerencia'}
                            />
                          ) : (
                          <EditorParametro
                            clave={p.clave as string}
                            valorInicial={String(p.valor)}
                            tipo={p.tipo_dato as string}
                            unidad={p.unidad as string | null}
                            editable={rol === 'gerencia' || p.editable_por === 'operaciones'}
                          />
                          )}
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
            <strong>Pruébelo:</strong> cambie la <em>Alerta de anticuamiento</em> de 12 a 6 meses y
            abra el reporte de <Link href="/almacenes/anticuamiento">Anticuamiento</Link>. Verá que
            la cantidad de lotes en alerta cambia de inmediato, sin desplegar nada. Los parámetros que
            son el umbral de una regla (anticuamiento, vida útil, aviso de la reserva y margen mínimo)
            cambian también esa regla en el acto: ver <Link href="/configuracion?t=reglas">Motor de reglas</Link>.
          </p>
        </>
      )}

      {/* ══════ REGLAS ══════ */}
      {pestana === 'reglas' && (
        <Panel titulo={`${(reglas ?? []).length} reglas configuradas`}>
          <p className="pie-explicativo" style={{ padding: '.9rem 1rem 0' }}>
            Cada regla vigila una condición del negocio y abre una alerta por cada registro que la
            cumple. El sistema las revisa <strong>cada mañana</strong> y <strong>al mover el
            interruptor</strong>: al apagar una regla se cierran sus alertas abiertas; al encenderla
            se abren las que correspondan. Una alerta que alguien marcó como atendida (botón{' '}
            <strong>Marcar como atendida</strong> en <Link href="/alertas">Alertas</Link>) no se vuelve a
            abrir para el mismo registro. Cuando el umbral de una regla es un parámetro del negocio, se
            cambia en <Link href="/configuracion?t=parametros">Parámetros del negocio</Link>: es un solo
            número, el mismo para la regla y para las pantallas.
          </p>
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0, marginTop: '.7rem' }}>
            <table className="datos">
              <thead>
                <tr><th>Regla</th><th>Qué vigila</th><th>Sobre</th><th>Severidad</th><th className="num">Alertas abiertas</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {(reglas ?? []).map((r) => (
                  <tr key={r.id as number}>
                    <td><strong style={{ fontWeight: 600 }}>{r.nombre as string}</strong></td>
                    <td style={{ fontSize: '.79rem', color: 'var(--tinta-2)', maxWidth: '32rem' }}>
                      {(r.descripcion as string) ?? '—'}
                      <br />
                      {(() => {
                        /*
                         * La condición en palabras, con el umbral que de verdad
                         * usa la regla. Si sale de un parámetro, se dice cuál:
                         * antes se veía el JSON con un 8 fijo mientras el
                         * parámetro decía otra cosa.
                         */
                        const c = (r.condicion ?? {}) as { campo?: string; operador?: string; valor?: number | string; parametro?: string };
                        const medida = MEDIDA[c.campo ?? ''] ?? { texto: c.campo ?? '—', unidad: '' };
                        const par = c.parametro ? (parametros ?? []).find((p) => p.clave === c.parametro) : null;
                        const umbral = par ? String(par.valor) : String(c.valor ?? '—');
                        return (
                          <span style={{ fontSize: '.72rem', color: 'var(--tinta-3)' }} data-umbral-regla={r.id as number}>
                            Condición: {medida.texto.toLowerCase()} {SIGNO[c.operador ?? ''] ?? c.operador}{' '}
                            <strong>{umbral}{medida.unidad === '%' ? ' %' : ` ${medida.unidad}`}</strong>
                            {par
                              ? <> · umbral del parámetro <Link href="/configuracion?t=parametros" className="enlace-dato">«{String(par.etiqueta)}»</Link></>
                              : ' · umbral propio de esta regla'}
                          </span>
                        );
                      })()}
                    </td>
                    <td>{etiquetaClave(r.entidad === 'lote' ? 'pallet' : (r.entidad as string))}</td>
                    <td>
                      <Etiqueta
                        texto={r.severidad === 'critica' ? 'Crítica' : r.severidad === 'advertencia' ? 'Advertencia' : 'Info'}
                        tono={r.severidad === 'critica' ? 'critico' : r.severidad === 'advertencia' ? 'atencion' : 'info'}
                      />
                    </td>
                    <td className="num" data-regla-abiertas={r.id as number}>
                      {(() => {
                        const ev = evalPorRegla.get(Number(r.id));
                        if (!ev) return <span style={{ color: 'var(--tinta-3)' }}>Sin evaluar</span>;
                        return (
                          <>
                            <Link href={`/alertas?titulo=${encodeURIComponent(String(r.nombre))}`} className="enlace-dato">
                              {num(ev.abiertas)}
                            </Link>
                            <br />
                            <span style={{ fontSize: '.68rem', color: 'var(--tinta-3)' }}>
                              {ev.medible ? `revisada ${fechaHora(ev.evaluada_en)}` : 'el sistema no sabe medir este campo'}
                            </span>
                          </>
                        );
                      })()}
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
            <Panel key={ambito} titulo={NOMBRE_AMBITO[ambito] ?? etiquetaClave(ambito)} className="mb-espacio">
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
        <>
          <Panel titulo="Catálogos del sistema" className="mb-espacio">
            <div className="rejilla-maestros">
              {CATALOGOS.map((m) => {
                const cantidad = maestros?.[m.clave as keyof typeof maestros] ?? 0;
                const activa = m.clave === catalogo && 'tabla' in m;
                const href = 'ruta' in m ? m.ruta : `/configuracion?t=maestros&m=${m.clave}`;
                return (
                  <Link
                    key={m.clave}
                    href={href}
                    className="tarjeta-maestro"
                    data-activa={activa ? 'si' : undefined}
                  >
                    <span className="tarjeta-maestro-cifra">{num(cantidad)}</span>
                    <strong>{m.titulo}</strong>
                    <span className="tarjeta-maestro-desc">{m.desc}</span>
                    <span className="tarjeta-maestro-pie">
                      {'ruta' in m ? 'Abrir su pantalla' : activa ? 'Viendo este catálogo' : m.clave === 'vendedores' || m.clave === 'almacenes' ? 'Ver y editar' : 'Ver el catálogo'}
                      <Icono nombre="expandir" tamano={12} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </Panel>

          {catalogo === 'vendedores' ? (
            <GestionVendedores filas={filasVendedores} editable={['gerencia', 'operaciones'].includes(rol)} />
          ) : catalogo === 'almacenes' ? (
            <GestionAlmacenes filas={filasAlmacenes} editable={['gerencia', 'operaciones'].includes(rol)} />
          ) : !abierto ? (
            <Panel>
              <Vacio
                titulo="Elija un catálogo"
                mensaje="Pulse cualquiera de las tarjetas de arriba para ver su contenido. Clientes y Vehículos tienen pantalla propia, con más detalle del que cabe aquí."
              />
            </Panel>
          ) : (
            <Panel titulo={`${abierto.titulo} · ${filasCatalogo.length} registros`}>
              {filasCatalogo.length === 0 ? (
                <Vacio titulo="Catálogo vacío" mensaje="No hay registros en este catálogo." />
              ) : (
                <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                  <table className="datos">
                    <thead>
                      <tr>
                        {columnasCatalogo.map((k) => <th key={k}>{etiquetaColumna(k)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {filasCatalogo.map((fila, i) => (
                        <tr key={(fila.id as number) ?? i}>
                          {/*
                            Se recorre SIEMPRE la misma lista de columnas, no las
                            claves de cada fila. Una fila con un campo vacío tiene
                            que dejar la celda en blanco, no saltársela: si se la
                            salta, todo lo que viene detrás se corre una columna.
                          */}
                          {columnasCatalogo.map((k) => (
                            <td key={k} className={typeof fila[k] === 'number' ? 'num' : undefined}>
                              {celda(fila[k])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
        </>
      )}

      {/* ══════ CONTACTOS Y CUENTAS ══════ */}
      {pestana === 'contactos' && (
        <ContactosYCuentas
          contactos={(contactosBd ?? []).map((c) => {
            const cli = Array.isArray(c.clientes) ? c.clientes[0] : c.clientes;
            return {
              id: c.id as number,
              cliente_id: c.cliente_id as number,
              nombre: c.nombre as string,
              cargo: (c.cargo as string) ?? null,
              telefono: (c.telefono as string) ?? null,
              email: (c.email as string) ?? null,
              principal: Boolean(c.principal),
              activo: Boolean(c.activo),
              cliente: String(cli?.razon_social ?? '—'),
            };
          })}
          cuentas={(cuentasBd ?? []).map((c) => ({
            id: c.id as number,
            banco: c.banco as string,
            tipo: c.tipo as 'corriente' | 'ahorros' | 'detraccion',
            moneda: c.moneda as 'USD' | 'PEN',
            numero: c.numero as string,
            cci: (c.cci as string) ?? null,
            swift: (c.swift as string) ?? null,
            titular: (c.titular as string) ?? null,
            principal: Boolean(c.principal),
            activo: Boolean(c.activo),
            observaciones: (c.observaciones as string) ?? null,
          }))}
          clientes={(clientesBd ?? []).map((c) => ({
            id: c.id as number,
            nombre: c.razon_social as string,
          }))}
          puedeContactos={['gerencia', 'operaciones', 'comercial', 'comex'].includes(rol)}
          puedeCuentas={['gerencia', 'operaciones'].includes(rol)}
        />
      )}

      {/* ══════ USUARIOS ══════ */}
      {pestana === 'usuarios' && (
        <Panel titulo={`${(usuarios ?? []).length} usuarios del sistema · ${(usuarios ?? []).filter((u) => u.activo).length} activos`}>
          <NuevoUsuario editable={rol === 'gerencia'} almacenes={almacenes} />
          {(usuarios ?? []).length === 0 ? (
            <Vacio titulo="Sin usuarios" mensaje="No hay usuarios registrados." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acceso</th><th>Aprueba cotizaciones</th><th>Carga costos</th>{usuario?.ve_objetivos === true && <th>Objetivos</th>}<th>Alta</th></tr></thead>
                <tbody>
                  {(usuarios ?? []).map((u) => (
                    <tr key={u.id as string} data-usuario={u.email as string}>
                      <td>
                        <strong style={{ fontWeight: 600 }}>{u.nombre as string}</strong>
                        {u.id === usuario?.id && <span style={{ fontSize: '.7rem', color: 'var(--tinta-3)' }}> (usted)</span>}
                      </td>
                      <td className="mono">{u.email as string}</td>
                      <td>
                        {/*
                          Gerencia cambia el rol aquí mismo. Los demás ven el
                          selector apagado con el motivo; nadie se quita a sí
                          mismo el rol Gerencia.
                        */}
                        {rol === 'gerencia' ? (
                          <SelectorRol
                            id={u.id as string}
                            nombre={u.nombre as string}
                            rol={u.rol as Rol}
                            almacenId={(u.almacen_id as number | null) ?? null}
                            almacenes={almacenes}
                            editable
                            esUnoMismo={u.id === usuario?.id}
                          />
                        ) : (
                          <span title="Solo Gerencia cambia roles."><Etiqueta texto={NOMBRE_ROL[u.rol as Rol] ?? String(u.rol)} tono="info" /></span>
                        )}
                      </td>
                      <td>{u.activo ? <Etiqueta texto="Activo" tono="ok" /> : <Etiqueta texto="Inactivo" tono="neutro" />}</td>
                      <td>
                        <AccesoUsuario
                          id={u.id as string}
                          nombre={u.nombre as string}
                          activo={u.activo === true}
                          debeCambiar={u.debe_cambiar_clave === true}
                          editable={rol === 'gerencia'}
                          esUnoMismo={u.id === usuario?.id}
                        />
                      </td>
                      <td>
                        {/*
                          Facultad PERSONAL, no del rol: Oliver nombró a tres
                          personas concretas y una es de Comercial.
                        */}
                        <InterruptorAprobador
                          id={u.id as string}
                          nombre={u.nombre as string}
                          rol={u.rol as string}
                          aprueba={u.aprueba_cotizaciones === true}
                          editable={rol === 'gerencia'}
                        />
                      </td>
                      <td>
                        <InterruptorCostos id={u.id as string} carga={u.carga_costos === true} editable={rol === 'gerencia'} />
                      </td>
                      {usuario?.ve_objetivos === true && (
                        <td>
                          <InterruptorObjetivos id={u.id as string} nombre={u.nombre as string} ve={u.ve_objetivos === true} />
                        </td>
                      )}
                      <td style={{ fontSize: '.74rem', color: 'var(--tinta-3)' }}>{fechaHora(u.creado_en as string)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="pie-explicativo" style={{ padding: '.9rem 1rem 1rem' }}>
            El rol de cada usuario decide qué puede ver y hacer, y el sistema lo comprueba en cada
            operación, no solo en los botones: aunque alguien intentara saltarse la pantalla, el
            sistema rechazaría lo que no le corresponde. Una cuenta <strong>desactivada</strong> no puede entrar,
            pierde sus sesiones abiertas y deja de aparecer en las listas para elegir responsables;
            sus registros y su historial se conservan. Las contraseñas temporales las comunica
            Gerencia en persona y el sistema obliga a cambiarlas al entrar.
          </p>
        </Panel>
      )}
    </>
  );
}
