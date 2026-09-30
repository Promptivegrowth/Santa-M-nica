'use client';

/**
 * ============================================================================
 *  ACTUALIZACIÓN SEMANAL · un componente, muchos productos a la vez
 * ============================================================================
 *  Oliver no encontraba dónde actualizar los costos cada semana. Aquí: se
 *  elige el alcance (especie, familia), el componente y el cambio —un valor
 *  nuevo o un porcentaje—, se ve a cuántos productos afecta y se aplica. Rige
 *  desde hoy y solo para lo que ingrese desde hoy. Para cambiar un producto
 *  suelto se escribe en su fila de la tabla.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actualizarEnBloque, type DatosBloque } from './acciones';

export function ActualizarEnBloque({
  especies, familias, hoy,
}: { especies: string[]; familias: string[]; hoy: string }) {
  const router = useRouter();
  const [d, setD] = useState<DatosBloque>({ especie: '', familia: '', componente: 'materia_prima_kg', modo: 'porcentaje', cantidad: 0 });
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [trabajando, iniciar] = useTransition();

  const cambiar = <K extends keyof DatosBloque>(k: K, v: DatosBloque[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setPrevia(null);
    setAviso(null);
  };
  const cantidad = Number(texto.replace(',', '.'));
  const valido = texto.trim() !== '' && Number.isFinite(cantidad);

  return (
    <div className="costos-bloque" data-bloque="actualizar">
      <div className="form-rejilla" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
        <label className="form-campo">
          <span>Especie</span>
          <select className="campo" value={d.especie} onChange={(e) => cambiar('especie', e.target.value)} name="especie">
            <option value="">Todas</option>
            {especies.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="form-campo">
          <span>Familia</span>
          <select className="campo" value={d.familia} onChange={(e) => cambiar('familia', e.target.value)} name="familia">
            <option value="">Todas</option>
            {familias.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="form-campo">
          <span>Componente</span>
          <select className="campo" value={d.componente} name="componente"
                  onChange={(e) => cambiar('componente', e.target.value as DatosBloque['componente'])}>
            <option value="materia_prima_kg">Materia prima</option>
            <option value="conversion_kg">Conversión</option>
            <option value="variable_kg">Variable</option>
          </select>
        </label>
        <label className="form-campo">
          <span>Cambio</span>
          <select className="campo" value={d.modo} name="modo"
                  onChange={(e) => cambiar('modo', e.target.value as DatosBloque['modo'])}>
            <option value="porcentaje">Variación en %</option>
            <option value="valor">Nuevo valor (US$/kg)</option>
          </select>
        </label>
        <label className="form-campo">
          <span>{d.modo === 'porcentaje' ? '% (ej. 3 o −2,5)' : 'US$ por kg'}</span>
          <input className="campo mono" inputMode="decimal" value={texto} name="cantidad"
                 onChange={(e) => { setTexto(e.target.value); setPrevia(null); setAviso(null); }} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.6rem' }}>
        <button type="button" className="btn btn-secundario btn-chico" disabled={!valido || trabajando} data-accion="ver-alcance"
                onClick={() => iniciar(async () => {
                  const r = await actualizarEnBloque({ ...d, cantidad, soloContar: true });
                  setPrevia(r.ok ? r.mensaje : null);
                  setAviso(r.ok ? null : { ok: false, texto: r.mensaje });
                })}>
          Ver a cuántos afecta
        </button>
        <button type="button" className="btn btn-primario btn-chico" disabled={!valido || !previa || trabajando} data-accion="aplicar-bloque"
                onClick={() => iniciar(async () => {
                  const r = await actualizarEnBloque({ ...d, cantidad });
                  setAviso({ ok: r.ok, texto: r.mensaje });
                  setPrevia(null);
                  if (r.ok) { setTexto(''); router.refresh(); }
                })}>
          {trabajando ? 'Aplicando…' : `Aplicar desde hoy (${hoy.split('-').reverse().join('/')})`}
        </button>
        {previa && <span style={{ fontSize: '.8rem', color: 'var(--tinta-2)' }} role="status">{previa}</span>}
      </div>
      {aviso && (
        <p className={`ficha-aviso ${aviso.ok ? 'ficha-aviso-ok' : 'ficha-aviso-critico'}`} role="status" style={{ marginTop: '.6rem' }}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
