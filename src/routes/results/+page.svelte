<script lang="ts">
    import { onMount } from 'svelte';
    import * as XLSX from 'xlsx';
    import { db } from '$lib/firebase';
    import { doc, getDoc } from 'firebase/firestore';

    // System settings interface
    interface SystemSettings {
        applicationDeadline: string;
        examDate: string;
        resultsReleaseDate: string;
        applicationEnabled: boolean;
        resultsEnabled: boolean;
        currentYear: number;
        currentPhase: 'application' | 'exam' | 'results' | 'completed';
        resultsFileUrl?: string;
        lastUpdated: Date;
    }

    // Load system settings
    let systemSettings: SystemSettings | null = null;
    let isLoadingSettings = true;

    // Basic TC ID validation (move to $lib/utils later if needed)
    function validateTCID(tcId: string): boolean {
        // Basic format checks
        if (tcId.length !== 11) return false;
        if (tcId[0] === '0') return false;
        if (!/^\d{11}$/.test(tcId)) return false;

        // Calculate sum of first 10 digits
        let sum = 0;
        for (let i = 0; i < 10; i++) {
            sum += parseInt(tcId[i]);
        }

        // Check if last digit equals sum modulo 10
        return parseInt(tcId[10]) === (sum % 10);
    }

    // Helper to format result values (e.g., numbers) - Moved up for structure definition
    function formatValue(value: string | number | undefined): string {
        if (value === undefined || value === null) return ''; // Handle potential undefined values
        if (typeof value === 'number') {
            // Format numbers with 2 decimal places if they have decimals, handle potential floating point inaccuracies
            return Number.isInteger(value) ? String(value) : parseFloat(value.toFixed(2)).toString();
        }
        return String(value);
    }

    // Define the expected structure based on the image
    const NAME_COLUMN_INDEX = 0;
    const TC_COLUMN_INDEX_IN_FILE = 1; // Assuming this is the index in the raw data

    const SUBJECTS = [
        { name: 'TÜRKÇE', indices: { doğru: 2, yanlış: 3, boş: 4, net: 5 } },
        { name: 'SOSYAL BİLGİLER', indices: { doğru: 6, yanlış: 7, boş: 8, net: 9 } },
        { name: 'DİN KÜLTÜRÜ VE AHLAK BİLGİSİ', indices: { doğru: 10, yanlış: 11, boş: 12, net: 13 } },
        { name: 'İNGİLİZCE', indices: { doğru: 14, yanlış: 15, boş: 16, net: 17 } },
        { name: 'MATEMATİK', indices: { doğru: 18, yanlış: 19, boş: 20, net: 21 } },
        { name: 'FEN BİLİMLERİ', indices: { doğru: 22, yanlış: 23, boş: 24, net: 25 } }
    ];

    const OVERALL_INFO = [
        { name: 'Toplam Net', index: 26 },
        { name: 'Puan', index: 27 },
        { name: 'Sıralama', index: 28 },
        { name: 'Durumu', index: 29 }
    ];

    let allResults: any[][] = []; // Store as array of arrays
    let tcColumnIndex = -1; // Store the actual index of TC Kimlik No
    let isLoading = true;
    let error: string | null = null;

    let tcIdInput = '';
    let searchedResult: any[] | null | undefined = undefined; // Store the raw result row: undefined: not searched, null: not found
    let searchError: string | null = null;
    let tcIdError: string = '';

    // const TC_COLUMN_HEADER = 'Kimlik No'; // No longer needed, using fixed index

    // Time-related variables
    let days = 0;
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    let isCountdownFinished = false;
    let isResultsAvailable = false;
    let currentServerTime: Date | null = null;
    let timeError: string | null = null;

    // Results release time - will be loaded from system settings
    let RESULTS_RELEASE_DATE: Date | null = null;

    // Function to fetch current time from server-side API
    async function fetchCurrentTime(): Promise<Date> {
        try {
            const response = await fetch('/api/time', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                signal: AbortSignal.timeout(5000) // 5-second timeout
            });

            if (!response.ok) {
                throw new Error('Failed to fetch server time');
            }

            const data = await response.json();
            return new Date(data.time);
        } catch (error) {
            console.warn('Server time fetch error:', error);
            // Fallback to system time
            return new Date();
        }
    }

    async function loadSystemSettings() {
        try {
            isLoadingSettings = true;
            const settingsRef = doc(db, "system", "settings");
            const settingsSnap = await getDoc(settingsRef);
            
            if (settingsSnap.exists()) {
                const data = settingsSnap.data();
                systemSettings = {
                    applicationDeadline: data.applicationDeadline || '',
                    examDate: data.examDate || '',
                    resultsReleaseDate: data.resultsReleaseDate || '',
                    applicationEnabled: data.applicationEnabled || false,
                    resultsEnabled: data.resultsEnabled || false,
                    currentYear: data.currentYear || 2026,
                    currentPhase: data.currentPhase || 'application',
                    resultsFileUrl: data.resultsFileUrl || '',
                    lastUpdated: data.lastUpdated?.toDate() || new Date()
                };
                
                // Set results release date from settings
                if (systemSettings.resultsReleaseDate) {
                    RESULTS_RELEASE_DATE = new Date(systemSettings.resultsReleaseDate);
                }
                
                // Don't set isResultsAvailable here - let updateCountdown() handle it
                // Results will only be available when countdown finishes AND resultsEnabled is true
            }
        } catch (error) {
            console.error('Error loading system settings:', error);
            timeError = 'Sistem ayarları yüklenemedi.';
        } finally {
            isLoadingSettings = false;
        }
    }

    function updateCountdown() {
        if (!currentServerTime || !RESULTS_RELEASE_DATE) return;

        const now = currentServerTime;
        const difference = RESULTS_RELEASE_DATE.getTime() - now.getTime();

        if (difference > 0) {
            days = Math.floor(difference / (1000 * 60 * 60 * 24));
            hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
            seconds = Math.floor((difference % (1000 * 60)) / 1000);
            
            // Countdown is still running - don't show results yet
            isCountdownFinished = false;
            isResultsAvailable = false;
        } else {
            // Time has passed - hide countdown
            isCountdownFinished = true;
            
            // Only show results if admin has enabled them
            if (systemSettings?.resultsEnabled) {
                isResultsAvailable = true;
            } else {
                isResultsAvailable = false;
            }
        }
    }

    onMount(() => {
        let countdownInterval: NodeJS.Timeout;

        async function initializeTime() {
            try {
                // Load system settings first
                await loadSystemSettings();
                
                // Fetch current time when component mounts
                currentServerTime = await fetchCurrentTime();
                
                // Update countdown immediately
                updateCountdown();

                // Set up interval to update countdown and refresh time periodically
                countdownInterval = setInterval(async () => {
                    try {
                        // Refresh server time periodically
                        currentServerTime = await fetchCurrentTime();
                        updateCountdown();

                        if (isResultsAvailable && isCountdownFinished) {
                            clearInterval(countdownInterval);
                        }
                    } catch (error) {
                        console.error('Countdown update error:', error);
                        timeError = 'Zaman senkronizasyonunda hata oluştu.';
                    }
                }, 1000);
            } catch (error) {
                console.error('Initial time fetch error:', error);
                timeError = 'Zaman bilgisi alınamadı.';
            }
        }

        initializeTime();

        // Cleanup interval on component destroy
        return () => {
            if (countdownInterval) {
                clearInterval(countdownInterval);
            }
        };
    });

    onMount(async () => {
        try {
            const response = await fetch('/results.xlsx');
            if (!response.ok) {
                throw new Error(`Sonuç dosyası yüklenemedi: ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            // Use header: 1 to get array of arrays, easier to map later
            const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length > 1) { // Need at least header + 1 data row
                // const fileHeaders = jsonData[0].map(String); // No longer reading headers
                // tcColumnIndex = fileHeaders.indexOf(TC_COLUMN_HEADER); // Removed dynamic lookup
                //
                // if (tcColumnIndex === -1) {
                //     throw new Error(`"${TC_COLUMN_HEADER}" sütunu sonuç dosyasında bulunamadı.`);
                // }

                // Directly use the predefined index based on the image structure
                tcColumnIndex = TC_COLUMN_INDEX_IN_FILE;

                // Store all result rows as arrays, skipping the header row
                allResults = jsonData.slice(1);

            } else {
                error = "Sonuç dosyası boş veya geçersiz formatta.";
            }
        } catch (err) {
            console.error('Error loading results:', err);
            error = 'Sonuçlar yüklenirken bir hata oluştu.';
            if (err instanceof Error) {
                 error = `Hata: ${err.message}`;
            }
        } finally {
            isLoading = false;
        }
    });

    function handleTCInput(event: Event) {
        const input = event.target as HTMLInputElement;
        const formatted = input.value.replace(/[^0-9]/g, '').slice(0, 11);
        tcIdInput = formatted;
        input.value = tcIdInput; // Update input visually

        if (formatted.length === 0) {
            tcIdError = '';
            input.setCustomValidity('');
        } else if (formatted.length !== 11) {
            tcIdError = 'Lütfen istenen biçimi eşleştirin.';
            input.setCustomValidity(tcIdError);
        } else if (!validateTCID(formatted)) {
            tcIdError = 'Geçersiz T.C. Kimlik Numarası. Lütfen kontrol ediniz.';
            input.setCustomValidity(tcIdError);
        } else {
            tcIdError = '';
            input.setCustomValidity('');
        }

        searchError = null; // Clear previous search errors on input change
        searchedResult = undefined; // Reset search result on new input
    }

    function searchResult() {
        searchError = null;
        searchedResult = undefined;

        if (tcIdError) {
            searchError = 'Lütfen geçerli bir T.C. Kimlik Numarası giriniz.';
            return;
        }

        if (isLoading || error || tcColumnIndex === -1) return; // Don't search if data isn't ready, failed loading, or TC column not found

        const found = allResults.find(row => row && String(row[tcColumnIndex]) === tcIdInput); // Search using the found TC index

        if (found) {
            searchedResult = found;
        } else {
            searchedResult = null; // Explicitly null for "not found"
            searchError = 'Bu T.C. Kimlik Numarasına ait sonuç bulunamadı.';
        }
    }

</script>

<main class="container">
    {#if !isCountdownFinished}
    <div class="countdown-container">
        <div class="countdown-title">Sonuç Açıklama Zamanına Kalan</div>
        <div class="countdown">
            <div class="countdown-item">
                <span class="countdown-value">{days}</span>
                <span class="countdown-label">Gün</span>
            </div>
            <div class="countdown-item">
                <span class="countdown-value">{hours}</span>
                <span class="countdown-label">Saat</span>
            </div>
            <div class="countdown-item">
                <span class="countdown-value">{minutes}</span>
                <span class="countdown-label">Dakika</span>
            </div>
            <div class="countdown-item">
                <span class="countdown-value">{seconds}</span>
                <span class="countdown-label">Saniye</span>
            </div>
        </div>
        <div class="countdown-date">
            {#if RESULTS_RELEASE_DATE}
                Sonuç Açıklama Tarihi: {RESULTS_RELEASE_DATE.toLocaleDateString('tr-TR', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })}
            {:else}
                Sonuç açıklama tarihi henüz belirlenmemiş.
            {/if}
        </div>
    </div>
    {/if}

    {#if isResultsAvailable}
    <h1>Sınav Sonuçları Sorgulama</h1>

    {#if isLoading}
        <div class="loading-message">Sonuç verileri yükleniyor...</div>
    {:else if error}
        <div class="error-message">{error}</div>
    {:else}
        <form class="form" on:submit|preventDefault={searchResult}>
            <div class="form-group">
                <label for="tcId">T.C. Kimlik Numaranız:</label>
                <input
                    type="text"
                    id="tcId"
                    bind:value={tcIdInput}
                    on:input={handleTCInput}
                    placeholder="11 Haneli T.C. Kimlik No"
                    maxlength="11"
                    required
                    aria-invalid={tcIdError !== ''}
                    class:invalid={tcIdError !== ''}
                />
                {#if tcIdError}
                    <p class="error-message">{tcIdError}</p>
                {/if}
            </div>
            <button type="submit" class="submit-btn" disabled={isLoading || tcIdError !== '' || tcIdInput.length !== 11}>
                 Sonucu Göster
            </button>
        </form>

        {#if searchError}
            <div class="notification error search-error">
                <div class="notification-content">
                     <span class="icon" aria-hidden="true">✕</span>
                    <span class="message">{searchError}</span>
                </div>
            </div>
        {/if}

        {#if searchedResult === null}
            <!-- Message handled by searchError -->
        {:else if searchedResult}
             {@const status = formatValue(searchedResult[OVERALL_INFO[3].index])}
             <div class="exam-info">
                 <h2>Sonuç Detayları</h2>

                 <!-- Student Info -->
                 <div class="student-info info-section">
                     <h3>Öğrenci Bilgisi</h3>
                     <div class="info-item">
                         <span class="label">Ad Soyad:</span>
                         <span class="value">{formatValue(searchedResult[NAME_COLUMN_INDEX])}</span>
                     </div>
                     <!-- Optionally show TC ID again, or keep it hidden -->
                     <!-- <div class="info-item">
                         <span class="label">Kimlik No:</span>
                         <span class="value">{formatValue(searchedResult[tcColumnIndex])}</span>
                     </div> -->
                 </div>

                 <!-- Overall Results -->
                 <div class="overall-results info-section">
                     <h3>Genel Sonuç</h3>
                     <div class="overall-grid">
                         {#each OVERALL_INFO.slice(0, 3) as item}
                             <div class="info-item overall-item">
                                 <span class="label">{item.name}:</span>
                                 <span class="value bold">
                                     {formatValue(searchedResult[item.index])}
                                 </span>
                             </div>
                         {/each}
                     </div>
                     
                     <!-- Status card in the middle -->
                     <div class="status-card">
                         <span class="label">{OVERALL_INFO[3].name}:</span>
                         <span
                             class="value"
                             class:status-success={formatValue(searchedResult[OVERALL_INFO[3].index]).includes('ASİL KAYIT HAKKI KAZANDINIZ')}
                             class:status-warning={formatValue(searchedResult[OVERALL_INFO[3].index]).includes('YEDEK KAYIT HAKKI KAZANDINIZ')}
                             class:status-danger={formatValue(searchedResult[OVERALL_INFO[3].index]).includes('KAZANAMADINIZ')}
                             class:status-pending={formatValue(searchedResult[OVERALL_INFO[3].index]).includes('BEKLİYOR')}
                         >
                             {formatValue(searchedResult[OVERALL_INFO[3].index])}
                         </span>
                     </div>

                     <!-- Registration Info Section -->
                     {#if status.includes('ASİL KAYIT HAKKI KAZANDINIZ')}
                         <div class="registration-info asil-info">
                             <h3>Kayıt Bilgileri</h3>
                             <p>Asil Kayıt Hakkı kazandınız. Kayıt işlemleri için <strong>30 Nisan</strong> tarihine kadar okul müdürlüğüne başvurmanız gerekmektedir.</p>
                         </div>
                     {:else if status.includes('YEDEK KAYIT HAKKI KAZANDINIZ')}
                         <div class="registration-info yedek-info">
                             <h3>Kayıt Bilgileri</h3>
                             <p>Yedek Kayıt Hakkı kazandınız. Yedek kayıtlar <strong>2 Mayıs</strong> tarihinden itibaren kontenjan dahilinde sırası ile davet edilecektir. Okul duyurularını takip ediniz.</p>
                         </div>
                     {/if}
                     <!-- End Registration Info Section -->
                 </div>

                 <!-- Subject Details -->
                 <div class="subject-details info-section">
                    <h3>Ders Başarıları</h3>
                    {#each SUBJECTS as subject}
                        <div class="subject-item">
                            <h4>{subject.name}</h4>
                            <div class="subject-grid">
                                <div class="info-item sub-item">
                                    <span class="label">Doğru:</span>
                                    <span class="value">{formatValue(searchedResult[subject.indices.doğru])}</span>
                                </div>
                                <div class="info-item sub-item">
                                    <span class="label">Yanlış:</span>
                                    <span class="value">{formatValue(searchedResult[subject.indices.yanlış])}</span>
                                </div>
                                <div class="info-item sub-item">
                                    <span class="label">Boş:</span>
                                    <span class="value">{formatValue(searchedResult[subject.indices.boş])}</span>
                                </div>
                                <div class="info-item sub-item net-item">
                                    <span class="label">Net:</span>
                                    <span class="value bold">{formatValue(searchedResult[subject.indices.net])}</span>
                                </div>
                            </div>
                        </div>
                    {/each}
                 </div>

             </div>
        {/if}
    {/if}
    {:else}
    <div class="not-available-container">
        {#if isLoadingSettings}
            <h2>Sistem Bilgileri Yükleniyor...</h2>
            <p>Lütfen bekleyiniz.</p>
        {:else if !systemSettings?.resultsEnabled && !RESULTS_RELEASE_DATE}
            <h2>Sonuç Sistemi Henüz Hazır Değil</h2>
            <p>Sonuç açıklama tarihi henüz belirlenmemiştir.</p>
            <p>Lütfen daha sonra tekrar kontrol ediniz.</p>
        {:else if RESULTS_RELEASE_DATE}
            <h2>Sonuçlar Henüz Açıklanmadı</h2>
            <p>Sonuçlar {RESULTS_RELEASE_DATE.toLocaleDateString('tr-TR', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })} tarihinde açıklanacaktır.</p>
            <p>Lütfen belirtilen tarih ve saatte tekrar kontrol ediniz.</p>
        {:else}
            <h2>Sonuçlar Henüz Hazır Değil</h2>
            <p>Sonuç sistemi şu anda aktif değildir.</p>
            <p>Lütfen daha sonra tekrar kontrol ediniz.</p>
        {/if}
    </div>
    {/if}
</main>

<style>
    /* Global styles */
    :global(body) {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
        background-color: #f4f7f9; /* Light gray background */
        color: #333;
        line-height: 1.6;
    }

    .container {
        max-width: 850px;
        margin: 3rem auto; /* Increased top/bottom margin */
        padding: 2.5rem; /* Increased padding */
        background: #ffffff;
        border-radius: 16px; /* Softer radius */
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08); /* Enhanced shadow */
        overflow: hidden; /* Ensure child elements respect border radius */
        transition: all 0.3s ease;
    }

    /* Form styles */
    .form {
        display: flex;
        flex-direction: column;
        gap: 1.5rem; /* Adjusted gap */
        margin-bottom: 2.5rem; /* Increased bottom margin */
        max-width: 500px;
        margin-left: auto;
        margin-right: auto;
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    label {
        font-weight: 600;
        color: #4a5568; /* Slightly muted label color */
        font-size: 0.9rem;
        transition: color 0.2s ease;
    }

    input[type="text"] {
        padding: 1rem 1.2rem; /* Increased padding */
        border: 1px solid #cbd5e0; /* Softer border */
        border-radius: 10px;
        font-size: 1rem;
        transition: all 0.2s ease-in-out;
        background-color: #f8fafc;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.03);
    }

    input[type="text"]:focus {
        outline: none;
        border-color: #14b8a6; /* Teal focus border */
        box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.2);
        background-color: #ffffff;
    }

    .submit-btn {
        background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); /* Updated gradient */
        color: white;
        padding: 1rem 1.2rem; /* Increased padding */
        border: none;
        border-radius: 10px;
        font-size: 1.05rem; /* Slightly adjusted font size */
        font-weight: 600;
        cursor: pointer;
        transition: all 0.25s ease;
        margin-top: 0.75rem; /* Increased top margin */
        text-transform: uppercase;
        letter-spacing: 0.8px; /* Added letter spacing */
        box-shadow: 0 4px 10px rgba(49, 130, 206, 0.2); /* Added subtle shadow */
    }

    .submit-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: #e2e8f0; /* Gray disabled background */
        box-shadow: none;
    }

    .submit-btn:not(:disabled):hover {
        background: linear-gradient(135deg, #0d9488 0%, #115e59 100%); /* Darker gradient on hover */
        transform: translateY(-2px);
        box-shadow: 0 6px 15px rgba(13, 148, 136, 0.3);
    }

    .submit-btn:active {
        transform: translateY(0);
        box-shadow: 0 4px 10px rgba(49, 130, 206, 0.2);
    }

    /* Headings */
     h1, h2, h3 {
        color: #2d3748; /* Dark gray-blue */
        font-weight: 700;
        text-align: center; /* Center align all headings */
    }

    h1 {
        font-size: 2.4rem; /* Larger main title */
        margin-bottom: 1.5rem; /* Increased margin */
        padding-bottom: 0; /* Remove padding */
        border-bottom: none; /* Remove border */
        background: linear-gradient(135deg, #2d3748 0%, #4a5568 100%);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }

    h2 { /* "Sonuç Detayları" */
        font-size: 1.9rem;
        margin-bottom: 3rem; /* Increased margin before results */
        position: relative;
        padding-bottom: 0.75rem;
    }

    h2::after { /* Underline for "Sonuç Detayları" */
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 100px; /* Longer underline */
        height: 3px;
        background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); /* Match button gradient */
        border-radius: 1.5px;
    }

    /* Messages */
    .loading-message {
        text-align: center;
        padding: 1.8rem;
        color: #115e59;
        background-color: #ccfbf1;
        border-radius: 10px;
        margin: 2rem auto;
        font-weight: 500;
        max-width: 500px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
        animation: fadeIn 0.5s ease-out;
    }

    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .error-message {
        color: #c53030; /* Darker red */
        font-size: 0.85rem;
        margin-top: 0.3rem;
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }

    .error-message::before {
        content: '⚠️';
        font-size: 0.9rem; /* Slightly smaller icon */
    }

    .invalid {
        border-color: #e53e3e !important;
        background-color: #fff5f5;
    }

    /* Notification styles (for search errors) */
    .notification {
        padding: 1.2rem 1.8rem;
        margin: 2.5rem auto; /* Centered with auto margins */
        border-radius: 10px;
        background: white;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); /* Enhanced shadow */
        display: flex;
        align-items: center;
        border-left: 5px solid transparent; /* Prepare for color border */
        max-width: 650px;
        animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .notification.error {
        border-left-color: #e53e3e; /* Red border */
        background-color: #fff5f5; /* Light red background */
    }

    .notification-content {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        text-align: left;
    }

    .icon {
        flex-shrink: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        font-weight: bold;
        font-size: 0.9rem;
    }

    .notification.error .icon {
        background: #e53e3e;
        color: white;
    }

    .message {
        color: #4a5568; /* Darker text color */
        font-size: 0.95rem;
        font-weight: 500;
    }

    /* Exam info sections */
    .exam-info {
        margin-top: 3rem;
        padding: 0; /* Remove padding from main container */
        background: none; /* Remove background */
        border: none; /* Remove border */
        border-radius: 0;
        animation: fadeUp 0.6s ease-out;
    }

    @keyframes fadeUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .info-section {
        margin-bottom: 3rem; /* Increased spacing between sections */
        padding-bottom: 2.5rem;
        border-bottom: 1px solid #e2e8f0; /* Standard separator */
        transition: all 0.3s ease;
    }
    
    .info-section:last-child {
        margin-bottom: 0;
        padding-bottom: 0;
        border-bottom: none;
    }

    .info-section h3 { /* Section titles: Öğrenci, Genel, Ders */
        font-size: 1.5rem; /* Larger section titles */
        color: #14b8a6; /* Teal color for titles */
        margin-bottom: 2rem;
        text-align: center; /* Center align section titles */
        padding-bottom: 0.6rem;
        border-bottom: 2px solid #bee3f8; /* Lighter blue underline */
        display: inline-block; /* Allow centering */
        position: relative;
        left: 50%;
        transform: translateX(-50%);
    }

    /* Student Info Specific */
    .student-info {
        padding: 2rem;
        background-color: #f8fafc;
        border-radius: 12px;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.04);
    }

    .student-info .info-item {
        display: flex;
        justify-content: center; /* Center student name */
        align-items: baseline; /* Align baseline of label and value */
        gap: 0.75rem;
        text-align: center;
        margin-top: 0.5rem; /* Space above name */
    }

    .student-info .label {
        font-weight: 500; /* Normal weight for label */
        color: #718096; /* Gray color */
        font-size: 1rem;
    }

    .student-info .value {
        font-weight: 700; /* Bold name */
        color: #2d3748;
        font-size: 1.3rem; /* Larger name */
    }

    /* Overall Results Specific */
    .overall-results {
        background: linear-gradient(135deg, #e6f7ff 0%, #f0f7ff 100%); /* Gradient background */
        padding: 2.5rem; /* More padding */
        border-radius: 16px; /* Rounded corners */
        border: none; /* Remove border */
        text-align: center; /* Center align content */
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.05);
    }

    .overall-results h3 {
        margin-bottom: 2.5rem; /* More space after title */
        color: #2b6cb0; /* Darker blue */
        text-align: center; /* Center the h3 */
        display: block; /* Ensure it takes full width for centering */
        width: 100%; /* Full width to allow centering */
    }

    .overall-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1.5rem;
        margin-bottom: 0;
    }

    .overall-item {
        background: rgba(255, 255, 255, 0.7); /* Semi-transparent white background */
        padding: 1.5rem 1rem; /* Add padding */
        border-radius: 12px; /* Rounded corners */
        text-align: center; /* Center text */
        min-width: 150px;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        box-shadow: 0 3px 8px rgba(0, 0, 0, 0.03);
    }

    .overall-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 5px 12px rgba(0, 0, 0, 0.08);
    }

    .overall-item .label {
        display: block; /* Make label take full width */
        font-size: 0.9rem; /* Smaller label */
        color: #4a5568;
        margin-bottom: 0.75rem; /* Space between label and value */
        font-weight: 500;
    }

    .overall-item .value {
        font-size: 1.75rem; /* Much larger value */
        font-weight: 700; /* Bold value */
        color: #115e59; /* Dark teal value */
        line-height: 1.2; /* Adjust line height */
    }

     

     /* Subject Details Specific */
     .subject-details h3 {
        margin-bottom: 2.5rem;
     }

    .subject-item {
        margin-bottom: 2.5rem; /* Space between subjects */
        padding: 1.8rem; /* Add padding around content */
        border-radius: 14px; /* Rounded corners */
        background: #fafafa; /* Very light gray background */
        border: 1px solid #edf2f7; /* Subtle border */
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.03);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .subject-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.06);
    }

    .subject-item:last-child {
        margin-bottom: 0;
    }

    .subject-item h4 { /* Subject names */
        font-size: 1.25rem; /* Larger subject names */
        color: #14b8a6; /* Teal color matching the theme */
        margin-bottom: 1.5rem;
        font-weight: 600;
        text-align: center; /* Center subject names */
        position: relative;
        padding-bottom: 0.5rem;
    }

    .subject-item h4::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 40px;
        height: 2px;
        background-color: #bee3f8;
        border-radius: 1px;
    }

    .subject-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr); /* Four equal columns */
        gap: 1.25rem; /* Increased gap */
        text-align: center; /* Center text in grid cells */
    }

    .sub-item {
        padding: 0.75rem 0.5rem;
        background-color: white;
        border-radius: 8px;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.03);
    }

    .sub-item .label {
        display: block;
        font-size: 0.8rem; /* Small label */
        color: #718096; /* Gray label */
        margin-bottom: 0.35rem;
        font-weight: 500;
        text-transform: uppercase; /* Uppercase label */
        letter-spacing: 0.5px;
    }

    .sub-item .value {
        font-size: 1.1rem; /* Larger value */
        font-weight: 600;
        color: #333;
    }

    .sub-item.net-item {
        background-color: #ebf8ff; /* Light blue background */
    }

    .sub-item.net-item .value {
        font-weight: 700; /* Bolder net value */
        color: #14b8a6; /* Teal net value */
        font-size: 1.2rem; /* Slightly larger net */
    }

    /* Status Card (Durumu) Enhancements */
    .status-card {
        position: relative;
        background: white;
        padding: 1.5rem 2rem;
        border-radius: 12px;
        text-align: center;
        margin: 2rem auto 0.5rem;
        max-width: 320px;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.08);
        border-top: 4px solid #3182ce;
        transition: all 0.3s ease;
        overflow: hidden;
    }

    .status-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, #14b8a6 0%, #5eead4 100%);
    }

    .status-card .label {
        display: block;
        font-size: 1rem;
        font-weight: 600;
        color: #4a5568;
        margin-bottom: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .status-card .value {
        font-size: 1.4rem;
        color: #115e59;
        display: block;
        transition: color 0.3s ease;
    }

    /* Status Variations */
    .status-card .value.status-success {
        color: #2f855a; /* Green for success */
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        position: relative;
        padding: 0.5rem 0;
    }

    .status-card .value.status-success::before {
        content: '✓';
        position: absolute;
        left: -1.5rem;
        top: 50%;
        transform: translateY(-50%);
        background: #48bb78;
        color: white;
        width: 1.2rem;
        height: 1.2rem;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.8rem;
    }

    .status-card .value.status-warning {
        color: #d69e2e; /* Orange for warning */
        font-weight: 600;
    }

    .status-card .value.status-danger {
        color: #e53e3e; /* Red for danger/failure */
        font-weight: 700;
    }

    .status-card .value.status-pending {
        color: #4a5568; /* Gray for pending */
        font-style: italic;
    }

    /* Hover and Interaction */
    .status-card:hover .value.status-success {
        color: #276749;
    }

    .status-card:hover .value.status-warning {
        color: #b7791f;
    }

    .status-card:hover .value.status-danger {
        color: #9b2c2c;
    }

    .status-card:hover .value.status-pending {
        color: #2d3748;
    }

    /* Responsive adjustments */
    @media (max-width: 768px) {
        .container {
            margin: 1.5rem 1rem; /* Adjusted margins */
            padding: 1.5rem; /* Adjusted padding */
        }
        h1 { font-size: 1.8rem; }
        h2 { font-size: 1.5rem; margin-bottom: 2rem; }
        h2::after { width: 60px; }
        .info-section h3 { font-size: 1.2rem; }

        .form { gap: 1.2rem; margin-bottom: 2rem; }
        label { font-size: 0.85rem; }
        input[type="text"] { padding: 0.8rem; font-size: 0.95rem; }
        .submit-btn { padding: 0.8rem; font-size: 1rem; }

        .notification { padding: 0.8rem 1rem; margin: 1.5rem 0; }
        .icon { width: 18px; height: 18px; font-size: 0.8rem; }
        .message { font-size: 0.9rem; }

        .student-info { padding: 1.5rem; }
        .student-info .label { font-size: 0.9rem; }
        .student-info .value { font-size: 1.1rem; }

        .overall-results {
            padding: 1.5rem 1rem;
        }

        .overall-grid {
            grid-template-columns: repeat(2, 1fr); /* Force two columns */
            gap: 1.25rem 1rem;
        }
        
        .overall-item {
            padding: 1rem;
            min-width: auto;
            width: 100%;
        }
        
        .overall-item .label { font-size: 0.8rem; }
        .overall-item .value { font-size: 1.5rem; }

        .subject-details h3 { font-size: 1.2rem; margin-bottom: 1.5rem; }
        .subject-item { padding: 1.25rem; }
        .subject-item h4 { font-size: 1.1rem; margin-bottom: 1rem; }
        .subject-grid {
            grid-template-columns: repeat(2, 1fr); /* Two columns on mobile */
            gap: 0.75rem; /* Adjust gap */
        }
        .sub-item { padding: 0.5rem 0.25rem; }
        .sub-item .label { font-size: 0.75rem; }
        .sub-item .value { font-size: 1rem; }
        .sub-item.net-item .value { font-size: 1.1rem; }

        .status-card {
            padding: 1.2rem 1.5rem;
            margin: 1.5rem auto 0;
            max-width: 280px;
        }
        
        .status-card .label {
            font-size: 0.9rem;
            margin-bottom: 0.5rem;
        }
        
        .status-card .value {
            font-size: 1.2rem;
        }
        
        .status-card .value.status-success {
            font-size: 1.3rem;
        }
    }

    @media (max-width: 480px) {
        .container {
            padding: 1.25rem;
        }
        
        .overall-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 0.75rem;
        }
        
        .status-card {
            padding: 1rem;
            max-width: 250px;
        }
        
        .status-card .value.status-success {
            font-size: 1.1rem;
        }
    }

    /* Util classes */
    .bold {
        font-weight: 700;
    }

    /* Countdown Styles */
    .countdown-container {
        background: linear-gradient(135deg, #e6f2ff 0%, #f0f7ff 100%);
        border-radius: 16px;
        padding: 2.5rem;
        margin-bottom: 2.5rem;
        text-align: center;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
        border: 1px solid #bee3f8;
        animation: fadeIn 0.6s ease-out;
    }

    .countdown-title {
        font-size: 1.4rem;
        font-weight: 600;
        color: #2c5282;
        margin-bottom: 1.5rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .countdown {
        display: flex;
        justify-content: center;
        gap: 2rem;
        margin-bottom: 1.5rem;
    }

    .countdown-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 100px;
        background: white;
        padding: 1rem;
        border-radius: 12px;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .countdown-item:hover {
        transform: translateY(-3px);
        box-shadow: 0 6px 15px rgba(0, 0, 0, 0.1);
    }

    .countdown-value {
        font-size: 2.5rem;
        font-weight: 700;
        color: #14b8a6;
        line-height: 1.2;
        margin-bottom: 0.5rem;
    }

    .countdown-label {
        font-size: 0.9rem;
        color: #4a5568;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .countdown-date {
        font-size: 1rem;
        color: #115e59;
        font-weight: 500;
        opacity: 0.8;
    }

    /* Responsive adjustments for countdown */
    @media (max-width: 768px) {
        .countdown-container {
            padding: 1.5rem;
            margin-bottom: 2rem;
        }

        .countdown-title {
            font-size: 1.2rem;
            margin-bottom: 1.25rem;
        }

        .countdown {
            gap: 1rem;
        }

        .countdown-item {
            min-width: 70px;
            padding: 0.75rem;
        }

        .countdown-value {
            font-size: 2rem;
        }

        .countdown-label {
            font-size: 0.8rem;
        }

        .countdown-date {
            font-size: 0.9rem;
        }
    }

    @media (max-width: 480px) {
        .countdown-container {
            padding: 1.25rem;
        }

        .countdown {
            gap: 0.5rem;
        }

        .countdown-item {
            min-width: 60px;
            padding: 0.5rem;
        }

        .countdown-value {
            font-size: 1.6rem;
        }

        .countdown-label {
            font-size: 0.7rem;
        }
    }

    /* Not Available Container Styles */
    .not-available-container {
        background: linear-gradient(135deg, #f0f4f8 0%, #f9fafb 100%);
        border-radius: 16px;
        padding: 3rem 2.5rem;
        text-align: center;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.06);
        border: 1px solid #e2e8f0;
        animation: fadeIn 0.6s ease-out;
        max-width: 700px;
        margin: 3rem auto;
    }

    .not-available-container h2 {
        font-size: 2rem;
        color: #115e59;
        margin-bottom: 1.5rem;
        font-weight: 700;
    }

    .not-available-container p {
        font-size: 1.1rem;
        color: #4a5568;
        line-height: 1.6;
        margin-bottom: 1rem;
        max-width: 500px;
        margin-left: auto;
        margin-right: auto;
    }

    /* Responsive adjustments for not available container */
    @media (max-width: 768px) {
        .not-available-container {
            padding: 2rem 1.5rem;
            margin: 2rem auto;
        }

        .not-available-container h2 {
            font-size: 1.6rem;
            margin-bottom: 1.25rem;
        }

        .not-available-container p {
            font-size: 1rem;
            margin-bottom: 0.75rem;
        }
    }

    @media (max-width: 480px) {
        .not-available-container {
            padding: 1.5rem 1.25rem;
            margin: 1.5rem auto;
        }

        .not-available-container h2 {
            font-size: 1.4rem;
        }

        .not-available-container p {
            font-size: 0.9rem;
        }
    }

    /* Registration Info Styles */
    .registration-info {
        padding: 1.8rem 2rem;
        margin-top: 2rem; /* Spacing from status card */
        margin-left: auto; /* Center if needed */
        margin-right: auto; /* Center if needed */
        max-width: 650px; /* Match width of overall section better */
        border-radius: 12px;
        background-color: #eef6ff; /* Very light blue background */
        border: 1px solid #a5d8ff; /* Light blue border */
        text-align: center;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
        border-left: 5px solid #14b8a6; /* Accent border */
    }

    .registration-info h3 {
        font-size: 1.3rem;
        color: #2a69ac; /* Slightly darker blue */
        margin-bottom: 1rem;
        border-bottom: none; /* Override general section h3 */
        padding-bottom: 0;
        display: block; /* Override inline-block */
        left: auto; /* Override position */
        transform: none; /* Override transform */
        text-align: center;
    }

    .registration-info p {
        font-size: 1rem;
        color: #374151; /* Dark gray */
        line-height: 1.7;
        max-width: 600px; /* Limit line width for readability */
        margin-left: auto;
        margin-right: auto;
    }

    .registration-info strong {
        font-weight: 700;
        color: #1d4ed8; /* Stronger blue */
    }

    /* Optional: Add icons */
    .registration-info.asil-info::before {
        /* content: '📅'; */ /* Using text instead for simplicity */
        display: block;
        font-size: 1.8rem;
        margin-bottom: 0.5rem;
        color: #1e40af;
    }

    .registration-info.yedek-info::before {
        /* content: '⏳'; */ /* Using text instead for simplicity */
        display: block;
        font-size: 1.8rem;
        margin-bottom: 0.5rem;
        color: #1e40af;
    }

    @media (max-width: 850px) { /* Match container breakpoint more closely */
        .registration-info {
            padding: 1.2rem 1.5rem;
            margin-top: 2rem;
        }
        .registration-info h3 {
            font-size: 1.15rem;
        }
        .registration-info p {
            font-size: 0.9rem;
        }
    }
</style> 