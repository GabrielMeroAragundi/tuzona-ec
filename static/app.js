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

window.handleRegister = async function() {
    const userEl = document.getElementById('reg-user');
    const emailEl = document.getElementById('reg-email');
    const passEl = document.getElementById('reg-pass');
    const btn = document.getElementById('btn-register-submit');
    
    if(!userEl || !emailEl || !passEl) return;
    
    const username = userEl.value.trim();
    const email = emailEl.value.trim();
    const password = passEl.value.trim();
    
    if(!username || !email || !password) {
        window.showNotification("⚠️ Completa todos los campos para registrarte", true);
        return;
    }
    
    const originalText = btn.innerHTML;
    btn.innerHTML = '<div class="spinner"></div> Registrando...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        const data = await res.json();
        
        if (data.error) {
            if (data.error === "El usuario ya existe") {
                window.showNotification("❌ Este nombre de usuario ya está ocupado. Por favor, escoge otro.", true);
            } else {
                window.showNotification("❌ " + data.error, true);
            }
            btn.innerHTML = originalText;
            btn.disabled = false;
        } else {
            // Guardamos el email para la verificación
            window.pendingVerificationEmail = email;
            window.showNotification("⭐ " + data.message);
            window.openVerificationModal();
            btn.innerHTML = "¡Listo!";
        }
    } catch (err) {
        window.showNotification("❌ Error de conexión con el servidor", true);
        btn.innerHTML = originalText;
        btn.disabled = false;
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

    /* ── AUTH & ADMIN LOGIC ── */
    const authModal = document.getElementById('auth-modal');
    const adminModal = document.getElementById('admin-modal');
    const btnLoginNav = document.getElementById('btn-login');
    const userActions = document.getElementById('user-actions');

    async function checkAuthStatus() {
        try {
            const res = await fetch('/api/user_status');
            const data = await res.json();
            if (data.logged_in) {
                currentUser = data.user;
                updateAuthUI();
            } else {
                currentUser = null;
                updateAuthUI();
            }
        } catch (e) {
            console.error("Error al verificar autenticación", e);
        }
    }

    function updateAuthUI() {
        if (currentUser) {
            userActions.innerHTML = `
                <div class="user-profile-badge">
                    <div class="user-info">
                        <div class="user-name">${currentUser.username} ${currentUser.is_admin ? '<span class="badge-admin">ADMIN</span>' : ''}</div>
                        <button class="btn-logout" id="btn-logout">Cerrar Sesión</button>
                    </div>
                    ${currentUser.is_admin ? '<button class="nav-icon-btn" id="btn-admin" title="Panel Admin">⚙️</button>' : ''}
                </div>
            `;
            document.getElementById('btn-logout').addEventListener('click', logout);
            if (currentUser.is_admin) {
                document.getElementById('btn-admin').addEventListener('click', openAdminModal);
            }
        } else {
            userActions.innerHTML = `<button class="btn-login" id="btn-login-new">Iniciar sesión</button>`;
            document.getElementById('btn-login-new').addEventListener('click', openAuthModal);
        }
        // Refrescar listas sincronizadas
        if (typeof renderHistory === 'function') renderHistory();
        if (typeof renderFavorites === 'function') renderFavorites();
        if (typeof window.renderPlaylists === 'function') window.renderPlaylists();
    }


    async function logout() {
        await fetch('/api/logout');
        currentUser = null;
        updateAuthUI();
        showNotification("Sesión cerrada");
    }

    window.fetchAdminUsers = async function() {
        const userList = document.getElementById('admin-user-list');
        userList.innerHTML = '<tr><td colspan="7">Cargando...</td></tr>';
        try {
            const res = await fetch('/api/admin/users');
            const data = await res.json();
            if (data.error) {
                userList.innerHTML = `<tr><td colspan="7">${data.error}</td></tr>`;
                return;
            }
            userList.innerHTML = data.map(u => `
                <tr>
                    <td>${u.id}</td>
                    <td>${u.username}<br><small style="color:var(--txt-muted)">${u.email}</small></td>
                    <td>${u.is_admin ? '<span class="badge-admin">Sí</span>' : 'No'}</td>
                    <td>${u.is_verified ? '<span style="color:#10b981;">✓ Verificado</span>' : '<span style="color:#f59e0b;">Pendiente</span>'}</td>
                    <td style="text-align:center; font-weight:bold; color:var(--primary);">${u.songs_played || 0}</td>
                    <td style="text-align:center; font-weight:bold; color:#10b981;">${u.songs_downloaded || 0}</td>
                    <td>
                        ${!u.is_admin ? `<button class="btn-primary" style="background:#ef4444; padding:5px 10px; font-size:0.8rem;" onclick="deleteAdminUser(${u.id})">Borrar</button>` : ''}
                    </td>
                </tr>
            `).join('');
        } catch {
            userList.innerHTML = '<tr><td colspan="7">Error al cargar usuarios</td></tr>';
        }
    };

    window.fetchAdminFeedback = async function() {
        const feedbackList = document.getElementById('admin-feedback-list');
        feedbackList.innerHTML = '<tr><td colspan="5">Cargando sugerencias...</td></tr>';
        try {
            const res = await fetch('/api/admin/feedback');
            const data = await res.json();
            if (data.error) {
                feedbackList.innerHTML = `<tr><td colspan="5">${data.error}</td></tr>`;
                return;
            }
            if (data.length === 0) {
                feedbackList.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--txt-muted);">No hay sugerencias aún.</td></tr>`;
                return;
            }
            feedbackList.innerHTML = data.map(f => {
                let starsHTML = '';
                for(let i=1; i<=5; i++) {
                    starsHTML += `<span style="color:${i <= f.rating ? '#fbbf24' : 'rgba(255,255,255,0.2)'}; font-size:1.2rem;">★</span>`;
                }
                return `
                <tr>
                    <td>${f.id}</td>
                    <td style="font-weight:bold; color:var(--primary);">${f.user_name}</td>
                    <td>${starsHTML}</td>
                    <td style="max-width:250px; word-wrap:break-word;">${f.comment || '<em style="color:var(--txt-muted)">Sin comentario</em>'}</td>
                    <td style="font-size:0.85rem; color:var(--txt-muted);">${f.created_at}</td>
                </tr>
            `}).join('');
        } catch {
            feedbackList.innerHTML = '<tr><td colspan="5">Error al cargar sugerencias</td></tr>';
        }
    };

    window.deleteAdminUser = async function(id) {
        if (!confirm('¿Estás seguro de que deseas eliminar este usuario permanentemente?')) return;
        try {
            const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.error) {
                showNotification(data.error, true);
            } else {
                showNotification(data.message);
                await window.fetchAdminUsers();
            }
        } catch {
            showNotification('Error al eliminar usuario', true);
        }
    };

    /* ── AUTH HANDLERS ── */
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    if (tabLogin) {
        tabLogin.addEventListener('click', () => {
            tabLogin.classList.add('active');
            tabRegister.classList.remove('active');
            loginForm.style.display = 'block';
            registerForm.style.display = 'none';
        });
    }

    if (tabRegister) {
        tabRegister.addEventListener('click', () => {
            tabRegister.classList.add('active');
            tabLogin.classList.remove('active');
            registerForm.style.display = 'block';
            loginForm.style.display = 'none';
        });
    }

    if (registerForm) {
        registerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (window.handleRegister) window.handleRegister();
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('login-user').value;
            const password = document.getElementById('login-pass').value;
            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                
                if (data.error) {
                    showNotification(data.error, true);
                } else {
                    currentUser = data.user;
                    updateAuthUI();
                    window.closeAuthModal();
                    showNotification(`Bienvenido, ${currentUser.username}`);
                }
            } catch { showNotification("Error al iniciar sesión", true); }
        });
    }

    const forgotForm = document.getElementById('forgot-form');
    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('forgot-email').value;
            // Leer captcha justo antes de enviar
            const captchaIdField = document.getElementById('captcha-id');
            const captchaCodeField = document.getElementById('captcha-code');
            const captcha_id = captchaIdField.value;
            const captcha_code = captchaCodeField.value;
            
            if (!captcha_id) {
                showNotification("Espera a que cargue el captcha", true);
                return;
            }

            const btn = document.getElementById('btn-forgot-submit');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<div class="spinner"></div> Enviando...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/forgot_password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, captcha_id, captcha_code })
                });
                const data = await res.json();

                if (data.error) {
                    showNotification(data.error, true);
                    // Invalidar el captcha viejo inmediatamente
                    captchaIdField.value = '';
                    captchaCodeField.value = '';
                    // Esperar a que el nuevo captcha cargue ANTES de habilitar el botón
                    await window.loadCaptcha();
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                } else { 
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    window.closeForgotModal();
                    window.showSuccessPopup(
                        '¡Enlace Enviado!',
                        'Se ha enviado un enlace de recuperación a tu correo electrónico. Por favor revisa tu bandeja de entrada.',
                        '✉'
                    );
                }
            } catch { 
                showNotification("Error al procesar solicitud", true); 
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    const resetForm = document.getElementById('reset-form');
    if (resetForm) {
        resetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pass = document.getElementById('reset-pass').value;
            const confirm = document.getElementById('reset-pass-confirm').value;
            const token = window.pendingResetToken || new URLSearchParams(window.location.search).get('reset_token');
            
            if (pass !== confirm) { showNotification("Las contraseñas no coinciden", true); return; }
            if (!token) { showNotification("Error: No hay token de recuperación válido", true); return; }

            const btn = document.querySelector('#reset-form button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<div class="spinner"></div> Cambiando...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/reset_password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        token: token,
                        new_password: pass 
                    })
                });
                const data = await res.json();
                
                btn.innerHTML = originalText;
                btn.disabled = false;

                if (data.error) {
                    showNotification(data.error, true);
                } else {
                    window.closeResetModal();
                    window.history.replaceState({}, document.title, window.location.pathname);
                    window.pendingResetToken = null;
                    
                    currentUser = data.user;
                    updateAuthUI();

                    window.showSuccessPopup(
                        '¡Contraseña Actualizada!',
                        'Tu contraseña ha sido cambiada con éxito. Ya puedes disfrutar de TuZona EC.',
                        '✓'
                    );
                }
            } catch { 
                showNotification("Error al restablecer contraseña", true); 
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    // Auto-abrir modal si hay token de recuperación en la URL
    const urlParams = new URLSearchParams(window.location.search);
    const resetTokenParam = urlParams.get('reset_token');
    if (resetTokenParam) {
        window.pendingResetToken = resetTokenParam;
        setTimeout(() => {
            if (typeof window.openResetModal === 'function') {
                window.openResetModal();
            }
        }, 500);
    }

    // Verificación de Código
    const verificationForm = document.getElementById('verification-form');
    if (verificationForm) {
        verificationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('verify-code').value;
            const email = window.pendingVerificationEmail;
            if (!email || !code) return;

            const btn = document.getElementById('btn-verify-submit');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<div class="spinner"></div> Validando...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/verify_code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, code })
                });
                const data = await res.json();
                if (data.error) {
                    showNotification(data.error, true);
                } else {
                    window.closeVerificationModal();
                    
                    const successModal = document.getElementById('success-modal');
                    const successMsg = document.getElementById('success-message');
                    
                    if (successModal && successMsg) {
                        successMsg.textContent = data.message;
                        successModal.classList.add('active');
                        
                        setTimeout(() => {
                            successModal.classList.remove('active');
                            window.openAuthModal();
                            const tabLogin = document.getElementById('tab-login');
                            if (tabLogin) tabLogin.click();
                        }, 5000);
                    } else {
                        showNotification(data.message);
                        window.openAuthModal();
                        const tabLogin = document.getElementById('tab-login');
                        if (tabLogin) tabLogin.click();
                    }
                }
            } catch {
                showNotification("Error al procesar verificación", true);
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    // URL Token Check
    if (new URLSearchParams(window.location.search).has('token')) window.openResetModal();

    checkAuthStatus();
    if (btnLoginNav) btnLoginNav.addEventListener('click', window.openAuthModal);

    /* ── THEME TOGGLE ── */
    const themeToggle = document.getElementById('theme-toggle');
    const iconMoon    = document.getElementById('icon-moon');
    const iconSun     = document.getElementById('icon-sun');
    let isDark = true;

    themeToggle.addEventListener('click', () => {
        isDark = !isDark;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        iconMoon.style.display = isDark ? '' : 'none';
        iconSun.style.display  = isDark ? 'none' : '';
    });

    /* ── QUICK SEARCH TAGS ── */
    document.querySelectorAll('.qt-tag').forEach(btn => {
        btn.addEventListener('click', () => {
            searchInput.value = btn.dataset.query;
            searchForm.dispatchEvent(new Event('submit'));
        });
    });

    /* ── SEARCH & TABS ── */
    let currentSearchQuery = '';
    let lastSearchResults = { songs: [], artists: [], albums: [], playlists: [] };
    let activeTab = 'songs';

    const tabs = {
        songs: document.getElementById('tab-songs'),
        artists: document.getElementById('tab-artists'),
        albums: document.getElementById('tab-albums'),
        playlists: document.getElementById('tab-playlists')
    };

    const tabCounts = {
        songs: document.getElementById('s-tab-count'),
        artists: document.getElementById('a-tab-count'),
        albums: document.getElementById('p-tab-count'),
        playlists: document.getElementById('l-tab-count')
    };

    Object.keys(tabs).forEach(key => {
        if (!tabs[key]) return;
        tabs[key].addEventListener('click', () => {
            if (activeTab === key) return;
            switchTab(key);
        });
    });

    async function switchTab(tabKey) {
        activeTab = tabKey;
        Object.keys(tabs).forEach(k => {
            if (tabs[k]) tabs[k].classList.toggle('active', k === tabKey);
        });

        if (tabKey === 'songs') {
            renderResults(lastSearchResults.songs);
            if (controlsPanel) controlsPanel.classList.remove('hidden');
        } else if (tabKey === 'artists') {
            if (lastSearchResults.artists.length === 0 && currentSearchQuery) {
                await fetchArtists(currentSearchQuery);
            }
            renderArtists(lastSearchResults.artists);
            if (controlsPanel) controlsPanel.classList.add('hidden');
        } else if (tabKey === 'albums') {
            if (lastSearchResults.albums.length === 0 && currentSearchQuery) {
                await fetchAlbums(currentSearchQuery);
            }
            renderAlbums(lastSearchResults.albums);
            if (controlsPanel) controlsPanel.classList.add('hidden');
        } else {
            resultsContainer.innerHTML = '<div style="text-align:center;color:var(--txt-muted);padding:3rem">Sección en desarrollo.</div>';
            if (controlsPanel) controlsPanel.classList.add('hidden');
        }
    }

    let currentSearchLimit = 100;
    
    window.loadMoreSongs = async function() {
        if (!currentSearchQuery) return;
        currentSearchLimit += 100;
        
        const loader = document.getElementById('loader');
        const loadMoreBtn = document.getElementById('btn-load-more');
        if(loadMoreBtn) {
            loadMoreBtn.innerHTML = '<div class="spinner" style="width:16px;height:16px;"></div> Cargando...';
            loadMoreBtn.disabled = true;
        } else {
            if(loader) loader.classList.remove('hidden');
        }
        
        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(currentSearchQuery)}&limit=${currentSearchLimit}`);
            const data = await response.json();
            
            if (loader) loader.classList.add('hidden');
            
            if (!data.error && data.results) {
                lastSearchResults.songs = data.results;
                if (tabCounts.songs) tabCounts.songs.textContent = `${data.results.length} resultados`;
                switchTab('songs');
            }
        } catch {
            if (loader) loader.classList.add('hidden');
            showNotification('Error al cargar más canciones.', true);
        }
    };

    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (!query) return;

        currentSearchQuery = query;
        currentSearchLimit = 100;
        lastSearchResults = { songs: [], artists: [], albums: [], playlists: [] };
        
        selectedVideos.clear();
        selectedVideoData.clear();
        updateDownloadPanel();
        
        resultsContainer.innerHTML = '';
        if (controlsPanel) controlsPanel.classList.add('hidden');
        searchResultsSec.classList.add('hidden');
        loader.classList.remove('hidden');

        const resultsHeading = document.getElementById('results-heading');
        if (resultsHeading) resultsHeading.innerHTML = `Resultados para <span style="color:var(--primary);">"${query}"</span>`;

        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=${currentSearchLimit}`);
            const data = await response.json();
            loader.classList.add('hidden');

            if (data.error) { showNotification(`Error: ${data.error}`, true); return; }

            searchResultsSec.classList.remove('hidden');
            if (data.results && data.results.length > 0) {
                lastSearchResults.songs = data.results;
                if (tabCounts.songs) tabCounts.songs.textContent = `${data.results.length} resultados`;
                
                switchTab('songs');
                searchResultsSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                resultsContainer.innerHTML = '<div style="text-align:center;color:var(--txt-muted);padding:3rem">No se encontraron resultados.</div>';
            }
        } catch {
            loader.classList.add('hidden');
            showNotification('Error de conexión al buscar.', true);
        }
    });

    async function fetchArtists(query) {
        loader.classList.remove('hidden');
        try {
            const res = await fetch(`/api/search_artists?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            lastSearchResults.artists = data.results || [];
            if (tabCounts.artists) tabCounts.artists.textContent = `${lastSearchResults.artists.length} resultados`;
        } catch (e) {
            console.error(e);
        } finally {
            loader.classList.add('hidden');
        }
    }

    async function fetchAlbums(query) {
        loader.classList.remove('hidden');
        try {
            const res = await fetch(`/api/search_albums?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            lastSearchResults.albums = data.results || [];
            if (tabCounts.albums) tabCounts.albums.textContent = `${lastSearchResults.albums.length} resultados`;
        } catch (e) {
            console.error(e);
        } finally {
            loader.classList.add('hidden');
        }
    }

    /* ── RENDER RESULTS ── */
    function renderResults(videos) {
        currentPlaylist = videos;
        resultsContainer.innerHTML = '';
        resultsContainer.className = 'list-table-body'; // Reset to table layout

        videos.forEach((video, index) => {
            const row = document.createElement('div');
            row.className = 'list-track-row';
            row.dataset.id = video.id;
            
            const isSelected = selectedVideos.has(video.id);
            if (isSelected) row.classList.add('selected');

            row.innerHTML = `
                <div class="lth-col ltr-num">
                    <label class="custom-checkbox-wrapper" style="margin-right:10px;">
                        <input type="checkbox" class="row-checkbox" ${isSelected ? 'checked' : ''}>
                        <span class="custom-checkbox"></span>
                    </label>
                    <span class="row-index">${index + 1}</span>
                </div>
                <div class="lth-col ltr-song">
                    <img src="${video.thumbnail}" class="ltr-thumb" loading="lazy">
                    <div class="ltr-info">
                        <div class="ltr-title">${video.title} <span class="ltr-badge">E</span></div>
                        <div class="ltr-sub">${video.channel}</div>
                    </div>
                </div>
                <div class="lth-col ltr-artist">${video.channel}</div>
                <div class="lth-col ltr-album">${video.year || 'Sencillo'}</div>
                <div class="lth-col ltr-time">${video.duration}</div>
                <div class="lth-col ltr-dl">
                    <button class="ltr-icon-btn purple download-single-btn" title="Descargar">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    <button class="ltr-icon-btn add-to-playlist-btn" title="Agregar a lista" data-vid="${video.id}" data-title="${video.title.replace(/"/g,'&quot;')}" data-channel="${video.channel}" data-thumb="${video.thumbnail}">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                </div>
            `;

            const songArea = row.querySelector('.ltr-song');
            songArea.addEventListener('click', (e) => {
                if (e.target.tagName.toLowerCase() !== 'input') {
                    playTrack(index);
                }
            });

            const cb = row.querySelector('.row-checkbox');
            cb.addEventListener('change', (e) => {
                if(cb.checked) {
                    selectedVideos.add(video.id);
                    selectedVideoData.set(video.id, video);
                    row.classList.add('selected');
                } else {
                    selectedVideos.delete(video.id);
                    selectedVideoData.delete(video.id);
                    row.classList.remove('selected');
                }
                updateDownloadPanel();
                checkSelectAllState();
            });

            row.querySelector('.download-single-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                downloadSingle(video);
            });

            const addToPlBtn = row.querySelector('.add-to-playlist-btn');
            if (addToPlBtn) {
                addToPlBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.showAddToPlaylist(video.id, video.title, video.channel, video.thumbnail, addToPlBtn);
                });
            }

            resultsContainer.appendChild(row);
        });

        if (videos.length > 0 && videos.length >= currentSearchLimit) {
            const loadMoreWrapper = document.createElement('div');
            loadMoreWrapper.style.textAlign = 'center';
            loadMoreWrapper.style.padding = '20px 0';
            loadMoreWrapper.style.gridColumn = '1 / -1';
            loadMoreWrapper.innerHTML = `<button id="btn-load-more" class="btn-secondary" onclick="window.loadMoreSongs()">Mostrar más canciones...</button>`;
            resultsContainer.appendChild(loadMoreWrapper);
        }

        checkSelectAllState();
        updateDownloadPanel();
    }

    function renderArtists(artists) {
        resultsContainer.innerHTML = '';
        resultsContainer.className = 'artist-profile-layout'; // New class for profile view

        if (artists.length === 0) {
            resultsContainer.innerHTML = '<div style="text-align:center;color:var(--txt-muted);padding:3rem;grid-column:1/-1;">No se encontró información del artista.</div>';
            return;
        }

        const artist = artists[0];
        
        const profileHTML = `
            <div class="artist-profile-card">
                <div class="ap-banner" style="background: ${artist.banner ? `url(${artist.banner}) center/cover` : 'linear-gradient(135deg, var(--primary), var(--secondary))'};">
                    <div class="ap-banner-overlay"></div>
                </div>
                <div class="ap-content">
                    <div class="ap-header">
                        <div class="ap-avatar-wrap">
                            <img src="${artist.thumbnail}" class="ap-avatar">
                        </div>
                        <div class="ap-info">
                            <div class="ap-badge">Artista Verificado</div>
                            <h1 class="ap-title">${artist.title}</h1>
                            <div class="ap-stats">
                                <span class="ap-stat"><b>${artist.subscribers || 'N/A'}</b> suscriptores</span>
                                <span class="ap-stat"><b>${artist.views || 'N/A'}</b> visualizaciones</span>
                            </div>
                        </div>
                        <div class="ap-actions">
                            <button class="btn-primary" onclick="window.open('${artist.link}', '_blank')">Seguir en YouTube</button>
                            <button class="nav-icon-btn"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
                        </div>
                    </div>
                    
                    <div class="ap-body">
                        <div class="ap-bio-section">
                            <h3>Biografía</h3>
                            <p class="ap-bio-text">${artist.description.replace(/\n/g, '<br>')}</p>
                        </div>
                        <div class="ap-details-grid">
                            <div class="ap-detail-item">
                                <div class="ap-detail-icon">🏆</div>
                                <div class="ap-detail-text"><b>Premios</b><small>Consulta la bio para detalles de GRAMMYs y más.</small></div>
                            </div>
                            <div class="ap-detail-item">
                                <div class="ap-detail-icon">🌍</div>
                                <div class="ap-detail-text"><b>Origen</b><small>Información disponible en la descripción oficial.</small></div>
                            </div>
                            <div class="ap-detail-item">
                                <div class="ap-detail-icon">🤝</div>
                                <div class="ap-detail-text"><b>Colaboraciones</b><small>Múltiples éxitos con artistas globales.</small></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        resultsContainer.innerHTML = profileHTML;
    }


    function renderAlbums(albums) {
        resultsContainer.innerHTML = '';
        resultsContainer.className = 'media-grid-layout';

        if (albums.length === 0) {
            resultsContainer.innerHTML = '<div style="text-align:center;color:var(--txt-muted);padding:3rem;grid-column:1/-1;">No se encontraron álbumes.</div>';
            return;
        }

        albums.forEach(album => {
            const card = document.createElement('div');
            card.className = 'card';
            const isPlaylist = album.type === 'playlist';
            const clickAction = isPlaylist 
                ? `window.open('https://www.youtube.com/playlist?list=${album.id}', '_blank')`
                : `window.open('https://www.youtube.com/watch?v=${album.id}', '_blank')`;

            card.innerHTML = `
                <div class="card-img-wrapper">
                    <img src="${album.thumbnail}" class="card-img">
                </div>
                <div class="card-info">
                    <div class="card-title">${album.title}</div>
                    <div class="card-channel">${album.channel || ''} • ${isPlaylist ? (album.videoCount + ' canciones') : 'Álbum Completo'}</div>
                </div>
                <button class="play-btn-circle" onclick="${clickAction}">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
            `;
            resultsContainer.appendChild(card);
        });
    }


    /* ── SORTING ── */
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            if (activeTab !== 'songs' || lastSearchResults.songs.length === 0) return;
            
            const val = sortSelect.value;
            let sorted = [...lastSearchResults.songs];

            if (val === 'year-desc') {
                sorted.sort((a, b) => (b.year || 0) - (a.year || 0));
            } else if (val === 'year-asc') {
                sorted.sort((a, b) => (a.year || 0) - (b.year || 0));
            } else if (val === 'title-asc') {
                sorted.sort((a, b) => a.title.localeCompare(b.title));
            }
            // Relevance is the original order, so no need for explicit sort if 'relevance'
            
            renderResults(sorted);
        });
    }


    /* ── SELECTION & QUEUE ── */
    function checkSelectAllState() {
        const selectAllCb = document.getElementById('select-all-cb');
        if (!selectAllCb) return;
        const allRows = document.querySelectorAll('.list-track-row');
        if (allRows.length === 0) {
            selectAllCb.checked = false;
            return;
        }
        const allChecked = Array.from(allRows).every(row => row.querySelector('.row-checkbox').checked);
        selectAllCb.checked = allChecked;
    }

    const selectAllCb = document.getElementById('select-all-cb');
    if (selectAllCb) {
        selectAllCb.addEventListener('change', (e) => {
            if (isDownloading) return;
            const checked = e.target.checked;
            const allRows = document.querySelectorAll('.list-track-row');
            
            allRows.forEach(row => {
                const cb = row.querySelector('.row-checkbox');
                cb.checked = checked;
                const id = row.dataset.id;
                
                const video = currentPlaylist.find(v => v.id === id);
                
                if (checked) {
                    selectedVideos.add(id);
                    if (video) selectedVideoData.set(id, video);
                    row.classList.add('selected');
                } else {
                    selectedVideos.delete(id);
                    selectedVideoData.delete(id);
                    row.classList.remove('selected');
                }
            });
            updateDownloadPanel();
        });
    }

    function updateDownloadPanel() {
        const n = selectedVideos.size;
        
        // Update Action Bar Counts
        const topCount = document.getElementById('top-selection-count');
        if(topCount) topCount.textContent = `${n} seleccionadas`;
        
        const topDCount = document.querySelector('#top-download-btn .d-count');
        if(topDCount) topDCount.textContent = `(${n})`;
        
        if (topDownloadBtn) topDownloadBtn.disabled = n === 0;

        // Update Queue Sidebar
        const queueBadge = document.getElementById('queue-count-badge');
        if(queueBadge) queueBadge.textContent = n;
        
        if (queueDownloadBtn) {
            queueDownloadBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Descargar (${n})`;
            queueDownloadBtn.disabled = n === 0;
        }

        const queueList = document.getElementById('queue-list');
        if (queueList) {
            if (n === 0) {
                queueList.innerHTML = '<div class="empty-state" style="padding: 2rem 0; font-size: 0.85rem;">No has seleccionado ninguna canción aún.</div>';
            } else {
                queueList.innerHTML = '';
                selectedVideoData.forEach(video => {
                    const item = document.createElement('div');
                    item.className = 'queue-item';
                    item.innerHTML = `
                        <img src="${video.thumbnail || ''}" class="queue-thumb">
                        <div class="queue-info">
                            <div class="queue-title">${video.title}</div>
                            <div class="queue-sub">${video.channel} <br> 320kbps</div>
                        </div>
                        <button class="queue-remove" data-id="${video.id}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    `;
                    
                    item.querySelector('.queue-remove').addEventListener('click', () => {
                        const row = document.querySelector(`.list-track-row[data-id="${video.id}"]`);
                        if (row) {
                            row.querySelector('.row-checkbox').checked = false;
                            row.classList.remove('selected');
                        }
                        
                        selectedVideos.delete(video.id);
                        selectedVideoData.delete(video.id);
                        
                        updateDownloadPanel();
                        checkSelectAllState();
                    });
                    
                    queueList.appendChild(item);
                });
            }
        }
    }
    
    function downloadSingle(video) {
        if (isDownloading) return;
        selectedVideos.clear();
        selectedVideoData.clear();
        selectedVideos.add(video.id);
        selectedVideoData.set(video.id, video);
        updateDownloadPanel();
        handleDownload();
    }

    /* ── DOWNLOAD (ORIGINAL LOGIC - UNCHANGED) ── */
    const handleDownload = async () => {
        if (!currentUser) {
            showNotification("⚠️ Debes iniciar sesión para descargar música.", true);
            openAuthModal();
            return;
        }
        if (selectedVideos.size === 0 || isDownloading) return;
        const ids = Array.from(selectedVideos);
        isDownloading = true;
        
        const fmt = (document.querySelector('input[name="dl-format"]:checked') || {}).value || 'mp3';
        showNotification(`Iniciando descarga de ${ids.length} canciones...`);

        // Procesar cada canción individualmente
        for (let i = 0; i < ids.length; i++) {
            const videoId = ids[i];
            const videoData = selectedVideoData.get(videoId);
            const msg = `Descargando (${i + 1}/${ids.length}): ${videoData ? videoData.title : videoId}`;
            
            // Actualizar UI de progreso
            [queueDownloadBtn, topDownloadBtn].forEach(b => {
                if(b) b.innerHTML = `<div class="spinner"></div> ${i + 1}/${ids.length}`;
            });

            try {
                const response = await fetch('/api/download', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: [videoId], format: fmt })
                });

                const result = await response.json();
                
                if (result.url) {
                    // Abrir el link de descarga en una pestaña nueva/oculta
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = result.url;
                    a.target = '_blank';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => document.body.removeChild(a), 100);
                } else if (result.error) {
                    throw new Error(result.error);
                }

            } catch (error) {
                console.error(`Fallo en ${videoId}:`, error);
                showNotification(`Error: ${error.message || 'No se pudo generar el link'}`, true);
            }
            
            // Pequeña espera entre peticiones
            await new Promise(r => setTimeout(r, 1000));
        }

        showNotification('¡Todas las descargas han sido enviadas! ✅');
        selectedVideos.clear();
        selectedVideoData.clear();
        document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
        updateDownloadPanel();
        isDownloading = false;
        
        if(queueDownloadBtn) queueDownloadBtn.innerHTML = `Descargar (0)`;
        if(topDownloadBtn) topDownloadBtn.innerHTML = `Descargar Seleccionadas`;
    };

    if(queueDownloadBtn) queueDownloadBtn.addEventListener('click', handleDownload);
    if(topDownloadBtn) topDownloadBtn.addEventListener('click', handleDownload);


    /* ── PLAYER LOGIC ── */
    let currentPlaylist = [];
    let currentPlayingIndex = -1;

    const playerTitle   = document.getElementById('player-title');
    const playerChannel = document.getElementById('player-channel');
    const playerThumb   = document.getElementById('player-thumb');
    // --- NUEVO MOTOR DE REPRODUCCIÓN (YOUTUBE IFRAME API) ---
    let ytPlayer = null;
    let progressTimer = null;

    window.onYouTubeIframeAPIReady = () => {
        ytPlayer = new YT.Player('yt-handler', {
            height: '200', width: '200', videoId: '',
            playerVars: { 
                'autoplay': 1, 
                'controls': 0, 
                'disablekb': 1, 
                'fs': 0, 
                'rel': 0, 
                'modestbranding': 1,
                'origin': window.location.origin,
                'enablejsapi': 1
            },
            events: { 
                'onReady': () => console.log("TuZona EC Player Ready"), 
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
            // Mantener el proceso vivo con silencio
            if (mainAudio.paused) {
                mainAudio.src = SILENT_MP3;
                mainAudio.play().catch(() => {});
            }
        } else if (event.data === YT.PlayerState.PAUSED) {
            if (document.visibilityState === 'visible') {
                iconPlay.style.display = 'block';
                iconPause.style.display = 'none';
                stopProgressTimer();
                if (mainAudio) mainAudio.pause();
            }
        }
    }

    // --- VARIABLES DE CONTROL GLOBALES ---
    let activeEngine = 'youtube'; 
    const SILENT_MP3 = "data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAP8A/wD/";
    window.mainAudio = document.getElementById('main-audio-element');
    if (mainAudio) mainAudio.loop = true;

    let wakeLock = null;
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {}
    }

    function useYTFallback(video) {
        activeEngine = 'youtube';
        if (ytPlayer && ytPlayer.loadVideoById) {
            ytPlayer.loadVideoById(video.id);
            playerTitle.textContent = video.title;
            setupMediaSession(video);
        }
    }

    // --- LÓGICA DE INSTALACIÓN PWA ---
    let deferredPrompt;
    const btnInstallPwa = document.getElementById('btn-install-pwa');
    const btnDownloadApk = document.getElementById('btn-download-apk');

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile && btnDownloadApk) {
        btnDownloadApk.style.display = 'block';
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        // Evitar que el navegador muestre el aviso automático
        e.preventDefault();
        deferredPrompt = e;
        // Mostrar nuestro botón personalizado
        if (btnInstallPwa) btnInstallPwa.style.display = 'block';
    });

    if (btnInstallPwa) {
        btnInstallPwa.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            // Mostrar el prompt de instalación
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`Usuario eligió: ${outcome}`);
            // Limpiar la variable y ocultar el botón
            deferredPrompt = null;
            btnInstallPwa.style.display = 'none';
        });
    }

    window.addEventListener('appinstalled', () => {
        console.log('TuZona EC instalada con éxito');
        if (btnInstallPwa) btnInstallPwa.style.display = 'none';
    });
    
    function setupMediaSession(video) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: video.title,
                artist: video.channel || 'TuZona EC',
                artwork: [
                    { src: video.thumbnail || '/static/favicon.png', sizes: '512x512', type: 'image/png' }
                ]
            });
            
            // CONFIGURAR INTERCEPTOR DE PAUSA Y BOTONES
            const actions = [
                ['play', () => { if(ytPlayer) ytPlayer.playVideo(); if(mainAudio) mainAudio.play(); }],
                ['pause', () => { 
                    // Si el sistema intenta pausar al salir, forzamos la reanudación
                    if (document.visibilityState === 'hidden') {
                        if(ytPlayer) ytPlayer.playVideo(); 
                        if(mainAudio) mainAudio.play();
                    } else {
                        if(ytPlayer) ytPlayer.pauseVideo();
                        if(mainAudio) mainAudio.pause();
                    }
                }],
                ['previoustrack', () => { if(btnPrev) btnPrev.click(); }],
                ['nexttrack', () => { if(btnNext) btnNext.click(); }],
                ['seekbackward', () => { if(ytPlayer) ytPlayer.seekTo(ytPlayer.getCurrentTime() - 10); }],
                ['seekforward', () => { if(ytPlayer) ytPlayer.seekTo(ytPlayer.getCurrentTime() + 10); }]
            ];

            actions.forEach(([action, handler]) => {
                try { navigator.mediaSession.setActionHandler(action, handler); } catch(e) {}
            });
            
            // Forzar estado activo
            navigator.mediaSession.playbackState = 'playing';
        }
    }

    // --- MOTOR DE PERSISTENCIA Y RELEVO ---
    let watchdogTimer = null;
    let backgroundAudioUrl = null; // Almacena el relevo en silencio

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // RELEVO AUTOMÁTICO: Si tenemos el audio listo, cambiamos de YouTube a Audio Directo
            if (activeEngine === 'youtube' && backgroundAudioUrl && ytPlayer && ytPlayer.getCurrentTime) {
                const currentTime = ytPlayer.getCurrentTime();
                ytPlayer.pauseVideo();
                activeEngine = 'audio';
                mainAudio.src = backgroundAudioUrl;
                mainAudio.currentTime = currentTime;
                mainAudio.play().catch(() => {});
            }

            if (watchdogTimer) clearInterval(watchdogTimer);
            watchdogTimer = setInterval(() => {
                if (ytPlayer && ytPlayer.getPlayerState && activeEngine === 'youtube') {
                    const state = ytPlayer.getPlayerState();
                    if (state === YT.PlayerState.PAUSED) {
                        ytPlayer.playVideo();
                        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
                    }
                }
                if (mainAudio && mainAudio.paused && activeEngine === 'audio') {
                    mainAudio.play().catch(() => {});
                    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
                }
            }, 1500);
        } else {
            // RELEVO DE REGRESO: Volver a YouTube cuando el usuario abra la App
            if (activeEngine === 'audio' && mainAudio) {
                const currentTime = mainAudio.currentTime;
                mainAudio.pause();
                activeEngine = 'youtube';
                if (ytPlayer && ytPlayer.seekTo) {
                    ytPlayer.seekTo(currentTime);
                    ytPlayer.playVideo();
                }
            }
            if (watchdogTimer) clearInterval(watchdogTimer);
            watchdogTimer = null;
        }
    });

    function stopProgressTimer() {
        if (progressTimer) clearInterval(progressTimer);
    }

    // --- PLAYER UI CONTROLS ---
    const btnPlay       = document.getElementById('player-play');
    const btnNext       = document.getElementById('player-next');
    const btnPrev       = document.getElementById('player-prev');
    const btnFav        = document.getElementById('player-fav');
    const iconPlay      = document.getElementById('icon-play');
    const iconPause     = document.getElementById('icon-pause');
    const progressSlider= document.getElementById('player-progress');
    const timeCurrent   = document.getElementById('player-time-current');
    const timeTotal     = document.getElementById('player-time-total');

    function formatTime(s) {
        if (isNaN(s) || !isFinite(s)) return '0:00';
        const m = Math.floor(s / 60), sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? '0' : ''}${sec}`;
    }

    async function playTrack(index) {
        if (index < 0 || index >= currentPlaylist.length) return;
        currentPlayingIndex = index;
        const video = currentPlaylist[index];

        playerTitle.textContent = video.title + ' (Cargando...)';
        if (playerChannel) playerChannel.textContent = video.channel || '';
        if (playerThumb) {
            if (video.thumbnail) playerThumb.innerHTML = `<img src="${video.thumbnail}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
            else playerThumb.textContent = '🎵';
        }
        
        const playerBar = document.getElementById('player-bar');
        if (playerBar) playerBar.classList.remove('hidden');

        requestWakeLock();
        activeEngine = 'youtube';
        backgroundAudioUrl = null; // Resetear relevo

        try {
            if (ytPlayer && ytPlayer.loadVideoById) {
                ytPlayer.loadVideoById({ videoId: video.id, suggestedQuality: 'small' });
                ytPlayer.playVideo(); // FORZADO PARA APK
                playerTitle.textContent = video.title;
                setupMediaSession(video);
                if (window.addToHistory) window.addToHistory(video);

                // TEMPORIZADOR DE EMERGENCIA (4 segundos)
                // Si YouTube no arranca en 4s, saltamos al audio directo
                const fallbackTimeout = setTimeout(() => {
                    if (ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING && backgroundAudioUrl) {
                        console.log("YouTube bloqueado, usando motor de audio directo...");
                        activeEngine = 'audio';
                        mainAudio.src = backgroundAudioUrl;
                        mainAudio.play().catch(() => {});
                    }
                }, 4000);

                // PREPARAR RELEVO EN SILENCIO (Búsqueda inmediata en segundo plano)
                fetch(`/api/stream_url/${video.id}`)
                    .then(r => r.json())
                    .then(data => { if(data.url) backgroundAudioUrl = data.url; })
                    .catch(() => {});
            }
        } catch (err) {
            console.error("Error:", err);
        }
    }

    window.playSong = function(id, title, channel, thumbnail) {
        const video = { id, title, channel, thumbnail };
        currentPlaylist.push(video);
        playTrack(currentPlaylist.length - 1);
    };

    btnPlay.addEventListener('click', () => {
        // ACTIVACIÓN PREVIA: Abrimos el canal de audio justo en el clic
        if (mainAudio && mainAudio.paused) {
            mainAudio.src = SILENT_MP3;
            mainAudio.play().catch(() => {});
        }

        if (activeEngine === 'audio') {
            if (mainAudio.paused) mainAudio.play();
            else mainAudio.pause();
            iconPlay.style.display = mainAudio.paused ? 'block' : 'none';
            iconPause.style.display = mainAudio.paused ? 'none' : 'block';
        } else {
            if (!ytPlayer || !ytPlayer.getPlayerState) return;
            const state = ytPlayer.getPlayerState();
            if (state === YT.PlayerState.PLAYING) {
                ytPlayer.pauseVideo();
            } else {
                ytPlayer.playVideo();
            }
        }
    });

    btnNext.addEventListener('click', () => { if (currentPlayingIndex + 1 < currentPlaylist.length) playTrack(currentPlayingIndex + 1); });
    btnPrev.addEventListener('click', () => { if (currentPlayingIndex > 0) playTrack(currentPlayingIndex - 1); });

    if (btnFav) {
        btnFav.addEventListener('click', async () => {
            if (currentPlayingIndex >= 0 && currentPlayingIndex < currentPlaylist.length) {
                const video = currentPlaylist[currentPlayingIndex];
                if (typeof window.toggleFavorite === 'function') {
                    await window.toggleFavorite(video);
                    const isFav = (function(){ try { return JSON.parse(localStorage.getItem('tzFavs') || '[]').some(v => v.id === video.id); } catch { return false; } })();
                    btnFav.style.color = isFav ? 'var(--primary)' : '';
                }
            }
        });
    }

    progressSlider.addEventListener('input', () => {
        const val = progressSlider.value;
        if (activeEngine === 'audio') {
            mainAudio.currentTime = val;
        } else if (ytPlayer && ytPlayer.seekTo) {
            ytPlayer.seekTo(val);
        }
    });

    function startProgressTimer() {
        stopProgressTimer();
        progressTimer = setInterval(() => {
            let currentTime = 0, duration = 0;
            if (activeEngine === 'audio') {
                currentTime = mainAudio.currentTime;
                duration = mainAudio.duration;
            } else if (ytPlayer && ytPlayer.getCurrentTime) {
                currentTime = ytPlayer.getCurrentTime();
                duration = ytPlayer.getDuration();
            }
            if (duration > 0) {
                const p = (currentTime / duration) * 100;
                progressSlider.style.background = `linear-gradient(to right, var(--primary) ${p}%, rgba(255,255,255,0.1) ${p}%)`;
                progressSlider.value = currentTime;
                progressSlider.max = duration;
                timeCurrent.textContent = formatTime(currentTime);
                timeTotal.textContent = formatTime(duration);
            }
        }, 500);
    }

    /* ── VOLUME CONTROL ── */
    const volSlider = document.getElementById('volume-slider');
    const volBtn    = document.getElementById('vol-btn');
    const iconVolUp   = document.getElementById('icon-vol-up');
    const iconVolMute = document.getElementById('icon-vol-mute');

    function updateVolUI() {
        if (!ytPlayer || !ytPlayer.getVolume) return;
        const vol = ytPlayer.getVolume();
        const muted = ytPlayer.isMuted();
        const pct = muted ? 0 : vol;
        
        if (volSlider) {
            volSlider.value = muted ? 0 : vol / 100;
            volSlider.style.background = `linear-gradient(to right, var(--primary) ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
        }
        iconVolUp.style.display = (muted || vol === 0) ? 'none' : '';
        iconVolMute.style.display = (muted || vol === 0) ? '' : 'none';
    }

    if (volSlider) {
        volSlider.addEventListener('input', () => {
            if (ytPlayer && ytPlayer.setVolume) {
                const v = parseFloat(volSlider.value) * 100;
                ytPlayer.setVolume(v);
                if (ytPlayer.isMuted() && v > 0) ytPlayer.unMute();
                updateVolUI();
            }
        });
    }

    if (volBtn) {
        volBtn.addEventListener('click', () => {
            if (ytPlayer && ytPlayer.isMuted) {
                if (ytPlayer.isMuted()) ytPlayer.unMute();
                else ytPlayer.mute();
                updateVolUI();
            }
        });
    }

    /* ── TRENDING SECTION (auto-carga al abrir la página) ── */
    /* ── TRENDING SECTION (auto-carga al abrir la página) ── */
    async function loadTrendingSection() {
        const trendingGrid   = document.getElementById('trending-grid');
        const trendingLoader = document.getElementById('trending-loader');
        const loadMoreBtn    = document.getElementById('load-more-trending-btn');
        if (!trendingGrid) return;

        let allTrendingItems = [];
        let visibleCount = 8;

        function renderTrendingGrid() {
            trendingGrid.innerHTML = '';
            const itemsToShow = allTrendingItems.slice(0, visibleCount);
            
            itemsToShow.forEach((track, index) => {
                const card = document.createElement('div');
                card.className = 'card';
                card.dataset.id = track.id;
                card.innerHTML = `
                    <div class="card-img-wrapper">
                        <img src="${track.thumbnail || ''}" alt="" class="card-img" loading="lazy">
                        <button class="play-btn" title="Reproducir">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                    </div>
                    <div class="card-info" style="flex:1;min-width:0;padding:0;">
                        <div class="card-title" style="font-size:1.1rem;">
                            <span style="color:var(--primary);margin-right:5px;font-weight:bold;">${index + 1}</span> 
                            ${track.title}
                        </div>
                        <div class="card-channel">${track.channel}</div>
                    </div>
                    <button class="play-btn-circle" style="background:transparent;border:none;color:#fff;cursor:pointer;flex-shrink:0;transition:transform 0.2s;">
                        <svg viewBox="0 0 24 24" width="28" height="28" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                    <button class="menu-btn" style="background:transparent;border:none;color:var(--txt-muted);cursor:pointer;flex-shrink:0;">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                    </button>
                `;
                
                const playFn = (e) => {
                    e.stopPropagation();
                    currentPlaylist = [...allTrendingItems];
                    playTrack(index);
                };

                card.querySelector('.play-btn').addEventListener('click', playFn);
                card.querySelector('.play-btn-circle').addEventListener('click', playFn);
                card.addEventListener('click', () => { 
                    currentPlaylist = [...allTrendingItems];
                    toggleSelection(card, track.id); 
                });
                
                trendingGrid.appendChild(card);
            });
            
            currentTrendingList = [...allTrendingItems];
            
            if (loadMoreBtn) {
                if (visibleCount >= allTrendingItems.length) {
                    loadMoreBtn.style.display = 'none';
                } else {
                    loadMoreBtn.style.display = 'inline-block';
                }
            }
        }

        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                visibleCount += 8;
                renderTrendingGrid();
            });
        }

        try {
            // Cargar top 32 para tener suficientes para paginar
            const res = await fetch('/api/search?q=Top+50+canciones+mas+escuchadas+Ecuador+2026&limit=32');
            const data = await res.json();
            
            if (trendingLoader) trendingLoader.style.display = 'none';

            if (data.results && data.results.length > 0) {
                // Filtrar duplicados
                const uniqueResults = [];
                const seenIds = new Set();
                data.results.forEach(item => {
                    if (!seenIds.has(item.id)) {
                        seenIds.add(item.id);
                        uniqueResults.push(item);
                    }
                });

                allTrendingItems = uniqueResults.map(item => ({
                    id: item.id,
                    title: item.title,
                    channel: item.channel || item.artist || 'Artista Desconocido',
                    thumbnail: item.thumbnail
                }));

                renderTrendingGrid();
                trendingGrid.style.display = 'grid';
            }
        } catch (e) {
            if (trendingLoader) trendingLoader.style.display = 'none';
            console.log('Trending section error:', e);
        }
    }


    /* ── LOAD TRENDING HERO CARDS ── */
    async function loadTrending() {
        try {
            const res = await fetch('/api/trending');
            if (!res.ok) return;
            const data = await res.json();
            if (!data.trending || !data.trending.length) return;

            data.trending.slice(0, 3).forEach((track, i) => {
                const card = document.getElementById(`fc-${i}`);
                if (!card) return;

                // Update art
                const art = card.querySelector('.fc-art');
                if (art) {
                    if (track.thumbnail) {
                        art.innerHTML = `<img src="${track.thumbnail}" alt="">`;
                        art.classList.remove('fc-skeleton');
                    } else {
                        art.textContent = '🎵';
                        art.classList.remove('fc-skeleton');
                        art.style.background = 'linear-gradient(135deg,var(--a1),var(--a2))';
                    }
                }

                // Update text
                const fcText = card.querySelector('.fc-text');
                if (fcText) {
                    const shortTitle = track.title.length > 28 ? track.title.substring(0, 28) + '…' : track.title;
                    fcText.innerHTML = `<b>${shortTitle}</b><small>${track.channel}</small>`;
                }

                // Make clickable → play
                card.addEventListener('click', () => {
                    currentPlaylist = [track];
                    playTrack(0);
                });
            });
        } catch (e) {
            console.log('Trending no disponible:', e);
        }
    }

    /* ── HISTORY (localStorage + API Sync) ── */
    function getHistory() { try { return JSON.parse(localStorage.getItem('tzHistory') || '[]'); } catch { return []; } }
    function saveHistory(h) { localStorage.setItem('tzHistory', JSON.stringify(h)); }
    
    window.addToHistory = async function(video) {
        if (currentUser) {
            try {
                await fetch('/api/user/history/add', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(video)
                });
            } catch (e) { console.log('Error syncing history:', e); }
        }
        let h = getHistory().filter(v => v.id !== video.id);
        h.unshift({ id: video.id, title: video.title, channel: video.channel, thumbnail: video.thumbnail });
        if (h.length > 20) h = h.slice(0, 20);
        saveHistory(h);
        renderHistory();

        // Lógica de Feedback tras 10 canciones
        let playCount = parseInt(localStorage.getItem('tzPlayCount') || '0');
        playCount++;
        localStorage.setItem('tzPlayCount', playCount);
        
        if (playCount === 10 && localStorage.getItem('tzFeedbackShown') !== 'true') {
            setTimeout(() => {
                if (typeof window.openFeedbackModal === 'function') {
                    window.openFeedbackModal();
                    localStorage.setItem('tzFeedbackShown', 'true');
                }
            }, 3000);
        }
    }

    window.renderHistory = async function() {
        const list = document.getElementById('history-list');
        let h = [];
        
        if (currentUser) {
            try {
                const res = await fetch('/api/user/history');
                if (res.ok) h = await res.json();
            } catch (e) { console.log('Error fetching history:', e); h = getHistory(); }
        } else {
            h = getHistory();
        }
        
        if (!h.length) {
            list.innerHTML = '<div class="empty-state"><span>🎵</span><p>Aún no has reproducido nada.<br>¡Busca una canción!</p></div>';
            return;
        }
        list.innerHTML = h.slice(0, 20).map(v => `
            <div class="card track-item" data-id="${v.id}" data-title="${v.title}" data-channel="${v.channel}" data-thumb="${v.thumbnail}">
                <div class="card-img-wrapper">
                    ${v.thumbnail ? `<img class="card-img" src="${v.thumbnail}" alt="" loading="lazy">` : `<div class="card-img" style="background:var(--bg-card);display:flex;align-items:center;justify-content:center;">🎵</div>`}
                </div>
                <div class="card-info">
                    <div class="card-title">${v.title}</div>
                    <div class="card-channel">${v.channel}</div>
                </div>
                <button class="play-btn-circle track-play-btn" title="Reproducir">
                    <svg viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
            </div>`).join('');

        list.querySelectorAll('.track-item').forEach(item => {
            item.querySelector('.track-play-btn').addEventListener('click', e => {
                e.stopPropagation();
                const v = { id: item.dataset.id, title: item.dataset.title, channel: item.dataset.channel, thumbnail: item.dataset.thumb };
                currentPlaylist = [v]; playTrack(0);
            });
        });
    }

    document.getElementById('clear-history-btn').addEventListener('click', async () => {
        if (currentUser) {
            await fetch('/api/user/history/clear', { method: 'POST' });
        }
        localStorage.removeItem('tzHistory'); renderHistory();
    });

    /* ── FAVORITES (localStorage + API Sync) ── */
    function getFavorites() { try { return JSON.parse(localStorage.getItem('tzFavs') || '[]'); } catch { return []; } }
    function saveFavorites(f) { localStorage.setItem('tzFavs', JSON.stringify(f)); }
    function isFavorite(id) { return getFavorites().some(v => v.id === id); }

    window.toggleFavorite = async function(video) {
        if (currentUser) {
            try {
                await fetch('/api/user/favorites/toggle', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(video)
                });
            } catch (e) { console.log('Error syncing favorite:', e); }
        }
        
        let favs = getFavorites();
        if (isFavorite(video.id)) favs = favs.filter(v => v.id !== video.id);
        else favs.unshift({ id: video.id, title: video.title, channel: video.channel, thumbnail: video.thumbnail });
        saveFavorites(favs);
        renderFavorites();
    }

    window.renderFavorites = async function() {
        const list = document.getElementById('favorites-list');
        let favs = [];
        
        if (currentUser) {
            try {
                const res = await fetch('/api/user/favorites');
                if (res.ok) favs = await res.json();
            } catch (e) { console.log('Error fetching favs:', e); favs = getFavorites(); }
        } else {
            favs = getFavorites();
        }
        
        if (!favs.length) {
            list.innerHTML = '<div class="empty-state"><span>❤️</span><p>Pulsa el corazón en<br>cualquier canción.</p></div>';
            return;
        }
        list.innerHTML = favs.slice(0, 20).map(v => `
            <div class="card track-item" data-id="${v.id}" data-title="${v.title}" data-channel="${v.channel}" data-thumb="${v.thumbnail}">
                <div class="card-img-wrapper">
                    ${v.thumbnail ? `<img class="card-img" src="${v.thumbnail}" alt="" loading="lazy">` : `<div class="card-img" style="background:var(--bg-card);display:flex;align-items:center;justify-content:center;">❤️</div>`}
                </div>
                <div class="card-info">
                    <div class="card-title">${v.title}</div>
                    <div class="card-channel">${v.channel}</div>
                </div>
                <button class="play-btn-circle track-play-btn" title="Reproducir">
                    <svg viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
            </div>`).join('');

        list.querySelectorAll('.track-item').forEach(item => {
            item.querySelector('.track-play-btn').addEventListener('click', e => {
                e.stopPropagation();
                const v = { id: item.dataset.id, title: item.dataset.title, channel: item.dataset.channel, thumbnail: item.dataset.thumb };
                currentPlaylist = [v]; playTrack(0);
            });
        });
    }

    document.getElementById('clear-favorites-btn').addEventListener('click', () => {
        // Para favoritos no solemos borrar todo de golpe por seguridad
        localStorage.removeItem('tzFavs'); renderFavorites();
    });

    async function fetchPopularArtists() {
        const row = document.querySelector('.quick-tags-row');
        if (!row) return;

        try {
            const res = await fetch('/api/popular_artists');
            const artists = await res.json();
            if (artists && artists.length > 0) {
                // Mantener el texto inicial
                row.innerHTML = '<span style="color:var(--txt-muted);font-weight:600;margin-right:10px;">Populares:</span>';
                
                artists.forEach(artist => {
                    const btn = document.createElement('button');
                    btn.className = 'qt-tag';
                    btn.textContent = artist;
                    btn.addEventListener('click', () => {
                        const searchInput = document.getElementById('search-input');
                        const searchForm = document.getElementById('search-form');
                        if (searchInput && searchForm) {
                            searchInput.value = artist;
                            // Disparar evento de submit de forma nativa
                            searchForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                            // Scroll a los resultados
                            document.getElementById('search-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    });
                    row.appendChild(btn);
                });
            }
        } catch (e) {
            console.error('Error fetching popular artists:', e);
        }
    }

    /* ── INIT ── */
    try { renderHistory(); } catch (e) { console.error('Error in renderHistory:', e); }
    try { renderFavorites(); } catch (e) { console.error('Error in renderFavorites:', e); }
    try { loadTrendingSection(); } catch (e) { console.error('Error in loadTrendingSection:', e); }
    try { loadTrending(); } catch (e) { console.error('Error in loadTrending:', e); }
    try { fetchPopularArtists(); } catch (e) { console.error('Error in fetchPopularArtists:', e); }

    // Scroll logic for trending
    const scrollLeftBtn = document.querySelector('.scroll-left');
    const scrollRightBtn = document.querySelector('.scroll-right');
    const trendingGrid = document.getElementById('trending-grid');
    if (scrollLeftBtn && scrollRightBtn && trendingGrid) {
        scrollLeftBtn.addEventListener('click', () => {
            trendingGrid.scrollBy({ left: -350, behavior: 'smooth' });
        });
        scrollRightBtn.addEventListener('click', () => {
            trendingGrid.scrollBy({ left: 350, behavior: 'smooth' });
        });
    }

    const INFO_CONTENT = {
        terms: {
            title: "Términos del Servicio",
            body: `<p>Bienvenido a TuZona EC. Al acceder, navegar o utilizar nuestra plataforma, aceptas automáticamente los presentes Términos del Servicio. Si no estás de acuerdo con alguna de las condiciones aquí establecidas, te recomendamos no utilizar el sitio.</p>
<p>TuZona EC es una plataforma diseñada para brindar acceso a contenido musical mediante herramientas, enlaces y servicios compatibles de terceros disponibles públicamente en Internet. Todo el contenido mostrado, reproducido o enlazado pertenece exclusivamente a sus respectivos autores, artistas, productores, discográficas y propietarios de derechos de autor.</p>
<p>El usuario se compromete a utilizar la plataforma de manera legal, ética y responsable, respetando las leyes vigentes de propiedad intelectual y derechos de autor de su país.</p>
<p>Está estrictamente prohibido:</p>
<ul style="margin-left:20px; margin-bottom:15px;">
<li>Utilizar la plataforma para fines ilegales.</li>
<li>Intentar vulnerar la seguridad, servidores o bases de datos del sitio.</li>
<li>Utilizar bots, scripts automáticos o herramientas que afecten el funcionamiento normal de la plataforma.</li>
<li>Distribuir malware, virus o contenido dañino.</li>
<li>Utilizar el servicio para redistribuir contenido protegido sin autorización correspondiente.</li>
</ul>
<p>TuZona EC se reserva el derecho de modificar, suspender o eliminar cualquier funcionalidad, contenido o acceso sin necesidad de previo aviso cuando se detecten actividades sospechosas o incumplimiento de estos términos.</p>
<p>No garantizamos disponibilidad permanente e ininterrumpida del servicio, ya que algunas funciones dependen de plataformas externas y servicios de terceros.</p>
<p>El usuario entiende y acepta que utiliza la plataforma bajo su propia responsabilidad.</p>`
        },
        privacy: {
            title: "Políticas de Privacidad",
            body: `<p>En TuZona EC, valoramos y respetamos la privacidad de todos nuestros usuarios. Nuestro compromiso es proteger la información recopilada y utilizarla únicamente para mejorar el funcionamiento y la experiencia dentro de la plataforma.</p>
<p>La información que podemos recopilar incluye:</p>
<ul style="margin-left:20px; margin-bottom:15px;">
<li>Dirección IP</li>
<li>Navegador utilizado</li>
<li>Tipo de dispositivo</li>
<li>Sistema operativo</li>
<li>Correo electrónico (en caso de registro)</li>
<li>Información básica de navegación dentro del sitio</li>
<li>Datos técnicos relacionados con el rendimiento y seguridad</li>
</ul>
<p>Esta información puede utilizarse para:</p>
<ul style="margin-left:20px; margin-bottom:15px;">
<li>Mejorar la estabilidad y funcionamiento del servicio</li>
<li>Optimizar la experiencia del usuario</li>
<li>Detectar actividades sospechosas o fraudulentas</li>
<li>Brindar soporte técnico</li>
<li>Mantener la seguridad de la plataforma</li>
<li>Generar estadísticas internas de uso</li>
</ul>
<p>TuZona EC no vende, alquila ni comparte información personal con terceros con fines comerciales.</p>
<p>Sin embargo, la información podrá ser revelada únicamente en los siguientes casos:</p>
<ul style="margin-left:20px; margin-bottom:15px;">
<li>Cuando sea requerida por autoridades legales competentes.</li>
<li>Para proteger la seguridad e integridad del sitio.</li>
<li>Para prevenir fraudes, ataques o actividades ilegales.</li>
</ul>
<p>La plataforma puede utilizar cookies y tecnologías similares para recordar preferencias, mejorar la navegación y analizar el tráfico del sitio.</p>
<p>El usuario puede desactivar las cookies desde la configuración de su navegador, aunque algunas funciones podrían verse limitadas.</p>
<p>Al utilizar TuZona EC, aceptas automáticamente estas políticas de privacidad.</p>`
        },
        dmca: {
            title: "Políticas DMCA",
            body: `<p>TuZona EC respeta completamente los derechos de autor y las leyes internacionales relacionadas con propiedad intelectual, incluyendo la Digital Millennium Copyright Act (DMCA).</p>
<p>Nuestra plataforma no almacena archivos musicales protegidos en sus propios servidores. El contenido accesible mediante TuZona EC puede provenir de servicios externos, enlaces públicos o plataformas de terceros disponibles en Internet.</p>
<p>Si eres propietario de derechos de autor o representante autorizado y consideras que algún contenido accesible desde TuZona EC infringe tus derechos, puedes enviar una notificación formal incluyendo la siguiente información:</p>
<ul style="margin-left:20px; margin-bottom:15px;">
<li>Nombre completo del titular de los derechos.</li>
<li>Documento o prueba válida de titularidad.</li>
<li>Descripción detallada del contenido afectado.</li>
<li>URL exacta o enlace específico del contenido reportado.</li>
<li>Información de contacto válida.</li>
<li>Declaración de buena fe indicando que el uso reportado no está autorizado.</li>
</ul>
<p>Una vez recibida y verificada la solicitud, TuZona EC podrá:</p>
<ul style="margin-left:20px; margin-bottom:15px;">
<li>Eliminar el acceso al contenido reportado.</li>
<li>Restringir determinadas funciones relacionadas.</li>
<li>Suspender usuarios involucrados en infracciones reiteradas.</li>
</ul>
<p>Las solicitudes falsas, engañosas o malintencionadas podrán ser rechazadas.</p>
<p>Contacto DMCA:<br><strong>gabrielmero230195@gmail.com</strong></p>`
        },
        support: {
            title: "Soporte Técnico",
            body: `<p>El equipo de soporte técnico de TuZona EC está disponible para ayudar a los usuarios ante cualquier inconveniente relacionado con el funcionamiento de la plataforma.</p>
<p>Puedes contactarnos por problemas como:</p>
<ul style="margin-left:20px; margin-bottom:15px;">
<li>Errores de reproducción.</li>
<li>Fallos de descarga.</li>
<li>Problemas de acceso o registro.</li>
<li>Recuperación de cuenta.</li>
<li>Errores del sistema.</li>
<li>Reportes de contenido.</li>
<li>Problemas técnicos generales.</li>
</ul>
<p>Canales oficiales de soporte:</p>
<ul style="margin-left:20px; margin-bottom:15px;">
<li>Correo electrónico: <strong>gabrielmero230195@gmail.com</strong></li>
<li>Página de contacto: <strong>En desarrollo</strong></li>
</ul>
<p>Horario de atención:<br>Lunes a Viernes — 09:00 a 18:00</p>
<p>Tiempo estimado de respuesta:<br>Entre 24 y 72 horas hábiles dependiendo del volumen de solicitudes.</p>
<p>El equipo de TuZona EC trabajará continuamente para mejorar la estabilidad, seguridad y experiencia de la plataforma.</p>
<p><strong>Gracias por confiar en TuZona EC.</strong></p>`
        }
    };

    window.openInfoModal = function(type) {
        const modal = document.getElementById('info-modal');
        const titleEl = document.getElementById('info-modal-title');
        const bodyEl = document.getElementById('info-modal-body');
        if(modal && INFO_CONTENT[type]) {
            titleEl.textContent = INFO_CONTENT[type].title;
            bodyEl.innerHTML = INFO_CONTENT[type].body;
            modal.classList.add('active');
        }
    };

    window.closeInfoModal = function() {
        const modal = document.getElementById('info-modal');
        if(modal) modal.classList.remove('active');
    };

    /* FEEDBACK LOGIC */
    let currentRating = 0;
    const stars = document.querySelectorAll('#star-rating span');
    
    stars.forEach(star => {
        star.addEventListener('mouseover', function() {
            const val = this.getAttribute('data-val');
            stars.forEach(s => {
                if(s.getAttribute('data-val') <= val) {
                    s.classList.add('hover-active');
                } else {
                    s.classList.remove('hover-active');
                }
            });
        });
        
        star.addEventListener('mouseout', function() {
            stars.forEach(s => s.classList.remove('hover-active'));
        });
        
        star.addEventListener('click', function() {
            currentRating = parseInt(this.getAttribute('data-val'));
            stars.forEach(s => {
                if(s.getAttribute('data-val') <= currentRating) {
                    s.classList.add('active');
                } else {
                    s.classList.remove('active');
                }
            });
        });
    });

    window.openFeedbackModal = function() {
        if (!currentUser) {
            showNotification('Inicia sesión para enviar comentarios.', true);
            return;
        }
        document.getElementById('feedback-modal').classList.add('active');
    };

    window.closeFeedbackModal = function() {
        document.getElementById('feedback-modal').classList.remove('active');
    };

    window.submitFeedback = async function() {
        if (currentRating === 0) {
            showNotification('Por favor, selecciona una calificación (estrellas).', true);
            return;
        }
        
        const comment = document.getElementById('feedback-comment').value.trim();
        const btn = document.getElementById('btn-submit-feedback');
        btn.innerHTML = 'Enviando...';
        btn.disabled = true;
        
        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating: currentRating, comment: comment })
            });
            const data = await res.json();
            
            if (res.ok) {
                closeFeedbackModal();
                showNotification(data.message);
                // reset
                currentRating = 0;
                stars.forEach(s => s.classList.remove('active'));
                document.getElementById('feedback-comment').value = '';
            } else {
                showNotification(data.error || 'Error al enviar feedback', true);
            }
        } catch(e) {
            showNotification('Error de conexión', true);
        } finally {
            btn.innerHTML = 'Enviar Comentarios';
            btn.disabled = false;
        }
    };

    /* ADMIN TABS LOGIC */
    window.switchAdminTab = function(tabName) {
        document.querySelectorAll('.admin-tab').forEach(t => {
            t.classList.remove('active');
            t.style.color = 'var(--txt-muted)';
        });
        document.querySelectorAll('.admin-table-container').forEach(c => c.classList.add('hidden'));
        
        const activeTab = document.getElementById('admin-tab-' + tabName);
        if(activeTab) {
            activeTab.classList.add('active');
            activeTab.style.color = 'var(--primary)';
        }
        
        const activeSec = document.getElementById('admin-section-' + tabName);
        if(activeSec) {
            activeSec.classList.remove('hidden');
        }

        if (tabName === 'feedback') {
            window.fetchAdminFeedback();
        }
    };

    /* ── PLAYLISTS ──────────────────────────────────────── */

    window.renderPlaylists = async function() {
        const grid = document.getElementById('playlists-grid');
        const detail = document.getElementById('playlist-detail');
        if (!grid) return;
        detail.style.display = 'none';
        grid.style.display = 'grid';

        try {
            const res = await fetch('/api/user/playlists');
            if (!res.ok) {
                grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><span>🔒</span><p>Inicia sesión para ver tus listas.</p></div>';
                return;
            }
            const playlists = await res.json();
            if (!playlists.length) {
                grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><span>🎶</span><p>Aún no tienes listas.<br>¡Crea tu primera playlist!</p></div>';
                return;
            }
            grid.innerHTML = playlists.map(p => `
                <div class="playlist-card" onclick="window.openPlaylistDetail(${p.id})" style="cursor:pointer; background:var(--a1); border-radius:16px; overflow:hidden; transition: transform 0.2s, box-shadow 0.2s; border: 1px solid var(--a2);">
                    <div style="width:100%; aspect-ratio:1; background: ${p.cover ? `url(${p.cover}) center/cover` : 'linear-gradient(135deg, var(--primary), #3b82f6)'}; display:flex; align-items:center; justify-content:center;">
                        ${!p.cover ? '<span style="font-size:3rem;">🎵</span>' : ''}
                    </div>
                    <div style="padding:12px;">
                        <h4 style="margin:0; font-size:0.95rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name}</h4>
                        <p style="margin:4px 0 0; font-size:0.8rem; color:var(--txt-muted);">${p.song_count} cancion${p.song_count !== 1 ? 'es' : ''}</p>
                    </div>
                    <button onclick="event.stopPropagation(); window.deletePlaylist(${p.id}, '${p.name.replace(/'/g, "\\'")}')" 
                        style="position:absolute; top:8px; right:8px; background:rgba(0,0,0,0.6); border:none; color:#ef4444; border-radius:50%; width:28px; height:28px; cursor:pointer; font-size:0.8rem; display:flex; align-items:center; justify-content:center;" title="Eliminar lista">✕</button>
                </div>
            `).join('');
            // Make cards have position:relative for the delete button
            grid.querySelectorAll('.playlist-card').forEach(c => c.style.position = 'relative');
        } catch(e) { console.error('Error loading playlists:', e); }
    };

    window.openPlaylistDetail = async function(playlistId) {
        const grid = document.getElementById('playlists-grid');
        const detail = document.getElementById('playlist-detail');
        const nameEl = document.getElementById('playlist-detail-name');
        const songsEl = document.getElementById('playlist-songs-list');
        
        grid.style.display = 'none';
        detail.style.display = 'block';
        songsEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="spinner"></div><p>Cargando...</p></div>';

        try {
            const res = await fetch(`/api/user/playlists/${playlistId}/songs`);
            const data = await res.json();
            nameEl.textContent = data.name;
            window._currentPlaylistId = playlistId;
            window._currentPlaylistSongs = data.songs;

            if (!data.songs.length) {
                songsEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><span>🎵</span><p>Esta lista está vacía.<br>Agrega canciones desde la búsqueda.</p></div>';
                return;
            }

            songsEl.innerHTML = '';
            data.songs.forEach((s, index) => {
                const card = document.createElement('div');
                card.className = 'card';
                card.innerHTML = `
                    <div class="card-img-wrapper">
                        <img src="${s.thumbnail || ''}" alt="" class="card-img" loading="lazy">
                        <button class="play-btn" title="Reproducir">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                    </div>
                    <div class="card-info" style="flex:1;min-width:0;padding:0;">
                        <div class="card-title" style="font-size:1.1rem;">
                            <span style="color:var(--primary);margin-right:5px;font-weight:bold;">${index + 1}</span> 
                            ${s.title}
                        </div>
                        <div class="card-channel">${s.channel}</div>
                    </div>
                    <button class="play-btn-circle" style="background:transparent;border:none;color:#fff;cursor:pointer;flex-shrink:0;transition:transform 0.2s;">
                        <svg viewBox="0 0 24 24" width="28" height="28" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                    <button class="remove-from-pl" style="background:transparent;border:none;color:#ef4444;cursor:pointer;flex-shrink:0;" title="Quitar de la lista">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                `;

                const playFn = (e) => {
                    e.stopPropagation();
                    // Cargar TODAS las canciones de la lista en el reproductor
                    currentPlaylist = data.songs.map(song => ({id: song.id, title: song.title, channel: song.channel, thumbnail: song.thumbnail}));
                    playTrack(index);
                };

                card.querySelector('.play-btn').addEventListener('click', playFn);
                card.querySelector('.play-btn-circle').addEventListener('click', playFn);
                card.querySelector('.remove-from-pl').addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.removeSongFromPlaylist(playlistId, s.id);
                });
                card.addEventListener('click', playFn);

                songsEl.appendChild(card);
            });
        } catch(e) { console.error('Error loading playlist songs:', e); }
    };

    window.deletePlaylist = async function(id, name) {
        if (!confirm(`¿Eliminar la lista "${name}" y todas sus canciones?`)) return;
        try {
            const res = await fetch(`/api/user/playlists/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.error) showNotification(data.error, true);
            else { showNotification(data.message); window.renderPlaylists(); }
        } catch(e) { showNotification('Error al eliminar la lista', true); }
    };

    window.removeSongFromPlaylist = async function(playlistId, videoId) {
        try {
            const res = await fetch(`/api/user/playlists/${playlistId}/songs/${videoId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.error) showNotification(data.error, true);
            else { showNotification(data.message); window.openPlaylistDetail(playlistId); }
        } catch(e) { showNotification('Error al quitar cancion', true); }
    };

    // Crear lista
    const createBtn = document.getElementById('create-playlist-btn');
    if (createBtn) {
        createBtn.addEventListener('click', async () => {
            const name = prompt('Nombre de la nueva lista (ej: Bachatas, Salsa, Reggaeton):');
            if (!name || !name.trim()) return;
            try {
                const res = await fetch('/api/user/playlists', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name.trim() })
                });
                const data = await res.json();
                if (data.error) showNotification(data.error, true);
                else { showNotification(data.message); window.renderPlaylists(); }
            } catch(e) { showNotification('Error al crear la lista', true); }
        });
    }

    // Botón volver
    const backBtn = document.getElementById('playlist-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => window.renderPlaylists());

    // Reproducir toda la lista
    const playAllBtn = document.getElementById('playlist-play-all-btn');
    if (playAllBtn) {
        playAllBtn.addEventListener('click', () => {
            const songs = window._currentPlaylistSongs;
            if (!songs || !songs.length) { showNotification('La lista est\u00e1 vac\u00eda', true); return; }
            // Cargar TODAS en el reproductor para que siguiente/anterior funcione
            currentPlaylist = songs.map(s => ({id: s.id, title: s.title, channel: s.channel, thumbnail: s.thumbnail}));
            playTrack(0);
            showNotification(`Reproduciendo ${songs.length} canciones`);
        });
    }

    // Función global para mostrar dropdown "Agregar a lista" en cualquier canción
    window.showAddToPlaylist = async function(videoId, title, channel, thumbnail, buttonEl) {
        // Cerrar cualquier dropdown existente
        document.querySelectorAll('.playlist-dropdown').forEach(d => d.remove());

        try {
            const res = await fetch('/api/user/playlists');
            if (!res.ok) { showNotification('Inicia sesión para usar listas', true); return; }
            const playlists = await res.json();

            const dropdown = document.createElement('div');
            dropdown.className = 'playlist-dropdown';
            dropdown.style.cssText = 'position:fixed; z-index:5000; background:var(--a1); border:1px solid var(--a2); border-radius:12px; padding:8px 0; min-width:200px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); max-height:300px; overflow-y:auto;';

            let html = '<div style="padding:8px 16px; color:var(--txt-muted); font-size:0.8rem; border-bottom:1px solid var(--a2); margin-bottom:4px;">Agregar a lista:</div>';
            if (playlists.length === 0) {
                html += '<div style="padding:12px 16px; color:var(--txt-muted); font-size:0.85rem;">No tienes listas aún.</div>';
            } else {
                playlists.forEach(p => {
                    html += `<div class="playlist-dropdown-item" data-id="${p.id}" style="padding:10px 16px; cursor:pointer; transition:background 0.2s; font-size:0.9rem;"
                        onmouseover="this.style.background='var(--a2)'" onmouseout="this.style.background='transparent'">
                        🎵 ${p.name} <span style="color:var(--txt-muted); font-size:0.75rem;">(${p.song_count})</span>
                    </div>`;
                });
            }
            html += `<div style="border-top:1px solid var(--a2); margin-top:4px; padding:10px 16px; cursor:pointer; color:var(--primary); font-weight:600; font-size:0.9rem;" 
                onmouseover="this.style.background='var(--a2)'" onmouseout="this.style.background='transparent'"
                onclick="document.querySelectorAll('.playlist-dropdown').forEach(d=>d.remove()); document.getElementById('create-playlist-btn').click();">
                + Crear nueva lista
            </div>`;
            dropdown.innerHTML = html;

            // Posicionar
            const rect = buttonEl.getBoundingClientRect();
            dropdown.style.top = (rect.bottom + 4) + 'px';
            dropdown.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 220)) + 'px';
            document.body.appendChild(dropdown);

            // Click en items
            dropdown.querySelectorAll('.playlist-dropdown-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const playlistId = item.dataset.id;
                    try {
                        const addRes = await fetch(`/api/user/playlists/${playlistId}/songs`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: videoId, title, channel, thumbnail })
                        });
                        const addData = await addRes.json();
                        if (addData.error) showNotification(addData.error, true);
                        else showNotification(addData.message);
                    } catch(e) { showNotification('Error al agregar', true); }
                    dropdown.remove();
                });
            });

            // Cerrar al click afuera
            setTimeout(() => {
                document.addEventListener('click', function closeDropdown(ev) {
                    if (!dropdown.contains(ev.target)) {
                        dropdown.remove();
                        document.removeEventListener('click', closeDropdown);
                    }
                });
            }, 100);
        } catch(e) { showNotification('Error cargando listas', true); }
    };

    // Cargar playlists al inicio si el usuario está logueado
    if (currentUser) window.renderPlaylists();

});
