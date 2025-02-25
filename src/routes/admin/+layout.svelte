<script lang="ts">
    import { onMount } from 'svelte';
    import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, type User } from 'firebase/auth';
    import { goto } from '$app/navigation';

    let user: User | null = null;
    let email = '';
    let password = '';
    let loading = true;
    let error = '';

    onMount(() => {
        const auth = getAuth();
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
            const auth = getAuth();
            await signInWithEmailAndPassword(auth, email, password);
        } catch (e) {
            error = 'Invalid email or password';
        }
    }
</script>

{#if loading}
    <div class="loading">Yükleniyor...</div>
{:else if !user}
    <div class="login-container">
        <div class="login-box">
            <h1>Yönetici Girişi</h1>
            
            <form on:submit={handleLogin}>
                {#if error}
                    <div class="error">{error}</div>
                {/if}
                
                <div class="form-group">
                    <label for="email">Email</label>
                    <input
                        type="email"
                        id="email"
                        bind:value={email}
                        required
                        placeholder="Yönetici emailinizi giriniz"
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
                    />
                </div>
                
                <button type="submit" class="login-btn">Giriş Yap</button>
            </form>
        </div>
    </div>
{:else}
    <slot />
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
        border-color: #4A90E2;
        box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
    }

    .login-btn {
        width: 100%;
        padding: 0.75rem;
        background: #4A90E2;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    .login-btn:hover {
        background: #357ABD;
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
</style> 