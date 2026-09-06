-- ============================================================================
--  043 · LOS AVISOS DE RESUMEN SON UN ESTADO, NO UN EVENTO NUEVO CADA DÍA
-- ============================================================================
--  EL FALLO
--  «Stock por vencer» y «Cotizaciones por vencer» son avisos de RESUMEN: dicen
--  cuántos pallets caducan y cuántas ofertas expiran. Se generan solos cada
--  mañana, y para no repetirse comprobaban que no hubiera otro de las últimas
--  veinte horas.
--
--  Veinte horas. Así que al día siguiente entra otro, y al otro otro. Mientras
--  nadie los marque como atendidos —y nadie los marca, porque el stock sigue
--  ahí— se acumula UNO POR DÍA. En un mes son treinta alertas que dicen lo
--  mismo con distinta fecha.
--
--  Es exactamente el problema que ya obligó a agrupar el panel por tipo: hay
--  una alerta por lote y las ocho más graves eran ocho veces el mismo aviso.
--  Aquí se ataca en el origen.
--
--  LA DIFERENCIA
--  Una alerta de EVENTO cuenta algo que pasó —esta factura venció, este
--  traslado se detuvo— y cada una merece su fila, porque cada una se atiende
--  por separado.
--
--  Una alerta de RESUMEN cuenta cómo están las cosas AHORA. De esas solo tiene
--  sentido una, y lo que hace falta es que diga la cifra de hoy, no la del
--  martes pasado.
--
--  Así que en vez de insertar otra, se ACTUALIZA la que ya está abierta: mismo
--  aviso, mensaje al día, y la fecha se mueve para que se vea que sigue vivo.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  La pieza común: dejar abierto UN aviso de resumen, y solo uno
-- ────────────────────────────────────────────────────────────────────────────
create or replace function alerta_resumen(
  p_entidad   text,
  p_titulo    text,
  p_severidad severidad_alerta,
  p_mensaje   text
) returns void language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  --  `for update` porque dos trabajos programados pueden coincidir: sin el
  --  bloqueo, los dos ven que no hay ninguna y los dos insertan.
  select id into v_id
    from alertas
   where entidad = p_entidad and titulo = p_titulo and not atendida
   order by generada_en desc
   limit 1
     for update;

  if v_id is null then
    insert into alertas (entidad, entidad_id, severidad, titulo, mensaje)
    values (p_entidad, 0, p_severidad, p_titulo, p_mensaje);
  else
    --  Se refresca el mensaje y la fecha: el aviso es el mismo, la situación
    --  no. Y si quedaron duplicados de antes, se cierran aquí mismo.
    update alertas
       set mensaje = p_mensaje, severidad = p_severidad, generada_en = now()
     where id = v_id;

    update alertas
       set atendida = true
     where entidad = p_entidad and titulo = p_titulo
       and not atendida and id <> v_id;
  end if;
end $$;

comment on function alerta_resumen is
  'Deja abierto UN solo aviso de resumen del tipo indicado, con el mensaje del día. Existe porque los avisos de resumen se acumulaban uno por día mientras nadie los atendiera, y treinta alertas iguales no informan de nada.';


-- ────────────────────────────────────────────────────────────────────────────
--  Stock por vencer
-- ────────────────────────────────────────────────────────────────────────────
create or replace function stock_avisar_por_vencer()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_lotes int; v_kg numeric; v_valor numeric; v_dias int;
begin
  v_dias := param_num('vencimiento_aviso_dias', 90)::int;

  select count(*), coalesce(sum(fisico_kg), 0), coalesce(sum(valor), 0)
    into v_lotes, v_kg, v_valor
    from v_anticuamiento
   where situacion_vida_util = 'por_vencer' and fisico_kg > 0;

  --  Si ya no queda nada por vencer, el aviso se cierra solo. Un aviso que se
  --  queda abierto después de resolverse enseña a no hacer caso de los avisos.
  if v_lotes = 0 then
    update alertas set atendida = true
     where entidad = 'lote' and titulo = 'Stock por vencer' and not atendida;
    return 0;
  end if;

  perform alerta_resumen('lote', 'Stock por vencer', 'advertencia',
    format('%s pallets (%s TM, US$ %s) vencen en los próximos %s días. Conviene colocarlos antes de que haya que rematarlos.',
           v_lotes, round(v_kg / 1000, 1), round(v_valor), v_dias));

  return v_lotes;
end $$;

comment on function stock_avisar_por_vencer is
  'Deja abierto un único aviso a Comercial del stock que caduca dentro del plazo configurado, con las cifras del día. Se cierra solo cuando ya no queda nada por vencer.';


-- ────────────────────────────────────────────────────────────────────────────
--  Cotizaciones por vencer
-- ────────────────────────────────────────────────────────────────────────────
create or replace function cotizaciones_avisar_por_vencer()
returns int language plpgsql security definer set search_path = public as $$
declare v_dias int; v_n int;
begin
  select coalesce(nullif(valor,'')::int, 3) into v_dias
    from parametros where clave = 'cotizacion_aviso_vencimiento_dias';
  if v_dias is null then v_dias := 3; end if;

  select count(*) into v_n
    from cotizaciones
   where estado in ('aprobada', 'enviada')
     and vence_el between current_date and current_date + v_dias;

  if v_n = 0 then
    update alertas set atendida = true
     where entidad = 'cotizacion' and titulo = 'Cotizaciones por vencer' and not atendida;
    return 0;
  end if;

  perform alerta_resumen('cotizacion', 'Cotizaciones por vencer', 'advertencia',
    format('%s ofertas caducan en los próximos %s días. Conviene llamar al cliente antes de perder el precio.',
           v_n, v_dias));

  return v_n;
end $$;

comment on function cotizaciones_avisar_por_vencer is
  'Deja abierto un único aviso a Comercial de las ofertas que caducan pronto, con la cifra del día. Se cierra solo cuando ya no queda ninguna.';


-- ────────────────────────────────────────────────────────────────────────────
--  Y se limpia lo que ya se había acumulado
-- ────────────────────────────────────────────────────────────────────────────
--  De cada tipo se conserva el más reciente, que es el que lleva las cifras
--  buenas; los anteriores se cierran.
update alertas a set atendida = true
 where not atendida
   and titulo in ('Stock por vencer', 'Cotizaciones por vencer', 'Cotizaciones vencidas')
   and a.id <> (
     select id from alertas b
      where b.titulo = a.titulo and not b.atendida
      order by b.generada_en desc, b.id desc
      limit 1
   );
