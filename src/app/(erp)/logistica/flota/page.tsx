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
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { fecha, num, diasDesdeHoy } from '@/lib/formato';
import { campo } from '@/lib/relaciones';

export const metadata: Metadata = { title: 'Flota' };
export const dynamic = 'force-dynamic';

/**
 * Convierte una fecha de vencimiento en algo que se pueda leer de un vistazo.
 * El umbral de 30 días es el mismo que usa la regla que genera las alertas,
 * para que la pantalla y el aviso nunca digan cosas distintas.
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

  const supabase = await crearClienteServidor();

  const [{ data: vehiculos }, { data: conductores }] = await Promise.all([
    supabase
      .from('vehiculos')
      .select('id, placa, marca, modelo, capacidad_tm, soat_vence, revision_vence, activo, transportistas(id, razon_social, tipo, telefono)')
      .order('placa'),
    supabase
      .from('conductores')
      .select('id, nombre, dni, licencia, licencia_vence, telefono, activo, transportistas(razon_social)')
      .order('nombre'),
  ]);

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
        <Kpi etiqueta="Vehículos" valor={num(flota.length)} nota={`${num(flota.filter((v) => v.activo).length)} activos`} />
        <Kpi
          etiqueta="Con documento vencido"
          valor={num(vencidos.length)}
          tono={vencidos.length > 0 ? 'critico' : 'ok'}
          nota="No pueden salir"
        />
        <Kpi
          etiqueta="Por vencer en 30 días"
          valor={num(porVencer.length)}
          tono={porVencer.length > 0 ? 'atencion' : 'ok'}
          nota="Hay que renovar"
        />
        <Kpi etiqueta="Capacidad de la flota" valor={num(capacidad, 1)} sufijo="TM" nota="Solo vehículos activos" />
        <Kpi
          etiqueta="Licencias en riesgo"
          valor={num(licenciasEnRiesgo.length)}
          tono={licenciasEnRiesgo.length > 0 ? 'atencion' : 'ok'}
          nota="Conductores"
        />
      </RejillaKpi>

      <Panel titulo={`Vehículos · ${flota.length}`} className="mb-espacio">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel titulo={`Conductores · ${conLicencia.length}`} className="mb-espacio">
        {conLicencia.length === 0 ? (
          <Vacio titulo="Sin conductores" mensaje="No hay conductores registrados en el maestro." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Conductor</th><th>DNI</th><th>Licencia</th>
                  <th>Vigencia</th><th>Transportista</th><th>Teléfono</th><th>Estado</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="pie-explicativo">
        El aviso salta 30 días antes del vencimiento. Ese plazo se cambia desde{' '}
        <Link href="/configuracion?t=reglas">Configuración → Motor de reglas</Link>, igual que
        cualquier otra alerta: si 30 días resultan pocos para renovar un SOAT, se sube y basta.
      </p>
    </>
  );
}
