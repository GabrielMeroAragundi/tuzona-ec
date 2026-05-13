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
            height: '200', width: '200', videoId: '',
            playerVars: { 
                'autoplay': 1, 
                'controls': 0, 
                'disablekb': 1, 
                'modestbranding': 1,
                'enablejsapi': 1,
                'playsinline': 1
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
            // Explicitly call playVideo to ensure playback starts on mobile devices
            if (ytPlayer.playVideo) ytPlayer.playVideo();
            
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
                
                // EL SERVIDOR ENVÍA 'songs'
                const songs = data.songs || [];
                renderResults(songs);
                
                // Mostrar cabeceras de tabla para el nuevo diseño Spotify
                const tableHeader = document.querySelector('.list-table-header');
                if (tableHeader) tableHeader.style.display = 'grid';
                
                if (controlsPanel) {
                    controlsPanel.style.display = 'flex';
                    controlsPanel.classList.remove('hidden');
                }

                // Actualizar contadores de pestañas
                const songCount = document.getElementById('s-tab-count');
                if (songCount) songCount.textContent = `${songs.length} resultados`;

                document.getElementById('search-results').classList.remove('hidden');
                document.getElementById('tendencias').style.display = 'none';
                document.getElementById('home').style.display = 'none';
            } catch (err) {
                loader.style.display = 'none';
                showNotification("Error en la búsqueda", true);
            }
        });
    }

    function renderResults(songs) {
        if (!songs || !Array.isArray(songs)) return;
        
        // Volver a modo tabla profesional
        resultsContainer.className = "list-table-body";
        
        resultsContainer.innerHTML = songs.map((s, index) => {
            const safeTitle = s.title.replace(/'/g, "&apos;").replace(/"/g, "&quot;");
            const safeChannel = (s.channel || '').replace(/'/g, "&apos;").replace(/"/g, "&quot;");
            const isSelected = selectedVideos.has(s.id);

            return `
                <div class="list-table-row ${isSelected ? 'selected' : ''}" data-id="${s.id}" onclick="playSong('${s.id}', '${safeTitle}', '${safeChannel}', '${s.thumbnail}')">
                    <div class="lth-col lth-check desktop-only" onclick="event.stopPropagation()">
                        <label class="custom-checkbox-wrapper">
                            <input type="checkbox" class="song-checkbox" data-id="${s.id}" ${isSelected ? 'checked' : ''}>
                            <span class="custom-checkbox"></span>
                        </label>
                    </div>
                    <div class="lth-col lth-drag mobile-only" onclick="event.stopPropagation()">
                        <label style="cursor:pointer; display:flex; align-items:center; opacity:0.5;">
                            <input type="checkbox" class="song-checkbox" data-id="${s.id}" ${isSelected ? 'checked' : ''} style="display:none;">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                                <circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" />
                                <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                                <circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" />
                            </svg>
                        </label>
                    </div>
                    <div class="lth-col lth-song">
                        <img src="${s.thumbnail}" alt="" class="row-thumb">
                        <div class="song-info-meta" style="display:flex; flex-direction:column; justify-content:center;">
                            <div class="song-title-main" style="line-height:1.2; margin-bottom:2px;">${s.title}</div>
                            <div class="song-artist-mobile mobile-only" style="align-items:center; gap:4px; font-size:0.85rem; color:var(--txt-muted);">
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--primary)" stroke-width="2">
                                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                    <line x1="12" y1="19" x2="12" y2="22" />
                                </svg>
                                ${s.channel}
                            </div>
                        </div>
                    </div>
                    <div class="lth-col lth-artist desktop-only">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--primary)" stroke-width="2" style="margin-right:4px;">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="22" />
                        </svg>
                        ${s.channel}
                    </div>
                    <div class="lth-col lth-opt">
                        <button class="opt-btn" onclick="event.stopPropagation(); downloadSingle('${s.id}')">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        attachCheckboxListeners();
    }

    function attachCheckboxListeners() {
        document.querySelectorAll('.song-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                const id = cb.getAttribute('data-id');
                const row = cb.closest('.list-table-row');
                if (cb.checked) {
                    selectedVideos.add(id);
                    row.classList.add('selected');
                } else {
                    selectedVideos.delete(id);
                    row.classList.remove('selected');
                }
                updateSelectionUI();
            });
        });
    }

    function updateSelectionUI() {
        const count = selectedVideos.size;
        const topCount = document.getElementById('top-selection-count');
        const dCounts = document.querySelectorAll('.d-count');
        
        if (topCount) topCount.textContent = `${count} seleccionadas`;
        dCounts.forEach(el => el.textContent = count > 0 ? `(${count})` : '');
        
        if (topDownloadBtn) topDownloadBtn.disabled = (count === 0);
        if (queueDownloadBtn) queueDownloadBtn.disabled = (count === 0);
        if (controlsPanel) {
            if (count > 0) controlsPanel.classList.remove('hidden');
            else controlsPanel.classList.add('hidden');
        }
    }

    // SELECT ALL
    const selectAllCb = document.getElementById('select-all-cb');
    if (selectAllCb) {
        selectAllCb.addEventListener('change', () => {
            const checkboxes = document.querySelectorAll('.song-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = selectAllCb.checked;
                const id = cb.getAttribute('data-id');
                const row = cb.closest('.list-table-row');
                if (cb.checked) {
                    selectedVideos.add(id);
                    row.classList.add('selected');
                } else {
                    selectedVideos.delete(id);
                    row.classList.remove('selected');
                }
            });
            updateSelectionUI();
        });
    }

    /* ── TRENDING ── */
    const loadTrendingSongs = async () => {
        const grid = document.getElementById('trending-grid');
        const loader = document.getElementById('trending-loader');
        if (!grid) return;
        
        if (loader) {
            loader.style.display = 'flex';
            loader.innerHTML = '<div class="spinner"></div><p>Buscando música en tendencia...</p>';
        }

        try {
            const res = await fetch('/api/trending');
            if (!res.ok) throw new Error("Servidor respondió con error: " + res.status);
            
            const data = await res.json();
            const songs = data.trending || [];

            if (!songs || songs.length === 0) {
                if (loader) loader.innerHTML = '<p style="color:var(--txt-muted)">No hay tendencias disponibles.</p>';
                return;
            }

            grid.style.display = 'grid';
            if (loader) loader.style.display = 'none';
            
            grid.innerHTML = songs.map((s, index) => {
                const safeTitle = s.title.replace(/'/g, "&apos;").replace(/"/g, "&quot;");
                const safeChannel = (s.channel || '').replace(/'/g, "&apos;").replace(/"/g, "&quot;");
                return `
                    <div class="card" onclick="playSong('${s.id}', '${safeTitle}', '${safeChannel}', '${s.thumbnail}')">
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
                `;
            }).join('');
        } catch (e) { 
            if (loader) loader.innerHTML = `<p style="color:var(--ecr)">⚠️ Error: ${e.message}</p>`;
        }
    };

    /* ── AUTH UI ── */
    async function checkAuthStatus() {
        try {
            const res = await fetch('/api/user_status');
            const data = await res.json();
            const userActions = document.getElementById('user-actions');
            if (!userActions) return;
            
            if (data.logged_in) {
                currentUser = data.user;
                userActions.innerHTML = `
                    <div class="user-profile-badge">
                        <div class="user-name">${currentUser.username}</div>
                        <button class="btn-logout" onclick="location.href='/api/logout'">Salir</button>
                    </div>`;
            } else {
                userActions.innerHTML = `<button class="btn-login" onclick="openAuthModal()">Iniciar sesión</button>`;
            }
        } catch (e) {}
    }

    checkAuthStatus().then(() => {
        loadTrendingSongs();
    });
});
