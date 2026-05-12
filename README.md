# TU ZONA DE DESCARGAS EC 🎵

Aplicación web para buscar y descargar canciones de YouTube en formato MP3 (320kbps) y MP4.

## Stack
- **Backend:** Python + Flask
- **Descarga:** yt-dlp + imageio-ffmpeg
- **Frontend:** HTML + CSS + JavaScript

## Correr localmente

```bash
# Activar entorno virtual (Windows)
.\venv\Scripts\python.exe app.py

# Acceder en el navegador
http://localhost:5000
```

## Deployment en Render.com
1. Sube este repositorio a GitHub.
2. Entra a [render.com](https://render.com), crea una cuenta y haz clic en **New > Web Service**.
3. Conecta tu repositorio de GitHub.
4. Render detectará automáticamente el `render.yaml` y configurará todo.
5. Haz clic en **Deploy**.
