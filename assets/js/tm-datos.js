/* =========================================================================
   Tumbo Market — Datos semilla de la beta funcional
   -------------------------------------------------------------------------
   Única fuente de los datos iniciales del modo local. El estado vivo (con
   todo lo que el usuario cree o modifique) se guarda en localStorage;
   «Reiniciar demo» vuelve exactamente a esto. Todos los datos son ficticios.
   El backend carga los mismos datos desde
   supabase/migrations/20261022170300_tumbo_semilla.sql: si cambias uno,
   cambia el otro.
   ========================================================================= */
window.TM_SEED = {
  version: 4,

  config: {
    tasa: 36.20,               /* Bs. por USD — tasa demo, fuente «BCV (demo)» */
    comisionPct: 10,           /* comisión del marketplace sobre el bruto      */
    tarifaFijaUsd: 0.60,       /* tarifa fija por pedido liquidado             */
    ventanaReclamoDias: 3,     /* días tras la entrega para abrir reclamo      */
    ciudadEntrega: 'Caracas 1010'
  },

  usuarios: [
    { email: 'comprador@demo.ve',           clave: 'demo1234', nombre: 'María González',  rol: 'comprador',  mfa: false },
    { email: 'propietario@sel-014.demo',    clave: 'demo1234', nombre: 'Jorge Rengifo',   rol: 'seller',     mfa: true,  sellerId: 'SEL-014' },
    { email: 'precios@sel-014.demo',        clave: 'demo1234', nombre: 'Ana Fuentes',     rol: 'precios',    mfa: true,  sellerId: 'SEL-014' },
    { email: 'operador@sel-014.demo',       clave: 'demo1234', nombre: 'Luis Medina',     rol: 'operador',   mfa: false, sellerId: 'SEL-014' },
    { email: 'superadmin@tumbomarket.demo', clave: 'demo1234', nombre: 'Carla Núñez',     rol: 'superadmin', mfa: true },
    { email: 'operaciones@tumbomarket.demo',clave: 'demo1234', nombre: 'Pedro Salas',     rol: 'ops',        mfa: true },
    { email: 'finanzas@tumbomarket.demo',   clave: 'demo1234', nombre: 'Rosa Blanco',     rol: 'finanzas',   mfa: true }
  ],

  categorias: [
    { id: 'automotriz', nombre: 'Automotriz',  icono: 'directions_car' },
    { id: 'tecnologia', nombre: 'Tecnología',  icono: 'devices' },
    { id: 'hogar',      nombre: 'Hogar',       icono: 'kitchen' },
    { id: 'salud',      nombre: 'Salud',       icono: 'local_pharmacy' },
    { id: 'moda',       nombre: 'Moda',        icono: 'checkroom' }
  ],

  sellers: [
    { id: 'SEL-014', nombre: 'TechElectro, C.A.', rif: 'J-40881234-5', ciudad: 'Caracas',
      estado: 'aprobado', rating: 4.8, resenas: 142, desde: '02/03/2026',
      descripcion: 'Repuestos automotrices y tecnología con garantía nacional.',
      docs: [
        { nombre: 'RIF vigente',            estado: 'aprobado' },
        { nombre: 'Registro mercantil',     estado: 'aprobado' },
        { nombre: 'Cédula del representante', estado: 'aprobado' },
        { nombre: 'Cuenta de liquidación',  estado: 'aprobado' }
      ] },
    { id: 'SEL-009', nombre: 'Hogar Total, C.A.', rif: 'J-31220987-1', ciudad: 'Valencia',
      estado: 'aprobado', rating: 4.5, resenas: 87, desde: '15/01/2026',
      descripcion: 'Todo para el hogar: cocina, limpieza y organización.',
      docs: [
        { nombre: 'RIF vigente',            estado: 'aprobado' },
        { nombre: 'Registro mercantil',     estado: 'aprobado' },
        { nombre: 'Cédula del representante', estado: 'aprobado' },
        { nombre: 'Cuenta de liquidación',  estado: 'aprobado' }
      ] },
    { id: 'SEL-021', nombre: 'Farma Andina, C.A.', rif: 'J-50778812-3', ciudad: 'Mérida',
      estado: 'en_revision', rating: null, resenas: 0, desde: '27/08/2026',
      descripcion: 'Productos de salud y cuidado personal.',
      docs: [
        { nombre: 'RIF vigente',            estado: 'aprobado' },
        { nombre: 'Registro mercantil',     estado: 'en_revision' },
        { nombre: 'Cédula del representante', estado: 'aprobado' },
        { nombre: 'Cuenta de liquidación',  estado: 'pendiente' }
      ] },
    { id: 'SEL-017', nombre: 'Moda Urbana 21, C.A.', rif: 'J-29455610-9', ciudad: 'Maracaibo',
      estado: 'observado', rating: 4.1, resenas: 23, desde: '11/06/2026',
      descripcion: 'Ropa y accesorios urbanos.',
      observacion: 'El registro mercantil está vencido: se solicitó la renovación.',
      docs: [
        { nombre: 'RIF vigente',            estado: 'aprobado' },
        { nombre: 'Registro mercantil',     estado: 'observado' },
        { nombre: 'Cédula del representante', estado: 'aprobado' },
        { nombre: 'Cuenta de liquidación',  estado: 'aprobado' }
      ] }
  ],

  productos: [
    { sku: 'SKU-MOT-0832', nombre: 'Caucho Rin 14 · 185/60 R14', marca: 'Bridgestone',
      categoria: 'automotriz', precioUsd: 70, stockFis: 15, stockRes: 0, estado: 'publicado',
      sellerId: 'SEL-014', img: 'producto-01', rating: 4.7, resenas: 96,
      descripcion: 'Caucho radial para rin 14, compuesto de larga duración y agarre en pavimento húmedo. Garantía de 5 años contra defectos de fabricación.',
      specs: { 'Medida': '185/60 R14', 'Índice de carga': '82H', 'Origen': 'Nacional', 'Garantía': '5 años' } },
    { sku: 'SKU-MOT-0777', nombre: 'Batería 12V 65Ah libre de mantenimiento', marca: 'Duncan',
      categoria: 'automotriz', precioUsd: 95, stockFis: 8, stockRes: 1, estado: 'publicado',
      sellerId: 'SEL-014', img: 'producto-02', rating: 4.6, resenas: 61,
      descripcion: 'Batería sellada de 65 amperios, arranque en frío garantizado. Incluye instalación gratuita en Caracas.',
      specs: { 'Voltaje': '12 V', 'Capacidad': '65 Ah', 'Polaridad': 'Izquierda', 'Garantía': '18 meses' } },
    { sku: 'SKU-ELE-1045', nombre: 'Alternador Bosch 12V 90A', marca: 'Bosch',
      categoria: 'automotriz', precioUsd: 120, stockFis: 8, stockRes: 0, estado: 'en_revision',
      sellerId: 'SEL-014', img: 'producto-03', rating: null, resenas: 0,
      descripcion: 'Alternador original Bosch de 90 amperios para vehículos livianos.',
      specs: { 'Amperaje': '90 A', 'Voltaje': '12 V', 'Condición': 'Nuevo' } },
    { sku: 'SKU-MAN-0021', nombre: 'Filtro de aceite sintético', marca: 'Mann',
      categoria: 'automotriz', precioUsd: 15, stockFis: 0, stockRes: 0, estado: 'pausado',
      sellerId: 'SEL-014', img: 'producto-04', rating: 4.4, resenas: 33,
      descripcion: 'Filtro de aceite de alto flujo para motores a gasolina.',
      specs: { 'Rosca': '3/4-16', 'Compatibilidad': 'Ver tabla del fabricante' } },
    { sku: 'SKU-TEC-0301', nombre: 'Monitor 24" FHD 75Hz', marca: 'Samsung',
      categoria: 'tecnologia', precioUsd: 140, stockFis: 12, stockRes: 0, estado: 'publicado',
      sellerId: 'SEL-014', img: 'producto-05', rating: 4.8, resenas: 210,
      descripcion: 'Monitor Full HD de 24 pulgadas, panel VA, 75 Hz, bordes ultradelgados. Ideal para oficina y estudio.',
      specs: { 'Resolución': '1920×1080', 'Tasa': '75 Hz', 'Puertos': 'HDMI, VGA', 'Garantía': '1 año' } },
    { sku: 'SKU-TEC-0450', nombre: 'Audífonos Bluetooth con estuche', marca: 'Xiaomi',
      categoria: 'tecnologia', precioUsd: 25, stockFis: 40, stockRes: 0, estado: 'publicado',
      sellerId: 'SEL-014', img: 'producto-06', rating: 4.3, resenas: 154,
      descripcion: 'Audífonos inalámbricos con cancelación pasiva y 20 horas de autonomía con el estuche.',
      specs: { 'Bluetooth': '5.3', 'Autonomía': '20 h', 'Carga': 'USB-C' } },
    { sku: 'SKU-TEC-0512', nombre: 'Teclado mecánico retroiluminado', marca: 'Redragon',
      categoria: 'tecnologia', precioUsd: 45, stockFis: 6, stockRes: 0, estado: 'borrador',
      sellerId: 'SEL-014', img: 'producto-01', rating: null, resenas: 0,
      descripcion: 'Teclado mecánico switch rojo, retroiluminación RGB, formato 87 teclas.',
      specs: { 'Switch': 'Rojo', 'Formato': 'TKL 87' } },
    { sku: 'SKU-HOG-0110', nombre: 'Licuadora 600W vaso de vidrio', marca: 'Oster',
      categoria: 'hogar', precioUsd: 55, stockFis: 18, stockRes: 0, estado: 'publicado',
      sellerId: 'SEL-009', img: 'producto-02', rating: 4.5, resenas: 78,
      descripcion: 'Licuadora de 600 W con vaso de vidrio de 1,5 L y cuchillas de acero inoxidable.',
      specs: { 'Potencia': '600 W', 'Vaso': 'Vidrio 1,5 L', 'Velocidades': '3 + pulso' } },
    { sku: 'SKU-HOG-0234', nombre: 'Juego de ollas 7 piezas antiadherente', marca: 'Tramontina',
      categoria: 'hogar', precioUsd: 80, stockFis: 9, stockRes: 1, estado: 'publicado',
      sellerId: 'SEL-009', img: 'producto-03', rating: 4.6, resenas: 45,
      descripcion: 'Juego de ollas con recubrimiento antiadherente y tapas de vidrio templado.',
      specs: { 'Piezas': '7', 'Material': 'Aluminio antiadherente' } }
  ],

  /* Direcciones del comprador demo */
  direcciones: {
    'comprador@demo.ve': [
      { id: 'DIR-1', nombre: 'Casa', linea: 'Av. Francisco de Miranda, Res. El Parque, Torre B, Apto 4-2',
        municipio: 'Chacao', ciudad: 'Caracas', codigo: '1060', telefono: '0412-5550101', predeterminada: true },
      { id: 'DIR-2', nombre: 'Oficina', linea: 'Torre Polar, piso 6, ofic. 6-C, Plaza Venezuela',
        municipio: 'Libertador', ciudad: 'Caracas', codigo: '1050', telefono: '0212-7810202', predeterminada: false }
    ]
  },

  carritos: {},

  /* --- Pedidos ----------------------------------------------------------
     estado:  pago_por_verificar → por_aceptar → preparando → listo →
              despachado → entregado → cerrado | cancelado | reembolsado | devolucion
     liquidacion: — | retenido | congelado | elegible | liquidado | reembolsado  */
  pedidos: [
    { id: 'TM-2026-00415', compradorEmail: 'comprador@demo.ve', sellerId: 'SEL-014',
      items: [{ sku: 'SKU-TEC-0450', cant: 1, precioUsd: 25 }],
      envio: { tipo: 'domicilio', dir: 'Av. Francisco de Miranda, Res. El Parque, Torre B, Apto 4-2, Chacao', courier: 'Zoom (demo)', costoUsd: 3 },
      tasa: 36.20, estado: 'cerrado', liquidacion: 'elegible', ref: 'PM-771204', metodo: 'Pago Móvil',
      creado: '21/08/2026 10:12 am', entregadoEl: '24/08/2026 03:40 pm', guia: 'TM-GUIA-88410',
      timeline: [
        { fecha: '21/08/2026 10:12 am', actor: 'María González', texto: 'Pedido creado y pago registrado (Pago Móvil ref. PM-771204)', icono: 'shopping_cart' },
        { fecha: '21/08/2026 11:05 am', actor: 'Finanzas',       texto: 'Pago conciliado', icono: 'fact_check' },
        { fecha: '21/08/2026 02:30 pm', actor: 'SEL-014',        texto: 'Pedido aceptado, preparación iniciada', icono: 'inventory_2' },
        { fecha: '22/08/2026 09:15 am', actor: 'SEL-014',        texto: 'Paquete listo · guía TM-GUIA-88410', icono: 'package_2' },
        { fecha: '22/08/2026 01:10 pm', actor: 'Courier',        texto: 'Paquete retirado por Zoom (demo)', icono: 'local_shipping' },
        { fecha: '24/08/2026 03:40 pm', actor: 'María González', texto: 'Entrega confirmada', icono: 'check_circle' },
        { fecha: '27/08/2026 03:40 pm', actor: 'Sistema',        texto: 'Ventana de reclamo cerrada sin casos · fondos elegibles', icono: 'lock_open' }
      ] },

    { id: 'TM-2026-00422', compradorEmail: 'comprador@demo.ve', sellerId: 'SEL-009',
      items: [{ sku: 'SKU-HOG-0110', cant: 1, precioUsd: 55 }],
      envio: { tipo: 'agencia', dir: 'Agencia MRW La Candelaria, Caracas', courier: 'MRW (demo)', costoUsd: 2.5 },
      tasa: 36.20, estado: 'cerrado', liquidacion: 'liquidado', ref: 'TRF-90211', metodo: 'Transferencia', liquidacionId: 'LIQ-2026-008',
      creado: '12/08/2026 04:20 pm', entregadoEl: '15/08/2026 11:00 am', guia: 'TM-GUIA-87719',
      timeline: [
        { fecha: '12/08/2026 04:20 pm', actor: 'María González', texto: 'Pedido creado y pago registrado (transferencia ref. TRF-90211)', icono: 'shopping_cart' },
        { fecha: '15/08/2026 11:00 am', actor: 'María González', texto: 'Entrega confirmada en agencia', icono: 'check_circle' },
        { fecha: '20/08/2026 09:00 am', actor: 'Finanzas',       texto: 'Incluido en la liquidación LIQ-2026-008', icono: 'receipt_long' }
      ] },

    { id: 'TM-2026-00428', compradorEmail: 'comprador@demo.ve', sellerId: 'SEL-014',
      items: [{ sku: 'SKU-MOT-0832', cant: 2, precioUsd: 70 }],
      envio: { tipo: 'domicilio', dir: 'Av. Francisco de Miranda, Res. El Parque, Torre B, Apto 4-2, Chacao', courier: 'Tealca (demo)', costoUsd: 5 },
      tasa: 36.20, estado: 'entregado', liquidacion: 'congelado', ref: 'PM-778812', metodo: 'Pago Móvil',
      disputaId: 'DSP-0098',
      creado: '24/08/2026 09:45 am', entregadoEl: '27/08/2026 02:15 pm', guia: 'TM-GUIA-88602',
      timeline: [
        { fecha: '24/08/2026 09:45 am', actor: 'María González', texto: 'Pedido creado y pago registrado (Pago Móvil ref. PM-778812)', icono: 'shopping_cart' },
        { fecha: '24/08/2026 10:30 am', actor: 'Finanzas',       texto: 'Pago conciliado', icono: 'fact_check' },
        { fecha: '24/08/2026 02:00 pm', actor: 'SEL-014',        texto: 'Pedido aceptado, preparación iniciada', icono: 'inventory_2' },
        { fecha: '25/08/2026 08:40 am', actor: 'SEL-014',        texto: 'Paquete listo · guía TM-GUIA-88602', icono: 'package_2' },
        { fecha: '25/08/2026 12:05 pm', actor: 'Courier',        texto: 'Paquete retirado por Tealca (demo)', icono: 'local_shipping' },
        { fecha: '27/08/2026 02:15 pm', actor: 'María González', texto: 'Entrega confirmada', icono: 'check_circle' },
        { fecha: '27/08/2026 06:20 pm', actor: 'María González', texto: 'Reclamo DSP-0098 abierto · liquidación congelada', icono: 'gavel' }
      ] },

    { id: 'TM-2026-00431', compradorEmail: 'comprador@demo.ve', sellerId: 'SEL-014',
      items: [{ sku: 'SKU-TEC-0301', cant: 1, precioUsd: 140 }],
      envio: { tipo: 'domicilio', dir: 'Torre Polar, piso 6, ofic. 6-C, Plaza Venezuela, Libertador', courier: 'Zoom (demo)', costoUsd: 4 },
      tasa: 36.20, estado: 'despachado', liquidacion: null, ref: 'PM-779955', metodo: 'Pago Móvil', guia: 'TM-GUIA-88710',
      creado: '27/08/2026 11:20 am',
      timeline: [
        { fecha: '27/08/2026 11:20 am', actor: 'María González', texto: 'Pedido creado y pago registrado (Pago Móvil ref. PM-779955)', icono: 'shopping_cart' },
        { fecha: '27/08/2026 12:00 pm', actor: 'Finanzas',       texto: 'Pago conciliado', icono: 'fact_check' },
        { fecha: '27/08/2026 03:10 pm', actor: 'SEL-014',        texto: 'Pedido aceptado, preparación iniciada', icono: 'inventory_2' },
        { fecha: '28/08/2026 09:30 am', actor: 'SEL-014',        texto: 'Paquete listo · guía TM-GUIA-88710', icono: 'package_2' },
        { fecha: '28/08/2026 11:45 am', actor: 'Courier',        texto: 'Paquete retirado por Zoom (demo) · en tránsito', icono: 'local_shipping' }
      ] },

    { id: 'TM-2026-00433', compradorEmail: 'comprador@demo.ve', sellerId: 'SEL-009',
      items: [{ sku: 'SKU-HOG-0234', cant: 1, precioUsd: 80 }],
      envio: { tipo: 'agencia', dir: 'Agencia Tealca Sabana Grande, Caracas', courier: 'Tealca (demo)', costoUsd: 2.5 },
      tasa: 36.20, estado: 'pago_por_verificar', liquidacion: null, ref: 'TRF-91108', metodo: 'Transferencia',
      creado: '28/08/2026 05:35 pm',
      timeline: [
        { fecha: '28/08/2026 05:35 pm', actor: 'María González', texto: 'Pedido creado y pago registrado (transferencia ref. TRF-91108)', icono: 'shopping_cart' }
      ] },

    { id: 'TM-2026-00434', compradorEmail: 'comprador@demo.ve', sellerId: 'SEL-014',
      items: [{ sku: 'SKU-MOT-0777', cant: 1, precioUsd: 95 }],
      envio: { tipo: 'domicilio', dir: 'Av. Francisco de Miranda, Res. El Parque, Torre B, Apto 4-2, Chacao', courier: 'Zoom (demo)', costoUsd: 4 },
      tasa: 36.20, estado: 'por_aceptar', liquidacion: null, ref: 'PM-780331', metodo: 'Pago Móvil',
      creado: '28/08/2026 07:58 pm', slaHoras: 24,
      timeline: [
        { fecha: '28/08/2026 07:58 pm', actor: 'María González', texto: 'Pedido creado y pago registrado (Pago Móvil ref. PM-780331)', icono: 'shopping_cart' },
        { fecha: '28/08/2026 08:15 pm', actor: 'Finanzas',       texto: 'Pago conciliado · pendiente de aceptación del seller', icono: 'fact_check' }
      ] }
  ],

  disputas: [
    { id: 'DSP-0098', pedidoId: 'TM-2026-00428', compradorEmail: 'comprador@demo.ve', sellerId: 'SEL-014',
      motivo: 'Producto dañado', estado: 'abierta', creado: '27/08/2026 06:20 pm',
      descripcion: 'Uno de los dos cauchos llegó con una deformación visible en el talón. Adjunto fotos y el video de la apertura del paquete.',
      evidencia: ['foto-talon-1.jpg', 'foto-talon-2.jpg', 'video-apertura.mp4'],
      montoUsd: 70,
      respuestaSeller: null, resolucion: null }
  ],

  liquidaciones: [
    { id: 'LIQ-2026-008', sellerId: 'SEL-009', periodo: '01/08/2026 – 15/08/2026',
      pedidos: ['TM-2026-00422'], brutoUsd: 55, comisionUsd: 5.5, tarifaUsd: 0.6,
      netoUsd: 48.9, estado: 'pagada', fecha: '20/08/2026', comprobante: 'CPR-2026-008' }
  ],

  notificaciones: [
    { para: 'seller:SEL-014', texto: 'Nuevo pedido TM-2026-00434 pendiente de aceptar', icono: 'shopping_cart', fecha: '28/08/2026 08:15 pm', leida: false, enlace: 'seller/pedidos.html' },
    { para: 'seller:SEL-014', texto: 'Reclamo DSP-0098 abierto sobre TM-2026-00428: responde con tu evidencia', icono: 'gavel', fecha: '27/08/2026 06:20 pm', leida: false, enlace: 'seller/disputas.html' },
    { para: 'rol:ops',        texto: 'Disputa DSP-0098 en cola: producto dañado, Bs. 2.534,00', icono: 'gavel', fecha: '27/08/2026 06:20 pm', leida: false, enlace: 'admin/disputas.html' },
    { para: 'rol:finanzas',   texto: 'Pago TRF-91108 pendiente de conciliar (TM-2026-00433)', icono: 'fact_check', fecha: '28/08/2026 05:35 pm', leida: false, enlace: 'admin/conciliacion.html' },
    { para: 'rol:superadmin', texto: 'Seller SEL-021 (Farma Andina) espera revisión KYC', icono: 'verified_user', fecha: '27/08/2026 09:00 am', leida: false, enlace: 'admin/sellers.html' },
    { para: 'comprador@demo.ve', texto: 'Tu pedido TM-2026-00431 va en camino', icono: 'local_shipping', fecha: '28/08/2026 11:45 am', leida: false, enlace: 'tienda/pedido.html?id=TM-2026-00431' }
  ],

  eventos: [
    { fecha: '28/08/2026 08:15 pm', actor: 'Rosa Blanco', accion: 'Conciliación de pago', detalle: 'PM-780331 → TM-2026-00434' },
    { fecha: '27/08/2026 06:20 pm', actor: 'María González', accion: 'Apertura de disputa', detalle: 'DSP-0098 sobre TM-2026-00428' },
    { fecha: '27/08/2026 06:20 pm', actor: 'Sistema', accion: 'Congelación de liquidación', detalle: 'TM-2026-00428 por DSP-0098' },
    { fecha: '20/08/2026 09:00 am', actor: 'Rosa Blanco', accion: 'Liquidación ejecutada', detalle: 'LIQ-2026-008 → SEL-009 · $48.90' }
  ]
};
