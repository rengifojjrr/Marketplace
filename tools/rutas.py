# -*- coding: utf-8 -*-
"""Mapa canónico: carpeta exportada por Stitch -> ruta navegable de la beta.

Cada entrada es (ruta_relativa, superficie, rol_principal, titulo, grupo).
`canonica=True` marca la pantalla que representa al grupo en el índice; las
variantes (móvil, revisiones, duplicados de Stitch) quedan accesibles pero
no compiten con ella en la navegación principal.
"""

# superficies
MK, SC, BO, DM, SY = 'marketplace', 'seller', 'backoffice', 'demo', 'sistema'

PANTALLAS = [
    # dir_origen                                    ruta                                       sup rol             grupo             titulo                                              canon
    ('inicio_tumbo_market_desktop',                 'marketplace/inicio.html',                  MK, 'visitante',   'Descubrimiento', 'Inicio — Marketplace público',                      True),
    ('inicio_tumbo_market_m_vil',                   'marketplace/inicio-movil.html',            MK, 'visitante',   'Descubrimiento', 'Inicio (móvil 390 px)',                             False),
    ('marketplace_home_desktop',                    'marketplace/inicio-variante.html',         MK, 'visitante',   'Descubrimiento', 'Inicio — variante de maquetación',                   False),
    ('resultados_monitor_4k_desktop',               'marketplace/resultados.html',              MK, 'visitante',   'Descubrimiento', 'Resultados de búsqueda',                            True),
    ('resultados_monitor_4k_m_vil',                 'marketplace/resultados-movil.html',        MK, 'visitante',   'Descubrimiento', 'Resultados de búsqueda (móvil)',                    False),
    ('detalle_de_producto_desktop',                 'marketplace/producto.html',                MK, 'visitante',   'Descubrimiento', 'Detalle de producto — SKU-MOT-0832',                True),
    ('detalle_de_producto_m_vil',                   'marketplace/producto-movil.html',          MK, 'visitante',   'Descubrimiento', 'Detalle de producto (móvil)',                       False),
    ('carrito_de_compras_desktop',                  'marketplace/carrito.html',                 MK, 'visitante',   'Compra',         'Carrito de compras',                                True),
    ('carrito_de_compras_m_vil',                    'marketplace/carrito-movil.html',           MK, 'visitante',   'Compra',         'Carrito de compras (móvil)',                        False),
    ('checkout_pago_demo_desktop',                  'marketplace/checkout-pago.html',           MK, 'comprador',   'Compra',         'Checkout — pago demo',                              True),
    ('checkout_pago_demo_mobile',                   'marketplace/checkout-pago-movil.html',     MK, 'comprador',   'Compra',         'Checkout — pago demo (móvil)',                      False),
    ('mi_cuenta_desktop',                           'marketplace/mi-cuenta.html',               MK, 'comprador',   'Postventa',      'Mi cuenta',                                         True),
    ('mi_cuenta_mobile',                            'marketplace/mi-cuenta-movil.html',         MK, 'comprador',   'Postventa',      'Mi cuenta (móvil)',                                 False),
    ('detalle_y_seguimiento_desktop',               'marketplace/pedido-seguimiento.html',      MK, 'comprador',   'Postventa',      'Detalle y seguimiento — TM-2026-00428',             True),
    ('detalle_y_seguimiento_mobile',                'marketplace/pedido-seguimiento-movil.html',MK, 'comprador',   'Postventa',      'Detalle y seguimiento (móvil)',                     False),
    ('gesti_n_de_reclamo_dsp_0098_desktop',         'marketplace/reclamo.html',                 MK, 'comprador',   'Postventa',      'Reclamo del comprador — DSP-0098',                  True),
    ('gesti_n_de_reclamo_dsp_0098_mobile',          'marketplace/reclamo-movil.html',           MK, 'comprador',   'Postventa',      'Reclamo del comprador (móvil)',                     False),

    ('seller_center_onboarding_y_kyc',              'seller/onboarding-kyc.html',               SC, 'seller',      'Homologación',   'Onboarding y KYC — SEL-014',                        True),
    ('onboarding_y_verificaci_n_sel_014',           'seller/onboarding-verificacion.html',      SC, 'seller',      'Homologación',   'Onboarding y verificación — detalle',               False),
    ('seller_center_dashboard_desktop',             'seller/dashboard.html',                    SC, 'seller',      'Gestión',        'Panel del Seller Center',                       True),
    ('seller_center_dashboard_m_vil',               'seller/dashboard-movil.html',              SC, 'seller',      'Gestión',        'Panel del seller (móvil)',                      False),
    ('seller_center_dashboard_principal',           'seller/dashboard-principal.html',          SC, 'seller',      'Gestión',        'Panel — variante principal',                    False),
    ('seller_dashboard_desktop_sel_014',            'seller/dashboard-sel-014.html',            SC, 'seller',      'Gestión',        'Panel SEL-014',                                 False),
    ('seller_dashboard_mobile_sel_014',             'seller/dashboard-sel-014-movil.html',      SC, 'seller',      'Gestión',        'Panel SEL-014 (móvil)',                         False),
    ('demo_seller_dashboard_revisado',              'seller/dashboard-revisado.html',           SC, 'seller',      'Gestión',        'Panel — revisión de consistencia',              False),
    ('seller_center_gesti_n_de_cat_logo',           'seller/catalogo.html',                     SC, 'seller',      'Catálogo',       'Catálogo de productos',                             True),
    ('gesti_n_de_cat_logo_sel_014',                 'seller/catalogo-sel-014.html',             SC, 'seller',      'Catálogo',       'Catálogo SEL-014 — vista ampliada',                 False),
    ('cat_logo_de_productos_desktop',               'seller/catalogo-operador.html',            SC, 'operador',    'Catálogo',       'Catálogo — vista del operador',                     True),
    ('carga_manual_de_producto_desktop',            'seller/carga-manual.html',                 SC, 'operador',    'Catálogo',       'Carga manual de producto',                          True),
    ('carga_masiva_y_errores_desktop',              'seller/carga-masiva.html',                 SC, 'operador',    'Catálogo',       'Carga masiva y reporte de errores',                 True),
    ('seller_center_pedidos_y_ventas',              'seller/pedidos.html',                      SC, 'seller',      'Pedidos',        'Pedidos y ventas',                                  True),
    ('gesti_n_de_pedidos_desktop',                  'seller/pedidos-operador.html',             SC, 'operador',    'Pedidos',        'Pedidos — cola del operador',                       False),
    ('seller_center_preparaci_n_de_pedido',         'seller/preparacion.html',                  SC, 'operador',    'Pedidos',        'Preparación de pedido — TM-2026-00428',             True),
    ('preparaci_n_de_pedido_desktop',               'seller/preparacion-detalle.html',          SC, 'operador',    'Pedidos',        'Preparación — picking y packing',                   False),
    ('preparaci_n_de_pedido_tm_2026_00428',         'seller/preparacion-guia.html',             SC, 'operador',    'Pedidos',        'Preparación — guía y recogida',                     False),
    ('preparaci_n_de_pedido_m_vil',                 'seller/preparacion-movil.html',            SC, 'operador',    'Pedidos',        'Preparación de pedido (móvil)',                     False),
    ('dashboard_operativo_desktop',                 'seller/dashboard-operativo.html',          SC, 'operador',    'Pedidos',        'Panel operativo del seller',                    True),
    ('seller_center_finanzas_y_liquidaciones',      'seller/finanzas.html',                     SC, 'seller',      'Finanzas',       'Finanzas y liquidaciones del seller',               True),

    ('backoffice_dashboard_ejecutivo_desktop',      'backoffice/dashboard-ejecutivo.html',      BO, 'superadmin',  'Gobierno',       'Panel ejecutivo',                               True),
    ('backoffice_gesti_n_de_sellers_kyc_desktop',   'backoffice/sellers-kyc.html',              BO, 'superadmin',  'Gobierno',       'Cola de sellers y KYC',                             True),
    ('backoffice_gesti_n_de_sellers_desktop',       'backoffice/sellers.html',                  BO, 'superadmin',  'Gobierno',       'Gestión de sellers',                                False),
    ('demo_backoffice_kyc_revisado',                'backoffice/sellers-kyc-revisado.html',     BO, 'superadmin',  'Gobierno',       'KYC — revisión de consistencia',                    False),
    ('backoffice_moderaci_n_de_productos_desktop',  'backoffice/moderacion.html',               BO, 'superadmin',  'Gobierno',       'Moderación de productos',                           True),
    ('backoffice_configuraci_n_global_desktop',     'backoffice/configuracion.html',            BO, 'superadmin',  'Gobierno',       'Configuración global y reglas',                     True),
    ('backoffice_integraciones_y_salud_desktop',    'backoffice/integraciones.html',            BO, 'superadmin',  'Gobierno',       'Integraciones y salud del sistema',                 True),
    ('backoffice_anal_tica_avanzada_desktop',       'backoffice/analitica.html',                BO, 'superadmin',  'Gobierno',       'Analítica avanzada',                                True),
    ('backoffice_auditor_a_de_seguridad_desktop',   'backoffice/auditoria.html',                BO, 'superadmin',  'Gobierno',       'Auditoría de seguridad',                            True),
    ('backoffice_seguridad_y_sesi_n_mobile',        'backoffice/seguridad-sesion.html',         BO, 'superadmin',  'Gobierno',       'Seguridad y sesión (móvil)',                        False),

    ('dashboard_operativo_desktop_backoffice',      'backoffice/ops-dashboard.html',            BO, 'ops',         'Operaciones',    'Panel operativo',                               True),
    ('cola_de_pedidos_desktop_backoffice',          'backoffice/ops-cola-pedidos.html',         BO, 'ops',         'Operaciones',    'Cola de pedidos',                                   True),
    ('cola_de_pedidos_m_vil_backoffice',            'backoffice/ops-cola-pedidos-movil.html',   BO, 'ops',         'Operaciones',    'Cola de pedidos (móvil)',                           False),
    ('detalle_de_pedido_desktop_backoffice',        'backoffice/ops-pedido-detalle.html',       BO, 'ops',         'Operaciones',    'Detalle de pedido e incidencias',                   True),
    ('detalle_de_pedido_m_vil_backoffice',          'backoffice/ops-pedido-detalle-movil.html', BO, 'ops',         'Operaciones',    'Detalle de pedido (móvil)',                         False),
    ('expediente_de_disputa_dsp_0098_desktop_backoffice','backoffice/ops-disputa.html',         BO, 'ops',         'Operaciones',    'Expediente de disputa — DSP-0098',                  True),
    ('bandeja_omnicanal_desktop_backoffice',        'backoffice/ops-bandeja.html',              BO, 'ops',         'Operaciones',    'Bandeja omnicanal',                                 True),

    ('finanzas_dashboard_desktop',                  'backoffice/finanzas-dashboard.html',       BO, 'finanzas',    'Finanzas',       'Panel financiero',                              True),
    ('finanzas_conciliaci_n_desktop',               'backoffice/finanzas-conciliacion.html',    BO, 'finanzas',    'Finanzas',       'Conciliación bancaria',                             True),
    ('finanzas_libro_de_custodia_desktop',          'backoffice/finanzas-custodia.html',        BO, 'finanzas',    'Finanzas',       'Libro de custodia y retenciones',                   True),
    ('finanzas_liquidaciones_desktop',              'backoffice/finanzas-liquidaciones.html',   BO, 'finanzas',    'Finanzas',       'Liquidaciones a sellers',                           True),
    ('finanzas_liquidaciones_revisado',             'backoffice/finanzas-liquidaciones-rev.html',BO,'finanzas',    'Finanzas',       'Liquidaciones — revisión de consistencia',          False),
    ('finanzas_monitoreo_m_vil',                    'backoffice/finanzas-monitoreo-movil.html', BO, 'finanzas',    'Finanzas',       'Monitoreo financiero (móvil)',                      False),

    ('controlador_de_prototipo_tumbo_market',       'demo/controlador.html',                    DM, 'demo',        'Recorrido',      'Controlador de prototipo',                          True),
    ('demo_marketplace_home_contexto_transversal',  'demo/marketplace.html',                    DM, 'demo',        'Recorrido',      'Recorrido transversal — vista comprador',           True),
    ('demo_seller_dashboard_contexto_transversal',  'demo/seller.html',                         DM, 'demo',        'Recorrido',      'Recorrido transversal — vista seller',              True),
    ('demo_backoffice_kyc_contexto_transversal',    'demo/backoffice.html',                     DM, 'demo',        'Recorrido',      'Recorrido transversal — vista backoffice',          True),

    ('mapa_de_interfaces_tumbo_market',             'sistema/mapa-interfaces.html',             SY, 'todos',       'Sistema',        'Mapa de interfaces',                                True),
    ('ndice_maestro_beta_tumbo_market',             'sistema/indice-maestro.html',              SY, 'todos',       'Sistema',        'Índice maestro (versión Stitch)',                   True),
    ('403_acceso_denied_desktop',                   'sistema/403.html',                         SY, 'todos',       'Sistema',        'Acceso denegado (403)',                             True),
]

# Pantalla de aterrizaje por rol: a dónde va el selector de rol del dock.
INICIO_POR_ROL = {
    'visitante':  'marketplace/inicio.html',
    'comprador':  'marketplace/mi-cuenta.html',
    'seller':     'seller/dashboard.html',
    'precios':    'seller/catalogo.html',
    'operador':   'seller/dashboard-operativo.html',
    'superadmin': 'backoffice/dashboard-ejecutivo.html',
    'ops':        'backoffice/ops-dashboard.html',
    'finanzas':   'backoffice/finanzas-dashboard.html',
}
