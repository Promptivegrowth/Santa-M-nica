import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * La plantilla Word del contrato se lee del disco al generar. Se declara
   * para que viaje con la función al desplegar: no está en /public.
   */
  outputFileTracingIncludes: {
    '/api/contratos/[id]': ['./plantillas/**/*'],
  },
};

export default nextConfig;
