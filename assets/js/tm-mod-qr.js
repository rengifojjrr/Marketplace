/* =========================================================================
   Tumbo Market — Códigos QR
   -------------------------------------------------------------------------
   TM.qr(texto, tamaño) → SVG (texto) listo para insertar en una vista: guías,
   retiro en agencia, configuración del segundo factor, etc.

   Usa qrcode-generator 2.0.4 de Kazuhiko Arase (licencia MIT), vendorizada
   en assets/js/vendor/qrcode-generator/ con su LICENSE. El texto se codifica
   en UTF-8 y con corrección de errores «M»; la versión (tamaño de la
   matriz) se elige sola según el largo del texto.
   ========================================================================= */
(function () {
  'use strict';

  var contador = 0;

  function qr(texto, tamano) {
    var gen = window.qrcode;
    if (!gen) throw new Error('La librería de códigos QR no está cargada.');
    var lado = Math.max(48, Math.min(1024, parseInt(tamano, 10) || 160));
    var anterior = gen.stringToBytes;
    gen.stringToBytes = gen.stringToBytesFuncs['UTF-8'];
    try {
      var codigo = gen(0, 'M');
      codigo.addData(String(texto == null ? '' : texto), 'Byte');
      codigo.make();
      /* escalable (viewBox) y con su tamaño fijado aquí; margen de 4 módulos */
      var svg = codigo.createSvgTag({ cellSize: 4, margin: 16, scalable: true,
        title: { text: 'Código QR', id: 'tm-qr-' + (++contador) } });
      return svg.replace('<svg ', '<svg width="' + lado + '" height="' + lado + '" class="tm-qr" ');
    } finally {
      gen.stringToBytes = anterior;
    }
  }

  window.TM.qr = qr;
})();
