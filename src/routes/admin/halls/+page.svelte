<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, getDocs, query, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import { jsPDF } from 'jspdf';

    interface School {
        id: string;
        name: string;
    }

    interface ExamHall {
        id: string;
        name: string;
        capacity: number;
        schoolId: string;
        schoolName: string;
    }

    let schools: School[] = [];
    let examHalls: ExamHall[] = [];
    let selectedSchool: School | null = null;
    let isCreateModalOpen = false;
    let isEditModalOpen = false;
    let selectedHall: ExamHall | null = null;
    let isDeleteModalOpen = false;
    let hallToDelete: ExamHall | null = null;

    let formData = {
        name: '',
        capacity: 20
    };

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
            schools = schoolsSnapshot.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name
            }));
            showNotification('Okullar başarıyla yüklendi.', 'success');
        } catch (error) {
            showNotification('Okullar yüklenirken bir hata oluştu.', 'error');
        }
    }

    async function loadExamHalls(school: School) {
        try {
            selectedSchool = school;
            const hallsQuery = query(collection(db, "schools", school.id, "examHalls"));
            const hallsSnapshot = await getDocs(hallsQuery);
            examHalls = hallsSnapshot.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name,
                capacity: doc.data().capacity,
                schoolId: school.id,
                schoolName: school.name
            })).sort((a, b) => {
                // Split the names into parts (letters and numbers)
                const aParts = a.name.match(/([a-zA-ZğüşıöçĞÜŞİÖÇ]+|\d+)/g) || [];
                const bParts = b.name.match(/([a-zA-ZğüşıöçĞÜŞİÖÇ]+|\d+)/g) || [];
                
                // Compare each part
                for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
                    const aIsNum = /^\d+$/.test(aParts[i]);
                    const bIsNum = /^\d+$/.test(bParts[i]);
                    
                    if (aIsNum && bIsNum) {
                        // If both parts are numbers, compare numerically
                        const diff = parseInt(aParts[i]) - parseInt(bParts[i]);
                        if (diff !== 0) return diff;
                    } else {
                        // If either part is not a number, compare as strings
                        const diff = aParts[i].localeCompare(bParts[i], 'tr');
                        if (diff !== 0) return diff;
                    }
                }
                
                // If all parts match up to the shortest length, shorter name comes first
                return aParts.length - bParts.length;
            });
            showNotification('Sınav salonları başarıyla yüklendi.', 'success');
        } catch (error) {
            showNotification('Sınav salonları yüklenirken bir hata oluştu.', 'error');
        }
    }

    function openCreateModal() {
        if (!selectedSchool) {
            showNotification('Lütfen önce bir okul seçin.', 'warning');
            return;
        }
        formData = {
            name: '',
            capacity: 20
        };
        isCreateModalOpen = true;
    }

    function openEditModal(hall: ExamHall) {
        selectedHall = hall;
        formData = {
            name: hall.name,
            capacity: hall.capacity
        };
        isEditModalOpen = true;
    }

    function closeModals() {
        isCreateModalOpen = false;
        isEditModalOpen = false;
        selectedHall = null;
        formData = {
            name: '',
            capacity: 20
        };
    }

    async function handleCreateSubmit() {
        if (!selectedSchool) return;

        try {
            const hallRef = doc(collection(db, "schools", selectedSchool.id, "examHalls"));
            await setDoc(hallRef, {
                name: formData.name,
                id: hallRef.id,
                capacity: formData.capacity
            });

            // Update local state
            examHalls = [...examHalls, {
                id: hallRef.id,
                name: formData.name,
                capacity: formData.capacity,
                schoolId: selectedSchool.id,
                schoolName: selectedSchool.name
            }];

            showNotification('Sınav salonu başarıyla oluşturuldu.', 'success');
            closeModals();
        } catch (error) {
            showNotification('Sınav salonu oluşturulurken bir hata oluştu.', 'error');
        }
    }

    async function handleEditSubmit() {
        if (!selectedHall || !selectedSchool) return;

        try {
            const hallRef = doc(db, "schools", selectedSchool.id, "examHalls", selectedHall.id);
            await updateDoc(hallRef, {
                name: formData.name,
                capacity: formData.capacity,
                id: hallRef.id
            });

            // Update local state
            examHalls = examHalls.map(hall => 
                hall.id === selectedHall?.id 
                    ? { ...hall, name: formData.name, capacity: formData.capacity }
                    : hall
            );

            showNotification('Sınav salonu başarıyla güncellendi.', 'success');
            closeModals();
        } catch (error) {
            showNotification('Sınav salonu güncellenirken bir hata oluştu.', 'error');
        }
    }

    async function handleDelete(hall: ExamHall) {
        hallToDelete = hall;
        isDeleteModalOpen = true;
    }

    async function confirmDelete() {
        if (!hallToDelete) return;

        try {
            await deleteDoc(doc(db, "schools", hallToDelete.schoolId, "examHalls", hallToDelete.id));

            // Update local state
            examHalls = examHalls.filter(h => h.id !== hallToDelete!.id);
            showNotification('Sınav salonu başarıyla silindi.', 'success');
        } catch (error) {
            showNotification('Sınav salonu silinirken bir hata oluştu.', 'error');
        } finally {
            isDeleteModalOpen = false;
            hallToDelete = null;
        }
    }

    async function generateHallLists() {
        if (!selectedSchool) {
            showNotification('Lütfen önce bir okul seçin.', 'warning');
            return;
        }

        try {
            // Create new PDF document
            const doc = new jsPDF();
            
            // Add local fonts
            doc.addFont("/fonts/DejaVuSans.ttf", "DejaVuSans", "normal");
            doc.addFont("/fonts/DejaVuSans-Bold.ttf", "DejaVuSans", "bold");
            
            // Set default font to DejaVuSans
            doc.setFont("DejaVuSans");

            let currentPage = 1;
            
            // For each exam hall
            for (let hallIndex = 0; hallIndex < examHalls.length; hallIndex++) {
                const hall = examHalls[hallIndex];
                
                // Get students in this hall
                const studentsSnapshot = await getDocs(collection(db, "schools", hall.schoolId, "examHalls", hall.id, "students"));
                const students = studentsSnapshot.docs.map(doc => doc.data());

                // Sort students by order number if there are any
                if (students.length > 0) {
                    students.sort((a, b) => a.orderNumber - b.orderNumber);
                }

                // Add new page for each hall (except first)
                if (hallIndex > 0) {
                    doc.addPage();
                    currentPage++;
                }
                
                // Add header with border
                doc.setDrawColor(0, 51, 102); // Navy blue color for borders
                doc.setLineWidth(0.5);
                doc.rect(10, 10, 190, 277); // Outer border
                doc.rect(15, 15, 180, 30); // Header border
                
                // Add header text
                doc.setFontSize(18);
                doc.setFont("DejaVuSans", "bold");
                doc.setTextColor(0, 51, 102); // Navy blue color for main title
                doc.text(`${hall.name} SINAV SALONU ÖĞRENCİ LİSTESİ`, 105, 32, { align: "center" });
                
                // Add hall information section
                doc.setFontSize(16);
                doc.setFont("DejaVuSans", "bold");
                doc.setTextColor(0, 51, 102);
                doc.text("SALON BİLGİLERİ", 25, 60);
                
                // Add horizontal line under section header
                doc.line(25, 63, 185, 63);
                
                // Reset text color to black for content
                doc.setTextColor(0, 0, 0);
                
                // Add hall info
                doc.setFontSize(11);
                let hallInfo: [string, string, string][] = [];
                if (hall.capacity >= students.length) {
                    hallInfo = [
                        ["Okul", ":", hall.schoolName],
                        ["Salon / Kapasite", ":", `${hall.name} / ${hall.capacity} kişilik`],
                        ["Öğrenci Sayısı / Sınav Tarihi", ":", `${students.length} öğrenci / 19.04.2025`]
                    ];
                } else {
                    hallInfo = [
                        ["Okul", ":", hall.schoolName],
                        ["Salon / Kapasite", ":", `${hall.name} / ${hall.capacity} + ${students.length - hall.capacity} kişilik`],
                        ["Öğrenci Sayısı / Sınav Tarihi", ":", `${students.length} öğrenci / 19.04.2025`]
                    ];
                }
                let y = 75;
                hallInfo.forEach(([label, separator, value]) => {
                    doc.setFont("DejaVuSans", "bold");
                    doc.text(label, 25, y);
                    doc.text(separator, 90, y);
                    doc.setFont("DejaVuSans", "normal");
                    doc.text(value, 95, y);
                    y += 12;
                });
                
                // Add student list section
                doc.setFontSize(16);
                doc.setFont("DejaVuSans", "bold");
                doc.setTextColor(0, 51, 82);
                doc.text("ÖĞRENCİ LİSTESİ", 25, y + 15);
                
                // Add horizontal line under section header
                doc.line(25, y + 18, 185, y + 18);
                
                // Create table header
                y += 30;
                doc.setFontSize(10);
                doc.setTextColor(0, 0, 0);
                
                const columns = [
                    { header: 'Sıra', x: 30 },
                    { header: 'TC No', x: 50 },
                    { header: 'Ad Soyad', x: 90 },
                ];
                
                // Draw table header
                columns.forEach(col => {
                    doc.setFont("DejaVuSans", "bold");
                    doc.text(col.header, col.x, y);
                });
                
                // Draw horizontal line under header
                y += 2;
                doc.line(25, y, 185, y);
                
                // Add student rows
                y += 8;
                doc.setFont("DejaVuSans", "normal");
                
                if (students.length === 0) {
                    doc.text("Bu salonda henüz öğrenci bulunmamaktadır.", 25, y);
                } else {
                    students.forEach((student, index) => {
                        if (y > 270) { // Check if we need a new page
                            doc.addPage();
                            currentPage++;
                            y = 30;
                            
                            // Redraw header on new page
                            doc.setFont("DejaVuSans", "bold");
                            columns.forEach(col => {
                                doc.text(col.header, col.x, y);
                            });
                            y += 2;
                            doc.line(25, y, 185, y);
                            y += 8;
                            doc.setFont("DejaVuSans", "normal");
                        }
                        
                        // Draw student data
                        doc.text(student.orderNumber.toString(), columns[0].x, y);
                        doc.text(student.tcId, columns[1].x, y);
                        doc.text(student.studentFullName, columns[2].x, y);
                        
                        y += 7;
                    });
                }
            }
            
            // Add footer to all pages
            const pageCount = doc.internal.pages.length - 1;
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(9);
                doc.setFont("DejaVuSans", "normal");
                doc.setTextColor(102, 102, 102); // Dark gray text
                const currentDate = new Date().toLocaleDateString('tr-TR');
                doc.text(`Bu belge ${currentDate} tarihinde elektronik olarak oluşturulmuştur. (Sayfa ${i}/${pageCount})`, 105, 285, { align: "center" });
            }
            
            // Save the PDF with school name
            doc.save(`${selectedSchool.name}_tum_salon_listeleri.pdf`);

            showNotification('Salon listeleri başarıyla oluşturuldu.', 'success');
        } catch (error) {
            showNotification('Salon listeleri oluşturulurken bir hata oluştu.', 'error');
        }
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
            <button class="close-btn" on:click|stopPropagation={() => removeNotification(notification.id)}>
                ✕
            </button>
        </div>
    {/each}
</div>

<main class="container">
    <h1>Sınav Salonları Yönetimi</h1>

    <div class="controls">
        <select 
            class="school-select"
            on:change={(e) => {
                const target = e.target as HTMLSelectElement;
                const school = schools.find(s => s.id === target.value);
                if (school) loadExamHalls(school);
            }}
        >
            <option value="">Okul seçiniz</option>
            {#each schools as school}
                <option value={school.id}>{school.name}</option>
            {/each}
        </select>
        <button on:click={openCreateModal} class="create-btn">
            Yeni Salon Ekle
        </button>
        <button on:click={generateHallLists} class="print-btn">
            Salon Listelerini Yazdır
        </button>
    </div>

    {#if selectedSchool}
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Salon Adı</th>
                        <th>Kapasite</th>
                        <th>İşlemler</th>
                    </tr>
                </thead>
                <tbody>
                    {#each examHalls as hall}
                        <tr>
                            <td>{hall.name}</td>
                            <td>{hall.capacity}</td>
                            <td>
                                <div class="action-buttons">
                                    <button class="edit-btn" on:click={() => openEditModal(hall)}>
                                        Düzenle
                                    </button>
                                    <button class="delete-btn" on:click={() => handleDelete(hall)}>
                                        Sil
                                    </button>
                                </div>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</main>

{#if isCreateModalOpen || isEditModalOpen}
    <div 
        class="modal-overlay"
        on:click={closeModals}
        on:keydown={(e) => e.key === 'Escape' && closeModals()}
        role="presentation"
    >
        <section 
            class="modal" 
            role="dialog"
            aria-modal="true"
        >
            <div 
                class="modal-container"
                on:click|stopPropagation
                on:keydown|stopPropagation
                role="button"
                tabindex="0"
            >
                <h2>{isCreateModalOpen ? 'Yeni Salon Ekle' : 'Salon Düzenle'}</h2>
                <form on:submit|preventDefault={isCreateModalOpen ? handleCreateSubmit : handleEditSubmit}>
                    <div class="form-group">
                        <label for="name">Salon Adı</label>
                        <input
                            type="text"
                            id="name"
                            bind:value={formData.name}
                            required
                            placeholder="Örn: A-101"
                        />
                    </div>

                    <div class="form-group">
                        <label for="capacity">Kapasite</label>
                        <input
                            type="number"
                            id="capacity"
                            bind:value={formData.capacity}
                            required
                            min="1"
                            max="100"
                        />
                    </div>

                    <div class="modal-actions">
                        <button type="button" class="cancel-btn" on:click={closeModals}>
                            İptal
                        </button>
                        <button type="submit" class="save-btn">
                            {isCreateModalOpen ? 'Oluştur' : 'Kaydet'}
                        </button>
                    </div>
                </form>
            </div>
        </section>
    </div>
{/if}

{#if isDeleteModalOpen && hallToDelete}
    <div 
        class="modal-overlay" 
        on:click={() => {
            isDeleteModalOpen = false;
            hallToDelete = null;
        }}
        on:keydown={(e) => e.key === 'Escape' && (isDeleteModalOpen = false)}
        role="button"
        tabindex="0"
    >
        <div 
            class="modal delete-confirmation-modal" 
            on:click|stopPropagation
            on:keydown|stopPropagation
            role="presentation"
        >
            <div class="delete-icon">
                <span>!</span>
            </div>
            <h2>Salon Silme Onayı</h2>
            <p class="delete-message">
                <strong>{hallToDelete.name}</strong> salonunu silmek istediğinizden emin misiniz?
            </p>
            <p class="delete-warning">Bu işlem geri alınamaz ve salondaki tüm öğrenci atamaları kaldırılacaktır!</p>
            <div class="modal-actions">
                <button 
                    type="button" 
                    class="cancel-btn" 
                    on:click={() => {
                        isDeleteModalOpen = false;
                        hallToDelete = null;
                    }}
                >
                    İptal
                </button>
                <button type="button" class="confirm-delete-btn" on:click={confirmDelete}>
                    Sil
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 2rem;
    }

    .controls {
        display: flex;
        gap: 1rem;
        margin-bottom: 2rem;
    }

    .school-select {
        flex: 1;
        padding: 0.75rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        background-color: #f8fafc;
        cursor: pointer;
    }

    .school-select:focus {
        outline: none;
        border-color: #3182ce;
        box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
    }

    .create-btn {
        padding: 0.75rem 1.5rem;
        background: linear-gradient(to right, #3182ce, #2c5282);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s ease;
    }

    .create-btn:hover {
        background: linear-gradient(to right, #2c5282, #2a4365);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(49, 130, 206, 0.2);
    }

    .table-container {
        overflow-x: auto;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    table {
        width: 100%;
        border-collapse: collapse;
    }

    th, td {
        padding: 1rem;
        text-align: left;
        border-bottom: 1px solid #e2e8f0;
    }

    th {
        background: #f7fafc;
        font-weight: 600;
    }

    tr:hover {
        background: #f7fafc;
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

    .action-buttons {
        display: flex;
        gap: 0.5rem;
    }

    .edit-btn, .delete-btn {
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.875rem;
        transition: all 0.2s ease;
        color: white;
    }

    .edit-btn {
        background: #3182ce;
    }

    .edit-btn:hover {
        background: #2c5282;
    }

    .delete-btn {
        background: #e53e3e;
    }

    .delete-btn:hover {
        background: #c53030;
    }

    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    }

    .modal {
        background: white;
        padding: 2rem;
        border-radius: 8px;
        width: 90%;
        max-width: 500px;
    }

    .modal h2 {
        margin-bottom: 1.5rem;
        color: #2d3748;
    }

    .form-group {
        margin-bottom: 1.5rem;
    }

    .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: #2d3748;
    }

    .form-group input {
        width: 100%;
        padding: 0.75rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        background-color: #f8fafc;
    }

    .form-group input:focus {
        outline: none;
        border-color: #3182ce;
        box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
    }

    .modal-actions {
        display: flex;
        gap: 1rem;
        justify-content: flex-end;
        margin-top: 2rem;
    }

    .cancel-btn, .save-btn {
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .cancel-btn {
        background: #e2e8f0;
        color: #2d3748;
        border: none;
    }

    .cancel-btn:hover {
        background: #cbd5e0;
    }

    .save-btn {
        background: linear-gradient(to right, #3182ce, #2c5282);
        color: white;
        border: none;
    }

    .save-btn:hover {
        background: linear-gradient(to right, #2c5282, #2a4365);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(49, 130, 206, 0.2);
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

    .print-btn {
        padding: 0.75rem 1.5rem;
        background: linear-gradient(to right, #2c5282, #2b6cb0);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s ease;
    }

    .print-btn:hover {
        background: linear-gradient(to right, #2b6cb0, #2c5282);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(44, 82, 130, 0.2);
    }

    .modal-container {
        width: 100%;
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        text-align: left;
        color: inherit;
        font: inherit;
    }

    @media (max-width: 768px) {
        .container {
            margin: 0.5rem;
            padding: 1rem;
        }

        .controls {
            flex-direction: column;
            gap: 0.75rem;
        }

        .school-select,
        .create-btn,
        .print-btn {
            width: 100%;
            padding: 0.75rem;
            font-size: 0.95rem;
        }

        .table-container {
            margin: 1rem -1rem;
            border-radius: 0;
            box-shadow: none;
        }

        table {
            display: block;
            overflow-x: auto;
            white-space: nowrap;
            -webkit-overflow-scrolling: touch;
        }

        th, td {
            padding: 0.75rem;
            font-size: 0.9rem;
        }

        .action-buttons {
            flex-wrap: nowrap;
        }

        .edit-btn,
        .delete-btn {
            padding: 0.4rem 0.75rem;
            font-size: 0.8rem;
        }

        .modal {
            width: 95%;
            padding: 1rem;
            margin: 0.5rem;
        }

        .modal h2 {
            font-size: 1.25rem;
            margin-bottom: 1rem;
        }

        .form-group {
            margin-bottom: 1rem;
        }

        .form-group label {
            font-size: 0.9rem;
        }

        .form-group input,
        

        .modal-actions {
            gap: 0.75rem;
        }

        .cancel-btn,
        .save-btn {
            padding: 0.625rem 1rem;
            font-size: 0.9rem;
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

        h1 {
            font-size: 1.5rem;
            margin-bottom: 1.5rem;
        }
    }

    .delete-confirmation-modal {
        max-width: 450px;
        text-align: center;
    }

    .delete-icon {
        width: 80px;
        height: 80px;
        margin: 0 auto 1.5rem;
        background: #FEF2F2;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 4px solid #FEE2E2;
    }

    .delete-icon span {
        color: #DC2626;
        font-size: 3rem;
        font-weight: bold;
        line-height: 1;
    }

    .delete-message {
        color: #1F2937;
        font-size: 1.1rem;
        margin-bottom: 1rem;
        line-height: 1.5;
    }

    .delete-message strong {
        color: #DC2626;
    }

    .delete-warning {
        color: #DC2626;
        font-size: 0.9rem;
        font-weight: 600;
        margin-bottom: 2rem;
    }

    .confirm-delete-btn {
        padding: 0.75rem 2rem;
        background: linear-gradient(to right, #DC2626, #B91C1C);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .confirm-delete-btn:hover {
        background: linear-gradient(to right, #B91C1C, #991B1B);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(220, 38, 38, 0.2);
    }

    @keyframes modalFadeIn {
        from {
            opacity: 0;
            transform: translateY(-20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .delete-confirmation-modal {
        animation: modalFadeIn 0.3s ease-out;
    }
</style> 