'use client';

/**
 * ============================================================================
 *  FORMULARIO DE CLIENTE · sirve para dar de alta y para editar
 * ============================================================================
 *  Es el mismo componente en los dos casos. Si recibe un cliente, edita; si no
 *  lo recibe, crea. Duplicarlo habría garantizado que dentro de tres meses uno
 *  de los dos tuviera un campo que al otro le falta.
 *
 *  DOS DECISIONES QUE SE NOTAN AL USARLO
 *
 *  · El país no es un dato administrativo cualquiera: de él depende si la
 *    venta lleva IGV. El formulario lo dice en pantalla, debajo del campo, en
 *    el momento en que se elige. Enterarse al emitir la factura es tarde.
 *
 *  · El RUC se comprueba mientras se escribe, con el mismo cálculo de dígito
 *    verificador que usa SUNAT. Un RUC mal tecleado que entra al maestro sale
 *    después impreso en una factura.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icono } from '@/components/estructura/Icono';
import { crearCliente, actualizarCliente, type DatosCliente, type Resultado } from './acciones';

export type ClienteExistente = DatosCliente & { id: number; activo: boolean };

/** Dígito verificador del RUC, para avisar mientras se escribe. */
function rucCorrecto(ruc: string): boolean {
  if (!/^\d{11}$/.test(ruc)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + Number(ruc[i]) * p, 0);
  const resto = 11 - (suma % 11);
  const esperado = resto === 10 ? 0 : resto === 11 ? 1 : resto;
  return esperado === Number(ruc[10]);
}

const VACIO: DatosCliente = {
  codigo: '', razon_social: '', nombre_corto: '', tipo: 'final', pais: 'Perú',
  ruc_tax_id: '', contacto: '', email: '', telefono: '', vendedor_id: null,
  moneda: 'PEN', linea_credito: 0, dias_credito: 30, bloqueado: false, motivo_bloqueo: '',
};

export function FormularioCliente({
  cliente,
  codigoPropuesto,
  paises,
  vendedores,
}: {
  cliente?: ClienteExistente;
  codigoPropuesto?: string;
  paises: string[];
  vendedores: { id: number; nombre: string }[];
}) {
  const router = useRouter();
  const [guardando, iniciar] = useTransition();
  const [d, setD] = useState<DatosCliente>(
    cliente ?? { ...VACIO, codigo: codigoPropuesto ?? '' }
  );
  const [problema, setProblema] = useState<{ mensaje: string; campo?: string } | null>(null);

  const editando = Boolean(cliente);
  const esPeru = d.pais.trim() === 'Perú';
  const ruc = (d.ruc_tax_id ?? '').trim();
  const rucMal = esPeru && ruc.length === 11 && !rucCorrecto(ruc);

  function campo<K extends keyof DatosCliente>(k: K, v: DatosCliente[K]) {
    setD((previo) => {
      const siguiente = { ...previo, [k]: v };
      /*
       * Al cambiar el país se propone la moneda que corresponde. Se propone,
       * no se impone: hay clientes peruanos que pagan en dólares.
       */
      if (k === 'pais') {
        siguiente.moneda = String(v).trim() === 'Perú' ? 'PEN' : 'USD';
      }
      return siguiente;
    });
    setProblema(null);
  }

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setProblema(null);

    iniciar(async () => {
      const r: Resultado = cliente
        ? await actualizarCliente(cliente.id, d)
        : await crearCliente(d);

      if (!r.ok) {
        setProblema({ mensaje: r.mensaje, campo: r.campo });
        return;
      }
      router.push(`/ventas/clientes/${r.id}`);
      router.refresh();
    });
  }

  const error = (nombre: string) => (problema?.campo === nombre ? 'si' : undefined);

  return (
    <form className="form-maestro" onSubmit={enviar}>
      {problema && (
        <div className="ficha-aviso ficha-aviso-critico" role="alert">
          <Icono nombre="alerta" tamano={17} />
          <span>{problema.mensaje}</span>
        </div>
      )}

      {/* ---------------- Identificación ---------------- */}
      <fieldset className="form-bloque">
        <legend>Identificación</legend>

        <div className="form-rejilla">
          <label className="form-campo">
            <span>Código <b className="req">*</b></span>
            <input className="campo" value={d.codigo} data-error={error('codigo')}
                   onChange={(e) => campo('codigo', e.target.value)}
                   placeholder="CLI-0001" maxLength={20} required />
            <small>Identificador interno. No se repite.</small>
          </label>

          <label className="form-campo form-campo-ancho">
            <span>Razón social <b className="req">*</b></span>
            <input className="campo" value={d.razon_social} data-error={error('razon_social')}
                   onChange={(e) => campo('razon_social', e.target.value)}
                   placeholder="Nombre legal completo" maxLength={200} required />
            <small>Es el nombre que sale impreso en la factura.</small>
          </label>

          <label className="form-campo">
            <span>Nombre corto</span>
            <input className="campo" value={d.nombre_corto ?? ''}
                   onChange={(e) => campo('nombre_corto', e.target.value)}
                   placeholder="Cómo lo llaman aquí" maxLength={60} />
            <small>Para los listados. Opcional.</small>
          </label>

          <label className="form-campo">
            <span>Tipo</span>
            <select className="campo" value={d.tipo}
                    onChange={(e) => campo('tipo', e.target.value as DatosCliente['tipo'])}>
              <option value="final">Cliente final</option>
              <option value="intermediario">Intermediario / trader</option>
            </select>
          </label>
        </div>
      </fieldset>

      {/* ---------------- Fiscal ---------------- */}
      <fieldset className="form-bloque">
        <legend>Datos fiscales</legend>

        <div className="form-rejilla">
          <label className="form-campo">
            <span>País <b className="req">*</b></span>
            <input className="campo" list="lista-paises" value={d.pais} data-error={error('pais')}
                   onChange={(e) => campo('pais', e.target.value)} required />
            <datalist id="lista-paises">
              {paises.map((p) => <option key={p} value={p} />)}
            </datalist>
          </label>

          <label className="form-campo">
            <span>{esPeru ? 'RUC' : 'Tax ID'}</span>
            <input className="campo mono" value={d.ruc_tax_id ?? ''} data-error={error('ruc_tax_id') ?? (rucMal ? 'si' : undefined)}
                   onChange={(e) => campo('ruc_tax_id', e.target.value)}
                   placeholder={esPeru ? '20205572229' : 'Identificación fiscal'}
                   inputMode={esPeru ? 'numeric' : 'text'} maxLength={esPeru ? 11 : 30} />
            {esPeru && ruc.length === 11 && (
              rucMal
                ? <small className="mal">Ese RUC no es válido: el último dígito no corresponde. Revise si hay un número cambiado.</small>
                : <small className="bien">RUC válido.</small>
            )}
            {esPeru && ruc.length > 0 && ruc.length < 11 && (
              <small>Un RUC peruano tiene once dígitos. Van {ruc.length}.</small>
            )}
          </label>

          <label className="form-campo">
            <span>Moneda</span>
            <select className="campo" value={d.moneda}
                    onChange={(e) => campo('moneda', e.target.value as DatosCliente['moneda'])}>
              <option value="PEN">Soles (PEN)</option>
              <option value="USD">Dólares (USD)</option>
            </select>
          </label>
        </div>

        {/*
          El aviso del IGV va aquí, pegado a los campos que lo deciden, y no en
          un manual: es el error que más caro sale y el más fácil de cometer.
        */}
        <div className={`form-consecuencia ${esPeru ? 'local' : 'export'}`}>
          <Icono nombre="alerta" tamano={16} />
          <span>
            {esPeru ? (
              ruc.length === 11 && !rucMal ? (
                <>Con este país y este RUC, a este cliente se le emitirá <b>factura electrónica con IGV del 18 %</b>, y corresponde cargarle la cuenta de detracción.</>
              ) : (
                <>Cliente peruano <b>sin RUC válido</b>: el sistema le emitirá <b>boleta de venta</b>, que no da derecho a crédito fiscal. Si es una empresa, cargue su RUC.</>
              )
            ) : (
              <>Cliente del extranjero: se le emitirá <b>factura de exportación sin IGV</b>. La detracción no corresponde.</>
            )}
          </span>
        </div>
      </fieldset>

      {/* ---------------- Contacto ---------------- */}
      <fieldset className="form-bloque">
        <legend>Contacto principal</legend>
        <div className="form-rejilla">
          <label className="form-campo">
            <span>Persona de contacto</span>
            <input className="campo" value={d.contacto ?? ''}
                   onChange={(e) => campo('contacto', e.target.value)}
                   placeholder="Nombre y apellido" maxLength={120} />
          </label>
          <label className="form-campo">
            <span>Correo</span>
            <input className="campo" type="email" value={d.email ?? ''} data-error={error('email')}
                   onChange={(e) => campo('email', e.target.value)}
                   placeholder="compras@empresa.com" maxLength={120} />
          </label>
          <label className="form-campo">
            <span>Teléfono</span>
            <input className="campo mono" value={d.telefono ?? ''}
                   onChange={(e) => campo('telefono', e.target.value)}
                   placeholder="+51 999 999 999" maxLength={40} />
          </label>
        </div>
        <p className="form-pista">
          Este es el contacto de cabecera del cliente. Los contactos adicionales —con su cargo, para
          dirigirles una cotización concreta— se administran en{' '}
          <Link href="/configuracion?t=contactos">Configuración → Contactos y cuentas</Link>.
        </p>
      </fieldset>

      {/* ---------------- Comercial ---------------- */}
      <fieldset className="form-bloque">
        <legend>Condiciones comerciales</legend>
        <div className="form-rejilla">
          <label className="form-campo">
            <span>Vendedor asignado</span>
            <select className="campo" value={d.vendedor_id ?? ''}
                    onChange={(e) => campo('vendedor_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Sin asignar</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
            <small>Se propone solo al cotizar.</small>
          </label>

          <label className="form-campo">
            <span>Línea de crédito</span>
            <input className="campo mono" type="number" min={0} step={100}
                   value={d.linea_credito} data-error={error('linea_credito')}
                   onChange={(e) => campo('linea_credito', Number(e.target.value))} />
            <small>Cuánto se le puede deber. 0 = sin límite definido.</small>
          </label>

          <label className="form-campo">
            <span>Días de crédito</span>
            <input className="campo mono" type="number" min={0} max={365}
                   value={d.dias_credito} data-error={error('dias_credito')}
                   onChange={(e) => campo('dias_credito', Number(e.target.value))} />
            <small>Con esto se calcula el vencimiento de la factura.</small>
          </label>
        </div>

        <label className="form-check">
          <input type="checkbox" checked={d.bloqueado}
                 onChange={(e) => campo('bloqueado', e.target.checked)} />
          <span>
            <b>Bloquear al cliente</b>
            <small>Un cliente bloqueado no se puede elegir al cotizar. Se usa por deuda vencida o por una disputa abierta.</small>
          </span>
        </label>

        {d.bloqueado && (
          <label className="form-campo form-campo-ancho">
            <span>Motivo del bloqueo <b className="req">*</b></span>
            <input className="campo" value={d.motivo_bloqueo ?? ''} data-error={error('motivo_bloqueo')}
                   onChange={(e) => campo('motivo_bloqueo', e.target.value)}
                   placeholder="Por qué está bloqueado" maxLength={200} />
            <small>Quien intente cotizarle va a ver este texto.</small>
          </label>
        )}
      </fieldset>

      <div className="form-acciones">
        <button type="submit" className="btn btn-primario" disabled={guardando}>
          <Icono nombre="guardar" tamano={15} />
          {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear cliente'}
        </button>
        <Link
          href={cliente ? `/ventas/clientes/${cliente.id}` : '/ventas/clientes'}
          className="btn btn-sutil"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
