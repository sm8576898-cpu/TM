if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for(let registration of registrations) { registration.unregister(); }
    });
}

// Added runTransaction for accurate view tracking
import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { ref, set, push, onValue, remove, update, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const authSection = document.getElementById('auth-section');
const mainApp = document.getElementById('main-app');

let currentUserUID = null;
let allStudentsRawData = null;
let currentParsedStudentsForChart = []; 
let viewsIncremented = false; // Flag to prevent multiple increments on tab switches

let attendanceChartInstance = null;
let marksChartInstance = null;

const globalMonthSelect = document.getElementById('global-month-select');
const globalYearSelect = document.getElementById('global-year-select');

const monthNames = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
const d = new Date();
if(globalMonthSelect) globalMonthSelect.value = monthNames[d.getMonth()];
if(globalYearSelect) globalYearSelect.value = d.getFullYear();

const getMonthKey = () => {
    let m = globalMonthSelect ? globalMonthSelect.value : monthNames[d.getMonth()];
    let y = globalYearSelect ? globalYearSelect.value : d.getFullYear();
    return `${m}-${y}`;
};

if(globalMonthSelect) {
    globalMonthSelect.addEventListener('change', () => {
        document.querySelectorAll('.global-month-display').forEach(el => el.innerText = getMonthKey());
        if(allStudentsRawData) renderDashboard(allStudentsRawData);
    });
}
if(globalYearSelect) {
    globalYearSelect.addEventListener('input', () => {
        document.querySelectorAll('.global-month-display').forEach(el => el.innerText = getMonthKey());
        if(allStudentsRawData) renderDashboard(allStudentsRawData);
    });
}

const classFilterEl = document.getElementById('chart-class-filter');
const sortFilterEl = document.getElementById('chart-sort-filter');
if(classFilterEl) classFilterEl.addEventListener('change', () => { try{ applyChartFilters(); }catch(e){} });
if(sortFilterEl) sortFilterEl.addEventListener('change', () => { try{ applyChartFilters(); }catch(e){} });

window.switchTab = function(tabId, navElement) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    
    const tabToActivate = document.getElementById(tabId);
    if(tabToActivate) tabToActivate.classList.add('active');
    if(navElement) navElement.classList.add('active');
    
    if(tabId === 'tab-home' && allStudentsRawData) {
        try{ applyChartFilters(); }catch(e){}
    }
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserUID = user.uid;
        if(authSection) authSection.style.display = 'none';
        if(mainApp) mainApp.style.display = 'block';
        document.querySelectorAll('.global-month-display').forEach(el => el.innerText = getMonthKey());
        initAppDataListeners(currentUserUID);

        // --- ACCURATE SAFE VIEWS COUNTER TRANSACTION ---
        if (!viewsIncremented) {
            const viewsRef = ref(db, `tuition_users/${user.uid}/dashboard_views`);
            runTransaction(viewsRef, (currentValue) => {
                return (currentValue || 0) + 1;
            }).then((result) => {
                const displayEl = document.getElementById('view-counter-display');
                if (displayEl) displayEl.innerText = result.snapshot.val() || 1;
            }).catch(e => console.log("Views Error:", e));
            viewsIncremented = true;
        }
    } else {
        currentUserUID = null;
        if(authSection) authSection.style.display = 'flex';
        if(mainApp) mainApp.style.display = 'none';
        viewsIncremented = false; // Reset on logout
    }
});

const signupBtn = document.getElementById('signup-btn');
if(signupBtn) {
    signupBtn.addEventListener('click', async () => {
        const email = document.getElementById('user-email').value;
        const pass = document.getElementById('user-pass').value;
        if(email && pass) await createUserWithEmailAndPassword(auth, email, pass).catch(e => alert(e.message));
    });
}

const loginBtn = document.getElementById('login-btn');
if(loginBtn) {
    loginBtn.addEventListener('click', async () => {
        const email = document.getElementById('user-email').value;
        const pass = document.getElementById('user-pass').value;
        if(email && pass) await signInWithEmailAndPassword(auth, email, pass).catch(e => alert("ভুল ইমেইল বা পাসওয়ার্ড!"));
    });
}

const logoutBtn = document.getElementById('logout-btn');
if(logoutBtn) {
    logoutBtn.addEventListener('click', () => signOut(auth));
}

const saveInstBtn = document.getElementById('save-inst-settings-btn');
if(saveInstBtn) {
    saveInstBtn.addEventListener('click', async () => {
        if(!currentUserUID) return;
        await update(ref(db, `tuition_users/${currentUserUID}/settings`), { 
            instituteName: document.getElementById('inst-name-input').value, 
            teacherName: document.getElementById('teach-name-input').value 
        });
        alert("নাম আপডেট হয়েছে!");
    });
}

function syncSettings(uid) {
    onValue(ref(db, `tuition_users/${uid}/settings`), (snapshot) => {
        const data = snapshot.val() || {};
        let instName = data.instituteName || "জ্ঞানকুঠির";
        let teachName = data.teacherName || "Sayan Sir";
        
        const headerInst = document.getElementById('header-inst-name');
        const displayTeacher = document.getElementById('display-teacher-name');
        const reportInst = document.getElementById('report-institute-name');
        const instInput = document.getElementById('inst-name-input');
        const teachInput = document.getElementById('teach-name-input');

        if(headerInst) headerInst.innerText = instName;
        if(displayTeacher) displayTeacher.innerText = "শিক্ষক: " + teachName;
        if(reportInst) reportInst.innerText = instName + " - Tuition Report";
        if(instInput) instInput.value = instName;
        if(teachInput) teachInput.value = teachName;
    });
}

let pdfBase64 = ""; let pdfFileName = ""; let pdfFileSize = "";
const pdfFileEl = document.getElementById('pdf-file');
if(pdfFileEl) {
    pdfFileEl.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 90000) return alert("ফাইলটি ৬০-৮0 KB এর চেয়ে বড়!"), e.target.value = "";
            pdfFileName = file.name; pdfFileSize = (file.size / 1024).toFixed(1) + " KB";
            const reader = new FileReader(); reader.onload = (event) => pdfBase64 = event.target.result; reader.readAsDataURL(file);
        }
    });
}

const uploadPdfBtn = document.getElementById('upload-pdf-btn');
if(uploadPdfBtn) {
    uploadPdfBtn.addEventListener('click', async () => {
        const title = document.getElementById('pdf-title').value;
        if (title && pdfBase64 && currentUserUID) {
            await set(push(ref(db, `tuition_users/${currentUserUID}/pdfs`)), { title, fileName: pdfFileName, size: pdfFileSize, fileData: pdfBase64 });
            alert("PDF আপলোড সফল!");
            document.getElementById('pdf-title').value = ""; document.getElementById('pdf-file').value = ""; pdfBase64 = "";
        }
    });
}

function initAppDataListeners(uid) {
    syncSettings(uid); 
    onValue(ref(db, `tuition_users/${uid}/students`), (snapshot) => {
        allStudentsRawData = snapshot.val();
        if(allStudentsRawData) {
            renderDashboard(allStudentsRawData);
        } else {
            renderDashboard({});
        }
    });
    
    onValue(ref(db, `tuition_users/${uid}/pdfs`), (snapshot) => {
        const homePdfList = document.getElementById('home-pdf-list');
        const adminPdfList = document.getElementById('admin-pdf-list');
        
        if(homePdfList) homePdfList.innerHTML = ""; 
        if(adminPdfList) adminPdfList.innerHTML = "";
        
        const data = snapshot.val();
        if(data) {
            Object.keys(data).forEach(key => {
                const pdf = data[key];
                if(homePdfList) homePdfList.innerHTML += `<a href="${pdf.fileData}" download="${pdf.fileName}" style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 12px 15px; border-radius: 6px; margin-top: 10px; text-decoration: none; color: #3b82f6; font-size: 0.85rem; border: 1px solid #e2e8f0; font-weight: bold;"><span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80%;"><i class="far fa-file-pdf" style="color: #cbd5e1; margin-right: 8px;"></i> [ ${pdf.title} ] ${pdf.fileName} <span style="color:#64748b; font-size:0.75rem;">(${pdf.size})</span></span><i class="fas fa-arrow-down" style="color: #3b82f6; background: #eff6ff; padding: 5px; border-radius: 4px;"></i></a>`;
                if(adminPdfList) adminPdfList.innerHTML += `<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding: 12px 0; font-size: 0.85rem; color: #333;"><strong style="width: 20%;">${pdf.title}</strong><span style="width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0 10px;">${pdf.fileName}</span><button style="background: #ef4444; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;" onclick="deletePdf('${key}')">ডিলিট</button></div>`;
            });
        }
    });
}

window.searchFeeTable = function() {
    let filter = document.getElementById('search-fee').value.toLowerCase();
    let rows = document.querySelectorAll('.fee-table-row');
    rows.forEach(row => {
        let name = row.getAttribute('data-stuname');
        if(name && name.includes(filter)) row.style.display = '';
        else row.style.display = 'none';
    });
};

window.searchProfileTable = function() {
    let filter = document.getElementById('search-profile').value.toLowerCase();
    let rows = document.querySelectorAll('.profile-table-row');
    rows.forEach(row => {
        let name = row.getAttribute('data-stuname');
        if(name && name.includes(filter)) row.style.display = 'flex';
        else row.style.display = 'none';
    });
};

function renderDashboard(data) {
    const studentGrid = document.getElementById('student-grid');
    const adminAttendanceList = document.getElementById('admin-attendance-list');
    const adminFeesList = document.getElementById('admin-fees-list');
    const adminReportList = document.getElementById('admin-report-list');
    const adminProfileManageList = document.getElementById('admin-profile-manage-list');
    const attendanceSummaryList = document.getElementById('attendance-summary-list');
    
    if(studentGrid) studentGrid.innerHTML = ""; 
    if(adminAttendanceList) adminAttendanceList.innerHTML = ""; 
    if(adminFeesList) adminFeesList.innerHTML = "";
    if(adminReportList) adminReportList.innerHTML = ""; 
    if(adminProfileManageList) adminProfileManageList.innerHTML = ""; 
    if(attendanceSummaryList) attendanceSummaryList.innerHTML = "";
    
    let totalFeesCollected = 0;
    const currentMonthKey = getMonthKey();
    
    currentParsedStudentsForChart = []; 
    let uniqueClasses = new Set();
    let studentArrayForTop = []; 

    if (data) {
        Object.keys(data).forEach(key => {
            try {
                const student = data[key];
                const monthData = student.months && student.months[currentMonthKey] ? student.months[currentMonthKey] : {};
                
                const rawDates = monthData.backlogDates || "";
                const daysCount = rawDates.trim() === "" ? 0 : rawDates.split(',').length;
                const homeworkBaki = monthData.homeworkBaki || false;

                const feeStatus = monthData.feeStatus || "due";
                const feeDate = monthData.feeDate || "";
                const feeAmount = parseInt(monthData.feeAmount) || 0;
                const marks = parseInt(monthData.marks) || 0;
                
                if(feeStatus === "paid") totalFeesCollected += feeAmount; 
                if(student.class) uniqueClasses.add(student.class); 

                currentParsedStudentsForChart.push({ name: student.name, class: student.class, daysCount: daysCount, marks: marks });
                studentArrayForTop.push({ name: student.name, class: student.class, daysCount: daysCount });

                let mIndex = globalMonthSelect ? globalMonthSelect.selectedIndex + 1 : (new Date().getMonth() + 1);
                let yValue = globalYearSelect ? globalYearSelect.value : new Date().getFullYear();
                let dateHtml = rawDates !== "" ? rawDates.split(',').map(d => `${d.trim().padStart(2, '0')}-${mIndex}-${yValue}`).join('<br>') : "কোনো ডেটা নেই";

                let statusTagHtml = `<span class="status-tag tag-due">বকেয়া (Due)</span>`;
                let reportDate = "-";
                if (feeStatus === "paid" && feeDate !== "") {
                    reportDate = feeDate; let payDay = parseInt(feeDate.split('-')[2]);
                    if (payDay >= 1 && payDay <= 7) statusTagHtml = `<span class="status-tag tag-early">🌟 Early Payer (${payDay} তারিখ)</span>`;
                    else if (payDay >= 8 && payDay <= 11) statusTagHtml = `<span class="status-tag tag-regular">✔ Regular (${payDay} তারিখ)</span>`;
                    else statusTagHtml = `<span class="status-tag tag-late">⚠️ Late Fee (${payDay} তারিখ)</span>`;
                } else if (feeStatus === "paid" && feeDate === "") {
                    statusTagHtml = `<span class="status-tag tag-regular">✔ পেইড (তারিখ নেই)</span>`;
                }

                let statusClass = feeStatus === 'paid' ? 'status-paid' : 'status-due';
                let safeName = student.name ? student.name.toLowerCase() : '';

                let escapedName = (student.name || "").replace(/'/g, "\\'");
                let escapedClass = (student.class || "").replace(/'/g, "\\'");
                let escapedPhone = (student.phone || "").replace(/'/g, "\\'");
                let escapedAddress = (student.address || "").replace(/'/g, "\\'");
                let escapedGuardian = (student.guardian || "").replace(/'/g, "\\'");

                if(studentGrid) studentGrid.innerHTML += `<div class="flip-card" onclick="this.classList.toggle('flipped')"><div class="flip-card-inner"><div class="flip-card-front"><h4 style="color: #0f172a; margin: 0 0 5px 0;">${student.name}</h4><small style="color: #3b82f6; font-weight: bold;">CLASS - ${student.class}</small><br><span class="status-badge-due" style="background: ${homeworkBaki ? '#fee2e2' : '#d1fae5'}; color: ${homeworkBaki ? '#ef4444' : '#10b981'}; border-color: ${homeworkBaki ? '#fca5a5' : '#6ee7b7'};">${homeworkBaki ? "বকেয়া (Due)" : "Regular (নিয়মিত)"}</span><hr style="border: 0; height: 1px; background: #e2e8f0; margin: 12px 0;"><div style="font-size: 0.85rem; color: #10b981; font-weight: bold; text-align: left;">উপস্থিতি (${daysCount} দিন) <span style="float: right;">${Math.round((daysCount / 26) * 100)}%</span></div><div style="font-size: 0.75rem; color: #94a3b8; margin-top: 15px;">(উল্টাতে ক্লিক করুন 🔄)</div></div><div class="flip-card-back"><h3 style="margin:0 0 5px 0; color:#fff;">${student.name}</h3><div style="font-size: 2rem; margin: 10px 0;">🔒</div><p style="margin:0; font-size: 0.95rem; font-weight:bold;">ব্যক্তিগত তথ্য সুরক্ষিত</p></div></div></div>`;
                
                if(attendanceSummaryList) attendanceSummaryList.innerHTML += `<tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 15px; font-weight: bold; color: #0f172a;">${student.name}</td><td style="padding: 15px; color: #3b82f6; font-weight: bold;">${daysCount} / ২৬ দিন</td><td style="padding: 15px; text-align: center;"><div class="custom-tooltip-container"><i class="fas fa-calendar-alt" style="color: #cbd5e1; font-size: 1.5rem; background: #f1f5f9; padding: 8px; border-radius: 50%;"></i><div class="custom-tooltip"><strong style="color:#10efbb;">উপস্থিতির তারিখগুলি:</strong><br>${dateHtml}</div></div></td></tr>`;
                
                if(adminAttendanceList) adminAttendanceList.innerHTML += `<div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 15px 0; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; gap: 8px;"><div style="width: 140px;"><strong style="color: #1e293b; font-size: 0.95rem;">${student.name}</strong><br><small style="color: #64748b;">${student.class}</small></div><div style="flex-grow: 1;"><input type="text" id="att-date-${key}" value="${rawDates}" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px;"><div style="color: #10b981; font-weight:bold; font-size: 0.85rem; margin-top:5px;"><i class="fas fa-check-square"></i> = ${daysCount} দিন</div></div><div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;"><label style="font-size:0.8rem; color:#475569; cursor:pointer;"><input type="checkbox" id="att-hw-${key}" ${homeworkBaki ? "checked" : ""}> হোমওয়ার্ক বাকি</label><button style="background: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;" onclick="saveAttendance('${key}')">আপডেট</button></div></div>`;
                
                if(adminFeesList) adminFeesList.innerHTML += `<tr class="fee-table-row" data-stuname="${safeName}"><td style="text-align: left; padding-left: 20px; font-weight:bold;">${student.name}<br><small style="color:#64748b;">${student.class}</small></td><td><select class="${statusClass}" onchange="updateFeeData('${key}', 'feeStatus', this.value)"><option value="paid" ${feeStatus === 'paid' ? 'selected' : ''}>পেইড ✔</option><option value="due" ${feeStatus === 'due' ? 'selected' : ''}>বকেয়া</option></select></td><td><input type="date" value="${feeDate}" onchange="updateFeeData('${key}', 'feeDate', this.value)"></td><td><input type="number" list="amount-options" value="${feeAmount}" onchange="updateFeeData('${key}', 'feeAmount', this.value)"></td><td><input type="number" value="${marks}" onchange="updateFeeData('${key}', 'marks', this.value)"></td><td><button class="btn-reminder" onclick="alert('Digital Receipt Ready!')">রিসিপ্ট 📄</button></td></tr>`;
                
                if(adminReportList) adminReportList.innerHTML += `<tr><td style="text-align: left; font-weight:bold; color: #1e293b;">${student.name}</td><td style="color: #64748b;">${student.class}</td><td style="color: #333;">${daysCount} দিন</td><td style="color: #475569;">${reportDate}</td><td>${statusTagHtml}</td><td style="font-weight:bold; color: #1e293b;">৳ ${feeAmount}</td></tr>`;
                
                if(adminProfileManageList) adminProfileManageList.innerHTML += `<div class="profile-table-row" data-stuname="${safeName}" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding: 12px 0;"><div style="width:65%;"><strong style="color: #1e293b; font-size:0.95rem;">${student.name}</strong><br><span style="color: #64748b; font-size: 0.8rem;">Class: ${student.class} | 📞 ${student.phone || 'N/A'}<br>Guardian: ${student.guardian || 'N/A'}</span></div><div style="width: 35%; text-align: right;"><button style="background: #eab308; color:white; border:none; padding: 6px 12px; border-radius:4px; cursor:pointer; font-weight:bold;" onclick="triggerEditStudentProfile('${key}', '${escapedName}', '${escapedClass}', '${escapedPhone}', '${escapedAddress}', '${escapedGuardian}')">এডিট</button><button style="background: #ef4444; color:white; border:none; padding: 6px 12px; border-radius:4px; cursor:pointer; margin-left: 5px; font-weight:bold;" onclick="triggerDeleteStudent('${key}')">ডিলিট</button></div></div>`;
            } catch (err) {
                console.error("Error Formatting:", err);
            }
        });
    }
    
    const feesDisplay = document.getElementById('admin-total-fees-display');
    if(feesDisplay) feesDisplay.innerText = totalFeesCollected.toLocaleString('en-IN');
    
    studentArrayForTop.sort((a, b) => b.daysCount - a.daysCount);
    const top2 = studentArrayForTop.slice(0, 2);
    const topContainer = document.getElementById('top-attendance-container');
    if(topContainer) {
        topContainer.innerHTML = top2.length > 0 ? top2.map(s => `<div style="display:flex; justify-content:space-between; border-bottom: 1px dashed #2e304e; padding: 4px 0;"><span>🥇 ${s.name} (${s.class})</span><span style="font-weight:bold; color:#4ade80;">${Math.round((s.daysCount / 26) * 100)}%</span></div>`).join('') : "কোনো রেকর্ড নেই";
    }
    
    try { populateClassFilter(uniqueClasses); applyChartFilters(); } catch(err) {}
}

function populateClassFilter(classesSet) {
    const classSelect = document.getElementById('chart-class-filter');
    if(!classSelect) return;
    const currentVal = classSelect.value;
    classSelect.innerHTML = '<option value="all">সব ক্লাস (All Classes)</option>';
    classesSet.forEach(cls => { classSelect.innerHTML += `<option value="${cls}">${cls}</option>`; });
    classSelect.value = currentVal || 'all';
}

function applyChartFilters() {
    const classSelect = document.getElementById('chart-class-filter');
    const sortSelect = document.getElementById('chart-sort-filter');
    if(!classSelect || !sortSelect) return;
    
    const classVal = classSelect.value;
    const sortVal = sortSelect.value;
    let filtered = currentParsedStudentsForChart;

    if (classVal !== 'all') filtered = filtered.filter(s => s.class === classVal);
    if (sortVal === 'top10') filtered = [...filtered].sort((a, b) => b.daysCount - a.daysCount).slice(0, 10);
    else if (sortVal === 'bottom10') filtered = [...filtered].sort((a, b) => a.daysCount - b.daysCount).slice(0, 10);

    const labels = filtered.map(s => s.name);
    const attData = filtered.map(s => s.daysCount);
    const marksData = filtered.map(s => s.marks);
    updateCharts(labels, attData, marksData);
}

function updateCharts(labels, attendanceData, marksData) {
    const attWrapper = document.getElementById('attendance-chart-wrapper');
    const marksWrapper = document.getElementById('marks-chart-wrapper');
    const attCanvas = document.getElementById('attendanceChart');
    const marksCanvas = document.getElementById('marksChart');

    if(!attWrapper || !marksWrapper || !attCanvas || !marksCanvas) return;
    let baseWidth = attWrapper.parentElement ? attWrapper.parentElement.clientWidth : window.innerWidth - 60;
    if(baseWidth === 0) baseWidth = window.innerWidth - 60; 
    let calculatedWidthPx = Math.max(baseWidth, labels.length * 60);
    attWrapper.style.width = calculatedWidthPx + 'px';
    marksWrapper.style.width = calculatedWidthPx + 'px';

    const attCtx = attCanvas.getContext('2d');
    const marksCtx = marksCanvas.getContext('2d');

    if (attendanceChartInstance) attendanceChartInstance.destroy();
    if (marksChartInstance) marksChartInstance.destroy();

    attendanceChartInstance = new Chart(attCtx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'উপস্থিতি (২৬ দিনের মধ্যে)', data: attendanceData, backgroundColor: '#10b981', borderRadius: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 26, ticks: { stepSize: 2 } } } }
    });
    marksChartInstance = new Chart(marksCtx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'পরীক্ষার নম্বর (১০০ এর মধ্যে)', data: marksData, backgroundColor: '#3b82f6', borderRadius: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks: { stepSize: 10 } } } }
    });
}

window.triggerEditStudentProfile = async (key, oldName, oldClass, oldPhone, oldAddress, oldGuardian) => {
    if(!currentUserUID) return;
    
    const newName = prompt("ছাত্র/ছাত্রীর নাম পরিবর্তন করুন:", oldName);
    if(newName === null) return;
    
    const newClass = prompt("ক্লাস পরিবর্তন করুন:", oldClass);
    if(newClass === null) return;
    
    const newPhone = prompt("মোবাইল নম্বর পরিবর্তন করুন:", oldPhone);
    if(newPhone === null) return;
    
    const newAddress = prompt("ঠিকানা পরিবর্তন করুন:", oldAddress);
    if(newAddress === null) return;
    
    const newGuardian = prompt("অভিভাবকের (Guardian) নাম পরিবর্তন করুন:", oldGuardian);
    if(newGuardian === null) return;
    
    const updateObj = {
        name: newName.trim(),
        class: newClass.trim().toUpperCase(),
        phone: newPhone.trim(),
        address: newAddress.trim(),
        guardian: newGuardian.trim()
    };
    
    await update(ref(db, `tuition_users/${currentUserUID}/students/${key}`), updateObj);
    alert("প্রোফাইল সম্পূর্ণ আপডেট হয়েছে!");
};

const addStudentBtn = document.getElementById('add-student-btn');
if(addStudentBtn) {
    addStudentBtn.addEventListener('click', async () => {
        if(!currentUserUID) return;
        const nameInput = document.getElementById('stu-name');
        const clsInput = document.getElementById('stu-class');
        const phoneInput = document.getElementById('stu-phone');
        const addressInput = document.getElementById('stu-address');
        const guardianInput = document.getElementById('stu-guardian');
        
        if(!nameInput.value || !clsInput.value) return alert("নাম ও ক্লাস দিন!");
        
        try {
            await set(push(ref(db, `tuition_users/${currentUserUID}/students`)), {
                name: nameInput.value, 
                class: clsInput.value.toUpperCase(), 
                phone: phoneInput.value || "", 
                address: addressInput.value || "",
                guardian: guardianInput.value || ""
            });
            alert("স্টুডেন্ট যোগ হয়েছে!");
            nameInput.value = ""; clsInput.value = ""; phoneInput.value = ""; addressInput.value = ""; guardianInput.value = "";
        } catch(err) {
            alert("Error: " + err.message);
        }
    });
}

window.saveAttendance = async (studentId) => {
    if(!currentUserUID) return;
    const currentMonthKey = getMonthKey();
    const updateObj = {};
    updateObj[`months/${currentMonthKey}/backlogDates`] = document.getElementById(`att-date-${studentId}`).value;
    updateObj[`months/${currentMonthKey}/homeworkBaki`] = document.getElementById(`att-hw-${studentId}`).checked;
    await update(ref(db, `tuition_users/${currentUserUID}/students/${studentId}`), updateObj);
};
window.updateFeeData = async (studentId, fieldKey, value) => {
    if(!currentUserUID) return;
    const currentMonthKey = getMonthKey();
    const updateObj = {};
    updateObj[`months/${currentMonthKey}/${fieldKey}`] = value;
    await update(ref(db, `tuition_users/${currentUserUID}/students/${studentId}`), updateObj);
};
window.triggerDeleteStudent = async (key) => { if(confirm("ডিলিট করবেন?")) await remove(ref(db, `tuition_users/${currentUserUID}/students/${key}`)); };
window.deletePdf = async (key) => { if(confirm("PDF ডিলিট করবেন?")) await remove(ref(db, `tuition_users/${currentUserUID}/pdfs/${key}`)); };

// স্ক্রিন সাইজ পরিবর্তন হলে বা ফোন রোটেট করলে চার্ট অটো-রিসাইজ হবে
window.addEventListener('resize', () => {
    if (allStudentsRawData && document.getElementById('tab-home').classList.contains('active')) {
        try { applyChartFilters(); } catch(e) {}
    }
});
