<script lang="ts">
    import { db } from '$lib/firebase';
    import { collection, getDocs, query, orderBy, updateDoc, doc, deleteDoc, type QueryDocumentSnapshot, addDoc, setDoc, getDoc, deleteField } from 'firebase/firestore';
    import { onMount } from 'svelte';
    import * as XLSX from 'xlsx';
    import { fade } from 'svelte/transition';

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

    interface ExamApplication {
        tcId: string;
        studentFullName: string;
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

    interface School {
        id: string;
        name: string;
        weight?: number;
    }

    interface ExamHall {
        id: string;
        name: string;
        capacity: number;
        schoolId: string;
        schoolName: string;
    }

    interface HallStudent {
        id: string;
        tcId: string;
        studentFullName: string;
        schoolId: string;
        schoolName: string;
        studentSchoolName: string;
        parentFullName: string;
        phoneNumber: string;
        hallName: string;
        hallId: string;
        assignedAt: Date;
        orderNumber: number;
    }

    let applications: ExamApplication[] = [];
    let filteredApplications: ExamApplication[] = [];
    let searchTerm = '';
    let sortField: keyof ExamApplication = 'assignedAt';
    let sortDirection: 'asc' | 'desc' = 'desc';
    let selectedApplication: ExamApplication | null = null;
    let isEditModalOpen = false;
    let editFormData: Partial<ExamApplication> = {};
    let schools: School[] = [];
    let availableHalls: ExamHall[] = [];
    let isAddSchoolModalOpen = false;
    let newSchoolName = '';
    let totalCapacity = 0;
    let assignedCount = 0;
    interface SchoolCapacityStat {
        schoolId: string;
        schoolName: string;
        totalCapacity: number;
        assignedCount: number;
    }
    let schoolCapacityStats: SchoolCapacityStat[] = [];
    let isDeleteModalOpen = false;
    let applicationToDelete: ExamApplication | null = null;
    let originators: string[] = [];
    let error: string | null = null;
    let loading = true;
    let isRefreshing = false;
    let isResetRoomsModalOpen = false;
    let isResettingRooms = false;
    let isCustomSchool = false;
    let customSchoolName = '';
    let schoolList: string[] = [];
    let isAddApplicationModalOpen = false;
    let newApplication: Partial<ExamApplication> = {};
    let isNewCustomSchool = false;
    let newCustomSchoolName = '';
    let newAvailableHalls: ExamHall[] = [];
    let legalErrors = {
        tckn: '',
        phoneNumber: ''
    };
    let applicationsWithMissingFields: Set<string> = new Set();
    let showOnlyIncomplete = false;

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

    async function loadCapacityStats() {
        try {
            let total = 0;
            let assigned = 0;
            const stats: SchoolCapacityStat[] = [];
            const schoolsQuery = query(collection(db, "schools"));
            const schoolsSnapshot = await getDocs(schoolsQuery);
            
            for (const schoolDoc of schoolsSnapshot.docs) {
                const schoolName = schoolDoc.data().name || schoolDoc.id;
                const hallsQuery = query(collection(db, "schools", schoolDoc.id, "examHalls"));
                const hallsSnapshot = await getDocs(hallsQuery);
                
                let schoolTotal = 0;
                hallsSnapshot.docs.forEach(hallDoc => {
                    schoolTotal += (hallDoc.data().capacity || 0);
                });
                total += schoolTotal;
                
                const schoolAssigned = applications.filter(app => app.schoolId === schoolDoc.id).length;
                assigned += schoolAssigned;
                
                stats.push({
                    schoolId: schoolDoc.id,
                    schoolName,
                    totalCapacity: schoolTotal,
                    assignedCount: schoolAssigned
                });
            }
            
            schoolCapacityStats = stats;
            totalCapacity = total;
            assignedCount = assigned;
        } catch (error) {
        }
    }

    onMount(async () => {
        loading = true;
        await Promise.all([
            loadApplications(),
            loadSchools(),
            loadSchoolList()
        ]);
        await loadCapacityStats();
        loading = false;
    });

    async function loadSchools() {
        try {
            const schoolsQuery = query(collection(db, "schools"));
            const schoolsSnapshot = await getDocs(schoolsQuery);
            schools = schoolsSnapshot.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name,
                weight: doc.data().weight ?? 0
            }));
            // Removed success notification to reduce spam on page load
        } catch (error) {
            console.error('Error loading schools:', error);
            showNotification('Okul listesi yüklenirken bir hata oluştu. Lütfen sayfayı yenileyin.', 'error');
        }
    }

    async function loadHallsForSchool(schoolId: string) {
        try {
            const hallsQuery = query(collection(db, "schools", schoolId, "examHalls"));
            const hallsSnapshot = await getDocs(hallsQuery);
            availableHalls = hallsSnapshot.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name,
                capacity: doc.data().capacity,
                schoolId: schoolId,
                schoolName: schools.find(s => s.id === schoolId)?.name || ''
            }));
        } catch (error) {
            showNotification('Sınav salonları yüklenirken bir hata oluştu.', 'error');
            availableHalls = [];
        }
    }

    async function checkOrderNumbers() {
        try {
            // get all schools
            const schoolsQuery = query(collection(db, "schools"));
            const schoolsSnapshot = await getDocs(schoolsQuery);
            let studentCount = 0;
            for (const schoolDoc of schoolsSnapshot.docs) {
                const hallsQuery = query(collection(db, "schools", schoolDoc.id, "examHalls"));
                const hallsSnapshot = await getDocs(hallsQuery);

                for (const hallDoc of hallsSnapshot.docs) {
                    let currentOrderNumber = 0;
                    //order them by date    
                    const studentsQuery = query(collection(db, "schools", schoolDoc.id, "examHalls", hallDoc.id, "students"), orderBy("assignedAt", "asc"));
                    const studentsSnapshot = await getDocs(studentsQuery);

                    for (const studentDoc of studentsSnapshot.docs) {
                        const studentData = studentDoc.data();
                        const orderNumber = studentData.orderNumber;
                        const hallId = studentData.hallId;
                        const schoolId = studentData.schoolId;
                        currentOrderNumber++; // Increment first

                        if (orderNumber !== currentOrderNumber) {
                            // update the order number
                            await updateDoc(doc(db, "schools", schoolId, "examHalls", hallId, "students", studentDoc.id), {
                                orderNumber: currentOrderNumber
                            });
                            showNotification(`Sıra numarası güncellendi: ${studentData.studentFullName} (${orderNumber} -> ${currentOrderNumber})`, 'success');
                        }

                        //get the application
                        const applicationRef = doc(db, "examApplications", studentDoc.id);
                        const applicationDoc = await getDoc(applicationRef);

                        if (applicationDoc.exists()) {
                            const applicationData = applicationDoc.data();
                            const orderNumber = applicationData.orderNumber;
                            if (orderNumber !== currentOrderNumber) {
                                // update the order number
                                await updateDoc(applicationRef, {
                                    orderNumber: currentOrderNumber
                                });
                                showNotification(`Sıra numarası güncellendi: ${studentData.studentFullName} (${orderNumber} -> ${currentOrderNumber})`, 'success');
                            }
                        }

                        studentCount++;
                        showNotification(`${studentCount} öğrenci için sıra numarası kontrol edildi.`, 'success');
                    }
                    
                    
                }
                
            }

            showNotification('Sıra numaraları kontrol edildi ve güncellendi.', 'success');
        } catch (error) {
            showNotification('Sıra numaraları kontrol edilirken bir hata oluştu.', 'error');
            console.error(error);
        }
    }

    async function resetAllRooms() {
        isResettingRooms = true;
        isResetRoomsModalOpen = false;
        try {
            // Delete all student docs from every hall subcollection
            const schoolsSnapshot = await getDocs(collection(db, "schools"));
            for (const schoolDoc of schoolsSnapshot.docs) {
                const hallsSnapshot = await getDocs(collection(db, "schools", schoolDoc.id, "examHalls"));
                for (const hallDoc of hallsSnapshot.docs) {
                    const studentsSnapshot = await getDocs(collection(db, "schools", schoolDoc.id, "examHalls", hallDoc.id, "students"));
                    for (const studentDoc of studentsSnapshot.docs) {
                        await deleteDoc(doc(db, "schools", schoolDoc.id, "examHalls", hallDoc.id, "students", studentDoc.id));
                    }
                }
            }

            // Clear hall assignment fields from all exam applications
            const applicationsSnapshot = await getDocs(collection(db, "examApplications"));
            for (const appDoc of applicationsSnapshot.docs) {
                await updateDoc(doc(db, "examApplications", appDoc.id), {
                    hallId: deleteField(),
                    hallName: deleteField(),
                    schoolId: deleteField(),
                    schoolName: deleteField(),
                    orderNumber: deleteField(),
                    assignedAt: deleteField()
                });
            }

            // Update local state
            applications = applications.map(app => ({
                ...app,
                hallId: undefined,
                hallName: undefined,
                schoolId: undefined,
                schoolName: '',
                orderNumber: undefined,
                assignedAt: undefined
            }));
            filterApplications();
            await loadCapacityStats();
            showNotification('Tüm salon atamaları başarıyla sıfırlandı.', 'success');
        } catch (error) {
            console.error('Error resetting rooms:', error);
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu';
            showNotification(`Salon atamaları sıfırlanırken bir hata oluştu: ${errorMessage}`, 'error');
        } finally {
            isResettingRooms = false;
        }
    }


    async function loadApplications() {
        try {
            //if there are missing fields, warn me about that document
            const requiredFields = [
                'tcId',
                'studentFullName',
                'schoolName',
                'parentFullName',
                'phoneNumber',
                'studentSchoolName',
                'schoolId'
            ];
            const missingFieldsDocs: { id: string; missingFields: string[] }[] = [];

            // First get all documents without ordering to check for missing fields
            const allDocsQuery = query(collection(db, "examApplications"));
            const allDocsSnapshot = await getDocs(allDocsQuery);

            // Check all documents for missing fields (handle non-string values safely)
            allDocsSnapshot.docs.forEach((doc) => {
                const data = doc.data();
                const missingFields = requiredFields.filter(field => {
                    const val = data[field];
                    return val == null || (typeof val === 'string' && val.trim() === '');
                });
                
                if (missingFields.length > 0) {
                    missingFieldsDocs.push({
                        id: doc.id,
                        missingFields
                    });
                }
            });

            applicationsWithMissingFields = new Set(missingFieldsDocs.map(d => d.id));

            if (missingFieldsDocs.length > 0) {
                const warningMessage = `${allDocsSnapshot.docs.length} başvurudan ${missingFieldsDocs.length} tanesinde eksik alan bulundu:\n` +
                    missingFieldsDocs.map(doc => {
                        const data = allDocsSnapshot.docs.find(d => d.id === doc.id)?.data() || {};
                        const existingFields = requiredFields.filter(field => data[field] && data[field].trim() !== '');
                        return `TC: ${doc.id}\n` +
                               `Eksik alanlar: ${doc.missingFields.join(', ')}\n` +
                               `Mevcut alanlar: ${existingFields.map(field => `${field}: ${data[field]}`).join(', ')}`;
                    }).join('\n\n');
                showNotification(warningMessage, 'warning');
                console.log(warningMessage);
            }

            // Now get the ordered documents for display
            const q = query(collection(db, "examApplications"), orderBy("assignedAt", "desc"));
            const querySnapshot = await getDocs(q);
            applications = querySnapshot.docs.map((doc: QueryDocumentSnapshot) => ({
                tcId: doc.id,
                studentFullName: doc.data().studentFullName || '',
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
            await loadCapacityStats();
            // Removed success notification to reduce spam on page load
        } catch (error) {
            console.error('Error loading applications:', error);
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu';
            showNotification(`Başvurular yüklenirken bir hata oluştu: ${errorMessage}. Lütfen sayfayı yenileyin.`, 'error');
        }
    }

    function filterApplications() {
        let filtered = applications.filter(app => 
            app.studentFullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            app.tcId.includes(searchTerm) ||
            app.schoolName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            app.hallName?.toLowerCase().includes(searchTerm.toLowerCase())
        );
        if (showOnlyIncomplete) {
            filtered = filtered.filter(app => applicationsWithMissingFields.has(app.tcId));
        }
        filteredApplications = filtered;
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
        
        // Check if the student's school is in the predefined list
        if (application.studentSchoolName && !schoolList.includes(application.studentSchoolName)) {
            isCustomSchool = true;
            customSchoolName = application.studentSchoolName;
        } else {
            isCustomSchool = false;
        }

        if (application.schoolId) {
            loadHallsForSchool(application.schoolId);
        }
        isEditModalOpen = true;
    }

    function closeEditModal() {
        isEditModalOpen = false;
        selectedApplication = null;
        editFormData = {};
    }

    async function handleEditSubmit() {
        if (!selectedApplication) return;

        if (!editFormData.studentFullName?.trim()) {
            showNotification('Öğrenci adı soyadı gereklidir.', 'error');
            return;
        }
        if (!editFormData.studentSchoolName?.trim()) {
            showNotification('Öğrencinin kayıtlı olduğu okul gereklidir.', 'error');
            return;
        }

        // Validate TC number
        if (!editFormData.tcId || editFormData.tcId.length !== 11) {
            showNotification('T.C. Kimlik Numarası 11 haneli olmalıdır.', 'error');
            return;
        }

        if (!validateTCID(editFormData.tcId)) {
            showNotification('Geçersiz T.C. Kimlik Numarası. Lütfen geçerli bir T.C. Kimlik Numarası giriniz.', 'error');
            return;
        }

        // Normalize and validate phone number
        const phoneDigits = (editFormData.phoneNumber || '').replace(/\D/g, '');
        if (phoneDigits.length !== 10 || !phoneDigits.startsWith('5')) {
            showNotification('Geçerli bir 10 haneli cep telefonu numarası giriniz (5 ile başlamalı).', 'error');
            return;
        }
        editFormData.phoneNumber = phoneDigits;

        // Convert names to uppercase
        if (editFormData.studentFullName) {
            editFormData.studentFullName = toTurkishUpperCase(editFormData.studentFullName);
        }
        if (editFormData.parentFullName) {
            editFormData.parentFullName = toTurkishUpperCase(editFormData.parentFullName);
        }

        try {
            // If hall assignment is being removed
            if (selectedApplication.hallId && selectedApplication.schoolId && (!editFormData.hallId || selectedApplication.hallId !== editFormData.hallId)) {
                // Remove student from previous hall
                await deleteDoc(doc(db, "schools", selectedApplication.schoolId, "examHalls", selectedApplication.hallId, "students", selectedApplication.tcId));
                
                // Update order numbers for remaining students in the old hall
                const oldHallStudentsSnapshot = await getDocs(collection(db, "schools", selectedApplication.schoolId, "examHalls", selectedApplication.hallId, "students"));
                const oldHallStudents = oldHallStudentsSnapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() } as HallStudent))
                    .sort((a, b) => a.orderNumber - b.orderNumber);
                
                // Reorder remaining students
                for (let i = 0; i < oldHallStudents.length; i++) {
                    const student = oldHallStudents[i];
                    if (student.id !== selectedApplication.tcId) {
                        await updateDoc(doc(db, "schools", selectedApplication.schoolId, "examHalls", selectedApplication.hallId, "students", student.id), {
                            orderNumber: i + 1
                        });
                    }
                }
            }

            // If new hall is being assigned
            if (editFormData.hallId && editFormData.schoolId) {
                const selectedHall = availableHalls.find(h => h.id === editFormData.hallId);
                if (selectedHall) {
                    // Get current students in the new hall
                    const studentsSnapshot = await getDocs(collection(db, "schools", editFormData.schoolId, "examHalls", editFormData.hallId, "students"));
                    const currentStudents = studentsSnapshot.docs
                        .map(doc => ({ id: doc.id, ...doc.data() } as HallStudent))
                        .sort((a, b) => a.orderNumber - b.orderNumber);
                    
                    // Check hall capacity
                    if (currentStudents.length >= selectedHall.capacity && selectedApplication.hallId !== editFormData.hallId) {
                        showNotification('Seçilen salon kapasitesi dolu.', 'error');
                        return;
                    }

                    // Determine new order number
                    let newOrderNumber;
                    if (editFormData.orderNumber && editFormData.orderNumber <= currentStudents.length + 1) {
                        // If specific order number is requested, shift other students
                        newOrderNumber = editFormData.orderNumber;
                        
                        // Update order numbers for students after the insertion point
                        for (let i = currentStudents.length - 1; i >= 0; i--) {
                            const student = currentStudents[i];
                            if (student.orderNumber >= newOrderNumber && student.id !== selectedApplication.tcId) {
                                await updateDoc(doc(db, "schools", editFormData.schoolId, "examHalls", editFormData.hallId, "students", student.id), {
                                    orderNumber: student.orderNumber + 1
                                });
                            }
                        }
                    } else {
                        // If no specific order number or invalid order number, append to end
                        newOrderNumber = currentStudents.length + 1;
                    }

                    // Add student to new hall
                    await setDoc(doc(db, "schools", editFormData.schoolId, "examHalls", editFormData.hallId, "students", selectedApplication.tcId), {
                        tcId: selectedApplication.tcId,
                        studentFullName: editFormData.studentFullName,
                        schoolId: editFormData.schoolId,
                        schoolName: schools.find(s => s.id === editFormData.schoolId)?.name,
                        studentSchoolName: editFormData.studentSchoolName || selectedApplication.studentSchoolName,
                        parentFullName: editFormData.parentFullName,
                        phoneNumber: editFormData.phoneNumber,
                        hallName: selectedHall.name,
                        hallId: selectedHall.id,
                        assignedAt: new Date(),
                        orderNumber: newOrderNumber
                    });

                    // Update form data with hall information
                    editFormData.hallName = selectedHall.name;
                    editFormData.orderNumber = newOrderNumber;
                }
            }

            // Update the application in examApplications collection
            await updateDoc(doc(db, "examApplications", selectedApplication.tcId), {
                ...editFormData,
                assignedAt: editFormData.hallId ? new Date() : null
            });

            // If hall assignment exists, also update the hall student document when fixing fields
            if (editFormData.schoolId && editFormData.hallId) {
                const hallStudentRef = doc(db, "schools", editFormData.schoolId, "examHalls", editFormData.hallId, "students", selectedApplication.tcId);
                await updateDoc(hallStudentRef, {
                    studentFullName: editFormData.studentFullName,
                    parentFullName: editFormData.parentFullName,
                    phoneNumber: editFormData.phoneNumber,
                    studentSchoolName: editFormData.studentSchoolName || selectedApplication.studentSchoolName
                });
            }

            // Update local state
            applications = applications.map(app => 
                app.tcId === selectedApplication?.tcId 
                    ? { ...app, ...editFormData }
                    : app
            );
            filterApplications();
            const fixedTcId = selectedApplication!.tcId;
            applicationsWithMissingFields = new Set([...applicationsWithMissingFields].filter(id => id !== fixedTcId));
            showNotification('Başvuru başarıyla güncellendi.', 'success');
            closeEditModal();
        } catch (error) {
            showNotification('Başvuru güncellenirken bir hata oluştu.', 'error');
        }
    }

    async function handleSchoolChange(event: Event) {
        const select = event.target as HTMLSelectElement;
        const selectedSchoolId = select.value;
        
        // Find the selected school
        const selectedSchool = schools.find(s => s.id === selectedSchoolId);
        if (selectedSchool) {
            editFormData.schoolId = selectedSchool.id;
            editFormData.schoolName = selectedSchool.name;
            // Reset hall information
            editFormData.hallId = undefined;
            editFormData.hallName = undefined;
            editFormData.orderNumber = undefined;
            // Load halls for the selected school
            await loadHallsForSchool(selectedSchool.id);
        }
    }

    async function handleHallChange(event: Event) {
        const select = event.target as HTMLSelectElement;
        const selectedHallId = select.value;
        
        if (!selectedHallId) {
            editFormData.hallId = undefined;
            editFormData.hallName = undefined;
            editFormData.orderNumber = undefined;
            return;
        }

        const selectedHall = availableHalls.find(h => h.id === selectedHallId);
        if (selectedHall) {
            editFormData.hallId = selectedHall.id;
            editFormData.hallName = selectedHall.name;
        }
    }

    async function handleDelete(application: ExamApplication) {
        applicationToDelete = application;
        isDeleteModalOpen = true;
    }

    async function confirmDelete() {
        if (!applicationToDelete) return;

        try {
            // Delete from examApplications collection
            await deleteDoc(doc(db, "examApplications", applicationToDelete.tcId));

            // If the application has a hall assignment, delete from the hall
            if (applicationToDelete.hallName && applicationToDelete.schoolName && applicationToDelete.schoolId && applicationToDelete.hallId) {
                await deleteDoc(doc(db, "schools", applicationToDelete.schoolId, "examHalls", applicationToDelete.hallId, "students", applicationToDelete.tcId));
            }

            // Update local state
            applications = applications.filter(app => applicationToDelete && app.tcId !== applicationToDelete.tcId);
            filterApplications();
            await loadCapacityStats(); // Refresh capacity stats
            showNotification('Başvuru başarıyla silindi.', 'success');
        } catch (error) {
            console.error('Error deleting application:', error);
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu';
            showNotification(`Başvuru silinirken bir hata oluştu: ${errorMessage}`, 'error');
        } finally {
            isDeleteModalOpen = false;
            applicationToDelete = null;
        }
    }

    async function handleAddSchool() {
        if (!newSchoolName.trim()) {
            showNotification('Okul adı boş olamaz.', 'error');
            return;
        }

        if (newSchoolName.trim().length < 3) {
            showNotification('Okul adı en az 3 karakter olmalıdır.', 'error');
            return;
        }

        // Check if school name already exists
        if (schools.some(s => s.name.toLowerCase() === newSchoolName.trim().toLowerCase())) {
            showNotification('Bu isimde bir okul zaten mevcut.', 'warning');
            return;
        }

        try {
            // Add the school to Firestore
            const schoolsCollection = collection(db, "schools");
            const schoolRef = doc(schoolsCollection);
            await setDoc(schoolRef, {
                id: schoolRef.id,
                name: newSchoolName.trim(),
                weight: 0,
                createdAt: new Date()
            });

            showNotification('Okul başarıyla eklendi.', 'success');
            newSchoolName = '';
            isAddSchoolModalOpen = false;
            await loadSchools();
        } catch (error) {
            console.error('Error adding school:', error);
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu';
            showNotification(`Okul eklenirken bir hata oluştu: ${errorMessage}`, 'error');
        }
    }

    function exportToExcel() {
        try {
            // Create worksheet data
            const wsData = [
                ['T.C. Kimlik No', 'Öğrenci Adı Soyadı', 'Öğrencinin Okulu', 'Veli Adı Soyadı', 'Telefon','Sınav Binası', 'Sınav Salonu', 'Sıra No', 'Başvuru Tarihi'],
                ...filteredApplications.map(app => [
                    app.tcId,
                    app.studentFullName,
                    app.studentSchoolName || '-',
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
                { wch: 30 },  // Student School Name
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
            for (let i = 0; i < 8; i++) {
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
            showNotification('Liste indirilirken bir hata oluştu.', 'error');
        }
    }

    async function loadSchoolList() {
        try {
            const response = await fetch('/schools.txt');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const text = await response.text();
            schoolList = text.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .sort();
        } catch (error) {
            console.error('Error loading school list:', error);
            showNotification('Okul listesi dosyası bulunamadı. Özel okul girişi yapılabilir.', 'warning');
        }
    }

    function handleSchoolSelect(event: Event) {
        const select = event.target as HTMLSelectElement;
        if (select.value === "DİĞER") {
            isCustomSchool = true;
            customSchoolName = '';
            editFormData.studentSchoolName = '';
        } else {
            isCustomSchool = false;
            editFormData.studentSchoolName = select.value;
            customSchoolName = '';
        }
    }

    function handleCustomSchoolInput(event: Event) {
        const input = event.target as HTMLInputElement;
        customSchoolName = toTurkishUpperCase(input.value);
        editFormData.studentSchoolName = customSchoolName;
    }

    /** Fisher-Yates shuffle */
    function shuffle<T>(array: T[]): T[] {
        const arr = [...array];
        let currentIndex = arr.length;
        while (currentIndex !== 0) {
            const randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;
            [arr[currentIndex], arr[randomIndex]] = [arr[randomIndex], arr[currentIndex]];
        }
        return arr;
    }

    /** Find school and hall using the normal algorithm (weight-based, capacity check) */
    async function findSchoolAndHallForApplication(): Promise<{ schoolId: string; schoolName: string; hallId: string; hallName: string } | null> {
        const schoolsSnapshot = await getDocs(collection(db, "schools"));
        const schools = schoolsSnapshot.docs;

        if (schools.length === 0) return null;

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

        for (const school of orderedSchools) {
            const examHallsSnapshot = await getDocs(collection(db, "schools", school.id, "examHalls"));
            const examHalls = examHallsSnapshot.docs;
            if (examHalls.length === 0) continue;

            const shuffledHalls = shuffle([...examHalls]);
            for (const hall of shuffledHalls) {
                const hallData = hall.data();
                const studentsSnapshot = await getDocs(collection(db, "schools", school.id, "examHalls", hall.id, "students"));
                if (studentsSnapshot.size < hallData.capacity) {
                    return {
                        schoolId: school.id,
                        schoolName: school.data().name,
                        hallId: hall.id,
                        hallName: hallData.name
                    };
                }
            }
        }
        return null;
    }

    async function handleAddApplication() {
        if (!newApplication.tcId || !newApplication.studentFullName ||
            !newApplication.parentFullName || !newApplication.phoneNumber || !newApplication.studentSchoolName) {
            showNotification('Lütfen tüm zorunlu alanları doldurun.', 'error');
            return;
        }

        // Normalize phone to digits only
        const phoneDigits = (newApplication.phoneNumber || '').replace(/\D/g, '');
        if (phoneDigits.length !== 10 || !phoneDigits.startsWith('5')) {
            showNotification('Geçerli bir 10 haneli cep telefonu numarası giriniz (5 ile başlamalı).', 'error');
            return;
        }
        newApplication.phoneNumber = phoneDigits;

        // Convert names to uppercase
        newApplication.studentFullName = toTurkishUpperCase(newApplication.studentFullName.trim());
        newApplication.parentFullName = toTurkishUpperCase(newApplication.parentFullName.trim());

        try {
            // Check if document already exists
            const docRef = doc(db, "examApplications", newApplication.tcId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                showNotification('Bu TC Kimlik numarası ile daha önce başvuru yapılmış.', 'error');
                return;
            }

            // Assign school and hall using the normal algorithm
            const assignment = await findSchoolAndHallForApplication();
            if (!assignment) {
                showNotification('Sınav yeri ataması yapılamadı. Tüm salonlar dolu.', 'error');
                return;
            }

            newApplication.schoolId = assignment.schoolId;
            newApplication.schoolName = assignment.schoolName;
            newApplication.hallId = assignment.hallId;
            newApplication.hallName = assignment.hallName;

            const studentsSnapshot = await getDocs(collection(db, "schools", assignment.schoolId, "examHalls", assignment.hallId, "students"));
            const orderNumber = studentsSnapshot.size + 1;

            // Add student to the hall
            await setDoc(doc(db, "schools", assignment.schoolId, "examHalls", assignment.hallId, "students", newApplication.tcId), {
                tcId: newApplication.tcId,
                studentFullName: newApplication.studentFullName,
                schoolId: assignment.schoolId,
                schoolName: assignment.schoolName,
                studentSchoolName: newApplication.studentSchoolName,
                parentFullName: newApplication.parentFullName,
                phoneNumber: newApplication.phoneNumber,
                hallName: assignment.hallName,
                hallId: assignment.hallId,
                assignedAt: new Date(),
                orderNumber
            });

            // Add the application to Firestore
            await setDoc(docRef, {
                ...newApplication,
                assignedAt: new Date(),
                orderNumber
            });

            // Update local state
            applications = [...applications, newApplication as ExamApplication];
            filterApplications();
            
            showNotification('Başvuru başarıyla eklendi.', 'success');
            isAddApplicationModalOpen = false;
            newApplication = {};
            isNewCustomSchool = false;
            newCustomSchoolName = '';
            newAvailableHalls = [];
        } catch (error) {
            showNotification('Başvuru eklenirken bir hata oluştu.', 'error');
        }
    }

    function handleNewSchoolSelect(event: Event) {
        const select = event.target as HTMLSelectElement;
        if (select.value === "DİĞER") {
            isNewCustomSchool = true;
            newCustomSchoolName = '';
            newApplication.studentSchoolName = '';
        } else {
            isNewCustomSchool = false;
            newApplication.studentSchoolName = select.value;
            newCustomSchoolName = '';
        }
    }

    function handleNewCustomSchoolInput(event: Event) {
        const input = event.target as HTMLInputElement;
        newCustomSchoolName = toTurkishUpperCase(input.value);
        newApplication.studentSchoolName = newCustomSchoolName;
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

    function handleTCKNInput(event: Event, isNew: boolean = false) {
        const input = event.target as HTMLInputElement;
        const formatted = input.value.replace(/[^0-9]/g, '').slice(0, 11);
        
        if (isNew) {
            newApplication.tcId = formatted;
        } else {
            editFormData.tcId = formatted;
        }
        
        // Clear any validation errors
        legalErrors.tckn = '';
        input.setCustomValidity('');
    }

    $: {
        if (searchTerm !== undefined) {
            filterApplications();
        }
    }

    function handleNameInput(event: Event, field: 'studentFullName' | 'parentFullName') {
        const input = event.target as HTMLInputElement;
        if (field === 'studentFullName') {
            editFormData.studentFullName = toTurkishUpperCase(input.value);
        } else {
            editFormData.parentFullName = toTurkishUpperCase(input.value);
        }
    }

    function handleNewNameInput(event: Event, field: 'studentFullName' | 'parentFullName') {
        const input = event.target as HTMLInputElement;
        if (field === 'studentFullName') {
            newApplication.studentFullName = toTurkishUpperCase(input.value);
        } else {
            newApplication.parentFullName = toTurkishUpperCase(input.value);
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
    {#if loading}
        <div class="loading-overlay" role="status" aria-live="polite">
            <div class="loading-spinner">
                <div class="spinner" aria-hidden="true"></div>
                <p>Veriler yükleniyor...</p>
                <span class="sr-only">Başvurular yükleniyor, lütfen bekleyin...</span>
            </div>
        </div>
    {/if}
    
    <h1>Sınav Başvuruları</h1>

    <div class="stats-card">
        <div class="stat-content">
            <div class="stat-row">
                <span class="stat-value">{filteredApplications.length}</span>
                <span class="stat-label">Toplam Başvuru</span>
            </div>
            {#if totalCapacity > 0}
                <div class="capacity-stats">
                    <div class="capacity-info">
                        <span class="capacity-text">Kapasite Kullanımı: {assignedCount}/{totalCapacity}</span>
                        <span class="percentage">%{Math.round((assignedCount / totalCapacity) * 100)}</span>
                    </div>
                    <div class="progress-bar">
                        <div 
                            class="progress-fill" 
                            style="width: {Math.min(100, Math.round((assignedCount / totalCapacity) * 100))}%"
                        ></div>
                    </div>
                    {#if schoolCapacityStats.length > 0}
                        <div class="school-capacity-breakdown">
                            <span class="breakdown-label">Sınav binalarına göre:</span>
                            {#each schoolCapacityStats as stat}
                                <div class="school-capacity-item">
                                    <span class="school-name">{stat.schoolName}</span>
                                    <span class="school-capacity-text">{stat.assignedCount}/{stat.totalCapacity}</span>
                                    <span class="school-percentage">%{stat.totalCapacity > 0 ? Math.round((stat.assignedCount / stat.totalCapacity) * 100) : 0}</span>
                                    <div class="school-progress-bar">
                                        <div 
                                            class="progress-fill" 
                                            style="width: {stat.totalCapacity > 0 ? Math.min(100, Math.round((stat.assignedCount / stat.totalCapacity) * 100)) : 0}%"
                                        ></div>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
        {#if searchTerm}
            <div class="stat-note">({applications.length} başvuru arasından)</div>
        {/if}
    </div>

    <div class="controls">
        <div class="search-section">
            <input
                type="text"
                bind:value={searchTerm}
                on:input={filterApplications}
                placeholder="Ad soyad, T.C. kimlik no, salon adı veya okul adı ile arayın..."
                class="search-input"
            />
            {#if applicationsWithMissingFields.size > 0}
                <label class="incomplete-filter">
                    <input type="checkbox" bind:checked={showOnlyIncomplete} on:change={filterApplications} />
                    Eksik alanlı başvuruları göster ({applicationsWithMissingFields.size})
                </label>
            {/if}
        </div>
        
        <div class="action-groups">
            <!-- Primary Actions -->
            <div class="action-group primary-actions">
                <span class="action-group-label">Başvuru İşlemleri</span>
                <button on:click={() => isAddApplicationModalOpen = true} class="add-application-btn">
                    <span class="btn-icon">➕</span>
                    Başvuru Ekle
                </button>
                <button on:click={exportToExcel} class="excel-btn" title="Filtrelenmiş başvuruları Excel dosyası olarak indir">
                    <span class="btn-icon">📊</span>
                    Excel'e Aktar
                </button>
                <button on:click={() => isAddSchoolModalOpen = true} class="add-school-btn" title="Sisteme yeni bir sınav binası ekle">
                    <span class="btn-icon">🏢</span>
                    Sınav Binası Ekle
                </button>
            </div>

            <!-- System Actions -->
            <div class="action-group system-actions">
                <span class="action-group-label">Sistem</span>
                <button 
                    on:click={async () => {
                        isRefreshing = true;
                        await loadApplications();
                        isRefreshing = false;
                        showNotification('Başvurular yenilendi.', 'success');
                    }} 
                    class="refresh-btn"
                    disabled={isRefreshing}
                    title="Başvuru listesini Firebase'den yeniden yükle"
                >
                    <span class="btn-icon">{isRefreshing ? '⏳' : '🔄'}</span>
                    {isRefreshing ? 'Yenileniyor...' : 'Yenile'}
                </button>
                <button on:click={checkOrderNumbers} class="fix-btn" title="Tüm salon öğrenci sıra numaralarını kontrol edip hatalı olanları düzelt">
                    <span class="btn-icon">🔧</span>
                    Sıra No. Düzelt
                </button>
                <button 
                    on:click={() => isResetRoomsModalOpen = true}
                    class="reset-rooms-btn"
                    disabled={isResettingRooms}
                    title="Tüm öğrencilerin salon atamalarını sil — öğrenci kayıtları korunur"
                >
                    <span class="btn-icon">{isResettingRooms ? '⏳' : '🗑️'}</span>
                    {isResettingRooms ? 'Sıfırlanıyor...' : 'Salonları Sıfırla'}
                </button>
            </div>
        </div>
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
                        on:click={() => handleSort('schoolName')}
                        on:keydown={(e) => e.key === 'Enter' && handleSort('schoolName')}
                        role="button"
                        tabindex="0"
                        title="Öğrencinin sınava gireceği bina"
                    >
                        Sınav Binası
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
                    <tr class:incomplete-row={applicationsWithMissingFields.has(application.tcId)}>
                        <td>{application.tcId}</td>
                        <td>{application.studentFullName}</td>
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
                        on:input={(e) => handleNameInput(e, 'studentFullName')}
                    />
                    <small class="helper-text">Otomatik olarak büyük harfe dönüştürülür</small>
                </div>

                <div class="form-group">
                    <label for="studentSchoolName">Öğrencinin Kayıtlı Olduğu Okul</label>
                    <div class="school-input-container">
                        <select
                            id="studentSchoolName"
                            value={isCustomSchool ? "DİĞER" : editFormData.studentSchoolName}
                            required
                            class="school-select"
                            class:expanded={isCustomSchool}
                            on:change={handleSchoolSelect}
                        >
                            <option value="">Okul seçiniz</option>
                            {#each schoolList as school}
                                <option value={school}>{school}</option>
                            {/each}
                            <option value="DİĞER">DİĞER OKUL</option>
                        </select>
                        {#if isCustomSchool}
                            <div class="custom-school-container" transition:fade>
                                <input
                                    type="text"
                                    id="customSchoolName"
                                    bind:value={customSchoolName}
                                    required
                                    placeholder="Okul adını giriniz"
                                    class="custom-school-input"
                                    on:input={handleCustomSchoolInput}
                                />
                                <small class="helper-text">Lütfen okulunuzun tam adını giriniz</small>
                            </div>
                        {/if}
                    </div>
                </div>

                <div class="form-group">
                    <label for="schoolName">Sınav Yapılacak Bina</label>
                    <select
                        id="schoolName"
                        bind:value={editFormData.schoolId}
                        required
                        on:change={handleSchoolChange}
                    >
                        <option value="">Sınav binasını seçin</option>
                        {#each schools as school}
                            <option value={school.id}>{school.name}</option>
                        {/each}
                    </select>
                    <small class="helper-text">Öğrencinin sınava gireceği bina — bina seçildikten sonra salon listesi güncellenir</small>
                </div>

                <div class="form-group">
                    <label for="parentFullName">Veli Adı Soyadı</label>
                    <input
                        type="text"
                        id="parentFullName"
                        bind:value={editFormData.parentFullName}
                        required
                        on:input={(e) => handleNameInput(e, 'parentFullName')}
                    />
                    <small class="helper-text">Otomatik olarak büyük harfe dönüştürülür</small>
                </div>

                <div class="form-group">
                    <label for="phoneNumber">Telefon Numarası</label>
                    <input
                        type="text"
                        id="phoneNumber"
                        bind:value={editFormData.phoneNumber}
                        required
                        minlength="10"
                        maxlength="10"
                    />
                    <small class="helper-text">Başında 0 olmadan 10 haneli giriniz (örn: 5321234567)</small>
                </div>

                <div class="form-group">
                    <label for="hallId">Sınav Salonu</label>
                    <select
                        id="hallId"
                        bind:value={editFormData.hallId}
                        on:change={handleHallChange}
                    >
                        <option value="">Sınav salonu seçiniz</option>
                        {#each availableHalls as hall}
                            <option value={hall.id}>{hall.name}</option>
                        {/each}
                    </select>
                    {#if editFormData.hallId}
                        <small class="helper-text">
                            Salon kapasitesi: {availableHalls.find(h => h.id === editFormData.hallId)?.capacity || 0} öğrenci
                        </small>
                    {:else}
                        <small class="helper-text">Önce sınav binasını seçin</small>
                    {/if}
                </div>

                <div class="form-group">
                    <label for="orderNumber">Oturma Sıra Numarası</label>
                    <input
                        type="number"
                        id="orderNumber"
                        bind:value={editFormData.orderNumber}
                        min="1"
                        disabled={!editFormData.hallId}
                    />
                    <small class="helper-text">Boş bırakılırsa salonun sonuna otomatik eklenir</small>
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
            <h2>Sınav Binası Ekle</h2>
            <p class="modal-description">Sisteme yeni bir sınav binası ekleyin. Eklendikten sonra bu binaya salonlar tanımlayabilirsiniz.</p>
            <form on:submit|preventDefault={handleAddSchool}>
                <div class="form-group">
                    <label for="schoolName">Bina Adı</label>
                    <input
                        type="text"
                        id="schoolName"
                        bind:value={newSchoolName}
                        required
                        placeholder="Örn: Atatürk Anadolu Lisesi"
                    />
                    <small class="helper-text">Tam ve resmi adını giriniz</small>
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

{#if isDeleteModalOpen && applicationToDelete}
    <div 
        class="modal-overlay" 
        on:click={() => isDeleteModalOpen = false}
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
            <h2>Başvuru Silme Onayı</h2>
            <p class="delete-message">
                <strong>{applicationToDelete.studentFullName}</strong> isimli öğrencinin başvurusunu silmek istediğinizden emin misiniz?
            </p>
            <p class="delete-warning">Bu işlem geri alınamaz!</p>
            <div class="modal-actions">
                <button 
                    type="button" 
                    class="cancel-btn" 
                    on:click={() => {
                        isDeleteModalOpen = false;
                        applicationToDelete = null;
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

{#if isResetRoomsModalOpen}
    <div 
        class="modal-overlay" 
        on:click={() => isResetRoomsModalOpen = false}
        on:keydown={(e) => e.key === 'Escape' && (isResetRoomsModalOpen = false)}
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
            <h2>Salonları Sıfırla</h2>
            <p class="delete-message">
                Tüm öğrencilerin salon ve sıra numarası atamaları silinecektir.
            </p>
            <p class="delete-warning">Bu işlem geri alınamaz! Öğrenci kayıtları silinmez, yalnızca salon atamaları temizlenir.</p>
            <div class="modal-actions">
                <button 
                    type="button" 
                    class="cancel-btn" 
                    on:click={() => isResetRoomsModalOpen = false}
                >
                    İptal
                </button>
                <button type="button" class="confirm-delete-btn" on:click={resetAllRooms}>
                    Sıfırla
                </button>
            </div>
        </div>
    </div>
{/if}

{#if isAddApplicationModalOpen}
    <div 
        class="modal-overlay" 
        on:click={() => isAddApplicationModalOpen = false}
        on:keydown={(e) => e.key === 'Escape' && (isAddApplicationModalOpen = false)}
        role="button"
        tabindex="0"
    >
        <div 
            class="modal" 
            on:click|stopPropagation
            on:keydown|stopPropagation
            role="presentation"
        >
            <h2>Yeni Başvuru Ekle</h2>
            <p class="modal-description">Yeni bir öğrenci başvurusu oluşturun. Tüm alanlar zorunludur.</p>
            <form on:submit|preventDefault={handleAddApplication}>
                <div class="form-group">
                    <label for="newTcId">T.C. Kimlik Numarası</label>
                    <input
                        type="text"
                        id="newTcId"
                        bind:value={newApplication.tcId}
                        required
                        inputmode="numeric"
                        on:input={(e) => handleTCKNInput(e, true)}
                        placeholder="11 haneli T.C. kimlik numarası"
                    />
                    {#if legalErrors.tckn}
                        <div class="error-message">{legalErrors.tckn}</div>
                    {/if}
                </div>

                <div class="form-group">
                    <label for="newStudentFullName">Öğrenci Adı Soyadı</label>
                    <input
                        type="text"
                        id="newStudentFullName"
                        bind:value={newApplication.studentFullName}
                        required
                        on:input={(e) => handleNewNameInput(e, 'studentFullName')}
                        placeholder="Nüfus cüzdanındaki isim ile aynı olmalı"
                    />
                    <small class="helper-text">Otomatik olarak büyük harfe dönüştürülür</small>
                </div>
                <div class="form-group">
                    <label for="newParentFullName">Veli Adı Soyadı</label>
                    <input
                        type="text"
                        id="newParentFullName"
                        bind:value={newApplication.parentFullName}
                        required
                        on:input={(e) => handleNewNameInput(e, 'parentFullName')}
                        placeholder="Anne veya baba adı soyadı"
                    />
                    <small class="helper-text">Otomatik olarak büyük harfe dönüştürülür</small>
                </div>

                <div class="form-group">
                    <label for="newPhoneNumber">Veli Telefon Numarası</label>
                    <input
                        type="text"
                        id="newPhoneNumber"
                        bind:value={newApplication.phoneNumber}
                        required
                        placeholder="5321234567"
                    />
                    <small class="helper-text">Başında 0 olmadan 10 haneli giriniz</small>
                </div>

                <div class="form-group">
                    <label for="newStudentSchoolName">Öğrencinin Kayıtlı Olduğu Okul</label>
                    <div class="school-input-container">
                        <select
                            id="newStudentSchoolName"
                            value={isNewCustomSchool ? "DİĞER" : newApplication.studentSchoolName}
                            required
                            class="school-select"
                            class:expanded={isNewCustomSchool}
                            on:change={handleNewSchoolSelect}
                        >
                            <option value="">Okul seçiniz</option>
                            {#each schoolList as school}
                                <option value={school}>{school}</option>
                            {/each}
                            <option value="DİĞER">DİĞER OKUL</option>
                        </select>
                        {#if isNewCustomSchool}
                            <div class="custom-school-container" transition:fade>
                                <input
                                    type="text"
                                    id="newCustomSchoolName"
                                    bind:value={newCustomSchoolName}
                                    required
                                    placeholder="Okul adını giriniz"
                                    class="custom-school-input"
                                    on:input={handleNewCustomSchoolInput}
                                />
                                <small class="helper-text">Lütfen okulunuzun tam adını giriniz</small>
                            </div>
                        {/if}
                    </div>
                    <small class="helper-text">Sınav binası ve salon otomatik olarak atanacaktır (öncelik ve kapasiteye göre)</small>
                </div>

                <div class="modal-actions">
                    <button type="button" class="cancel-btn" on:click={() => isAddApplicationModalOpen = false}>
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

    .stats-card {
        background: linear-gradient(135deg, #0d9488, #115e59);
        border-radius: 16px;
        padding: 2rem;
        margin-bottom: 2rem;
        color: white;
        box-shadow: 0 4px 15px rgba(13, 148, 136, 0.2);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        position: relative;
        overflow: hidden;
    }

    .stats-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(45deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 100%);
        pointer-events: none;
    }

    .stats-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(13, 148, 136, 0.3);
    }

    .stat-content {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 2rem;
        align-items: center;
    }

    .stat-row {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 1.5rem;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        backdrop-filter: blur(10px);
    }

    .stat-value {
        font-size: 2.5rem;
        font-weight: 700;
        line-height: 1;
        background: linear-gradient(to right, #fff, #e2e8f0);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
    }

    .stat-label {
        font-size: 1.1rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.9);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .capacity-stats {
        background: rgba(255, 255, 255, 0.1);
        padding: 1.5rem;
        border-radius: 12px;
        backdrop-filter: blur(10px);
    }

    .capacity-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
    }

    .capacity-text {
        font-size: 1.1rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.9);
    }

    .percentage {
        font-size: 1.25rem;
        font-weight: 700;
        padding: 0.5rem 1rem;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 20px;
    }

    .progress-bar {
        width: 100%;
        height: 10px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 5px;
        overflow: hidden;
        position: relative;
    }

    .progress-fill {
        height: 100%;
        background: linear-gradient(to right, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.7));
        border-radius: 5px;
        transition: width 0.5s ease;
        position: relative;
    }

    .progress-fill::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.3) 50%,
            rgba(255, 255, 255, 0) 100%
        );
        animation: shimmer 2s infinite;
    }

    .school-capacity-breakdown {
        margin-top: 1.25rem;
        padding-top: 1.25rem;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
    }

    .breakdown-label {
        display: block;
        font-size: 0.9rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .school-capacity-item {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 0.5rem 1rem;
        align-items: center;
        margin-bottom: 0.5rem;
    }

    .school-capacity-item:last-child {
        margin-bottom: 0;
    }

    .school-name {
        font-size: 0.95rem;
        color: rgba(255, 255, 255, 0.9);
    }

    .school-capacity-text {
        font-size: 0.9rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.85);
    }

    .school-percentage {
        font-size: 0.85rem;
        font-weight: 600;
        padding: 0.2rem 0.5rem;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 8px;
    }

    .school-progress-bar {
        grid-column: 1 / -1;
        width: 100%;
        height: 6px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 4px;
        overflow: hidden;
    }

    @keyframes shimmer {
        0% {
            transform: translateX(-100%);
        }
        100% {
            transform: translateX(100%);
        }
    }

    .stat-note {
        text-align: center;
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.9rem;
        margin-top: 1rem;
        font-style: italic;
    }

    .controls {
        margin-bottom: 2rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .search-section {
        width: 100%;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
    }

    .incomplete-filter {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        color: #b45309;
        cursor: pointer;
        white-space: nowrap;
    }

    .incomplete-row {
        background: #fffbeb;
    }

    .search-input {
        flex: 1;
        min-width: 200px;
        padding: 1rem;
        border: 2px solid #e2e8f0;
        border-radius: 12px;
        font-size: 1rem;
        background: linear-gradient(145deg, #ffffff, #f8fafc);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        transition: all 0.3s ease;
    }

    .search-input:focus {
        outline: none;
        border-color: #14b8a6;
        box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1), 0 2px 12px rgba(0, 0, 0, 0.1);
        background: #ffffff;
    }

    .action-groups {
        display: flex;
        flex-wrap: wrap;
        gap: 1.5rem;
        justify-content: space-between;
        align-items: flex-start;
    }

    .action-group {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        padding: 1rem;
        background: #f8fafc;
        border-radius: 12px;
        border: 1px solid #e2e8f0;
        min-width: 250px;
        flex: 1;
        position: relative;
    }

    .action-group-label {
        width: 100%;
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #718096;
        padding-bottom: 0.25rem;
        border-bottom: 1px solid rgba(0,0,0,0.08);
    }

    .action-group::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        border-radius: 12px 12px 0 0;
    }

    .primary-actions {
        position: relative;
        background: linear-gradient(145deg, #ccfbf1, #99f6e4);
        border-color: #5eead4;
    }

    .primary-actions::before {
        background: linear-gradient(to right, #0d9488, #115e59);
    }

    .system-actions {
        position: relative;
        background: linear-gradient(145deg, #faf5ff, #e9d8fd);
        border-color: #d6bcfa;
    }

    .system-actions::before {
        background: linear-gradient(to right, #805ad5, #6b46c1);
    }

    /* Base button styles */
    .action-group button {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.25rem;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        text-decoration: none;
        font-size: 0.9rem;
        white-space: nowrap;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    }

    .action-group button:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .btn-icon {
        font-size: 1rem;
        line-height: 1;
    }

    /* Primary action buttons */
    .add-application-btn {
        background: linear-gradient(135deg, #0d9488, #115e59);
        color: white;
    }

    .add-application-btn:hover {
        background: linear-gradient(135deg, #115e59, #134e4a);
    }

    .excel-btn {
        background: linear-gradient(135deg, #059669, #047857);
        color: white;
    }

    .excel-btn:hover {
        background: linear-gradient(135deg, #047857, #065f46);
    }

    /* Primary action buttons (continued) */
    .add-school-btn {
        background: linear-gradient(135deg, #319795, #2c7a7b);
        color: white;
    }

    .add-school-btn:hover {
        background: linear-gradient(135deg, #2c7a7b, #285e61);
    }

    /* System action buttons */
    .refresh-btn {
        background: linear-gradient(135deg, #14b8a6, #0d9488);
        color: white;
    }

    .refresh-btn:hover {
        background: linear-gradient(135deg, #0d9488, #115e59);
    }

    .fix-btn {
        background: linear-gradient(135deg, #ed8936, #dd6b20);
        color: white;
    }

    .fix-btn:hover {
        background: linear-gradient(135deg, #dd6b20, #c05621);
    }

    .reset-rooms-btn {
        background: linear-gradient(135deg, #e53e3e, #c53030);
        color: white;
    }

    .reset-rooms-btn:hover:not(:disabled) {
        background: linear-gradient(135deg, #c53030, #9b2c2c);
    }

    .reset-rooms-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
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
    th:nth-child(3), td:nth-child(3) { width: 250px; } /* Student School Name */
    th:nth-child(4), td:nth-child(4) { width: 250px; } /* Parent Name */
    th:nth-child(5), td:nth-child(5) { width: 140px; } /* Phone */
    th:nth-child(6), td:nth-child(6) { width: 180px; } /* School */
    th:nth-child(7), td:nth-child(7) { width: 120px; } /* Exam Hall */
    th:nth-child(8), td:nth-child(8) { width: 140px; } /* Order No */
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
        color: #14b8a6;
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
        background: linear-gradient(to right, #0d9488, #115e59);
        border-radius: 2px;
    }

    .edit-btn {
        padding: 0.5rem 1rem;
        background: #14b8a6;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.875rem;
        transition: background-color 0.2s ease;
    }

    .edit-btn:hover {
        background: #0d9488;
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
        margin-bottom: 0.5rem;
        color: #2d3748;
    }

    .modal-description {
        color: #718096;
        font-size: 0.9rem;
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #e2e8f0;
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
        border-color: #14b8a6;
        box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
    }

    .helper-text {
        display: block;
        color: #718096;
        font-size: 0.875rem;
        margin-top: 0.5rem;
        padding-left: 0.5rem;
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
        background: linear-gradient(to right, #0d9488, #115e59);
        color: white;
        border: none;
    }

    .save-btn:hover {
        background: linear-gradient(to right, #115e59, #134e4a);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(13, 148, 136, 0.2);
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
            gap: 1rem;
        }

        .action-groups {
            flex-direction: column;
            gap: 1rem;
        }

        .action-group {
            min-width: auto;
            width: 100%;
            padding: 0.75rem;
        }

        .action-group button {
            flex: 1;
            justify-content: center;
            padding: 0.75rem;
            font-size: 0.85rem;
        }

        .btn-icon {
            font-size: 0.9rem;
        }

        .search-input {
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

        .stats-card {
            padding: 1.5rem;
        }

        .stat-content {
            grid-template-columns: 1fr;
            gap: 1rem;
        }

        .stat-row {
            padding: 1rem;
        }

        .stat-value {
            font-size: 2rem;
        }

        .stat-label {
            font-size: 1rem;
        }

        .capacity-stats {
            padding: 1rem;
        }

        .capacity-text {
            font-size: 1rem;
        }

        .percentage {
            font-size: 1.1rem;
            padding: 0.4rem 0.8rem;
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

    .error-message {
        color: #e53e3e;
        font-size: 0.875rem;
        margin-top: 0.5rem;
        padding-left: 0.5rem;
        font-weight: 500;
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

    .add-application-btn {
        padding: 0.75rem 1.5rem;
        background: linear-gradient(to right, #0d9488, #115e59);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s ease;
    }

    .add-application-btn:hover {
        background: linear-gradient(to right, #115e59, #134e4a);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(13, 148, 136, 0.2);
    }

    .loading-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255, 255, 255, 0.95);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
    }

    .loading-spinner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
    }

    .spinner {
        width: 50px;
        height: 50px;
        border: 4px solid #e2e8f0;
        border-top-color: #14b8a6;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .loading-spinner p {
        color: #4a5568;
        font-size: 1.1rem;
        font-weight: 500;
    }

    button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    button:disabled:hover {
        transform: none;
    }

    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
    }
</style> 