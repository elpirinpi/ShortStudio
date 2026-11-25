# KellyClipAi Studio (ShortStudio)

Editor profesional de video vertical **9:16** para YouTube Shorts, TikTok y Reels con IA local (Whisper + detección facial), subtítulos dinámicos tipo karaoke y renderizado exacto a **30 fps constantes (H.264 + AAC)**.

**Desarrollado por:** Kelly Benjamin De La Cruz

---

## 1. Inicio de sesión y sincronización con Supabase

1. Copia `.env.example` a `.env`.
2. Completa la URL de tu proyecto Supabase y tu llave pública (`VITE_SUPABASE_ANON_KEY` o `VITE_SUPABASE_PUBLISHABLE_KEY`):
   ```env
   VITE_SUPABASE_URL="https://TU-PROYECTO.supabase.co"
   VITE_SUPABASE_PUBLISHABLE_KEY="TU_PUBLISHABLE_O_ANON_KEY"
   ```
3. *(Opcional)* Si deseas sincronizar tus proyectos, subtítulos y calendario en la nube entre PCs, ejecuta el contenido de `supabase/schema.sql` en el **SQL Editor** de Supabase.

---

## 2. Subir a GitHub y publicar Release con `.exe` automáticamente

Este proyecto incluye el flujo de **GitHub Actions** (`.github/workflows/build-windows-exe.yml`).

1. Sube o sincroniza este proyecto con tu repositorio de GitHub (`main`).
2. Agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en **GitHub → Settings → Secrets and variables → Actions** para que el `.exe` compilado en la nube incluya la conexión a Supabase.
3. Cada `push` o sincronización a `main` compila y publica automáticamente el **Release** en GitHub con:
   - `KellyClipAi-Studio-Portable-1.0.0.exe` (ejecutable portátil sin instalación)
   - `KellyClipAi-Studio-Setup-1.0.0.exe` (instalador completo para Windows)

---

## 3. Compilar el `.exe` localmente en Windows (1 clic)

Con **Node.js 20+** instalado en tu PC Windows:

1. Haz doble clic en **`COMPILAR-EXE-WINDOWS.bat`**.
2. Al finalizar, encontrarás tus ejecutables `.exe` dentro de la carpeta **`release\`**.

Al abrir el `.exe` en Windows, la aplicación inicia su servidor local automáticamente y descarga `yt-dlp.exe` y `ffmpeg.exe` la primera vez si los necesitas, funcionando 100% en tu PC.
