<script lang="ts">
    import { db } from '$lib/firebase';
    import { getBarcodeBase64 } from '$lib/barcode';
    import { collection, doc, getDoc, setDoc, getDocs, deleteDoc, updateDoc } from 'firebase/firestore';
    import { fade, fly } from 'svelte/transition';
    import { onMount } from 'svelte';
    import { jsPDF } from 'jspdf';
    import { goto } from '$app/navigation';
    import { browser } from '$app/environment';
    
    // System settings interface
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

    import { onDestroy } from 'svelte';

    // Load system settings
    let systemSettings: SystemSettings | null = null;
    let isLoadingSettings = true;
    
    // Remove hardcoded values and use dynamic settings
    let applicationStartDate: Date | null = null;
    let applicationDeadline: Date | null = null;
    let examDate: Date | null = null;
    let isApplicationEnabled = false;
    let currentPhase: string = 'application';

    // Countdown timer
    interface CountdownTime { days: number; hours: number; minutes: number; seconds: number; }
    let startCountdownValue: CountdownTime = { days: 0, hours: 0, minutes: 0, seconds: 0 };
    let deadlineCountdownValue: CountdownTime = { days: 0, hours: 0, minutes: 0, seconds: 0 };
    let countdownInterval: ReturnType<typeof setInterval> | null = null;

    function calcCountdown(target: Date): CountdownTime {
        const diff = target.getTime() - Date.now();
        if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
        return {
            days:    Math.floor(diff / 86_400_000),
            hours:   Math.floor((diff % 86_400_000) / 3_600_000),
            minutes: Math.floor((diff % 3_600_000)  / 60_000),
            seconds: Math.floor((diff % 60_000)      / 1_000)
        };
    }

    function tickCountdowns() {
        if (applicationStartDate) startCountdownValue = calcCountdown(applicationStartDate);
        if (applicationDeadline)  deadlineCountdownValue = calcCountdown(applicationDeadline);
    }

    // Reactive: true while the application start date is still in the future
    $: startDateInFuture = applicationStartDate !== null && (
        startCountdownValue.days > 0 ||
        startCountdownValue.hours > 0 ||
        startCountdownValue.minutes > 0 ||
        startCountdownValue.seconds > 0
    );

    function startCountdownTimer() {
        if (countdownInterval) clearInterval(countdownInterval);
        tickCountdowns();
        countdownInterval = setInterval(tickCountdowns, 1000);
    }

    onDestroy(() => { if (countdownInterval) clearInterval(countdownInterval); });
    
    // Check if capacity is full
    let isCapacityFull = false;
    
    let formData = {
        tcId: '',
        studentFullName: '',
        schoolName: '',
        parentFullName: '',
        phoneNumber: '',
    };
    
    let legalErrors = {
        tckn: '',
        phoneNumber: ''
    };

    let examData: {
        tcId: string;
        studentFullName: string;
        studentSchoolName: string;
        parentFullName: string;
        phoneNumber: string;
        schoolName: string;
        hallName: string;
        orderNumber: number;
        schoolId: string;
    } | null = null;

    let isCustomSchool = false;
    let customSchoolName = '';
    let notes: string[] = [];

    type SubmitState = 'idle' | 'submitting' | 'success' | 'error';
    let submitState: SubmitState = 'idle';

    function toTurkishUpperCase(str: string): string {
        return str.replace('i', 'İ')
                 .replace('ı', 'I')
                 .replace('ğ', 'Ğ')
                 .replace('ü', 'Ü')
                 .replace('ş', 'Ş')
                 .replace('ö', 'Ö')
                 .replace('ç', 'Ç')
                 .toUpperCase();
    }

    function handleNameInput(event: Event, field: 'studentFullName' | 'parentFullName') {
        const input = event.target as HTMLInputElement;
        formData[field] = toTurkishUpperCase(input.value);
    }

    const schools: string[] = [
        'NEVŞEHİR - ACIGÖL - Acıgöl 4 Temmuz İlkokulu',
        'NEVŞEHİR - ACIGÖL - Acıgöl Atatürk İlkokulu',
        'NEVŞEHİR - ACIGÖL - Ağıllı İlkokulu',
        'NEVŞEHİR - ACIGÖL - İnallı İlkokulu',
        'NEVŞEHİR - ACIGÖL - Karacaören Cumhuriyet İlkokulu',
        'NEVŞEHİR - ACIGÖL - Karacaören Şehit Yunus Yılmaz İlkokulu',
        'NEVŞEHİR - ACIGÖL - Karapınar Esentepe İlkokulu',
        'NEVŞEHİR - ACIGÖL - Karapınar İlkokulu',
        'NEVŞEHİR - ACIGÖL - Kozluca İlkokulu',
        'NEVŞEHİR - ACIGÖL - Kurugöl 70.Yıl İlkokulu',
        'NEVŞEHİR - ACIGÖL - M.Zeki Hanoğlu İlkokulu',
        'NEVŞEHİR - ACIGÖL - Tatlarin Şehit Ahmet Tekdemir İlkokulu',
        'NEVŞEHİR - ACIGÖL - Tepeköy İlkokulu',
        'NEVŞEHİR - ACIGÖL - Topaç Şehit Bekir Şahin İlkokulu',
        'NEVŞEHİR - AVANOS - Akarca İlkokulu',
        'NEVŞEHİR - AVANOS - Alaettin İlkokulu',
        'NEVŞEHİR - AVANOS - Avanos Cumhuriyet İlkokulu',
        'NEVŞEHİR - AVANOS - Ayhanlar İlkokulu',
        'NEVŞEHİR - AVANOS - Bahçelievler 100.Yıl İlkokulu',
        'NEVŞEHİR - AVANOS - Bozca İlkokulu',
        'NEVŞEHİR - AVANOS - Çalış İlkokulu',
        'NEVŞEHİR - AVANOS - Göynük İlkokulu',
        'NEVŞEHİR - AVANOS - Kalaba Atatürk İlkokulu',
        'NEVŞEHİR - AVANOS - Kalaba Meliha Hamdi Köroğlu İlkokulu',
        'NEVŞEHİR - AVANOS - Kalaba Yunus Emre İlkokulu',
        'NEVŞEHİR - AVANOS - Mahmat Şehit Murat Koç İlkokulu',
        'NEVŞEHİR - AVANOS - Nazife Mustafa Ergün İlkokulu',
        'NEVŞEHİR - AVANOS - Özkonak Mareşal Fevzi Çakmak İlkokulu',
        'NEVŞEHİR - AVANOS - Paşalı Şehit Hasan Güven İlkokulu',
        'NEVŞEHİR - AVANOS - Sarılar İlkokulu',
        'NEVŞEHİR - AVANOS - Şehit Ömer Halisdemir İlkokulu',
        'NEVŞEHİR - AVANOS - Topaklı İlkokulu',
        'NEVŞEHİR - AVANOS - ÜÇKUYU İLKOKULU',
        'NEVŞEHİR - DERİNKUYU - Çakıllı Şehit Kasım Poyraz İlkokulu',
        'NEVŞEHİR - DERİNKUYU - Derinkuyu 15 Temmuz Şehitleri İlkokulu',
        'NEVŞEHİR - DERİNKUYU - Derinkuyu 24 Kasım İlkokulu',
        'NEVŞEHİR - DERİNKUYU - Derinkuyu Atatürk İlkokulu',
        'NEVŞEHİR - DERİNKUYU - Derinkuyu Cumhuriyet İlkokulu',
        'NEVŞEHİR - DERİNKUYU - Doğala İlkokulu',
        'NEVŞEHİR - DERİNKUYU - Güneyce İlkokulu',
        'NEVŞEHİR - DERİNKUYU - Kuyulutatlar Şehit Erhan Karataş İlkokulu',
        'NEVŞEHİR - DERİNKUYU - Özlüce İlkokulu',
        'NEVŞEHİR - DERİNKUYU - Suvermez İlkokulu',
        'NEVŞEHİR - DERİNKUYU - Til İlkokulu',
        'NEVŞEHİR - DERİNKUYU - Yazıhüyük Gazi İlkokulu',
        'NEVŞEHİR - DERİNKUYU - YAZIHÜYÜK MUHSİN YAZICIOĞLU İLKOKULU',
        'NEVŞEHİR - GÜLŞEHİR - Abuşağı İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Emmiler İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Gökçetoprak İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Gülşehir Atatürk İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Hacıhalilli İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Karacaşar İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Karavezir İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Kızılkaya İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Ovaören İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Sevim Erdoğan Öz İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Terlemez İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Tuzköy İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Yakatarla İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Yeniyaylacık İlkokulu',
        'NEVŞEHİR - GÜLŞEHİR - Yeşilöz İlkokulu',
        'NEVŞEHİR - HACIBEKTAŞ - Hacıbektaş Atatürk İlkokulu',
        'NEVŞEHİR - HACIBEKTAŞ - HASANLAR İLKOKULU',
        'NEVŞEHİR - HACIBEKTAŞ - Karaburna İlkokulu',
        'NEVŞEHİR - HACIBEKTAŞ - KAYAALTI İLKOKULU',
        'NEVŞEHİR - HACIBEKTAŞ - Kızılağıl İlkokulu',
        'NEVŞEHİR - KOZAKLI - Akpınar İlkokulu',
        'NEVŞEHİR - KOZAKLI - Çayiçi Yunus Emre İlkokulu',
        'NEVŞEHİR - KOZAKLI - Kozaklı Atatürk İlkokulu',
        'NEVŞEHİR - KOZAKLI - Kozaklı Mehmet Akif Ersoy İlkokulu',
        'NEVŞEHİR - KOZAKLI - Kozaklı Şehit Şenol Coşkun İlkokulu',
        'NEVŞEHİR - MERKEZ - 100. Yıl Cumhuriyet İlkokulu',
        'NEVŞEHİR - MERKEZ - 100.Yıl Ülfet Başer İlkokulu',
        'NEVŞEHİR - MERKEZ - 19 Mayıs İlkokulu',
        'NEVŞEHİR - MERKEZ - 20 Temmuz İlkokulu',
        'NEVŞEHİR - MERKEZ - 30 Ağustos İlkokulu',
        'NEVŞEHİR - MERKEZ - 75.Yıl İlkokulu',
        'NEVŞEHİR - MERKEZ - Abdülhamit Han İlkokulu',
        'NEVŞEHİR - MERKEZ - Alacaşar Şehit Cebrail Aksöz İlkokulu',
        'NEVŞEHİR - MERKEZ - Balcın İlkokulu',
        'NEVŞEHİR - MERKEZ - Boğaz Şehit Sait Toktaş İlkokulu',
        'NEVŞEHİR - MERKEZ - Çardak İlkokulu',
        'NEVŞEHİR - MERKEZ - Çat İlkokulu',
        'NEVŞEHİR - MERKEZ - Çiftlik 100.Yıl İlkokulu',
        'NEVŞEHİR - MERKEZ - Ersular İlkokulu',
        'NEVŞEHİR - MERKEZ - Göre Şehit Emre Fıstıkeken İlkokulu',
        'NEVŞEHİR - MERKEZ - Göreme İlkokulu',
        'NEVŞEHİR - MERKEZ - Güvercinlik İlkokulu',
        'NEVŞEHİR - MERKEZ - Güzelyurt Turgut Akdevelioğlu İlkokulu',
        'NEVŞEHİR - MERKEZ - Hacı Asım Atabilen İlkokulu',
        'NEVŞEHİR - MERKEZ - Hacı Mustafa- Türkan Öbekli İlkokulu',
        'NEVŞEHİR - MERKEZ - İcik Şehit Cevdet Şimşek İlkokulu',
        'NEVŞEHİR - MERKEZ - İncekaralar İlkokulu',
        'NEVŞEHİR - MERKEZ - Kaymaklı İlkokulu',
        'NEVŞEHİR - MERKEZ - Mehmet Gülen İlkokulu',
        'NEVŞEHİR - MERKEZ - Mustafa Çalışkan İlkokulu',
        'NEVŞEHİR - MERKEZ - Nar Barbaros İlkokulu',
        'NEVŞEHİR - MERKEZ - Necip Fazıl Kısakürek İlkokulu',
        'NEVŞEHİR - MERKEZ - Nevşehir Atatürk İlkokulu',
        'NEVŞEHİR - MERKEZ - Nevşehir Cumhuriyet İlkokulu',
        'NEVŞEHİR - MERKEZ - Özyayla İlkokulu',
        'NEVŞEHİR - MERKEZ - Rauf Nail Akman İlkokulu',
        'NEVŞEHİR - MERKEZ - Recep Tayyip Erdoğan İlkokulu',
        'NEVŞEHİR - MERKEZ - Sultan Alparslan İlkokulu',
        'NEVŞEHİR - MERKEZ - Sulusaray İlkokulu',
        'NEVŞEHİR - MERKEZ - Uçhisar Haydar Çankaya İlkokulu',
        'NEVŞEHİR - MERKEZ - Yunus Emre İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Ayhan Ertürk İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Ayvalı İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Bahçeli İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Başdere İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Hanife Memiş Aksoy İlkokulu',
        'NEVŞEHİR - ÜRGÜP - İbrahimpaşa İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Mazı İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Mehmet Dinler İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Mustafapaşa İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Ortahisar Fatih İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Ortahisar İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Şahinefendi İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Sarıhıdır İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Sofular İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Türkan Diker İlkokulu',
        'NEVŞEHİR - ÜRGÜP - Ürgüp 15 Temmuz İlkokulu',
        'ÖZEL Altınyıldız İlkokulu',
        'ÖZEL Kardelen İlkokulu',
        'ÖZEL MBA İlkokulu',
        'ÖZEL Simya İlkokulu'
    ];
    let notificationId = 0;
    let downloadButton: HTMLButtonElement;

    onMount(async () => {
        try {
            // Load system settings first
            await loadSystemSettings();
            
            const schoolsSnapshot = await getDocs(collection(db, "schools"));
            const schools = schoolsSnapshot.docs;
            
            let totalCapacity = 0;
            let totalStudents = 0;
            
            for (const school of schools) {
                const examHallsSnapshot = await getDocs(collection(db, "schools", school.id, "examHalls"));
                const examHalls = examHallsSnapshot.docs;
                
                for (const hall of examHalls) {
                    const hallData = hall.data();
                    totalCapacity += hallData.capacity;
                    
                    const studentsSnapshot = await getDocs(collection(db, "schools", school.id, "examHalls", hall.id, "students"));
                    totalStudents += studentsSnapshot.size;
                }
            }
            
            
        } catch (error) {
            console.error('Error checking capacity:', error);
        }
        
        await loadNotes();
    });

    async function loadSystemSettings() {
        try {
            isLoadingSettings = true;
            const settingsRef = doc(db, "system", "settings");
            const settingsSnap = await getDoc(settingsRef);
            
            if (settingsSnap.exists()) {
                const data = settingsSnap.data();
                systemSettings = {
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
                
                // Update local variables
                applicationStartDate = systemSettings.applicationStartDate ? new Date(systemSettings.applicationStartDate) : null;
                applicationDeadline = systemSettings.applicationDeadline ? new Date(systemSettings.applicationDeadline) : null;
                examDate = systemSettings.examDate ? new Date(systemSettings.examDate) : null;
                isApplicationEnabled = systemSettings.applicationEnabled;
                currentPhase = systemSettings.currentPhase;
                startCountdownTimer();
            } else {
                // Create default settings if they don't exist
                const defaultSettings = {
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
                
                await setDoc(settingsRef, defaultSettings);
                systemSettings = defaultSettings as SystemSettings;
            }
        } catch (error) {
            console.error('Error loading system settings:', error);
        } finally {
            isLoadingSettings = false;
        }
    }

    async function loadNotes() {
        try {
            const notesRef = doc(db, "general", "notes");
            const notesSnap = await getDoc(notesRef);
            
            if (notesSnap.exists()) {
                const data = notesSnap.data();
                notes = data.info || [];
            }
        } catch (error) {
        }
    }

    type NotificationType = 'success' | 'error' | 'warning';
    type Notification = {
        id: number;
        type: NotificationType;
        message: string;
    };

    let notifications: Notification[] = [];

    function showNotification(message: string, type: NotificationType = 'success') {
        const id = ++notificationId;
        notifications = [...notifications, { id, type, message }];
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            notifications = notifications.filter(n => n.id !== id);
        }, 5000);
    }

    function removeNotification(id: number) {
        notifications = notifications.filter(n => n.id !== id);
    }

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
    
    function handleTCKNInput(event: Event) {
        const input = event.target as HTMLInputElement;
        const formatted = input.value.replace(/[^0-9]/g, '').slice(0, 11);
        formData.tcId = formatted;
        
        if (formatted.length === 0) {
            legalErrors.tckn = '';
            input.setCustomValidity('');
        } else if (formatted.length !== 11) {
            legalErrors.tckn = '11 haneli T.C. Kimlik Numarası giriniz.';
            input.setCustomValidity('11 haneli T.C. Kimlik Numarası giriniz.');
        } else if (!validateTCID(formatted)) {
            legalErrors.tckn = 'Geçersiz T.C. Kimlik Numarası. Lütfen kontrol ediniz.';
            input.setCustomValidity('Geçersiz T.C. Kimlik Numarası');
        } else {
            legalErrors.tckn = '';
            input.setCustomValidity('');
        }
    }
    
    function handlePhoneInput(event: Event) {
        const input = event.target as HTMLInputElement;
        // Remove all non-numeric characters and any leading zeros
        let formatted = input.value.replace(/[^0-9]/g, '').replace(/^0+/, '');
        
        // Ensure the number starts with valid Turkish mobile prefix
        if (formatted.length > 0 && !['5'].includes(formatted[0])) {
            formatted = '';
        }
        
        // Limit to 10 digits
        formatted = formatted.slice(0, 10);
        
        // Store raw value in formData
        formData.phoneNumber = formatted;
        
        // Format for display with parentheses
        if (formatted.length > 0) {
            let displayValue = '(' + formatted.slice(0, 3);
            if (formatted.length > 3) {
                displayValue += ') ' + formatted.slice(3, 6);
                if (formatted.length > 6) {
                    displayValue += ' ' + formatted.slice(6, 8);
                    if (formatted.length > 8) {
                        displayValue += ' ' + formatted.slice(8, 10);
                    }
                }
            }
            input.value = displayValue;
        } else {
            input.value = '';
        }
        
        if (formatted.length === 0) {
            legalErrors.phoneNumber = '';
            input.setCustomValidity('');
        } else if (formatted.length !== 10) {
            legalErrors.phoneNumber = '10 haneli telefon numarası giriniz.';
            input.setCustomValidity('10 haneli telefon numarası giriniz.');
        } else if (!formatted.startsWith('5')) {
            legalErrors.phoneNumber = 'Geçerli bir cep telefonu numarası giriniz.';
            input.setCustomValidity('Geçerli bir cep telefonu numarası giriniz.');
        } else {
            legalErrors.phoneNumber = '';
            input.setCustomValidity('');
        }
    }
    
    function handleSchoolSelect(event: Event) {
        const select = event.target as HTMLSelectElement;
        if (select.value === "DİĞER") {
            isCustomSchool = true;
            customSchoolName = '';
        } else {
            isCustomSchool = false;
            formData.schoolName = select.value;
        }
    }

    function handleCustomSchoolInput(event: Event) {
        const input = event.target as HTMLInputElement;
        customSchoolName = toTurkishUpperCase(input.value);
        formData.schoolName = customSchoolName;
    }
    
    async function handleSubmit() {
        // Check if system settings are loaded
        if (isLoadingSettings || !systemSettings) {
            showNotification('Sistem ayarları yükleniyor, lütfen bekleyiniz.', 'warning');
            return;
        }

        // Check if application system is enabled
        if (!isApplicationEnabled) {
            showNotification('Başvuru sistemi şu anda kapalıdır.', 'error');
            return;
        }

        // Trim and properly capitalize each part of the names
        formData.studentFullName = formData.studentFullName
            .trim()
            .split(' ')
            .filter(part => part.length > 0)  // Remove empty parts
            .map(part => toTurkishUpperCase(part))
            .join(' ');
        formData.parentFullName = formData.parentFullName
            .trim()
            .split(' ')
            .filter(part => part.length > 0)  // Remove empty parts
            .map(part => toTurkishUpperCase(part))
            .join(' ');
            

        // Check submission deadline using system settings
        if (applicationDeadline) {
            const now = new Date();
            if (now > applicationDeadline) {
                showNotification('Başvuru dönemi sona ermiştir.', 'error');
                return;
            }
        }

        if (!validateTCID(formData.tcId)) {
            return;
        }

        // Explicit validation to prevent saving incomplete data
        if (!formData.studentFullName?.trim()) {
            showNotification('Öğrenci adı soyadı gereklidir.', 'error');
            return;
        }
        if (!formData.parentFullName?.trim()) {
            showNotification('Veli adı soyadı gereklidir.', 'error');
            return;
        }
        const phoneDigits = (formData.phoneNumber || '').replace(/\D/g, '');
        if (phoneDigits.length !== 10 || !phoneDigits.startsWith('5')) {
            showNotification('Geçerli bir 10 haneli cep telefonu numarası giriniz.', 'error');
            return;
        }
        if (!formData.schoolName?.trim()) {
            showNotification('Okul seçiniz.', 'error');
            return;
        }

        submitState = 'submitting';

        try {
            // Check if document already exists
            const docRef = doc(db, "examApplications", formData.tcId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                showNotification('Bu TC Kimlik numarası ile daha önce başvuru yapılmış. Sınav giriş belgenizi alabilirsiniz.', 'warning');
                submitState = 'idle';
                return;
            }

            // Create new document with TC ID as document ID (use phone digits, ensure studentSchoolName)
            const docData = {
                tcId: formData.tcId,
                studentFullName: formData.studentFullName.trim(),
                schoolName: formData.schoolName.trim(),
                studentSchoolName: formData.schoolName.trim(),
                parentFullName: formData.parentFullName.trim(),
                phoneNumber: phoneDigits
            };
            await setDoc(docRef, docData);

            // Get all schools
            const schoolsSnapshot = await getDocs(collection(db, "schools"));
            const schools = schoolsSnapshot.docs;

            if (schools.length === 0) {
                await deleteDoc(docRef);
                showNotification('Sınav yeri ataması yapılamadı. Lütfen daha sonra tekrar deneyiniz.', 'error');
                submitState = 'error';
                setTimeout(() => { submitState = 'idle'; }, 3000);
                return;
            }

            // Fisher-Yates shuffle algorithm
            function shuffle<T>(array: T[]): T[] {
                const arr = [...array];
                let currentIndex = arr.length;
                let randomIndex;

                while (currentIndex !== 0) {
                    randomIndex = Math.floor(Math.random() * currentIndex);
                    currentIndex--;

                    [arr[currentIndex], arr[randomIndex]] = 
                    [arr[randomIndex], arr[currentIndex]];
                }

                return arr;
            }

            let assigned = false;
            let assignedSchool;
            let assignedHall;
            let assignedSchoolId;
            let assignedHallId;

            // Sort by weight (higher first), then shuffle same-weight groups randomly
            const schoolsWithWeight = schools.map(d => ({
                doc: d,
                weight: d.data().weight ?? 0
            }));
            schoolsWithWeight.sort((a, b) => b.weight - a.weight);

            const orderedSchools: typeof schools = [];
            let i = 0;
            while (i < schoolsWithWeight.length) {
                const currentWeight = schoolsWithWeight[i].weight;
                const sameWeightGroup = schoolsWithWeight
                    .filter(s => s.weight === currentWeight)
                    .map(s => s.doc);
                orderedSchools.push(...shuffle(sameWeightGroup));
                i += sameWeightGroup.length;
            }

            // Try each school in priority order
            for (const school of orderedSchools) {
                if (assigned) break;

                // Get all exam halls for this school
                const examHallsSnapshot = await getDocs(collection(db, "schools", school.id, "examHalls"));
                const examHalls = examHallsSnapshot.docs;

                if (examHalls.length === 0) continue;

                // Shuffle the halls for this school
                const shuffledHalls = shuffle([...examHalls]);

                // Try each hall in shuffled order
                for (const hall of shuffledHalls) {
                    const hallData = hall.data();
                    const schoolData = school.data();
                    
                    // Get current students in this hall
                    const studentsSnapshot = await getDocs(collection(db, "schools", school.id, "examHalls", hall.id, "students"));
                    
                    // Check if hall has capacity
                    if (studentsSnapshot.size < hallData.capacity) {
                        // Add student to this hall
                        await setDoc(doc(db, "schools", school.id, "examHalls", hall.id, "students", formData.tcId), {
                            tcId: formData.tcId,
                            studentFullName: formData.studentFullName,
                            schoolId: schoolData.id,
                            schoolName: schoolData.name,
                            studentSchoolName: formData.schoolName,
                            parentFullName: formData.parentFullName,
                            phoneNumber: formData.phoneNumber,
                            hallName: hallData.name,
                            hallId: hallData.id,
                            assignedAt: new Date(),
                            orderNumber: studentsSnapshot.size + 1
                        });

                        //update the application with the hallId
                        await updateDoc(docRef, {
                            studentSchoolName: formData.schoolName,
                            schoolName: schoolData.name,
                            hallName: hallData.name,
                            schoolId: schoolData.id,
                            hallId: hallData.id,
                            assignedAt: new Date(),
                            orderNumber: studentsSnapshot.size + 1
                        });
                        
                        assigned = true;
                        assignedSchool = school.data().name;
                        assignedHall = hallData.name;
                        assignedSchoolId = school.id;
                        assignedHallId = hall.id;
                        break;
                    }
                }
            }

            if (!assigned) {
                showNotification('Sınav yeri ataması yapılamadı. Lütfen daha sonra tekrar deneyiniz.', 'error');
                await deleteDoc(docRef);
                submitState = 'error';
                setTimeout(() => { submitState = 'idle'; }, 3000);
                return;
            }

            showNotification('Başvurunuz başarıyla gönderildi ve sınav yeriniz atandı!', 'success');
            submitState = 'success';

            // Show exam entry document section
            if (!assignedSchoolId || !assignedHallId) {
                throw new Error('School or hall ID not found');
            }
            
            // Get exam data from Firebase document
            const examDocRef = doc(db, "examApplications", formData.tcId);
            const examDocSnap = await getDoc(examDocRef);
            
            if (examDocSnap.exists()) {
                examData = examDocSnap.data() as {
                    tcId: string;
                    studentFullName: string;
                    studentSchoolName: string;
                    parentFullName: string;
                    phoneNumber: string;
                    schoolName: string;
                    hallName: string;
                    orderNumber: number;
                    schoolId: string;
                };
                
                // Wait for the next tick to ensure the button is rendered
               /* setTimeout(() => {
                    downloadButton?.focus();
                    downloadButton?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 0);*/
            } else {
                showNotification('Sınav bilgileri bulunamadı.', 'error');
            }

            // Reset form
            formData = {
                tcId: '',
                studentFullName: '',
                schoolName: '',
                parentFullName: '',
                phoneNumber: '',
            };
        } catch (error) {
            // Clean up the partially-created application document so the student can retry
            try {
                const docRef = doc(db, "examApplications", formData.tcId);
                const snap = await getDoc(docRef);
                if (snap.exists() && !snap.data().schoolId) {
                    await deleteDoc(docRef);
                }
            } catch {}
            showNotification('Başvuru gönderilirken bir hata oluştu. Lütfen tekrar deneyiniz.', 'error');
            submitState = 'error';
            setTimeout(() => { submitState = 'idle'; }, 3000);
        }
    }

    async function downloadExamDocument() {
        if (!examData) return;

        // Create new PDF document
        const doc = new jsPDF();
        
        // Add local fonts
        doc.addFont("/fonts/DejaVuSans.ttf", "DejaVuSans", "normal");
        doc.addFont("/fonts/DejaVuSans-Bold.ttf", "DejaVuSans", "bold");
        
        // Set default font to DejaVuSans
        doc.setFont("DejaVuSans");
        
        // Add header with border
        doc.setDrawColor(0, 51, 102); // Navy blue color for borders
        doc.setLineWidth(0.5);
        doc.rect(10, 10, 190, 277); // Outer border
        doc.rect(15, 15, 180, 20); // Header border - reduced height from 30 to 20
        
        // Add header text
        doc.setFontSize(16); // Reduced from 22 to 16
        doc.setFont("DejaVuSans", "bold");
        doc.setTextColor(0, 51, 102); // Navy blue color for main title
        doc.text("SINAV GİRİŞ BELGESİ", 105, 27, { align: "center" }); // Adjusted Y position from 32 to 28
    
        // Add school logo
        const logoPath = `/favicon.png`;
        if (logoPath) {
            doc.addImage(logoPath, 'PNG', 17, 17, 15, 15);
            doc.addImage(logoPath, 'PNG', 178, 17, 15, 15);
        }
    


        // Reset text color to black for content
        doc.setTextColor(0, 0, 0);
        
        // Add student information section
        doc.setFontSize(14); // Reduced from 16 to 14
        doc.setFont("DejaVuSans", "bold");
        doc.setTextColor(0, 51, 102); // Navy blue for section headers
        doc.text("ÖĞRENCİ BİLGİLERİ", 25, 50); // Adjusted Y position from 60 to 50
        
        // Add horizontal line under section header
        doc.setDrawColor(0, 51, 102);
        doc.line(25, 53, 185, 53); // Adjusted Y position from 63 to 53
        
        // Reset text color to black for content
        doc.setTextColor(0, 0, 0);
        
        doc.setFontSize(11);
        const studentInfo = [
            ["T.C. Kimlik No", ":", examData.tcId],
            ["Ad Soyad", ":", examData.studentFullName],
            ["Okul", ":", examData.studentSchoolName],
            ["Veli Adı Soyadı", ":", examData.parentFullName],
            ["Telefon Numarası", ":", examData.phoneNumber]
        ];
        
        let y = 65; // Adjusted from 75 to 65
        studentInfo.forEach(([label, separator, value]) => {
            doc.setFont("DejaVuSans", "bold");
            doc.text(label, 25, y);
            doc.text(separator, 70, y);
            doc.setFont("DejaVuSans", "normal");
            // Handle long text by splitting into multiple lines if needed
            const maxWidth = 110; // Maximum width for the value text
            const lines = doc.splitTextToSize(value, maxWidth);
            lines.forEach((line: string, index: number) => {
                doc.text(line, 75, y + (index * 6));
            });
            y += 12 + (lines.length - 1) * 6; // Adjust spacing based on number of lines
        });
        
        // Add exam location section
        doc.setFontSize(14); // Reduced from 16 to 14
        doc.setFont("DejaVuSans", "bold");
        doc.setTextColor(0, 51, 102); // Navy blue for section headers
        doc.text("SINAV YERİ BİLGİLERİ", 25, y + 5);
        
        // Add horizontal line under section header
        doc.line(25, y + 8, 185, y + 8);
        
        // Reset text color to black for content
        doc.setTextColor(0, 0, 0);
        
        doc.setFontSize(11);
        const examInfo = [
            ["Sınav Tarihi", ":", "18.04.2026"],
            ["Sınav Binası", ":", examData.schoolName],
            ["Sınav Salonu", ":", examData.hallName],
            ["Sıra No", ":", examData.orderNumber.toString()]
        ];
        
        y += 15;
        examInfo.forEach(([label, separator, value]) => {
            doc.setFont("DejaVuSans", "bold");
            doc.text(label, 25, y);
            doc.text(separator, 70, y);
            doc.setFont("DejaVuSans", "normal");
            // Handle long text by splitting into multiple lines if needed
            const maxWidth = 110; // Maximum width for the value text
            const lines = doc.splitTextToSize(value, maxWidth);
            lines.forEach((line: string, index: number) => {
                doc.text(line, 75, y + (index * 6));
            });
            y += 12 + (lines.length - 1) * 6; // Adjust spacing based on number of lines
        });
        
        // Add important notes section
        doc.setFontSize(16);
        doc.setFont("DejaVuSans", "bold");
        doc.setTextColor(0, 51, 102); // Navy blue for section headers
        doc.text("ÖNEMLİ NOTLAR", 25, y + 10);
        
        // Add horizontal line under section header
        doc.line(25, y + 13, 185, y + 13);
        
        // Reset text color to black for content
        doc.setTextColor(0, 0, 0);
        
        doc.setFontSize(10);
        doc.setFont("DejaVuSans", "normal");
        
        y += 20;
        notes.forEach(note => {
            const lines = doc.splitTextToSize(`• ${note}`, 160);
            lines.forEach((line: string) => {
                doc.text(line, 25, y);
                y += 7;
            });
        });
        
        const qr_location = 160;
        // Add QR code for school location (from admin-managed barcode or static fallback)
        const barcodeBase64 = await getBarcodeBase64(examData.schoolId);
        if (barcodeBase64) {
            doc.addImage(barcodeBase64, 'PNG', 155, qr_location, 30, 30);
        }
        doc.setFontSize(10);
        doc.setFont("DejaVuSans", "bold");
        doc.setTextColor(0, 51, 102);
        doc.text('Okul Konumu', 170, qr_location + 35, { align: 'center' });
        
        // Save the PDF
        doc.save(`sinav_giris_belgesi_${examData.tcId}.pdf`);
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
    <div class="content-wrapper">
        <div class="form-column">
            <h1>Recep Tayyip Erdoğan Proje İmam Hatip Lisesi <br> {systemSettings?.currentYear || 2026}. Sınıf Kayıt Kabul Sınavı</h1>
            
            {#if isLoadingSettings}
                <div class="loading-banner">
                    <span class="loading-icon">⏳</span>
                    <h2>Sistem Bilgileri Yükleniyor...</h2>
                    <p>Lütfen bekleyiniz.</p>
                </div>
            {:else if currentPhase === 'application' && isApplicationEnabled && !startDateInFuture}
                <!-- Application Form -->
                <div class="application-banner">
                    <span class="application-icon">📝</span>
                    <h2>Başvuru Dönemi Açıktır</h2>
                    {#if applicationDeadline}
                        <p class="deadline-date">Son başvuru: {applicationDeadline.toLocaleDateString('tr-TR', { 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })}</p>
                        {#if deadlineCountdownValue.days > 0 || deadlineCountdownValue.hours > 0 || deadlineCountdownValue.minutes > 0}
                            <div class="deadline-countdown">
                                <span class="deadline-countdown-label">⏰ Başvurular kapanıyor:</span>
                                <div class="countdown-units small">
                                    <div class="countdown-unit">
                                        <span class="unit-value">{deadlineCountdownValue.days}</span>
                                        <span class="unit-label">gün</span>
                                    </div>
                                    <span class="countdown-sep">:</span>
                                    <div class="countdown-unit">
                                        <span class="unit-value">{String(deadlineCountdownValue.hours).padStart(2,'0')}</span>
                                        <span class="unit-label">saat</span>
                                    </div>
                                    <span class="countdown-sep">:</span>
                                    <div class="countdown-unit">
                                        <span class="unit-value">{String(deadlineCountdownValue.minutes).padStart(2,'0')}</span>
                                        <span class="unit-label">dakika</span>
                                    </div>
                                    <span class="countdown-sep">:</span>
                                    <div class="countdown-unit">
                                        <span class="unit-value">{String(deadlineCountdownValue.seconds).padStart(2,'0')}</span>
                                        <span class="unit-label">saniye</span>
                                    </div>
                                </div>
                            </div>
                        {/if}
                    {/if}
                </div>
                
                <!-- Show application form here -->
                <form class="form" on:submit|preventDefault={handleSubmit}>
                    <div class="form-group">
                        <label for="tcId">T.C. Kimlik Numaranız:</label>
                        <input
                            type="text"
                            id="tcId"
                            bind:value={formData.tcId}
                            on:input={handleTCKNInput}
                            placeholder="11 Haneli T.C. Kimlik No"
                            maxlength="11"
                            required
                            aria-invalid={legalErrors.tckn !== ''}
                            class:invalid={legalErrors.tckn !== ''}
                        />
                        {#if legalErrors.tckn}
                            <span class="error-message">{legalErrors.tckn}</span>
                        {/if}
                    </div>

                    <div class="form-group">
                        <label for="studentFullName">Öğrenci Adı Soyadı:</label>
                        <input
                            type="text"
                            id="studentFullName"
                            bind:value={formData.studentFullName}
                            on:input={(e) => handleNameInput(e, 'studentFullName')}
                            placeholder="Öğrenci Adı Soyadı"
                            required
                        />
                    </div>

                    <div class="form-group">
                        <label for="parentFullName">Veli Adı Soyadı:</label>
                        <input
                            type="text"
                            id="parentFullName"
                            bind:value={formData.parentFullName}
                            on:input={(e) => handleNameInput(e, 'parentFullName')}
                            placeholder="Veli Adı Soyadı"
                            required
                        />
                    </div>

                    <div class="form-group">
                        <label for="phoneNumber">Cep Telefonu:</label>
                        <input
                            type="tel"
                            id="phoneNumber"
                            on:input={handlePhoneInput}
                            placeholder="(5XX) XXX XX XX"
                            required
                            aria-invalid={legalErrors.phoneNumber !== ''}
                            class:invalid={legalErrors.phoneNumber !== ''}
                        />
                        {#if legalErrors.phoneNumber}
                            <span class="error-message">{legalErrors.phoneNumber}</span>
                        {/if}
                    </div>

                    <div class="form-group">
                        <label for="schoolName">Okul Adı:</label>
                        <div class="school-input-container">
                            <select 
                                class="school-select {isCustomSchool ? 'expanded' : ''}" 
                                on:change={handleSchoolSelect}
                                required
                            >
                                <option value="">Okul seçiniz</option>
                                {#each schools as school}
                                    <option value={school}>{school}</option>
                                {/each}
                                <option value="DİĞER">DİĞER</option>
                            </select>
                            
                            {#if isCustomSchool}
                                <div class="custom-school-container">
                                    <input
                                        type="text"
                                        class="custom-school-input"
                                        placeholder="Okul adını yazınız"
                                        on:input={handleCustomSchoolInput}
                                        required
                                    />
                                    <small class="helper-text">Okulunuz listede yoksa manuel olarak yazabilirsiniz.</small>
                                </div>
                            {/if}
                        </div>
                    </div>

                    <button
                        type="submit"
                        class="submit-btn"
                        class:submitting={submitState === 'submitting'}
                        class:success={submitState === 'success'}
                        class:error={submitState === 'error'}
                        disabled={submitState === 'submitting' || submitState === 'error'}
                    >
                        {#if submitState === 'submitting'}
                            <span class="btn-spinner" aria-hidden="true"></span>
                            Gönderiliyor...
                        {:else if submitState === 'success'}
                            ✓ Başvuru Gönderildi
                        {:else if submitState === 'error'}
                            ✕ Bir Hata Oluştu
                        {:else}
                            Başvurumu Gönder
                        {/if}
                    </button>
                </form>

                {#if submitState === 'success'}
                    <div class="success-notice" transition:fade>
                        <span class="success-notice-icon">ℹ️</span>
                        <div class="success-notice-text">
                            <strong>Önemli Hatırlatma</strong>
                            <p>Sınava girebilmek için <strong>Sınav Giriş Belgenizi</strong> indirip çıktı almanız gerekmektedir.</p>
                            <a href="/sinav-giris-belgesi" class="notice-link">Sınav Giriş Belgesini Al →</a>
                        </div>
                    </div>
                {/if}

                {#if examData}
                    <div class="exam-info" transition:fade>
                        <h2>Sınav Giriş Belgesi</h2>
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="label">T.C. Kimlik No:</span>
                                <span class="value">{examData.tcId}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Ad Soyad:</span>
                                <span class="value">{examData.studentFullName}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Okul:</span>
                                <span class="value">{examData.studentSchoolName}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Sınav Yeri:</span>
                                <span class="value">{examData.schoolName} - {examData.hallName}</span>
                            </div>
                            <div class="info-item">
                                <span class="label">Sıra No:</span>
                                <span class="value">{examData.orderNumber}</span>
                            </div>
                        </div>
                        
                        <button 
                            bind:this={downloadButton}
                            class="download-btn" 
                            on:click={downloadExamDocument}
                        >
                            📄 Sınav Giriş Belgesini İndir
                        </button>
                    </div>
                {/if}
                
            {:else if currentPhase === 'exam'}
                <div class="exam-banner">
                    <span class="exam-icon">📊</span>
                    <h2>Sınav Dönemi</h2>
                    {#if examDate}
                        <p>Sınav tarihi: {examDate.toLocaleDateString('tr-TR', { 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })}</p>
                    {/if}
                    <p>Başvurular tamamlanmıştır. Sınava girebilmek için sınav giriş belgenizi indirip çıktı almanız gerekmektedir.</p>
                    <a href="/sinav-giris-belgesi" class="exam-entry-link">Sınav Giriş Belgesini Al →</a>
                </div>
                
            {:else if currentPhase === 'results'}
                <div class="results-banner">
                    <span class="results-icon">📋</span>
                    <h2>Sonuç Açıklama Dönemi</h2>
                    <p>Sınav sonuçlarına ulaşmak için aşağıdaki butona tıklayabilirsiniz.</p>
                </div>
                
            {:else if currentPhase === 'completed'}
                <div class="completed-banner">
                    <span class="completed-icon">✅</span>
                    <h2>Sınav Tamamlanmıştır</h2>
                    <p>Sınav süreci tamamlanmıştır. Sonuçlar açıklanmıştır.</p>
                </div>
                
            {:else if currentPhase === 'application' && startDateInFuture}
                <!-- Countdown to application opening -->
                <div class="countdown-banner">
                    <span class="countdown-icon">🗓️</span>
                    <h2>Başvurular Yakında Açılıyor</h2>
                    <p class="countdown-open-date">
                        Başvurular <strong>{applicationStartDate?.toLocaleDateString('tr-TR', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })}</strong> tarihinde açılacaktır.
                    </p>
                    <div class="countdown-units">
                        <div class="countdown-unit">
                            <span class="unit-value">{startCountdownValue.days}</span>
                            <span class="unit-label">Gün</span>
                        </div>
                        <span class="countdown-sep">:</span>
                        <div class="countdown-unit">
                            <span class="unit-value">{String(startCountdownValue.hours).padStart(2,'0')}</span>
                            <span class="unit-label">Saat</span>
                        </div>
                        <span class="countdown-sep">:</span>
                        <div class="countdown-unit">
                            <span class="unit-value">{String(startCountdownValue.minutes).padStart(2,'0')}</span>
                            <span class="unit-label">Dakika</span>
                        </div>
                        <span class="countdown-sep">:</span>
                        <div class="countdown-unit">
                            <span class="unit-value">{String(startCountdownValue.seconds).padStart(2,'0')}</span>
                            <span class="unit-label">Saniye</span>
                        </div>
                    </div>
                    {#if applicationDeadline}
                        <p class="countdown-deadline-hint">
                            Son başvuru tarihi: {applicationDeadline.toLocaleDateString('tr-TR', {
                                year: 'numeric', month: 'long', day: 'numeric',
                                hour: '2-digit', minute: '2-digit'
                            })}
                        </p>
                    {/if}
                </div>

            {:else}
                <div class="inactive-banner">
                    <span class="inactive-icon">⏸️</span>
                    <h2>Sistem Bakımda</h2>
                    <p>Başvuru sistemi şu anda kapalıdır. Lütfen daha sonra tekrar deneyiniz.</p>
                </div>
            {/if}
           
        </div>
        
        <div class="action-column">
            <div class="action-buttons">
                {#if systemSettings?.resultsEnabled || currentPhase === 'results' || currentPhase === 'completed'}
                    <a href="/results" class="action-btn primary-action">
                        <span class="icon">📊</span>
                        Sınav Sonuçları
                    </a>
                {/if}
                
                <a href="/sinav-giris-belgesi" class="action-btn">
                    <span class="icon">📄</span>
                    Sınav Giriş Belgesi
                </a>
                
                {#if systemSettings?.eventsEnabled !== false}
                    <a href="/events" class="action-btn">
                        <span class="icon">📅</span>
                        Etkinlik Başvurusu
                    </a>
                {/if}
            </div>
        </div>
    </div>
</main>

<style>
    :global(body) {
        scroll-behavior: smooth;
    }
    
    * {
        box-sizing: border-box;
    }
    
    .container {
        max-width: 1200px;
        margin: 2rem auto;
        padding: 2.5rem;
        background: linear-gradient(to bottom, #ffffff, #f8fafc);
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08);
    }
    
    @media (prefers-color-scheme: light) {
        .container {
            background: #ffffff;
        }
    }

    .content-wrapper {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 2.5rem;
        align-items: start;
    }

    .form-column {
        flex: 1;
    }
    
    .form {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        background: #ffffff;
        padding: 2rem;
        border-radius: 12px;
        border: 1px solid #e2e8f0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    
    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        position: relative;
    }
    
    .form-group:focus-within label {
        color: #14b8a6;
    }
    
    .submit-btn {
        background: linear-gradient(135deg, #0d9488 0%, #115e59 100%);
        color: white;
        padding: 1.125rem 2rem;
        border: none;
        border-radius: 12px;
        font-size: 1.05rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        margin-top: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        position: relative;
        overflow: hidden;
    }
    
    .submit-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
        transition: left 0.5s ease;
    }
    
    .submit-btn:hover::before {
        left: 100%;
    }
    
    .submit-btn:hover {
        background: linear-gradient(135deg, #115e59 0%, #0d9488 100%);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
    }
    
    .submit-btn:active {
        transform: translateY(0);
    }
    
    .submit-btn:disabled {
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
    }

    .submit-btn.submitting {
        background: linear-gradient(135deg, #0d9488 0%, #115e59 100%);
        opacity: 0.85;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.6rem;
    }

    .submit-btn.success {
        background: linear-gradient(135deg, #38a169 0%, #276749 100%);
        box-shadow: 0 4px 15px rgba(56, 161, 105, 0.4);
    }

    .submit-btn.error {
        background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%);
        box-shadow: 0 4px 15px rgba(229, 62, 62, 0.4);
    }

    .btn-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.4);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        flex-shrink: 0;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }
    
    h1 {
        color: #1a202c;
        margin-bottom: 2rem;
        text-align: center;
        font-size: 1.75rem;
        font-weight: 800;
        position: relative;
        padding-bottom: 1.5rem;
        line-height: 1.3;
        letter-spacing: -0.025em;
    }
    
    h1::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 120px;
        height: 4px;
        background: linear-gradient(to right, #0d9488, #115e59);
        border-radius: 2px;
    }
    
    .error-message {
        color: #e53e3e;
        font-size: 0.875rem;
        margin-top: 0.375rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: #fff5f5;
        padding: 0.5rem 0.75rem;
        border-radius: 8px;
        border-left: 3px solid #e53e3e;
        animation: slideIn 0.3s ease-out;
    }
    
    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(-5px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    .error-message::before {
        content: '⚠️';
        font-size: 1rem;
    }
    
    .invalid {
        border-color: #fc8181 !important;
        background-color: #fff5f5 !important;
    }
    
    
    @media (max-width: 768px) {
        .content-wrapper {
            grid-template-columns: 1fr;
            gap: 1.5rem;
        }
        
        .container {
            margin: 1rem;
            padding: 1.5rem;
            border-radius: 12px;
        }
        
        .form {
            padding: 1.5rem;
            gap: 1.25rem;
        }
        
        h1 {
            font-size: 1.35rem;
            margin-bottom: 1.5rem;
            line-height: 1.4;
        }
        
        h1::after {
            width: 80px;
            height: 3px;
        }

        .form-group {
            gap: 0.5rem;
        }
        
        input, select {
            padding: 0.875rem;
            font-size: 1rem;
        }

        .submit-btn {
            padding: 1rem 1.5rem;
            font-size: 1rem;
        }
        
        .download-btn {
            padding: 1rem 1.5rem;
            font-size: 1rem;
        }

        .action-column {
            padding: 0;
        }

        .action-btn {
            padding: 1.25rem;
            font-size: 1rem;
        }
        
        .action-btn .icon {
            font-size: 1.5rem;
        }

        .notifications {
            top: 10px;
            right: 10px;
            left: 10px;
            max-width: none;
        }

        .notification {
            padding: 14px 16px;
            font-size: 0.9rem;
        }
        
        .loading-banner,
        .application-banner,
        .exam-banner,
        .results-banner,
        .completed-banner,
        .inactive-banner,
        .countdown-banner {
            padding: 1.5rem;
            margin: 1rem 0 1.5rem;
        }

        .countdown-units {
            gap: 0.35rem;
        }

        .countdown-unit {
            min-width: 56px;
            padding: 0.6rem 0.875rem;
        }

        .unit-value {
            font-size: 1.75rem;
        }
        
        .exam-info {
            padding: 1.5rem;
        }
        
        .info-grid {
            padding: 1.25rem;
            gap: 1rem;
        }

        .action-buttons {
            position: static;
        }
    }

    @media (max-width: 480px) {
        .container {
            margin: 0;
            padding: 0.875rem;
            border-radius: 0;
            box-shadow: none;
        }

        h1 {
            font-size: 1.05rem;
            margin-bottom: 1.25rem;
            padding-bottom: 1rem;
        }

        h1::after {
            width: 60px;
            height: 3px;
        }

        .form {
            padding: 0.875rem;
            gap: 0.875rem;
        }

        input, select {
            padding: 0.75rem;
            font-size: 0.95rem;
        }

        label {
            font-size: 0.9rem;
        }

        .submit-btn,
        .download-btn {
            padding: 0.875rem 1.25rem;
            font-size: 0.9rem;
        }

        .loading-banner,
        .application-banner,
        .exam-banner,
        .results-banner,
        .completed-banner,
        .inactive-banner,
        .countdown-banner {
            padding: 1.25rem 0.875rem;
            margin: 0.75rem 0 1.25rem;
        }

        .loading-banner h2,
        .application-banner h2,
        .exam-banner h2,
        .results-banner h2,
        .completed-banner h2,
        .inactive-banner h2 {
            font-size: 1.3rem;
        }

        .countdown-banner h2 {
            font-size: 1.3rem;
        }

        .loading-banner p,
        .application-banner p,
        .exam-banner p,
        .results-banner p,
        .completed-banner p,
        .inactive-banner p {
            font-size: 0.9rem;
        }

        .loading-icon,
        .application-icon,
        .exam-icon,
        .results-icon,
        .completed-icon,
        .inactive-icon,
        .countdown-icon {
            font-size: 2rem;
        }

        .countdown-units {
            flex-wrap: wrap;
            justify-content: center;
            gap: 0.25rem;
        }

        .countdown-unit {
            min-width: 52px;
            padding: 0.5rem 0.6rem;
        }

        .unit-value {
            font-size: 1.5rem;
        }

        .countdown-sep {
            font-size: 1.35rem;
            margin-bottom: 0.75rem;
        }

        .action-btn {
            padding: 1rem;
            font-size: 0.95rem;
        }

        .action-btn .icon {
            font-size: 1.35rem;
        }

        .capacity-banner {
            padding: 1.25rem 0.875rem;
        }

        .capacity-banner h2 {
            font-size: 1.3rem;
        }

        .capacity-banner p {
            font-size: 0.9rem;
        }

        .capacity-icon {
            font-size: 2.25rem;
        }

        .exam-info {
            padding: 1rem;
            margin-top: 1.25rem;
        }

        .info-grid {
            padding: 0.875rem;
            gap: 0.75rem;
        }

        .deadline-countdown {
            padding: 0.6rem 0.875rem;
        }

        .countdown-units.small .countdown-unit {
            padding: 0.4rem 0.6rem;
            min-width: 44px;
        }

        .countdown-units.small .unit-value {
            font-size: 1.15rem;
        }

        .notifications {
            top: 6px;
            right: 6px;
            left: 6px;
        }

        .notification {
            padding: 12px 14px;
            font-size: 0.85rem;
        }
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
        padding: 18px 20px;
        border-radius: 12px;
        background: white;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        border: 2px solid transparent;
    }

    .notification:hover {
        transform: translateX(-4px);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
    }

    .notification.success {
        border-left: 5px solid #48bb78;
        background: linear-gradient(to right, #f0fff4, #ffffff);
    }

    .notification.error {
        border-left: 5px solid #f56565;
        background: linear-gradient(to right, #fff5f5, #ffffff);
    }

    .notification.warning {
        border-left: 5px solid #ed8936;
        background: linear-gradient(to right, #fffaf0, #ffffff);
    }

    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-right: 12px;
        flex: 1;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        text-align: left;
    }

    .notification .icon {
        width: 28px;
        height: 28px;
        min-width: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        font-weight: bold;
        font-size: 0.875rem;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    .success .notification-content .icon {
        background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
        color: white;
    }

    .error .notification-content .icon {
        background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
        color: white;
    }

    .warning .notification-content .icon {
        background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
        color: white;
    }

    .message {
        color: #2d3748;
        font-size: 0.95rem;
        line-height: 1.5;
        font-weight: 500;
    }

    .close-btn {
        background: #f7fafc;
        border: none;
        color: #718096;
        cursor: pointer;
        padding: 0.375rem;
        font-size: 1rem;
        line-height: 1;
        border-radius: 6px;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
    }

    .close-btn:hover {
        background: #e2e8f0;
        color: #2d3748;
        transform: rotate(90deg);
    }

    .action-column {
        padding: 0;
    }

    .action-buttons {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        position: sticky;
        top: 2rem;
    }

    .action-btn {
        background: white;
        border: 2px solid #e2e8f0;
        border-radius: 12px;
        padding: 1.5rem;
        font-size: 1.05rem;
        font-weight: 600;
        color: #2d3748;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        text-decoration: none;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }

    .action-btn:hover {
        border-color: #14b8a6;
        background: linear-gradient(to right, #ebf8ff, #f7fafc);
        transform: translateY(-3px);
        box-shadow: 0 6px 20px rgba(49, 130, 206, 0.15);
    }

    .action-btn:active {
        transform: translateY(-1px);
    }

    .action-btn .icon {
        font-size: 1.75rem;
        transition: transform 0.3s ease;
    }
    
    .action-btn:hover .icon {
        transform: scale(1.1);
    }

    .school-input-container {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        position: relative;
    }

    .school-select {
        width: 100%;
        padding: 0.875rem 1rem;
        border: 2px solid #e2e8f0;
        border-radius: 10px;
        font-size: 1rem;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        background-color: #ffffff;
        cursor: pointer;
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23667eea' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 1rem center;
        background-size: 1.25rem;
        padding-right: 3rem;
        font-family: inherit;
    }
    
    .school-select:hover {
        border-color: #cbd5e0;
    }
    
    .school-select:focus {
        outline: none;
        border-color: #14b8a6;
        box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
        background-color: #ffffff;
    }

    .school-select.expanded {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        border-bottom-color: #14b8a6;
    }
    
    select option {
        padding: 0.75rem;
        background: white;
        color: #2d3748;
    }
    
    select option:hover {
        background: #f7fafc;
    }
    

    .custom-school-container {
        background: linear-gradient(to bottom, #f7fafc, #ffffff);
        border: 2px solid #14b8a6;
        border-top: none;
        border-bottom-left-radius: 10px;
        border-bottom-right-radius: 10px;
        padding: 1.25rem;
        animation: expandDown 0.3s ease-out;
    }
    
    @keyframes expandDown {
        from {
            opacity: 0;
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
        }
        to {
            opacity: 1;
            max-height: 200px;
            padding-top: 1.25rem;
            padding-bottom: 1.25rem;
        }
    }

    .custom-school-input {
        width: 100%;
        padding: 0.875rem 1rem;
        border: 2px solid #e2e8f0;
        border-radius: 10px;
        font-size: 1rem;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        background-color: #ffffff;
        font-family: inherit;
    }
    
    .custom-school-input:hover {
        border-color: #cbd5e0;
    }
    
    .custom-school-input:focus {
        outline: none;
        border-color: #14b8a6;
        box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
        background-color: #ffffff;
    }

    .helper-text {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: #718096;
        font-size: 0.875rem;
        margin-top: 0.75rem;
        padding: 0.5rem 0.75rem;
        background: #edf2f7;
        border-radius: 8px;
    }
    
    .helper-text::before {
        content: 'ℹ️';
        font-size: 1rem;
    }

    .exam-info {
        margin-top: 2rem;
        padding: 2rem;
        background: linear-gradient(135deg, rgba(13, 148, 136, 0.08) 0%, rgba(17, 94, 89, 0.08) 100%);
        border-radius: 16px;
        border: 2px solid #e2e8f0;
        box-shadow: 0 4px 20px rgba(102, 126, 234, 0.1);
        animation: slideUp 0.5s ease-out;
    }
    
    @keyframes slideUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    .exam-info h2 {
        color: #1a202c;
        font-size: 1.5rem;
        margin-bottom: 1.5rem;
        text-align: center;
        font-weight: 700;
    }

    .info-grid {
        display: grid;
        gap: 1.25rem;
        margin-bottom: 1.5rem;
        background: white;
        padding: 1.5rem;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }

    .info-item {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.75rem;
        border-left: 4px solid #14b8a6;
        background: #f8fafc;
        border-radius: 8px;
    }

    label {
        font-weight: 600;
        color: #2d3748;
        font-size: 1rem;
        margin-bottom: 0.5rem;
        transition: color 0.2s ease;
    }

    .label {
        font-weight: 600;
        color: #14b8a6;
        font-size: 0.875rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .value {
        color: #1a202c;
        font-size: 1.05rem;
        font-weight: 500;
    }
    
    input, select {
        width: 100%;
        padding: 0.875rem 1rem;
        border: 2px solid #e2e8f0;
        border-radius: 10px;
        font-size: 1rem;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        background-color: #ffffff;
        font-family: inherit;
    }
    
    input:hover, select:hover {
        border-color: #cbd5e0;
    }
    
    input:focus, select:focus {
        outline: none;
        border-color: #14b8a6;
        box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
        background-color: #ffffff;
    }
    
    input::placeholder {
        color: #a0aec0;
        font-size: 0.95rem;
    }
    
    input.invalid {
        animation: shake 0.4s ease;
    }
    
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-8px); }
        75% { transform: translateX(8px); }
    }

    .qr-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin: 1.5rem 0;
        gap: 0.75rem;
    }

    .qr-code {
        width: 140px;
        height: 140px;
        border: 3px solid #e2e8f0;
        border-radius: 12px;
        padding: 0.75rem;
        background: white;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        transition: transform 0.3s ease;
    }
    
    .qr-code:hover {
        transform: scale(1.05);
        border-color: #14b8a6;
    }

    .qr-label {
        color: #4a5568;
        font-size: 0.95rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .download-btn {
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        color: white;
        padding: 1.125rem 2rem;
        border: none;
        border-radius: 12px;
        font-size: 1.05rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        margin-top: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        text-decoration: none;
        box-shadow: 0 4px 15px rgba(245, 87, 108, 0.4);
        position: relative;
        overflow: hidden;
    }
    
    .download-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
        transition: left 0.5s ease;
    }
    
    .download-btn:hover::before {
        left: 100%;
    }

    .download-btn:hover {
        background: linear-gradient(135deg, #f5576c 0%, #f093fb 100%);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(245, 87, 108, 0.5);
    }

    .download-btn:active {
        transform: translateY(0);
    }

    .capacity-banner {
        background: linear-gradient(135deg, #fff5f5 0%, #fef5ff 100%);
        border: 2px solid #fc8181;
        border-radius: 16px;
        padding: 2rem;
        margin: 1.5rem 0 2rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        text-align: center;
        box-shadow: 0 4px 20px rgba(229, 62, 62, 0.15);
    }

    .capacity-banner h2 {
        color: #c53030;
        font-size: 1.65rem;
        font-weight: 800;
        margin: 0;
        letter-spacing: -0.025em;
    }

    .capacity-banner p {
        color: #4a5568;
        font-size: 1.1rem;
        margin: 0;
        max-width: 600px;
        line-height: 1.6;
    }

    .capacity-icon {
        font-size: 3rem;
        animation: pulse 2s ease-in-out infinite;
    }
    
    @keyframes pulse {
        0%, 100% {
            transform: scale(1);
            opacity: 1;
        }
        50% {
            transform: scale(1.1);
            opacity: 0.8;
        }
    }

    .primary-action {
        background: linear-gradient(135deg, #0d9488 0%, #115e59 100%);
        color: white !important;
        border: none;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    }
    
    .primary-action:hover {
        background: linear-gradient(135deg, #115e59 0%, #0d9488 100%);
        border: none;
        transform: translateY(-3px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
    }
    
    .primary-action .icon {
        filter: brightness(1.2);
    }

    /* New banner styles */
    .loading-banner,
    .application-banner,
    .exam-banner,
    .results-banner,
    .completed-banner,
    .inactive-banner,
    .countdown-banner {
        padding: 2rem;
        margin: 1.5rem 0 2rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        text-align: center;
        border-radius: 16px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        transition: transform 0.2s ease;
    }
    
    .loading-banner:hover,
    .application-banner:hover,
    .exam-banner:hover,
    .results-banner:hover,
    .completed-banner:hover,
    .inactive-banner:hover,
    .countdown-banner:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
    }

    .loading-banner {
        background: linear-gradient(to right, #e6f2ff, #f0f7ff);
        border: 2px solid #14b8a6;
    }

    .application-banner {
        background: linear-gradient(to right, #f0fff4, #e6fffa);
        border: 2px solid #48bb78;
    }

    .exam-banner {
        background: linear-gradient(to right, #fffbeb, #fef3c7);
        border: 2px solid #f6ad55;
    }

    .results-banner {
        background: linear-gradient(to right, #e6f7ff, #f0f7ff);
        border: 2px solid #14b8a6;
    }

    .completed-banner {
        background: linear-gradient(to right, #f0fff4, #e6fffa);
        border: 2px solid #48bb78;
    }

    .inactive-banner {
        background: linear-gradient(to right, #f7fafc, #edf2f7);
        border: 2px solid #a0aec0;
    }

    .success-notice {
        display: flex;
        align-items: flex-start;
        gap: 0.875rem;
        background: linear-gradient(to right, #fffbeb, #fef9c3);
        border: 2px solid #f59e0b;
        border-radius: 10px;
        padding: 1rem 1.25rem;
        margin-top: 1rem;
    }

    .success-notice-icon {
        font-size: 1.4rem;
        flex-shrink: 0;
        margin-top: 0.1rem;
    }

    .success-notice-text {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
    }

    .success-notice-text strong {
        color: #92400e;
        font-size: 0.95rem;
    }

    .success-notice-text p {
        color: #78350f;
        font-size: 0.9rem;
        margin: 0;
    }

    .notice-link, .exam-entry-link {
        display: inline-block;
        margin-top: 0.5rem;
        color: #0d9488;
        font-weight: 700;
        font-size: 0.9rem;
        text-decoration: none;
        transition: color 0.2s ease;
    }

    .notice-link:hover, .exam-entry-link:hover {
        color: #0f766e;
        text-decoration: underline;
    }

    .exam-entry-link {
        font-size: 1rem;
        margin-top: 0.25rem;
    }

    .countdown-banner {
        background: linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #115e59 100%);
        border: 2px solid #0d9488;
        color: white;
        padding: 2.5rem 2rem;
    }

    /* Countdown units — big version (start countdown) */
    .countdown-units {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 1rem 0 0.5rem;
    }

    .countdown-unit {
        display: flex;
        flex-direction: column;
        align-items: center;
        background: rgba(255, 255, 255, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 12px;
        padding: 0.75rem 1.25rem;
        min-width: 70px;
        backdrop-filter: blur(4px);
    }

    .unit-value {
        font-size: 2.25rem;
        font-weight: 800;
        line-height: 1;
        color: white;
        font-variant-numeric: tabular-nums;
    }

    .unit-label {
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.8);
        margin-top: 0.25rem;
    }

    .countdown-sep {
        font-size: 2rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.5);
        margin-bottom: 1.25rem;
        line-height: 1;
    }

    /* Smaller deadline countdown inside application banner */
    .deadline-countdown {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.25rem;
        background: rgba(47, 133, 90, 0.12);
        border: 1px solid rgba(47, 133, 90, 0.3);
        border-radius: 10px;
        margin-top: 0.25rem;
    }

    .deadline-countdown-label {
        font-size: 0.85rem;
        font-weight: 600;
        color: #2f855a;
    }

    .countdown-units.small .countdown-unit {
        background: rgba(47, 133, 90, 0.1);
        border-color: rgba(47, 133, 90, 0.25);
        padding: 0.5rem 0.875rem;
        min-width: 52px;
        border-radius: 8px;
    }

    .countdown-units.small .unit-value {
        font-size: 1.4rem;
        color: #2f855a;
    }

    .countdown-units.small .unit-label {
        color: rgba(47, 133, 90, 0.8);
    }

    .countdown-units.small .countdown-sep {
        font-size: 1.4rem;
        color: rgba(47, 133, 90, 0.4);
        margin-bottom: 0.875rem;
    }

    .countdown-open-date {
        font-size: 1rem;
        color: rgba(255, 255, 255, 0.9) !important;
        margin: 0;
    }

    .countdown-deadline-hint {
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.65) !important;
        margin-top: 0.25rem;
    }

    .deadline-date {
        font-size: 0.95rem;
        color: #4a5568;
    }

    .countdown-icon {
        font-size: 3rem;
        animation: bounce 2s ease-in-out infinite;
    }

    .countdown-banner h2 {
        color: white !important;
        margin: 0;
        font-size: 1.65rem;
        font-weight: 800;
    }

    .loading-banner h2,
    .application-banner h2,
    .exam-banner h2,
    .results-banner h2,
    .completed-banner h2,
    .inactive-banner h2 {
        margin: 0;
        font-size: 1.65rem;
        font-weight: 800;
        letter-spacing: -0.025em;
    }

    .loading-banner h2 {
        color: #2b6cb0;
    }

    .application-banner h2 {
        color: #2f855a;
    }

    .exam-banner h2 {
        color: #c05621;
    }

    .results-banner h2 {
        color: #2b6cb0;
    }

    .completed-banner h2 {
        color: #2f855a;
    }

    .inactive-banner h2 {
        color: #4a5568;
    }

    .loading-banner p,
    .application-banner p,
    .exam-banner p,
    .results-banner p,
    .completed-banner p,
    .inactive-banner p {
        color: #4a5568;
        font-size: 1.1rem;
        margin: 0;
        max-width: 600px;
    }

    .loading-icon,
    .application-icon,
    .exam-icon,
    .results-icon,
    .completed-icon,
    .inactive-icon,
    .countdown-icon {
        font-size: 3rem;
        animation: bounce 2s ease-in-out infinite;
    }
    
    @keyframes bounce {
        0%, 100% {
            transform: translateY(0);
        }
        50% {
            transform: translateY(-10px);
        }
    }
    
    .application-banner:hover .application-icon,
    .exam-banner:hover .exam-icon,
    .results-banner:hover .results-icon,
    .completed-banner:hover .completed-icon {
        animation: none;
        transform: scale(1.1) rotate(5deg);
        transition: transform 0.3s ease;
    }
</style>
