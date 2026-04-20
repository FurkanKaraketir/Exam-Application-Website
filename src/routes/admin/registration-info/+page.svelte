<script lang="ts">
    import { db } from '$lib/firebase';
    import { doc, getDoc, setDoc } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import { fade, fly } from 'svelte/transition';

    let asilText = '';
    let yedekText = '';
    let loading = false;
    let saving = false;

    type NotificationType = 'success' | 'error' | 'warning';
    type Notification = { id: number; type: NotificationType; message: string };
    let notifications: Notification[] = [];
    let notificationId = 0;

    function showNotification(message: string, type: NotificationType = 'success') {
        const id = ++notificationId;
        notifications = [...notifications, { id, type, message }];
        setTimeout(() => { notifications = notifications.filter(n => n.id !== id); }, 5000);
    }

    function removeNotification(id: number) {
        notifications = notifications.filter(n => n.id !== id);
    }

    onMount(async () => {
        await loadRegistrationInfo();
    });

    async function loadRegistrationInfo() {
        try {
            loading = true;
            const ref = doc(db, 'general', 'registrationInfo');
            const snap = await getDoc(ref);
            if (snap.exists()) {
                const data = snap.data();
                asilText = data.asilText || defaultAsilText;
                yedekText = data.yedekText || defaultYedekText;
            } else {
                asilText = defaultAsilText;
                yedekText = defaultYedekText;
            }
        } catch (e) {
            showNotification('Kayıt bilgileri yüklenirken hata oluştu.', 'error');
        } finally {
            loading = false;
        }
    }

    async function saveRegistrationInfo() {
        if (!asilText.trim() || !yedekText.trim()) {
            showNotification('Her iki alan da dolu olmalıdır.', 'error');
            return;
        }
        try {
            saving = true;
            const ref = doc(db, 'general', 'registrationInfo');
            await setDoc(ref, {
                asilText: asilText.trim(),
                yedekText: yedekText.trim(),
                lastUpdated: new Date()
            });
            showNotification('Kayıt bilgileri başarıyla kaydedildi.', 'success');
        } catch (e) {
            showNotification('Kayıt bilgileri kaydedilirken hata oluştu.', 'error');
        } finally {
            saving = false;
        }
    }

    function resetToDefaults() {
        asilText = defaultAsilText;
        yedekText = defaultYedekText;
        showNotification('Varsayılan metinler geri yüklendi. Kaydetmek için kaydet butonuna basın.', 'warning');
    }

    const defaultAsilText = 'Asil Kayıt Hakkı kazandınız. Kayıt işlemleri için 30 Nisan tarihine kadar okul müdürlüğüne başvurmanız gerekmektedir.';
    const defaultYedekText = 'Yedek Kayıt Hakkı kazandınız. Yedek kayıtlar 2 Mayıs tarihinden itibaren kontenjan dahilinde sırası ile davet edilecektir. Okul duyurularını takip ediniz.';
</script>

<div class="notifications">
    {#each notifications as notification (notification.id)}
        <div
            class="notification {notification.type}"
            transition:fly="{{ y: -30, duration: 300 }}"
            role="alert"
        >
            <button
                class="notification-content"
                on:click={() => removeNotification(notification.id)}
                type="button"
            >
                {#if notification.type === 'success'}
                    <span class="icon" aria-hidden="true">✓</span>
                {:else if notification.type === 'error'}
                    <span class="icon" aria-hidden="true">✕</span>
                {:else}
                    <span class="icon" aria-hidden="true">!</span>
                {/if}
                <span class="message">{notification.message}</span>
            </button>
            <button
                class="close-btn"
                on:click|stopPropagation={() => removeNotification(notification.id)}
                aria-label="Bildirimi kapat"
            >✕</button>
        </div>
    {/each}
</div>

<main class="container">
    <div class="header">
        <h1>Kayıt Bilgileri Yönetimi</h1>
        <a href="/admin" class="back-btn">← Yönetim Paneline Dön</a>
    </div>

    <div class="content">
        <div class="info-banner">
            <span class="info-icon">ℹ️</span>
            <span>
                Bu sayfadaki metinler, sonuç sorgulama ekranında ve indirilen PDF belgesinde
                öğrencilere gösterilir. Asil ve yedek kayıt hakkı kazanan öğrencilere ayrı metinler tanımlayabilirsiniz.
            </span>
        </div>

        {#if loading}
            <div class="loading">Yükleniyor...</div>
        {:else}
            <form on:submit|preventDefault={saveRegistrationInfo}>

                <!-- Asil -->
                <div class="field-card asil-card">
                    <div class="field-header">
                        <span class="field-badge asil-badge">ASİL KAYIT HAKKI</span>
                        <p class="field-hint">
                            Sonuç "Asil Kayıt Hakkı Kazandınız" içeren öğrencilere gösterilir.
                        </p>
                    </div>
                    <div class="form-group">
                        <label for="asilText">Bilgi Metni</label>
                        <textarea
                            id="asilText"
                            bind:value={asilText}
                            rows="4"
                            placeholder="Asil kayıt hakkı kazanan öğrencilere gösterilecek metin..."
                            required
                        ></textarea>
                        <small class="char-count">{asilText.length} karakter</small>
                    </div>
                    <div class="preview">
                        <span class="preview-label">Önizleme:</span>
                        <div class="preview-box asil-preview">{asilText || '(Metin girilmedi)'}</div>
                    </div>
                </div>

                <!-- Yedek -->
                <div class="field-card yedek-card">
                    <div class="field-header">
                        <span class="field-badge yedek-badge">YEDEK KAYIT HAKKI</span>
                        <p class="field-hint">
                            Sonuç "Yedek Kayıt Hakkı Kazandınız" içeren öğrencilere gösterilir.
                        </p>
                    </div>
                    <div class="form-group">
                        <label for="yedekText">Bilgi Metni</label>
                        <textarea
                            id="yedekText"
                            bind:value={yedekText}
                            rows="4"
                            placeholder="Yedek kayıt hakkı kazanan öğrencilere gösterilecek metin..."
                            required
                        ></textarea>
                        <small class="char-count">{yedekText.length} karakter</small>
                    </div>
                    <div class="preview">
                        <span class="preview-label">Önizleme:</span>
                        <div class="preview-box yedek-preview">{yedekText || '(Metin girilmedi)'}</div>
                    </div>
                </div>

                <div class="form-actions">
                    <button type="button" class="reset-btn" on:click={resetToDefaults}>
                        ↺ Varsayılana Sıfırla
                    </button>
                    <button type="submit" class="save-btn" disabled={saving}>
                        {saving ? '⏳ Kaydediliyor...' : '💾 Kaydet'}
                    </button>
                </div>
            </form>
        {/if}
    </div>
</main>

<style>
    .container {
        max-width: 800px;
        margin: 2rem auto;
        padding: 2rem;
    }

    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
    }

    h1 {
        color: #2d3748;
        margin: 0;
        font-size: 2rem;
    }

    .back-btn {
        padding: 0.75rem 1.5rem;
        background: #4a5568;
        color: white;
        text-decoration: none;
        border-radius: 8px;
        transition: all 0.3s ease;
        white-space: nowrap;
    }

    .back-btn:hover {
        background: #2d3748;
        transform: translateX(-4px);
    }

    .content {
        background: white;
        padding: 2rem;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .info-banner {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 1rem 1.25rem;
        background: #ebf8ff;
        border: 1px solid #90cdf4;
        border-radius: 8px;
        color: #2b6cb0;
        font-size: 0.9rem;
        line-height: 1.6;
        margin-bottom: 2rem;
    }

    .info-icon { font-size: 1.2rem; flex-shrink: 0; margin-top: 0.1rem; }

    .loading {
        text-align: center;
        color: #4a5568;
        padding: 3rem;
        font-style: italic;
    }

    .field-card {
        border-radius: 10px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
        border: 2px solid transparent;
    }

    .asil-card {
        background: #f0fdf4;
        border-color: #86efac;
    }

    .yedek-card {
        background: #fff7ed;
        border-color: #fdba74;
    }

    .field-header {
        margin-bottom: 1rem;
    }

    .field-badge {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        border-radius: 20px;
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.5px;
        margin-bottom: 0.5rem;
    }

    .asil-badge {
        background: #dcfce7;
        color: #15803d;
        border: 1px solid #86efac;
    }

    .yedek-badge {
        background: #ffedd5;
        color: #c2410c;
        border: 1px solid #fdba74;
    }

    .field-hint {
        color: #4a5568;
        font-size: 0.85rem;
        margin: 0;
    }

    .form-group {
        margin-bottom: 0.75rem;
    }

    label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: #2d3748;
        font-size: 0.9rem;
    }

    textarea {
        width: 100%;
        padding: 0.875rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 0.95rem;
        font-family: inherit;
        line-height: 1.6;
        resize: vertical;
        transition: all 0.2s ease;
        background: white;
        box-sizing: border-box;
    }

    textarea:focus {
        outline: none;
        border-color: #14b8a6;
        box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
    }

    .char-count {
        display: block;
        color: #718096;
        font-size: 0.8rem;
        margin-top: 0.25rem;
        text-align: right;
    }

    .preview {
        margin-top: 0.5rem;
    }

    .preview-label {
        display: block;
        font-size: 0.8rem;
        font-weight: 600;
        color: #718096;
        margin-bottom: 0.4rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .preview-box {
        padding: 0.875rem 1rem;
        border-radius: 8px;
        font-size: 0.9rem;
        line-height: 1.6;
    }

    .asil-preview {
        background: white;
        border: 1px solid #86efac;
        color: #15803d;
    }

    .yedek-preview {
        background: white;
        border: 1px solid #fdba74;
        color: #c2410c;
    }

    .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 1rem;
        margin-top: 2rem;
    }

    .reset-btn {
        padding: 0.875rem 1.5rem;
        background: white;
        color: #4a5568;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .reset-btn:hover {
        border-color: #718096;
        background: #f8fafc;
    }

    .save-btn {
        padding: 0.875rem 2.5rem;
        background: linear-gradient(to right, #0d9488, #115e59);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 700;
        font-size: 1rem;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(13, 148, 136, 0.3);
    }

    .save-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .save-btn:not(:disabled):hover {
        background: linear-gradient(to right, #115e59, #134e4a);
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(13, 148, 136, 0.4);
    }

    /* Notifications */
    .notifications {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 400px;
    }

    .notification {
        padding: 16px;
        border-radius: 8px;
        background: white;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .notification.success { border-left: 4px solid #48bb78; }
    .notification.error   { border-left: 4px solid #f56565; }
    .notification.warning { border-left: 4px solid #ed8936; }

    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
        background: none;
        border: none;
        width: 100%;
        text-align: left;
        cursor: pointer;
    }

    .icon {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        font-weight: bold;
        flex-shrink: 0;
    }

    .message { color: #2d3748; font-size: 0.95rem; }

    .close-btn {
        background: none;
        border: none;
        color: #718096;
        cursor: pointer;
        padding: 4px;
        font-size: 1.1rem;
        opacity: 0.7;
        transition: opacity 0.2s ease;
        flex-shrink: 0;
    }

    .close-btn:hover { opacity: 1; }

    @media (max-width: 768px) {
        .container { margin: 1rem; padding: 1rem; }
        .header { flex-direction: column; gap: 1rem; }
        .back-btn { width: 100%; text-align: center; }
        .content { padding: 1rem; }
        .form-actions { flex-direction: column; }
        .save-btn, .reset-btn { width: 100%; }
        .notifications { top: 10px; right: 10px; left: 10px; max-width: none; }
    }
</style>
