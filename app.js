if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (let registration of registrations) { registration.unregister(); }
    });
}

import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { ref, set, push, onValue, remove, update, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const authSection = document.getElementById('auth-section');
const mainApp = document.getElementById('main-app');

let currentUserUID = null;
let allStudentsRawData = null;
let currentInstName = "জ্ঞানকুঠির";
let currentParsedStudentsForChart = [];
let viewsIncremented = false;

let attendanceChartInstance = null;
let marksChartInstance = null;

const globalMonthSelect = document.getElementById('global-month-select');
const globalYearSelect = document.getElementById('global-year-select');
const attDateInput = document.getElementById('att-selected-date');

const monthNames = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
const today = new Date();

function toISODate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

if (globalMonthSelect) globalMonthSelect.value = monthNames[today.getMonth()];
if (globalYearSelect) globalYearSelect.value = today.getFullYear();
if (attDateInput) attDateInput.value = toISODate(today);

const getMonthKey = () => {
    let m = globalMonthSelect ? globalMonthSelect.value : monthNames[today.getMonth()];
    let y = globalYearSelect ? globalYearSelect.value : today.getFullYear();
    return `${m}-${y}`;
};

function syncDatePickerToGlobalMonth() {
    if (!attDateInput || !globalMonthSelect || !globalYearSelect) return;
    const mIdx = globalMonthSelect.selectedIndex;
    const yVal = parseInt(globalYearSelect.value, 10) || today.getFullYear();
    const maxDay = new Date(yVal, mIdx + 1, 0).getDate();
    let currentDay = today.getDate();
    if (attDateInput.value) {
        const parts = attDateInput.value.split('-');
        if (parts.length === 3) currentDay = parseInt(parts[2], 10) || 1;
    }
    const clampedDay = Math.min(currentDay, maxDay);
    attDateInput.value = `${yVal}-${String(mIdx + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

if (globalMonthSelect) {
    globalMonthSelect.addEventListener('change', () => {
        syncDatePickerToGlobalMonth();
        document.querySelectorAll('.global-month-display').forEach(el => el.innerText = getMonthKey());
        if (allStudentsRawData) renderDashboard(allStudentsRawData);
    });
}

if (globalYearSelect) {
    globalYearSelect.addEventListener('input', () => {
        if (String(globalYearSelect.value).length === 4) {
            syncDatePickerToGlobalMonth();
            document.querySelectorAll('.global-month-display').forEach(el => el.innerText = getMonthKey());
            if (allStudentsRawData) renderDashboard(allStudentsRawData);
        }
    });
}

if (attDateInput) {
    attDateInput.addEventListener('change', () => {
        if (!attDateInput.value) return;
        const parts = attDateInput.value.split('-');
        if (parts.length === 3) {
            const yr = parseInt(parts[0], 10);
            const mIdx = parseInt(parts[1], 10) - 1;
            if (globalYearSelect) globalYearSelect.value = yr;
            if (globalMonthSelect && monthNames[mIdx]) globalMonthSelect.value = monthNames[mIdx];
            document.querySelectorAll('.global-month-display').forEach(el => el.innerText = getMonthKey());
        }
        if (allStudentsRawData) renderDashboard(allStudentsRawData);
    });
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, ''');
}

function parseDateList(rawStr) {
    if (!rawStr || typeof rawStr !== 'string') return [];
    const set = new Set();
    rawStr.split(',').forEach(item => {
        const num = parseInt(item.trim(), 10);
        if (!isNaN(num) && num >= 1 && num <= 31) set.add(num);
    });
    return Array.from(set).sort((a, b) => a - b);
}

function formatDateList(numArr) {
    return Array.from(new Set(numArr)).sort((a, b) => a - b).join(', ');
}

function getSelectedDayNum() {
    if (attDateInput && attDateInput.value) {
        const parts = attDateInput.value.split('-');
        if (parts.length === 3) return parseInt(parts[2], 10) || today.getDate();
    }
    return today.getDate();
}

window.toggleLoginPassword = function() {
    const passInput = document.getElementById('user-pass');
    const eyeIcon = document.getElementById('toggle-pass-eye');
    if (!passInput || !eyeIcon) return;
    if (passInput.type === 'password') {
        passInput.type = 'text';
        eyeIcon.innerText = '🙈';
    } else {
        passInput.type = 'password';
        eyeIcon.innerText = '👁️';
    }
};

const classFilterEl = document.getElementById('chart-class-filter');
const sortFilterEl = document.getElementById('chart-sort-filter');
if (classFilterEl) classFilterEl.addEventListener('change', () => { try { applyChartFilters(); } catch (e) {} });
if (sortFilterEl) sortFilterEl.addEventListener('change', () => { try { applyChartFilters(); } catch (e) {} });

window.switchTab = function(tabId, navElement) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    
    const tabToActivate = document.getElementById(tabId);
    if (tabToActivate) tabToActivate.classList.add('active');
    if (navElement) navElement.classList.add('active');
    
    if (tabId === 'tab-home' && allStudentsRawData) {
        try { applyChartFilters(); } catch (e) {}
    }
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserUID = user.uid;
        if (authSection) authSection.style.display = 'none';
        if (mainApp) mainApp.style.display = 'block';
        document.querySelectorAll('.global-month-display').forEach(el => el.innerText = getMonthKey());
        initAppDataListeners(currentUserUID);

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
        if (authSection) authSection.style.display = 'flex';
        if (mainApp) mainApp.style.display = 'none';
        viewsIncremented = false;
    }
});

const signupBtn = document.getElementById('signup-btn');
if (signupBtn) {
    signupBtn.addEventListener('click', async () => {
        const email = document.getElementById('user-email').value;
        const pass = document.getElementById('user-pass').value;
        if (email && pass) await createUserWithEmailAndPassword(auth, email, pass).catch(e => alert(e.message));
    });
}

const loginBtn = document.getElementById('login-btn');
if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        const email = document.getElementById('user-email').value;
        const pass = document.getElementById('user-pass').value;
        if (email && pass) await signInWithEmailAndPassword(auth, email, pass).catch(() => alert("ভুল ইমেইল বা পাসওয়ার্ড!"));
    });
}

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => signOut(auth));
}

const saveInstBtn = document.getElementById('save-inst-settings-btn');
if (saveInstBtn) {
    saveInstBtn.addEventListener('click', async () => {
        if (!currentUserUID) return;
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
        currentInstName = data.instituteName || "জ্ঞানকুঠির";
        let teachName = data.teacherName || "Sayan Sir";
        
        const headerInst = document.getElementById('header-inst-name');
        const displayTeacher = document.getElementById('display-teacher-name');
        const reportInst = document.getElementById('report-institute-name');
        const instInput = document.getElementById('inst-name-input');
        const teachInput = document.getElementById('teach-name-input');

        if (headerInst) headerInst.innerText = currentInstName;
        if (displayTeacher) displayTeacher.innerText = "শিক্ষক: " + teachName;
        if (reportInst) reportInst.innerText = currentInstName + " - Tuition Report";
        if (instInput) instInput.value = currentInstName;
        if (teachInput) teachInput.value = teachName;
    });
}

let pdfBase64 = ""; let pdfFileName = ""; let pdfFileSize = "";
const pdfFileEl = document.getElementById('pdf-file');
if (pdfFileEl) {
    pdfFileEl.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 90000) return alert("ফাইলটি ৬০-৮০ KB এর চেয়ে বড়!"), e.target.value = "";
            pdfFileName = file.name; pdfFileSize = (file.size / 1024).toFixed(1) + " KB";
            const reader = new FileReader(); reader.onload = (event) => pdfBase64 = event.target.result; reader.readAsDataURL(file);
        }
    });
}

const uploadPdfBtn = document.getElementById('upload-pdf-btn');
if (uploadPdfBtn) {
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
        if (allStudentsRawData) {
            renderDashboard(allStudentsRawData);
        } else {
            renderDashboard({});
        }
    });
    
    onValue(ref(db, `tuition_users/${uid}/pdfs`), (snapshot) => {
        const homePdfList = document.getElementById('home-pdf-list');
        const adminPdfList = document.getElementById('admin-pdf-list');
        
        if (homePdfList) homePdfList.innerHTML = "";
        if (adminPdfList) adminPdfList.innerHTML = "";
        
        const data = snapshot.val();
        if (data) {
            Object.keys(data).forEach(key => {
                const pdf = data[key];
                if (homePdfList) homePdfList.innerHTML += `<a href="${pdf.fileData}" download="${escapeHtml(pdf.fileName)}" style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 12px 15px; border-radius: 6px; margin-top: 10px; text-decoration: none; color: #3b82f6; font-size: 0.85rem; border: 1px solid #e2e8f0; font-weight: bold;"><span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80%;"><i class="far fa-file-pdf" style="color: #cbd5e1; margin-right: 8px;"></i> [ ${escapeHtml(pdf.title)} ] ${escapeHtml(pdf.fileName)} <span style="color:#64748b; font-size:0.75rem;">(${escapeHtml(pdf.size)})</span></span><i class="fas fa-arrow-down" style="color: #3b82f6; background: #eff6ff; padding: 5px; border-radius: 4px;"></i></a>`;
                if (adminPdfList) adminPdfList.innerHTML += `<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding: 12px 0; font-size: 0.85rem; color: #333;"><strong style="width: 20%;">${escapeHtml(pdf.title)}</strong><span style="width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0 10px;">${escapeHtml(pdf.fileName)}</span><button style="background: #ef4444; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;" onclick="deletePdf('${key}')">ডিলিট</button></div>`;
            });
        }
    });
}

window.searchAttendanceList = function() {
    const searchEl = document.getElementById('search-attendance');
    if (!searchEl) return;
    let filter = searchEl.value.toLowerCase();
    let rows = document.querySelectorAll('.att-row');
    rows.forEach(row => {
        let info = row.getAttribute('data-stuinfo') || '';
        row.style.display = info.includes(filter) ? 'flex' : 'none';
    });
};

window.searchFeeTable = function() {
    const searchEl = document.getElementById('search-fee');
    if (!searchEl) return;
    let filter = searchEl.value.toLowerCase();
    let rows = document.querySelectorAll('.fee-table-row');
    rows.forEach(row => {
        let name = row.getAttribute('data-stuname') || '';
        row.style.display = name.includes(filter) ? '' : 'none';
    });
};

window.searchProfileTable = function() {
    const searchEl = document.getElementById('search-profile');
    if (!searchEl) return;
    let filter = searchEl.value.toLowerCase();
    let rows = document.querySelectorAll('.profile-table-row');
    rows.forEach(row => {
        let name = row.getAttribute('data-stuname') || '';
        row.style.display = name.includes(filter) ? 'flex' : 'none';
    });
};

function renderDashboard(data) {
    const studentGrid = document.getElementById('student-grid');
    const adminAttendanceList = document.getElementById('admin-attendance-list');
    const adminFeesList = document.getElementById('admin-fees-list');
    const adminReportList = document.getElementById('admin-report-list');
    const adminProfileManageList = document.getElementById('admin-profile-manage-list');
    const attendanceSummaryList = document.getElementById('attendance-summary-list');
    
    if (studentGrid) studentGrid.innerHTML = "";
    if (adminAttendanceList) adminAttendanceList.innerHTML = "";
    if (adminFeesList) adminFeesList.innerHTML = "";
    if (adminReportList) adminReportList.innerHTML = "";
    if (adminProfileManageList) adminProfileManageList.innerHTML = "";
    if (attendanceSummaryList) attendanceSummaryList.innerHTML = "";
    
    let totalFeesCollected = 0;
    const currentMonthKey = getMonthKey();
    const selectedDayNum = getSelectedDayNum();
    
    currentParsedStudentsForChart = [];
    let uniqueClasses = new Set();
    let studentEntries = [];

    if (data) {
        Object.keys(data).forEach(key => {
            const student = data[key];
            if (!student) return;
            const monthData = student.months && student.months[currentMonthKey] ? student.months[currentMonthKey] : {};
            const presentDaysArr = parseDateList(monthData.backlogDates || "");
            const absentDaysArr = parseDateList(monthData.absentDates || "");
            const daysCount = presentDaysArr.length;

            studentEntries.push({
                key,
                student,
                monthData,
                presentDaysArr,
                absentDaysArr,
                daysCount
            });
        });
    }

    // নিয়মিত উপস্থিতি (বেশি দিন) অনুযায়ী অটোমেটিক সর্টিং — ডেটাবেসের কোনো ডেটা মুছবে না
    studentEntries.sort((a, b) => {
        if (b.daysCount !== a.daysCount) return b.daysCount - a.daysCount;
        return (a.student.name || "").localeCompare(b.student.name || "");
    });

    let mIndex = globalMonthSelect ? globalMonthSelect.selectedIndex + 1 : (new Date().getMonth() + 1);
    let mIndexPadded = String(mIndex).padStart(2, '0');
    let yValue = globalYearSelect ? globalYearSelect.value : new Date().getFullYear();

    studentEntries.forEach(entry => {
        try {
            const { key, student, monthData, presentDaysArr, absentDaysArr, daysCount } = entry;

            const feeStatus = monthData.feeStatus || "due";
            const feeDate = monthData.feeDate || "";
            const feeAmount = parseInt(monthData.feeAmount, 10) || 0;
            const marks = parseInt(monthData.marks, 10) || 0;
            const lateReason = monthData.lateReason || "";

            if (feeStatus === "paid") totalFeesCollected += feeAmount;
            if (student.class) uniqueClasses.add(student.class);

            currentParsedStudentsForChart.push({ name: student.name, class: student.class, daysCount, marks });

            const dateHtml = presentDaysArr.length > 0
                ? presentDaysArr.map(dNum => `${String(dNum).padStart(2, '0')}-${mIndexPadded}-${yValue}`).join('<br>')
                : "কোনো ডেটা নেই";

            const presentDaysPreview = presentDaysArr.length > 0 ? presentDaysArr.join(', ') : "এখনও কোনো তারিখ নেই";

            // ১৩ তারিখের পর পেমেন্ট হলে লেট হিসেবে চিহ্নিত হবে এবং কারণ লেখার ঘর খুলবে
            let payDay = 0;
            if (feeDate && feeDate.includes('-')) {
                payDay = parseInt(feeDate.split('-')[2], 10) || 0;
            }
            const isLatePayment = payDay > 13;

            let statusTagHtml = `<span class="status-tag tag-due">বকেয়া (Due)</span>`;
            let reportDate = "-";
            if (feeStatus === "paid" && feeDate !== "") {
                reportDate = feeDate;
                if (payDay >= 1 && payDay <= 7) {
                    statusTagHtml = `<span class="status-tag tag-early">🌟 Early Payer (${payDay} তারিখ)</span>`;
                } else if (payDay >= 8 && payDay <= 13) {
                    statusTagHtml = `<span class="status-tag tag-regular">✔ Regular (${payDay} তারিখ)</span>`;
                } else {
                    statusTagHtml = `<span class="status-tag tag-late">⚠️ Late (${payDay} তারিখ)</span>`;
                    if (lateReason.trim() !== "") {
                        statusTagHtml += `<div style="font-size:0.75rem; color:#9a3412; margin-top:4px; font-weight:600;">কারণ: ${escapeHtml(lateReason)}</div>`;
                    }
                }
            } else if (feeStatus === "paid" && feeDate === "") {
                statusTagHtml = `<span class="status-tag tag-regular">✔ পেইড (তারিখ নেই)</span>`;
            }

            const statusClass = feeStatus === 'paid' ? 'status-paid' : 'status-due';
            const safeName = (student.name || '').toLowerCase();
            const safeInfo = `${student.name || ''} ${student.class || ''}`.toLowerCase();

            // Regularity badge for Student Flip Card (Homework baki removed)
            const attendancePercent = Math.round((daysCount / 26) * 100);
            const isRegular = daysCount >= 12;
            const badgeText = isRegular ? "নিয়মিত (Regular)" : (daysCount > 0 ? "কম উপস্থিতি" : "উপস্থিতি নেই");
            const badgeBg = isRegular ? "#d1fae5" : "#fef3c7";
            const badgeColor = isRegular ? "#047857" : "#b45309";
            const badgeBorder = isRegular ? "#6ee7b7" : "#fcd34d";

            if (studentGrid) {
                studentGrid.innerHTML += `
                    <div class="flip-card" onclick="this.classList.toggle('flipped')">
                        <div class="flip-card-inner">
                            <div class="flip-card-front">
                                <h4 style="color: #0f172a; margin: 0 0 5px 0;">${escapeHtml(student.name)}</h4>
                                <small style="color: #3b82f6; font-weight: bold;">CLASS - ${escapeHtml(student.class)}</small><br>
                                <span class="status-badge-due" style="background: ${badgeBg}; color: ${badgeColor}; border-color: ${badgeBorder};">${badgeText}</span>
                                <hr style="border: 0; height: 1px; background: #e2e8f0; margin: 12px 0;">
                                <div style="font-size: 0.85rem; color: #10b981; font-weight: bold; text-align: left;">
                                    উপস্থিতি (${daysCount} দিন) <span style="float: right;">${attendancePercent}%</span>
                                </div>
                                <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 15px;">(উল্টাতে ক্লিক করুন 🔄)</div>
                            </div>
                            <div class="flip-card-back">
                                <h3 style="margin:0 0 5px 0; color:#fff;">${escapeHtml(student.name)}</h3>
                                <div style="font-size: 2rem; margin: 10px 0;">🔒</div>
                                <p style="margin:0; font-size: 0.95rem; font-weight:bold;">ব্যক্তিগত তথ্য সুরক্ষিত</p>
                            </div>
                        </div>
                    </div>`;
            }

            if (attendanceSummaryList) {
                attendanceSummaryList.innerHTML += `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 15px; font-weight: bold; color: #0f172a;">${escapeHtml(student.name)}<br><small style="color:#64748b; font-weight:normal;">${escapeHtml(student.class)}</small></td>
                        <td style="padding: 15px; color: #3b82f6; font-weight: bold;">${daysCount} / ২৬ দিন</td>
                        <td style="padding: 15px; text-align: center;">
                            <div class="custom-tooltip-container">
                                <i class="fas fa-calendar-alt" style="color: #3b82f6; font-size: 1.5rem; background: #f1f5f9; padding: 8px; border-radius: 50%;"></i>
                                <div class="custom-tooltip"><strong style="color:#10efbb;">উপস্থিতির তারিখগুলি:</strong><br>${dateHtml}</div>
                            </div>
                        </td>
                    </tr>`;
            }

            // Admin Daily Attendance with ✔ Present & ✖ Absent symbols
            const isPresentToday = presentDaysArr.includes(selectedDayNum);
            const isAbsentToday = absentDaysArr.includes(selectedDayNum);

            if (adminAttendanceList) {
                adminAttendanceList.innerHTML += `
                    <div class="att-row" data-stuinfo="${escapeHtml(safeInfo)}">
                        <div style="flex: 1; min-width: 160px;">
                            <strong style="color: #1e293b; font-size: 0.98rem;">${escapeHtml(student.name)}</strong>
                            <span style="color: #3b82f6; font-size: 0.8rem; font-weight: bold; margin-left: 6px;">(${escapeHtml(student.class)})</span>
                            <div style="color: #10b981; font-weight: bold; font-size: 0.82rem; margin-top: 3px;">
                                মোট উপস্থিতি: ${daysCount} দিন
                            </div>
                            <div style="color: #64748b; font-size: 0.75rem; margin-top: 2px;">
                                📅 তারিখ: ${presentDaysPreview}
                            </div>
                        </div>
                        <div class="att-btn-group">
                            <button type="button" class="att-btn ${isPresentToday ? 'present-active' : ''}" title="Present (উপস্থিত)" onclick="markAttendance('${key}', 'present')">✔</button>
                            <button type="button" class="att-btn ${isAbsentToday ? 'absent-active' : ''}" title="Absent (অনুপস্থিত)" onclick="markAttendance('${key}', 'absent')">✖</button>
                        </div>
                    </div>`;
            }

            // Admin Fees Table with Rupees (₹) & automatic Late Reason box after 13th
            const lateReasonHtml = isLatePayment
                ? `<div class="late-reason-box">
                       <span class="late-reason-label">⚠️ ১৩ তারিখের পর (লেট কারণ):</span>
                       <input type="text" class="late-reason-input" placeholder="কারণ লিখুন..." value="${escapeHtml(lateReason)}" onchange="updateFeeData('${key}', 'lateReason', this.value)">
                   </div>`
                : '';

            const waButtonHtml = feeStatus === 'paid'
                ? `<button class="btn-receipt" onclick="sendWhatsAppReceipt('${key}')">রিসিপ্ট 📄</button>`
                : `<button class="btn-reminder" onclick="sendWhatsAppReceipt('${key}')">রিমাইন্ডার 🔔</button>`;

            if (adminFeesList) {
                adminFeesList.innerHTML += `
                    <tr class="fee-table-row" data-stuname="${escapeHtml(safeName)}">
                        <td style="text-align: left; padding-left: 20px; font-weight:bold;">
                            ${escapeHtml(student.name)}<br>
                            <small style="color:#64748b;">${escapeHtml(student.class)}</small>
                        </td>
                        <td>
                            <select class="${statusClass}" onchange="updateFeeData('${key}', 'feeStatus', this.value)">
                                <option value="paid" ${feeStatus === 'paid' ? 'selected' : ''}>পেইড ✔</option>
                                <option value="due" ${feeStatus === 'due' ? 'selected' : ''}>বকেয়া</option>
                            </select>
                        </td>
                        <td>
                            <input type="date" value="${escapeHtml(feeDate)}" onchange="updateFeeData('${key}', 'feeDate', this.value)">
                        </td>
                        <td>
                            <input type="number" list="amount-options" value="${feeAmount}" onchange="updateFeeData('${key}', 'feeAmount', this.value)">
                            ${lateReasonHtml}
                        </td>
                        <td>
                            <input type="number" value="${marks}" onchange="updateFeeData('${key}', 'marks', this.value)">
                        </td>
                        <td>${waButtonHtml}</td>
                    </tr>`;
            }

            if (adminReportList) {
                adminReportList.innerHTML += `
                    <tr>
                        <td style="text-align: left; font-weight:bold; color: #1e293b;">${escapeHtml(student.name)}</td>
                        <td style="color: #64748b;">${escapeHtml(student.class)}</td>
                        <td style="color: #333;">${daysCount} দিন</td>
                        <td style="color: #475569;">${reportDate}</td>
                        <td>${statusTagHtml}</td>
                        <td style="font-weight:bold; color: #1e293b;">₹ ${feeAmount}</td>
                    </tr>`;
            }

            if (adminProfileManageList) {
                adminProfileManageList.innerHTML += `
                    <div class="profile-table-row" data-stuname="${escapeHtml(safeName)}" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding: 12px 0;">
                        <div style="width:65%;">
                            <strong style="color: #1e293b; font-size:0.95rem;">${escapeHtml(student.name)}</strong><br>
                            <span style="color: #64748b; font-size: 0.8rem;">Class: ${escapeHtml(student.class)} | 📞 ${escapeHtml(student.phone || 'N/A')}<br>Guardian: ${escapeHtml(student.guardian || 'N/A')}</span>
                        </div>
                        <div style="width: 35%; text-align: right;">
                            <button style="background: #eab308; color:white; border:none; padding: 6px 12px; border-radius:4px; cursor:pointer; font-weight:bold;" onclick="triggerEditStudentProfile('${key}')">এডিট</button>
                            <button style="background: #ef4444; color:white; border:none; padding: 6px 12px; border-radius:4px; cursor:pointer; margin-left: 5px; font-weight:bold;" onclick="triggerDeleteStudent('${key}')">ডিলিট</button>
                        </div>
                    </div>`;
            }
        } catch (err) {
            console.error("Error Formatting:", err);
        }
    });

    const feesDisplay = document.getElementById('admin-total-fees-display');
    if (feesDisplay) feesDisplay.innerText = totalFeesCollected.toLocaleString('en-IN');

    // Top 2 Attendance
    const top2Att = currentParsedStudentsForChart.slice(0, 2);
    const topContainer = document.getElementById('top-attendance-container');
    if (topContainer) {
        topContainer.innerHTML = top2Att.length > 0
            ? top2Att.map(s => `<div style="display:flex; justify-content:space-between; border-bottom: 1px dashed #2e304e; padding: 4px 0;"><span>🥇 ${escapeHtml(s.name)} (${escapeHtml(s.class)})</span><span style="font-weight:bold; color:#4ade80;">${Math.round((s.daysCount / 26) * 100)}%</span></div>`).join('')
            : "কোনো রেকর্ড নেই";
    }

    // Top 2 Marks (Dynamic)
    const top2Marks = [...currentParsedStudentsForChart]
        .filter(s => s.marks > 0)
        .sort((a, b) => b.marks - a.marks)
        .slice(0, 2);
    const topMarksContainer = document.getElementById('top-marks-container');
    if (topMarksContainer) {
        topMarksContainer.innerHTML = top2Marks.length > 0
            ? top2Marks.map(s => `<div style="display:flex; justify-content:space-between; border-bottom: 1px dashed #2e304e; padding: 4px 0;"><span>⭐ ${escapeHtml(s.name)} (${escapeHtml(s.class)})</span><span style="font-weight:bold; color:#38bdf8;">${s.marks} নম্বর</span></div>`).join('')
            : "<span style='opacity:0.7;'>কোনো নম্বর এন্ট্রি নেই</span>";
    }

    // Re-apply search filters so current view stays intact after update
    searchAttendanceList();
    searchFeeTable();
    searchProfileTable();

    try { populateClassFilter(uniqueClasses); applyChartFilters(); } catch (err) {}
}

function populateClassFilter(classesSet) {
    const classSelect = document.getElementById('chart-class-filter');
    if (!classSelect) return;
    const currentVal = classSelect.value;
    classSelect.innerHTML = '<option value="all">সব ক্লাস (All Classes)</option>';
    classesSet.forEach(cls => { classSelect.innerHTML += `<option value="${escapeHtml(cls)}">${escapeHtml(cls)}</option>`; });
    classSelect.value = currentVal || 'all';
}

function applyChartFilters() {
    const classSelect = document.getElementById('chart-class-filter');
    const sortSelect = document.getElementById('chart-sort-filter');
    if (!classSelect || !sortSelect) return;
    
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

    if (!attWrapper || !marksWrapper || !attCanvas || !marksCanvas) return;
    let baseWidth = attWrapper.parentElement ? attWrapper.parentElement.clientWidth : window.innerWidth - 60;
    if (baseWidth === 0) baseWidth = window.innerWidth - 60;
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

// One-click Present (✔) / Absent (✖) without losing any old data
window.markAttendance = async (studentId, status) => {
    if (!currentUserUID || !allStudentsRawData || !allStudentsRawData[studentId]) return;
    const currentMonthKey = getMonthKey();
    const dayNum = getSelectedDayNum();

    const student = allStudentsRawData[studentId];
    const monthData = student.months && student.months[currentMonthKey] ? student.months[currentMonthKey] : {};

    let presentArr = parseDateList(monthData.backlogDates || "");
    let absentArr = parseDateList(monthData.absentDates || "");

    if (status === 'present') {
        if (!presentArr.includes(dayNum)) presentArr.push(dayNum);
        absentArr = absentArr.filter(d => d !== dayNum);
    } else if (status === 'absent') {
        if (!absentArr.includes(dayNum)) absentArr.push(dayNum);
        presentArr = presentArr.filter(d => d !== dayNum);
    }

    const updateObj = {};
    updateObj[`months/${currentMonthKey}/backlogDates`] = formatDateList(presentArr);
    updateObj[`months/${currentMonthKey}/absentDates`] = formatDateList(absentArr);

    await update(ref(db, `tuition_users/${currentUserUID}/students/${studentId}`), updateObj);
};

window.updateFeeData = async (studentId, fieldKey, value) => {
    if (!currentUserUID) return;
    const currentMonthKey = getMonthKey();
    const updateObj = {};
    updateObj[`months/${currentMonthKey}/${fieldKey}`] = value;
    await update(ref(db, `tuition_users/${currentUserUID}/students/${studentId}`), updateObj);
};

window.sendWhatsAppReceipt = (studentId) => {
    if (!allStudentsRawData || !allStudentsRawData[studentId]) return;
    const student = allStudentsRawData[studentId];
    const currentMonthKey = getMonthKey();
    const monthData = student.months && student.months[currentMonthKey] ? student.months[currentMonthKey] : {};

    let rawPhone = (student.phone || "").replace(/\D/g, "");
    if (!rawPhone) {
        alert("এই ছাত্র/ছাত্রীর মোবাইল নম্বর সেভ করা নেই!");
        return;
    }
    if (rawPhone.length === 10) rawPhone = "91" + rawPhone;

    const feeStatus = monthData.feeStatus || "due";
    const feeAmount = parseInt(monthData.feeAmount, 10) || 0;
    const feeDate = monthData.feeDate || "-";
    const lateReason = (monthData.lateReason || "").trim();
    const payDay = feeDate.includes('-') ? parseInt(feeDate.split('-')[2], 10) || 0 : 0;

    let msg = "";
    if (feeStatus === "paid") {
        msg = `✅ *পেমেন্ট রিসিপ্ট - ${currentInstName}*\n\n` +
              `👤 নাম: ${student.name}\n` +
              `📚 ক্লাস: ${student.class}\n` +
              `🗓️ মাস: ${currentMonthKey}\n` +
              `💰 পরিমাণ: ₹ ${feeAmount}\n` +
              `📅 তারিখ: ${feeDate}\n` +
              (payDay > 13 && lateReason ? `⚠️ লেট কারণ: ${lateReason}\n` : "") +
              `\nধন্যবাদ!`;
    } else {
        msg = `🔔 *ফিস রিমাইন্ডার - ${currentInstName}*\n\n` +
              `নমস্কার, ${student.name} (${student.class})-এর ${currentMonthKey} মাসের টিউশন ফিস` +
              (feeAmount > 0 ? ` (₹ ${feeAmount})` : "") +
              ` এখনও বকেয়া রয়েছে। অনুগ্রহ করে সময়মতো জমা দিয়ে দেবেন।\n\nধন্যবাদ!`;
    }

    window.open(`https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.triggerEditStudentProfile = async (key) => {
    if (!currentUserUID || !allStudentsRawData || !allStudentsRawData[key]) return;
    const s = allStudentsRawData[key];
    
    const newName = prompt("ছাত্র/ছাত্রীর নাম পরিবর্তন করুন:", s.name || "");
    if (newName === null) return;
    
    const newClass = prompt("ক্লাস পরিবর্তন করুন:", s.class || "");
    if (newClass === null) return;
    
    const newPhone = prompt("মোবাইল নম্বর পরিবর্তন করুন:", s.phone || "");
    if (newPhone === null) return;
    
    const newAddress = prompt("ঠিকানা পরিবর্তন করুন:", s.address || "");
    if (newAddress === null) return;
    
    const newGuardian = prompt("অভিভাবকের (Guardian) নাম পরিবর্তন করুন:", s.guardian || "");
    if (newGuardian === null) return;
    
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
if (addStudentBtn) {
    addStudentBtn.addEventListener('click', async () => {
        if (!currentUserUID) return;
        const nameInput = document.getElementById('stu-name');
        const clsInput = document.getElementById('stu-class');
        const phoneInput = document.getElementById('stu-phone');
        const addressInput = document.getElementById('stu-address');
        const guardianInput = document.getElementById('stu-guardian');
        
        if (!nameInput.value || !clsInput.value) return alert("নাম ও ক্লাস দিন!");
        
        try {
            await set(push(ref(db, `tuition_users/${currentUserUID}/students`)), {
                name: nameInput.value.trim(),
                class: clsInput.value.trim().toUpperCase(),
                phone: phoneInput.value.trim() || "",
                address: addressInput.value.trim() || "",
                guardian: guardianInput.value.trim() || ""
            });
            alert("স্টুডেন্ট যোগ হয়েছে!");
            nameInput.value = ""; clsInput.value = ""; phoneInput.value = ""; addressInput.value = ""; guardianInput.value = "";
        } catch (err) {
            alert("Error: " + err.message);
        }
    });
}

window.triggerDeleteStudent = async (key) => {
    if (confirm("ডিলিট করবেন?")) await remove(ref(db, `tuition_users/${currentUserUID}/students/${key}`));
};

window.deletePdf = async (key) => {
    if (confirm("PDF ডিলিট করবেন?")) await remove(ref(db, `tuition_users/${currentUserUID}/pdfs/${key}`));
};

window.addEventListener('resize', () => {
    if (allStudentsRawData && document.getElementById('tab-home').classList.contains('active')) {
        try { applyChartFilters(); } catch (e) {}
    }
});
