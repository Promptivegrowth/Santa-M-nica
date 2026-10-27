/**
 * ============================================================================
 *  PRUEBA · MAESTRO DE VENDEDORES EN CONFIGURACIÓN
 * ============================================================================
 *  Configuración › Maestros › Vendedores: alta, edición, nombre repetido,
 *  desactivar (deja de ofrecerse al cotizar), reactivar, no borrar uno usado
 *  y borrar uno sin uso. Y que la opción vacía de la cotización diga «Sin
 *  vendedor». Lo que se crea se borra al final, con su huella de auditoría.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-vendedores.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

const NOMBRE = 'PRUEBA Vendedor Guía';
const [{ inicio }] = await consultar(`select now()::text as inicio`);
const nav = await chromium.launch({ channel: 'chrome', headless: true });

async function entrar(correo) {
  const p = await (await nav.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', correo);
  await p.fill('input[type="password"]', process.env.CLAVE_DEMO ?? '');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 30000 });
  return p;
}
const aviso = async (p) => {
  await p.locator('[data-aviso="vendedores"]').waitFor({ timeout: 20000 });
  return p.locator('[data-aviso="vendedores"]').innerText();
};
const fila = (p, nombre) => p.locator('tr[data-vendedor]', { hasText: nombre });

try {
  const p = await entrar('gerencia@santamonica.pe');
  await p.goto(`${BASE}/configuracion?t=maestros`, { waitUntil: 'networkidle' });
  ok(await p.locator('a.tarjeta-maestro', { hasText: 'Vendedores' }).count() === 1, 'Maestros tiene la tarjeta «Vendedores»');
  await p.goto(`${BASE}/configuracion?t=maestros&m=vendedores`, { waitUntil: 'networkidle' });
  const [{ n: total }] = await consultar(`select count(*)::int n from vendedores`);
  ok(await p.locator('tr[data-vendedor]').count() === total, 'la tabla muestra todos los vendedores', `${total}`);

  // Uno usado no se puede borrar (botón apagado y explica por qué).
  const [usado] = await consultar(`select v.nombre from vendedores v where exists (select 1 from pedidos p where p.vendedor_id = v.id) order by v.id limit 1`);
  const borrarUsado = fila(p, usado.nombre).locator('[data-accion="borrar-vendedor"]');
  ok(await borrarUsado.isDisabled() && /desactiva/.test(await borrarUsado.getAttribute('title') ?? ''), 'uno ya usado no se borra: el botón está apagado y dice que se desactiva', usado.nombre);

  // Alta
  await p.click('[data-accion="nuevo-vendedor"]');
  await p.fill('[data-bloque="formulario-vendedor"] input[name="nombre"]', NOMBRE);
  await p.fill('[data-bloque="formulario-vendedor"] input[name="email"]', 'no-es-correo');
  await p.click('[data-accion="guardar-vendedor"]');
  ok(/no parece un correo/.test(await aviso(p)), 'un correo mal escrito se rechaza');
  await p.fill('[data-bloque="formulario-vendedor"] input[name="email"]', 'ventas@ejemplo.com');
  await p.click('[data-accion="guardar-vendedor"]');
  ok(/agregado/.test(await aviso(p)), 'se da de alta');
  const [creado] = await consultar(`select id, tipo::text, email, activo from vendedores where nombre = '${NOMBRE}'`);
  ok(creado && creado.tipo === 'intermediario' && creado.email === 'ventas@ejemplo.com' && creado.activo, 'queda en la base como intermediario activo');
  const [{ n: huella }] = await consultar(`select count(*)::int n from auditoria where tabla = 'vendedores' and registro_id::text = '${creado.id}' and ocurrido_en > '${inicio}'`);
  ok(huella >= 1, 'y deja huella en la auditoría');

  // Nombre repetido (otra mayúscula y espacios)
  await p.click('[data-accion="nuevo-vendedor"]');
  await p.fill('[data-bloque="formulario-vendedor"] input[name="nombre"]', `  ${NOMBRE.toLowerCase()} `);
  await p.click('[data-accion="guardar-vendedor"]');
  ok(/Ya existe/.test(await aviso(p)), 'no se repite un nombre aunque cambien mayúsculas o espacios');
  await p.getByRole('button', { name: 'Cancelar', exact: true }).click();

  // Edición
  await fila(p, NOMBRE).locator('[data-accion="editar-vendedor"]').click();
  await p.selectOption('[data-bloque="formulario-vendedor"] select[name="tipo"]', 'final');
  await p.click('[data-accion="guardar-vendedor"]');
  ok(/actualizado/.test(await aviso(p)), 'se edita');
  const [editado] = await consultar(`select tipo::text from vendedores where id = ${creado.id}`);
  ok(editado.tipo === 'final', 'el tipo cambió a venta directa');

  // En la cotización: aparece mientras está activo; la opción vacía dice «Sin vendedor».
  const opciones = async () => {
    await p.goto(`${BASE}/ventas/cotizaciones/nueva`, { waitUntil: 'networkidle' });
    return p.locator('.form-venta select').nth(1).locator('option').allInnerTexts();
  };
  let ops = await opciones();
  ok(ops[0] === 'Sin vendedor', 'la opción vacía de la cotización dice «Sin vendedor»', ops[0]);
  ok(ops.includes(NOMBRE), 'el vendedor nuevo ya se ofrece al cotizar');

  // Desactivar: deja de ofrecerse
  await p.goto(`${BASE}/configuracion?t=maestros&m=vendedores`, { waitUntil: 'networkidle' });
  await fila(p, NOMBRE).locator('[data-accion="desactivar-vendedor"]').click();
  ok(/desactivado/.test(await aviso(p)), 'se desactiva');
  ops = await opciones();
  ok(!ops.includes(NOMBRE), 'desactivado, ya no se ofrece al cotizar');

  // Reactivar y borrar (no tiene usos)
  await p.goto(`${BASE}/configuracion?t=maestros&m=vendedores`, { waitUntil: 'networkidle' });
  await fila(p, NOMBRE).locator('[data-accion="reactivar-vendedor"]').click();
  ok(/vuelve a ofrecerse/.test(await aviso(p)), 'se reactiva');
  await p.reload({ waitUntil: 'networkidle' });
  await fila(p, NOMBRE).locator('[data-accion="borrar-vendedor"]').click();
  await p.click('[data-accion="confirmar-borrar-vendedor"]');
  ok(/borrado/.test(await aviso(p)), 'uno sin usos se borra, con confirmación');
  const [{ n: queda }] = await consultar(`select count(*)::int n from vendedores where nombre = '${NOMBRE}'`);
  ok(queda === 0, 'ya no está en la base');

  // Operaciones también administra; Comercial no entra a Configuración.
  const o = await entrar('operaciones@santamonica.pe');
  await o.goto(`${BASE}/configuracion?t=maestros&m=vendedores`, { waitUntil: 'networkidle' });
  ok(await o.locator('[data-accion="nuevo-vendedor"]').count() === 1, 'Operaciones también puede dar de alta');
  const c = await entrar('comercial@santamonica.pe');
  await c.goto(`${BASE}/configuracion?t=maestros&m=vendedores`, { waitUntil: 'networkidle' });
  ok(!/\/configuracion/.test(c.url()), 'Comercial no entra a Configuración', c.url().replace(BASE, ''));
} catch (e) {
  ok(false, e.message);
} finally {
  await consultar(`delete from vendedores where nombre ilike '%prueba vendedor guía%'`);
  await consultar(`delete from auditoria where tabla = 'vendedores' and ocurrido_en > '${inicio}'`);
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLA(S):\n - ${fallos.join('\n - ')}` : '\nTodo en orden.');
process.exit(fallos.length ? 1 : 0);
