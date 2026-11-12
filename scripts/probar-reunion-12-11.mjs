#!/usr/bin/env node
/**
 * Prueba de pantallas de la reunión del 12/11 (Oliver y Dany):
 * existencias por corte y familia, despachos (eliminar + historial) y packing.
 */
import { createClient } from '@supabase/supabase-js';
import './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const REF = process.env.SUPABASE_PROJECT_REF;
let ok = 0, fallo = 0;
const comprobar = (n, c, d = '') => { if (c) { ok++; console.log(`   ✓ ${n}`); } else { fallo++; console.log(`   ✗ ${n}  (${d})`); } };

async function cookieDe(rol) {
  const cli = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await cli.auth.signInWithPassword({ email: `${rol}@santamonica.pe`, password: process.env.CLAVE_DEMO ?? '' });
  if (error) throw new Error(`${rol}: ${error.message}`);
  return `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64')}`;
}
async function abrir(cookie, ruta) {
  const r = await fetch(BASE + ruta, { headers: { cookie }, redirect: 'manual' });
  return { status: r.status, html: await r.text() };
}
const sinError = (h) => !/Application error|Unhandled Runtime Error|__next_error__|Algo salió mal/i.test(h);

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: desp } = await admin.from('despachos').select('id, numero').order('id', { ascending: false }).limit(1);
const { data: pk } = await admin.from('packing_lists').select('id, codigo').in('estado', ['abierto', 'en_carga']).limit(1);

for (const rol of ['gerencia', 'almacen']) {
  console.log(`\n== ${rol}`);
  const c = await cookieDe(rol);
  let r = await abrir(c, '/almacenes/existencias?eje=corte');
  comprobar('Existencias · pestaña «Por corte»', r.status === 200 && r.html.includes('Por corte') && sinError(r.html), r.status);
  comprobar('Existencias · filtro Familia', r.html.includes('Familia'), '');
  r = await abrir(c, '/almacenes/existencias?eje=corte&familia=FILETE%20FRESCO%20CP');
  comprobar('Existencias · por corte filtrado por familia', r.status === 200 && sinError(r.html), r.status);
  r = await abrir(c, '/logistica/despachos');
  comprobar('Despachos · enlace a eliminados', r.status === 200 && r.html.includes('Despachos eliminados') && sinError(r.html), r.status);
  r = await abrir(c, '/logistica/despachos?eliminado=Despacho%20X%20eliminado.');
  comprobar('Despachos · aviso de eliminado', r.html.includes('despacho-eliminado'), '');
  r = await abrir(c, '/logistica/despachos/eliminados');
  comprobar('Despachos eliminados · abre', r.status === 200 && sinError(r.html) && r.html.includes('Despachos eliminados'), r.status);
  if (desp?.[0]) {
    r = await abrir(c, `/logistica/despachos/${desp[0].id}`);
    const tiene = r.html.includes('eliminar-despacho');
    comprobar(`Ficha ${desp[0].numero} · ${rol === 'gerencia' ? 'muestra' : 'NO muestra'} «Eliminar despacho»`,
      r.status === 200 && sinError(r.html) && (rol === 'gerencia' ? tiene : !tiene), r.status);
  }
  if (pk?.[0]) {
    r = await abrir(c, `/logistica/packing/${pk[0].id}`);
    comprobar(`Packing ${pk[0].codigo} · abre`, r.status === 200 && sinError(r.html), r.status);
  }
}
console.log(`\n${ok} bien · ${fallo} mal`);
process.exit(fallo ? 1 : 0);
