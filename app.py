import os
import tempfile
import zipfile
import shutil
import re
import json
import threading
import time
from io import BytesIO
from datetime import datetime
from flask import Flask, request, jsonify, send_file, render_template, Response
# Importaciones básicas
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer
import secrets
import base64

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'tuzona-secret-key-2025')

# En Vercel solo podemos escribir en /tmp
if os.environ.get('VERCEL'):
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:////tmp/users.db'
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///users.db')

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Brevo API (HTTPS - sin bloqueo de puertos)
BREVO_API_KEY = os.environ.get('BREVO_API_KEY', '')
BREVO_SENDER  = {'name': 'TuZona EC', 'email': os.environ.get('BREVO_SENDER_EMAIL', 'gabrielmero230195@gmail.com')}

db = SQLAlchemy(app)
serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

CORS = None # Definido como None por defecto para evitar errores en Vercel
if CORS:
    CORS(app, expose_headers=['Content-Disposition'])

# Modelos
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(120), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    is_verified = db.Column(db.Boolean, default=False)
    verification_token = db.Column(db.String(100), unique=True)
    reset_token = db.Column(db.String(100), unique=True)
    must_change_password = db.Column(db.Boolean, default=False)
    last_reset_request = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Estadísticas
    songs_played = db.Column(db.Integer, default=0)
    songs_downloaded = db.Column(db.Integer, default=0)
    
    # Relaciones
    favorites = db.relationship('Favorite', backref='user', lazy=True)
    history = db.relationship('History', backref='user', lazy=True)
    feedbacks = db.relationship('Feedback', backref='user', lazy=True)
    playlists = db.relationship('Playlist', backref='user', lazy=True)

class Feedback(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    rating = db.Column(db.Integer, nullable=False) # 1 a 5
    comment = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Favorite(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    video_id = db.Column(db.String(20), nullable=False)
    title = db.Column(db.String(200))
    thumbnail = db.Column(db.String(200))
    channel = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class History(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    video_id = db.Column(db.String(20), nullable=False)
    title = db.Column(db.String(200))
    thumbnail = db.Column(db.String(200))
    channel = db.Column(db.String(100))
    played_at = db.Column(db.DateTime, default=datetime.utcnow)

class Playlist(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    songs = db.relationship('PlaylistSong', backref='playlist', lazy=True, cascade='all, delete-orphan')

# --- NUEVO MOTOR DE STREAMING PARA MÓVIL (PARALELO) ---
@app.route('/api/stream_url/<video_id>')
def get_stream_url(video_id):
    import requests
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    nodes = [
        f"https://inv.tux.pizza/api/v1/videos/{video_id}",
        f"https://pipedapi.kavin.rocks/streams/{video_id}",
        f"https://vid.puffyan.us/api/v1/videos/{video_id}",
        f"https://invidious.sethforprivacy.com/api/v1/videos/{video_id}"
    ]
    
    def fetch_url(url):
        try:
            resp = requests.get(url, timeout=2.5)
            if resp.status_code == 200:
                data = resp.json()
                if 'adaptiveFormats' in data:
                    audio = next((f for f in data['adaptiveFormats'] if 'audio' in f.get('type', '')), None)
                    if audio: return audio['url']
                if 'audioStreams' in data:
                    streams = sorted(data['audioStreams'], key=lambda x: x.get('bitrate', 0), reverse=True)
                    if streams: return streams[0]['url']
        except: pass
        return None

    with ThreadPoolExecutor(max_workers=len(nodes)) as executor:
        futures = [executor.submit(fetch_url, url) for url in nodes]
        for future in as_completed(futures):
            result = future.result()
            if result: return jsonify({'url': result})
            
    return jsonify({'error': 'No stream found'}), 404

class PlaylistSong(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    playlist_id = db.Column(db.Integer, db.ForeignKey('playlist.id'), nullable=False)
    video_id = db.Column(db.String(20), nullable=False)
    title = db.Column(db.String(200))
    thumbnail = db.Column(db.String(200))
    channel = db.Column(db.String(100))
    added_at = db.Column(db.DateTime, default=datetime.utcnow)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# Crear base de datos
with app.app_context():
    db.create_all()
    # Crear admin por defecto si no existe
    if not User.query.filter_by(username='admin').first():
        admin = User(
            username='admin',
            email='gabrieltheboyfaithful@gmail.com',
            password_hash=generate_password_hash('admin123'),
            is_admin=True,
            is_verified=True
        )
        db.session.add(admin)
        db.session.commit()

DOWNLOAD_PROGRESS = {}
SEARCH_CACHE = {}
STREAM_CACHE = {}  # {video_id: {'url': url, 'timestamp': time}}
CAPTCHA_STORE = {}  # {uuid: {'code': code, 'time': timestamp}}

# Precargar caché de tendencias
try:
    cache_file = os.path.join(os.path.dirname(__file__), 'trending_cache.json')
    if os.path.exists(cache_file):
        with open(cache_file, 'r', encoding='utf-8') as f:
            trending_data = json.load(f)
            SEARCH_CACHE["musica nueva 2025 hits_24"] = trending_data
except Exception as e:
    print(f"Error cargando caché de tendencias: {e}")

# Obtener ruta a ffmpeg desde imageio_ffmpeg
# FFMPEG ya no es necesario con el sistema de redirección
FFMPEG_PATH = None


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/search', methods=['GET'])
def api_search():
    query = request.args.get('q', '')
    try:
        max_results = int(request.args.get('limit', 40))
    except ValueError:
        max_results = 40

    if not query:
        return jsonify({'error': 'No query provided'}), 400

    cache_key = f"{query}_{max_results}"
    if cache_key in SEARCH_CACHE:
        return jsonify(SEARCH_CACHE[cache_key])

    print(f"Buscando con YTMusic: {query}")
    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()
        results = yt.search(query, filter="songs", limit=max_results)
        
        songs = []
        for v in results:
            vid_id = v.get('videoId')
            if not vid_id: continue
            
            title = v.get('title', 'Sin título')
            duration = v.get('duration', '3:45')
            
            artists_list = v.get('artists', [])
            channel = ", ".join([a.get('name', '') for a in artists_list]) if artists_list else "Unknown"
            
            thumbnails = v.get('thumbnails', [])
            thumb = thumbnails[-1].get('url', '') if thumbnails else ""
            
            songs.append({
                'id': vid_id,
                'title': title,
                'duration': duration,
                'thumbnail': thumb,
                'channel': channel
            })

        print(f"Total canciones encontradas: {len(songs)}")
        response_data = {'songs': songs}
        SEARCH_CACHE[cache_key] = response_data
        return jsonify(response_data)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'songs': []}), 200
        return jsonify({'error': str(e)}), 500

@app.route('/api/search_artists', methods=['GET'])
def search_artists():
    query = request.args.get('q', '')
    if not query:
        return jsonify({'error': 'No query provided'}), 400
    
    try:
        from ytmusicapi import YTMusic
        ytmusic = YTMusic()
        search_results = ytmusic.search(query, filter='artists', limit=1)
        
        if not search_results:
            return jsonify({'results': []})
            
        top_artist = search_results[0]
        browse_id = top_artist.get('browseId')
        
        if not browse_id:
            return jsonify({'results': []})
            
        details = ytmusic.get_artist(browse_id)
        
        thumbnails = details.get('thumbnails', [])
        thumbnail_url = thumbnails[-1].get('url') if thumbnails else ''
        
        artist_info = {
            'id': browse_id,
            'title': details.get('name', top_artist.get('artist')),
            'thumbnail': thumbnail_url,
            'banner': thumbnail_url, # YTMusicAPI sometimes lacks banners, fallback to thumb
            'subscribers': details.get('subscribers', ''),
            'description': details.get('description', 'No hay biografía disponible.'),
            'views': details.get('views', ''),
            'link': f"https://music.youtube.com/channel/{browse_id}"
        }
        
        return jsonify({'results': [artist_info]})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/search_albums', methods=['GET'])
def search_albums():
    query = request.args.get('q', '')
    if not query:
        return jsonify({'error': 'No query provided'}), 400
    
    try:
        from ytmusicapi import YTMusic
        ytmusic = YTMusic()
        # Buscamos álbumes oficiales
        results = ytmusic.search(query, filter='albums', limit=20)
        
        albums = []
        for p in results:
            playlist_id = p.get('playlistId') # Esencial para yt_dlp
            if not playlist_id:
                continue
                
            artists_list = p.get('artists', [])
            channel_str = ", ".join([a.get('name', '') for a in artists_list]) if artists_list else "Unknown"
            
            thumbnails = p.get('thumbnails', [])
            thumbnail_url = thumbnails[-1].get('url') if thumbnails else ''
            
            albums.append({
                'id': playlist_id, # Usamos playlistId en lugar de browseId para que pueda ser descargado
                'type': 'playlist',
                'title': p.get('title'),
                'thumbnail': thumbnail_url,
                'videoCount': '10+', # YTMusic no siempre devuelve el track count en el search inicial
                'channel': channel_str,
                'link': f"https://music.youtube.com/playlist?list={playlist_id}"
            })
        return jsonify({'results': albums})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500



@app.route('/api/stream', methods=['GET'])
def stream_audio():
    video_id = request.args.get('id')
    if not video_id:
        return jsonify({'error': 'No id provided'}), 400
    
    # Rastrear reproducción si el usuario está autenticado
    if current_user.is_authenticated:
        current_user.songs_played += 1
        try:
            db.session.commit()
        except:
            db.session.rollback()

    # Check cache
    now = datetime.now().timestamp()
    if video_id in STREAM_CACHE:
        cache_data = STREAM_CACHE[video_id]
        if now - cache_data['timestamp'] < 3600: # 1 hour cache
            url = cache_data['url']
        else:
            url = None
    else:
        url = None

    # Limpiar caché si es vieja
    now = time.time()
    if video_id in STREAM_CACHE:
        cache_data = STREAM_CACHE[video_id]
        if now - cache_data['timestamp'] < 3600:
            return redirect(cache_data['url'])

    import requests
    
    # Orden de intentos internos (Súper Motor Europeo)
    def try_extract():
        # Lista de nodos ultra-estables (Finlandia, Alemania, etc.)
        nodes = [
            f"https://api-piped.mha.fi/streams/{video_id}",
            f"https://pipedapi.lunar.icu/streams/{video_id}",
            f"https://pipedapi.astre.me/streams/{video_id}",
            f"https://yt.artemislena.eu/api/v1/videos/{video_id}"
        ]
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }

        for node in nodes:
            try:
                print(f"Intentando nodo: {node}")
                resp = requests.get(node, headers=headers, timeout=4)
                if resp.status_code == 200:
                    d = resp.json()
                    # Caso Piped
                    if 'audioStreams' in d and len(d['audioStreams']) > 0:
                        # Ordenar por calidad y tomar la mejor
                        streams = sorted(d['audioStreams'], key=lambda x: x.get('bitrate', 0), reverse=True)
                        return streams[0]['url']
                    # Caso Invidious (Artemis)
                    if 'adaptiveFormats' in d:
                        audio = [f for f in d['adaptiveFormats'] if 'audio' in f.get('type', '')]
                        if audio: return audio[0]['url']
            except Exception as e:
                print(f"Fallo en nodo {node}: {e}")
                continue
        return None

    final_url = try_extract()
    
    if final_url:
        STREAM_CACHE[video_id] = {'url': final_url, 'timestamp': now}
        return redirect(final_url)
    
    return jsonify({'error': 'No disponible'}), 404

@app.route('/api/progress', methods=['GET'])
def get_progress():
    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify({'error': 'No session_id'}), 400
    # Provide safe default if session not strictly started yet
    data = DOWNLOAD_PROGRESS.get(session_id, {'status': 'starting', 'percent': '0.0%', 'current': 0, 'total': 0})
    return jsonify(data)

@app.route('/api/download', methods=['POST'])
def download_videos():
    if not current_user.is_authenticated:
        return jsonify({'error': 'Inicia sesión para descargar.'}), 401
    
    data = request.json
    video_ids = data.get('ids', [])
    if not video_ids:
        return jsonify({'error': 'No hay videos seleccionados'}), 400

    import requests
    video_id = video_ids[0] # Por ahora descargamos de 1 en 1 para evitar timeouts

    # API de Cobalt (Experta en descargas)
    url_api = "https://api.cobalt.tools/api/json"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json"
    }
    payload = {
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "downloadMode": "audio",
        "audioFormat": "mp3",
        "audioBitrate": "320"
    }

    try:
        # Intentar con Cobalt (Instancia 1)
        resp = requests.post("https://api.cobalt.tools/api/json", json=payload, headers=headers, timeout=8)
        result = resp.json()
        
        if result.get('status') in ['stream', 'redirect']:
            download_url = result.get('url')
            current_user.songs_downloaded += 1
            db.session.commit()
            return jsonify({'url': download_url})
        
        # Si falla, intentar con una instancia alternativa
        resp = requests.post("https://cobalt-api.v06.me/api/json", json=payload, headers=headers, timeout=8)
        result = resp.json()
        if result.get('status') in ['stream', 'redirect']:
            return jsonify({'url': result.get('url')})

        return jsonify({'error': f"Servidor ocupado: {result.get('text', 'Intenta de nuevo')}"}), 503
            
    except Exception as e:
        print(f"Error descarga: {e}")
        return jsonify({'error': "Error de conexión con el motor de descarga."}), 500

@app.route('/api/trending', methods=['GET'])
def get_trending():
    """Devuelve canciones trending del día usando YTMusic."""
    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()
        # Intentar obtener charts (tendencias reales)
        try:
            charts = yt.get_charts(country='EC') # Ecuador
            songs_data = charts.get('songs', {}).get('items', [])
        except:
            # Fallback a búsqueda de éxitos si falla get_charts
            songs_data = yt.search('musica tendencia ecuador 2025', filter='songs', limit=20)

        trending = []
        for s in songs_data[:20]:
            vid_id = s.get('videoId')
            if not vid_id: continue
            
            title = s.get('title', 'Sin título')
            artists = s.get('artists', [])
            channel = ", ".join([a.get('name', '') for a in artists]) if artists else "TuZona EC"
            
            thumbnails = s.get('thumbnails', [])
            thumb = thumbnails[-1].get('url', '') if thumbnails else ""
            
            trending.append({
                'id': vid_id,
                'title': title,
                'channel': channel,
                'thumbnail': thumb
            })

        return jsonify({'trending': trending})
    except Exception as e:
        import traceback
        traceback.print_exc()

        return jsonify({'error': str(e), 'trending': []}), 200

# Rutas de Autenticación
def send_verification_email(username, email, token):
    try:
        html_body = f"""
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;
                    background:#0d0d1a;color:#fff;padding:40px;border-radius:12px;">
            <h1 style="color:#a855f7;text-align:center;margin-bottom:4px;">🎵 TuZona EC</h1>
            <p style="text-align:center;color:#888;margin-top:0;">Música Sin Límites</p>
            <hr style="border-color:#2d2d4a;margin:24px 0;">
            <h2 style="text-align:center;">Tu Código de Verificación</h2>
            <p>Hola <strong>{username}</strong>, gracias por registrarte en TuZona EC.</p>
            <p>Ingresa el siguiente código de 6 dígitos en la página para activar tu cuenta:</p>
            <div style="text-align:center;margin:32px 0;">
                <span style="background:#2d2d4a;color:#fff;padding:16px 36px;border-radius:8px;
                             font-weight:bold;font-size:32px;letter-spacing:4px;display:inline-block;">
                    {token}
                </span>
            </div>
            <hr style="border-color:#2d2d4a;margin:24px 0;">
            <p style="color:#555;font-size:11px;text-align:center;">
                Si no creaste esta cuenta, ignora este correo.
            </p>
        </div>
        """

        import urllib.request, json as _json
        payload = _json.dumps({
            "sender": BREVO_SENDER,
            "to": [{"email": email, "name": username}],
            "subject": f"Tu código de verificación: {token} - TuZona EC",
            "htmlContent": html_body
        }).encode('utf-8')

        req = urllib.request.Request(
            'https://api.brevo.com/v3/smtp/email',
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'api-key': BREVO_API_KEY
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=20) as res:
            body = _json.loads(res.read())
            print(f"Correo enviado via Brevo API a {email}. ID: {body.get('messageId','OK')}")
    except Exception as e:
        print(f"Error enviando correo via Brevo: {e}")

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')
    
    if not username or not password or not email:
        return jsonify({'error': 'Todos los campos son obligatorios'}), 400
    
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'El usuario ya existe'}), 400
    
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'El correo ya está registrado'}), 400
    
    import random
    token = str(random.randint(100000, 999999))
    # MODO EMERGENCIA: Usuario verificado automáticamente
    new_user = User(
        username=username,
        email=email,
        password_hash=generate_password_hash(password),
        verification_token=token,
        is_verified=False # Volvemos al flujo de verificación por correo
    )
    db.session.add(new_user)
    db.session.commit()
    
    # Enviar correo de verificación en segundo plano
    try:
        threading.Thread(target=send_verification_email, args=(username, email, token)).start()
        # [MODO DESARROLLO] Imprimir el código en la consola para facilitar las pruebas
        print("\n" + "="*50)
        print(f" 🔑 CÓDIGO DE VERIFICACIÓN PARA {email}: {token} ")
        print("="*50 + "\n")
    except Exception as e:
        print(f"Error al iniciar hilo de correo: {e}")

    return jsonify({'message': 'Registro inicial exitoso. Ingrese su código.', 'email': email}), 201

@app.route('/api/verify_code', methods=['POST'])
def verify_code():
    data = request.json
    email = data.get('email')
    code = data.get('code')
    
    if not email or not code:
        return jsonify({'error': 'Email y código son requeridos'}), 400
        
    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404
        
    if user.is_verified:
        return jsonify({'error': 'El usuario ya está verificado'}), 400
        
    if user.verification_token != code:
        return jsonify({'error': 'Código incorrecto. Por favor verifique de nuevo.'}), 400
        
    user.is_verified = True
    db.session.commit()
    
    return jsonify({'message': '¡Verificación exitosa! Bienvenido, ya puedes escuchar y descargar tu música favorita.'}), 200
# API Admin
@app.route('/api/admin/users', methods=['GET'])
@login_required
def get_admin_users():
    if not current_user.is_admin:
        return jsonify({'error': 'No autorizado'}), 403
    users = User.query.all()
    user_list = [{
        'id': u.id,
        'username': u.username,
        'email': u.email,
        'is_admin': u.is_admin,
        'is_verified': getattr(u, 'is_verified', False),
        'songs_played': getattr(u, 'songs_played', 0),
        'songs_downloaded': getattr(u, 'songs_downloaded', 0),
        'created_at': u.created_at.strftime('%Y-%m-%d %H:%M') if u.created_at else ''
    } for u in users]
    return jsonify(user_list)

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@login_required
def delete_admin_user(user_id):
    if not current_user.is_admin:
        return jsonify({'error': 'No autorizado'}), 403
    if user_id == current_user.id:
        return jsonify({'error': 'No puedes eliminarte a ti mismo'}), 400
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404
    db.session.delete(user)
    db.session.commit()
    return jsonify({'message': 'Usuario eliminado exitosamente'})



# API de Favoritos e Historial (Sincronizado)
@app.route('/api/user/favorites', methods=['GET'])
@login_required
def get_user_favorites():
    favs = Favorite.query.filter_by(user_id=current_user.id).order_by(Favorite.created_at.desc()).all()
    return jsonify([{
        'id': f.video_id,
        'title': f.title,
        'thumbnail': f.thumbnail,
        'channel': f.channel
    } for f in favs])

@app.route('/api/user/favorites/toggle', methods=['POST'])
@login_required
def toggle_user_favorite():
    data = request.json
    video_id = data.get('id')
    
    existing = Favorite.query.filter_by(user_id=current_user.id, video_id=video_id).first()
    if existing:
        db.session.delete(existing)
        db.session.commit()
        return jsonify({'status': 'removed'})
    else:
        new_fav = Favorite(
            user_id=current_user.id,
            video_id=video_id,
            title=data.get('title'),
            thumbnail=data.get('thumbnail'),
            channel=data.get('channel')
        )
        db.session.add(new_fav)
        db.session.commit()
        return jsonify({'status': 'added'})

@app.route('/api/user/history', methods=['GET'])
@login_required
def get_user_history():
    hist = History.query.filter_by(user_id=current_user.id).order_by(History.played_at.desc()).limit(20).all()
    return jsonify([{
        'id': h.video_id,
        'title': h.title,
        'thumbnail': h.thumbnail,
        'channel': h.channel
    } for h in hist])

@app.route('/api/user/history/add', methods=['POST'])
@login_required
def add_user_history():
    data = request.json
    video_id = data.get('id')
    
    # Limitar historial: borrar si ya existe para moverlo al principio
    existing = History.query.filter_by(user_id=current_user.id, video_id=video_id).first()
    if existing:
        db.session.delete(existing)
    
    new_hist = History(
        user_id=current_user.id,
        video_id=video_id,
        title=data.get('title'),
        thumbnail=data.get('thumbnail'),
        channel=data.get('channel')
    )
    db.session.add(new_hist)
    db.session.commit()
    return jsonify({'status': 'success'})

@app.route('/api/user/history/clear', methods=['POST'])
@login_required
def clear_user_history():
    History.query.filter_by(user_id=current_user.id).delete()
    db.session.commit()
    return jsonify({'status': 'success'})

@app.route('/api/popular_artists', methods=['GET'])
def get_popular_artists():
    from datetime import datetime, timedelta
    from sqlalchemy import func
    
    # Buscamos en los últimos 7 días
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    
    # Contamos la frecuencia de cada canal (artista)
    top_artists_query = db.session.query(
        History.channel, func.count(History.id).label('count')
    ).filter(
        History.played_at >= seven_days_ago,
        History.channel != None,
        History.channel != ''
    ).group_by(History.channel).order_by(func.count(History.id).desc()).limit(6).all()
    
    popular_artists = [artist[0] for artist in top_artists_query]
    
    # Sistema de respaldo (fallback) si no hay suficiente historial en los últimos 7 días
    fallback_artists = ["Bad Bunny", "Karol G", "Peso Pluma", "Feid", "Aventura", "Myke Towers"]
    
    # Completamos la lista si faltan artistas para llegar a 6
    if len(popular_artists) < 6:
        for artist in fallback_artists:
            if artist not in popular_artists:
                popular_artists.append(artist)
            if len(popular_artists) >= 6:
                break
                
    return jsonify(popular_artists)

@app.route('/api/verify/<token>')
def verify_email(token):
    try:
        email = serializer.loads(token, salt='email-confirm', max_age=3600)
    except:
        return "<h1>Enlace inválido o expirado</h1>", 400
    
    user = User.query.filter_by(email=email).first()
    if not user:
        return "<h1>Usuario no encontrado</h1>", 404
    
    user.is_verified = True
    user.verification_token = None
    db.session.commit()
    
    return "<h1>¡Cuenta verificada con éxito! Ya puedes iniciar sesión en TuZona EC.</h1><script>setTimeout(()=>window.location='/', 3000)</script>"

@app.route('/api/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        return jsonify({'message': 'Por favor inicia sesión vía POST'}), 200
    
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Datos JSON requeridos'}), 400
        
    username = data.get('username')
    password = data.get('password')
    
    user = User.query.filter_by(username=username).first()
    
    if not user:
        print(f"DEBUG: Login fallido - Usuario {username} no encontrado")
        return jsonify({'error': 'El usuario no existe'}), 401
        
    if not check_password_hash(user.password_hash, password):
        print(f"DEBUG: Login fallido - Contraseña incorrecta para {username}")
        return jsonify({'error': 'Contraseña incorrecta'}), 401
        
    if not user.is_verified:
        print(f"DEBUG: Login fallido - {username} no verificado")
        return jsonify({'error': 'Por favor, verifica tu correo electrónico antes de entrar.'}), 401

    login_user(user, remember=True)
    return jsonify({
        'message': 'Inicio de sesión exitoso',
        'user': {
            'username': user.username,
            'is_admin': user.is_admin
        }
    })

@app.route('/api/captcha', methods=['GET'])
def get_captcha():
    import string, random, uuid
    code = ''.join(random.choices(string.digits, k=4))
    captcha_id = str(uuid.uuid4())
    
    # Limpiar captchas viejos (más de 10 minutos)
    now = time.time()
    for cid in list(CAPTCHA_STORE.keys()):
        if now - CAPTCHA_STORE[cid]['time'] > 600:
            del CAPTCHA_STORE[cid]
            
    CAPTCHA_STORE[captcha_id] = {'code': code, 'time': now}
    
    image = ImageCaptcha(width=280, height=90)
    data = image.generate(code)
    base64_img = base64.b64encode(data.getvalue()).decode('utf-8')
    
    return jsonify({
        'captcha_id': captcha_id,
        'image': f'data:image/png;base64,{base64_img}'
    })

@app.route('/api/forgot_password', methods=['POST'])
def forgot_password():
    from datetime import datetime, timedelta
    data = request.json
    email = data.get('email')
    captcha_id = data.get('captcha_id')
    captcha_code = data.get('captcha_code')
    
    # Validar captcha
    if not captcha_id or not captcha_code:
        return jsonify({'error': 'Debes resolver el captcha de seguridad.'}), 400
        
    stored_captcha = CAPTCHA_STORE.get(captcha_id)
    if not stored_captcha or stored_captcha['code'] != captcha_code:
        return jsonify({'error': 'El código del captcha es incorrecto o ha expirado.'}), 400
    
    # Si el captcha es correcto, lo eliminamos para que no se use de nuevo
    del CAPTCHA_STORE[captcha_id]

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'error': 'No existe un usuario con ese correo'}), 404
        
    # Rate Limiting: 1 envío cada 5 minutos
    if user.last_reset_request and datetime.utcnow() < user.last_reset_request + timedelta(minutes=5):
        return jsonify({'error': 'Solo puedes solicitar una contraseña temporal cada 5 minutos. Por favor, revisa tu bandeja de entrada o intenta más tarde.'}), 429
    
    import random, string
    token = serializer.dumps(email, salt='password-reset')
    user.reset_token = token
    user.last_reset_request = datetime.utcnow()
    db.session.commit()
    
    try:
        reset_url = f"{request.host_url}?reset_token={token}"
        # Enviar correo usando Brevo
        html_body = f"""
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0d0d1a;color:#fff;padding:40px;border-radius:12px;">
            <h1 style="color:#a855f7;text-align:center;">TuZona EC</h1>
            <h2 style="text-align:center;">Recuperación de Contraseña</h2>
            <p>Hola <strong>{user.username}</strong>,</p>
            <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
            <p>Haz clic en el siguiente enlace seguro para crear una nueva contraseña:</p>
            <div style="text-align:center;margin:32px 0;">
                <a href="{reset_url}" style="background:#a855f7;color:#fff;padding:16px 36px;border-radius:8px;font-weight:bold;text-decoration:none;display:inline-block;">
                    Restablecer Contraseña
                </a>
            </div>
            <p style="color:#888;font-size:12px;">Si no solicitaste este cambio, simplemente ignora este correo. El enlace caducará en 1 hora.</p>
        </div>
        """
        import urllib.request, json as _json
        payload = _json.dumps({
            "sender": BREVO_SENDER,
            "to": [{"email": email, "name": user.username}],
            "subject": "Restablecer tu contraseña - TuZona EC",
            "htmlContent": html_body
        }).encode('utf-8')

        req = urllib.request.Request(
            'https://api.brevo.com/v3/smtp/email',
            data=payload,
            headers={'Content-Type': 'application/json', 'api-key': BREVO_API_KEY},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=20) as res:
            pass
        
        # [MODO DESARROLLO]
        print(f"\n[RESET LINK] ENLACE DE RECUPERACION PARA {email}: {reset_url}\n")
        
        return jsonify({'message': 'Revisa tu bandeja de correo donde ha sido enviado el enlace seguro.'})
    except Exception as e:
        print(f"Error enviando correo de recuperación: {e}")
        return jsonify({'error': 'Error enviando el correo.'}), 500

@app.route('/api/reset_password', methods=['POST'])
def reset_password():
    data = request.json
    token = data.get('token')
    new_password = data.get('new_password')
    
    try:
        # El token expira en 3600 segundos (1 hora)
        email = serializer.loads(token, salt='password-reset', max_age=3600)
    except:
        return jsonify({'error': 'El enlace es inválido o ha expirado.'}), 400
    
    user = User.query.filter_by(email=email, reset_token=token).first()
    if not user:
        return jsonify({'error': 'El enlace ya fue utilizado o es inválido.'}), 404
        
    user.password_hash = generate_password_hash(new_password)
    user.reset_token = None
    db.session.commit()
    
    # Iniciar sesión automáticamente
    login_user(user, remember=True)
    return jsonify({
        'message': 'Contraseña actualizada. Sesión iniciada con éxito.',
        'user': {
            'username': user.username,
            'is_admin': user.is_admin
        }
    })

@app.route('/api/logout')
@login_required
def logout():
    logout_user()
    return jsonify({'message': 'Sesión cerrada'})

@app.route('/api/user_status')
def user_status():
    if current_user.is_authenticated:
        return jsonify({
            'logged_in': True,
            'user': {
                'username': current_user.username,
                'is_admin': current_user.is_admin
            }
        })
    return jsonify({'logged_in': False})




@app.route('/api/feedback', methods=['POST'])
@login_required
def submit_feedback():
    data = request.json
    rating = data.get('rating')
    comment = data.get('comment', '')
    
    if not rating or not isinstance(rating, int) or rating < 1 or rating > 5:
        return jsonify({'error': 'Calificación inválida'}), 400
        
    feedback = Feedback(
        user_id=current_user.id,
        rating=rating,
        comment=comment
    )
    db.session.add(feedback)
    db.session.commit()
    
    return jsonify({'message': '¡Gracias por tus comentarios!'})

@app.route('/api/admin/feedback', methods=['GET'])
@login_required
def get_admin_feedback():
    if not current_user.is_admin:
        return jsonify({'error': 'No autorizado'}), 403
        
    feedbacks = Feedback.query.order_by(Feedback.created_at.desc()).all()
    feedback_list = [{
        'id': f.id,
        'user_name': f.user.username if f.user else 'Desconocido',
        'rating': f.rating,
        'comment': f.comment,
        'created_at': f.created_at.strftime('%Y-%m-%d %H:%M')
    } for f in feedbacks]
    
    return jsonify(feedback_list)

# ── PLAYLISTS ──────────────────────────────────────────────

@app.route('/api/user/playlists', methods=['GET'])
@login_required
def get_user_playlists():
    playlists = Playlist.query.filter_by(user_id=current_user.id).order_by(Playlist.created_at.desc()).all()
    return jsonify([{
        'id': p.id,
        'name': p.name,
        'song_count': len(p.songs),
        'cover': p.songs[0].thumbnail if p.songs else None,
        'created_at': p.created_at.strftime('%Y-%m-%d')
    } for p in playlists])

@app.route('/api/user/playlists', methods=['POST'])
@login_required
def create_playlist():
    data = request.json
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'El nombre de la lista es obligatorio'}), 400
    if len(name) > 50:
        return jsonify({'error': 'El nombre no puede tener mas de 50 caracteres'}), 400
    # Limite de 20 listas por usuario
    count = Playlist.query.filter_by(user_id=current_user.id).count()
    if count >= 20:
        return jsonify({'error': 'Has alcanzado el limite de 20 listas'}), 400
    playlist = Playlist(user_id=current_user.id, name=name)
    db.session.add(playlist)
    db.session.commit()
    return jsonify({'message': f'Lista "{name}" creada', 'id': playlist.id, 'name': playlist.name})

@app.route('/api/user/playlists/<int:playlist_id>', methods=['DELETE'])
@login_required
def delete_playlist(playlist_id):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return jsonify({'error': 'Lista no encontrada'}), 404
    db.session.delete(playlist)
    db.session.commit()
    return jsonify({'message': 'Lista eliminada'})

@app.route('/api/user/playlists/<int:playlist_id>/songs', methods=['GET'])
@login_required
def get_playlist_songs(playlist_id):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return jsonify({'error': 'Lista no encontrada'}), 404
    songs = PlaylistSong.query.filter_by(playlist_id=playlist_id).order_by(PlaylistSong.added_at.desc()).all()
    return jsonify({
        'name': playlist.name,
        'songs': [{
            'id': s.video_id,
            'title': s.title,
            'channel': s.channel,
            'thumbnail': s.thumbnail
        } for s in songs]
    })

@app.route('/api/user/playlists/<int:playlist_id>/songs', methods=['POST'])
@login_required
def add_song_to_playlist(playlist_id):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return jsonify({'error': 'Lista no encontrada'}), 404
    data = request.json
    video_id = data.get('id')
    if not video_id:
        return jsonify({'error': 'ID de video requerido'}), 400
    # Verificar si ya existe
    existing = PlaylistSong.query.filter_by(playlist_id=playlist_id, video_id=video_id).first()
    if existing:
        return jsonify({'error': 'Esta cancion ya esta en la lista'}), 409
    song = PlaylistSong(
        playlist_id=playlist_id,
        video_id=video_id,
        title=data.get('title', ''),
        channel=data.get('channel', ''),
        thumbnail=data.get('thumbnail', '')
    )
    db.session.add(song)
    db.session.commit()
    return jsonify({'message': f'Cancion agregada a "{playlist.name}"'})

@app.route('/api/user/playlists/<int:playlist_id>/songs/<string:video_id>', methods=['DELETE'])
@login_required
def remove_song_from_playlist(playlist_id, video_id):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return jsonify({'error': 'Lista no encontrada'}), 404
    song = PlaylistSong.query.filter_by(playlist_id=playlist_id, video_id=video_id).first()
    if not song:
        return jsonify({'error': 'Cancion no encontrada en la lista'}), 404
    db.session.delete(song)
    db.session.commit()
    return jsonify({'message': 'Cancion eliminada de la lista'})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
