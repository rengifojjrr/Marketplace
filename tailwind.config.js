/* Configuración de Tailwind para compilar la hoja de la beta.
   El tema vive en tokens/tumbo-theme.json — única fuente de verdad,
   compartida con la documentación del sistema de diseño. */
const theme = require('./tokens/tumbo-theme.json');

module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './sin-conexion.html',
    './app/**/*.html',
    './prototipo/**/*.html',
    './paginas/**/*.html',
    './assets/js/**/*.js'
  ],
  theme: { extend: theme },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries')
  ]
};
