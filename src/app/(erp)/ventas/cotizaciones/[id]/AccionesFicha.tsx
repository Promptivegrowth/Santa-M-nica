'use client';

/**
 * ============================================================================
 *  BOTONERA DE LA FICHA DE COTIZACIÓN
 * ============================================================================
 *  Es la misma lógica que las acciones del listado, pero con botones grandes y
 *  con texto: aquí el usuario ya abrió el documento y va a decidir sobre él,
 *  así que las opciones se nombran en vez de esconderse tras un icono.
 *
 *  Cuando una acción no está permitida NO se oculta: se deshabilita y se
 *  explica por qué en el texto de ayuda. Un botón que desaparece deja al
 *  usuario preguntándose qué hizo mal.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  convertirEnPedido, eliminarCotizacion, cambiarEstadoCotizacion, aprobarCotizacion,
} from '../acciones';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';

export function AccionesFicha({
  cotizacionId,
  numero,
  estado,
  yaConvertida,
  aprobada,
  requiereAprobacion,
  puedeAprobar,
  puedeRechazar = true,
  bloqueoAprobar = null,
  bloqueoEliminar = null,
}: {
  cotizacionId: number;
  numero: string;
  estado: string;
  yaConvertida: boolean;
  /** ¿Ya tiene la firma de quien aprueba cotizaciones? */
  aprobada: boolean;
  /** ¿La empresa exige esa firma? Se configura, no está en el código. */
  requiereAprobacion: boolean;
  /** ¿El usuario que está mirando puede darla? (facultad personal, no del cargo) */
  puedeAprobar: boolean;
  /** Gerencia, Operaciones o Comercial: marcar que el cliente dijo que no. */
  puedeRechazar?: boolean;
  /** Por qué no se puede aprobar aunque se tenga la facultad (p. ej. la validez venció), o null. */
  bloqueoAprobar?: string | null;
  /** Por qué esta persona no puede eliminarla (motivoNoEliminarCotizacion), o null. */
  bloqueoEliminar?: string | null;
}) {
  const router = useRouter();
  /* Las dos acciones que no se deshacen piden confirmación en el sitio. */
  const [confirmando, setConfirmando] = useState<'eliminar' | 'rechazar' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const editable = !yaConvertida && ['borrador', 'aprobada', 'enviada'].includes(estado);
  const convertible = !yaConvertida && !['rechazada', 'vencida'].includes(estado);
  // Si la empresa exige aprobar, convertir también espera la firma (el servidor lo vuelve a comprobar).
  const puedeConvertir = !requiereAprobacion || aprobada;

  /*
   * Una oferta solo sale al cliente si lleva la firma —cuando la empresa la
   * exige—. El botón no se esconde: se deshabilita y dice por qué. Un botón
   * que desaparece deja al usuario preguntándose qué hizo mal.
   */
  const puedeEnviar = !requiereAprobacion || aprobada;

  function accion(fn: () => Promise<{ ok: boolean; mensaje?: string; id?: number }>, alPedido = false) {
    setError(null);
    iniciar(async () => {
      const r = await accionSegura(fn);
      if (r.ok) {
        if (alPedido && r.id) router.push(`/ventas/pedidos/${r.id}`);
        else router.refresh();
      } else {
        setError(r.mensaje ?? 'No se pudo completar la acción.');
      }
      setConfirmando(null);
    });
  }

  /**
   * El borrado va aparte porque su final es distinto: la ficha que se está
   * mirando deja de existir. Si aquí hiciéramos router.refresh() el usuario
   * se quedaría delante de un 404. Se vuelve al listado, que es donde tiene
   * sentido continuar trabajando.
   */
  function borrar() {
    setError(null);
    iniciar(async () => {
      const r = await accionSegura(() => eliminarCotizacion(cotizacionId));
      if (r.ok) router.push('/ventas/cotizaciones?borrada=' + encodeURIComponent(numero));
      else { setError(r.mensaje); setConfirmando(null); }
    });
  }

  return (
    <div className="ficha-botonera">
      {/* --- Aprobar: la firma que autoriza el precio --- */}
      {estado === 'borrador' && requiereAprobacion && (
        <button
          type="button"
          className="btn btn-primario"
          disabled={pendiente || !puedeAprobar || !!bloqueoAprobar}
          data-accion="aprobar"
          title={!puedeAprobar
            ? 'Usted no tiene la facultad «Aprueba cotizaciones». Aprueban solo las personas que la tienen marcada en Configuración › Usuarios'
            : bloqueoAprobar ?? 'Autoriza el precio para que la oferta pueda salir al cliente'}
          onClick={() => accion(() => aprobarCotizacion(cotizacionId))}
        >
          <Icono nombre="guardar" tamano={15} />
          {pendiente ? 'Aprobando…' : 'Aprobar'}
        </button>
      )}

      {/* --- Marcar como enviada: solo con la firma puesta --- */}
      {['borrador', 'aprobada'].includes(estado) && (
        <button
          type="button"
          className="btn btn-secundario"
          disabled={pendiente || !puedeEnviar}
          title={puedeEnviar
            ? 'Registra que la oferta ya se le pasó al cliente'
            : `${numero} todavía no está aprobada: el precio no puede salir sin el visto bueno de quien aprueba cotizaciones`}
          onClick={() => accion(() => cambiarEstadoCotizacion(cotizacionId, 'enviada'))}
        >
          <Icono nombre="reportes" tamano={15} />
          Marcar como enviada
        </button>
      )}

      {/*
        --- Rechazo: el cliente dijo que no ---
        En una aprobada o en una enviada: el cliente puede decir que no por
        teléfono antes de que la oferta se marque como enviada. Antes solo se
        ofrecía en las enviadas. Pide confirmación porque no se deshace.
      */}
      {!yaConvertida && ['aprobada', 'enviada'].includes(estado) && (
        confirmando === 'rechazar' ? (
          <span className="accion-confirmar" data-confirmar="rechazar">
            <span>¿Marcar {numero} como rechazada? Ya no se podrá enviar ni convertir.</span>
            <button
              type="button"
              className="btn btn-primario"
              style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
              disabled={pendiente}
              data-accion="confirmar-rechazo"
              onClick={() => accion(() => cambiarEstadoCotizacion(cotizacionId, 'rechazada'))}
            >
              {pendiente ? 'Marcando…' : 'Sí, rechazada'}
            </button>
            <button
              type="button"
              className="btn btn-sutil"
              style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
              disabled={pendiente}
              onClick={() => setConfirmando(null)}
            >
              Cancelar
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-secundario"
            disabled={pendiente || !puedeRechazar}
            data-accion="rechazar"
            title={puedeRechazar
              ? 'El cliente no aceptó la oferta: la cierra como rechazada'
              : 'Marcar una cotización como rechazada corresponde a Gerencia, Operaciones o Comercial'}
            onClick={() => { setError(null); setConfirmando('rechazar'); }}
          >
            <Icono nombre="cerrar" tamano={15} />
            Marcar rechazada
          </button>
        )
      )}

      {editable ? (
        <Link
          href={`/ventas/cotizaciones/${cotizacionId}/editar`}
          className="btn btn-secundario"
          data-accion="editar"
          title={requiereAprobacion && (aprobada || estado === 'enviada')
            ? 'Abre el formulario. Ojo: si cambia productos, precios, descuentos o condiciones, al guardar la aprobación se anula y habrá que aprobarla otra vez'
            : `Corregir ${numero}`}
        >
          <Icono nombre="configuracion" tamano={15} />
          Editar
        </Link>
      ) : (
        <button
          type="button"
          className="btn btn-secundario"
          disabled
          title={
            yaConvertida
              ? 'Ya generó un pedido: los precios de una venta cerrada no se modifican'
              : `Una cotización ${estado} no se puede editar`
          }
        >
          <Icono nombre="configuracion" tamano={15} />
          Editar
        </button>
      )}

      {/* --- Eliminar, con confirmación en dos pasos --- */}
      {confirmando === 'eliminar' ? (
        <span className="accion-confirmar">
          <span>¿Eliminar {numero}?</span>
          <button
            type="button"
            className="btn btn-primario"
            style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
            disabled={pendiente}
            onClick={borrar}
          >
            {pendiente ? 'Eliminando…' : 'Sí, eliminar'}
          </button>
          <button
            type="button"
            className="btn btn-sutil"
            style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
            disabled={pendiente}
            onClick={() => setConfirmando(null)}
          >
            Cancelar
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="btn btn-peligro-borde"
          disabled={yaConvertida || pendiente || !!bloqueoEliminar}
          data-accion="eliminar"
          onClick={() => setConfirmando('eliminar')}
          title={bloqueoEliminar ?? (yaConvertida ? 'No se puede eliminar: ya generó un pedido' : `Eliminar ${numero}`)}
        >
          <Icono nombre="papelera" tamano={15} />
          Eliminar
        </button>
      )}

      {/* --- La acción principal: cerrar la venta --- */}
      {convertible && (
        <button
          type="button"
          className="btn btn-primario"
          disabled={pendiente || !puedeConvertir}
          title={puedeConvertir ? undefined : 'Primero tiene que aprobarse: solo una cotización aprobada se convierte en pedido'}
          data-accion="convertir"
          onClick={() => accion(() => convertirEnPedido(cotizacionId), true)}
        >
          <Icono nombre="pedido" tamano={15} />
          {pendiente ? 'Convirtiendo…' : 'Convertir en pedido'}
        </button>
      )}

      {error && <span className="accion-error">{error}</span>}
    </div>
  );
}
