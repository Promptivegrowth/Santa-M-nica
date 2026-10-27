-- ============================================================================
--  073 · EL MAESTRO DE VENDEDORES SE EDITA DESDE CONFIGURACIÓN
-- ============================================================================
--  Hasta ahora los vendedores (venta directa e intermediarios que traen al
--  cliente) solo se cargaban por base de datos. Desde esta versión se dan de
--  alta, se editan y se desactivan en Configuración › Maestros › Vendedores.
--
--  La escritura ya estaba limitada a Gerencia y Operaciones (política
--  «escritura_maestros»). Lo que faltaba es la huella: quién creó, cambió o
--  desactivó un vendedor y cuándo, como en el resto de los maestros.
--
--  Además, dos vendedores no pueden llamarse igual escritos con distinta
--  mayúscula o espacios («Pacific Seafood» y «pacific seafood »): en los
--  reportes por vendedor saldrían como dos canales distintos.
-- ============================================================================

drop trigger if exists audit_vendedores on vendedores;
create trigger audit_vendedores
  after insert or update or delete on vendedores
  for each row execute function auditar_cambios();

create unique index if not exists vendedores_nombre_normalizado
  on vendedores (lower(btrim(nombre)));
