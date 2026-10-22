/* =========================================================================
   Tumbo Market — Conexión con el backend
   -------------------------------------------------------------------------
   Con `supabaseUrl` y `supabaseKey` vacíos la app funciona en modo local
   (datos en el navegador). Con ambos, usa el proyecto Supabase.

   La clave publicable está pensada para ir en el navegador: no da acceso a
   nada por sí misma. Lo que cada usuario puede ver o cambiar lo deciden las
   políticas RLS y las funciones tm_* de supabase/migrations.
   ========================================================================= */
window.TM_CONFIG = {
  supabaseUrl: '',
  supabaseKey: ''
};
