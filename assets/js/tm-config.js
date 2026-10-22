/* =========================================================================
   Tumbo Market — Conexión con el backend
   -------------------------------------------------------------------------
   Con `supabaseUrl` y `supabaseKey` vacíos la app funciona en modo local
   (datos en el navegador). Con ambos, usa el proyecto Supabase.

   La clave publicable está pensada para ir en el navegador: no da acceso a
   nada por sí misma. Lo que cada usuario puede ver o cambiar lo deciden las
   funciones tm_* de supabase/migrations (con la sesión de Tumbo).
   ========================================================================= */
window.TM_CONFIG = {
  supabaseUrl: 'https://vajbsfgojtunamhrzrpf.supabase.co',
  supabaseKey: 'sb_publishable_Xljd7Ep1GxBXSPp5F4A1hg_Qg-iESzl'
};
