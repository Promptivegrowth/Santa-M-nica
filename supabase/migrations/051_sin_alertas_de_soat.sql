-- ============================================================================
--  051 · FUERA LAS ALERTAS DE SOAT
-- ============================================================================
--  Lo pidió el cliente: retirar las alertas del SOAT de las unidades.
--
--  QUÉ SE QUITA Y QUÉ NO
--  Se quita la REGLA que las generaba y las alertas que ya había. Con la
--  relación en cascada, borrar la regla arrastra sus alertas: no queda ninguna
--  huérfana en el panel.
--
--  Se BORRA en vez de desactivarse a propósito. Una regla desactivada sigue
--  apareciendo en Configuración con su interruptor apagado, y alguien acabaría
--  preguntando por qué el SOAT sigue ahí si se pidió quitarlo —o peor, lo
--  volvería a encender sin saber que se retiró adrede—.
--
--  LO QUE NO SE TOCA: la validación al programar un embarque. Esa no es una
--  alerta, es un control: impide asignar a un embarque un camión con el SOAT
--  o la revisión técnica vencidos, porque un vehículo así no puede circular.
--  Se deja porque no se pidió retirarla, y porque quitarla sin preguntar
--  significaría dejar que salga un camión que no puede salir.
--
--  La fecha de vencimiento del SOAT sigue guardada en la ficha del vehículo:
--  es un dato, no un aviso, y el control de arriba la necesita.
-- ============================================================================
delete from reglas where nombre = 'SOAT por vencer';

--  Por si alguna alerta de SOAT se hubiera creado sin regla asociada —las de
--  la semilla se insertaban con su `regla_id`, pero no se da por supuesto—.
delete from alertas where titulo = 'SOAT por vencer';
