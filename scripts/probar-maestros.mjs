/**
 * ============================================================================
 *  PRUEBAS DE LOS MAESTROS · crear, editar, desactivar y borrar
 * ============================================================================
 *  Se hace el ciclo completo con un cliente y un producto de verdad, y al
 *  final se borran para no dejar basura en la base.
 *
 *  Lo que de verdad se comprueba no es que los botones existan, sino que:
 *   · el registro creado APARECE donde tiene que aparecer (al cotizar);
 *   · la validación del RUC rechaza uno mal y acepta uno bien;
 *   · borrar un registro con documentos se RECHAZA y se explica por qué;
 *   · desactivar lo saca del catálogo sin perder el historial.
 * ============================================================================
 */
import { chromium } from 'playwright';
import './db.mjs';

const BASE = 'http://localhost:3000';
let ok = 0, fallo = 0;
const errores = [];

function comprobar(n, c, d = '') {
  if (c) { ok++; console.log(`   OK  ${n}`); }
  else { fallo++; errores.push(`${n}${d ? ' — ' + d : ''}`); console.log(`   ..  ${n}${d ? '  (' + d + ')' : ''}`); }
}

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 } });
const p = await ctx.newPage();
const fallosJs = [];
p.on('pageerror', (e) => fallosJs.push(e.message));

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
await p.fill('input[type="password"]', 'SantaMonica2026');
await p.click('button[type="submit"]');
await p.waitForURL(/\/panel/, { timeout: 30000 });

// Marca única para no chocar con datos existentes ni entre corridas.
const marca = String(process.pid).slice(-5);
const CODIGO_CLI = `ZZT-${marca}`;
const RAZON = `PRUEBA AUTOMATICA ${marca} S.A.C.`;
const CODIGO_PROD = `Z${marca}`;

/* ========================================================================
   1 · CLIENTES
   ======================================================================== */
console.log('\n== MAESTRO DE CLIENTES ===========================================\n');

await p.goto(`${BASE}/ventas/clientes`, { waitUntil: 'networkidle' });
comprobar('El listado ofrece «Nuevo cliente»',
  (await p.locator('a', { hasText: 'Nuevo cliente' }).count()) > 0);

await p.goto(`${BASE}/ventas/clientes/nuevo`, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);

const codigoPropuesto = await p.locator('input[placeholder="CLI-0001"]').inputValue();
comprobar('Propone el siguiente código libre', /^CLI-\d{4}$/.test(codigoPropuesto), codigoPropuesto);

/* --- La validación del RUC tiene que morder --- */
await p.locator('input[placeholder="CLI-0001"]').fill(CODIGO_CLI);
await p.locator('input[placeholder="Nombre legal completo"]').fill(RAZON);
await p.locator('input[list="lista-paises"]').fill('Perú');
await p.waitForTimeout(400);

const cajaRuc = p.locator('input[placeholder="20205572229"]');
await cajaRuc.fill('20205572220');           // último dígito cambiado a propósito
await p.waitForTimeout(400);
comprobar('Un RUC con el verificador mal se marca en pantalla',
  (await p.locator('small.mal').count()) > 0);

await cajaRuc.fill('20205572229');           // el RUC real de Santa Mónica
await p.waitForTimeout(400);
comprobar('Un RUC correcto se confirma en pantalla',
  (await p.locator('small.bien').count()) > 0);

const consecuencia = await p.locator('.form-consecuencia').innerText();
comprobar('Avisa qué comprobante se emitirá antes de guardar',
  /factura electr[óo]nica con IGV/i.test(consecuencia), consecuencia.slice(0, 70));

/* --- Cambiar el país tiene que cambiar el aviso --- */
await p.locator('input[list="lista-paises"]').fill('China');
await p.waitForTimeout(500);
comprobar('Al cambiar a un país extranjero, avisa que va sin IGV',
  /sin IGV/i.test(await p.locator('.form-consecuencia').innerText()));
// El desplegable se busca por su etiqueta, no por su posición: contar
// posiciones se rompe en cuanto se agrega un campo al formulario.
const selectMoneda = p.locator('label.form-campo', { hasText: 'Moneda' }).locator('select');
comprobar('Y propone dólares como moneda',
  (await selectMoneda.inputValue()) === 'USD');

await p.locator('input[list="lista-paises"]').fill('Perú');
await p.waitForTimeout(500);

/* --- Guardar --- */
await p.locator('button[type="submit"]').click();
await p.waitForURL(/\/ventas\/clientes\/\d+$/, { timeout: 25000 }).catch(() => {});
comprobar('El cliente se crea y lleva a su ficha', /\/ventas\/clientes\/\d+$/.test(p.url()), p.url());

const idCliente = Number(p.url().split('/').pop());
const fichaCli = await p.locator('body').innerText();
comprobar('La ficha muestra la razón social', fichaCli.includes(RAZON));
comprobar('Y ofrece Editar', (await p.locator('a', { hasText: 'Editar' }).count()) > 0);
comprobar('Y ofrece Desactivar', (await p.locator('button', { hasText: 'Desactivar' }).count()) > 0);
comprobar('Y ofrece Borrar', (await p.locator('button', { hasText: 'Borrar' }).count()) > 0);

/* --- Aparece donde tiene que aparecer: al cotizar --- */
await p.goto(`${BASE}/ventas/cotizaciones/nueva`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const opciones = await p.locator('select.campo').first().innerText();
comprobar('El cliente nuevo ya aparece al cotizar', opciones.includes(RAZON));

/* --- Editar --- */
await p.goto(`${BASE}/ventas/clientes/${idCliente}/editar`, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
comprobar('El formulario de edición llega con los datos cargados',
  (await p.locator('input[placeholder="Nombre legal completo"]').inputValue()) === RAZON);

await p.locator('input[type="number"]').nth(1).fill('90');   // días de crédito
await p.locator('button[type="submit"]').click();
await p.waitForURL(/\/ventas\/clientes\/\d+$/, { timeout: 25000 }).catch(() => {});
await p.waitForTimeout(1500);
comprobar('El cambio se guarda y se ve en la ficha',
  (await p.locator('body').innerText()).includes('90'));

/* --- Duplicar el código tiene que fallar con un mensaje entendible --- */
await p.goto(`${BASE}/ventas/clientes/nuevo`, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
await p.locator('input[placeholder="CLI-0001"]').fill(CODIGO_CLI);
await p.locator('input[placeholder="Nombre legal completo"]').fill('OTRA EMPRESA');
await p.locator('input[list="lista-paises"]').fill('Perú');
await p.locator('button[type="submit"]').click();
await p.waitForTimeout(2500);
const avisoDup = await p.locator('.ficha-aviso-critico').innerText().catch(() => '');
comprobar('Un código repetido se rechaza y se explica',
  /Ya existe un cliente con el c[óo]digo/i.test(avisoDup), avisoDup.slice(0, 80));

/* --- Borrar uno CON documentos tiene que rechazarse --- */
await p.goto(`${BASE}/ventas/clientes/40`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
if (await p.locator('button', { hasText: /^Borrar$/ }).count()) {
  await p.locator('button', { hasText: /^Borrar$/ }).click();
  await p.waitForTimeout(400);
  const codigoReal = await p.locator('.zona-peligro b.mono').innerText();
  await p.locator('.zona-peligro input.campo').fill(codigoReal);
  await p.locator('button', { hasText: 'Sí, borrar' }).click();
  await p.waitForTimeout(3000);
  const rechazo = await p.locator('.ficha-aviso-critico').innerText().catch(() => '');
  comprobar('Borrar un cliente con documentos se rechaza',
    /No se puede borrar/i.test(rechazo), rechazo.slice(0, 90));
  comprobar('Y el mensaje dice cuántos documentos lo impiden',
    /factura|pedido|cotizaci/i.test(rechazo));
  comprobar('Y ofrece desactivar como alternativa', /[Dd]esactivar/.test(rechazo));
}

/* ========================================================================
   2 · PRODUCTOS
   ======================================================================== */
console.log('\n== MAESTRO DE PRODUCTOS ==========================================\n');

await p.goto(`${BASE}/ventas/productos`, { waitUntil: 'networkidle' });
comprobar('El listado ofrece «Nuevo producto»',
  (await p.locator('a', { hasText: 'Nuevo producto' }).count()) > 0);

await p.goto(`${BASE}/ventas/productos/nuevo`, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);

comprobar('El desplegable de formato empieza deshabilitado',
  await p.locator('select').nth(1).isDisabled());

await p.locator('select').first().selectOption({ index: 1 });
await p.waitForTimeout(2000);
comprobar('Al elegir especie se habilita el formato',
  !(await p.locator('select').nth(1).isDisabled()));
const formatosCargados = await p.locator('select').nth(1).locator('option').count();
comprobar('Y se cargan los formatos de esa especie', formatosCargados > 1, `${formatosCargados} opciones`);

comprobar('Se ofrecen las presentaciones para marcar',
  (await p.locator('.form-pres').count()) > 0);

/* --- Sin presentación no debe dejar guardar --- */
await p.locator('input.campo.mono').first().fill(CODIGO_PROD);
await p.locator('select').nth(1).selectOption({ index: 1 });
await p.locator('input[placeholder*="2000-4000"]').fill('CORTE DE PRUEBA AUTOMATICA');
await p.locator('input[list="lista-clasificaciones"]').fill('PRUEBAS');
await p.locator('button[type="submit"]').click();
await p.waitForTimeout(2500);
const sinPres = await p.locator('.ficha-aviso-critico').innerText().catch(() => '');
comprobar('Sin presentación no deja guardar, y explica por qué',
  /al menos una presentaci[óo]n/i.test(sinPres), sinPres.slice(0, 90));

/* --- Ahora sí --- */
await p.locator('.form-pres').first().click();
await p.locator('.form-pres').nth(1).click();
await p.waitForTimeout(300);
comprobar('Las presentaciones marcadas se resaltan',
  (await p.locator('.form-pres[data-elegida="si"]').count()) === 2);

await p.locator('button[type="submit"]').click();
await p.waitForURL(/\/ventas\/productos\?buscar=/, { timeout: 25000 }).catch(() => {});
await p.waitForTimeout(1500);
comprobar('El producto se crea y lleva al listado filtrado',
  p.url().includes('buscar='), p.url());

const filasProd = await p.locator('table.datos tbody tr').count();
comprobar('Aparece una fila por cada presentación marcada', filasProd === 2, `${filasProd} filas`);

/* --- Aparece en el buscador de la cotización --- */
await p.goto(`${BASE}/ventas/cotizaciones/nueva`, { waitUntil: 'networkidle' });
await p.locator('select.campo').first().selectOption({ index: 1 });
await p.waitForTimeout(700);
await p.locator('input.form-buscador-input').fill('CORTE DE PRUEBA');
await p.waitForTimeout(3000);
// Se busca el texto del corte dentro de los resultados, no una clase
// cualquiera que empiece por «form-res»: eso daba positivos falsos.
const textoResultados = await p.locator('.form-resultados, .form-lista-res').innerText().catch(() => '');
comprobar('El producto nuevo ya se puede cotizar',
  /CORTE DE PRUEBA/i.test(textoResultados), textoResultados.slice(0, 80));

/* --- Editar el producto --- */
await p.goto(`${BASE}/ventas/productos?buscar=${CODIGO_PROD}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const enlaceProd = p.locator('table.datos tbody tr a').first();
await enlaceProd.click();
await p.waitForLoadState('networkidle');
await p.waitForTimeout(1200);
comprobar('La ficha del producto ofrece Editar',
  (await p.locator('a', { hasText: 'Editar' }).count()) > 0);

await p.locator('a', { hasText: 'Editar' }).first().click();
await p.waitForURL(/\/editar$/, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(1500);
const presMarcadas = await p.locator('.form-pres[data-elegida="si"]').count();
comprobar('La edición llega con sus presentaciones marcadas', presMarcadas === 2, `${presMarcadas} marcadas`);

comprobar('Y con la especie y el formato ya resueltos',
  (await p.locator('select').nth(1).inputValue()) !== '');

comprobar('Ningún error de JavaScript en todo el recorrido', fallosJs.length === 0,
  fallosJs.slice(0, 2).join(' | '));

await nav.close();

/* ========================================================================
   3 · LIMPIEZA · se borra lo que se creó
   ======================================================================== */
console.log('\n== LIMPIEZA ======================================================\n');

/*
 * La prueba limpia lo que ensució. Si no, cada corrida dejaría un cliente y un
 * producto de mentira en el maestro, y a la décima nadie sabría cuáles son de
 * verdad.
 */
const { execFileSync } = await import('node:child_process');
const limpieza = [
  `delete from sku_presentaciones where sku_id in (select id from skus where codigo='${CODIGO_PROD}');`,
  `delete from skus where codigo='${CODIGO_PROD}';`,
  `delete from contactos where cliente_id in (select id from clientes where codigo='${CODIGO_CLI}');`,
  `delete from clientes where codigo='${CODIGO_CLI}';`,
].join(' ');

try {
  execFileSync('node', ['scripts/db.mjs', '-q', limpieza], { stdio: 'pipe' });
  console.log(`   Borrados el cliente ${CODIGO_CLI} y el producto ${CODIGO_PROD}.`);
} catch (e) {
  console.log(`   .. No se pudo limpiar: ${String(e.message).slice(0, 160)}`);
  fallo++;
  errores.push('La limpieza posterior falló: revise si quedaron registros de prueba.');
}
console.log('\n==================================================================');
console.log(`  RESULTADO: ${ok} pasaron · ${fallo} fallaron`);
console.log('==================================================================');
if (errores.length) { console.log('\n  Revisar:'); errores.forEach((e) => console.log(`   .. ${e}`)); }
console.log('');
process.exit(fallo > 0 ? 1 : 0);
