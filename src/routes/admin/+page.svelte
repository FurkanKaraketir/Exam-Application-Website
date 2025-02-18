<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, getDocs, query, orderBy, updateDoc, doc, deleteDoc, type QueryDocumentSnapshot, addDoc, setDoc } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import * as XLSX from 'xlsx';

    interface ExamApplication {
        tcId: string;
        studentFullName: string;
        birthDate: string;
        schoolName: string;
        parentFullName: string;
        phoneNumber: string;
        hallName?: string;
        assignedAt?: Date;
        studentSchoolName?: string;
        schoolId?: string;
        hallId?: string;
        orderNumber?: number;
    }

    let applications: ExamApplication[] = [];
    let filteredApplications: ExamApplication[] = [];
    let searchTerm = '';
    let sortField: keyof ExamApplication = 'assignedAt';
    let sortDirection: 'asc' | 'desc' = 'desc';
    let selectedApplication: ExamApplication | null = null;
    let isEditModalOpen = false;
    let editFormData: Partial<ExamApplication> = {};
    let schools: string[] = [];
    let isAddSchoolModalOpen = false;
    let newSchoolName = '';

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
        await Promise.all([
            loadApplications(),
            loadSchools()
        ]);
    });

    async function loadSchools() {
        try {
            const schoolsQuery = query(collection(db, "schools"), orderBy("name"));
            const querySnapshot = await getDocs(schoolsQuery);
            schools = querySnapshot.docs.map(doc => doc.data().name).sort();
        } catch (error) {
            console.error('Error loading schools:', error);
            showNotification('Okul listesi yüklenirken bir hata oluştu.', 'error');
        }
    }

    async function loadApplications() {
        try {
            const q = query(collection(db, "examApplications"), orderBy("assignedAt", "desc"));
            const querySnapshot = await getDocs(q);
            applications = querySnapshot.docs.map((doc: QueryDocumentSnapshot) => ({
                tcId: doc.id,
                studentFullName: doc.data().studentFullName || '',
                birthDate: doc.data().birthDate || '',
                schoolName: doc.data().schoolName || '',
                parentFullName: doc.data().parentFullName || '',
                phoneNumber: doc.data().phoneNumber || '',
                hallName: doc.data().hallName,
                assignedAt: doc.data().assignedAt?.toDate() || null,
                studentSchoolName: doc.data().studentSchoolName || '',
                schoolId: doc.data().schoolId || '',
                hallId: doc.data().hallId || '',
                orderNumber: doc.data().orderNumber || null
            } as ExamApplication));
            filterApplications();
            showNotification('Başvurular başarıyla yüklendi.', 'success');
        } catch (error) {
            console.error("Error loading applications: ", error);
            showNotification('Başvurular yüklenirken bir hata oluştu.', 'error');
        }
    }

    function filterApplications() {
        filteredApplications = applications.filter(app => 
            app.studentFullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            app.tcId.includes(searchTerm) ||
            app.schoolName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            app.hallName?.toLowerCase().includes(searchTerm.toLowerCase())
        );
        sortApplications();
    }

    function sortApplications() {
        filteredApplications.sort((a, b) => {
            const aValue = a[sortField];
            const bValue = b[sortField];
            
            if (!aValue && !bValue) return 0;
            if (!aValue) return 1;
            if (!bValue) return -1;
            
            const modifier = sortDirection === 'asc' ? 1 : -1;
            
            if (aValue < bValue) return -1 * modifier;
            if (aValue > bValue) return 1 * modifier;
            return 0;
        });
        filteredApplications = [...filteredApplications];
    }

    function handleSort(field: keyof ExamApplication) {
        if (sortField === field) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            sortField = field;
            sortDirection = 'asc';
        }
        sortApplications();
    }

    function openEditModal(application: ExamApplication) {
        selectedApplication = application;
        editFormData = { ...application };
        isEditModalOpen = true;
    }

    function closeEditModal() {
        isEditModalOpen = false;
        selectedApplication = null;
        editFormData = {};
    }

    async function handleEditSubmit() {
        if (!selectedApplication) return;

        try {
            const docRef = doc(db, "examApplications", selectedApplication.tcId);
            await updateDoc(docRef, {
                ...editFormData,
                lastUpdated: new Date()
            });

            // Update local state
            applications = applications.map(app => 
                app.tcId === selectedApplication?.tcId 
                    ? { ...app, ...editFormData }
                    : app
            );
            filterApplications();

            showNotification('Başvuru başarıyla güncellendi.', 'success');
            closeEditModal();
        } catch (error) {
            console.error("Error updating application: ", error);
            showNotification('Başvuru güncellenirken bir hata oluştu.', 'error');
        }
    }

    async function handleDelete(application: ExamApplication) {
        if (!confirm('Bu başvuruyu silmek istediğinizden emin misiniz?')) {
            return;
        }

        try {
            // Delete from examApplications collection
            await deleteDoc(doc(db, "examApplications", application.tcId));

            // If the application has a hall assignment, delete from the hall
            if (application.hallName && application.schoolName && application.schoolId && application.hallId) {
                await deleteDoc(doc(db, "schools", application.schoolId, "examHalls", application.hallId, "students", application.tcId));
            }

            // Update local state
            applications = applications.filter(app => app.tcId !== application.tcId);
            filterApplications();
            showNotification('Başvuru başarıyla silindi.', 'success');
        } catch (error) {
            console.error("Error deleting application: ", error);
            showNotification('Başvuru silinirken bir hata oluştu.', 'error');
        }
    }

    async function handleAddSchool() {
        if (!newSchoolName.trim()) {
            showNotification('Okul adı boş olamaz.', 'error');
            return;
        }

        try {
            // Add the school to Firestore
            const schoolsCollection = collection(db, "schools");
            const schoolRef = doc(schoolsCollection);
            await setDoc(schoolRef, {
                id: schoolRef.id,
                name: newSchoolName.trim(),
                createdAt: new Date()
            });

            showNotification('Okul başarıyla eklendi.', 'success');
            newSchoolName = '';
            isAddSchoolModalOpen = false;
            await loadSchools();
        } catch (error) {
            console.error("Error adding school: ", error);
            showNotification('Okul eklenirken bir hata oluştu.', 'error');
        }
    }

    function exportToExcel() {
        try {
            // Create worksheet data
            const wsData = [
                ['T.C. Kimlik No', 'Öğrenci Adı Soyadı', 'Doğum Tarihi', 'Veli Adı Soyadı', 'Telefon','Sınav Binası', 'Sınav Salonu', 'Sıra No', 'Başvuru Tarihi'],
                ...filteredApplications.map(app => [
                    app.tcId,
                    app.studentFullName,
                    app.birthDate,
                    app.parentFullName,
                    app.phoneNumber,
                    app.schoolName,
                    app.hallName || '-',
                    app.orderNumber?.toString() || '-',
                    app.assignedAt ? new Date(app.assignedAt).toLocaleDateString('tr-TR') : '-'
                ])
            ];

            // Create worksheet
            const ws = XLSX.utils.aoa_to_sheet(wsData);

            // Set column widths
            const colWidths = [
                { wch: 15 },  // TC ID
                { wch: 30 },  // Student Name
                { wch: 15 },  // Birth Date
                { wch: 30 },  // Parent Name
                { wch: 15 },  // Phone
                { wch: 35 },  // School
                { wch: 20 },  // Hall
                { wch: 10 },  // Order Number
                { wch: 15 }   // Application Date
            ];
            ws['!cols'] = colWidths;

            // Style the header row
            const headerStyle = {
                font: { bold: true, color: { rgb: "FFFFFF" } },
                fill: { fgColor: { rgb: "4F81BD" } },
                alignment: { horizontal: "center" }
            };

            // Apply header styles
            for (let i = 0; i < 9; i++) {
                const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
                ws[cellRef].s = headerStyle;
            }

            // Create workbook
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Sınav Başvuruları");

            // Generate Excel file
            const currentDate = new Date().toLocaleDateString('tr-TR').replace(/\./g, '-');
            XLSX.writeFile(wb, `sinav-basvurulari-${currentDate}.xlsx`);
            
            showNotification('Liste Excel formatında indirildi.', 'success');
        } catch (error) {
            console.error("Error exporting to Excel: ", error);
            showNotification('Liste indirilirken bir hata oluştu.', 'error');
        }
    }

    $: {
        if (searchTerm !== undefined) {
            filterApplications();
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
    <h1>Sınav Başvuruları</h1>

    <div class="controls">
        <input
            type="text"
            bind:value={searchTerm}
            placeholder="Başvuruları ara..."
            class="search-input"
        />
        <button on:click={() => isAddSchoolModalOpen = true} class="add-school-btn">
            Okul Ekle
        </button>
        <button on:click={exportToExcel} class="excel-btn">
            Excel'e Aktar
        </button>
        <a href="/admin/halls" class="halls-btn">
            Sınav Salonları
        </a>
        <button on:click={loadApplications} class="refresh-btn">
            Yenile
        </button>
    </div>

    <div class="table-container">
        <table>
            <thead>
                <tr>
                    <th 
                        on:click={() => handleSort('tcId')}
                        on:keydown={(e) => e.key === 'Enter' && handleSort('tcId')}
                        role="button"
                        tabindex="0"
                    >
                        T.C. Kimlik No
                        {#if sortField === 'tcId'}
                            <span class="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        {/if}
                    </th>
                    <th 
                        on:click={() => handleSort('studentFullName')}
                        on:keydown={(e) => e.key === 'Enter' && handleSort('studentFullName')}
                        role="button"
                        tabindex="0"
                    >
                        Öğrenci Adı Soyadı
                        {#if sortField === 'studentFullName'}
                            <span class="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        {/if}
                    </th>
                    <th 
                        on:click={() => handleSort('birthDate')}
                        on:keydown={(e) => e.key === 'Enter' && handleSort('birthDate')}
                        role="button"
                        tabindex="0"
                    >
                        Doğum Tarihi
                        {#if sortField === 'birthDate'}
                            <span class="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        {/if}
                    </th>
                    <th 
                        on:click={() => handleSort('schoolName')}
                        on:keydown={(e) => e.key === 'Enter' && handleSort('schoolName')}
                        role="button"
                        tabindex="0"
                    >
                        Okul
                        {#if sortField === 'schoolName'}
                            <span class="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        {/if}
                    </th>
                    <th 
                        on:click={() => handleSort('parentFullName')}
                        on:keydown={(e) => e.key === 'Enter' && handleSort('parentFullName')}
                        role="button"
                        tabindex="0"
                    >
                        Veli Adı Soyadı
                        {#if sortField === 'parentFullName'}
                            <span class="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        {/if}
                    </th>
                    <th 
                        on:click={() => handleSort('phoneNumber')}
                        on:keydown={(e) => e.key === 'Enter' && handleSort('phoneNumber')}
                        role="button"
                        tabindex="0"
                    >
                        Telefon
                        {#if sortField === 'phoneNumber'}
                            <span class="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        {/if}
                    </th>
                    <th 
                        on:click={() => handleSort('hallName')}
                        on:keydown={(e) => e.key === 'Enter' && handleSort('hallName')}
                        role="button"
                        tabindex="0"
                    >
                        Sınav Salonu
                        {#if sortField === 'hallName'}
                            <span class="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        {/if}
                    </th>
                    <th 
                        on:click={() => handleSort('orderNumber')}
                        on:keydown={(e) => e.key === 'Enter' && handleSort('orderNumber')}
                        role="button"
                        tabindex="0"
                    >
                        Sıra No
                        {#if sortField === 'orderNumber'}
                            <span class="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        {/if}
                    </th>
                    <th>İşlemler</th>
                </tr>
            </thead>
            <tbody>
                {#each filteredApplications as application}
                    <tr>
                        <td>{application.tcId}</td>
                        <td>{application.studentFullName}</td>
                        <td>{application.birthDate}</td>
                        <td>{application.schoolName}</td>
                        <td>{application.parentFullName}</td>
                        <td>{application.phoneNumber}</td>
                        <td>{application.hallName || '-'}</td>
                        <td>{application.orderNumber || '-'}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="edit-btn" on:click={() => openEditModal(application)}>
                                    Düzenle
                                </button>
                                <button class="delete-btn" on:click={() => handleDelete(application)}>
                                    Sil
                                </button>
                            </div>
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
</main>

{#if isEditModalOpen && selectedApplication}
    <div 
        class="modal-overlay" 
        on:click={closeEditModal}
        on:keydown={(e) => e.key === 'Escape' && closeEditModal()}
        role="button"
        tabindex="0"
    >
        <div 
            class="modal" 
            on:click|stopPropagation
            on:keydown|stopPropagation
            role="presentation"
        >
            <h2>Başvuru Düzenle</h2>
            <form on:submit|preventDefault={handleEditSubmit}>
                <div class="form-group">
                    <label for="studentFullName">Öğrenci Adı Soyadı</label>
                    <input
                        type="text"
                        id="studentFullName"
                        bind:value={editFormData.studentFullName}
                        required
                    />
                </div>

                <div class="form-group">
                    <label for="birthDate">Doğum Tarihi</label>
                    <input
                        type="date"
                        id="birthDate"
                        bind:value={editFormData.birthDate}
                        required
                    />
                </div>

                <div class="form-group">
                    <label for="schoolName">Okul</label>
                    <select
                        id="schoolName"
                        bind:value={editFormData.schoolName}
                        required
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
                        bind:value={editFormData.parentFullName}
                        required
                    />
                </div>

                <div class="form-group">
                    <label for="phoneNumber">Telefon</label>
                    <input
                        type="text"
                        id="phoneNumber"
                        bind:value={editFormData.phoneNumber}
                        required
                        minlength="10"
                        maxlength="10"
                    />
                </div>

                <div class="form-group">
                    <label for="hallName">Sınav Salonu</label>
                    <input
                        type="text"
                        id="hallName"
                        bind:value={editFormData.hallName}
                    />
                </div>

                <div class="form-group">
                    <label for="orderNumber">Sıra No</label>
                    <input
                        type="number"
                        id="orderNumber"
                        bind:value={editFormData.orderNumber}
                        min="1"
                    />
                </div>

                <div class="modal-actions">
                    <button type="button" class="cancel-btn" on:click={closeEditModal}>
                        İptal
                    </button>
                    <button type="submit" class="save-btn">
                        Kaydet
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}

{#if isAddSchoolModalOpen}
    <div 
        class="modal-overlay" 
        on:click={() => isAddSchoolModalOpen = false}
        on:keydown={(e) => e.key === 'Escape' && (isAddSchoolModalOpen = false)}
        role="button"
        tabindex="0"
    >
        <div 
            class="modal" 
            on:click|stopPropagation
            on:keydown|stopPropagation
            role="presentation"
        >
            <h2>Okul Ekle</h2>
            <form on:submit|preventDefault={handleAddSchool}>
                <div class="form-group">
                    <label for="schoolName">Okul Adı</label>
                    <input
                        type="text"
                        id="schoolName"
                        bind:value={newSchoolName}
                        required
                        placeholder="Okul adını giriniz"
                    />
                </div>

                <div class="modal-actions">
                    <button type="button" class="cancel-btn" on:click={() => isAddSchoolModalOpen = false}>
                        İptal
                    </button>
                    <button type="submit" class="save-btn">
                        Ekle
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}

<style>
    .container {
        max-width: 95%;
        margin: 0 auto;
        padding: 2rem;
    }

    .controls {
        display: flex;
        gap: 1rem;
        margin-bottom: 2rem;
        flex-wrap: nowrap;
        min-width: max-content;
    }

    .search-input {
        flex: 1;
        padding: 0.75rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        background-color: #f8fafc;
    }

    .search-input:focus {
        outline: none;
        border-color: #3182ce;
        box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
    }

    .halls-btn {
        padding: 0.75rem 1.5rem;
        background: linear-gradient(to right, #38a169, #2f855a);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s ease;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
    }

    .halls-btn:hover {
        background: linear-gradient(to right, #2f855a, #276749);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(56, 161, 105, 0.2);
    }

    .refresh-btn {
        padding: 0.75rem 1.5rem;
        background: linear-gradient(to right, #3182ce, #2c5282);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s ease;
    }

    .refresh-btn:hover {
        background: linear-gradient(to right, #2c5282, #2a4365);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(49, 130, 206, 0.2);
    }

    .table-container {
        overflow-x: auto;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        padding: 1rem;
        margin: 0;
        min-width: 100%;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        table-layout: auto;
        min-width: max-content;
    }

    th, td {
        padding: 1rem;
        text-align: left;
        border-bottom: 1px solid #e2e8f0;
        white-space: nowrap;
    }

    th:nth-child(1), td:nth-child(1) { width: 140px; } /* TC ID */
    th:nth-child(2), td:nth-child(2) { width: 250px; } /* Student Name */
    th:nth-child(3), td:nth-child(3) { width: 140px; } /* Birth Date */
    th:nth-child(4), td:nth-child(4) { width: 250px; } /* School */
    th:nth-child(5), td:nth-child(5) { width: 250px; } /* Parent Name */
    th:nth-child(6), td:nth-child(6) { width: 140px; } /* Phone */
    th:nth-child(7), td:nth-child(7) { width: 180px; } /* Exam Hall */
    th:nth-child(8), td:nth-child(8) { width: 120px; } /* Order No */
    th:nth-child(9), td:nth-child(9) { width: 140px; } /* Actions */

    th {
        background: #f7fafc;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s ease;
        position: sticky;
        top: 0;
        z-index: 10;
    }

    th:hover {
        background: #edf2f7;
    }

    tr:hover {
        background: #f7fafc;
    }

    .sort-indicator {
        margin-left: 0.5rem;
        color: #3182ce;
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

    .edit-btn {
        padding: 0.5rem 1rem;
        background: #3182ce;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.875rem;
        transition: background-color 0.2s ease;
    }

    .edit-btn:hover {
        background: #2c5282;
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
        max-width: 600px;
        max-height: 90vh;
        overflow-y: auto;
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

    .form-group input,
    .form-group select {
        width: 100%;
        padding: 0.75rem;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        background-color: #f8fafc;
    }

    .form-group input:focus,
    .form-group select:focus {
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

    .cancel-btn,
    .save-btn {
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

    @media (max-width: 768px) {
        .container {
            max-width: 100%;
            margin: 0;
            padding: 1rem;
        }

        .table-container {
            margin: 0;
            padding: 0;
        }

        table {
            min-width: max-content;
        }

        .controls {
            flex-direction: column;
            gap: 0.75rem;
        }

        .search-input,
        .add-school-btn,
        .halls-btn,
        .refresh-btn {
            width: 100%;
            padding: 0.75rem;
            font-size: 0.95rem;
        }

        th, td {
            padding: 0.75rem;
            font-size: 0.9rem;
            white-space: nowrap;
        }

        th:nth-child(n), td:nth-child(n) {
            min-width: unset;
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
        .form-group select {
            padding: 0.625rem;
            font-size: 0.9rem;
        }

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

    .action-buttons {
        display: flex;
        gap: 0.5rem;
    }

    .delete-btn {
        padding: 0.5rem 1rem;
        background: #e53e3e;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.875rem;
        transition: background-color 0.2s ease;
    }

    .delete-btn:hover {
        background: #c53030;
    }

    .add-school-btn {
        padding: 0.75rem 1.5rem;
        background: linear-gradient(to right, #805ad5, #6b46c1);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s ease;
    }

    .add-school-btn:hover {
        background: linear-gradient(to right, #6b46c1, #553c9a);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(107, 70, 193, 0.2);
    }

    .excel-btn {
        padding: 0.75rem 1.5rem;
        background: linear-gradient(to right, #059669, #047857);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s ease;
    }

    .excel-btn:hover {
        background: linear-gradient(to right, #047857, #065f46);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(5, 150, 105, 0.2);
    }
</style> 