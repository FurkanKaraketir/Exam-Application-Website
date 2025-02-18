<script lang="ts">
    import { db } from '$lib/firebase';
    import { doc, getDoc } from 'firebase/firestore';
    import { fade, fly } from 'svelte/transition';
    import { jsPDF } from 'jspdf';
    
    let formData = {
        tcId: ''
    };
    
    let legalErrors = {
        tckn: ''
    };
    
    let notificationId = 0;
    let examData: any = null;
    let loading = false;
    
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
    
    async function handleSubmit() {
        if (!validateTCID(formData.tcId)) {
            return;
        }

        loading = true;
        examData = null;

        try {
            // Get application data
            const docRef = doc(db, "examApplications", formData.tcId);
            const docSnap = await getDoc(docRef);
            
            if (!docSnap.exists()) {
                showNotification('Bu TC Kimlik numarası ile başvuru bulunamadı.', 'error');
                loading = false;
                return;
            }

            const data = docSnap.data();

            // Get exam hall data
            if (!data.schoolName || !data.hallName) {
                showNotification('Sınav yeri atamanız henüz yapılmamış.', 'warning');
                loading = false;
                return;
            }

            examData = data;
        } catch (error) {
            console.error("Error fetching application: ", error);
            showNotification('Bilgiler alınırken bir hata oluştu. Lütfen tekrar deneyiniz.', 'error');
        }

        loading = false;
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
        doc.rect(15, 15, 180, 30); // Header border
        
        // Add header text
        doc.setFontSize(22);
        doc.setFont("DejaVuSans", "bold");
        doc.setTextColor(0, 51, 102); // Navy blue color for main title
        doc.text("SINAV GİRİŞ BELGESİ", 105, 32, { align: "center" });
    
        
        // Reset text color to black for content
        doc.setTextColor(0, 0, 0);
        
        // Add student information section
        doc.setFontSize(16);
        doc.setFont("DejaVuSans", "bold");
        doc.setTextColor(0, 51, 102); // Navy blue for section headers
        doc.text("ÖĞRENCİ BİLGİLERİ", 25, 60);
        
        // Add horizontal line under section header
        doc.setDrawColor(0, 51, 102);
        doc.line(25, 63, 185, 63);
        
        // Reset text color to black for content
        doc.setTextColor(0, 0, 0);
        
        doc.setFontSize(11);
        const studentInfo = [
            ["T.C. Kimlik No", ":", examData.tcId],
            ["Ad Soyad", ":", examData.studentFullName],
            ["Doğum Tarihi", ":", examData.birthDate],
            ["Okul", ":", examData.studentSchoolName],
            ["Veli Adı Soyadı", ":", examData.parentFullName],
            ["Telefon Numarası", ":", examData.phoneNumber]
        ];
        
        let y = 75;
        studentInfo.forEach(([label, separator, value]) => {
            doc.setFont("DejaVuSans", "bold");
            doc.text(label, 25, y);
            doc.text(separator, 70, y);
            doc.setFont("DejaVuSans", "normal");
            doc.text(value, 75, y);
            y += 12;
        });
        
        // Add exam location section
        doc.setFontSize(16);
        doc.setFont("DejaVuSans", "bold");
        doc.setTextColor(0, 51, 102); // Navy blue for section headers
        doc.text("SINAV YERİ BİLGİLERİ", 25, y + 15);
        
        // Add horizontal line under section header
        doc.line(25, y + 18, 185, y + 18);
        
        // Reset text color to black for content
        doc.setTextColor(0, 0, 0);
        
        doc.setFontSize(11);
        const examInfo = [
            ["Sınav Tarihi", ":", "19.04.2025"],
            ["Sınav Binası", ":", examData.schoolName],
            ["Sınav Salonu", ":", examData.hallName],
            ["Sıra No", ":", examData.orderNumber.toString()]
        ];
        
        y += 30;
        examInfo.forEach(([label, separator, value]) => {
            doc.setFont("DejaVuSans", "bold");
            doc.text(label, 25, y);
            doc.text(separator, 70, y);
            doc.setFont("DejaVuSans", "normal");
            doc.text(value, 75, y);
            y += 12;
        });
        
        // Add important notes section
        doc.setFontSize(16);
        doc.setFont("DejaVuSans", "bold");
        doc.setTextColor(0, 51, 102); // Navy blue for section headers
        doc.text("ÖNEMLİ NOTLAR", 25, y + 15);
        
        // Add horizontal line under section header
        doc.line(25, y + 18, 185, y + 18);
        
        // Reset text color to black for content
        doc.setTextColor(0, 0, 0);
        
        doc.setFontSize(10);
        doc.setFont("DejaVuSans", "normal");
        const notes = [
            "• Sınava gelirken bu belgeyi ve kimlik kartınızı yanınızda getirmeyi unutmayınız.",
            "• Sınavdan en az 30 dakika önce sınav yerinde hazır bulununuz.",
            "• Cep telefonu, akıllı saat vb. elektronik cihazlar sınav salonuna alınmayacaktır.",
            "• Sınav süresi boyunca sınav görevlilerinin tüm uyarılarına uyunuz."
        ];
        
        y += 30;
        notes.forEach(note => {
            const lines = doc.splitTextToSize(note, 160);
            lines.forEach((line: string) => {
                doc.text(line, 25, y);
                y += 7;
            });
        });
        
        // Add QR code for school location
        doc.addImage(`/${examData.schoolId}.png`, 'PNG', 160, 175, 30, 30);
        doc.setFontSize(10);
        doc.setFont("DejaVuSans", "bold");
        doc.setTextColor(0, 51, 102);
        doc.text('Okul Konumu', 175, 210, { align: 'center' });
        
        // Add footer to all pages
        const pageCount = doc.internal.pages.length - 1;
        
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
            <h1>Sınav Giriş Belgesi</h1>
            
            <form on:submit|preventDefault={handleSubmit} class="form">
                <div class="form-group">
                    <label for="tcId">T.C. Kimlik Numarası</label>
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
                
                <button type="submit" class="submit-btn" disabled={loading}>
                    {#if loading}
                        Yükleniyor...
                    {:else}
                        Sorgula
                    {/if}
                </button>
            </form>

            {#if examData}
                <div class="exam-info" transition:fade>
                    <h2>Sınav Bilgileri</h2>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="label">Ad Soyad:</span>
                            <span class="value">{examData.studentFullName}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Okul:</span>
                            <span class="value">{examData.studentSchoolName}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Veli Adı Soyadı:</span>
                            <span class="value">{examData.parentFullName}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Telefon Numarası:</span>
                            <span class="value">{examData.phoneNumber}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Sınav Tarihi:</span>
                            <span class="value">19.04.2025</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Sınav Binası:</span>
                            <span class="value">{examData.schoolName}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Sınav Salonu:</span>
                            <span class="value">{examData.hallName}</span>
                        </div>
                        <div class="info-item">
                            <span class="label">Sıra No:</span>
                            <span class="value">{examData.orderNumber.toString()}</span>
                        </div>
                    </div>
                    <div class="qr-section">
                        <img 
                            src="/{examData.schoolId}.png" 
                            alt="Okul Konumu QR Kodu"
                            class="qr-code"
                        />
                        <span class="qr-label">Okul Konumu QR Kodu</span>
                    </div>
                    <button class="download-btn" on:click={downloadExamDocument}>
                        <span class="icon">📄</span>
                        SINAV GİRİŞ BELGESİNİ İNDİR
                    </button>
                </div>
            {/if}
        </div>
    </div>
</main>

<style>
    .container {
        max-width: 800px;
        margin: 2rem auto;
        padding: 2rem;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .form-column {
        width: 100%;
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
    
    input {
        padding: 0.875rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        transition: all 0.2s ease;
        background-color: #f8fafc;
    }
    
    input:focus {
        outline: none;
        border-color: #3182ce;
        box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
        background-color: #ffffff;
    }
    
    .submit-btn, .download-btn {
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
    }
    
    .submit-btn:disabled {
        background: #cbd5e0;
        cursor: not-allowed;
    }
    
    .submit-btn:not(:disabled):hover, .download-btn:hover {
        background: linear-gradient(to right, #2c5282, #2a4365);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(49, 130, 206, 0.2);
    }
    
    .submit-btn:active, .download-btn:active {
        transform: translateY(0);
    }
    
    h1, h2 {
        color: #2d3748;
        margin-bottom: 2.5rem;
        text-align: center;
        font-weight: 700;
        position: relative;
        padding-bottom: 1rem;
    }

    h1 {
        font-size: 2rem;
    }

    h2 {
        font-size: 1.5rem;
        margin-bottom: 1.5rem;
    }
    
    h1::after, h2::after {
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

    @media (max-width: 768px) {
        .container {
            margin: 1rem;
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

        input {
            padding: 0.75rem;
            font-size: 0.95rem;
        }

        .submit-btn, .download-btn {
            padding: 0.875rem;
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

        .exam-info {
            padding: 1rem;
        }

        .info-grid {
            gap: 0.75rem;
        }

        .value {
            font-size: 1rem;
        }
    }
</style>
