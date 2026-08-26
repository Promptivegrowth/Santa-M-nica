import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    /*
     * ------------------------------------------------------------------
     *  El guion bajo significa «esto sobra a propósito»
     * ------------------------------------------------------------------
     *  Hay dos sitios donde declarar algo sin usarlo es lo correcto:
     *
     *   · Descartar campos al desestructurar. Por ejemplo, quitar de una
     *     línea del formulario las tres ayudas de pantalla antes de
     *     mandarla al servidor: hay que nombrarlas para excluirlas.
     *
     *   · Saltarse un parámetro intermedio de una función, cuando solo
     *     interesa el que viene después.
     *
     *  En ambos casos el nombre documenta la intención, así que borrarlo
     *  no es una opción. Con el prefijo se le dice al linter —y a quien
     *  lea el código— que la omisión es deliberada, en lugar de callar el
     *  aviso con un comentario suelto que después nadie revisa.
     * ------------------------------------------------------------------
     */
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);

export default eslintConfig;
