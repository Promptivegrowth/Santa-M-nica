/**
 * ============================================================================
 *  CLIENTES · el maestro consolidado
 * ============================================================================
 *  Este maestro resuelve un problema concreto encontrado en la data actual:
 *  el Excel tenía 110 formas distintas de escribir 87 empresas. "QINGDAO
 *  HAIYUJIA" aparecía con cuatro grafías, "RICH MARINE" con tres.
 *
 *  Cada variante rompía un reporte de rentabilidad por cliente. Aquí hay UN
 *  registro por empresa real, y el resto del sistema elige de esta lista en
 *  lugar de escribir texto libre.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Etiqueta } from '@/components/ui/Pagina';
import { Listado } from '@/components/ui/Listado';
import { dinero, num } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Clientes' };
export const dynamic = 'force-dynamic';

export default async function PaginaClientes(props: PageProps<'/ventas/clientes'>) {
  const q = await props.searchParams;
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const supabase = await crearClienteServidor();
  const { data: paises } = await supabase.from('clientes').select('pais').order('pais');
  const listaPaises = [...new Set((paises ?? []).map((p) => p.pais as string).filter(Boolean))];

  return (
    <>
      <CabeceraPagina
        titulo="Clientes"
        descripcion="Un registro por empresa real, con su línea de crédito y su condición de pago. El resto del sistema elige de esta lista: se acabó el texto libre."
      />

      <Listado
        vista="clientes"
        ficha={{ base: '/ventas/clientes', titulo: 'Ver la ficha del cliente' }}
        parametros={q as Record<string, string | undefined>}
        orden="razon_social"
        ascendente
        titulo="Cartera de clientes"
        filtros={[
          { tipo: 'texto', clave: 'buscar', etiqueta: 'Razón social o código', ancho: '14rem' },
          { tipo: 'select', clave: 'pais', etiqueta: 'País',
            opciones: listaPaises.map((p) => ({ valor: p, texto: p })) },
          { tipo: 'select', clave: 'bloqueado', etiqueta: 'Mostrar',
            opciones: [{ valor: 'si', texto: 'Solo bloqueados' }] },
        ]}
        filtrosAplicados={[
          { clave: 'buscar', columna: 'razon_social', operador: 'contiene',
            columnas: ['razon_social', 'codigo', 'nombre_corto'] },
          { clave: 'pais', columna: 'pais', operador: 'igual' },
          { clave: 'bloqueado', columna: 'bloqueado', operador: 'verdadero' },
        ]}
        columnas={[
          { clave: 'codigo', titulo: 'Código', mono: true },
          { clave: 'razon_social', titulo: 'Razón social',
            render: (f) => (
              <>
                <strong style={{ fontWeight: 600 }}>{String(f.razon_social)}</strong>
                {f.bloqueado ? (
                  <> <Etiqueta texto="Bloqueado" tono="critico" /></>
                ) : null}
                {f.motivo_bloqueo ? (
                  <><br /><span style={{ fontSize: '.72rem', color: 'var(--tinta-3)' }}>{String(f.motivo_bloqueo)}</span></>
                ) : null}
              </>
            ) },
          { clave: 'pais', titulo: 'País' },
          { clave: 'moneda', titulo: 'Moneda', mono: true },
          ...(puedeVerCostos ? [{
            clave: 'linea_credito', titulo: 'Línea de crédito', numerica: true,
            render: (f: Record<string, unknown>) =>
              dinero(f.linea_credito as number, f.moneda as 'USD' | 'PEN', 0),
          }] : []),
          { clave: 'dias_credito', titulo: 'Días crédito', numerica: true,
            render: (f) => Number(f.dias_credito) > 0 ? `${num(Number(f.dias_credito))} días` : 'Contado' },
          { clave: 'activo', titulo: 'Estado',
            render: (f) => f.activo
              ? <Etiqueta texto="Activo" tono="ok" />
              : <Etiqueta texto="Inactivo" tono="neutro" /> },
        ]}
        vacio={{ titulo: 'Sin clientes', mensaje: 'No hay clientes que coincidan con los filtros.' }}
      />
    </>
  );
}
