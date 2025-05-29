<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, doc, getDoc, setDoc, getDocs, deleteDoc, updateDoc } from 'firebase/firestore';
    import { fade, fly } from 'svelte/transition';
    import { onMount } from 'svelte';
    import { jsPDF } from 'jspdf';
    import { goto } from '$app/navigation';
    import { browser } from '$app/environment';
    
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
    
    // Remove hardcoded values and use dynamic settings
    let applicationDeadline: Date | null = null;
    let examDate: Date | null = null;
    let isApplicationEnabled = false;
    let currentPhase: string = 'application';
    
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

    let schools: string[] = [];
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
        
        await loadSchools();
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
                    applicationDeadline: data.applicationDeadline || '',
                    examDate: data.examDate || '',
                    resultsReleaseDate: data.resultsReleaseDate || '',
                    applicationEnabled: data.applicationEnabled || false,
                    resultsEnabled: data.resultsEnabled || false,
                    currentYear: data.currentYear || 2025,
                    currentPhase: data.currentPhase || 'application',
                    resultsFileUrl: data.resultsFileUrl || '',
                    lastUpdated: data.lastUpdated?.toDate() || new Date()
                };
                
                // Update local variables
                applicationDeadline = systemSettings.applicationDeadline ? new Date(systemSettings.applicationDeadline) : null;
                examDate = systemSettings.examDate ? new Date(systemSettings.examDate) : null;
                isApplicationEnabled = systemSettings.applicationEnabled;
                currentPhase = systemSettings.currentPhase;
            } else {
                // Create default settings if they don't exist
                const defaultSettings = {
                    applicationDeadline: '',
                    examDate: '',
                    resultsReleaseDate: '',
                    applicationEnabled: false,
                    resultsEnabled: false,
                    currentYear: 2025,
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

    async function loadSchools() {
        try {
            const response = await fetch('/schools.txt');
            const text = await response.text();
            schools = text.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .sort();
        } catch (error) {
            showNotification('Okul listesi yüklenirken bir hata oluştu.', 'error');
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

        try {
            // Check if document already exists
            const docRef = doc(db, "examApplications", formData.tcId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                showNotification('Bu TC Kimlik numarası ile daha önce başvuru yapılmış. Sınav giriş belgenizi alabilirsiniz.', 'warning');
                return;
            }

            // Create new document with TC ID as document ID
            await setDoc(docRef, formData);

            // Get all schools
            const schoolsSnapshot = await getDocs(collection(db, "schools"));
            const schools = schoolsSnapshot.docs;

            if (schools.length === 0) {
                showNotification('Sınav yeri ataması yapılamadı. Lütfen daha sonra tekrar deneyiniz.', 'error');
                return;
            }

            // Fisher-Yates shuffle algorithm
            function shuffle<T>(array: T[]): T[] {
                let currentIndex = array.length;
                let randomIndex;

                while (currentIndex !== 0) {
                    randomIndex = Math.floor(Math.random() * currentIndex);
                    currentIndex--;

                    [array[currentIndex], array[randomIndex]] = 
                    [array[randomIndex], array[currentIndex]];
                }

                return array;
            }

            let assigned = false;
            let capacityIncrease = 0;
            let assignedSchool;
            let assignedHall;
            let assignedSchoolId;
            let assignedHallId;

            // Get and shuffle all schools
            const shuffledSchools = shuffle([...schools]);

            // Try each school in shuffled order
            for (const school of shuffledSchools) {
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
                    
                    // Check if hall has capacity (with potential increase)
                    if (studentsSnapshot.size < (hallData.capacity + capacityIncrease)) {
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

            // If no assignment was possible with current capacity, try with increased capacity
            if (!assigned && capacityIncrease === 0) {
                capacityIncrease = 5;
                // Retry the entire process with increased capacity
                for (const school of shuffledSchools) {
                    if (assigned) break;

                    const examHallsSnapshot = await getDocs(collection(db, "schools", school.id, "examHalls"));
                    const examHalls = examHallsSnapshot.docs;

                    if (examHalls.length === 0) continue;

                    const shuffledHalls = shuffle([...examHalls]);

                    for (const hall of shuffledHalls) {
                        const hallData = hall.data();
                        const studentsSnapshot = await getDocs(collection(db, "schools", school.id, "examHalls", hall.id, "students"));
                        
                        if (studentsSnapshot.size < (hallData.capacity + capacityIncrease)) {
                            await setDoc(doc(db, "schools", school.id, "examHalls", hall.id, "students", formData.tcId), {
                                tcId: formData.tcId,
                                studentFullName: formData.studentFullName,
                                schoolId: school.id,
                                schoolName: school.data().name,
                                studentSchoolName: formData.schoolName,
                                parentFullName: formData.parentFullName,
                                phoneNumber: formData.phoneNumber,
                                hallName: hallData.name,
                                hallId: hall.id,
                                assignedAt: new Date(),
                                orderNumber: studentsSnapshot.size + 1
                            });

                            await updateDoc(docRef, {
                                studentSchoolName: formData.schoolName,
                                schoolName: school.data().name,
                                hallName: hallData.name,
                                schoolId: school.id,
                                hallId: hall.id,
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
            }

            if (!assigned) {
                showNotification('Sınav yeri ataması yapılamadı. Lütfen daha sonra tekrar deneyiniz.', 'error');
                // Delete the application since we couldn't assign a hall
                await deleteDoc(docRef);
                return;
            }

            showNotification('Başvurunuz başarıyla gönderildi ve sınav yeriniz atandı!', 'success');

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
            showNotification('Başvuru gönderilirken bir hata oluştu. Lütfen tekrar deneyiniz.', 'error');
        }
    }

    function downloadExamDocument() {
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
            ["Sınav Tarihi", ":", "19.04.2025"],
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
        // Add QR code for school location
        doc.addImage(`/${examData.schoolId}.png`, 'PNG', 155, qr_location, 30, 30);
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
            <h1>Recep Tayyip Erdoğan Proje İmam Hatip Lisesi <br> {systemSettings?.currentYear || 2025}. Sınıf Kayıt Kabul Sınavı</h1>
            
            {#if isLoadingSettings}
                <div class="loading-banner">
                    <span class="loading-icon">⏳</span>
                    <h2>Sistem Bilgileri Yükleniyor...</h2>
                    <p>Lütfen bekleyiniz.</p>
                </div>
            {:else if currentPhase === 'application' && isApplicationEnabled}
                <!-- Application Form -->
                <div class="application-banner">
                    <span class="application-icon">📝</span>
                    <h2>Başvuru Dönemi Açıktır</h2>
                    {#if applicationDeadline}
                        <p>Son başvuru tarihi: {applicationDeadline.toLocaleDateString('tr-TR', { 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })}</p>
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

                    <button type="submit" class="submit-btn">
                        Başvurumu Gönder
                    </button>
                </form>

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
                    <p>Başvurular tamamlanmıştır. Sınav giriş belgenizi alabilirsiniz.</p>
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
                
                {#if currentPhase !== 'application' || !isApplicationEnabled}
                    <a href="/sinav-giris-belgesi" class="action-btn">
                        <span class="icon">📄</span>
                        Sınav Giriş Belgesi
                    </a>
                {/if}
            </div>
        </div>
    </div>
</main>

<style>
    .container {
        max-width: 1200px;
        margin: 2rem auto;
        padding: 2rem;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .content-wrapper {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 2rem;
    }

    .form-column {
        flex: 1;
    }
    
    .form {
        display: flex;
        flex-direction: column;
        gap: 1.75rem;
        background: #ffffff;
        padding: 2rem;
        border-radius: 8px;
    }
    
    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
    }
    
    .submit-btn {
        background: linear-gradient(to right, #3182ce, #2c5282);
        color: white;
        padding: 1rem;
        border: none;
        border-radius: 8px;
        font-size: 1.1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        margin-top: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    
    .submit-btn:hover {
        background: linear-gradient(to right, #2c5282, #2a4365);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(49, 130, 206, 0.2);
    }
    
    .submit-btn:active {
        transform: translateY(0);
    }
    
    h1 {
        color: #2d3748;
        margin-bottom: 2.5rem;
        text-align: center;
        font-size: 2rem;
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
        width: 100px;
        height: 3px;
        background: linear-gradient(to right, #3182ce, #2c5282);
        border-radius: 2px;
    }
    
    .error-message {
        color: #e53e3e;
        font-size: 0.875rem;
        margin-top: 0.25rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    
    .error-message::before {
        content: '⚠️';
    }
    
    .invalid {
        border-color: #e53e3e !important;
        background-color: #fff5f5;
    }
    
    
    @media (max-width: 768px) {
        .content-wrapper {
            grid-template-columns: 1fr;
        }
        
        .container {
            margin: 0.5rem;
            padding: 1rem;
        }
        
        .form {
            padding: 1rem;
        }
        
        h1 {
            font-size: 1.5rem;
            margin-bottom: 1.5rem;
        }

        .form-group {
            gap: 0.5rem;
        }


        .submit-btn {
            padding: 0.875rem;
            font-size: 1rem;
        }

        .action-column {
            padding: 1rem 0;
        }

        .action-btn {
            padding: 1rem;
            font-size: 1rem;
        }

        .notifications {
            top: 10px;
            right: 10px;
            left: 10px;
            max-width: none;
        }

        .notification {
            padding: 12px;
            font-size: 0.9rem;
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

    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-right: 12px;
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

    .action-column {
        padding: 2rem 0;
    }

    .action-buttons {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .action-btn {
        background: white;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        padding: 1.25rem;
        font-size: 1.1rem;
        font-weight: 600;
        color: #2d3748;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .action-btn:hover {
        border-color: #3182ce;
        background: #f7fafc;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(49, 130, 206, 0.1);
    }

    .action-btn:active {
        transform: translateY(0);
    }

    .action-btn .icon {
        font-size: 1.5rem;
    }

    .school-input-container {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        position: relative;
    }

    .school-select {
        width: 100%;
        padding: 0.875rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        transition: all 0.3s ease;
        background-color: #f8fafc;
        cursor: pointer;
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%234a5568' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 0.875rem center;
        background-size: 1.25rem;
        padding-right: 2.5rem;
    }
    
    .school-select:focus {
        outline: none;
        border-color: #3182ce;
        box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
        background-color: #ffffff;
    }

    .school-select.expanded {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        border-bottom-color: transparent;
    }
    

    .custom-school-container {
        background-color: white;
        border: 2px solid #3182ce;
        border-top: none;
        border-bottom-left-radius: 8px;
        border-bottom-right-radius: 8px;
        padding: 1rem;
    }

    .custom-school-input {
        width: 100%;
        padding: 0.875rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        transition: all 0.2s ease;
        background-color: #f8fafc;
    }
    
    .custom-school-input:focus {
        outline: none;
        border-color: #3182ce;
        box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
        background-color: #ffffff;
    }

    .helper-text {
        display: block;
        color: #718096;
        font-size: 0.875rem;
        margin-top: 0.5rem;
        padding-left: 0.5rem;
    }

    .exam-info {
        margin-top: 2rem;
        padding: 2rem;
        background: #f7fafc;
        border-radius: 8px;
        border: 2px solid #e2e8f0;
    }

    .info-grid {
        display: grid;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }

    .info-item {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .label {
        font-weight: 600;
        color: #4a5568;
        font-size: 0.9rem;
    }

    .value {
        color: #2d3748;
        font-size: 1.1rem;
    }

    .qr-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin: 1.5rem 0;
        gap: 0.5rem;
    }

    .qr-code {
        width: 120px;
        height: 120px;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        padding: 0.5rem;
        background: white;
    }

    .qr-label {
        color: #4a5568;
        font-size: 0.9rem;
        font-weight: 600;
    }

    .download-btn {
        background: linear-gradient(to right, #3182ce, #2c5282);
        color: white;
        padding: 1rem;
        border: none;
        border-radius: 8px;
        font-size: 1.1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        margin-top: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        text-decoration: none;
    }

    .download-btn:hover {
        background: linear-gradient(to right, #2c5282, #2a4365);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(49, 130, 206, 0.2);
    }

    .download-btn:active {
        transform: translateY(0);
    }

    .capacity-banner {
        background: linear-gradient(to right, #fff5f5, #faf5ff);
        border: 2px solid #e53e3e;
        border-radius: 8px;
        padding: 1.5rem;
        margin: 1.5rem 0 2.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        text-align: center;
    }

    .capacity-banner h2 {
        color: #c53030;
        font-size: 1.5rem;
        font-weight: 700;
        margin: 0;
    }

    .capacity-banner p {
        color: #4a5568;
        font-size: 1.1rem;
        margin: 0;
        max-width: 600px;
    }

    .capacity-icon {
        font-size: 2rem;
    }

    .primary-action {
        background: linear-gradient(to right, #3182ce, #2c5282);
        color: white !important;
        border: none;
    }
    
    .primary-action:hover {
        background: linear-gradient(to right, #2c5282, #2a4365);
        border: none;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(49, 130, 206, 0.2);
    }

    /* New banner styles */
    .loading-banner,
    .application-banner,
    .exam-banner,
    .results-banner,
    .completed-banner,
    .inactive-banner {
        padding: 1.5rem;
        margin: 1.5rem 0 2.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        text-align: center;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .loading-banner {
        background: linear-gradient(to right, #e6f2ff, #f0f7ff);
        border: 2px solid #4299e1;
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
        border: 2px solid #4299e1;
    }

    .completed-banner {
        background: linear-gradient(to right, #f0fff4, #e6fffa);
        border: 2px solid #48bb78;
    }

    .inactive-banner {
        background: linear-gradient(to right, #f7fafc, #edf2f7);
        border: 2px solid #a0aec0;
    }

    .loading-banner h2,
    .application-banner h2,
    .exam-banner h2,
    .results-banner h2,
    .completed-banner h2,
    .inactive-banner h2 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 700;
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
    .inactive-icon {
        font-size: 2rem;
    }
</style>
