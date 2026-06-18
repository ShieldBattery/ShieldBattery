// Allows us to import 'foo.css' for its side effects in webpack'd files. TypeScript 6 errors on
// side-effect imports of modules without type declarations (TS2882); webpack handles the actual
// CSS loading.
declare module '*.css'
