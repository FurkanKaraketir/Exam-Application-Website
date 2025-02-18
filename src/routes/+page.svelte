<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, doc, getDoc, setDoc, getDocs, deleteDoc, updateDoc } from 'firebase/firestore';
    import { fade, fly } from 'svelte/transition';
    import { onMount } from 'svelte';
    import { sendSMS } from '$lib/smsService';
    
    let formData = {
        tcId: '',
        studentFullName: '',
        birthDate: '',
        schoolName: '',
        parentFullName: '',
        phoneNumber: '',
    };
    
    let legalErrors = {
        tckn: '',
        phoneNumber: ''
    };

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
    let examEntryButton: HTMLAnchorElement;

    onMount(async () => {
        await loadSchools();
    });

    async function loadSchools() {
        try {
            const response = await fetch('/schools.txt');
            const text = await response.text();
            schools = text.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .sort();
        } catch (error) {
            console.error('Error loading schools:', error);
            showNotification('Okul listesi yüklenirken bir hata oluştu.', 'error');
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
        const formatted = input.value.replace(/[^0-9]/g, '').slice(0, 10);
        formData.phoneNumber = formatted;
        
        if (formatted.length === 0) {
            legalErrors.phoneNumber = '';
            input.setCustomValidity('');
        } else if (formatted.length !== 10) {
            legalErrors.phoneNumber = '10 haneli telefon numarası giriniz.';
            input.setCustomValidity('10 haneli telefon numarası giriniz.');
        } else {
            legalErrors.phoneNumber = '';
            input.setCustomValidity('');
        }
    }
    
    async function handleSubmit() {
        // Check submission deadline
        const deadline = new Date('2025-04-19');
        const now = new Date();
        
        if (now > deadline) {
            showNotification('Başvuru dönemi sona ermiştir.', 'error');
            return;
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
                examEntryButton?.focus();
                examEntryButton?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
                            birthDate: formData.birthDate,
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
                                birthDate: formData.birthDate,
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

            // Send SMS notification
            const smsMessage = `Sayın ${formData.studentFullName}, sınav başvurunuz başarıyla alınmıştır. Sınav yeriniz: ${assignedSchool} - ${assignedHall}. Sınav giriş belgenizi web sitemizden alabilirsiniz.`;
            const smsResult = await sendSMS(formData.phoneNumber, smsMessage);
            
            if (!smsResult.success) {
                console.error('SMS gönderilemedi:', smsResult.error);
            }

            showNotification('Başvurunuz başarıyla gönderildi ve sınav yeriniz atandı!', 'success');

            // Reset form
            formData = {
                tcId: '',
                studentFullName: '',
                birthDate: '',
                schoolName: '',
                parentFullName: '',
                phoneNumber: '',
            };
        } catch (error) {
            console.error("Error submitting application: ", error);
            showNotification('Başvuru gönderilirken bir hata oluştu. Lütfen tekrar deneyiniz.', 'error');
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
    <div class="content-wrapper">
        <div class="form-column">
            <h1>Recep Tayyip Erdoğan Proje İmam Hatip Lisesi <br> 5. Sınıf Kayıt Kabul Sınavı Başvuru Formu</h1>
            
            <form on:submit|preventDefault={handleSubmit} class="form">
                <div class="form-group">
                    <label for="tcId">Öğrenci T.C. Kimlik Numarası</label>
                    <input
                        type="text"
                        id="tcId"
                        bind:value={formData.tcId}
                        required
                        minlength="11"
                        maxlength="11"
                        inputmode="numeric"
                        placeholder="T.C. Kimlik Numaranızı giriniz"
                        on:input={handleTCKNInput}
                        class:invalid={legalErrors.tckn !== ''}
                    />
                    {#if legalErrors.tckn}
                        <span class="error-message">{legalErrors.tckn}</span>
                    {/if}
                </div>
                
                <div class="form-group">
                    <label for="studentFullName">Öğrenci Adı Soyadı</label>
                    <input
                        type="text"
                        id="studentFullName"
                        bind:value={formData.studentFullName}
                        required
                        placeholder="Öğrencinin adını ve soyadını giriniz"
                        on:input={(e) => handleNameInput(e, 'studentFullName')}
                    />
                </div>

                <div class="form-group">
                    <label for="birthDate">Doğum Tarihi</label>
                    <input
                        type="date"
                        id="birthDate"
                        bind:value={formData.birthDate}
                        required
                    />
                </div>

                <div class="form-group">
                    <label for="schoolName">Okul Adı</label>
                    <select
                        id="schoolName"
                        bind:value={formData.schoolName}
                        required
                        class="school-select"
                    >
                        <option value="">Okul seçiniz</option>
                        {#each schools as school}
                            <option value={school}>{school}</option>
                        {/each}
                    </select>
                </div>

                <div class="form-group">
                    <label for="parentFullName">Veli Adı Soyadı</label>
                    <input
                        type="text"
                        id="parentFullName"
                        bind:value={formData.parentFullName}
                        required
                        placeholder="Velinin adını ve soyadını giriniz"
                        on:input={(e) => handleNameInput(e, 'parentFullName')}
                    />
                </div>

                <div class="form-group">
                    <label for="phoneNumber">İletişim Telefonu</label>
                    <input
                        type="text"
                        id="phoneNumber"
                        bind:value={formData.phoneNumber}
                        required
                        minlength="10"
                        maxlength="10"
                        inputmode="numeric"
                        placeholder="Telefon numarasını giriniz (5XX...)"
                        on:input={handlePhoneInput}
                        class:invalid={legalErrors.phoneNumber !== ''}
                    />
                    {#if legalErrors.phoneNumber}
                        <span class="error-message">{legalErrors.phoneNumber}</span>
                    {/if}
                </div>
                
                <button type="submit" class="submit-btn">Başvuruyu Gönder</button>
            </form>
        </div>
        <div class="action-column">
            <div class="action-buttons">
                <a href="/sinav-giris-belgesi" class="action-btn" bind:this={examEntryButton}>
                    <span class="icon">📄</span>
                    Sınav Giriş Belgesi
                </a>
                <button class="action-btn">
                    <span class="icon">📊</span>
                    Sınav Sonuçları
                </button>
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
    
    label {
        font-weight: 600;
        color: #2d3748;
        font-size: 0.95rem;
    }
    
    input, select {
        padding: 0.875rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        transition: all 0.2s ease;
        background-color: #f8fafc;
    }
    
    input:focus, select:focus {
        outline: none;
        border-color: #3182ce;
        box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
        background-color: #ffffff;
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
    
    input:not(:placeholder-shown):invalid {
        border-color: #e53e3e;
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

        input, select {
            padding: 0.75rem;
            font-size: 0.95rem;
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

    .school-select {
        width: 100%;
        padding: 0.875rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        transition: all 0.2s ease;
        background-color: #f8fafc;
        cursor: pointer;
    }
    
    .school-select:focus {
        outline: none;
        border-color: #3182ce;
        box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
        background-color: #ffffff;
    }
    
    .school-select option {
        padding: 0.5rem;
    }
</style>
