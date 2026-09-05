-- ============================================================================
--  037 · LOS AVISOS, SIN QUE NADIE TENGA QUE ACORDARSE
-- ============================================================================
--  Oliver pidió que la alerta de stock por vencer «le llegue a comercial». Una
--  alerta que solo aparece cuando alguien abre la pantalla correcta no es una
--  alerta: es un informe. Tiene que generarse sola.
--
--  pg_cron ejecuta tareas dentro de la propia base, sin depender de que el
--  servidor web esté levantado ni de que haya un usuario conectado. Es la
--  herramienta correcta para esto y viene con Supabase.
--
--  QUÉ SE PROGRAMA
--    · 06:00 Lima · el stock que vence pronto      (para Comercial)
--    · 06:05 Lima · las cotizaciones por caducar   (para Comercial)
--    · 06:10 Lima · cerrar las cotizaciones vencidas
--    · 06:15 Lima · soltar las reservas caducadas
--
--  A las seis de la mañana está todo listo antes de que nadie entre, que es
--  cuando sirve. Las horas van en UTC porque cron trabaja en UTC: las 06:00 de
--  Lima son las 11:00 UTC.
--
--  TODAS LAS FUNCIONES SON IDEMPOTENTES: si una se ejecuta dos veces no
--  duplica nada. Eso es lo que permite programarlas sin miedo.
-- ============================================================================
create extension if not exists pg_cron;

do $$
begin
  -- Se borran antes de crear, para que la migración se pueda repetir.
  perform cron.unschedule(jobname)
    from cron.job
   where jobname in ('avisar_stock_por_vencer', 'avisar_cotizaciones_por_vencer',
                     'cerrar_cotizaciones_vencidas', 'soltar_reservas_vencidas');
exception when others then
  -- La primera vez no hay nada que desprogramar.
  null;
end $$;

select cron.schedule('avisar_stock_por_vencer',        '0 11 * * *', $$ select stock_avisar_por_vencer() $$);
select cron.schedule('avisar_cotizaciones_por_vencer', '5 11 * * *', $$ select cotizaciones_avisar_por_vencer() $$);
select cron.schedule('cerrar_cotizaciones_vencidas',  '10 11 * * *', $$ select cotizaciones_expirar_vencidas() $$);
select cron.schedule('soltar_reservas_vencidas',      '15 11 * * *', $$ select reservas_expirar_vencidas() $$);


-- ============================================================================
--  Y SE EJECUTAN UNA VEZ AHORA
--  Para que las alertas existan desde el primer momento y no haya que esperar
--  a mañana para ver si funcionan.
-- ============================================================================
select stock_avisar_por_vencer()        as stock_por_vencer;
select cotizaciones_avisar_por_vencer() as cotizaciones_por_vencer;
