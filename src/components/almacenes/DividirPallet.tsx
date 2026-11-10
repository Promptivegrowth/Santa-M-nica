'use client';

/**
 * ============================================================================
 *  DIVIDIR PALLET · el formulario de la ficha del pallet (088)
 * ============================================================================
 *  «De un pallet se me van 20 sacos: esos 20 los paletizo y les genero otro
 *  número de pallet; los que quedan son saldo» (Dany, Almacén). Se elige la
 *  bodega (si el pallet está en más de una), cuántos bultos pasan al pallet
 *  nuevo y su número; los kilos se proponen con el peso por bulto del pallet y
 *  se pueden corregir con lo que marcó la balanza.
 *
 *  Solo se ofrece lo LIBRE: lo reservado para un pedido se queda en el
 *  original (para eso se carga en su packing, sin dividir). La base lo vuelve
 *  a comprobar todo.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import { dividirPallet } from '@/app/(erp)/almacenes/lotes/acciones';

export type PosicionDivisible = {
  almacen_id: number;
  almacen: string;
  bultos: number;
  kg: number;
  /** Lo que se puede separar: físico − bloqueado − reservado − en preparación. */
  libre_kg: number;
};

const kgTexto = (n: number) => n.toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function DividirPallet({ loteId, pallet, posiciones, puede }: {
  loteId: number; pallet: string; posiciones: PosicionDivisible[]; puede: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [guardando, iniciar] = useTransition();
  const conStock = posiciones.filter((p) => p.bultos > 1);
  const [almacenId, setAlmacenId] = useState<number>(conStock[0]?.almacen_id ?? 0);
  const [bultos, setBultos] = useState('');
  const [peso, setPeso] = useState('');
  const [pesoTocado, setPesoTocado] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [detalle, setDetalle] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'mal'; texto: string; nuevo?: number } | null>(null);

  if (!puede || conStock.length === 0) return null;

  const pos = conStock.find((p) => p.almacen_id === almacenId) ?? conStock[0];
  const kgPorBulto = pos.bultos > 0 ? pos.kg / pos.bultos : 0;
  const nBultos = Number(bultos);
  const nPeso = Number(peso.replace(',', '.'));

  function cambiarBultos(t: string) {
    setBultos(t);
    //  Los kilos siguen a los bultos mientras nadie los haya corregido a mano.
    const n = Number(t);
    if (!pesoTocado) setPeso(n > 0 ? String(Math.round(n * kgPorBulto * 1000) / 1000) : '');
  }

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => dividirPallet({
        lote_id: loteId, almacen_id: pos.almacen_id, bultos: nBultos, peso_kg: nPeso, codigo_nuevo: codigo, detalle,
      }));
      if (r.ok) {
        setAviso({ tipo: 'ok', texto: r.mensaje, nuevo: r.lote_nuevo_id });
        setBultos(''); setPeso(''); setPesoTocado(false); setCodigo(''); setDetalle('');
        setAbierto(false);
        router.refresh();
      } else {
        setAviso({ tipo: 'mal', texto: r.mensaje });
      }
    });
  }

  const avisoCaja = aviso && (
    <div className={`ficha-aviso ${aviso.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'}`}
         role={aviso.tipo === 'ok' ? 'status' : 'alert'} data-aviso="division">
      <Icono nombre="alerta" tamano={16} />
      <span>
        {aviso.texto}
        {aviso.nuevo ? <> <Link href={`/almacenes/lotes/${aviso.nuevo}`} className="enlace-ficha">Abrir el pallet nuevo</Link></> : null}
      </span>
    </div>
  );

  if (!abierto) {
    return (
      <div style={{ padding: '.7rem 1rem' }}>
        {avisoCaja}
        <button type="button" className="btn btn-secundario" data-accion="dividir-pallet" onClick={() => setAbierto(true)}>
          <Icono nombre="traslados" tamano={15} />
          Dividir pallet
        </button>
        <small style={{ marginLeft: '.6rem', color: 'var(--tinta-3)' }}>
          Separar sacos a un pallet con número nuevo; lo que queda es su saldo.
        </small>
      </div>
    );
  }

  const excede = nPeso > pos.libre_kg + 0.001;
  return (
    <form className="dictamen" onSubmit={enviar} data-bloque="dividir-pallet">
      <div className="dictamen-cab">
        <strong>Dividir el pallet <span className="mono">{pallet}</span></strong>
        <button type="button" className="btn btn-sutil btn-chico" onClick={() => setAbierto(false)}>Cerrar</button>
      </div>
      {aviso?.tipo === 'mal' && avisoCaja}

      <div className="form-rejilla">
        {conStock.length > 1 && (
          <label className="form-campo">
            <span>Bodega</span>
            <select className="campo" value={pos.almacen_id} onChange={(e) => setAlmacenId(Number(e.target.value))}>
              {conStock.map((p) => <option key={p.almacen_id} value={p.almacen_id}>{p.almacen} · {p.bultos} bultos</option>)}
            </select>
          </label>
        )}
        <label className="form-campo">
          <span>Bultos que pasan al pallet nuevo <b className="req">*</b></span>
          <input className="campo mono" type="number" min={1} max={pos.bultos - 1} step={1} name="bultos"
                 value={bultos} onChange={(e) => cambiarBultos(e.target.value)} required />
          <small>Tiene {pos.bultos} bultos · {kgTexto(pos.kg)} kg en {pos.almacen}. Libres para separar: {kgTexto(Math.max(pos.libre_kg, 0))} kg.</small>
        </label>
        <label className="form-campo">
          <span>Kilos que pasan <b className="req">*</b></span>
          <input className="campo mono" inputMode="decimal" name="peso" value={peso}
                 onChange={(e) => { setPeso(e.target.value); setPesoTocado(true); }} required />
          <small>{kgPorBulto > 0 ? `Propuesto con ${kgTexto(kgPorBulto)} kg por bulto; corríjalo si la balanza dice otra cosa.` : ''}</small>
        </label>
        <label className="form-campo">
          <span>N° de pallet nuevo <b className="req">*</b></span>
          <input className="campo mono" name="codigo_nuevo" value={codigo} onChange={(e) => setCodigo(e.target.value)}
                 placeholder={`p. ej. ${pallet}-A`} maxLength={40} required />
          <small>No puede existir ya en el sistema.</small>
        </label>
        <label className="form-campo form-campo-ancho">
          <span>Para qué</span>
          <input className="campo" name="detalle" value={detalle} onChange={(e) => setDetalle(e.target.value)}
                 placeholder="p. ej. 20 sacos para el embarque de la PL POT1118" maxLength={200} />
        </label>
      </div>

      <div className={`form-consecuencia ${excede ? 'local' : 'export'}`}>
        <Icono nombre="alerta" tamano={16} />
        <span>
          {nBultos > 0 && nBultos < pos.bultos ? (
            <><b>Quedarán dos pallets:</b> {codigo.trim() || 'el nuevo'} con {nBultos} bultos · {kgTexto(nPeso || 0)} kg, y{' '}
              {pallet} con {pos.bultos - nBultos} bultos · {kgTexto(pos.kg - (nPeso || 0))} kg (saldo). Mismo producto, misma
              fecha de producción y misma trazabilidad; en el Kardex queda la salida y el ingreso por división.</>
          ) : nBultos >= pos.bultos ? (
            <>El pallet original tiene que quedar con al menos un bulto: separe hasta {pos.bultos - 1}.</>
          ) : (
            <>Escriba cuántos bultos pasan al pallet nuevo: los kilos se proponen solos.</>
          )}
          {excede && <> <b>Lo reservado no se separa:</b> pasan más kilos que los libres.</>}
        </span>
      </div>

      <div className="form-acciones">
        <button type="submit" className="btn btn-primario" disabled={guardando || !(nBultos > 0) || !(nPeso > 0) || !codigo.trim()}
                data-accion="confirmar-division">
          <Icono nombre="guardar" tamano={15} />
          {guardando ? 'Dividiendo…' : 'Dividir pallet'}
        </button>
      </div>
    </form>
  );
}
