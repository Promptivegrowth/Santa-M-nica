# Santa Mónica ERP · Ventas, Almacenes y Despachos

Sistema de gestión comercial y logística de **Industrial Pesquera Santa Mónica S.A.C.**

Construido por [Promptive](https://promptivedev.com) · Bravosoft S.A.C.

---

## Qué resuelve

El negocio no tenía un problema de registro, sino de **compromiso de stock**: había
producto en cámara que figuraba apartado para clientes que nunca lo llevaron, y al
mismo tiempo se le decía que no a clientes reales. Este sistema separa, para cada
producto y cada bodega, cinco cantidades distintas:

```
  FÍSICO        lo que hay en la cámara
− BLOQUEADO     lo que Calidad no deja mover
− RESERVADO     lo que ya tiene dueño
− PREPARACIÓN   lo que ya está en un contenedor armándose
= DISPONIBLE    lo único que se le puede prometer a un cliente nuevo
```

Sobre esa base resuelve además: traslados con triple firma, plano de estiba
automático, trazabilidad completa en ambos sentidos y retiro sanitario.

---

## Puesta en marcha

```bash
npm install                # instalar dependencias
cp .env.example .env.local # y completar las credenciales

# Aplicar el esquema a la base de datos (en orden)
npm run db supabase/migrations/001_enums_y_maestros.sql
npm run db supabase/migrations/002_inventario_y_trazabilidad.sql
npm run db supabase/migrations/003_comercial_logistica_financiero.sql
npm run db supabase/migrations/004_logica_de_negocio.sql
npm run db supabase/migrations/005_trazabilidad_consultas.sql
npm run db supabase/migrations/006_seguridad_rls.sql
npm run db supabase/migrations/007_datos_base.sql
npm run db supabase/migrations/008_fix_proyeccion_existencias.sql
npm run db supabase/migrations/009_fix_rls_recursion.sql
npm run db supabase/migrations/010_vistas_tablero.sql
npm run db supabase/migrations/011_resumen_anticuamiento.sql

npm run seed               # sembrar datos de prueba y crear los 7 usuarios
npm run dev                # levantar en http://localhost:3000
```

## Usuarios de prueba

Todos con la contraseña **`SantaMonica2026`**. En la pantalla de acceso hay un
panel de **acceso rápido**: un clic entra con cada perfil.

| Rol | Correo | Qué puede hacer |
|---|---|---|
| Gerencia | `gerencia@santamonica.pe` | Todo: configuración, precios, reglas, usuarios |
| Operaciones | `operaciones@santamonica.pe` | Autoriza traslados, ajustes y libera reservas |
| Comercial | `comercial@santamonica.pe` | Cotiza, registra pedidos y reserva producto |
| Comex | `comex@santamonica.pe` | Programa embarques y arma la documentación |
| Almacén | `almacen@santamonica.pe` | Ingresos, carga de contenedores, recibe traslados |
| Calidad | `calidad@santamonica.pe` | Observa y libera producto con sustento |
| Consulta | `consulta@santamonica.pe` | Solo lectura, sin costos ni márgenes |

## Pruebas

```bash
npm test                # 38 pruebas de integridad, seguridad y reglas de negocio
npm run test:excel      # 60 pruebas de exportación a Excel (requiere npm run dev)
npm run test:pantallas  # 37 pruebas de renderizado real (requiere npm run dev)
```

Las pruebas no simulan nada: inician sesión de verdad con cada rol, contra la base
de datos real, y comprueban que el sistema se comporte como debe.

---

## Cómo está hecho

| Capa | Elección | Por qué |
|---|---|---|
| Base de datos | Supabase PostgreSQL 17 · región `sa-east-1` | São Paulo, ya provisionado |
| Despliegue | Vercel · región `gru1` | Misma ciudad que la base: latencia mínima |
| Framework | Next.js 16 · App Router · React 19 | Server Components para tablas pesadas |
| Lenguaje | TypeScript estricto | Un cambio de esquema rompe la compilación, no la producción |
| Estilos | Tailwind v4 con tokens de marca | Un solo origen de verdad para color y tipografía |
| Gráficos | SVG propio | Sin librerías pesadas: menos JavaScript, control total del branding |
| Excel | ExcelJS | Logotipo, colores y formato de moneda reales |
| Seguridad | RLS por rol en PostgreSQL | La restricción vive en la base, no en la pantalla |

### Estructura

```
src/
  app/
    login/              pantalla de acceso con inicio rápido por rol
    (erp)/              todas las pantallas protegidas
      panel/            Control Tower
      ventas/           clientes, cotizaciones, pedidos, disponibilidad, control
      almacenes/        existencias, kardex, ingresos, traslados, calidad
      logistica/        planificador, embarques, packing y plano de estiba
      finanzas/         facturación, cuentas por cobrar, rentabilidad
      trazabilidad/     buscador universal, retiro sanitario, auditoría
      configuracion/    parámetros, reglas, motivos, maestros, usuarios
    api/reportes/       generación de los Excel
  components/           marca, estructura, gráficos y piezas de interfaz
  lib/                  cliente de datos, formato y navegación
  proxy.ts              autenticación y protección de rutas

supabase/migrations/    el esquema completo, en orden
scripts/                aplicación de migraciones, sembrado y pruebas
```

### Decisiones que conviene conocer

- **El Kardex es inmutable.** La base rechaza `UPDATE` y `DELETE` sobre la tabla
  `movimientos`. Para corregir un error se registra un movimiento inverso.
- **Las existencias no se editan.** Son una proyección del Kardex, calculada por
  disparadores. Si algo descuadra, se reconstruye.
- **La reserva apunta al lote, no al SKU.** Es lo que elimina las reservas fantasma.
- **Nada está "quemado" en el código.** Umbrales, plazos, capacidades y porcentajes
  viven en la tabla `parametros` y se editan desde Configuración.
- **La seguridad está en PostgreSQL.** Aunque alguien manipulara el navegador,
  las políticas RLS rechazarían la operación.

---

## Despliegue en Vercel

El archivo `vercel.json` ya fija la región `gru1` (São Paulo), la misma donde vive
la base de datos. Basta con conectar el repositorio y cargar las variables de
entorno del `.env.example`.

---

© 2026 Bravosoft S.A.C. — Promptive. Código entregado a Industrial Pesquera Santa Mónica S.A.C.
