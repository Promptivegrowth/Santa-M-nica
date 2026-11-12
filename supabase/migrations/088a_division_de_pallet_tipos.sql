-- ============================================================================
--  088a · DOS TIPOS DE MOVIMIENTO NUEVOS PARA LA DIVISIÓN DE PALLET
-- ============================================================================
--  Va aparte de la 088 porque PostgreSQL no deja usar un valor nuevo de un
--  enum en la misma transacción en que se agrega: primero se corre esta, y
--  después la 088 (que ya los usa en signo_movimiento y en pallet_dividir).
--
--  Son tipos propios y no un «ajuste» ni un «ingreso»: una división no cambia
--  el stock total ni es producción nueva. Así no se cuenta como ajuste en
--  Ajustes de stock ni como producción en el cierre o los objetivos (que
--  cuentan tipo = 'ingreso').
--
--  Re-ejecutable: «if not exists».
-- ============================================================================

alter type tipo_movimiento add value if not exists 'division_salida';
alter type tipo_movimiento add value if not exists 'division_ingreso';

--  089 · Eliminar un despacho (reunión del 12/11): lo que salió vuelve a
--  cámara con su propio movimiento, no borrando el Kardex.
alter type tipo_movimiento add value if not exists 'anulacion_despacho';
