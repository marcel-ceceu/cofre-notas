/**
 * Versão do app, lida do package.json em tempo de build (define do Vite).
 * `typeof` protege o vitest, onde o define não existe.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
