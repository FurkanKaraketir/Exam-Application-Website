<script lang="ts">
    import { db } from '$lib/firebase';
    import { doc, getDoc, setDoc } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import { fade, fly } from 'svelte/transition';

    let notes: string[] = [];
    let newNote = '';
    let loading = false;

    type NotificationType = 'success' | 'error' | 'warning';
    type Notification = {
        id: number;
        type: NotificationType;
        message: string;
    };

    let notifications: Notification[] = [];
    let notificationId = 0;

    function showNotification(message: string, type: NotificationType = 'success') {
        const id = ++notificationId;
        notifications = [...notifications, { id, type, message }];
        
        setTimeout(() => {
            notifications = notifications.filter(n => n.id !== id);
        }, 5000);
    }

    function removeNotification(id: number) {
        notifications = notifications.filter(n => n.id !== id);
    }

    onMount(async () => {
        await loadNotes();
    });

    async function loadNotes() {
        try {
            loading = true;
            const notesRef = doc(db, "general", "notes");
            const notesSnap = await getDoc(notesRef);
            
            if (notesSnap.exists()) {
                const data = notesSnap.data();
                notes = data.info || [];
            }
            showNotification('Notlar başarıyla yüklendi.', 'success');
        } catch (error) {
            showNotification('Notlar yüklenirken bir hata oluştu.', 'error');
        } finally {
            loading = false;
        }
    }

    async function addNote() {
        if (!newNote.trim()) {
            showNotification('Not boş olamaz.', 'error');
            return;
        }

        try {
            const notesRef = doc(db, "general", "notes");
            await setDoc(notesRef, {
                info: [...notes, newNote.trim()]
            });
            
            notes = [...notes, newNote.trim()];
            newNote = '';
            showNotification('Not başarıyla eklendi.', 'success');
        } catch (error) {
            showNotification('Not eklenirken bir hata oluştu.', 'error');
        }
    }

    async function deleteNote(index: number) {
        try {
            const updatedNotes = notes.filter((_, i) => i !== index);
            const notesRef = doc(db, "general", "notes");
            await setDoc(notesRef, {
                info: updatedNotes
            });
            
            notes = updatedNotes;
            showNotification('Not başarıyla silindi.', 'success');
        } catch (error) {
            showNotification('Not silinirken bir hata oluştu.', 'error');
        }
    }

    async function moveNote(index: number, direction: 'up' | 'down') {
        if ((direction === 'up' && index === 0) || 
            (direction === 'down' && index === notes.length - 1)) {
            return;
        }

        try {
            const newIndex = direction === 'up' ? index - 1 : index + 1;
            const updatedNotes = [...notes];
            [updatedNotes[index], updatedNotes[newIndex]] = [updatedNotes[newIndex], updatedNotes[index]];

            const notesRef = doc(db, "general", "notes");
            await setDoc(notesRef, {
                info: updatedNotes
            });
            
            notes = updatedNotes;
            showNotification('Not sırası başarıyla değiştirildi.', 'success');
        } catch (error) {
            showNotification('Not sırası değiştirilirken bir hata oluştu.', 'error');
        }
    }

    async function editNote(index: number, newValue: string) {
        if (!newValue.trim()) {
            showNotification('Not boş olamaz.', 'error');
            return;
        }

        try {
            const updatedNotes = [...notes];
            updatedNotes[index] = newValue.trim();

            const notesRef = doc(db, "general", "notes");
            await setDoc(notesRef, {
                info: updatedNotes
            });
            
            notes = updatedNotes;
            showNotification('Not başarıyla güncellendi.', 'success');
        } catch (error) {
            showNotification('Not güncellenirken bir hata oluştu.', 'error');
        }
    }
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
            >
                ✕
            </button>
        </div>
    {/each}
</div>

<main class="container">
    <div class="header">
        <h1>Sınav Notları Yönetimi</h1>
        <a href="/admin" class="back-btn">← Yönetim Paneline Dön</a>
    </div>

    <div class="content">
        <div class="add-note-section">
            <form on:submit|preventDefault={addNote}>
                <div class="form-group">
                    <label for="newNote">Yeni Not</label>
                    <div class="input-group">
                        <input
                            type="text"
                            id="newNote"
                            bind:value={newNote}
                            placeholder="Yeni not ekleyin..."
                        />
                        <button type="submit" class="add-btn">Ekle</button>
                    </div>
                </div>
            </form>
        </div>

        <div class="notes-list">
            <h2>Mevcut Notlar</h2>
            {#if loading}
                <div class="loading">Yükleniyor...</div>
            {:else if notes.length === 0}
                <div class="empty-state">Henüz not eklenmemiş.</div>
            {:else}
                {#each notes as note, index}
                    <div class="note-item">
                        <div class="note-content">
                            <input
                                type="text"
                                value={note}
                                on:change={(e) => editNote(index, (e.target as HTMLInputElement).value)}
                            />
                        </div>
                        <div class="note-actions">
                            <button 
                                class="move-btn" 
                                on:click={() => moveNote(index, 'up')}
                                disabled={index === 0}
                            >
                                ↑
                            </button>
                            <button 
                                class="move-btn" 
                                on:click={() => moveNote(index, 'down')}
                                disabled={index === notes.length - 1}
                            >
                                ↓
                            </button>
                            <button 
                                class="delete-btn" 
                                on:click={() => deleteNote(index)}
                            >
                                Sil
                            </button>
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
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

    .back-btn {
        padding: 0.75rem 1.5rem;
        background: #4a5568;
        color: white;
        text-decoration: none;
        border-radius: 8px;
        transition: all 0.3s ease;
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

    h1 {
        color: #2d3748;
        margin: 0;
        font-size: 2rem;
    }

    h2 {
        color: #2d3748;
        margin-bottom: 1.5rem;
        font-size: 1.5rem;
    }

    .form-group {
        margin-bottom: 2rem;
    }

    label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: #2d3748;
    }

    .input-group {
        display: flex;
        gap: 1rem;
    }

    input {
        flex: 1;
        padding: 0.875rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        transition: all 0.2s ease;
    }

    input:focus {
        outline: none;
        border-color: #3182ce;
        box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
    }

    .add-btn {
        padding: 0.875rem 2rem;
        background: linear-gradient(to right, #3182ce, #2c5282);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .add-btn:hover {
        background: linear-gradient(to right, #2c5282, #2a4365);
        transform: translateY(-1px);
    }

    .notes-list {
        margin-top: 2rem;
    }

    .note-item {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        margin-bottom: 1rem;
        transition: all 0.2s ease;
    }

    .note-item:hover {
        border-color: #3182ce;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .note-content {
        flex: 1;
    }

    .note-content input {
        width: 100%;
    }

    .note-actions {
        display: flex;
        gap: 0.5rem;
    }

    .move-btn {
        padding: 0.5rem;
        background: #4a5568;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .move-btn:disabled {
        background: #cbd5e0;
        cursor: not-allowed;
    }

    .move-btn:not(:disabled):hover {
        background: #2d3748;
    }

    .delete-btn {
        padding: 0.5rem 1rem;
        background: #e53e3e;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .delete-btn:hover {
        background: #c53030;
    }

    .loading {
        text-align: center;
        color: #4a5568;
        padding: 2rem;
    }

    .empty-state {
        text-align: center;
        color: #4a5568;
        padding: 2rem;
        border: 2px dashed #e2e8f0;
        border-radius: 8px;
    }

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
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .notification.success {
        border-left: 4px solid #48bb78;
    }

    .notification.error {
        border-left: 4px solid #f56565;
    }

    .notification.warning {
        border-left: 4px solid #ed8936;
    }

    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-right: 12px;
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
    }

    .close-btn {
        background: none;
        border: none;
        color: #718096;
        cursor: pointer;
        padding: 4px;
        font-size: 1.1rem;
        line-height: 1;
        opacity: 0.7;
        transition: opacity 0.2s ease;
    }

    .close-btn:hover {
        opacity: 1;
    }

    @media (max-width: 768px) {
        .container {
            margin: 1rem;
            padding: 1rem;
        }

        .header {
            flex-direction: column;
            gap: 1rem;
            text-align: center;
        }

        .back-btn {
            width: 100%;
            text-align: center;
        }

        .content {
            padding: 1rem;
        }

        .input-group {
            flex-direction: column;
        }

        .add-btn {
            width: 100%;
        }

        .note-item {
            flex-direction: column;
            align-items: stretch;
        }

        .note-actions {
            justify-content: flex-end;
            margin-top: 1rem;
        }
    }
</style> 