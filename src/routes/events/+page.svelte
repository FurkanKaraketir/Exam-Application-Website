<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import { fade, fly } from 'svelte/transition';

    interface EventField {
        key: string;
        label: string;
        type: 'text' | 'email' | 'phone' | 'number' | 'float' | 'select';
        required: boolean;
        options?: string[];
    }

    interface EventItem {
        id: string;
        name: string;
        description?: string;
        startDate: string;
        endDate: string;
        enabled: boolean;
        fields: EventField[];
        createdAt: Date;
    }

    let events: EventItem[] = [];
    let selectedEvent: EventItem | null = null;
    let formData: Record<string, string> = {};
    let isLoading = true;
    let submitState: 'idle' | 'submitting' | 'success' | 'error' = 'idle';

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

    function toTurkishUpperCase(str: string): string {
        return str.replace('i', 'İ').replace('ı', 'I').replace('ğ', 'Ğ')
            .replace('ü', 'Ü').replace('ş', 'Ş').replace('ö', 'Ö').replace('ç', 'Ç').toUpperCase();
    }

    function handleNameInput(ev: Event, key: string) {
        const input = (ev.target as HTMLInputElement);
        formData[key] = toTurkishUpperCase(input.value);
    }

    function handleFloatInput(ev: Event, key: string) {
        const input = ev.target as HTMLInputElement;
        // Normalise: treat . as , (Turkish decimal separator)
        let raw = input.value.replace('.', ',');
        // Keep only digits, commas and a leading minus
        raw = raw.replace(/[^0-9,\-]/g, '');
        // Allow only one comma
        const parts = raw.split(',');
        if (parts.length > 2) raw = parts[0] + ',' + parts.slice(1).join('');
        formData[key] = raw;
        input.value = raw;
    }

    function handleIntInput(ev: Event, key: string) {
        const input = ev.target as HTMLInputElement;
        const raw = input.value.replace(/[^0-9\-]/g, '');
        formData[key] = raw;
        input.value = raw;
    }

    function handlePhoneInput(ev: Event, key: string) {
        const input = ev.target as HTMLInputElement;
        let formatted = input.value.replace(/[^0-9]/g, '').replace(/^0+/, '');
        if (formatted.length > 0 && !['5'].includes(formatted[0])) formatted = '';
        formatted = formatted.slice(0, 10);
        formData[key] = formatted;
        if (formatted.length > 0) {
            let display = '(' + formatted.slice(0, 3);
            if (formatted.length > 3) display += ') ' + formatted.slice(3, 6);
            if (formatted.length > 6) display += ' ' + formatted.slice(6, 8);
            if (formatted.length > 8) display += ' ' + formatted.slice(8, 10);
            input.value = display;
        } else input.value = '';
    }

    async function loadEvents() {
        try {
            isLoading = true;
            const snap = await getDocs(collection(db, 'events'));
            events = snap.docs
                .map(d => {
                    const data = d.data();
                    return {
                        id: d.id,
                        name: data.name || '',
                        description: data.description || '',
                        startDate: data.startDate || '',
                        endDate: data.endDate || '',
                        enabled: data.enabled ?? true,
                        fields: data.fields || [],
                        createdAt: data.createdAt?.toDate?.() || new Date()
                    } as EventItem;
                })
                .filter(e => e.enabled)
                .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
        } catch (e) {
            console.error('Error loading events:', e);
            events = [];
        } finally {
            isLoading = false;
        }
    }

    function selectEvent(event: EventItem) {
        selectedEvent = event;
        formData = {};
        submitState = 'idle';
    }

    function goBack() {
        selectedEvent = null;
        formData = {};
    }

    function isEventOpen(e: EventItem): boolean {
        const now = new Date();
        const start = e.startDate ? new Date(e.startDate) : null;
        const end = e.endDate ? new Date(e.endDate) : null;
        if (start && now < start) return false;
        if (end && now > end) return false;
        return true;
    }

    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        if (!selectedEvent) return;

        if (!isEventOpen(selectedEvent)) {
            showNotification('Bu etkinlik için başvuru süresi dolmuştur.', 'error');
            return;
        }

        submitState = 'submitting';
        try {
            for (const field of selectedEvent.fields) {
                if (field.required && !(formData[field.key]?.trim())) {
                    showNotification(`${field.label} alanı zorunludur.`, 'error');
                    submitState = 'idle';
                    return;
                }
                if (field.type === 'float' && formData[field.key]?.trim() && isNaN(Number(formData[field.key].replace(',', '.')))) {
                    showNotification(`${field.label} alanına geçerli bir ondalık sayı giriniz.`, 'error');
                    submitState = 'idle';
                    return;
                }
            }

            const appData: Record<string, unknown> = {
                eventId: selectedEvent.id,
                eventName: selectedEvent.name,
                submittedAt: new Date(),
                ...formData
            };

            const appRef = doc(collection(db, 'eventApplications'));
            await setDoc(appRef, appData);

            showNotification('Başvurunuz başarıyla alındı.');
            submitState = 'success';
            formData = {};
        } catch (err) {
            console.error('[handleSubmit] Başvuru gönderilemedi:', err);
            console.error('[handleSubmit] formData:', JSON.stringify(formData, null, 2));
            console.error('[handleSubmit] eventId:', selectedEvent?.id, '| eventName:', selectedEvent?.name);
            showNotification('Başvuru gönderilirken bir hata oluştu. Lütfen tekrar deneyiniz.', 'error');
            submitState = 'error';
            setTimeout(() => { submitState = 'idle'; }, 3000);
        }
    }

    onMount(loadEvents);
</script>

<div class="notifications">
    {#each notifications as n (n.id)}
        <div class="notification {n.type}" transition:fly="{{ y: -30, duration: 300 }}" role="alert">
            <span class="msg">{n.message}</span>
            <button on:click={() => removeNotification(n.id)} aria-label="Kapat">✕</button>
        </div>
    {/each}
</div>

<main class="events-page">
    <div class="events-container">
        <h1>Etkinlik Başvuru Formu</h1>
        <p class="subtitle">Katılmak istediğiniz etkinliği seçin ve başvuru formunu doldurun.</p>

        {#if isLoading}
            <div class="loading-banner">
                <span class="icon">⏳</span>
                <h2>Yükleniyor...</h2>
            </div>
        {:else if selectedEvent}
            <div class="form-section" transition:fade>
                <button class="back-btn" on:click={goBack}>← Etkinlik Seçimine Dön</button>
                <h2>{selectedEvent.name}</h2>
                {#if selectedEvent.description}
                    <p class="event-desc">{selectedEvent.description}</p>
                {/if}
                {#if !isEventOpen(selectedEvent)}
                    <div class="closed-banner">Bu etkinlik için başvuru süresi dolmuştur.</div>
                {:else}
                    <form on:submit={handleSubmit} class="event-form">
                        {#each selectedEvent.fields as field}
                            <div class="form-group">
                                <label for={field.key}>{field.label}{field.required ? ' *' : ''}</label>
                                {#if field.type === 'select'}
                                    <select id={field.key} bind:value={formData[field.key]} required={field.required}>
                                        <option value="">Seçiniz</option>
                                        {#each (field.options || []) as opt}
                                            <option value={opt}>{opt}</option>
                                        {/each}
                                    </select>
                                {:else if field.type === 'phone'}
                                    <input
                                        type="tel"
                                        id={field.key}
                                        on:input={(e) => handlePhoneInput(e, field.key)}
                                        placeholder="(5XX) XXX XX XX"
                                        required={field.required}
                                    />
                                {:else if field.type === 'email'}
                                    <input
                                        type="email"
                                        id={field.key}
                                        bind:value={formData[field.key]}
                                        placeholder={field.label}
                                        required={field.required}
                                    />
                                {:else if field.type === 'number'}
                                    <input
                                        type="text"
                                        inputmode="numeric"
                                        id={field.key}
                                        value={formData[field.key] ?? ''}
                                        on:input={(ev) => handleIntInput(ev, field.key)}
                                        placeholder={field.label}
                                        required={field.required}
                                    />
                                {:else if field.type === 'float'}
                                    <input
                                        type="text"
                                        inputmode="decimal"
                                        id={field.key}
                                        value={formData[field.key] ?? ''}
                                        on:input={(ev) => handleFloatInput(ev, field.key)}
                                        placeholder={field.label}
                                        required={field.required}
                                    />
                                {:else}
                                    <input
                                        type="text"
                                        id={field.key}
                                        value={formData[field.key] ?? ''}
                                        on:input={(ev) => handleNameInput(ev, field.key)}
                                        placeholder={field.label}
                                        required={field.required}
                                    />
                                {/if}
                            </div>
                        {/each}
                        <button
                            type="submit"
                            class="submit-btn"
                            class:submitting={submitState === 'submitting'}
                            class:success={submitState === 'success'}
                            disabled={submitState === 'submitting'}
                        >
                            {#if submitState === 'submitting'}Gönderiliyor...
                            {:else if submitState === 'success'}✓ Başvuru Gönderildi
                            {:else}Başvuruyu Gönder
                            {/if}
                        </button>
                    </form>
                {/if}
            </div>
        {:else if events.length === 0}
            <div class="empty-banner">
                <span class="icon">📋</span>
                <h2>Şu an açık etkinlik bulunmuyor</h2>
                <p>Yeni etkinlikler eklendiğinde burada görünecektir.</p>
            </div>
        {:else}
            <div class="event-list">
                {#each events as event}
                    {@const open = isEventOpen(event)}
                    <button
                        class="event-card"
                        class:closed={!open}
                        on:click={() => selectEvent(event)}
                        disabled={!open}
                    >
                        <span class="event-icon">{open ? '📝' : '🔒'}</span>
                        <div class="event-info">
                            <h3>{event.name}</h3>
                            {#if event.description}
                                <p class="event-desc">{event.description}</p>
                            {/if}
                            <p class="event-dates">
                                {event.startDate ? new Date(event.startDate).toLocaleDateString('tr-TR') : ''}
                                {event.endDate ? ' - ' + new Date(event.endDate).toLocaleDateString('tr-TR') : ''}
                            </p>
                            {#if !open}
                                <span class="badge closed">Başvuru Kapalı</span>
                            {:else}
                                <span class="badge open">Başvuru Açık</span>
                            {/if}
                        </div>
                    </button>
                {/each}
            </div>
        {/if}
    </div>

    <div class="action-column">
        <a href="/" class="action-btn">← Ana Sayfa</a>
    </div>
</main>

<style>
    .notifications {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    .notification {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        max-width: 360px;
    }
    .notification.success { background: #d4edda; color: #155724; }
    .notification.error { background: #f8d7da; color: #721c24; }
    .notification.warning { background: #fff3cd; color: #856404; }
    .notification .msg { flex: 1; }
    .notification button { background: none; border: none; cursor: pointer; font-size: 1rem; }

    .events-page {
        max-width: 1200px;
        margin: 2rem auto;
        padding: 2.5rem;
        background: linear-gradient(to bottom, #ffffff, #f8fafc);
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08);
    }

    .events-container h1 {
        font-size: 1.75rem;
        color: #1e293b;
        margin-bottom: 0.5rem;
    }
    .subtitle {
        color: #64748b;
        margin-bottom: 2rem;
    }

    .loading-banner, .empty-banner {
        text-align: center;
        padding: 3rem 2rem;
        background: #f1f5f9;
        border-radius: 12px;
    }
    .loading-banner .icon, .empty-banner .icon {
        font-size: 3rem;
        display: block;
        margin-bottom: 1rem;
    }

    .event-list {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    .event-card {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        padding: 1.25rem;
        background: white;
        border: 2px solid #e2e8f0;
        border-radius: 12px;
        cursor: pointer;
        text-align: left;
        transition: all 0.2s;
    }
    .event-card:hover:not(:disabled) {
        border-color: #0d9488;
        background: #f0fdfa;
        box-shadow: 0 4px 12px rgba(13, 148, 136, 0.15);
    }
    .event-card.closed, .event-card:disabled {
        opacity: 0.7;
        cursor: not-allowed;
    }
    .event-icon { font-size: 2rem; }
    .event-info { flex: 1; }
    .event-info h3 { margin: 0 0 0.25rem; font-size: 1.15rem; color: #1e293b; }
    .event-desc { margin: 0.25rem 0; color: #64748b; font-size: 0.9rem; }
    .event-dates { margin: 0.5rem 0; font-size: 0.85rem; color: #94a3b8; }
    .badge {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
    }
    .badge.open { background: #d1fae5; color: #065f46; }
    .badge.closed { background: #fee2e2; color: #991b1b; }

    .form-section {
        background: white;
        padding: 2rem;
        border-radius: 12px;
        border: 1px solid #e2e8f0;
    }
    .back-btn {
        background: none;
        border: none;
        color: #0d9488;
        cursor: pointer;
        font-size: 0.95rem;
        margin-bottom: 1rem;
        padding: 0;
    }
    .back-btn:hover { text-decoration: underline; }
    .form-section h2 { margin: 0 0 1rem; color: #1e293b; }
    .closed-banner {
        padding: 1rem;
        background: #fee2e2;
        color: #991b1b;
        border-radius: 8px;
        text-align: center;
    }

    .event-form {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }
    .form-group label {
        display: block;
        margin-bottom: 0.35rem;
        font-weight: 600;
        color: #334155;
    }
    .form-group input, .form-group select {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font-size: 1rem;
    }
    .form-group input:focus, .form-group select:focus {
        outline: none;
        border-color: #0d9488;
        box-shadow: 0 0 0 2px rgba(13, 148, 136, 0.2);
    }
    .submit-btn {
        padding: 0.875rem 1.5rem;
        background: linear-gradient(135deg, #0d9488 0%, #115e59 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }
    .submit-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(13, 148, 136, 0.3);
    }
    .submit-btn:disabled { opacity: 0.8; cursor: not-allowed; }
    .submit-btn.success { background: #059669; }
    .submit-btn.submitting { opacity: 0.9; }

    .action-column {
        margin-top: 2rem;
        padding-top: 1.5rem;
        border-top: 1px solid #e2e8f0;
    }
    .action-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.25rem;
        background: #f1f5f9;
        color: #475569;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 500;
        transition: all 0.2s;
    }
    .action-btn:hover {
        background: #e2e8f0;
        color: #1e293b;
    }
</style>
