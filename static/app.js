/* ── GLOBAL AUTH & MODAL FUNCTIONS ── */
window.showNotification = (msg, isError = false) => {
    const notification = document.getElementById('notification');
    if (!notification) { console.log(msg); return; }
    notification.textContent = msg;
    notification.style.borderColor = isError ? 'var(--ecr)' : 'var(--a1)';
    notification.classList.add('show');
    setTimeout(() => notification.classList.remove('show'), 5000);
};

window.openAuthModal = () => { document.getElementById('auth-modal').classList.add('active'); };
window.closeAuthModal = () => { document.getElementById('auth-modal').classList.remove('active'); };
window.openAdminModal = async () => { 
    document.getElementById('admin-modal').classList.add('active'); 
    if (window.fetchAdminUsers) await window.fetchAdminUsers();
};
window.closeAdminModal = () => { document.getElementById('admin-modal').classList.remove('active'); };

window.openForgotModal = () => { 
    window.closeAuthModal(); 
    document.getElementById('forgot-modal').classList.add('active'); 
    if (window.loadCaptcha) window.loadCaptcha();
};
window.closeForgotModal = () => { document.getElementById('forgot-modal').classList.remove('active'); };
window.openResetModal = () => { document.getElementById('reset-modal').classList.add('active'); };
window.closeResetModal = () => { document.getElementById('reset-modal').classList.remove('active'); };

window.openVerificationModal = () => { window.closeAuthModal(); document.getElementById('verification-modal').classList.add('active'); };
window.closeVerificationModal = () => { document.getElementById('verification-modal').classList.remove('active'); };

window.loadCaptcha = async () => {
    try {
        const res = await fetch('/api/captcha', { cache: 'no-store' });
        const data = await res.json();
        document.getElementById('captcha-img').src = data.image;
        document.getElementById('captcha-id').value = data.captcha_id;
        document.getElementById('captcha-code').value = '';
    } catch (e) {
        console.error("Error loading captcha:", e);
    }
};

window.showSuccessPopup = function(title, message, icon) {
    const modal = document.getElementById('success-modal');
    const titleEl = document.getElementById('success-title');
    const msgEl = document.getElementById('success-message');
    const iconEl = document.getElementById('success-icon');
    if (modal && titleEl && msgEl) {
        titleEl.textContent = title;
        msgEl.textContent = message;
        if (iconEl && icon) iconEl.textContent = icon;
        modal.classList.add('active');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    /* ── DOM REFS ── */
    const searchForm       = document.getElementById('search-form');
    const searchInput      = document.getElementById('search-input');
    const resultsContainer = document.getElementById('results-container');
    const loader           = document.getElementById('loader');
    const controlsPanel    = document.getElementById('controls-panel');
    const topDownloadBtn   = document.getElementById('top-download-btn');
    const queueDownloadBtn = document.getElementById('queue-download-btn');
    const notification     = document.getElementById('notification');
    const searchResultsSec = document.getElementById('search-results');

    let selectedVideos = new Set();
    let selectedVideoData = new Map();
    let isDownloading  = false;
    let currentUser = null;

    /* ── PLAYER LOGIC ── */
    let ytPlayer = null;
    let progressTimer = null;
    let currentPlaylist = [];
    let currentPlayingIndex = -1;

    const playerTitle   = document.getElementById('player-title');
    const playerChannel = document.getElementById('player-channel');
    const playerThumb   = document.getElementById('player-thumb');
    const btnPlay       = document.getElementById('player-play');
    const btnNext       = document.getElementById('player-next');
    const btnPrev       = document.getElementById('player-prev');
    const iconPlay      = document.getElementById('icon-play');
    const iconPause     = document.getElementById('icon-pause');
    const progressSlider= document.getElementById('player-progress');
    const timeCurrent   = document.getElementById('player-time-current');
    const timeTotal     = document.getElementById('player-time-total');

    window.onYouTubeIframeAPIReady = () => {
        ytPlayer = new YT.Player('yt-handler', {
            height: '1', width: '1', videoId: '',
            playerVars: { 
                'autoplay': 1, 
                'controls': 0, 
                'disablekb': 1, 
                'modestbranding': 1,
                'enablejsapi': 1
            },
            events: { 
                'onReady': () => console.log("Player Ready"), 
                'onStateChange': onPlayerStateChange 
            }
        });
    };

    function onPlayerStateChange(event) {
        if (event.data === YT.PlayerState.ENDED) {
            if (currentPlayingIndex < currentPlaylist.length - 1) playTrack(currentPlayingIndex + 1);
        }
        if (event.data === YT.PlayerState.PLAYING) {
            iconPlay.style.display = 'none';
            iconPause.style.display = 'block';
            startProgressTimer();
        } else {
            iconPlay.style.display = 'block';
            iconPause.style.display = 'none';
            stopProgressTimer();
        }
    }

    async function playTrack(index) {
        if (index < 0 || index >= currentPlaylist.length) return;
        currentPlayingIndex = index;
        const video = currentPlaylist[index];

        playerTitle.textContent = video.title;
        if (playerChannel) playerChannel.textContent = video.channel || '';
        if (playerThumb && video.thumbnail) {
            playerThumb.innerHTML = `<img src="${video.thumbnail}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
        }

        document.getElementById('player-bar').classList.remove('hidden');

        if (ytPlayer && ytPlayer.loadVideoById) {
            ytPlayer.loadVideoById(video.id);
            setupMediaSession(video);
            if (window.addToHistory) window.addToHistory(video);
        }
    }

    window.playSong = function(id, title, channel, thumbnail) {
        const video = { id, title, channel, thumbnail };
        currentPlaylist.push(video);
        playTrack(currentPlaylist.length - 1);
    };

    function setupMediaSession(video) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: video.title,
                artist: video.channel || 'TuZona EC',
                artwork: [{ src: video.thumbnail || '/static/favicon.png', sizes: '512x512', type: 'image/png' }]
            });
            navigator.mediaSession.setActionHandler('play', () => ytPlayer.playVideo());
            navigator.mediaSession.setActionHandler('pause', () => ytPlayer.pauseVideo());
            navigator.mediaSession.setActionHandler('previoustrack', () => btnPrev.click());
            navigator.mediaSession.setActionHandler('nexttrack', () => btnNext.click());
        }
    }

    function startProgressTimer() {
        stopProgressTimer();
        progressTimer = setInterval(() => {
            if (ytPlayer && ytPlayer.getCurrentTime) {
                const cur = ytPlayer.getCurrentTime();
                const dur = ytPlayer.getDuration();
                if (dur > 0) {
                    const pct = (cur / dur) * 100;
                    progressSlider.value = pct;
                    timeCurrent.textContent = formatTime(cur);
                    timeTotal.textContent = formatTime(dur);
                }
            }
        }, 1000);
    }

    function stopProgressTimer() { if (progressTimer) clearInterval(progressTimer); }

    function formatTime(s) {
        const m = Math.floor(s / 60), sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? '0' : ''}${sec}`;
    }

    btnPlay.addEventListener('click', () => {
        if (!ytPlayer || !ytPlayer.getPlayerState) return;
        const state = ytPlayer.getPlayerState();
        if (state === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
        else ytPlayer.playVideo();
    });

    btnNext.addEventListener('click', () => {
        if (currentPlayingIndex < currentPlaylist.length - 1) playTrack(currentPlayingIndex + 1);
    });

    btnPrev.addEventListener('click', () => {
        if (currentPlayingIndex > 0) playTrack(currentPlayingIndex - 1);
    });

    progressSlider.addEventListener('input', () => {
        if (ytPlayer && ytPlayer.getDuration) {
            const seekTo = (progressSlider.value / 100) * ytPlayer.getDuration();
            ytPlayer.seekTo(seekTo);
        }
    });

    /* ── SEARCH LOGIC ── */
    if (searchForm) {
        searchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const query = searchInput.value.trim();
            if (!query) return;

            searchResultsSec.classList.remove('hidden');
            loader.style.display = 'flex';
            resultsContainer.innerHTML = '';
            
            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                loader.style.display = 'none';
                renderResults(data.songs);
                document.getElementById('tendencias').style.display = 'none';
                document.getElementById('home').style.display = 'none';
            } catch (err) {
                loader.style.display = 'none';
                showNotification("Error en la búsqueda", true);
            }
        });
    }

    function renderResults(songs) {
        resultsContainer.innerHTML = songs.map((s, index) => `
            <div class="list-table-row" onclick="playSong('${s.id}', '${s.title.replace(/'/g, "\\'")}', '${s.channel.replace(/'/g, "\\'")}', '${s.thumbnail}')">
                <div class="lth-col lth-num">${index + 1}</div>
                <div class="lth-col lth-song">
                    <img src="${s.thumbnail}" alt="" style="width:40px;height:40px;border-radius:4px;margin-right:12px;">
                    <div>
                        <div style="font-weight:600;color:var(--txt);">${s.title}</div>
                        <div style="font-size:0.8rem;color:var(--txt-muted);">${s.channel}</div>
                    </div>
                </div>
                <div class="lth-col lth-artist">${s.channel}</div>
                <div class="lth-col lth-album">Single</div>
                <div class="lth-col lth-time">${s.duration || '3:45'}</div>
                <div class="lth-col lth-dl">
                    <button class="play-btn-circle" style="background:var(--primary);color:white;border:none;width:32px;height:32px;border-radius:50%;cursor:pointer;">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                </div>
            </div>
        `).join('');
    }

    /* ── TRENDING ── */
    const loadTrendingSongs = async () => {
        const grid = document.getElementById('trending-grid');
        if (!grid) return;
        try {
            const res = await fetch('/api/trending');
            const songs = await res.json();
            grid.style.display = 'grid';
            document.getElementById('trending-loader').style.display = 'none';
            grid.innerHTML = songs.map((s, index) => `
                <div class="card" onclick="playSong('${s.id}', '${s.title.replace(/'/g, "\\'")}', '${s.channel.replace(/'/g, "\\'")}', '${s.thumbnail}')">
                    <div class="card-img-wrapper">
                        <img src="${s.thumbnail}" alt="" class="card-img" loading="lazy">
                        <div class="card-badge">${index + 1}</div>
                        <button class="play-btn">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                    </div>
                    <div class="card-info">
                        <div class="card-title">${s.title}</div>
                        <div class="card-channel">${s.channel}</div>
                    </div>
                </div>
            `).join('');
        } catch (e) { console.error("Error loading trending:", e); }
    };

    /* ── AUTH UI ── */
    async function checkAuthStatus() {
        try {
            const res = await fetch('/api/user_status');
            const data = await res.json();
            const userActions = document.getElementById('user-actions');
            if (data.logged_in) {
                currentUser = data.user;
                userActions.innerHTML = `<div class="user-profile-badge"><div class="user-name">${currentUser.username}</div><button class="btn-logout" onclick="location.href='/api/logout'">Salir</button></div>`;
            } else {
                userActions.innerHTML = `<button class="btn-login" onclick="openAuthModal()">Iniciar sesión</button>`;
            }
        } catch (e) {}
    }

    checkAuthStatus();
    loadTrendingSongs();
});
