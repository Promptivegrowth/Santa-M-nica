-- ============================================================================
--  040 · LAS ALERTAS, AGRUPADAS POR TIPO
-- ============================================================================
--  EL FALLO QUE LO PROVOCA
--  Oliver pidió que Comercial reciba un aviso del producto que está por
--  vencerse. El aviso se genera —una sola alerta con el resumen— pero en el
--  panel NO SE VE, y por una razón tonta: hay 349 alertas sin atender, el
--  panel muestra las 8 más graves, y las ocho son «Producto con vida útil
--  vencida», que se genera UNA POR LOTE y hay 43.
--
--  Es decir: el panel muestra ocho veces el mismo problema y esconde los otros
--  nueve tipos. Cuantas más alertas hay, menos informa.
--
--  QUÉ SE HACE
--  Agrupar por tipo. «Producto con vida útil vencida · 43» dice en una línea
--  lo que antes ocupaba ocho, y deja sitio para que se vean TODOS los tipos.
--  El detalle lote a lote no se pierde: sigue entero en /alertas.
--
--  Se agrupa en la base y no en la pantalla porque las alertas ya pasan de
--  trescientas y la API corta en mil filas sin avisar.
-- ============================================================================
create or replace view v_alertas_resumen as
select
  titulo,
  severidad,
  -- La entidad sirve para enlazar: si todas las alertas del grupo son sobre lo
  -- mismo —lotes, facturas—, se puede llevar al usuario al listado filtrado.
  min(entidad)                                      as entidad,
  count(*)                                          as cuantas,
  -- Cuando el grupo es de una sola alerta, su mensaje ES la información útil;
  -- si son muchas, el mensaje de una sola engañaría, así que se deja vacío.
  case when count(*) = 1 then min(mensaje) end      as mensaje,
  -- Para poder ir al registro concreto cuando el grupo tiene una sola alerta.
  case when count(*) = 1 then min(entidad_id) end   as entidad_id,
  max(generada_en)                                  as ultima,
  min(generada_en)                                  as primera
from alertas
where not atendida
group by titulo, severidad;

comment on view v_alertas_resumen is
  'Las alertas sin atender agrupadas por tipo y severidad. Existe porque el panel mostraba ocho veces el mismo problema —hay una alerta por lote— y escondía los demás tipos, incluido el aviso de stock por vencer que pidió el cliente.';
