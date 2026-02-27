<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, doc, getDocs, setDoc, deleteDoc, addDoc } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import { fade, fly } from 'svelte/transition';
    import * as XLSX from 'xlsx';

    interface EventField {
        key: string;
        label: string;
        type: 'text' | 'email' | 'phone' | 'number' | 'select';
        required: boolean;
        options?: string[];
    }

    interface Event {
        id: string;
        name: string;
        description?: string;
        startDate: string;
        endDate: string;
        enabled: boolean;
        fields: EventField[];
        createdAt: Date;
    }

    interface EventApplication {
        id: string;
        eventId: string;
        eventName: string;
        submittedAt: Date;
        [key: string]: unknown;
    }

    const FIELD_TYPES = [
        { value: 'text', label: 'Metin' },
        { value: 'email', label: 'E-posta' },
        { value: 'phone', label: 'Telefon' },
        { value: 'number', label: 'Sayı' },
        { value: 'select', label: 'Seçenek Listesi' }
    ] as const;

    let events: Event[] = [];
    let applicationsByEvent: Record<string, EventApplication[]> = {};
    let selectedEvent: Event | null = null;
    let isModalOpen = false;
    let isNewEvent = true;
    let formData: Partial<Event> = {
        name: '',
        description: '',
        startDate: '',
        endDate: '',
        enabled: true,
        fields: []
    };
    let loading = true;
    let expandedEventId: string | null = null;
    let searchQuery: Record<string, string> = {};
    let filterByField: Record<string, Record<string, string>> = {};

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

    async function loadEvents() {
        try {
            loading = true;
            const snap = await getDocs(collection(db, 'events'));
            events = snap.docs.map(d => {
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
                } as Event;
            }).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
        } catch (e) {
            console.error('Error loading events:', e);
            showNotification('Etkinlikler yüklenirken hata oluştu.', 'error');
            events = [];
        } finally {
            loading = false;
        }
    }

    async function loadApplications() {
        try {
            const snap = await getDocs(collection(db, 'eventApplications'));
            const byEvent: Record<string, EventApplication[]> = {};
            snap.docs.forEach(d => {
                const data = d.data();
                const app: EventApplication = {
                    id: d.id,
                    ...data,
                    eventId: data.eventId || '',
                    eventName: data.eventName || '',
                    submittedAt: data.submittedAt?.toDate?.() || new Date()
                };
                const eid = app.eventId || 'unknown';
                if (!byEvent[eid]) byEvent[eid] = [];
                byEvent[eid].push(app);
            });
            applicationsByEvent = byEvent;
        } catch (e) {
            console.error('Error loading applications:', e);
            applicationsByEvent = {};
        }
    }

    function getApplicationCount(eventId: string): number {
        return (applicationsByEvent[eventId] || []).length;
    }

    function getFilteredApplications(event: Event): EventApplication[] {
        const apps = applicationsByEvent[event.id] || [];
        const q = (searchQuery[event.id] || '').toLowerCase().trim();
        const filters = filterByField[event.id] || {};

        return apps.filter(app => {
            if (q) {
                const searchable = Object.values(app)
                    .filter(v => v != null && typeof v === 'string')
                    .join(' ')
                    .toLowerCase();
                if (!searchable.includes(q)) return false;
            }
            for (const [fieldKey, selectedVal] of Object.entries(filters)) {
                if (!selectedVal) continue;
                const appVal = String(app[fieldKey] ?? '').trim();
                if (appVal !== selectedVal) return false;
            }
            return true;
        });
    }

    function getSelectFieldStats(event: Event, field: EventField): { option: string; count: number; pct: number }[] {
        const apps = getFilteredApplications(event);
        const total = apps.length;
        if (total === 0) return (field.options || []).map(o => ({ option: o, count: 0, pct: 0 }));

        const counts: Record<string, number> = {};
        for (const opt of field.options || []) counts[opt] = 0;
        for (const app of apps) {
            const val = String(app[field.key] ?? '').trim();
            if (val && (field.options || []).includes(val)) counts[val]++;
            else if (val) counts[val] = (counts[val] || 0) + 1;
        }
        return Object.entries(counts)
            .map(([option, count]) => ({ option, count, pct: total ? Math.round((count / total) * 100) : 0 }))
            .sort((a, b) => b.count - a.count);
    }

    function setSearch(eventId: string, value: string) {
        searchQuery = { ...searchQuery, [eventId]: value };
    }

    function setFilter(eventId: string, fieldKey: string, value: string) {
        const prev = filterByField[eventId] || {};
        const next = value ? { ...prev, [fieldKey]: value } : Object.fromEntries(
            Object.entries(prev).filter(([k]) => k !== fieldKey)
        );
        filterByField = { ...filterByField, [eventId]: next };
    }

    function clearFilters(eventId: string) {
        setSearch(eventId, '');
        filterByField = { ...filterByField, [eventId]: {} };
    }

    function openNewEventModal() {
        isNewEvent = true;
        selectedEvent = null;
        formData = {
            name: '',
            description: '',
            startDate: '',
            endDate: '',
            enabled: true,
            fields: []
        };
        isModalOpen = true;
    }

    function openEditEventModal(event: Event) {
        isNewEvent = false;
        selectedEvent = event;
        formData = {
            name: event.name,
            description: event.description || '',
            startDate: event.startDate || '',
            endDate: event.endDate || '',
            enabled: event.enabled,
            fields: JSON.parse(JSON.stringify(event.fields || []))
        };
        isModalOpen = true;
    }

    function addField() {
        formData.fields = [...(formData.fields || []), {
            key: `field_${Date.now()}`,
            label: 'Yeni Alan',
            type: 'text',
            required: false,
            options: [] as string[]
        }];
    }

    function removeField(index: number) {
        formData.fields = (formData.fields || []).filter((_, i) => i !== index);
    }

    function updateFieldOption(index: number, optIndex: number, value: string) {
        const fields = [...(formData.fields || [])];
        if (!fields[index].options) fields[index].options = [];
        fields[index].options![optIndex] = value;
        formData.fields = fields;
    }

    function addFieldOption(index: number) {
        const fields = [...(formData.fields || [])];
        if (!fields[index].options) fields[index].options = [];
        fields[index].options!.push('');
        formData.fields = fields;
    }

    function removeFieldOption(index: number, optIndex: number) {
        const fields = [...(formData.fields || [])];
        if (fields[index].options) {
            fields[index].options = fields[index].options!.filter((_, i) => i !== optIndex);
        }
        formData.fields = fields;
    }

    async function saveEvent() {
        if (!formData.name?.trim()) {
            showNotification('Etkinlik adı zorunludur.', 'error');
            return;
        }

        try {
            const data = {
                name: formData.name.trim(),
                description: (formData.description || '').trim(),
                startDate: formData.startDate || '',
                endDate: formData.endDate || '',
                enabled: formData.enabled ?? true,
                fields: formData.fields || [],
                createdAt: selectedEvent?.createdAt || new Date(),
                updatedAt: new Date()
            };

            if (isNewEvent) {
                const ref = await addDoc(collection(db, 'events'), data);
                events = [...events, { id: ref.id, ...data } as Event];
                showNotification('Etkinlik oluşturuldu.');
            } else if (selectedEvent) {
                await setDoc(doc(db, 'events', selectedEvent.id), data);
                events = events.map(e => e.id === selectedEvent!.id ? { ...e, ...data } : e);
                showNotification('Etkinlik güncellendi.');
            }
            isModalOpen = false;
        } catch (e) {
            console.error('Error saving event:', e);
            showNotification('Etkinlik kaydedilirken hata oluştu.', 'error');
        }
    }

    async function deleteEvent(event: Event) {
        if (!confirm(`"${event.name}" etkinliğini silmek istediğinize emin misiniz?`)) return;

        try {
            await deleteDoc(doc(db, 'events', event.id));
            events = events.filter(e => e.id !== event.id);
            delete applicationsByEvent[event.id];
            applicationsByEvent = { ...applicationsByEvent };
            showNotification('Etkinlik silindi.');
        } catch (e) {
            showNotification('Etkinlik silinirken hata oluştu.', 'error');
        }
    }

    function toggleExpand(eventId: string) {
        expandedEventId = expandedEventId === eventId ? null : eventId;
    }

    function exportEventApplications(event: Event) {
        const apps = getFilteredApplications(event);
        if (apps.length === 0) {
            showNotification('Bu etkinlik için henüz başvuru yok.', 'warning');
            return;
        }

        const headers = ['Tarih', 'Etkinlik', ...(event.fields?.map(f => f.label) || [])];
        const rows = apps.map(app => {
            const row: (string | number | Date)[] = [
                app.submittedAt instanceof Date ? app.submittedAt.toLocaleString('tr-TR') : String(app.submittedAt),
                app.eventName || event.name
            ];
            for (const f of event.fields || []) {
                row.push(String(app[f.key] ?? ''));
            }
            return row;
        });

        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Başvurular');
        XLSX.writeFile(wb, `etkinlik_basvurulari_${event.name.replace(/\s+/g, '_')}.xlsx`);
        showNotification('Excel dosyası indirildi.');
    }

    onMount(async () => {
        await Promise.all([loadEvents(), loadApplications()]);
    });
</script>

<div class="notifications">
    {#each notifications as n (n.id)}
        <div class="notification {n.type}" transition:fly="{{ y: -30, duration: 300 }}" role="alert">
            <span>{n.message}</span>
            <button on:click={() => removeNotification(n.id)} aria-label="Kapat">✕</button>
        </div>
    {/each}
</div>

<div class="admin-events">
    <header class="page-header">
        <h1>Etkinlik Yönetimi</h1>
        <p class="subtitle">Etkinlik oluşturun, form alanlarını yapılandırın ve başvuru istatistiklerini görüntüleyin.</p>
        <button class="btn-primary" on:click={openNewEventModal}>+ Yeni Etkinlik</button>
    </header>

    {#if loading}
        <div class="loading">Yükleniyor...</div>
    {:else if events.length === 0}
        <div class="empty-state">
            <span class="icon">📋</span>
            <h2>Henüz etkinlik yok</h2>
            <p>Yeni bir etkinlik oluşturarak başlayın.</p>
            <button class="btn-primary" on:click={openNewEventModal}>+ İlk Etkinliği Oluştur</button>
        </div>
    {:else}
        <div class="events-list">
            {#each events as event}
                <div class="event-card">
                    <div class="event-header" role="button" tabindex="0" on:click={() => toggleExpand(event.id)} on:keydown={(e) => e.key === 'Enter' && toggleExpand(event.id)}>
                        <div class="event-main">
                            <span class="event-icon">{event.enabled ? '📝' : '🔒'}</span>
                            <div>
                                <h3>{event.name}</h3>
                                <p class="event-meta">
                                    {event.startDate ? new Date(event.startDate).toLocaleDateString('tr-TR') : '-'}
                                    {event.endDate ? ' - ' + new Date(event.endDate).toLocaleDateString('tr-TR') : ''}
                                    • {getApplicationCount(event.id)} başvuru
                                </p>
                            </div>
                        </div>
                        <div class="event-actions">
                            <button class="btn-icon" on:click|stopPropagation={() => exportEventApplications(event)} title="Excel indir">📥</button>
                            <button class="btn-icon" on:click|stopPropagation={() => openEditEventModal(event)} title="Düzenle">✏️</button>
                            <button class="btn-icon danger" on:click|stopPropagation={() => deleteEvent(event)} title="Sil">🗑️</button>
                            <span class="expand-icon">{expandedEventId === event.id ? '▼' : '▶'}</span>
                        </div>
                    </div>

                    {#if expandedEventId === event.id}
                        <div class="event-details" transition:fade>
                            {#if event.description}
                                <p class="event-desc">{event.description}</p>
                            {/if}
                            <div class="stats-row">
                                <div class="stat-box">
                                    <span class="stat-value">{getApplicationCount(event.id)}</span>
                                    <span class="stat-label">Toplam Başvuru</span>
                                </div>
                                <div class="stat-box">
                                    <span class="stat-value">{getFilteredApplications(event).length}</span>
                                    <span class="stat-label">Filtrelenmiş</span>
                                </div>
                                <div class="stat-box">
                                    <span class="stat-value">{event.fields?.length || 0}</span>
                                    <span class="stat-label">Form Alanı</span>
                                </div>
                            </div>

                            {#if (applicationsByEvent[event.id] || []).length > 0}
                                <div class="search-filter-bar">
                                    <div class="search-box">
                                        <span class="search-icon">🔍</span>
                                        <input
                                            type="search"
                                            placeholder="Tüm alanlarda ara..."
                                            value={searchQuery[event.id] ?? ''}
                                            on:input={(e) => setSearch(event.id, (e.target as HTMLInputElement).value)}
                                        />
                                    </div>
                                    {#each (event.fields || []).filter(f => f.type === 'select' && (f.options?.length ?? 0) > 0) as f}
                                        <div class="filter-select">
                                            <label for="filter-{event.id}-{f.key}">{f.label}:</label>
                                            <select
                                                id="filter-{event.id}-{f.key}"
                                                value={filterByField[event.id]?.[f.key] ?? ''}
                                                on:change={(e) => setFilter(event.id, f.key, (e.target as HTMLSelectElement).value)}
                                            >
                                                <option value="">Tümü</option>
                                                {#each (f.options || []) as opt}
                                                    <option value={opt}>{opt}</option>
                                                {/each}
                                            </select>
                                        </div>
                                    {/each}
                                    {#if searchQuery[event.id] || Object.values(filterByField[event.id] || {}).some(Boolean)}
                                        <button type="button" class="btn-secondary small" on:click={() => clearFilters(event.id)}>
                                            Filtreleri Temizle
                                        </button>
                                    {/if}
                                </div>

                                {#each (event.fields || []).filter(f => f.type === 'select' && (f.options?.length ?? 0) > 0) as f}
                                    {@const stats = getSelectFieldStats(event, f)}
                                    {#if stats.length > 0}
                                        <div class="chart-section">
                                            <h4>{f.label} — Dağılım</h4>
                                            <div class="chart-bars">
                                                {#each stats as s, i}
                                                    <div class="chart-row">
                                                        <span class="chart-label" title={s.option}>{s.option}</span>
                                                        <div class="chart-bar-wrap">
                                                            <div
                                                                class="chart-bar"
                                                                style="width: {s.pct}%;"
                                                                role="presentation"
                                                            ></div>
                                                            <span class="chart-value">{s.count} ({s.pct}%)</span>
                                                        </div>
                                                    </div>
                                                {/each}
                                            </div>
                                        </div>
                                    {/if}
                                {/each}

                                <div class="applications-preview">
                                    <h4>Başvurular ({getFilteredApplications(event).length})</h4>
                                    {#if getFilteredApplications(event).length === 0}
                                        <p class="no-results">Arama veya filtre kriterlerine uyan başvuru bulunamadı.</p>
                                    {:else}
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Tarih</th>
                                                {#each (event.fields || []) as f}
                                                    <th>{f.label}</th>
                                                {/each}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each getFilteredApplications(event) as app}
                                                <tr>
                                                    <td>{app.submittedAt instanceof Date ? app.submittedAt.toLocaleString('tr-TR') : '-'}</td>
                                                    {#each (event.fields || []) as f}
                                                        <td>{String(app[f.key] ?? '-')}</td>
                                                    {/each}
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>

{#if isModalOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="modal-overlay" role="presentation" on:click={() => isModalOpen = false}>
        <div class="modal" on:click|stopPropagation role="dialog" aria-modal="true">
            <div class="modal-header">
                <h2>{isNewEvent ? 'Yeni Etkinlik' : 'Etkinlik Düzenle'}</h2>
                <button class="close-btn" on:click={() => isModalOpen = false} aria-label="Kapat">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="event-name">Etkinlik Adı *</label>
                    <input id="event-name" type="text" bind:value={formData.name} placeholder="Örn: Bilim Şenliği" />
                </div>
                <div class="form-group">
                    <label for="event-desc">Açıklama</label>
                    <textarea id="event-desc" bind:value={formData.description} placeholder="Etkinlik hakkında kısa bilgi" rows="2"></textarea>
                </div>
                <h4 class="form-section-title">Başvuru Tarihleri</h4>
                <p class="form-section-hint">Başvuruların ne zaman açılıp kapanacağını belirleyin. Boş bırakılırsa süre sınırı olmaz.</p>
                <div class="form-row">
                    <div class="form-group">
                        <label for="event-start">Başlangıç Tarihi</label>
                        <input id="event-start" type="datetime-local" bind:value={formData.startDate} />
                    </div>
                    <div class="form-group">
                        <label for="event-end">Bitiş Tarihi</label>
                        <input id="event-end" type="datetime-local" bind:value={formData.endDate} />
                    </div>
                </div>
                <div class="form-group checkbox-row">
                    <label>
                        <input type="checkbox" bind:checked={formData.enabled} />
                        Etkinlik açık (başvuru alınsın)
                    </label>
                </div>

                <div class="fields-section">
                    <div class="section-header">
                        <h3>Form Alanları</h3>
                        <button type="button" class="btn-secondary" on:click={addField}>+ Alan Ekle</button>
                    </div>
                    {#each (formData.fields || []) as field, i}
                        <div class="field-item">
                            <div class="field-row">
                                <input type="text" bind:value={field.label} placeholder="Alan adı (örn: Ad Soyad)" class="field-label" />
                                <select bind:value={field.type}>
                                    {#each FIELD_TYPES as ft}
                                        <option value={ft.value}>{ft.label}</option>
                                    {/each}
                                </select>
                                <label class="checkbox-inline">
                                    <input type="checkbox" bind:checked={field.required} /> Zorunlu
                                </label>
                                <button type="button" class="btn-icon danger" on:click={() => removeField(i)}>🗑️</button>
                            </div>
                            {#if field.type === 'select'}
                                {@const opts = field.options ?? []}
                                <div class="options-row">
                                    <span>Seçenekler:</span>
                                    {#each opts as _, oi}
                                        <div class="option-item">
                                            <input type="text" bind:value={field.options![oi]} placeholder="Seçenek" />
                                            <button type="button" class="btn-icon small" on:click={() => removeFieldOption(i, oi)}>✕</button>
                                        </div>
                                    {/each}
                                    <button type="button" class="btn-secondary small" on:click={() => addFieldOption(i)}>+ Seçenek</button>
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn-secondary" on:click={() => isModalOpen = false}>İptal</button>
                <button type="button" class="btn-primary" on:click={saveEvent}>Kaydet</button>
            </div>
        </div>
    </div>
{/if}

<style>
    .notifications {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 2000;
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
    .notification button { background: none; border: none; cursor: pointer; }

    .admin-events {
        padding: 1.5rem;
        max-width: 1000px;
    }

    .page-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
        margin-bottom: 2rem;
    }
    .page-header h1 { margin: 0; font-size: 1.5rem; color: #1e293b; }
    .page-header .subtitle { flex: 1 1 100%; margin: 0.25rem 0 0; color: #64748b; font-size: 0.9rem; }
    .btn-primary {
        padding: 0.6rem 1.25rem;
        background: linear-gradient(135deg, #0d9488 0%, #115e59 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
    }
    .btn-primary:hover { opacity: 0.95; transform: translateY(-1px); }
    .btn-secondary {
        padding: 0.5rem 1rem;
        background: #e2e8f0;
        color: #475569;
        border: none;
        border-radius: 6px;
        font-size: 0.9rem;
        cursor: pointer;
    }
    .btn-secondary:hover { background: #cbd5e1; }
    .btn-secondary.small { padding: 0.25rem 0.5rem; font-size: 0.8rem; }
    .btn-icon {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0.25rem;
        font-size: 1.1rem;
    }
    .btn-icon.danger:hover { opacity: 0.8; }
    .btn-icon.danger { color: #dc2626; }

    .loading { text-align: center; padding: 3rem; color: #64748b; }
    .empty-state {
        text-align: center;
        padding: 3rem 2rem;
        background: #f8fafc;
        border-radius: 12px;
        border: 2px dashed #e2e8f0;
    }
    .empty-state .icon { font-size: 3rem; display: block; margin-bottom: 1rem; }
    .empty-state h2 { margin: 0 0 0.5rem; color: #1e293b; }
    .empty-state p { margin: 0 0 1rem; color: #64748b; }

    .events-list { display: flex; flex-direction: column; gap: 1rem; }
    .event-card {
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .event-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.25rem;
        cursor: pointer;
        transition: background 0.2s;
    }
    .event-header:hover { background: #f8fafc; }
    .event-main { display: flex; align-items: center; gap: 1rem; }
    .event-icon { font-size: 1.5rem; }
    .event-main h3 { margin: 0; font-size: 1.1rem; color: #1e293b; }
    .event-meta { margin: 0.25rem 0 0; font-size: 0.85rem; color: #64748b; }
    .event-actions { display: flex; align-items: center; gap: 0.5rem; }
    .expand-icon { font-size: 0.8rem; color: #94a3b8; margin-left: 0.5rem; }

    .event-details {
        padding: 0 1.25rem 1.25rem;
        border-top: 1px solid #f1f5f9;
    }
    .event-desc { margin: 0.5rem 0 1rem; color: #64748b; font-size: 0.9rem; }
    .stats-row { display: flex; gap: 1.5rem; margin-bottom: 1rem; }
    .stat-box {
        padding: 0.75rem 1.25rem;
        background: #f0fdfa;
        border-radius: 8px;
        border: 1px solid #99f6e4;
    }
    .stat-value { display: block; font-size: 1.5rem; font-weight: 700; color: #0d9488; }
    .stat-label { font-size: 0.8rem; color: #64748b; }

    .search-filter-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.25rem;
        padding: 1rem;
        background: #f8fafc;
        border-radius: 10px;
        border: 1px solid #e2e8f0;
    }
    .search-box {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 200px;
    }
    .search-icon { font-size: 1.1rem; margin-right: 0.5rem; color: #64748b; }
    .search-box input {
        flex: 1;
        padding: 0.5rem 0.75rem;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font-size: 0.9rem;
    }
    .search-box input:focus {
        outline: none;
        border-color: #0d9488;
        box-shadow: 0 0 0 2px rgba(13, 148, 136, 0.15);
    }
    .filter-select {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .filter-select label { font-size: 0.85rem; color: #475569; white-space: nowrap; }
    .filter-select select {
        padding: 0.4rem 0.6rem;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        font-size: 0.85rem;
        min-width: 120px;
    }

    .chart-section {
        margin-bottom: 1.5rem;
        padding: 1rem 1.25rem;
        background: linear-gradient(135deg, #f0fdfa 0%, #ecfeff 100%);
        border-radius: 12px;
        border: 1px solid #99f6e4;
    }
    .chart-section h4 {
        margin: 0 0 1rem;
        font-size: 0.95rem;
        color: #0f766e;
        font-weight: 600;
    }
    .chart-bars {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
    }
    .chart-row {
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    .chart-label {
        flex: 0 0 140px;
        font-size: 0.85rem;
        color: #334155;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .chart-bar-wrap {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
    }
    .chart-bar {
        height: 24px;
        min-width: 4px;
        background: linear-gradient(90deg, #0d9488 0%, #14b8a6 100%);
        border-radius: 6px;
        transition: width 0.4s ease;
    }
    .chart-value {
        flex-shrink: 0;
        font-size: 0.8rem;
        font-weight: 600;
        color: #0d9488;
        min-width: 60px;
    }

    .applications-preview { overflow-x: auto; }
    .no-results {
        padding: 1.5rem;
        text-align: center;
        color: #64748b;
        font-size: 0.95rem;
        background: #f8fafc;
        border-radius: 8px;
        margin: 0;
    }
    .applications-preview h4 { margin: 0 0 0.5rem; font-size: 0.95rem; }
    .applications-preview table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .applications-preview th, .applications-preview td { padding: 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: left; }
    .applications-preview th { background: #f8fafc; color: #475569; font-weight: 600; }

    .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 1rem;
    }
    .modal {
        background: white;
        border-radius: 12px;
        max-width: 600px;
        width: 100%;
        max-height: 90vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-shadow: 0 25px 50px rgba(0,0,0,0.25);
    }
    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid #e2e8f0;
    }
    .modal-header h2 { margin: 0; font-size: 1.25rem; }
    .close-btn { background: none; border: none; font-size: 1.25rem; cursor: pointer; color: #64748b; }
    .modal-body {
        padding: 1.5rem;
        overflow-y: auto;
        flex: 1;
    }
    .modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
        padding: 1rem 1.5rem;
        border-top: 1px solid #e2e8f0;
    }

    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; margin-bottom: 0.35rem; font-weight: 600; color: #334155; font-size: 0.9rem; }
    .form-group input, .form-group textarea {
        width: 100%;
        padding: 0.6rem 0.75rem;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        font-size: 0.95rem;
    }
    .form-section-title { margin: 1.25rem 0 0.25rem; font-size: 1rem; color: #334155; }
    .form-section-hint { margin: 0 0 1rem; font-size: 0.85rem; color: #64748b; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .checkbox-row label { display: flex; align-items: center; gap: 0.5rem; font-weight: normal; cursor: pointer; }
    .checkbox-row input { width: auto; }
    .checkbox-inline { display: inline-flex; align-items: center; gap: 0.35rem; font-weight: normal; margin-left: 0.5rem; }

    .fields-section { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #e2e8f0; }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .section-header h3 { margin: 0; font-size: 1rem; }
    .field-item {
        padding: 0.75rem;
        background: #f8fafc;
        border-radius: 8px;
        margin-bottom: 0.75rem;
    }
    .field-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
    }
    .field-label { flex: 1; min-width: 160px; }
    .field-row select { width: auto; min-width: 120px; padding: 0.6rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.95rem; }
    .options-row {
        margin-top: 0.5rem;
        padding-top: 0.5rem;
        border-top: 1px dashed #e2e8f0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
    }
    .option-item { display: flex; align-items: center; gap: 0.25rem; }
    .option-item input { width: 120px; }
</style>
