-- ============================================================================
--  025 · QUE LA FECHA DE LA COTIZACIÓN CUADRE CON SU ESTADO
-- ============================================================================
--  Al calcular por fin el vencimiento salió a la luz que los datos de
--  demostración no eran coherentes: el sembrado elegía el estado y la fecha
--  por separado, con la fecha entre 1 y 200 días atrás y una validez de 15
--  días. Resultado: LAS 23 cotizaciones «enviada» estaban caducadas.
--
--  Eso no se ve mientras nadie mira el vencimiento, pero deja la pantalla sin
--  nada que enseñar: ni una oferta vigente, ni una por vencer.
--
--  Aquí se reparten las fechas de las ofertas vivas para que representen las
--  tres situaciones que el comercial tiene delante cada mañana: las que están
--  en plazo, las que caducan esta semana y las que ya se pasaron. Después se
--  ejecuta el cierre automático, que es el que mueve las últimas a «vencida».
--
--  TODOS LOS DATOS DE ESTE SISTEMA SON FICTICIOS.
-- ============================================================================
do $$
declare
  v_vigentes int; v_porVencer int; v_vencidas int;
begin
  /*
   * Se ordenan por id y se reparten en tres tercios. Se usa la fecha, no el
   * vencimiento: `vence_el` es una columna generada y no se puede escribir —
   * que es justamente la garantía de que nunca se desfase.
   */
  with numeradas as (
    select id, row_number() over (order by id) as n, count(*) over () as total,
           validez_dias
      from cotizaciones
     where estado in ('aprobada', 'enviada')
  )
  /*
   * El resto de `n` reparte las fechas dentro de cada tercio para que no
   * salgan todas iguales: sin eso, la lista enseña siete filas seguidas
   * diciendo «en 9 días» y se nota que es data fabricada.
   *
   * El `::int` no es adorno: `row_number()` devuelve bigint y PostgreSQL no
   * sabe restar un bigint a una fecha.
   */
  update cotizaciones c
     set fecha = case
           -- Primer tercio: en plazo, entre 6 y 12 días por delante
           when num.n * 3 <= num.total     then current_date - (num.validez_dias - 6 - (num.n % 7))::int
           -- Segundo tercio: caducan dentro de 0 a 3 días
           when num.n * 3 <= num.total * 2 then current_date - (num.validez_dias - (num.n % 4))::int
           -- Último tercio: se pasaron hace entre 2 y 11 días
           else                                 current_date - (num.validez_dias + 2 + (num.n % 10))::int
         end
    from numeradas num
   where c.id = num.id;

  select count(*) filter (where vence_el > current_date + 3),
         count(*) filter (where vence_el between current_date and current_date + 3),
         count(*) filter (where vence_el < current_date)
    into v_vigentes, v_porVencer, v_vencidas
    from cotizaciones where estado in ('aprobada', 'enviada');

  raise notice 'Ofertas vivas — en plazo: %, por vencer: %, pasadas: %',
    v_vigentes, v_porVencer, v_vencidas;
end $$;

-- Y ahora sí, el cierre automático hace su trabajo sobre el último tercio.
select cotizaciones_expirar_vencidas() as cerradas;
