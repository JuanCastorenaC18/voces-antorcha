# Voces · Antorcha Nacional
Página de registro y evaluación del concurso, preparada para GitHub Pages y Supabase.

## Publicación
GitHub Pages sirve la raíz `/` de `main`. El backend es la Edge Function `voces-api` del proyecto Supabase `rpsqixjnkvvboiqbklnd`.

## Acceso
El administrador activa el concurso con un código privado que no se guarda en este repositorio, y crea cuentas por correo y contraseña. Registro únicamente da de alta y consulta concursantes; jueces guardan sus propias notas; administrador gestiona cuentas y resultados.

Las tablas no permiten acceso directo por API desde el cliente. La función verifica la sesión con Supabase Auth y consulta el rol activo en cada solicitud. Las claves privilegiadas permanecen en el entorno de Supabase. La clave publicable del navegador no concede acceso a las tablas.

## Desarrollo
`npm ci` y `npm run build` regeneran `auth.js`. `npm run check` verifica el JavaScript de la interfaz.

Los cambios se consultan cada 15 segundos. Requiere Internet. Los datos de la versión anterior no se importan automáticamente. No subir contraseñas, códigos de activación ni datos de concursantes al repositorio.
