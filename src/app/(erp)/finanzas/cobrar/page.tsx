/**
 * ============================================================================
 *  CUENTAS POR COBRAR · quién debe y desde cuándo
 * ============================================================================
 *  El dato clave no es cuánto deben, sino desde HACE CUÁNTO. Una deuda de un
 *  mes y una de seis meses valen lo mismo en el papel pero no en la realidad.
 *
 *  Por eso el eje principal de esta pantalla es la ANTIGÜEDAD del saldo.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { GraficoBarras } from '@/components/graficos/Graficos';
import { num, fecha, dinero } from '@/lib/formato';

export const metadata: Metadata = { title: 'Cuentas por cobrar' };
export const dynamic = 'force-dynamic';

const TRAMOS = ['Vigente', '1 a 30 días', '31 a 60 días', '61 a 90 días', 'Más de 90 días'];

export default async function PaginaCobrar() {
  const supabase = await crearClienteServidor();
  const { data: filas } = await supabase
    .from('v_cuentas_cobrar').select('*').gt('saldo', 0).order('dias_vencida', { ascending: false });

  const lista = filas ?? [];
  const total = lista.reduce((s, f) => s + Number(f.saldo ?? 0), 0);
  const vencido = lista.filter((f) => Number(f.dias_vencida) > 0).reduce((s, f) => s + Number(f.saldo ?? 0), 0);
  const masDe90 = lista.filter((f) => Number(f.dias_vencida) > 90).reduce((s, f) => s + Number(f.saldo ?? 0), 0);

  const porTramo = TRAMOS.map((t) => ({
    etiqueta: t,
    valor: lista.filter((f) => f.tramo_antiguedad === t).reduce((s, f) => s + Number(f.saldo ?? 0), 0),
  })).filter((t) => t.valor > 0);

  return (
    <>
      <CabeceraPagina
        titulo="Cuentas por cobrar"
        descripcion="Saldos pendientes ordenados por antigüedad. Lo que lleva más tiempo vencido está arriba."
      />

      <RejillaKpi>
        <Kpi etiqueta="Saldo total pendiente" valor={dinero(total, 'USD', 0)} tono="marca" nota={`${num(lista.length)} documentos`} />
        <Kpi etiqueta="Saldo vencido" valor={dinero(vencido, 'USD', 0)} tono={vencido > 0 ? 'critico' : 'ok'}
             nota={`${((vencido / (total || 1)) * 100).toFixed(1)} % del total`} />
        <Kpi etiqueta="Más de 90 días" valor={dinero(masDe90, 'USD', 0)} tono={masDe90 > 0 ? 'critico' : 'ok'}
             nota="Requiere gestión urgente" />
      </RejillaKpi>

      {porTramo.length > 0 && (
        <Panel titulo="Antigüedad del saldo" className="mb-espacio">
          {/* Los tramos tienen orden natural: rampa de un solo tono */}
          <GraficoBarras
            datos={porTramo}
            formato="dolares"
            horizontal
            tono="rampa"
            altura={160}
          />
        </Panel>
      )}

      <Panel titulo={`${lista.length} documentos con saldo`}>
        {lista.length === 0 ? (
          <Vacio titulo="Nada por cobrar" mensaje="Todos los documentos están cobrados." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Documento</th><th>Cliente</th><th>País</th>
                  <th className="num">Vencimiento</th><th className="num">Días</th>
                  <th className="num">Total</th><th className="num">Cobrado</th><th className="num">Saldo</th>
                  <th>Antigüedad</th>
                </tr>
              </thead>
              <tbody>
                {lista.slice(0, 200).map((f) => {
                  const dias = Number(f.dias_vencida ?? 0);
                  return (
                    <tr key={f.id as number}>
                      <td className="mono">{f.numero as string}</td>
                      <td title={f.cliente as string}>
                        {String(f.cliente).length > 28 ? String(f.cliente).slice(0, 27) + '…' : String(f.cliente)}
                      </td>
                      <td style={{ fontSize: '.78rem' }}>{(f.pais as string) ?? '—'}</td>
                      <td className="num">{fecha(f.fecha_vencimiento as string)}</td>
                      <td className="num" style={{ color: dias > 0 ? 'var(--critico)' : 'var(--tinta-3)' }}>
                        {dias > 0 ? `+${dias}` : dias}
                      </td>
                      <td className="num">{dinero(f.total as number, f.moneda as 'USD' | 'PEN', 0)}</td>
                      <td className="num">{dinero(f.cobrado as number, f.moneda as 'USD' | 'PEN', 0)}</td>
                      <td className="num"><strong>{dinero(f.saldo as number, f.moneda as 'USD' | 'PEN', 0)}</strong></td>
                      <td>
                        <Etiqueta
                          texto={String(f.tramo_antiguedad)}
                          tono={
                            f.tramo_antiguedad === 'Vigente' ? 'ok'
                            : f.tramo_antiguedad === 'Más de 90 días' ? 'critico'
                            : 'atencion'
                          }
                        />
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
