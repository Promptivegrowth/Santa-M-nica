'use client';

/**
 * Los otros pesos de saco que el cliente acepta para una línea (093): la
 * proforma los declara («*BAGS OF 20 KG/21 KG») y Almacén puede despachar
 * con uno u otro, o mezclarlos. Isaac (25/11): se ELIGEN entre las
 * presentaciones que existen del producto con el mismo congelamiento («este,
 * o este, o este»), así comex decide y nadie inventa un saco que no hay.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { guardarSacosAlternativos } from './accionesSacos';

export function SacosAlternativos({
  pedidoId, lineaId, sacoKg, alternativos, opciones, puede,
}: {
  pedidoId: number;
  lineaId: number;
  /** El peso del saco de la línea. */
  sacoKg: number;
  alternativos: number[];
  /** Las otras presentaciones activas del producto, mismo congelamiento. */
  opciones: { kg: number; descripcion: string }[];
  /** Su rol puede y el pedido todavía no salió. */
  puede: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [marcados, setMarcados] = useState<number[]>(alternativos);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, iniciar] = useTransition();

  const actual = alternativos.length ? `${[sacoKg, ...alternativos].join('/')} KG` : '—';
  //  Lo ya guardado se ve aunque la presentación se haya desactivado después.
  const lista = [...opciones, ...alternativos.filter((k) => !opciones.some((o) => o.kg === k)).map((kg) => ({ kg, descripcion: '' }))];

  if (!abierto) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }} data-sacos-alternativos={alternativos.join(',')}>
        <span className="mono">{actual}</span>
        {puede && lista.length > 0 && (
          <button type="button" className="btn btn-sutil btn-chico" data-accion="sacos-alternativos"
                  onClick={() => { setMarcados(alternativos); setAbierto(true); setAviso(null); }}
                  title="Otras presentaciones del producto con que se puede despachar: la proforma dirá «BAGS OF 20 KG/21 KG»">
            <Icono nombre="editar" tamano={12} />
          </button>
        )}
        {aviso && <small style={{ color: aviso.ok ? 'var(--ok)' : 'var(--critico)' }}>{aviso.texto}</small>}
      </span>
    );
  }

  function guardar() {
    iniciar(async () => {
      const r = await guardarSacosAlternativos(pedidoId, lineaId, marcados);
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setAbierto(false); router.refresh(); }
    });
  }

  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '.5rem' }}>
      <small style={{ color: 'var(--tinta-3)' }}>{sacoKg} kg o también:</small>
      {lista.map((o) => (
        <label key={o.kg} style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={marcados.includes(o.kg)} disabled={guardando}
                 onChange={(e) => setMarcados((m) => (e.target.checked ? [...m, o.kg] : m.filter((k) => k !== o.kg)))} />
          <span className="mono">{o.kg} KG</span>
          {o.descripcion && <small style={{ color: 'var(--tinta-3)' }}>({o.descripcion})</small>}
        </label>
      ))}
      <button type="button" className="btn btn-primario btn-chico" onClick={guardar} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
      <button type="button" className="btn btn-sutil btn-chico" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</button>
      {aviso && !aviso.ok && <small style={{ color: 'var(--critico)', flexBasis: '100%' }}>{aviso.texto}</small>}
    </span>
  );
}
