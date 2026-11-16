# Guía para TI · Portal de clientes, subdominios y correo

Propuesta COT-2026-11-253. Lo que hace TI de Santa Mónica para que el portal
salga en `clientes.santamonicafishing.com`, el ERP en `erp.santamonicafishing.com`
y los correos desde `comex@` y `reclamos@`.

## 1. Subdominios (DNS)

En el proveedor del dominio `santamonicafishing.com`, crear:

| Tipo  | Nombre     | Valor                  |
|-------|------------|------------------------|
| CNAME | `clientes` | `cname.vercel-dns.com` |
| CNAME | `erp`      | `cname.vercel-dns.com` |

Luego Promptive agrega los dos dominios al proyecto en Vercel (Settings →
Domains). Vercel emite el certificado HTTPS solo.

## 2. Buzón y envío de correos

1. Crear el buzón `reclamos@santamonicafishing.com` (`comex@` ya existe).
2. Crear una cuenta en el servicio de envío **Resend** (resend.com) y agregar el
   dominio `santamonicafishing.com`. Resend muestra los registros exactos:
   - **SPF**: TXT en `send` → `v=spf1 include:amazonses.com ~all`
   - **DKIM**: TXT `resend._domainkey` → (la clave que muestra Resend)
   - **MX** de rebote en `send` → `feedback-smtp.us-east-1.amazonses.com` (prioridad 10)
3. **DMARC** (si aún no existe): TXT en `_dmarc` →
   `v=DMARC1; p=quarantine; rua=mailto:ti@santamonicafishing.com`
4. Crear una API Key en Resend con permiso solo de envío.

El sistema no guarda la contraseña de ningún buzón: envía por la API del
servicio, autorizado por esos registros.

## 3. Variables en Vercel (Settings → Environment Variables)

| Variable          | Valor                                                    |
|-------------------|----------------------------------------------------------|
| `PORTAL_SECRETO`  | El secreto del servidor (lo entrega Promptive; está en la base, `privado.claves`) |
| `RESEND_API_KEY`  | La API Key de Resend                                     |
| `CORREO_COMEX`    | `Santa Mónica Fishing <comex@santamonicafishing.com>`    |
| `CORREO_RECLAMOS` | `Santa Mónica Fishing <reclamos@santamonicafishing.com>` |
| `PORTAL_HOST`     | `clientes.santamonicafishing.com`                        |
| `ERP_HOST`        | `erp.santamonicafishing.com`                             |

Sin `RESEND_API_KEY` el sistema funciona en **modo simulado**: los correos no
salen, pero quedan registrados en «Correos enviados» y el portal muestra el
código de verificación en pantalla para poder probar.

## 4. Después

- En el ERP, Configuración → «Portal de clientes y reclamos»: poner la dirección
  final del portal, la del ERP y el correo del Jefe de Calidad.
- Calidad y reclamos → «Portal y reclamos»: cambiar la contraseña inicial de la
  cuenta de seguimiento.
- Correr `npm run test:portal` antes de cada publicación.
