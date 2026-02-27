<script lang="ts">
    import { db } from '$lib/firebase';
    import { doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import { fade, fly } from 'svelte/transition';
    import * as XLSX from 'xlsx';

    interface SystemSettings {
        applicationStartDate: string;
        applicationDeadline: string;
        examDate: string;
        resultsReleaseDate: string;
        applicationEnabled: boolean;
        resultsEnabled: boolean;
        eventsEnabled: boolean;
        currentYear: number;
        currentPhase: 'application' | 'exam' | 'results' | 'completed';
        resultsFileUrl?: string;
        lastUpdated: Date;
    }

    interface PastYear {
        year: number;
        examDate: string;
        resultsReleaseDate: string;
        totalApplications: number;
        resultsFileUrl?: string;
        statistics?: {
            totalCapacity: number;
            assignedCount: number;
            passedCount: number;
        };
    }

    let settings: SystemSettings = {
        applicationStartDate: '',
        applicationDeadline: '',
        examDate: '',
        resultsReleaseDate: '',
        applicationEnabled: false,
        resultsEnabled: false,
        eventsEnabled: true,
        currentYear: 2026,
        currentPhase: 'application',
        lastUpdated: new Date()
    };

    let pastYears: PastYear[] = [];
    let isLoadingSettings = true;
    let isLoadingPastYears = true;
    let selectedFile: File | null = null;
    let isUploadingResults = false;

    // Notifications system
    type NotificationType = 'success' | 'error' | 'warning' | 'info';
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
        await Promise.all([
            loadSettings(),
            loadPastYears()
        ]);
    });

    async function loadSettings() {
        try {
            isLoadingSettings = true;
            const settingsRef = doc(db, "system", "settings");
            const settingsSnap = await getDoc(settingsRef);
            
            if (settingsSnap.exists()) {
                const data = settingsSnap.data();
                settings = {
                    applicationStartDate: data.applicationStartDate || '',
                    applicationDeadline: data.applicationDeadline || '',
                    examDate: data.examDate || '',
                    resultsReleaseDate: data.resultsReleaseDate || '',
                    applicationEnabled: data.applicationEnabled || false,
                    resultsEnabled: data.resultsEnabled || false,
                    eventsEnabled: data.eventsEnabled !== false,
                    currentYear: data.currentYear || 2026,
                    currentPhase: data.currentPhase || 'application',
                    resultsFileUrl: data.resultsFileUrl || '',
                    lastUpdated: data.lastUpdated?.toDate() || new Date()
                };
            } else {
                // Create default settings
                await setDoc(settingsRef, {
                    ...settings,
                    lastUpdated: new Date()
                });
            }
            // Removed success notification to reduce spam on page load
        } catch (error) {
            console.error('Error loading settings:', error);
            showNotification('Sistem ayarları yüklenirken hata oluştu.', 'error');
        } finally {
            isLoadingSettings = false;
        }
    }

    async function loadPastYears() {
        try {
            isLoadingPastYears = true;
            const pastYearsRef = collection(db, "pastYears");
            const pastYearsSnap = await getDocs(pastYearsRef);
            
            pastYears = pastYearsSnap.docs.map(doc => ({
                year: parseInt(doc.id),
                ...doc.data()
            } as PastYear)).sort((a, b) => b.year - a.year);
            
            // Removed success notification to reduce spam on page load
        } catch (error) {
            console.error('Error loading past years:', error);
            showNotification('Geçmiş yıllar yüklenirken hata oluştu.', 'error');
        } finally {
            isLoadingPastYears = false;
        }
    }

    async function saveSettings() {
        // Validate start date vs deadline
        if (settings.applicationStartDate && settings.applicationDeadline) {
            const startDate = new Date(settings.applicationStartDate);
            const deadlineDate = new Date(settings.applicationDeadline);
            if (startDate >= deadlineDate) {
                showNotification('Başvuru başlangıç tarihi, son başvuru tarihinden önce olmalıdır.', 'error');
                return;
            }
        }

        // Validate dates
        if (settings.examDate && settings.applicationDeadline) {
            const examDate = new Date(settings.examDate);
            const deadlineDate = new Date(settings.applicationDeadline);
            
            if (examDate <= deadlineDate) {
                showNotification('Sınav tarihi, başvuru son tarihinden sonra olmalıdır.', 'error');
                return;
            }
        }

        if (settings.resultsReleaseDate && settings.examDate) {
            const resultsDate = new Date(settings.resultsReleaseDate);
            const examDate = new Date(settings.examDate);
            
            if (resultsDate <= examDate) {
                showNotification('Sonuç açıklama tarihi, sınav tarihinden sonra olmalıdır.', 'error');
                return;
            }
        }

        // Validate current year
        if (settings.currentYear < 2026 || settings.currentYear > 2030) {
            showNotification('Geçerli bir yıl giriniz (2026-2030).', 'error');
            return;
        }

        try {
            const settingsRef = doc(db, "system", "settings");
            await setDoc(settingsRef, {
                ...settings,
                lastUpdated: new Date()
            });
            
            showNotification('Sistem ayarları başarıyla kaydedildi.', 'success');
        } catch (error) {
            console.error('Error saving settings:', error);
            showNotification('Sistem ayarları kaydedilirken hata oluştu.', 'error');
        }
    }


    async function changePhase(newPhase: 'application' | 'exam' | 'results' | 'completed') {
        try {
            // Automatically set system states based on phase
            let applicationEnabled = false;
            let resultsEnabled = false;
            
            switch (newPhase) {
                case 'application':
                    applicationEnabled = true;
                    break;
                case 'exam':
                    // Both systems disabled during exam
                    break;
                case 'results':
                    resultsEnabled = true;
                    break;
                case 'completed':
                    // Both systems disabled when completed
                    break;
            }
            
            const settingsRef = doc(db, "system", "settings");
            await updateDoc(settingsRef, {
                currentPhase: newPhase,
                applicationEnabled,
                resultsEnabled,
                lastUpdated: new Date()
            });
            
            settings.currentPhase = newPhase;
            settings.applicationEnabled = applicationEnabled;
            settings.resultsEnabled = resultsEnabled;
            
            const phaseNames = {
                'application': 'Başvuru Dönemi',
                'exam': 'Sınav Dönemi',
                'results': 'Sonuç Dönemi',
                'completed': 'Tamamlandı'
            };
            
            showNotification(`Sistem "${phaseNames[newPhase]}" aşamasına alındı.`, 'success');
        } catch (error) {
            console.error('Error changing phase:', error);
            showNotification('Sistem aşaması değiştirilemedi.', 'error');
        }
    }

    async function handleFileUpload() {
        if (!selectedFile) {
            showNotification('Lütfen bir dosya seçin.', 'error');
            return;
        }

        if (!selectedFile.name.endsWith('.xlsx')) {
            showNotification('Lütfen .xlsx formatında bir dosya seçin.', 'error');
            return;
        }

        try {
            isUploadingResults = true;
            
            // Read and validate file
            const arrayBuffer = await selectedFile.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length <= 1) {
                throw new Error('Dosya boş veya geçersiz formatta.');
            }

            // Store file (in real implementation, you'd upload to Firebase Storage)
            // For now, we'll store the filename and mark as uploaded
            const fileName = `results_${settings.currentYear}_${Date.now()}.xlsx`;
            
            const settingsRef = doc(db, "system", "settings");
            await updateDoc(settingsRef, {
                resultsFileUrl: fileName,
                lastUpdated: new Date()
            });
            
            settings.resultsFileUrl = fileName;
            selectedFile = null;
            
            showNotification('Sonuç dosyası başarıyla yüklendi.', 'success');
        } catch (error) {
            console.error('Error uploading results:', error);
            showNotification('Sonuç dosyası yüklenirken hata oluştu.', 'error');
        } finally {
            isUploadingResults = false;
        }
    }

    async function archiveCurrentYear() {
        // Confirmation dialog
        if (!confirm(`${settings.currentYear} yılını arşivlemek ve yeni yıl için sistemi sıfırlamak istediğinizden emin misiniz? Bu işlem geri alınamaz!`)) {
            return;
        }

        try {
            // Get current year statistics
            const applicationsRef = collection(db, "examApplications");
            const applicationsSnap = await getDocs(applicationsRef);
            const totalApplications = applicationsSnap.size;

            // Calculate statistics
            let totalCapacity = 0;
            let assignedCount = 0;
            
            const schoolsRef = collection(db, "schools");
            const schoolsSnap = await getDocs(schoolsRef);
            
            for (const schoolDoc of schoolsSnap.docs) {
                const hallsRef = collection(db, "schools", schoolDoc.id, "examHalls");
                const hallsSnap = await getDocs(hallsRef);
                
                for (const hallDoc of hallsSnap.docs) {
                    totalCapacity += (hallDoc.data().capacity || 0);
                    
                    const studentsRef = collection(db, "schools", schoolDoc.id, "examHalls", hallDoc.id, "students");
                    const studentsSnap = await getDocs(studentsRef);
                    assignedCount += studentsSnap.size;
                }
            }

            // Create past year record
            const pastYearData: PastYear = {
                year: settings.currentYear,
                examDate: settings.examDate,
                resultsReleaseDate: settings.resultsReleaseDate,
                totalApplications,
                resultsFileUrl: settings.resultsFileUrl,
                statistics: {
                    totalCapacity,
                    assignedCount,
                    passedCount: 0 // This would be calculated from results
                }
            };

            const pastYearRef = doc(db, "pastYears", settings.currentYear.toString());
            await setDoc(pastYearRef, pastYearData);

            // Delete all applications from current year
            const deletionPromises: Promise<void>[] = [];
            applicationsSnap.forEach(appDoc => {
                deletionPromises.push(deleteDoc(appDoc.ref));
            });
            await Promise.all(deletionPromises);

            // Clear student assignments from all exam halls
            const hallCleanupPromises: Promise<void>[] = [];
            for (const schoolDoc of schoolsSnap.docs) {
                const hallsRef = collection(db, "schools", schoolDoc.id, "examHalls");
                const hallsSnap = await getDocs(hallsRef);
                
                for (const hallDoc of hallsSnap.docs) {
                    const studentsRef = collection(db, "schools", schoolDoc.id, "examHalls", hallDoc.id, "students");
                    const studentsSnap = await getDocs(studentsRef);
                    
                    studentsSnap.forEach(studentDoc => {
                        hallCleanupPromises.push(deleteDoc(studentDoc.ref));
                    });
                }
            }
            await Promise.all(hallCleanupPromises);

            // Update settings for new year
            const newYear = settings.currentYear + 1;
            const settingsRef = doc(db, "system", "settings");
            await updateDoc(settingsRef, {
                currentYear: newYear,
                currentPhase: 'application',
                applicationDeadline: '',
                examDate: '',
                resultsReleaseDate: '',
                resultsFileUrl: '',
                applicationEnabled: false,
                resultsEnabled: false,
                eventsEnabled: settings.eventsEnabled,
                lastUpdated: new Date()
            });

            settings.currentYear = newYear;
            settings.currentPhase = 'application';
            settings.applicationDeadline = '';
            settings.examDate = '';
            settings.resultsReleaseDate = '';
            settings.resultsFileUrl = '';
            settings.applicationEnabled = false;
            settings.resultsEnabled = false;

            await loadPastYears();
            showNotification(`${pastYearData.year} yılı arşivlendi ve sistem ${newYear} yılı için hazırlandı.`, 'success');
        } catch (error) {
            console.error('Error archiving year:', error);
            showNotification('Yıl arşivlenirken hata oluştu.', 'error');
        }
    }

    async function deletePastYear(year: number) {
        if (!confirm(`${year} yılına ait tüm verileri kalıcı olarak silmek istediğinizden emin misiniz?\n\nBu işlem geri alınamaz!`)) {
            return;
        }

        try {
            const pastYearRef = doc(db, "pastYears", year.toString());
            await deleteDoc(pastYearRef);
            
            pastYears = pastYears.filter(py => py.year !== year);
            showNotification(`${year} yılı başarıyla silindi.`, 'success');
        } catch (error) {
            console.error('Error deleting past year:', error);
            showNotification('Geçmiş yıl silinirken hata oluştu.', 'error');
        }
    }

    function getPhaseColor(phase: string): string {
        switch (phase) {
            case 'application': return '#14b8a6';
            case 'exam': return '#d69e2e';
            case 'results': return '#38a169';
            case 'completed': return '#805ad5';
            default: return '#718096';
        }
    }

    function getPhaseIcon(phase: string): string {
        switch (phase) {
            case 'application': return '📝';
            case 'exam': return '📊';
            case 'results': return '📋';
            case 'completed': return '✅';
            default: return '❓';
        }
    }

    async function toggleEventsEnabled() {
        try {
            const newValue = !settings.eventsEnabled;
            const settingsRef = doc(db, "system", "settings");
            await updateDoc(settingsRef, {
                eventsEnabled: newValue,
                lastUpdated: new Date()
            });
            settings.eventsEnabled = newValue;
            showNotification(newValue ? 'Etkinlik başvurusu butonu açıldı.' : 'Etkinlik başvurusu butonu kapatıldı.', 'success');
        } catch (error) {
            showNotification('Ayar güncellenirken hata oluştu.', 'error');
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
                {:else if notification.type === 'warning'}
                    <span class="icon" aria-hidden="true">⚠</span>
                {:else}
                    <span class="icon" aria-hidden="true">ℹ</span>
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
    <h1>Sistem Ayarları ve Yönetimi</h1>

    <!-- Current Year Overview -->
    <div class="current-year-card">
        <div class="year-header">
            <h2>{settings.currentYear} Eğitim-Öğretim Yılı</h2>
            <div class="phase-indicator" style="background-color: {getPhaseColor(settings.currentPhase)}">
                <span class="phase-icon">{getPhaseIcon(settings.currentPhase)}</span>
                <span class="phase-text">
                    {#if settings.currentPhase === 'application'}BAŞVURU DÖNEMİ
                    {:else if settings.currentPhase === 'exam'}SINAV DÖNEMİ
                    {:else if settings.currentPhase === 'results'}SONUÇ DÖNEMİ
                    {:else}TAMAMLANDI
                    {/if}
                </span>
            </div>
        </div>

        <div class="status-info">
            <div class="status-item">
                <span class="status-icon">{settings.applicationEnabled ? '🟢' : '🔴'}</span>
                <span class="status-text">
                    Başvuru Sistemi: <strong>{settings.applicationEnabled ? 'Aktif — Öğrenciler geçerli tarihler içinde başvuru yapabilir' : 'Kapalı — Yeni başvuru alınmıyor'}</strong>
                </span>
            </div>
            
            <div class="status-item">
                <span class="status-icon">{settings.resultsEnabled ? '🟢' : '🔴'}</span>
                <span class="status-text">
                    Sonuç Sistemi: <strong>{settings.resultsEnabled ? 'Aktif — Sonuçlar görüntülenebilir' : 'Kapalı — Sonuçlar gizli'}</strong>
                </span>
            </div>

            <div class="status-item status-item-toggle">
                <span class="status-icon">{settings.eventsEnabled ? '🟢' : '🔴'}</span>
                <span class="status-text">
                    Etkinlik Başvurusu: <strong>{settings.eventsEnabled ? 'Aktif — Ana sayfada buton görünür' : 'Kapalı — Buton gizli'}</strong>
                </span>
                <button
                    type="button"
                    class="toggle-btn"
                    on:click={toggleEventsEnabled}
                    title={settings.eventsEnabled ? 'Kapat' : 'Aç'}
                >
                    {settings.eventsEnabled ? 'Kapat' : 'Aç'}
                </button>
            </div>
        </div>
    </div>

    <!-- System Phase Control -->
    <div class="phase-control-card">
        <h3>
            <span class="section-icon">🔄</span>
            Sistem Aşaması Yönetimi
        </h3>
        <p class="phase-description">
            Sistem aşamasını seçin. Aşama otomatik olarak ilgili sistemleri etkinleştirir veya kapatır.
        </p>
        <div class="phase-buttons">
            <button 
                type="button"
                class="phase-btn {settings.currentPhase === 'application' ? 'active' : ''}"
                on:click={() => changePhase('application')}
            >
                <span class="phase-emoji">📝</span>
                <span class="phase-name">Başvuru Dönemi</span>
                <span class="phase-hint">Başvurular açık</span>
            </button>
            <button 
                type="button"
                class="phase-btn {settings.currentPhase === 'exam' ? 'active' : ''}"
                on:click={() => changePhase('exam')}
            >
                <span class="phase-emoji">📊</span>
                <span class="phase-name">Sınav Dönemi</span>
                <span class="phase-hint">Sınav devam ediyor</span>
            </button>
            <button 
                type="button"
                class="phase-btn {settings.currentPhase === 'results' ? 'active' : ''}"
                on:click={() => changePhase('results')}
            >
                <span class="phase-emoji">📋</span>
                <span class="phase-name">Sonuç Dönemi</span>
                <span class="phase-hint">Sonuçlar açık</span>
            </button>
            <button 
                type="button"
                class="phase-btn {settings.currentPhase === 'completed' ? 'active' : ''}"
                on:click={() => changePhase('completed')}
            >
                <span class="phase-emoji">✅</span>
                <span class="phase-name">Tamamlandı</span>
                <span class="phase-hint">Süreç bitti</span>
            </button>
        </div>
    </div>

    <!-- System Settings Configuration -->
    <div class="settings-configuration">
        <h3>Tarih ve Yıl Ayarları</h3>
        <p class="section-description">Başvuru son tarihi, sınav tarihi ve sonuç açıklama tarihini belirleyin. Bu tarihler ana sayfada öğrencilere gösterilir.</p>
        
        <form on:submit|preventDefault={saveSettings}>
            <div class="settings-grid">
                <div class="form-group">
                    <label for="applicationStartDate">
                        <span class="label-icon">🟢</span>
                        Başvuru Başlangıç Tarihi
                    </label>
                    <input
                        type="datetime-local"
                        id="applicationStartDate"
                        bind:value={settings.applicationStartDate}
                    />
                    <small class="helper-text">Ana sayfada geri sayım bu tarihe kadar gösterilir — boş bırakılabilir</small>
                </div>

                <div class="form-group">
                    <label for="applicationDeadline">
                        <span class="label-icon">📅</span>
                        Başvuru Son Tarihi
                    </label>
                    <input
                        type="datetime-local"
                        id="applicationDeadline"
                        bind:value={settings.applicationDeadline}
                        required
                    />
                    <small class="helper-text">Öğrencilerin başvuru yapabileceği son tarih</small>
                </div>
                
                <div class="form-group">
                    <label for="examDate">
                        <span class="label-icon">📊</span>
                        Sınav Tarihi
                    </label>
                    <input
                        type="datetime-local"
                        id="examDate"
                        bind:value={settings.examDate}
                        required
                    />
                    <small class="helper-text">Başvuru son tarihinden sonra olmalıdır</small>
                </div>
                
                <div class="form-group">
                    <label for="resultsReleaseDate">
                        <span class="label-icon">📋</span>
                        Sonuç Açıklama Tarihi
                    </label>
                    <input
                        type="datetime-local"
                        id="resultsReleaseDate"
                        bind:value={settings.resultsReleaseDate}
                        required
                    />
                    <small class="helper-text">Sınav tarihinden sonra olmalıdır</small>
                </div>
                
                <div class="form-group">
                    <label for="currentYear">
                        <span class="label-icon">🗓️</span>
                        Mevcut Yıl
                    </label>
                    <input
                        type="number"
                        id="currentYear"
                        bind:value={settings.currentYear}
                        min="2026"
                        max="2030"
                    />
                    <small class="helper-text">Eğitim-öğretim yılı</small>
                </div>
            </div>
            
            <div class="form-actions">
                <button type="submit" class="save-settings-btn">
                    💾 Tarih Ayarlarını Kaydet
                </button>
            </div>
        </form>
    </div>

    <!-- Results File Management -->
    <div class="results-management">
        <h3>Sonuç Dosyası Yönetimi</h3>
        <p class="section-description">Öğrencilerin sınav sonuçlarını içeren Excel dosyasını (.xlsx) yükleyin. Yüklenen dosya, "Sonuç Dönemi" aşamasında öğrencilere açılır.</p>
        
        <div class="upload-section">
            <div class="file-input-container">
                <input 
                    type="file" 
                    accept=".xlsx"
                    on:change={(e) => {
                        const target = e.target as HTMLInputElement;
                        selectedFile = target.files?.[0] || null;
                    }}
                    id="results-file"
                />
                <label for="results-file" class="file-label">
                    {selectedFile ? selectedFile.name : 'Sonuç dosyası seçin (.xlsx)'}
                </label>
            </div>
            
            <button 
                class="upload-btn"
                on:click={handleFileUpload}
                disabled={!selectedFile || isUploadingResults}
            >
                {isUploadingResults ? '⏳ Yükleniyor...' : '📤 Dosyayı Yükle'}
            </button>
        </div>

        {#if settings.resultsFileUrl}
            <div class="current-file">
                <span class="file-icon">📄</span>
                <span class="file-name">Mevcut dosya: {settings.resultsFileUrl}</span>
                <span class="file-date">
                    Son güncelleme: {settings.lastUpdated.toLocaleDateString('tr-TR')}
                </span>
            </div>
        {/if}
    </div>

    <!-- Year Management -->
    <div class="year-management">
        <h3>Yıl Yönetimi ve Arşivleme</h3>
        
        <div class="archive-section">
            <p>
                <strong>⚠️ Dikkat:</strong> Bu işlem mevcut yılın tüm başvurularını ve salon atamalarını arşive taşır, ardından sistemi yeni yıl için sıfırlar.
                <br><br>
                Arşivleme yapılmadan önce <strong>Excel'e Aktar</strong> ile tüm başvuruların yedeğini alınız.
                Bu işlem <strong>geri alınamaz</strong>.
            </p>
            <button class="archive-btn" on:click={archiveCurrentYear}>
                📦 {settings.currentYear} Yılını Arşivle ve {settings.currentYear + 1} İçin Hazırla
            </button>
        </div>
    </div>

    <!-- Past Years Section -->
    <div class="past-years">
        <h3>Geçmiş Yıllar</h3>
        
        {#if isLoadingPastYears}
            <div class="loading" role="status" aria-live="polite">Geçmiş yıllar yükleniyor...</div>
        {:else if pastYears.length === 0}
            <div class="empty-state">
                <span class="empty-icon">📚</span>
                <p>Henüz arşivlenmiş yıl bulunmuyor.</p>
            </div>
        {:else}
            <div class="past-years-grid">
                {#each pastYears as pastYear}
                    <div class="past-year-card" transition:fade>
                        <div class="past-year-header">
                            <h4>{pastYear.year} Yılı</h4>
                            <button 
                                class="delete-year-btn"
                                on:click={() => deletePastYear(pastYear.year)}
                                title="Bu yılı sil"
                            >
                                🗑️
                            </button>
                        </div>
                        
                        <div class="past-year-stats">
                            <div class="stat-item">
                                <span class="stat-label">Sınav Tarihi:</span>
                                <span class="stat-value">{pastYear.examDate || 'Belirtilmemiş'}</span>
                            </div>
                            
                            <div class="stat-item">
                                <span class="stat-label">Toplam Başvuru:</span>
                                <span class="stat-value">{pastYear.totalApplications}</span>
                            </div>
                            
                            {#if pastYear.statistics}
                                <div class="stat-item">
                                    <span class="stat-label">Kapasite:</span>
                                    <span class="stat-value">{pastYear.statistics.totalCapacity}</span>
                                </div>
                                
                                <div class="stat-item">
                                    <span class="stat-label">Atanan:</span>
                                    <span class="stat-value">{pastYear.statistics.assignedCount}</span>
                                </div>
                            {/if}
                            
                            {#if pastYear.resultsFileUrl}
                                <div class="stat-item">
                                    <span class="stat-label">Sonuç Dosyası:</span>
                                    <span class="stat-value file-indicator">📄 Mevcut</span>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</main>

<style>
    .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 2rem;
    }

    h1 {
        color: #2d3748;
        margin-bottom: 2rem;
        text-align: center;
        font-size: 2.5rem;
        font-weight: 700;
        position: relative;
        padding-bottom: 1rem;
    }

    h1::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 120px;
        height: 3px;
        background: linear-gradient(to right, #0d9488, #115e59);
        border-radius: 2px;
    }

    .current-year-card {
        background: linear-gradient(135deg, #0d9488 0%, #115e59 100%);
        border-radius: 16px;
        padding: 2rem;
        margin-bottom: 2rem;
        color: white;
        box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
    }

    .year-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2rem;
    }

    .year-header h2 {
        margin: 0;
        font-size: 2rem;
        font-weight: 700;
    }

    .phase-indicator {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.5rem;
        border-radius: 25px;
        background: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.3);
    }

    .phase-icon {
        font-size: 1.2rem;
    }

    .phase-text {
        font-weight: 600;
        font-size: 0.9rem;
        letter-spacing: 0.5px;
    }

    .status-info {
        display: flex;
        gap: 2rem;
        flex-wrap: wrap;
    }

    .status-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 1rem;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .status-icon {
        font-size: 1.2rem;
    }

    .status-text {
        color: white;
        font-weight: 500;
        font-size: 0.95rem;
    }

    .status-item-toggle {
        flex-wrap: wrap;
    }

    .toggle-btn {
        margin-left: auto;
        padding: 0.35rem 0.75rem;
        font-size: 0.85rem;
        font-weight: 600;
        background: rgba(255, 255, 255, 0.25);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.4);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
    }

    .toggle-btn:hover {
        background: rgba(255, 255, 255, 0.35);
    }

    .phase-control-card {
        background: white;
        border-radius: 12px;
        padding: 2rem;
        margin-bottom: 2rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        border: 2px solid #14b8a6;
    }

    .phase-control-card h3 {
        color: #2d3748;
        margin-bottom: 0.75rem;
        font-size: 1.5rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .phase-description {
        color: #718096;
        margin-bottom: 1.5rem;
        font-size: 0.95rem;
    }

    .section-description {
        color: #718096;
        font-size: 0.9rem;
        margin-bottom: 1.5rem;
        padding: 0.75rem 1rem;
        background: #f8fafc;
        border-left: 3px solid #14b8a6;
        border-radius: 0 6px 6px 0;
        line-height: 1.6;
    }

    .settings-configuration,
    .phase-management,
    .results-management,
    .year-management,
    .past-years {
        background: white;
        border-radius: 12px;
        padding: 2rem;
        margin-bottom: 2rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        border: 1px solid #e2e8f0;
    }

    .settings-configuration h3,
    .phase-management h3,
    .results-management h3,
    .year-management h3,
    .past-years h3 {
        color: #2d3748;
        margin-bottom: 1.5rem;
        font-size: 1.5rem;
        font-weight: 600;
    }

    .phase-buttons {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
    }

    .phase-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 1.5rem 1rem;
        border: 2px solid #e2e8f0;
        border-radius: 12px;
        background: white;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .phase-emoji {
        font-size: 2.5rem;
        display: block;
    }

    .phase-name {
        color: #2d3748;
        font-weight: 700;
        font-size: 1rem;
        text-align: center;
    }

    .phase-hint {
        color: #718096;
        font-size: 0.85rem;
        text-align: center;
    }

    .phase-btn:hover {
        border-color: #14b8a6;
        background: #f7fafc;
        transform: translateY(-4px);
        box-shadow: 0 8px 20px rgba(49, 130, 206, 0.15);
    }

    .phase-btn.active {
        background: linear-gradient(135deg, #0d9488 0%, #115e59 100%);
        border-color: #115e59;
        box-shadow: 0 8px 25px rgba(49, 130, 206, 0.4);
    }

    .phase-btn.active .phase-name,
    .phase-btn.active .phase-hint {
        color: white;
    }

    .upload-section {
        display: flex;
        gap: 1rem;
        align-items: center;
        margin-bottom: 1rem;
        flex-wrap: wrap;
    }

    .file-input-container {
        position: relative;
        flex: 1;
        min-width: 250px;
    }

    .file-input-container input[type="file"] {
        position: absolute;
        opacity: 0;
        width: 100%;
        height: 100%;
        cursor: pointer;
    }

    .file-label {
        display: block;
        padding: 1rem;
        border: 2px dashed #cbd5e0;
        border-radius: 8px;
        background: #f8fafc;
        color: #4a5568;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
        text-align: center;
    }

    .file-label:hover {
        border-color: #14b8a6;
        background: #ebf8ff;
    }

    .upload-btn {
        padding: 1rem 2rem;
        background: linear-gradient(to right, #0d9488, #115e59);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        white-space: nowrap;
    }

    .upload-btn:hover:not(:disabled) {
        background: linear-gradient(to right, #115e59, #134e4a);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(49, 130, 206, 0.2);
    }

    .upload-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .current-file {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
        background: #f0fff4;
        border: 1px solid #9ae6b4;
        border-radius: 8px;
        color: #2f855a;
    }

    .file-icon {
        font-size: 1.5rem;
    }

    .file-name {
        font-weight: 600;
    }

    .file-date {
        color: #68d391;
        font-size: 0.9rem;
    }

    .archive-section {
        text-align: center;
        padding: 2rem;
        background: linear-gradient(135deg, #fef5e7 0%, #fed7aa 100%);
        border-radius: 12px;
        border: 1px solid #f6ad55;
    }

    .archive-section p {
        color: #c05621;
        margin-bottom: 1.5rem;
        font-size: 1.1rem;
    }

    .archive-btn {
        padding: 1rem 2rem;
        background: linear-gradient(to right, #ed8936, #dd6b20);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        font-size: 1.1rem;
    }

    .archive-btn:hover {
        background: linear-gradient(to right, #dd6b20, #c05621);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(237, 137, 54, 0.3);
    }

    .loading {
        text-align: center;
        padding: 2rem;
        color: #718096;
        font-style: italic;
    }

    .empty-state {
        text-align: center;
        padding: 3rem;
        color: #718096;
    }

    .empty-icon {
        font-size: 3rem;
        display: block;
        margin-bottom: 1rem;
    }

    .past-years-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1.5rem;
    }

    .past-year-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 1.5rem;
        transition: all 0.3s ease;
    }

    .past-year-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
    }

    .past-year-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
    }

    .past-year-header h4 {
        margin: 0;
        color: #2d3748;
        font-size: 1.3rem;
        font-weight: 600;
    }

    .delete-year-btn {
        background: none;
        border: none;
        font-size: 1.2rem;
        cursor: pointer;
        padding: 0.5rem;
        border-radius: 4px;
        transition: all 0.2s ease;
    }

    .delete-year-btn:hover {
        background: #fed7d7;
    }

    .past-year-stats {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .stat-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .stat-label {
        color: #4a5568;
        font-weight: 500;
    }

    .stat-value {
        color: #2d3748;
        font-weight: 600;
    }

    .file-indicator {
        color: #38a169;
    }

    .settings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
    }

    .label-icon {
        font-size: 1.1rem;
        margin-right: 0.5rem;
    }

    .section-icon {
        font-size: 1.3rem;
    }

    .form-actions {
        display: flex;
        justify-content: center;
        margin-top: 1rem;
    }

    .save-settings-btn {
        padding: 1rem 3rem;
        background: linear-gradient(to right, #38a169, #2f855a);
        color: white;
        border: none;
        border-radius: 12px;
        font-weight: 700;
        font-size: 1.1rem;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(56, 161, 105, 0.3);
    }

    .save-settings-btn:hover {
        background: linear-gradient(to right, #2f855a, #276749);
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(56, 161, 105, 0.4);
    }

    .form-group {
        margin-bottom: 1.5rem;
    }

    .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: #2d3748;
        display: flex;
        align-items: center;
    }

    .form-group input {
        width: 100%;
        padding: 0.75rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        background-color: #f8fafc;
        transition: all 0.2s ease;
    }

    .form-group input:focus {
        outline: none;
        border-color: #14b8a6;
        box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
        background-color: #ffffff;
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

    .notification:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
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

    .notification.info {
        border-left: 4px solid #14b8a6;
    }

    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-right: 12px;
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        padding: 0;
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

    .success .icon {
        background: #48bb78;
        color: white;
    }

    .error .icon {
        background: #f56565;
        color: white;
    }

    .warning .icon {
        background: #ed8936;
        color: white;
    }

    .info .icon {
        background: #14b8a6;
        color: white;
    }

    .message {
        color: #2d3748;
        font-size: 0.95rem;
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

    .helper-text {
        display: block;
        color: #718096;
        font-size: 0.875rem;
        margin-top: 0.5rem;
        padding-left: 0.25rem;
    }

    @media (max-width: 768px) {
        .container {
            padding: 1rem;
        }

        h1 {
            font-size: 2rem;
        }

        .year-header {
            flex-direction: column;
            gap: 1rem;
            text-align: center;
        }

        .status-info {
            flex-direction: column;
            gap: 0.5rem;
        }

        .phase-buttons {
            grid-template-columns: 1fr;
            gap: 0.75rem;
        }

        .phase-btn {
            padding: 1.25rem 1rem;
        }

        .phase-emoji {
            font-size: 2rem;
        }

        .settings-grid {
            grid-template-columns: 1fr;
        }

        .upload-section {
            flex-direction: column;
        }

        .file-input-container {
            min-width: auto;
            width: 100%;
        }

        .past-years-grid {
            grid-template-columns: 1fr;
        }

        .stat-item {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.25rem;
        }

        .notifications {
            top: 10px;
            right: 10px;
            left: 10px;
            max-width: none;
        }
    }
</style> 