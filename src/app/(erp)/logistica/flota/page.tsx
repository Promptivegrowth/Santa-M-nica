/**
 * ============================================================================
 *  FLOTA · vehículos, conductores y sus documentos
 * ============================================================================
 *  Esta pantalla nació de un fallo concreto: la alerta «SOAT por vencer» era
 *  pulsable, pero llevaba a un catálogo de contadores donde el vehículo no
 *  aparecía por ninguna parte. Avisaba de un problema y no enseñaba dónde.
 *
 *  El SOAT y la revisión técnica no son un dato administrativo: sin ellos el
 *  camión no puede salir. Si vence el viernes y el embarque es el lunes, hay
 *  que saberlo hoy, no cuando el chofer está en la puerta del almacén. Por eso
 *  vive en Logística junto al planificador y no escondido en Configuración.
 *
 *  Se ordena por urgencia: primero lo vencido, después lo que vence pronto.
 *  Nadie tiene que buscar el problema; el problema está arriba.
 *
 *  Y ya no es de solo lectura: Gerencia, Operaciones y Comercio Exterior dan
 *  de alta, editan y desactivan transportistas, vehículos y conductores (lo
 *  que ya se usó se desactiva, no se borra). Ver acciones.ts.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { FormularioFlota, AccionesFlota, type Edicion } from './EditorFlota';

/** Quién mantiene la flota: quien coordina el transporte. */
const PUEDEN_EDITAR = ['gerencia', 'operaciones', 'comex'];
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { fecha, num, diasDesdeHoy } from '@/lib/formato';
import { campo } from '@/lib/relaciones';

export const metadata: Metadata = { title: 'Flota' };
export const dynamic = 'force-dynamic';

/**
 * Convierte una fecha de vencimiento en algo que se pueda leer de un vistazo.
 * El umbral de 30 días es fijo y propio de esta pantalla: las alertas
 * automáticas de SOAT se retiraron a pedido del cliente (migración 051).
 */
function estadoDocumento(vence: string | null) {
  if (!vence) return { texto: 'Sin registrar', tono: 'neutro' as const, dias: null, orden: 2 };
  const dias = diasDesdeHoy(vence);
  if (dias < 0) return { texto: `Vencido hace ${Math.abs(dias)} d`, tono: 'critico' as const, dias, orden: 0 };
  if (dias <= 30) return { texto: `Vence en ${dias} d`, tono: 'atencion' as const, dias, orden: 1 };
  return { texto: fecha(vence), tono: 'ok' as const, dias, orden: 3 };
}

export default async function PaginaFlota(props: PageProps<'/logistica/flota'>) {
  const q = await props.searchParams;
  // Cuando se llega desde una alerta, ese vehículo se resalta y se sube arriba.
  const resaltado = q.id ? Number(q.id) : null;
  //  ?editar=vehiculo-12 abre el formulario; ?editar=vehiculo-nuevo, uno vacío.
  const editar = typeof q.editar === 'string' ? q.editar : '';
  const hecho = typeof q.hecho === 'string' ? q.hecho : '';

  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeEditar = PUEDEN_EDITAR.includes(usuario?.rol ?? '');

  const [{ data: vehiculos }, { data: conductores }, { data: transportistas }, { data: usosEmb }, { data: usosTras }] = await Promise.all([
    supabase
      .from('vehiculos')
      .select('id, placa, marca, modelo, capacidad_tm, soat_vence, revision_vence, activo, transportista_id, transportistas(id, razon_social, tipo, telefono)')
      .order('placa'),
    supabase
      .from('conductores')
      .select('id, nombre, dni, licencia, licencia_vence, telefono, activo, transportista_id, transportistas(razon_social)')
      .order('nombre'),
    supabase.from('transportistas').select('id, razon_social, tipo, ruc, contacto, telefono, activo').order('razon_social'),
    //  Dónde se usó cada uno: lo usado se desactiva, no se borra.
    puedeEditar
      ? supabase.from('embarques').select('transportista_id, vehiculo_id, conductor_id').limit(5000)
      : Promise.resolve({ data: [] as { transportista_id: number | null; vehiculo_id: number | null; conductor_id: number | null }[] }),
    puedeEditar
      ? supabase.from('traslados').select('transportista_id, vehiculo_id, conductor_id').limit(5000)
      : Promise.resolve({ data: [] as { transportista_id: number | null; vehiculo_id: number | null; conductor_id: number | null }[] }),
  ]);

  /** «3 embarques, 1 traslado…»: dónde figura cada uno. */
  const usosDe = (col: 'transportista_id' | 'vehiculo_id' | 'conductor_id', id: number) => {
    const n = (filas: Record<string, unknown>[] | null) => (filas ?? []).filter((f) => Number(f[col]) === id).length;
    const u: string[] = [];
    const e = n(usosEmb), t = n(usosTras);
    if (e) u.push(`${e} embarque${e === 1 ? '' : 's'}`);
    if (t) u.push(`${t} traslado${t === 1 ? '' : 's'}`);
    if (col === 'transportista_id') {
      const v = (vehiculos ?? []).filter((x) => Number(x.transportista_id) === id).length;
      const c = (conductores ?? []).filter((x) => Number(x.transportista_id) === id).length;
      if (v) u.push(`${v} vehículo${v === 1 ? '' : 's'}`);
      if (c) u.push(`${c} conductor${c === 1 ? '' : 'es'}`);
    }
    return u;
  };

  /* ---- El formulario que pide la dirección web ---- */
  let edicion: Edicion | null = null;
  if (puedeEditar && editar) {
    const [tipo, cual] = editar.split('-');
    const id = cual === 'nuevo' ? null : Number(cual);
    if (tipo === 'vehiculo') {
      const v = id ? (vehiculos ?? []).find((x) => x.id === id) : null;
      if (!id || v) edicion = { tipo: 'vehiculo', id, datos: {
        placa: String(v?.placa ?? ''), transportista_id: (v?.transportista_id as number) ?? null,
        marca: (v?.marca as string) ?? null, modelo: (v?.modelo as string) ?? null,
        capacidad_tm: v?.capacidad_tm == null ? null : Number(v.capacidad_tm),
        soat_vence: (v?.soat_vence as string) ?? null, revision_vence: (v?.revision_vence as string) ?? null,
      } };
    } else if (tipo === 'conductor') {
      const c = id ? (conductores ?? []).find((x) => x.id === id) : null;
      if (!id || c) edicion = { tipo: 'conductor', id, datos: {
        nombre: String(c?.nombre ?? ''), dni: (c?.dni as string) ?? null, licencia: (c?.licencia as string) ?? null,
        licencia_vence: (c?.licencia_vence as string) ?? null, transportista_id: (c?.transportista_id as number) ?? null,
        telefono: (c?.telefono as string) ?? null,
      } };
    } else if (tipo === 'transportista') {
      const t = id ? (transportistas ?? []).find((x) => x.id === id) : null;
      if (!id || t) edicion = { tipo: 'transportista', id, datos: {
        razon_social: String(t?.razon_social ?? ''), tipo: ((t?.tipo as 'propio' | 'tercero') ?? 'tercero'),
        ruc: (t?.ruc as string) ?? null, contacto: (t?.contacto as string) ?? null, telefono: (t?.telefono as string) ?? null,
      } };
    }
  }
  const opcionesTransportista = (transportistas ?? [])
    .filter((t) => t.activo || (edicion && 'transportista_id' in edicion.datos && edicion.datos.transportista_id === t.id))
    .map((t) => ({ id: Number(t.id), nombre: String(t.razon_social) }));

  /* ---- Se ordena por urgencia: lo que ya venció, primero ---- */
  const flota = (vehiculos ?? [])
    .map((v) => {
      const soat = estadoDocumento(v.soat_vence as string | null);
      const revision = estadoDocumento(v.revision_vence as string | null);
      return { ...v, soat, revision, urgencia: Math.min(soat.orden, revision.orden) };
    })
    .sort((a, b) => {
      // El que se pidió desde la alerta va siempre el primero.
      if (resaltado) {
        if (a.id === resaltado) return -1;
        if (b.id === resaltado) return 1;
      }
      if (a.urgencia !== b.urgencia) return a.urgencia - b.urgencia;
      return String(a.placa).localeCompare(String(b.placa));
    });

  const conLicencia = (conductores ?? [])
    .map((c) => ({ ...c, licenciaEstado: estadoDocumento(c.licencia_vence as string | null) }))
    .sort((a, b) => a.licenciaEstado.orden - b.licenciaEstado.orden);

  const vencidos = flota.filter((v) => v.soat.orden === 0 || v.revision.orden === 0);
  const porVencer = flota.filter((v) => v.urgencia === 1);
  const licenciasEnRiesgo = conLicencia.filter((c) => c.licenciaEstado.orden <= 1);
  const capacidad = flota.filter((v) => v.activo).reduce((s, v) => s + Number(v.capacidad_tm ?? 0), 0);

  const elResaltado = resaltado ? flota.find((v) => v.id === resaltado) : null;

  return (
    <>
      <CabeceraPagina
        titulo="Flota"
        descripcion="Los vehículos y conductores que mueven la mercadería, con el estado de sus documentos. Un camión con el SOAT vencido no puede salir, así que aquí lo vencido y lo que está por vencer aparece siempre arriba."
      >
        <Link href="/logistica/planificador" className="btn btn-secundario">
          <Icono nombre="planificador" tamano={15} />
          Ver el calendario de salidas
        </Link>
      </CabeceraPagina>

      {hecho && (
        <div className="ficha-aviso ficha-aviso-info" role="status" data-aviso="flota-hecho">
          <Icono nombre="ingresos" tamano={17} />
          <span>{hecho}</span>
        </div>
      )}

      {/* ---- Se llegó desde una alerta: se dice de cuál se trata ---- */}
      {elResaltado && (
        <div
          className={
            elResaltado.urgencia === 0
              ? 'ficha-aviso ficha-aviso-critico'
              : elResaltado.urgencia === 1
              ? 'ficha-aviso ficha-aviso-atencion'
              : 'ficha-aviso ficha-aviso-info'
          }
        >
          <Icono nombre="despachos" tamano={17} />
          <span>
            <strong>Vehículo {elResaltado.placa as string}</strong> —{' '}
            {campo(elResaltado.transportistas, 'razon_social', 'sin transportista')}. SOAT{' '}
            {elResaltado.soat.orden === 3 ? 'vigente hasta el ' : ''}
            {elResaltado.soat.texto.toLowerCase()}. Revisión técnica{' '}
            {elResaltado.revision.orden === 3 ? 'vigente hasta el ' : ''}
            {elResaltado.revision.texto.toLowerCase()}. Está resaltado en la tabla de abajo.{' '}
            <Link href="/logistica/flota">Ver toda la flota sin resaltar</Link>.
          </span>
        </div>
      )}

      {vencidos.length > 0 && (
        <div className="ficha-aviso ficha-aviso-critico">
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>
              {vencidos.length} {vencidos.length === 1 ? 'vehículo tiene' : 'vehículos tienen'} algún
              documento vencido.
            </strong>{' '}
            No deberían programarse para despacho: si los para la policía, la carga se queda en la
            carretera y el embarque se pierde.
          </span>
        </div>
      )}

      <RejillaKpi>
        <Kpi etiqueta="Vehículos" valor={num(flota.length)} nota={`${num(flota.filter((v) => v.activo).length)} activos`} href="#vehiculos" />
        <Kpi
          etiqueta="Con documento vencido"
          valor={num(vencidos.length)}
          tono={vencidos.length > 0 ? 'critico' : 'ok'}
          nota="No pueden salir"
          href="#vehiculos"
        />
        <Kpi
          etiqueta="Por vencer en 30 días"
          valor={num(porVencer.length)}
          tono={porVencer.length > 0 ? 'atencion' : 'ok'}
          nota="Hay que renovar"
          href="#vehiculos"
        />
        <Kpi etiqueta="Capacidad de la flota" valor={num(capacidad, 1)} sufijo="TM" nota="Solo vehículos activos" href="#vehiculos" />
        <Kpi
          etiqueta="Licencias en riesgo"
          valor={num(licenciasEnRiesgo.length)}
          tono={licenciasEnRiesgo.length > 0 ? 'atencion' : 'ok'}
          nota="Conductores"
          href="#conductores"
        />
      </RejillaKpi>

      <Panel id="vehiculos" titulo={`Vehículos · ${flota.length}`} className="mb-espacio"
             acciones={puedeEditar ? <Link href="/logistica/flota?editar=vehiculo-nuevo#vehiculos" className="btn btn-secundario btn-chico" data-accion="nuevo-vehiculo">Nuevo vehículo</Link> : undefined}>
        {edicion?.tipo === 'vehiculo' && <FormularioFlota key={editar} edicion={edicion} transportistas={opcionesTransportista} />}
        {flota.length === 0 ? (
          <Vacio titulo="Sin vehículos" mensaje="No hay vehículos registrados en el maestro." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Placa</th>
                  <th>Vehículo</th>
                  <th>Transportista</th>
                  <th className="num">Capacidad</th>
                  <th>SOAT</th>
                  <th>Revisión técnica</th>
                  <th>Estado</th>
                  {puedeEditar && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {flota.map((v) => (
                  <tr
                    key={v.id as number}
                    // El resaltado es una marca en el DOM, no un color inventado:
                    // así el CSS lo pinta igual aquí y en cualquier otra tabla.
                    data-resaltada={v.id === resaltado ? 'si' : undefined}
                  >
                    <td className="mono"><strong>{v.placa as string}</strong></td>
                    <td style={{ fontSize: '.8rem' }}>
                      {(v.marca as string) ?? '—'} {(v.modelo as string) ?? ''}
                    </td>
                    <td>
                      {campo(v.transportistas, 'razon_social', 'Propio')}
                      <br />
                      <span style={{ fontSize: '.72rem', color: 'var(--tinta-3)' }}>
                        {campo(v.transportistas, 'telefono', '')}
                      </span>
                    </td>
                    <td className="num">{num(v.capacidad_tm, 1)} TM</td>
                    <td>
                      <Etiqueta texto={v.soat.texto} tono={v.soat.tono} />
                      {v.soat.orden <= 1 && v.soat_vence ? (
                        <div style={{ fontSize: '.7rem', color: 'var(--tinta-3)', marginTop: '.15rem' }}>
                          {fecha(v.soat_vence as string)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Etiqueta texto={v.revision.texto} tono={v.revision.tono} />
                      {v.revision.orden <= 1 && v.revision_vence ? (
                        <div style={{ fontSize: '.7rem', color: 'var(--tinta-3)', marginTop: '.15rem' }}>
                          {fecha(v.revision_vence as string)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {v.activo
                        ? <Etiqueta texto="Activo" tono="ok" />
                        : <Etiqueta texto="Fuera de servicio" tono="neutro" />}
                    </td>
                    {puedeEditar && (
                      <td>
                        <AccionesFlota tabla="vehiculos" id={Number(v.id)} activo={!!v.activo}
                                       usos={usosDe('vehiculo_id', Number(v.id))}
                                       editar={`/logistica/flota?editar=vehiculo-${v.id}#vehiculos`} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel id="conductores" titulo={`Conductores · ${conLicencia.length}`} className="mb-espacio"
             acciones={puedeEditar ? <Link href="/logistica/flota?editar=conductor-nuevo#conductores" className="btn btn-secundario btn-chico" data-accion="nuevo-conductor">Nuevo conductor</Link> : undefined}>
        {edicion?.tipo === 'conductor' && <FormularioFlota key={editar} edicion={edicion} transportistas={opcionesTransportista} />}
        {conLicencia.length === 0 ? (
          <Vacio titulo="Sin conductores" mensaje="No hay conductores registrados en el maestro." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Conductor</th><th>DNI</th><th>Licencia</th>
                  <th>Vigencia</th><th>Transportista</th><th>Teléfono</th><th>Estado</th>
                  {puedeEditar && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {conLicencia.map((c) => (
                  <tr key={c.id as number}>
                    <td><strong style={{ fontWeight: 600 }}>{c.nombre as string}</strong></td>
                    <td className="mono">{(c.dni as string) ?? '—'}</td>
                    <td className="mono">{(c.licencia as string) ?? '—'}</td>
                    <td><Etiqueta texto={c.licenciaEstado.texto} tono={c.licenciaEstado.tono} /></td>
                    <td style={{ fontSize: '.8rem' }}>{campo(c.transportistas, 'razon_social', 'Propio')}</td>
                    <td className="mono" style={{ fontSize: '.76rem' }}>{(c.telefono as string) ?? '—'}</td>
                    <td>
                      {c.activo
                        ? <Etiqueta texto="Activo" tono="ok" />
                        : <Etiqueta texto="Inactivo" tono="neutro" />}
                    </td>
                    {puedeEditar && (
                      <td>
                        <AccionesFlota tabla="conductores" id={Number(c.id)} activo={!!c.activo}
                                       usos={usosDe('conductor_id', Number(c.id))}
                                       editar={`/logistica/flota?editar=conductor-${c.id}#conductores`} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---- Transportistas: de quién es cada camión (también la flota propia) ---- */}
      <Panel id="transportistas" titulo={`Transportistas · ${(transportistas ?? []).length}`} className="mb-espacio"
             acciones={puedeEditar ? <Link href="/logistica/flota?editar=transportista-nuevo#transportistas" className="btn btn-secundario btn-chico" data-accion="nuevo-transportista">Nuevo transportista</Link> : undefined}>
        {edicion?.tipo === 'transportista' && <FormularioFlota key={editar} edicion={edicion} transportistas={opcionesTransportista} />}
        {(transportistas ?? []).length === 0 ? (
          <Vacio titulo="Sin transportistas" mensaje="No hay transportistas registrados." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Razón social</th><th>Tipo</th><th>RUC</th><th>Contacto</th><th>Teléfono</th>
                  <th className="num">Vehículos</th><th>Estado</th>
                  {puedeEditar && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {(transportistas ?? []).map((t) => (
                  <tr key={t.id as number}>
                    <td><strong style={{ fontWeight: 600 }}>{t.razon_social as string}</strong></td>
                    <td>{t.tipo === 'propio' ? 'Propio' : 'Tercero'}</td>
                    <td className="mono">{(t.ruc as string) ?? '—'}</td>
                    <td style={{ fontSize: '.8rem' }}>{(t.contacto as string) ?? '—'}</td>
                    <td className="mono" style={{ fontSize: '.76rem' }}>{(t.telefono as string) ?? '—'}</td>
                    <td className="num">{num((vehiculos ?? []).filter((v) => Number(v.transportista_id) === Number(t.id)).length)}</td>
                    <td>{t.activo ? <Etiqueta texto="Activo" tono="ok" /> : <Etiqueta texto="Inactivo" tono="neutro" />}</td>
                    {puedeEditar && (
                      <td>
                        <AccionesFlota tabla="transportistas" id={Number(t.id)} activo={!!t.activo}
                                       usos={usosDe('transportista_id', Number(t.id))}
                                       editar={`/logistica/flota?editar=transportista-${t.id}#transportistas`} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/*
        La nota decía que el aviso de 30 días se cambiaba en el Motor de reglas,
        pero esa regla se retiró (migración 051) y el umbral de esta pantalla
        es fijo. Ahora dice lo que de verdad pasa.
      */}
      <p className="pie-explicativo">
        Lo que vence en 30 días o menos se marca en ámbar aquí; ese plazo es fijo y no genera alertas
        (las alertas automáticas de SOAT se retiraron a pedido del cliente). El control que sí sigue es
        al programar o editar un embarque: no deja asignar un vehículo con el SOAT o la revisión técnica
        vencidos para la fecha de salida. La licencia del conductor no se valida al programar. Dan de
        alta, editan y desactivan la flota Gerencia, Operaciones y Comercio Exterior; lo que ya se usó
        en un embarque o un traslado se desactiva, no se borra.
      </p>
    </>
  );
}
