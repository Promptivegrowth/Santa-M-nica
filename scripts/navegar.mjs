#!/usr/bin/env node
/**
 * ============================================================================
 *  NAVEGADOR DE PRUEBAS · usar el ERP como lo usa una persona
 * ============================================================================
 *  Las otras pruebas piden páginas con fetch y miran el HTML. Eso confirma que
 *  el servidor responde, pero no que la aplicación SE PUEDA USAR: no pulsa
 *  nada, no espera a que React hidrate y no ve un error de JavaScript.
 *
 *  Este arranca Chrome de verdad, inicia sesión como una persona y hace clic.
 *  Recoge tres cosas que ninguna prueba anterior veía:
 *
 *   · Errores de la consola del navegador (incluidas las discrepancias de
 *     hidratación, que solo existen en el cliente).
 *   · Peticiones que fallan.
 *   · A dónde lleva de verdad cada enlace, después de navegar.
 *
 *  Uso:
 *     node scripts/navegar.mjs                 recorrido completo
 *     node scripts/navegar.mjs alertas         solo ese recorrido
 *     node scripts/navegar.mjs --ver           con ventana visible
 * ============================================================================
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import './db.mjs';

const BASE = process.env.URL_PRUEBA ?? 'http://localhost:3000';
const VISIBLE = process.argv.includes('--ver');
const SOLO = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CAPTURAS = 'capturas';

let ok = 0;
let fallo = 0;
const errores = [];

function comprobar(nombre, condicion, detalle = '') {
  if (condicion) {
    ok++;
    console.log(`   OK  ${nombre}`);
  } else {
    fallo++;
    errores.push(`${nombre}${detalle ? ' — ' + detalle : ''}`);
    console.log(`   ..  ${nombre}${detalle ? '  (' + detalle + ')' : ''}`);
  }
}

function titulo(t) {
  console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 62 - t.length))}`);
}

/* --------------------------------------------------------------------------
   Ruido de consola que no es culpa nuestra y no aporta nada.
   -------------------------------------------------------------------------- */
const RUIDO = [
  /favicon/i,
  /Download the React DevTools/i,
  /webpack-hmr/i,
];

async function principal() {
  console.log('================================================================');
  console.log('  RECORRIDO CON NAVEGADOR REAL');
  console.log('================================================================');

  fs.mkdirSync(CAPTURAS, { recursive: true });

  const navegador = await chromium.launch({ channel: 'chrome', headless: !VISIBLE });
  const contexto = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const pagina = await contexto.newPage();

  /* ---- Todo lo que el navegador se queje, se guarda ---- */
  const consola = [];
  const fallosRed = [];
  pagina.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const t = m.text();
    if (RUIDO.some((r) => r.test(t))) return;
    consola.push(`[${m.type()}] ${t}`);
  });
  pagina.on('pageerror', (e) => consola.push(`[pageerror] ${e.message}`));
  pagina.on('requestfailed', (r) => {
    if (RUIDO.some((x) => x.test(r.url()))) return;
    /*
     * ERR_ABORTED significa que el NAVEGADOR cancelo la peticion, nunca que
     * el servidor fallara. Pasa en dos casos normales: Next precarga las
     * pantallas cuyos enlaces estan a la vista y se navega antes de que
     * terminen, y una accion de servidor queda superada por otra posterior.
     *
     * Un fallo de verdad llega como ERR_CONNECTION_REFUSED o ERR_FAILED, y
     * esos si se recogen. Que el resultado sea correcto se comprueba mirando
     * la pantalla, no la red: por eso arriba se verifica que la linea
     * agregada acaba con precio.
     */
    if (r.failure()?.errorText === 'net::ERR_ABORTED') return;
    fallosRed.push(`${r.failure()?.errorText} ${r.url()}`);
  });

  const captura = (n) => pagina.screenshot({ path: path.join(CAPTURAS, `${n}.png`), fullPage: false });

  /* ══════════════════════════════════════════════════════════════════════
     ENTRAR
     ══════════════════════════════════════════════════════════════════════ */
  titulo('Entrar al sistema');
  await pagina.goto(`${BASE}/login`, { waitUntil: 'networkidle' });

  await pagina.fill('input[type="email"]', 'gerencia@santamonica.pe');
  await pagina.fill('input[type="password"]', 'SantaMonica2026');
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/\/panel/, { timeout: 25000 });
  comprobar('Se inicia sesión y se llega al panel', pagina.url().includes('/panel'), pagina.url());
  await captura('01-panel');

  const recorridos = {
    /* ════════════════════════════════════════════════════════════════════
       ALERTAS · el motivo de este archivo
       ════════════════════════════════════════════════════════════════════ */
    async alertas() {
      titulo('Cada alerta lleva a algo útil');
      await pagina.goto(`${BASE}/alertas`, { waitUntil: 'networkidle' });

      const filas = pagina.locator('.lista-alertas-nav li');
      const total = await filas.count();
      comprobar('La lista de alertas trae filas', total > 0, `${total} filas`);

      /* Se prueba UNA alerta de cada tipo de entidad, no todas: lo que se
         verifica es el mapeo, y con una por tipo basta. */
      const vistos = new Set();
      const aProbar = [];
      for (let i = 0; i < total; i++) {
        const fila = filas.nth(i);
        const tipo = (await fila.locator('.pill').first().innerText().catch(() => '')).trim();
        if (!tipo || vistos.has(tipo)) continue;
        vistos.add(tipo);
        const href = await fila.locator('a.alerta-fila').getAttribute('href').catch(() => null);
        const texto = (await fila.locator('strong').first().innerText().catch(() => '')).trim();
        aProbar.push({ tipo, href, texto });
      }

      comprobar('Hay alertas de varios tipos', aProbar.length > 0, [...vistos].join(', '));

      for (const a of aProbar) {
        if (!a.href) {
          comprobar(`Alerta de ${a.tipo} es pulsable`, false, 'sin enlace');
          continue;
        }

        await pagina.goto(`${BASE}${a.href}`, { waitUntil: 'networkidle' });
        const h1 = (await pagina.locator('h1').first().innerText().catch(() => '')).trim();

        /*
         * El listón: la pantalla de destino tiene que hablar DEL REGISTRO que
         * provocó la alerta. Un catálogo genérico de contadores no vale: es
         * exactamente lo que el usuario reportó con el SOAT.
         */
        const utilidad = await pagina.evaluate(() => {
          const cuerpo = document.body.innerText;
          return {
            tieneFicha: !!document.querySelector('.ficha-resumen, .ficha, .datos, .rejilla-kpi'),
            tieneContadoresSolos:
              !!document.querySelector('.catalogo-tarjeta') &&
              !document.querySelector('table.datos'),
            largo: cuerpo.length,
          };
        });

        comprobar(
          `Alerta de ${a.tipo} → ${a.href} muestra el registro`,
          !utilidad.tieneContadoresSolos && utilidad.tieneFicha,
          `h1="${h1}"${utilidad.tieneContadoresSolos ? ' · solo contadores' : ''}`
        );
        await captura(`alerta-${a.tipo.toLowerCase().replace(/\W+/g, '-')}`);
      }

      /* Volver a alertas y pulsar de verdad la primera, con el ratón. */
      await pagina.goto(`${BASE}/alertas`, { waitUntil: 'networkidle' });
      const primerEnlace = pagina.locator('a.alerta-fila').first();
      const destinoEsperado = await primerEnlace.getAttribute('href');
      await primerEnlace.click();
      // Se espera a la URL concreta: 'networkidle' vuelve enseguida porque la
      // red ya estaba tranquila ANTES del clic, y la comprobacion se colaba.
      const llego = await pagina
        .waitForURL(`**${destinoEsperado}`, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      comprobar('Al hacer clic en una alerta se navega a su registro', llego,
        `esperado ${destinoEsperado}, actual ${pagina.url().replace(BASE, '')}`);
    },

    /* ════════════════════════════════════════════════════════════════════
       BARRA LATERAL Y TEMA · lo que no se puede probar sin navegador
       ════════════════════════════════════════════════════════════════════ */
    async interfaz() {
      titulo('Barra lateral, tema y preferencias');
      await pagina.goto(`${BASE}/panel`, { waitUntil: 'networkidle' });

      /* --- Colapsar la barra y comprobar que se recuerda --- */
      const barra = pagina.locator('nav.barra').first();
      const anchoAntes = (await barra.boundingBox())?.width ?? 0;

      const botonAncho = pagina.locator('button.barra-plegar').first();
      if (await botonAncho.count()) {
        await botonAncho.click();
        await pagina.waitForTimeout(400);
        const anchoDespues = (await barra.boundingBox())?.width ?? 0;
        comprobar('La barra lateral se colapsa', anchoDespues < anchoAntes,
          `${Math.round(anchoAntes)}px → ${Math.round(anchoDespues)}px`);

        await pagina.reload({ waitUntil: 'networkidle' });
        const anchoTrasRecarga = (await barra.boundingBox())?.width ?? 0;
        comprobar('Y lo recuerda tras recargar',
          Math.abs(anchoTrasRecarga - anchoDespues) < 12,
          `${Math.round(anchoTrasRecarga)}px`);

        await botonAncho.click();
        await pagina.waitForTimeout(300);
      } else {
        comprobar('Existe el botón de colapsar la barra', false, 'no se encontró');
      }

      /* --- Cambiar de tema --- */
      const temaAntes = await pagina.evaluate(() => document.documentElement.getAttribute('data-tema'));
      const botonTema = pagina.locator('button[aria-label="Cambiar entre tema claro y oscuro"]').first();
      if (await botonTema.count()) {
        await botonTema.click();
        await pagina.waitForTimeout(400);
        const temaDespues = await pagina.evaluate(() => document.documentElement.getAttribute('data-tema'));
        comprobar('El botón de tema cambia el aspecto', temaAntes !== temaDespues,
          `${temaAntes ?? 'sistema'} → ${temaDespues ?? 'sistema'}`);
        await captura('tema-cambiado');
        await botonTema.click();
        await pagina.waitForTimeout(300);
      } else {
        comprobar('Existe el botón de tema', false, 'no se encontró');
      }

      /* --- El panel del usuario --- */
      const botonUsuario = pagina.locator('.cabecera-usuario button.cabecera-avatar').first();
      if (await botonUsuario.count()) {
        await botonUsuario.click();
        await pagina.waitForTimeout(350);
        const abierto = await pagina.locator('text=/cerrar sesión|salir/i').count();
        comprobar('El panel del usuario se abre y ofrece salir', abierto > 0);
        await pagina.keyboard.press('Escape');
      }
    },



    /* ════════════════════════════════════════════════════════════════════
       BUSCADOR DE PRODUCTOS DEL FORMULARIO DE VENTA
       ════════════════════════════════════════════════════════════════════
       Comprueba por qué campos se puede buscar de verdad, escribiendo en la
       caja como lo haría un vendedor: por código, por especie, por formato,
       por corte y por presentación.
       ════════════════════════════════════════════════════════════════════ */
    async buscador() {
      titulo('El buscador de productos');
      await pagina.goto(`${BASE}/ventas/cotizaciones/nueva`, { waitUntil: 'networkidle' });

      /*
       * El buscador esta deshabilitado hasta elegir cliente, y con razon: el
       * precio depende de quien compra. Asi que primero se elige uno, igual
       * que haria un vendedor.
       */
      const selectorCliente = pagina.locator('select.campo').first();
      const opciones = await selectorCliente.locator('option').count();
      comprobar('Hay clientes para elegir', opciones > 1, `${opciones} opciones`);
      await selectorCliente.selectOption({ index: 1 });
      await pagina.waitForTimeout(300);

      const caja = pagina.locator('input.form-buscador-input');
      comprobar('El buscador se habilita al elegir cliente',
        await caja.isEnabled(), await caja.getAttribute('placeholder') ?? '');

      const PRUEBAS = [
        ['código de SKU', '01'],
        ['especie', 'pota'],
        ['formato', 'laminado'],
        ['corte', 'anillas'],
        ['presentación', 'placas'],
        ['inventado', 'zzzzz'],
      ];

      for (const [porQue, texto] of PRUEBAS) {
        await caja.fill('');
        await caja.fill(texto);
        await pagina.waitForTimeout(450);
        const n = await pagina.locator('ul.form-resultados li[role="option"]').count();
        const esperado = texto !== 'zzzzz';
        comprobar(`Buscar por ${porQue} («${texto}») ${esperado ? 'encuentra' : 'no encuentra nada'}`,
          esperado ? n > 0 : n === 0, `${n} resultados`);
      }

      /* ---- Autocompletado: teclado, resaltado y datos en vivo ---- */
      await caja.fill('anillas');

      /*
       * Se espera al dato, no a un reloj. La primera consulta despues de
       * arrancar el servidor tarda mas porque la ruta se compila en ese
       * momento; con un timeout fijo la prueba falla por algo que no es un
       * fallo.
       */
      const llegoVivo = await pagina.locator('.form-res-vivo').first()
        .waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);

      comprobar('Resalta la parte que se escribió',
        await pagina.locator('.form-res-marca').count() > 0);
      comprobar('Cada resultado adelanta datos del producto',
        await pagina.locator('.form-res-datos .form-res-dato').count() > 0,
        `${await pagina.locator('.form-res-dato').count()} datos`);
      comprobar('El stock se consulta en vivo al servidor', llegoVivo,
        `${await pagina.locator('.form-res-vivo').count()} marcas «en vivo»`);

      const primero = pagina.locator('ul.form-resultados li button').first();
      comprobar('El primer resultado está marcado para el teclado',
        await primero.getAttribute('data-activo') === 'si');

      await caja.press('ArrowDown');
      await pagina.waitForTimeout(150);
      comprobar('La flecha abajo mueve la marca',
        await pagina.locator('ul.form-resultados li button[data-activo="si"]').count() === 1 &&
        await primero.getAttribute('data-activo') !== 'si');

      await captura('buscador-productos');

      /* Intro agrega el marcado sin tocar el ratón */
      const lineasAntes = await pagina.locator('.form-linea, table.datos tbody tr').count();
      await caja.press('Enter');
      await pagina.waitForTimeout(900);
      const lineasDespues = await pagina.locator('.form-linea, table.datos tbody tr').count();
      comprobar('Intro agrega el producto marcado', lineasDespues > lineasAntes,
        `${lineasAntes} → ${lineasDespues} líneas`);

      /*
       * Lo importante no es que aparezca la fila, es que llegue con precio.
       * Una linea a cero es peor que ninguna: se cotiza sin darse cuenta.
       */
      await pagina.waitForTimeout(1200);
      const totalTexto = (await pagina.locator('.destacado strong').last()
        .innerText().catch(() => '')).trim();
      comprobar('La línea agregada llega con precio, no en cero',
        /[1-9]/.test(totalTexto.replace(/[^0-9]/g, '')), 'total en pantalla: ' + totalTexto.split(String.fromCharCode(10)).join(' '));
      await captura('buscador-agregado');

      /* Una búsqueda sin resultados explica qué probar */
      await caja.fill('zzzzz');
      await pagina.waitForTimeout(400);
      comprobar('Sin coincidencias, sugiere por dónde buscar',
        await pagina.locator('.form-res-vacio').count() === 1);
    },

    /* ════════════════════════════════════════════════════════════════════
       CONFIGURACIÓN · las tarjetas de Maestros no pueden ser adornos
       ════════════════════════════════════════════════════════════════════
       Eran seis contadores que llevaban a pantallas sin relación con su
       catálogo: «Vehículos» abría el planificador. Este recorrido comprueba
       que cada tarjeta enseña de verdad lo que promete.
       ════════════════════════════════════════════════════════════════════ */
    async configuracion() {
      titulo('Los catálogos de Configuración');
      await pagina.goto(`${BASE}/configuracion?t=maestros`, { waitUntil: 'networkidle' });

      const tarjetas = pagina.locator('a.tarjeta-maestro');
      const cuantas = await tarjetas.count();
      comprobar('La pestaña Maestros lista los catálogos', cuantas >= 6, `${cuantas} tarjetas`);

      const destinos = [];
      for (let i = 0; i < cuantas; i++) {
        destinos.push({
          titulo: (await tarjetas.nth(i).locator('strong').innerText()).trim(),
          href: await tarjetas.nth(i).getAttribute('href'),
        });
      }

      for (const d of destinos) {
        await pagina.goto(`${BASE}${d.href}`, { waitUntil: 'networkidle' });
        const filas = await pagina.locator('table.datos tbody tr').count();
        const h1 = (await pagina.locator('h1').first().innerText().catch(() => '')).trim();
        comprobar(`«${d.titulo}» muestra registros de verdad`, filas > 0,
          `${filas} filas en "${h1}"`);
        await captura(`maestro-${d.titulo.toLowerCase().replace(/\W+/g, '-')}`);
      }
    },

    /* ════════════════════════════════════════════════════════════════════
       FLOTA · la pantalla que faltaba cuando saltaba la alerta de SOAT
       ════════════════════════════════════════════════════════════════════ */
    async flota() {
      titulo('Flota y documentos de los vehículos');
      await pagina.goto(`${BASE}/logistica/flota`, { waitUntil: 'networkidle' });

      const vehiculos = await pagina.locator('table.datos').first().locator('tbody tr').count();
      comprobar('La flota lista vehículos', vehiculos > 0, `${vehiculos} vehículos`);

      const tablas = await pagina.locator('table.datos').count();
      comprobar('Y también los conductores con su licencia', tablas >= 2, `${tablas} tablas`);

      /* Llegar como llega la alerta: con un identificador concreto. */
      const placa = (await pagina.locator('table.datos tbody tr td.mono strong').first().innerText()).trim();
      await pagina.goto(`${BASE}/logistica/flota?id=1`, { waitUntil: 'networkidle' });
      const resaltada = await pagina.locator('tr[data-resaltada="si"]').count();
      comprobar('Al llegar desde una alerta, el vehículo queda resaltado', resaltada === 1,
        `${resaltada} filas resaltadas (la primera de la lista es ${placa})`);
      await captura('flota-resaltada');

      const aviso = await pagina.locator('.ficha-aviso').first().innerText().catch(() => '');
      comprobar('Y se explica arriba de qué vehículo se trata',
        aviso.toLowerCase().includes('soat'), aviso.slice(0, 80));
    },


    /* ════════════════════════════════════════════════════════════════════
       DESCARGA DE DOCUMENTOS · desde la propia ficha, con el ratón
       ════════════════════════════════════════════════════════════════════
       Las pruebas de scripts/probar-documentos.mjs llaman a la API. Esto
       comprueba lo otro: que el boton exista en la ficha y que al pulsarlo el
       navegador reciba de verdad un archivo.
       ════════════════════════════════════════════════════════════════════ */
    async documentos() {
      titulo('Descargar el documento desde su ficha');

      const admin = (await import('@supabase/supabase-js')).createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } }
      );

      const FICHAS = [
        ['cotización', '/ventas/cotizaciones', 'cotizaciones'],
        ['proforma', '/ventas/pedidos', 'pedidos'],
        ['comprobante', '/finanzas/facturas', 'facturas'],
      ];

      for (const [nombre, ruta, tabla] of FICHAS) {
        const { data } = await admin.from(tabla).select('id').limit(1).single();
        if (!data) { comprobar(`Hay ${nombre} de prueba`, false); continue; }

        await pagina.goto(`${BASE}${ruta}/${data.id}`, { waitUntil: 'networkidle' });

        const botonPdf = pagina.locator('button', { hasText: /^PDF$/ }).first();
        comprobar(`La ficha de ${nombre} ofrece descargar en PDF`,
          await botonPdf.count() > 0);
        comprobar(`La ficha de ${nombre} ofrece descargar en Excel`,
          await pagina.locator('button', { hasText: /^Excel$/ }).count() > 0);

        if (!(await botonPdf.count())) continue;

        const descarga = pagina.waitForEvent('download', { timeout: 25000 }).catch(() => null);
        await botonPdf.click();
        const archivo = await descarga;

        comprobar(`Al pulsar PDF en ${nombre}, el navegador recibe el archivo`,
          !!archivo, archivo ? archivo.suggestedFilename() : 'no llego ninguna descarga');

        if (archivo) {
          comprobar(`  · y se llama como el documento`,
            /\.pdf$/i.test(archivo.suggestedFilename()), archivo.suggestedFilename());
        }
      }

      await captura('documento-botones');
    },

    /* ════════════════════════════════════════════════════════════════════
       LISTADOS · que los botones de acción lleven a alguna parte
       ════════════════════════════════════════════════════════════════════ */
    async listados() {
      titulo('Los botones de «ver detalle» de cada listado');

      const LISTADOS = [
        '/ventas/clientes', '/ventas/cotizaciones', '/ventas/pedidos',
        '/almacenes/existencias', '/almacenes/traslados', '/almacenes/reservas',
        '/logistica/embarques', '/finanzas/facturas', '/finanzas/cobrar',
      ];

      for (const ruta of LISTADOS) {
        await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
        const boton = pagina.locator('td .acciones-fila a.accion-btn').first();
        if (!(await boton.count())) {
          comprobar(`${ruta} tiene botón de ver`, false, 'no hay .accion-btn');
          continue;
        }
        // Mismo cuidado que con las alertas: 'networkidle' vuelve al instante
        // porque la red ya estaba tranquila antes de pulsar. Hay que esperar a
        // la URL concreta a la que apunta el boton.
        const esperado = await boton.getAttribute('href');
        await boton.click();
        const llego = await pagina
          .waitForURL(`**${esperado}`, { timeout: 15000 })
          .then(() => true)
          .catch(() => false);

        const destino = pagina.url().replace(BASE, '');
        const h1 = (await pagina.locator('h1').first().innerText().catch(() => '')).trim();
        comprobar(`${ruta} → ${esperado}`, llego && destino !== ruta && h1.length > 0,
          `actual=${destino}, h1="${h1}"`);
      }
    },
  };

  const aEjecutar = SOLO.length
    ? SOLO.filter((n) => recorridos[n])
    : Object.keys(recorridos);

  for (const nombre of aEjecutar) await recorridos[nombre]();

  /* ══════════════════════════════════════════════════════════════════════
     LO QUE DIJO EL NAVEGADOR
     ══════════════════════════════════════════════════════════════════════ */
  titulo('Consola del navegador');
  const unicos = [...new Set(consola)];
  comprobar('Sin errores ni avisos de React en consola', unicos.length === 0,
    unicos.slice(0, 4).join(' | '));
  if (unicos.length) unicos.slice(0, 12).forEach((c) => console.log(`        ${c}`));

  comprobar('Sin peticiones fallidas', fallosRed.length === 0, fallosRed.slice(0, 3).join(' | '));

  await navegador.close();

  console.log('\n================================================================');
  console.log(`  RESULTADO: ${ok} pasaron - ${fallo} fallaron`);
  console.log('================================================================');
  if (errores.length) {
    console.log('\n  Fallaron:');
    errores.forEach((e) => console.log(`   .. ${e}`));
  }
  console.log(`\n  Capturas en ./${CAPTURAS}/\n`);
  process.exit(fallo > 0 ? 1 : 0);
}

principal().catch((e) => {
  console.error('\nERROR:', e.message);
  process.exit(1);
});
