<script lang="ts">
    import { onMount } from 'svelte';
    import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
    import { auth } from '$lib/firebase';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';

    let user: User | null = null;
    let email = '';
    let password = '';
    let loading = true;
    let error = '';

    onMount(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            user = u;
            loading = false;
        });

        return () => unsubscribe();
    });

    async function handleLogin(e: SubmitEvent) {
        e.preventDefault();
        error = '';
        
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (e) {
            error = 'Geçersiz e-posta adresi veya şifre. Lütfen tekrar deneyin.';
        }
    }

    async function handleSignOut() {
        try {
            await signOut(auth);
            goto('/');
        } catch (e) {
            console.error('Error signing out:', e);
        }
    }
</script>

{#if loading}
    <div class="loading">Yükleniyor...</div>
{:else if !user}
    <div class="login-container">
        <div class="login-box" role="main">
            <h1>Yönetici Girişi</h1>
            
            <form on:submit={handleLogin} aria-label="Yönetici giriş formu">
                {#if error}
                    <div class="error" role="alert" aria-live="polite">{error}</div>
                {/if}
                
                <div class="form-group">
                    <label for="email">E-posta Adresi</label>
                    <input
                        type="email"
                        id="email"
                        bind:value={email}
                        required
                        placeholder="ornek@okul.edu.tr"
                        aria-required="true"
                        autocomplete="email"
                    />
                </div>
                
                <div class="form-group">
                    <label for="password">Şifre</label>
                    <input
                        type="password"
                        id="password"
                        bind:value={password}
                        required
                        placeholder="Şifrenizi giriniz"
                        aria-required="true"
                        autocomplete="current-password"
                    />
                </div>
                
                <button type="submit" class="login-btn" aria-label="Giriş yap">Giriş Yap</button>
            </form>
        </div>
    </div>
{:else}
    <div class="admin-layout">
        <header class="admin-header">
            <div class="header-content">
                <h2>Yönetici Paneli</h2>
                <div class="user-info">
                    <span class="user-email">{user.email}</span>
                    <button on:click={handleSignOut} class="signout-btn">
                        <span class="btn-icon">🚪</span>
                        Çıkış Yap
                    </button>
                </div>
            </div>
        </header>
        
        <div class="admin-body">
            <aside class="admin-sidebar" aria-label="Ana navigasyon menüsü">
                <div class="sidebar-heading">Menü</div>
                <nav class="sidebar-nav">
                    <a 
                        href="/admin" 
                        class="nav-item" 
                        class:active={$page.url.pathname === '/admin'}
                        aria-label="Başvurular sayfasına git"
                        aria-current={$page.url.pathname === '/admin' ? 'page' : undefined}
                    >
                        <span class="nav-icon" aria-hidden="true">📊</span>
                        <span class="nav-label">Başvurular</span>
                    </a>
                    <a 
                        href="/admin/halls" 
                        class="nav-item" 
                        class:active={$page.url.pathname === '/admin/halls'}
                        aria-label="Sınav salonları sayfasına git"
                        aria-current={$page.url.pathname === '/admin/halls' ? 'page' : undefined}
                    >
                        <span class="nav-icon" aria-hidden="true">🏫</span>
                        <span class="nav-label">Sınav Salonları</span>
                    </a>
                    <a 
                        href="/admin/barcodes" 
                        class="nav-item" 
                        class:active={$page.url.pathname === '/admin/barcodes'}
                        aria-label="Konum barkodları sayfasına git"
                        aria-current={$page.url.pathname === '/admin/barcodes' ? 'page' : undefined}
                    >
                        <span class="nav-icon" aria-hidden="true">📍</span>
                        <span class="nav-label">Konum Barkodları</span>
                    </a>
                    <a 
                        href="/admin/notes" 
                        class="nav-item" 
                        class:active={$page.url.pathname === '/admin/notes'}
                        aria-label="Sınav notları sayfasına git"
                        aria-current={$page.url.pathname === '/admin/notes' ? 'page' : undefined}
                    >
                        <span class="nav-icon" aria-hidden="true">📝</span>
                        <span class="nav-label">Sınav Notları</span>
                    </a>
                    <a 
                        href="/admin/events" 
                        class="nav-item" 
                        class:active={$page.url.pathname === '/admin/events'}
                        aria-label="Etkinlikler sayfasına git"
                        aria-current={$page.url.pathname === '/admin/events' ? 'page' : undefined}
                    >
                        <span class="nav-icon" aria-hidden="true">📅</span>
                        <span class="nav-label">Etkinlikler</span>
                    </a>
                    <a 
                        href="/admin/settings" 
                        class="nav-item" 
                        class:active={$page.url.pathname === '/admin/settings'}
                        aria-label="Sistem ayarları sayfasına git"
                        aria-current={$page.url.pathname === '/admin/settings' ? 'page' : undefined}
                    >
                        <span class="nav-icon" aria-hidden="true">⚙️</span>
                        <span class="nav-label">Sistem Ayarları</span>
                    </a>
                </nav>
            </aside>
            
            <main class="admin-content">
                <slot />
            </main>
        </div>
    </div>
{/if}

<style>
    .loading {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        font-size: 1.2rem;
        color: #666;
    }

    .login-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        background: #f5f5f5;
    }

    .login-box {
        background: white;
        padding: 2rem;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        width: 100%;
        max-width: 400px;
    }

    .form-group {
        margin-bottom: 1.5rem;
    }

    label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: #333;
    }

    input {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 1rem;
    }

    input:focus {
        outline: none;
        border-color: #14b8a6;
        box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.2);
    }

    .login-btn {
        width: 100%;
        padding: 0.75rem;
        background: #0d9488;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    .login-btn:hover {
        background: #0f766e;
    }

    .error {
        background: #ffebee;
        color: #c62828;
        padding: 0.75rem;
        border-radius: 4px;
        margin-bottom: 1rem;
    }

    h1 {
        text-align: center;
        margin-bottom: 2rem;
        color: #333;
    }

    .admin-layout {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background: #f5f7fa;
    }

    .admin-header {
        background: linear-gradient(135deg, #0d9488 0%, #115e59 100%);
        color: white;
        padding: 1rem 2rem;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        position: sticky;
        top: 0;
        z-index: 1000;
    }

    .header-content {
        max-width: 1600px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .header-content h2 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 600;
    }

    .user-info {
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .user-email {
        font-size: 0.9rem;
        opacity: 0.9;
    }

    .signout-btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: rgba(255, 255, 255, 0.2);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 6px;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }

    .signout-btn:hover {
        background: rgba(255, 255, 255, 0.3);
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .signout-btn .btn-icon {
        font-size: 1.1rem;
    }

    .admin-body {
        display: flex;
        flex: 1;
        max-width: 1600px;
        margin: 0 auto;
        width: 100%;
    }

    .admin-sidebar {
        width: 250px;
        background: white;
        padding: 1.5rem 0;
        box-shadow: 2px 0 8px rgba(0, 0, 0, 0.05);
        position: sticky;
        top: 73px;
        height: calc(100vh - 73px);
        overflow-y: auto;
    }

    .sidebar-heading {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        color: #a0aec0;
        padding: 0 1.5rem 0.75rem;
        margin-bottom: 0.25rem;
        border-bottom: 1px solid #f0f4f8;
    }

    .sidebar-nav {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.75rem 1rem 0;
    }

    .nav-item {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.875rem 1rem;
        border-radius: 8px;
        text-decoration: none;
        color: #4a5568;
        font-weight: 500;
        transition: all 0.2s ease;
        cursor: pointer;
    }

    .nav-item:hover {
        background: #f7fafc;
        color: #2d3748;
        transform: translateX(4px);
    }

    .nav-item.active {
        background: linear-gradient(135deg, #0d9488 0%, #115e59 100%);
        color: white;
        box-shadow: 0 2px 8px rgba(13, 148, 136, 0.3);
    }

    .nav-icon {
        font-size: 1.25rem;
        line-height: 1;
    }

    .nav-label {
        font-size: 0.95rem;
    }

    .admin-content {
        flex: 1;
        padding: 0;
        overflow-x: hidden;
    }

    @media (max-width: 768px) {
        .admin-body {
            flex-direction: column;
        }

        .admin-sidebar {
            width: 100%;
            height: auto;
            position: static;
            padding: 1rem 0;
        }

        .sidebar-nav {
            flex-direction: row;
            overflow-x: auto;
            padding: 0 1rem;
        }

        .nav-item {
            flex-shrink: 0;
            min-width: 120px;
            justify-content: center;
            padding: 0.75rem 1rem;
        }

        .nav-label {
            font-size: 0.85rem;
        }

        .nav-icon {
            font-size: 1.1rem;
        }
    }
</style> 