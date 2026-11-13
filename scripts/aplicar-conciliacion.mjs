/**
 * ============================================================================
 *  APLICAR LA CONCILIACIÓN · dejar el stock del ERP como el Excel de Operaciones
 * ============================================================================
 *  13/11 · conciliar-stock.mjs EXPLICA la diferencia; este guion la CORRIGE.
 *  Compara pallet + CODIGO + ALMACÉN (no solo cuánto hay: también dónde) y
 *  genera UN archivo SQL, todo o nada, que usa las funciones del sistema:
 *
 *    · Pallet que el ERP no tiene → se crea el lote y su INGRESO al Kardex, igual
 *      que el formulario (registro.ts: crearIngreso). En un almacén externo que
 *      no recibe producción (Depsa, Perufrost) entra con un ajuste explicado.
 *    · Pallet con otra cantidad o en otro almacén → stock_ajustar(), la función
 *      de la pantalla Ajustes de stock: quita donde sobra y pone donde está,
 *      con el motivo y el detalle del Excel (despachado el …, contenedor …).
 *      Si tenía reservas, las reduce dejando constancia.
 *
 *  SEGUROS DEL SQL GENERADO:
 *    · Se niega a correr si el stock cambió desde que se generó (otra persona
 *      registró algo entremedio): hay que volver a generarlo.
 *    · Los pallets de la lista EXCLUIR no se tocan (p. ej. los que quedan bien
 *      solos después de otra corrección).
 *
 *  Uso:
 *    node --env-file=.env.local scripts/aplicar-conciliacion.mjs "<excel>.xlsx" salida.sql [--excluir "P1|COD,P2|COD"] [--requiere-sql "select …"]
 *  y después:  node scripts/db.mjs salida.sql
 *
 *  Este guion NO escribe en la base: solo lee y escribe el .sql.
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ejecutarSQL } from './db.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const EXCLUIR = new Set((opcion('--excluir') ?? '').split(',').map((x) => x.trim()).filter(Boolean));
const REQUIERE = opcion('--requiere-sql');
/** Productos desactivados en el maestro que siguen produciéndose: se reactivan al aplicar. */
const ACTIVAR = (opcion('--activar-skus') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const [ARCHIVO, SALIDA] = args;
if (!ARCHIVO || !SALIDA) { console.error('Uso: aplicar-conciliacion.mjs "<excel>.xlsx" salida.sql'); process.exit(1); }

/** El usuario con que se registra (Gerencia: los ajustes los autoriza Gerencia u Operaciones). */
const USUARIO = process.env.USUARIO_CONCILIACION ?? 'fb294491-1861-46f0-935f-c3268c452262';
const MOTIVO_ERROR = 187;      // Corrección de error de registro
const MOTIVO_UBICACION = 186;  // Discrepancia de traslado

const C = { fechaProduccion: 3, pallet: 6, camara: 8, linea: 9, almacen: 10, movimiento: 11, motivoIngreso: 12, motivoSalida: 13,
  estatus: 14, turno: 16, codigo: 17, idPres: 19, presentacion: 20, pesoBulto: 21, congelamiento: 22, total: 24, pesoNeto: 25,
  proforma: 29, cliente: 31, fechaDespacho: 36, contenedor: 38 };
const valor = (c) => { let v = c?.value; if (v && typeof v === 'object' && 'result' in v) v = v.result; if (v && typeof v === 'object' && v.error) return null;
  if (v && typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join(''); return v ?? null; };
const texto = (c) => { const v = valor(c); return v === null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim(); };
const numero = (c) => { const n = Number(String(valor(c) ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const dma = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/** Su ALMACEN + CAMARA → el almacén del ERP. */
function almacenDe(alm, cam) {
  const a = sinTildes(alm).replace(/^STM-/, '');
  if (a === 'SANTA MONICA') { const n = /0?([123])\s*$/.exec(cam)?.[1]; return n ? Number(n) : null; }
  return { FREEKO: 4, ELAMAR: 5, PERUFROST: 6, DEPSA: 7, COINREFRI: 8, 'EMERGENT COLD': 9, HAYDUK: 10, EXALMAR: 15, PERUVIAN: 16 }[a] ?? null;
}

/* ---------------- El Excel ---------------- */
console.log(`Leyendo ${path.basename(ARCHIVO)}…`);
const libro = new ExcelJS.Workbook();
await libro.xlsx.readFile(ARCHIVO);
const hoja = libro.getWorksheet('GENERAL');
const excel = new Map();   // pallet|codigo → { almacenes: Map(id → {kg, bultos}), info, salidas[] }
const sinAlmacen = new Set();
hoja.eachRow((f, n) => {
  if (n < 2) return;
  const pallet = texto(f.getCell(C.pallet)).replace(/\s+/g, ' ');
  if (!pallet) return;
  const codigo = texto(f.getCell(C.codigo));
  const clave = `${pallet}|${codigo}`;
  const e = excel.get(clave) ?? { pallet, codigo, almacenes: new Map(), info: null, salidas: [] };
  const estatus = sinTildes(texto(f.getCell(C.estatus)));
  const mov = sinTildes(texto(f.getCell(C.movimiento)));
  const kg = numero(f.getCell(C.pesoNeto));
  if (estatus === 'ALMACENADO') {
    const a = almacenDe(texto(f.getCell(C.almacen)), texto(f.getCell(C.camara)));
    if (!a) { sinAlmacen.add(`${texto(f.getCell(C.almacen))} | ${texto(f.getCell(C.camara))}`); return; }
    const x = e.almacenes.get(a) ?? { kg: 0, bultos: 0 };
    const s = mov === 'INGRESO' ? 1 : -1;
    x.kg += s * kg; x.bultos += s * numero(f.getCell(C.total));
    e.almacenes.set(a, x);
    if (mov === 'INGRESO' && !e.info) {
      e.info = { fecha: texto(f.getCell(C.fechaProduccion)), turno: texto(f.getCell(C.turno)), linea: texto(f.getCell(C.linea)),
        presentacion: texto(f.getCell(C.presentacion)), congelamiento: texto(f.getCell(C.congelamiento)), idPres: texto(f.getCell(C.idPres)),
        pesoBulto: texto(f.getCell(C.pesoBulto)), motivo: texto(f.getCell(C.motivoIngreso)) };
    }
  } else if (estatus) {
    e.salidas.push({ estatus, motivo: texto(f.getCell(C.motivoSalida)), fecha: texto(f.getCell(C.fechaDespacho)),
      contenedor: texto(f.getCell(C.contenedor)), proforma: texto(f.getCell(C.proforma)), cliente: texto(f.getCell(C.cliente)) });
  }
  excel.set(clave, e);
});
if (sinAlmacen.size) console.log(`  ALMACEN sin equivalente en el ERP (no se tocan): ${[...sinAlmacen].join(' · ')}`);

/** Por qué ya no está, según el Excel: la salida más reciente. */
function porQueSalio(e) {
  const s = [...e.salidas].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))[0];
  if (!s) return 'el Excel ya no lo tiene como ALMACENADO';
  return `el Excel lo tiene ${s.estatus}` + (s.fecha ? ` el ${dma(s.fecha)}` : '') + (s.cliente ? ` a ${s.cliente}` : '') +
    (s.proforma && !/object/.test(s.proforma) ? `, proforma ${s.proforma}` : '') + (s.contenedor ? `, contenedor ${s.contenedor}` : '') +
    (s.motivo && s.motivo !== s.estatus ? ` (${s.motivo.trim()})` : '');
}

/* ---------------- El ERP ---------------- */
const existencias = await ejecutarSQL(`
  select l.id lote_id, l.codigo_pallet p, s.codigo c, e.almacen_id, e.bultos, e.peso_neto_kg kg
    from lotes l join sku_presentaciones sp on sp.id = l.sku_presentacion_id join skus s on s.id = sp.sku_id
    left join existencias e on e.lote_id = l.id and (e.bultos > 0 or e.peso_neto_kg > 0)`);
const erp = new Map();   // pallet|codigo → { lotes:Set, almacenes: Map(id → [{lote_id, bultos, kg}]) }
for (const x of existencias) {
  const k = `${String(x.p).replace(/\s+/g, ' ')}|${x.c}`;
  const r = erp.get(k) ?? { lotes: new Set(), almacenes: new Map() };
  r.lotes.add(Number(x.lote_id));
  if (x.almacen_id) {
    const l = r.almacenes.get(Number(x.almacen_id)) ?? [];
    l.push({ lote_id: Number(x.lote_id), bultos: Number(x.bultos), kg: Number(x.kg) });
    r.almacenes.set(Number(x.almacen_id), l);
  }
  erp.set(k, r);
}
const presentaciones = await ejecutarSQL(`
  select sp.id, s.codigo, p.descripcion, p.congelamiento::text congelamiento, p.peso_bulto_kg, p.codigo id_pres
    from sku_presentaciones sp join skus s on s.id = sp.sku_id join presentaciones p on p.id = sp.presentacion_id where sp.activo and (s.activo${ACTIVAR.length ? ` or s.codigo in (${ACTIVAR.map(q).join(',')})` : ''})`);
const lineas = await ejecutarSQL('select id, nombre from lineas_procesadoras');
const recibeProduccion = new Set((await ejecutarSQL('select id from almacenes where recibe_produccion and activo')).map((x) => Number(x.id)));
const camaraDe = new Map((await ejecutarSQL('select id, almacen_id from camaras')).map((x) => [Number(x.almacen_id), Number(x.id)]));
/* Los lotes de los pallets excluidos no entran en el seguro: otra corrección los cambia. */
const excluidos = [...new Set(existencias.filter((x) => EXCLUIR.has(`${String(x.p).replace(/\s+/g, ' ')}|${x.c}`)).map((x) => Number(x.lote_id)))];
const FUERA = excluidos.length ? ` and lote_id <> all(array[${excluidos.join(',')}]::bigint[])` : '';
const [antes] = await ejecutarSQL(`select coalesce(sum(peso_neto_kg),0)::numeric(14,3) kg, count(*) n from existencias where bultos > 0${FUERA}`);

function presentacionDe(e) {
  const del = presentaciones.filter((p) => p.codigo === e.codigo);
  const norm = (s) => sinTildes(String(s ?? '')).replace(/\s+/g, '');
  const cong = norm(e.info.congelamiento);
  const porPres = del.filter((p) => norm(p.descripcion) === norm(e.info.presentacion));
  const cand = porPres.length ? porPres : del.filter((p) => Number(p.peso_bulto_kg) === Number(String(e.info.pesoBulto).replace(/[^\d.]/g, '')));
  const conCong = cand.filter((p) => !cong || norm(p.congelamiento) === cong);
  const final = conCong.length ? conCong : cand;
  return final.length === 1 ? final[0].id : final.length > 1 ? final[0].id : null;
}

/* ---------------- El plan ---------------- */
const ops = [];
const pendientes = [];
const tot = { nuevos: 0, kgNuevos: 0, mas: 0, menos: 0, n: 0 };
const claves = new Set([...excel.keys(), ...erp.keys()]);
for (const k of claves) {
  if (EXCLUIR.has(k)) continue;
  const e = excel.get(k);
  const r = erp.get(k);
  const destino = new Map([...(e?.almacenes ?? new Map())].filter(([, x]) => x.kg > 0.5));

  /* ---- No existe en el ERP: alta ---- */
  if (!r) {
    if (!destino.size) continue;
    const sp = e.info ? presentacionDe(e) : null;
    if (!sp) { pendientes.push(`${e.pallet} · CODIGO ${e.codigo}: el producto/presentación no existe en el ERP (${e.info?.presentacion ?? '?'} ${e.info?.congelamiento ?? ''})`); continue; }
    const linea = lineas.find((l) => sinTildes(l.nombre) === sinTildes(e.info.linea))?.id ?? null;
    for (const [a, x] of destino) {
      const bultos = Math.max(1, Math.ceil(x.bultos - 1e-9));
      ops.push({ t: recibeProduccion.has(a) ? 'ingreso' : 'alta_externa', pallet: e.pallet, sp, almacen: a, camara: camaraDe.get(a) ?? null,
        bultos, kg: +x.kg.toFixed(3), fecha: e.info.fecha, turno: /NOCHE/i.test(e.info.turno) ? 'noche' : 'dia', linea,
        proceso: /MAQUILA/i.test(e.info.motivo) ? 'maquila' : 'propia',
        detalle: `Conciliación 13/11 con el Excel de Operaciones (${path.basename(ARCHIVO)}): pallet en cámara que no se había registrado en el ERP` +
          (e.info.motivo ? ` (MOTIVO INGRESO: ${e.info.motivo})` : '') + '.' });
      tot.nuevos++; tot.kgNuevos += x.kg; tot.n++;
    }
    continue;
  }

  /* ---- Existe: cantidad y ubicación ---- */
  const almacenes = new Set([...r.almacenes.keys(), ...destino.keys()]);
  const loteBase = [...r.lotes][0];
  const ubicacionDistinta = destino.size > 0 && [...r.almacenes.keys()].some((a) => !destino.has(a));
  for (const a of almacenes) {
    const lista = r.almacenes.get(a) ?? [];
    const kgErp = lista.reduce((t, x) => t + x.kg, 0);
    const bErp = lista.reduce((t, x) => t + x.bultos, 0);
    const objetivo = destino.get(a);
    const kgObj = objetivo ? objetivo.kg : 0;
    const bObj = objetivo ? Math.max(1, Math.ceil(objetivo.bultos - 1e-9)) : 0;
    const dKg = kgObj - kgErp;
    if (Math.abs(dKg) <= 0.5 && bObj === bErp) continue;
    const motivoTexto = !objetivo
      ? (ubicacionDistinta ? `según el Excel este pallet está en otro almacén (${[...destino.keys()].join(', ')})` : porQueSalio(e ?? { salidas: [] }))
      : kgErp === 0 ? 'según el Excel este pallet está en este almacén'
      : `el Excel tiene ${kgObj.toFixed(1)} kg / ${bObj} bultos y el ERP ${kgErp.toFixed(1)} kg / ${bErp} bultos`;
    const motivo = ubicacionDistinta ? MOTIVO_UBICACION : MOTIVO_ERROR;
    const detalle = `Conciliación 13/11 con el Excel de Operaciones (${path.basename(ARCHIVO)}): ${motivoTexto}.`;
    if (dKg < -0.5 || (Math.abs(dKg) <= 0.5 && bObj < bErp)) {
      //  Se resta de cada lote de ese almacén hasta llegar al objetivo.
      let quitarKg = -dKg, quitarB = bErp - bObj;
      for (const x of lista) {
        if (quitarKg <= 0.5 && quitarB <= 0) break;
        const ultimo = x === lista[lista.length - 1];
        const kgL = ultimo ? quitarKg : Math.min(x.kg, quitarKg);
        const bL = kgObj === 0 ? x.bultos : ultimo ? quitarB : Math.min(x.bultos, Math.max(0, quitarB));
        if (kgL <= 0.0005) continue;
        ops.push({ t: 'ajuste', tipo: 'ajuste_negativo', lote: x.lote_id, almacen: a, bultos: Math.max(0, bL), kg: +kgL.toFixed(3), motivo, detalle });
        quitarKg -= kgL; quitarB -= bL; tot.menos += kgL; tot.n++;
      }
    } else if (dKg > 0.5) {
      const lote = lista[0]?.lote_id ?? loteBase;
      ops.push({ t: 'ajuste', tipo: 'ajuste_positivo', lote, almacen: a, bultos: Math.max(0, bObj - bErp), kg: +dKg.toFixed(3), motivo, detalle });
      tot.mas += dKg; tot.n++;
    }
  }
}

/* ---------------- El SQL ---------------- */
const kgEsperado = Number(antes.kg) - tot.menos + tot.mas + tot.kgNuevos;
const sql = `-- ============================================================================
--  CONCILIACIÓN DEL STOCK CON ${path.basename(ARCHIVO)} · generado ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}
--  ${ops.length} operaciones: ${tot.nuevos} pallets nuevos (${(tot.kgNuevos / 1000).toFixed(1)} TM),
--  ajustes que suman ${(tot.mas / 1000).toFixed(1)} TM y que restan ${(tot.menos / 1000).toFixed(1)} TM.
--  Stock físico: ${(Number(antes.kg) / 1000).toFixed(1)} TM → ${(kgEsperado / 1000).toFixed(1)} TM.
--  TODO O NADA. Generado por scripts/aplicar-conciliacion.mjs.
-- ============================================================================
begin;
select set_config('request.jwt.claims', '{"sub":"${USUARIO}","role":"authenticated"}', true);
set local role authenticated;
do $conciliar$
declare
  o jsonb; v_lote bigint; v_costo numeric; v_kg numeric; v_n int;
  ops jsonb := ${q(JSON.stringify(ops))}::jsonb;
begin
  ${REQUIERE ? `if not (${REQUIERE}) then raise exception 'Falta el paso anterior (limpieza): ejecútelo primero.'; end if;` : ''}
  ${ACTIVAR.length ? `update skus set activo = true where codigo in (${ACTIVAR.map(q).join(',')}) and not activo;  -- en producción y con stock en cámara` : ''}
  select coalesce(sum(peso_neto_kg),0)::numeric(14,3), count(*) into v_kg, v_n from existencias where bultos > 0${FUERA};
  if v_kg <> ${Number(antes.kg).toFixed(3)} or v_n <> ${Number(antes.n)} then
    raise exception 'El stock cambió desde que se generó este archivo (% kg en % filas; se esperaba ${Number(antes.kg).toFixed(3)} en ${antes.n}). Vuelva a generarlo.', v_kg, v_n;
  end if;

  for o in select * from jsonb_array_elements(ops) loop
    if o->>'t' = 'ajuste' then
      perform stock_ajustar((o->>'lote')::bigint, (o->>'almacen')::bigint, (o->>'tipo')::tipo_movimiento,
                            (o->>'bultos')::int, (o->>'kg')::numeric, (o->>'motivo')::bigint, o->>'detalle', true);
    else
      insert into lotes (codigo_pallet, campania, sku_presentacion_id, fecha_produccion, turno, proceso, planta_id,
                         linea_procesadora_id, bultos_iniciales, peso_neto_inicial_kg, costo_unitario, observaciones, creado_por)
      values (o->>'pallet', extract(year from (o->>'fecha')::date)::int, (o->>'sp')::bigint, (o->>'fecha')::date,
              (o->>'turno')::turno_operativo, (o->>'proceso')::tipo_proceso, 1, nullif(o->>'linea','')::bigint, (o->>'bultos')::int, (o->>'kg')::numeric, 0,
              o->>'detalle', '${USUARIO}')
      returning id, costo_unitario into v_lote, v_costo;
      if o->>'t' = 'ingreso' then
        insert into movimientos (tipo, lote_id, almacen_id, camara_id, bultos, peso_neto_kg, costo_unitario, documento_tipo,
                                 documento_ref, usuario_id, observaciones, origen_ingreso)
        values ('ingreso', v_lote, (o->>'almacen')::bigint, nullif(o->>'camara','')::bigint, (o->>'bultos')::int, (o->>'kg')::numeric,
                v_costo, 'ingreso', 'ING-' || lpad(v_lote::text, 6, '0'), '${USUARIO}', o->>'detalle', 'produccion');
      else
        perform stock_ajustar(v_lote, (o->>'almacen')::bigint, 'ajuste_positivo', (o->>'bultos')::int, (o->>'kg')::numeric,
                              ${MOTIVO_ERROR}, (o->>'detalle') || ' Almacén externo: no recibe ingresos de producción, entra como ajuste.', true);
      end if;
    end if;
  end loop;

  select coalesce(sum(peso_neto_kg),0)::numeric(14,3) into v_kg from existencias where bultos > 0${FUERA};
  if abs(v_kg - ${kgEsperado.toFixed(3)}) > 1 then
    raise exception 'El resultado no cuadra: % kg, se esperaban ${kgEsperado.toFixed(3)}. No se aplicó nada.', v_kg;
  end if;
  raise notice 'Conciliación aplicada: stock físico % kg', v_kg;
end $conciliar$;
select round(fisico_kg/1000,1) fisico_tm, round(bloqueado_kg/1000,1) bloqueado_tm, round(reservado_kg/1000,1) reservado_tm,
       round(disponible_kg/1000,1) disponible_tm from v_resumen_inventario;
commit;
`;
writeFileSync(SALIDA, sql);
console.log(`\n  operaciones ............ ${ops.length}`);
console.log(`  pallets nuevos ......... ${tot.nuevos} (${(tot.kgNuevos / 1000).toFixed(1)} TM) · ingresos ${ops.filter((o) => o.t === 'ingreso').length}, en almacén externo ${ops.filter((o) => o.t === 'alta_externa').length}`);
console.log(`  ajustes que suman ...... ${(tot.mas / 1000).toFixed(1)} TM`);
console.log(`  ajustes que restan ..... ${(tot.menos / 1000).toFixed(1)} TM`);
console.log(`  stock físico ........... ${(Number(antes.kg) / 1000).toFixed(1)} → ${(kgEsperado / 1000).toFixed(1)} TM`);
if (pendientes.length) console.log(`\n  NO SE PUEDEN CREAR (${pendientes.length}):\n   · ${pendientes.join('\n   · ')}`);
console.log(`\n  SQL: ${path.resolve(SALIDA)}`);
