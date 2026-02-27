<script lang="ts">
    import { db, storage } from '$lib/firebase';
    import { collection, getDocs, query, doc, updateDoc, deleteField } from 'firebase/firestore';
    import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
    import { onMount } from 'svelte';

    interface School {
        id: string;
        name: string;
        locationBarcodeUrl?: string;
        locationBarcodeBase64?: string;
    }

    let schools: School[] = [];
    let selectedSchool: School | null = null;
    let selectedFile: File | null = null;
    let isUploading = false;
    let isRemoving = false;

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
        await loadSchools();
    });

    async function loadSchools() {
        try {
            const schoolsQuery = query(collection(db, "schools"));
            const schoolsSnapshot = await getDocs(schoolsQuery);
            schools = schoolsSnapshot.docs.map(d => ({
                id: d.id,
                name: d.data().name,
                locationBarcodeUrl: d.data().locationBarcodeUrl,
                locationBarcodeBase64: d.data().locationBarcodeBase64
            }));
        } catch (error) {
            console.error('Error loading schools:', error);
            showNotification('Okullar yüklenirken bir hata oluştu.', 'error');
        }
    }

    function selectSchool(school: School) {
        selectedSchool = school;
        selectedFile = null;
    }

    function handleFileChange(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                showNotification('Lütfen bir resim dosyası seçin (PNG, JPG vb.).', 'error');
                return;
            }
            selectedFile = file;
        }
        input.value = '';
    }

    function fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Dosya okunamadı'));
            reader.readAsDataURL(file);
        });
    }

    async function handleUpload() {
        if (!selectedSchool || !selectedFile) {
            showNotification('Lütfen bir okul seçin ve dosya yükleyin.', 'warning');
            return;
        }

        try {
            isUploading = true;
            const storageRef = ref(storage, `location-barcodes/${selectedSchool.id}.png`);
            await uploadBytes(storageRef, selectedFile);
            const downloadUrl = await getDownloadURL(storageRef);
            const base64 = await fileToBase64(selectedFile);

            const schoolRef = doc(db, "schools", selectedSchool.id);
            await updateDoc(schoolRef, {
                locationBarcodeUrl: downloadUrl,
                locationBarcodeBase64: base64
            });

            schools = schools.map(s =>
                s.id === selectedSchool!.id
                    ? { ...s, locationBarcodeUrl: downloadUrl, locationBarcodeBase64: base64 }
                    : s
            );
            selectedSchool = { ...selectedSchool, locationBarcodeUrl: downloadUrl, locationBarcodeBase64: base64 };
            selectedFile = null;

            showNotification('Konum barkodu başarıyla yüklendi.', 'success');
        } catch (error) {
            console.error('Error uploading barcode:', error);
            const msg = error instanceof Error ? error.message : 'Bilinmeyen hata';
            showNotification(`Yükleme hatası: ${msg}`, 'error');
        } finally {
            isUploading = false;
        }
    }

    async function handleRemove() {
        if (!selectedSchool) return;

        try {
            isRemoving = true;
            const storageRef = ref(storage, `location-barcodes/${selectedSchool.id}.png`);
            try {
                await deleteObject(storageRef);
            } catch (e) {
                // File might not exist in storage (e.g. was from static folder)
            }

            const schoolRef = doc(db, "schools", selectedSchool.id);
            await updateDoc(schoolRef, {
                locationBarcodeUrl: deleteField(),
                locationBarcodeBase64: deleteField()
            });

            schools = schools.map(s =>
                s.id === selectedSchool!.id
                    ? { ...s, locationBarcodeUrl: undefined, locationBarcodeBase64: undefined }
                    : s
            );
            selectedSchool = { ...selectedSchool, locationBarcodeUrl: undefined, locationBarcodeBase64: undefined };

            showNotification('Konum barkodu kaldırıldı.', 'success');
        } catch (error) {
            console.error('Error removing barcode:', error);
            showNotification('Barkod kaldırılırken bir hata oluştu.', 'error');
        } finally {
            isRemoving = false;
        }
    }

    function getBarcodeSrc(school: School): string {
        if (school.locationBarcodeUrl) return school.locationBarcodeUrl;
        return `/${school.id}.png`;
    }
</script>

<div class="notifications">
    {#each notifications as notification (notification.id)}
        <div
            class="notification {notification.type}"
            on:click={() => removeNotification(notification.id)}
            on:keydown={(e) => e.key === 'Enter' && removeNotification(notification.id)}
            role="button"
            tabindex="0"
        >
            <div class="notification-content">
                {#if notification.type === 'success'}
                    <span class="icon">✓</span>
                {:else if notification.type === 'error'}
                    <span class="icon">✕</span>
                {:else}
                    <span class="icon">!</span>
                {/if}
                <span class="message">{notification.message}</span>
            </div>
            <button class="close-btn" on:click|stopPropagation={() => removeNotification(notification.id)}>✕</button>
        </div>
    {/each}
</div>

<main class="container">
    <h1>Konum Barkodları Yönetimi</h1>
    <p class="description">
        Her sınav binası için konum barkodu/QR kodu yükleyin. Bu barkodlar sınav giriş belgelerinde "Okul Konumu" alanında görünür.
    </p>

    <div class="school-grid">
        {#each schools as school}
            <button
                class="school-card"
                class:selected={selectedSchool?.id === school.id}
                on:click={() => selectSchool(school)}
            >
                <div class="barcode-preview">
                    <img
                        src={getBarcodeSrc(school)}
                        alt="{school.name} konum barkodu"
                        on:error={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                        }}
                    />
                    <span class="no-barcode hidden">Barkod yok</span>
                </div>
                <span class="school-name">{school.name}</span>
            </button>
        {/each}
    </div>

    {#if selectedSchool}
        <section class="manage-section">
            <h2>{selectedSchool.name} — Barkod Yönetimi</h2>
            <div class="manage-content">
                <div class="preview-area">
                    <img
                        src={selectedFile ? URL.createObjectURL(selectedFile) : getBarcodeSrc(selectedSchool)}
                        alt="Önizleme"
                        class="preview-img"
                        on:error={(e) => {
                            const el = e.target as HTMLImageElement;
                            if (!selectedFile) el.style.display = 'none';
                        }}
                    />
                    {#if !selectedFile && !selectedSchool.locationBarcodeUrl}
                        <p class="no-preview">Henüz barkod yüklenmedi</p>
                    {/if}
                </div>
                <div class="actions">
                    <label class="upload-label">
                        <input
                            type="file"
                            accept="image/*"
                            on:change={handleFileChange}
                        />
                        <span class="btn upload-btn">📤 Dosya Seç</span>
                    </label>
                    {#if selectedFile}
                        <span class="file-name">{selectedFile.name}</span>
                        <button
                            class="btn save-btn"
                            on:click={handleUpload}
                            disabled={isUploading}
                        >
                            {isUploading ? '⏳ Yükleniyor...' : '💾 Yükle'}
                        </button>
                    {/if}
                    {#if selectedSchool.locationBarcodeUrl}
                        <button
                            class="btn remove-btn"
                            on:click={handleRemove}
                            disabled={isRemoving}
                        >
                            {isRemoving ? '⏳ Kaldırılıyor...' : '🗑️ Barkodu Kaldır'}
                        </button>
                    {/if}
                </div>
            </div>
        </section>
    {/if}
</main>

<style>
    .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 2rem;
    }

    h1 {
        color: #2d3748;
        margin-bottom: 0.5rem;
        text-align: center;
        font-size: 2rem;
        font-weight: 700;
    }

    .description {
        text-align: center;
        color: #718096;
        margin-bottom: 2rem;
        font-size: 1rem;
    }

    .school-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 1rem;
        margin-bottom: 2rem;
    }

    .school-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 1rem;
        background: white;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .school-card:hover {
        border-color: #14b8a6;
        box-shadow: 0 4px 12px rgba(20, 184, 166, 0.15);
    }

    .school-card.selected {
        border-color: #0d9488;
        background: #f0fdfa;
        box-shadow: 0 4px 12px rgba(13, 148, 136, 0.25);
    }

    .barcode-preview {
        width: 80px;
        height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f8fafc;
        border-radius: 6px;
        margin-bottom: 0.5rem;
        overflow: hidden;
    }

    .barcode-preview img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    }

    .no-barcode {
        font-size: 0.75rem;
        color: #a0aec0;
    }

    .no-barcode.hidden {
        display: none;
    }

    .school-name {
        font-size: 0.875rem;
        font-weight: 500;
        color: #2d3748;
        text-align: center;
    }

    .manage-section {
        background: white;
        border-radius: 8px;
        padding: 2rem;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .manage-section h2 {
        margin: 0 0 1.5rem;
        font-size: 1.25rem;
        color: #2d3748;
    }

    .manage-content {
        display: flex;
        gap: 2rem;
        flex-wrap: wrap;
    }

    .preview-area {
        width: 150px;
        height: 150px;
        background: #f8fafc;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    }

    .preview-img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    }

    .no-preview {
        color: #a0aec0;
        font-size: 0.875rem;
    }

    .actions {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        flex: 1;
        min-width: 200px;
    }

    .upload-label input {
        display: none;
    }

    .btn {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        font-size: 1rem;
        transition: all 0.2s;
    }

    .upload-btn {
        background: #e2e8f0;
        color: #2d3748;
    }

    .upload-btn:hover {
        background: #cbd5e0;
    }

    .save-btn {
        background: linear-gradient(to right, #0d9488, #115e59);
        color: white;
    }

    .save-btn:hover:not(:disabled) {
        background: linear-gradient(to right, #115e59, #134e4a);
    }

    .save-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
    }

    .remove-btn {
        background: #e53e3e;
        color: white;
    }

    .remove-btn:hover:not(:disabled) {
        background: #c53030;
    }

    .remove-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
    }

    .file-name {
        font-size: 0.875rem;
        color: #718096;
    }

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
        padding: 1rem 1.5rem;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        cursor: pointer;
    }

    .notification.success { background: #d1fae5; color: #065f46; }
    .notification.error { background: #fee2e2; color: #991b1b; }
    .notification.warning { background: #fef3c7; color: #92400e; }

    .notification-content { display: flex; align-items: center; gap: 0.5rem; flex: 1; }
    .close-btn { background: none; border: none; cursor: pointer; padding: 0.25rem; }
</style>
