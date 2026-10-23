-- =========================================================================
-- Tumbo Market — Acceso a las cuentas demo sin coste de bcrypt
-- -------------------------------------------------------------------------
-- La migración 8 puso un tope de 30 comprobaciones de contraseña por red y
-- minuto, contando también los accesos a las cuentas demo. Muchas personas
-- detrás de una misma IP (un aula, una oficina, un CGNAT móvil) que entran
-- a la demo lo alcanzan sin abusar de nada. Pero la contraseña de las
-- cuentas demo es pública (demo1234, la de la semilla): no hay nada que
-- proteger con bcrypt. Ahora:
--   · el acceso a una cuenta demo compara la contraseña pública sin bcrypt
--     y no cuenta para los techos de bcrypt (por red y global);
--   · el tope por red sube a 40 por minuto y cuenta solo comprobaciones
--     reales de bcrypt (cuentas propias y correos que no existen);
--   · los demás frenos (fallos por cuenta y red, aciertos por cuenta y red)
--     siguen igual, también en las cuentas demo.
-- Solo agrega: redefine tm_acceder.
-- =========================================================================

create or replace function public.tm_acceder(p_email text, p_clave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := left(lower(trim(coalesce(p_email, ''))), 120);
  v_ip text := tumbo_privado.ip_cliente();
  v_demo boolean := tumbo_privado.cuenta_demo(v_email);
  u tumbo.usuarios;
  v_ok boolean := false;
  v_token text;
begin
  delete from tumbo.intentos_acceso where fecha < now() - interval '1 day';

  if not v_demo then
    -- Comprobaciones bcrypt por red y minuto: una sola red no agota el
    -- techo global.
    if v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
        where tipo = 'acceso' and ip = v_ip and fecha > now() - interval '1 minute'
          and not tumbo_privado.cuenta_demo(email)) >= 40 then
      return jsonb_build_object('error', 'Demasiados intentos de acceso desde tu conexión. Espera un minuto.');
    end if;
    -- Techo global de comprobaciones bcrypt (aciertos y fallos) por minuto:
    -- acota la CPU que Tumbo puede gastar en la base compartida.
    if (select count(*) from tumbo.intentos_acceso
        where tipo = 'acceso' and fecha > now() - interval '1 minute'
          and not tumbo_privado.cuenta_demo(email)) >= 120 then
      return jsonb_build_object('error', 'El acceso está muy solicitado en este momento. Inténtalo de nuevo en un minuto.');
    end if;
  end if;
  -- Aciertos repetidos de una cuenta desde una red (las cuentas demo son
  -- públicas): frena el abuso sin afectar a quien entra desde otra red.
  if v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
      where tipo = 'acceso' and email = v_email and ip = v_ip and exito and fecha > now() - interval '15 minutes') >= 60 then
    return jsonb_build_object('error', 'Demasiados accesos seguidos a esta cuenta desde tu conexión. Espera unos minutos.');
  end if;
  if (select count(*) from tumbo.intentos_acceso
      where tipo = 'acceso' and email = v_email and ip = v_ip and not exito and fecha > now() - interval '15 minutes') >= 8
     or (v_ip <> 'desconocida' and (select count(*) from tumbo.intentos_acceso
         where tipo = 'acceso' and ip = v_ip and not exito and fecha > now() - interval '15 minutes') >= 40)
     -- techo por cuenta para quien rote redes; no frena al dueño en una red
     -- desde la que entró o se registró esta semana, ni existe en las cuentas
     -- demo (su contraseña es pública: solo serviría para bloquearlas)
     or (not v_demo
         and (select count(*) from tumbo.intentos_acceso
              where tipo = 'acceso' and email = v_email and not exito and fecha > now() - interval '15 minutes') >= 100
         and not exists (select 1 from tumbo.redes_conocidas r
                         where r.email = v_email and r.red = v_ip and r.ultimo > now() - interval '7 days')) then
    return jsonb_build_object('error', 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.');
  end if;

  select * into u from tumbo.usuarios where email = v_email and activo;
  if found and v_demo then
    -- contraseña pública de la semilla: no hace falta bcrypt
    v_ok := coalesce(p_clave, '') = 'demo1234';
  elsif found then
    v_ok := u.clave_hash = extensions.crypt(coalesce(p_clave, ''), u.clave_hash);
  else
    -- mismo coste que una comprobación real: el tiempo no delata si el correo existe
    perform extensions.crypt(coalesce(p_clave, ''), extensions.gen_salt('bf', 10));
  end if;
  insert into tumbo.intentos_acceso (tipo, email, ip, exito) values ('acceso', v_email, v_ip, v_ok);

  if not v_ok then
    return jsonb_build_object('error', 'Correo o contraseña incorrectos. Las cuentas demo usan demo1234.');
  end if;
  perform tumbo_privado.recordar_red(v_email, v_ip);
  v_token := tumbo_privado.abrir_sesion(u.id);
  if not exists (select 1 from tumbo.auditoria a
                 where a.accion = 'Inicio de sesión' and a.actor_id = u.id and a.fecha > now() - interval '10 minutes') then
    perform tumbo_privado.auditar(u, 'Inicio de sesión', u.rol);
  end if;
  return jsonb_build_object('sesion', v_token, 'usuario', tumbo_privado.perfil_json(u));
end $$;

notify pgrst, 'reload schema';
