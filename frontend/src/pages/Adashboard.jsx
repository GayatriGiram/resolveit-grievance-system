import React, { useCallback, useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { getCurrentUser, logout } from '../services/authService';
import {
  addSampleStaffAndAssignComplaints,
  createAdminUser,
  getAdminUsers,
  markStaffAttendance,
  updateAdminUser,
} from '../services/adminService';
import API_URL from '../services/apiConfig';
import { getUiPreferences, updateUiPreferences } from '../services/preferencesService';
import './Adashboard.css';
import {
  FiHome, FiFileText, FiCheckCircle, FiBarChart2,
  FiSettings, FiLogOut, FiMenu, FiX,
  FiClock, FiAlertCircle, FiTrendingUp, FiUsers,
  FiCalendar, FiBell,
  FiDownload, FiRefreshCw, FiFilter, FiPlus,
  FiExternalLink, FiMoon, FiSun,
} from 'react-icons/fi';

const ADMIN_SETTINGS_KEY = 'resolveit-admin-settings';
const ADMIN_ATTENDANCE_KEY = 'resolveit-admin-attendance';
const ADMIN_NOTIFICATION_KEY = 'resolveit-admin-notification-state';

const DEFAULT_SETTINGS = {
  maxComplaintsPerWorker: 12,
  resolutionTargetHours: 6,
  enableTwoFactor: true,
  enableAuditLog: true,
  emailNotifications: true,
  smsCriticalAlerts: false,
};

const DEFAULT_STAFF_FORM = {
  name: '',
  email: '',
  password: '',
  role: 'STAFF',
  rank: 'Handler',
  specializationCategory: '',
  isActive: true,
};

const STAFF_RANK_OPTIONS = ['Handler', 'Senior Handler'];
const COMPLAINT_CATEGORY_OPTIONS = [
  'network',
  'wifi-connectivity',
  'server-malfunction',
  'software-bug',
  'application-installation',
  'access-issue',
  'password-reset',
  'email-issue',
  'vpn-remote-access',
  'hardware-failure',
  'printer-scanner',
  'cybersecurity',
  'data-backup-recovery',
  'performance-slow-system',
  'it-support-request',
  'other',
];

const ATTENDANCE_STATUS_OPTIONS = ['present', 'absent', 'on_leave'];
const REPORT_PERIOD_OPTIONS = ['7d', '30d', '90d', 'all'];
const EXPORT_FORMAT_OPTIONS = [
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'Excel' },
  { value: 'pdf', label: 'PDF' },
];

const safeJsonParse = (value, fallback) => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const formatDateTime = (value) => {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return date.toLocaleString();
};

const normalizeStatus = (status) => {
  const normalized = (status || 'open').toLowerCase();
  if (normalized === 'in-progress' || normalized === 'in progress') {
    return 'inprogress';
  }
  if (normalized === 'closed' || normalized === 'done') {
    return 'resolved';
  }
  return normalized;
};

const getStatusLabel = (status) => {
  const normalized = normalizeStatus(status);
  if (normalized === 'inprogress') {
    return 'In Progress';
  }
  if (normalized === 'on_leave') {
    return 'On Leave';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const getStatusClass = (status) => {
  const normalized = normalizeStatus(status);
  if (normalized === 'resolved') return 'completed';
  if (normalized === 'inprogress') return 'in-progress';
  if (normalized === 'escalated') return 'escalated';
  if (normalized === 'open') return 'open';
  if (normalized === 'present') return 'present';
  if (normalized === 'absent') return 'pending';
  if (normalized === 'on_leave') return 'leave';
  return 'pending';
};

const normalizeComplaintCategory = (category) => {
  const normalized = `${category || ''}`.trim().toLowerCase();
  if (!normalized) {
    return 'uncategorized';
  }

  if (normalized.includes('hostel') || normalized.includes('academic') || normalized.includes('infrastructure')) {
    return 'it-support-request';
  }

  return normalized;
};

const getComplaintCategoryLabel = (category) => {
  return getStatusLabel(normalizeComplaintCategory(category));
};

const isSeniorHandler = (user) => {
  return (user?.rank || '').trim().toLowerCase() === 'senior handler';
};

const canHandleCategory = (member, complaint) => {
  if (!isSeniorHandler(member)) {
    return true;
  }

  const specialization = normalizeComplaintCategory(member?.specializationCategory);
  const complaintCategory = normalizeComplaintCategory(complaint?.category);
  return specialization === complaintCategory;
};

const getAllowedStatuses = (status) => {
  const normalized = normalizeStatus(status || 'open');
  const all = ['open', 'inprogress', 'pending', 'escalated', 'resolved'];
  return [normalized, ...all.filter((item) => item !== normalized)];
};

const priorityRank = (urgency) => {
  const normalized = (urgency || 'normal').toLowerCase();
  if (normalized === 'urgent') return 4;
  if (normalized === 'high') return 3;
  if (normalized === 'normal') return 2;
  return 1;
};

const getTimelineEntries = (complaint) => {
  const unified = complaint?.timeline || [];
  if (unified.length > 0) {
    return unified.map((entry) => ({
      when: entry.occurredAt,
      status: entry.status,
      comment: entry.comment,
      actor: entry.actorName,
      eventType: entry.eventType,
    }));
  }

  const statusTimeline = complaint?.statusTimeline || [];
  return statusTimeline.map((entry) => ({
    when: entry.updatedAt,
    status: entry.status,
    comment: entry.comment,
    actor: entry.updatedBy,
    eventType: 'status',
  }));
};

const RESOLVED_TIMELINE_STEPS = [
  { key: 'submitted', label: 'Complaint Submitted', matches: [] },
  { key: 'pending', label: 'Pending', matches: ['pending', 'open'] },
  { key: 'inprogress', label: 'In Progress', matches: ['inprogress'] },
  { key: 'escalated', label: 'Escalated', matches: ['escalated'] },
  { key: 'resolved', label: 'Resolved', matches: ['resolved'] },
];

const buildResolvedTimelineSteps = (complaint) => {
  const timelineEntries = getTimelineEntries(complaint);

  const latestByStatus = timelineEntries.reduce((accumulator, entry) => {
    const normalized = normalizeStatus(entry?.status || '');
    if (!normalized) {
      return accumulator;
    }

    const entryTime = new Date(entry?.when || 0).getTime();
    const hasValidTime = Number.isFinite(entryTime) && entryTime > 0;

    const existing = accumulator[normalized];
    if (!existing || (hasValidTime && entryTime > existing.timeValue)) {
      accumulator[normalized] = {
        when: entry?.when,
        timeValue: hasValidTime ? entryTime : 0,
      };
    }

    return accumulator;
  }, {});

  return RESOLVED_TIMELINE_STEPS.map((step) => {
    if (step.key === 'submitted') {
      return {
        ...step,
        timestamp: complaint?.createdAt || null,
      };
    }

    const matched = step.matches
      .map((statusKey) => latestByStatus[statusKey])
      .filter(Boolean)
      .sort((left, right) => right.timeValue - left.timeValue)[0];

    return {
      ...step,
      timestamp: matched?.when || null,
    };
  });
};

const toDateKey = (value) => {
  const date = value ? new Date(value) : new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const hoursBetween = (start, end) => {
  if (!start || !end) {
    return null;
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  return (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
};

const escapeCsv = (value) => {
  const text = `${value ?? ''}`;
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const downloadCsv = (fileName, rows) => {
  const csvContent = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const downloadExcel = (fileName, sheetName, rows) => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName);
};

const downloadPdf = (fileName, title, rows) => {
  const columnCount = rows[0]?.length || 0;
  const doc = new jsPDF({
    orientation: columnCount > 6 ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  doc.setFontSize(16);
  doc.text(title, 40, 40);
  autoTable(doc, {
    startY: 56,
    head: [rows[0]],
    body: rows.slice(1),
    styles: {
      fontSize: columnCount > 8 ? 7 : 8,
      cellPadding: 4,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { top: 56, right: 24, bottom: 24, left: 24 },
    theme: 'grid',
  });
  doc.save(fileName);
};

const exportRows = ({ fileName, sheetName, title, rows }, format) => {
  if (!rows || rows.length <= 1) {
    return false;
  }

  if (format === 'xlsx') {
    downloadExcel(fileName.replace(/\.csv$/i, '.xlsx').replace(/\.pdf$/i, '.xlsx'), sheetName, rows);
    return true;
  }

  if (format === 'pdf') {
    downloadPdf(fileName.replace(/\.csv$/i, '.pdf').replace(/\.xlsx$/i, '.pdf'), title, rows);
    return true;
  }

  downloadCsv(fileName.replace(/\.xlsx$/i, '.csv').replace(/\.pdf$/i, '.csv'), rows);
  return true;
};

const getPeriodCutoff = (period) => {
  const now = new Date();
  if (period === '7d') {
    return new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  }
  if (period === '30d') {
    return new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  }
  if (period === '90d') {
    return new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
  }
  return null;
};

const getAttendanceDuration = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) {
    return 'N/A';
  }

  const start = new Date(`1970-01-01T${checkIn}:00`).getTime();
  const end = new Date(`1970-01-01T${checkOut}:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return 'N/A';
  }

  return `${Math.round((((end - start) / (1000 * 60 * 60)) * 10)) / 10} hrs`;
};

const ADashboard = ({ onNavigateLanding }) => {
  const [activeSection, setActiveSection] = useState('home');
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [complaints, setComplaints] = useState([]);
  const [complaintsLoading, setComplaintsLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [statusDrafts, setStatusDrafts] = useState({});
  const [assigneeDrafts, setAssigneeDrafts] = useState({});
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [adminMessage, setAdminMessage] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [resolvedItemsPerPage, setResolvedItemsPerPage] = useState(10);
  const [resolvedCurrentPage, setResolvedCurrentPage] = useState(1);
  const [complaintSearch, setComplaintSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [staffForm, setStaffForm] = useState(DEFAULT_STAFF_FORM);
  const [staffFormLoading, setStaffFormLoading] = useState(false);
  const [bulkStaffActionLoading, setBulkStaffActionLoading] = useState(false);
  const [staffDrafts, setStaffDrafts] = useState({});
  const [savingUserId, setSavingUserId] = useState(null);
  const [attendanceDate, setAttendanceDate] = useState(toDateKey());
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState(() => safeJsonParse(localStorage.getItem(ADMIN_ATTENDANCE_KEY), {}));
  const [settings, setSettings] = useState(() => ({
    ...DEFAULT_SETTINGS,
    ...safeJsonParse(localStorage.getItem(ADMIN_SETTINGS_KEY), {}),
  }));
  const [notificationState, setNotificationState] = useState(() => safeJsonParse(localStorage.getItem(ADMIN_NOTIFICATION_KEY), {}));
  const [reportPeriod, setReportPeriod] = useState('30d');
  const [sectionExportFormat, setSectionExportFormat] = useState('csv');
  const [uiPreferences, setUiPreferences] = useState(() => getUiPreferences());

  useEffect(() => {
    localStorage.setItem(ADMIN_SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(ADMIN_ATTENDANCE_KEY, JSON.stringify(attendanceRecords));
  }, [attendanceRecords]);

  useEffect(() => {
    localStorage.setItem(ADMIN_NOTIFICATION_KEY, JSON.stringify(notificationState));
  }, [notificationState]);

  useEffect(() => {
    updateUiPreferences(uiPreferences);
  }, [uiPreferences]);

  useEffect(() => {
    setCurrentPage(1);
  }, [complaintSearch, statusFilter, categoryFilter, priorityFilter, itemsPerPage]);

  useEffect(() => {
    setResolvedCurrentPage(1);
  }, [resolvedItemsPerPage, complaints]);

  const fetchComplaints = useCallback(async () => {
    setComplaintsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/complaints/all`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();
      setComplaints(data || []);
    } catch (error) {
      setAdminMessage(`Unable to fetch complaints: ${error.message || 'Unknown error'}`);
    } finally {
      setComplaintsLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await getAdminUsers();
      setUsers(data || []);
    } catch (error) {
      setAdminMessage(`Unable to fetch users: ${error.message || 'Unknown error'}`);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadDashboardData = useCallback(async () => {
    await Promise.all([fetchComplaints(), fetchUsers()]);
  }, [fetchComplaints, fetchUsers]);

  useEffect(() => {
    const currentUser = getCurrentUser();
    if (!currentUser || currentUser.role !== 'ADMIN') {
      onNavigateLanding();
      return;
    }

    setUser(currentUser);
    void loadDashboardData();
  }, [loadDashboardData, onNavigateLanding]);

  const handleLogout = () => {
    logout();
    onNavigateLanding();
  };

  const handleRefresh = () => {
    setRefreshing(true);
    setAdminMessage('');
    loadDashboardData().finally(() => {
      setTimeout(() => setRefreshing(false), 500);
    });
  };

  const updateComplaintStatus = async (complaintId, options = {}) => {
    const targetComplaint = complaints.find((item) => item.id === complaintId);
    if (!targetComplaint) {
      setAdminMessage('Unable to find complaint for update.');
      return;
    }

    const nextStatus = options.assignmentOnly
      ? (targetComplaint.status || 'open')
      : (statusDrafts[complaintId] || targetComplaint.status || 'open');
    const adminReview = reviewDrafts[complaintId] ?? targetComplaint.adminReview ?? '';
    const assignedStaffIdRaw = assigneeDrafts[complaintId];
    const assignedStaffId = assignedStaffIdRaw ? Number(assignedStaffIdRaw) : null;

    if (options.assignmentOnly && !assignedStaffId) {
      setAdminMessage('Please select a staff member before assigning.');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/complaints/${complaintId}/status`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: nextStatus, adminReview, assignedStaffId }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const updated = await response.json();
      setComplaints((prev) => prev.map((item) => (item.id === complaintId ? updated : item)));
      if (options.assignmentOnly) {
        setAdminMessage(
          `Complaint ${updated.complaintCode || updated.id} assigned to ${updated.assignedStaffName || 'selected staff'}.`
        );
      } else {
        setAdminMessage(`Complaint ${updated.complaintCode || updated.id} updated.`);
      }
    } catch (error) {
      setAdminMessage(`Update failed: ${error.message || 'Unknown error'}`);
    }
  };

  const handleStaffFormChange = (event) => {
    const { name, value, type, checked } = event.target;
    const nextValue = type === 'checkbox' ? checked : value;

    setStaffForm((prev) => {
      const next = {
        ...prev,
        [name]: nextValue,
      };

      if (name === 'role' && value !== 'STAFF') {
        next.rank = 'Handler';
        next.specializationCategory = '';
      }

      if (name === 'rank' && value !== 'Senior Handler') {
        next.specializationCategory = '';
      }

      return next;
    });
  };

  const handleCreateStaff = async (event) => {
    event.preventDefault();
    setStaffFormLoading(true);
    setAdminMessage('');

    try {
      const createdUser = await createAdminUser(staffForm);
      setUsers((prev) => [createdUser, ...prev]);
      setStaffForm(DEFAULT_STAFF_FORM);
      setAdminMessage(`User ${createdUser.name} created successfully.`);
    } catch (error) {
      setAdminMessage(`Unable to create user: ${error.message || 'Unknown error'}`);
    } finally {
      setStaffFormLoading(false);
    }
  };

  const handleAddSampleStaffAndAssign = async () => {
    setBulkStaffActionLoading(true);
    setAdminMessage('');

    try {
      const result = await addSampleStaffAndAssignComplaints();
      await loadDashboardData();
      setAdminMessage(
        `Added ${result.createdStaffCount || 0} staff, ${result.createdSeniorHandlerCount || 0} senior handlers, and assigned ${result.assignedComplaintCount || 0} complaints.`
      );
    } catch (error) {
      setAdminMessage(`Bulk action failed: ${error.message || 'Unknown error'}`);
    } finally {
      setBulkStaffActionLoading(false);
    }
  };

  const getUserDraft = (targetUser) => {
    return staffDrafts[targetUser.id] || {
      name: targetUser.name,
      email: targetUser.email,
      role: targetUser.role,
      rank: targetUser.rank || 'Handler',
      specializationCategory: targetUser.specializationCategory || '',
      isActive: targetUser.isActive,
      password: '',
    };
  };

  const updateUserDraft = (userId, field, value) => {
    const targetUser = users.find((item) => item.id === userId);
    const currentDraft = targetUser ? getUserDraft(targetUser) : {};

    const nextDraft = {
      ...currentDraft,
      [field]: value,
    };

    if (field === 'role' && value !== 'STAFF') {
      nextDraft.rank = 'Handler';
      nextDraft.specializationCategory = '';
    }

    if (field === 'rank' && `${value}`.toLowerCase() !== 'senior handler') {
      nextDraft.specializationCategory = '';
    }

    setStaffDrafts((prev) => ({
      ...prev,
      [userId]: nextDraft,
    }));
  };

  const handleSaveUser = async (targetUser) => {
    const draft = getUserDraft(targetUser);
    setSavingUserId(targetUser.id);
    setAdminMessage('');

    try {
      const updatedUser = await updateAdminUser(targetUser.id, draft);
      setUsers((prev) => prev.map((item) => (item.id === targetUser.id ? updatedUser : item)));
      setStaffDrafts((prev) => {
        const next = { ...prev };
        delete next[targetUser.id];
        return next;
      });
      setAdminMessage(`User ${updatedUser.name} updated successfully.`);
    } catch (error) {
      setAdminMessage(`Unable to update user: ${error.message || 'Unknown error'}`);
    } finally {
      setSavingUserId(null);
    }
  };

  const updateAttendanceRecord = (userId, field, value) => {
    setAttendanceRecords((prev) => ({
      ...prev,
      [attendanceDate]: {
        ...(prev[attendanceDate] || {}),
        [userId]: {
          ...(prev[attendanceDate]?.[userId] || {}),
          [field]: value,
        },
      },
    }));
  };

  const handleSaveAttendanceMarks = async () => {
    const staffMembers = workerPerformance.filter((worker) => worker.role === 'STAFF');
    if (staffMembers.length === 0) {
      setAdminMessage('No STAFF accounts available to mark attendance.');
      return;
    }

    setAttendanceSaving(true);
    setAdminMessage('');

    try {
      await Promise.all(
        staffMembers.map((worker) => {
          const record = attendanceForDate[worker.id] || {};
          const status = record.status || (worker.isActive ? 'present' : 'absent');

          return markStaffAttendance({
            staffUserId: worker.id,
            attendanceDate,
            status,
            checkInTime: record.checkIn || null,
            checkOutTime: record.checkOut || null,
            notes: record.notes || '',
          });
        })
      );

      setAdminMessage(`Attendance marked for ${staffMembers.length} staff members on ${attendanceDate}.`);
    } catch (error) {
      setAdminMessage(`Attendance mark failed: ${error.message || 'Unknown error'}`);
    } finally {
      setAttendanceSaving(false);
    }
  };

  const updateSettingsField = (event) => {
    const { name, value, type, checked } = event.target;
    setSettings((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : Number(value),
    }));
  };

  const dismissNotification = (notificationId) => {
    setNotificationState((prev) => ({
      ...prev,
      [notificationId]: true,
    }));
  };

  const restoreNotifications = () => {
    setNotificationState({});
  };

  const handleThemeChange = (value) => {
    setUiPreferences((prev) => ({ ...prev, theme: value }));
  };

  const toggleTheme = () => {
    handleThemeChange(uiPreferences.theme === 'dark' ? 'light' : 'dark');
  };

  const sortedComplaints = useMemo(() => {
    return [...complaints].sort((a, b) => {
      const priorityDiff = priorityRank(b.urgency) - priorityRank(a.urgency);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }, [complaints]);

  const activeComplaints = useMemo(() => {
    return sortedComplaints.filter((item) => normalizeStatus(item.status) !== 'resolved');
  }, [sortedComplaints]);

  const resolvedComplaints = useMemo(() => {
    return sortedComplaints.filter((item) => normalizeStatus(item.status) === 'resolved');
  }, [sortedComplaints]);

  const filteredComplaints = useMemo(() => {
    return activeComplaints.filter((complaint) => {
      const normalizedStatus = normalizeStatus(complaint.status);
      const normalizedCategory = normalizeComplaintCategory(complaint.category);
      const normalizedPriority = (complaint.urgency || 'normal').toLowerCase();
      const searchSource = [
        complaint.complaintCode,
        complaint.userName,
        complaint.userEmail,
        complaint.description,
        getComplaintCategoryLabel(complaint.category),
      ].join(' ').toLowerCase();

      const matchesSearch = !complaintSearch.trim() || searchSource.includes(complaintSearch.trim().toLowerCase());
      const matchesStatus = statusFilter === 'all' || normalizedStatus === statusFilter;
      const matchesCategory = categoryFilter === 'all' || normalizedCategory === categoryFilter;
      const matchesPriority = priorityFilter === 'all' || normalizedPriority === priorityFilter;

      return matchesSearch && matchesStatus && matchesCategory && matchesPriority;
    });
  }, [activeComplaints, complaintSearch, statusFilter, categoryFilter, priorityFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredComplaints.length / itemsPerPage));
  const paginatedComplaints = filteredComplaints.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const resolvedTotalPages = Math.max(1, Math.ceil(resolvedComplaints.length / resolvedItemsPerPage));
  const paginatedResolvedComplaints = resolvedComplaints.slice(
    (resolvedCurrentPage - 1) * resolvedItemsPerPage,
    resolvedCurrentPage * resolvedItemsPerPage
  );
  const assignSectionComplaints = useMemo(() => {
    return activeComplaints;
  }, [activeComplaints]);

  const complaintStats = useMemo(() => {
    const resolved = sortedComplaints.filter((item) => normalizeStatus(item.status) === 'resolved');
    const inProgress = sortedComplaints.filter((item) => normalizeStatus(item.status) === 'inprogress');
    const pending = sortedComplaints.filter((item) => ['pending', 'open'].includes(normalizeStatus(item.status)));
    const urgentPending = sortedComplaints.filter((item) => normalizeStatus(item.status) !== 'resolved' && (item.urgency || '').toLowerCase() === 'urgent');
    const resolvedToday = resolved.filter((item) => toDateKey(item.resolvedAt) === toDateKey());
    const resolutionHours = resolved
      .map((item) => hoursBetween(item.createdAt, item.resolvedAt))
      .filter((value) => value !== null);

    return {
      totalComplaints: sortedComplaints.length,
      completedToday: resolvedToday.length,
      inProgressToday: inProgress.length,
      pendingToday: pending.length,
      urgentPending: urgentPending.length,
      resolvedRate: sortedComplaints.length ? Math.round((resolved.length / sortedComplaints.length) * 100) : 0,
      averageTime: resolutionHours.length
        ? `${(resolutionHours.reduce((sum, value) => sum + value, 0) / resolutionHours.length).toFixed(1)} hrs`
        : 'N/A',
    };
  }, [sortedComplaints]);

  const categoryData = useMemo(() => {
    const counts = sortedComplaints.reduce((accumulator, complaint) => {
      const key = normalizeComplaintCategory(complaint.category);
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});

    const colors = ['#00e38c', '#0096ff', '#ffa502', '#ff6b9d', '#c344d9', '#f97316'];

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], index) => ({
        name,
        count,
        color: colors[index % colors.length],
      }));
  }, [sortedComplaints]);

  const staffUsers = useMemo(() => {
    return users.filter((item) => ['ADMIN', 'STAFF'].includes((item.role || '').toUpperCase()));
  }, [users]);

  const assignableHandlers = useMemo(() => {
    return staffUsers.filter((member) => member.isActive);
  }, [staffUsers]);

  const getAssignableHandlersForComplaint = useCallback((complaint) => {
    const complaintStatus = normalizeStatus(complaint?.status);
    const categoryMatched = assignableHandlers.filter((member) => canHandleCategory(member, complaint));

    if (complaintStatus === 'escalated') {
      const seniorCategoryMatched = categoryMatched.filter((member) => isSeniorHandler(member));
      if (seniorCategoryMatched.length > 0) {
        return seniorCategoryMatched;
      }
    }

    return categoryMatched;
  }, [assignableHandlers]);

  const workerPerformance = useMemo(() => {
    const actorMap = {};

    sortedComplaints.forEach((complaint) => {
      getTimelineEntries(complaint).forEach((entry) => {
        if (!entry.actor) {
          return;
        }

        if (!actorMap[entry.actor]) {
          actorMap[entry.actor] = {
            handledComplaints: new Set(),
            resolvedComplaints: new Set(),
            lastActionAt: null,
          };
        }

        actorMap[entry.actor].handledComplaints.add(complaint.id);
        if (normalizeStatus(entry.status) === 'resolved') {
          actorMap[entry.actor].resolvedComplaints.add(complaint.id);
        }
        if (!actorMap[entry.actor].lastActionAt || new Date(entry.when) > new Date(actorMap[entry.actor].lastActionAt)) {
          actorMap[entry.actor].lastActionAt = entry.when;
        }
      });
    });

    return staffUsers.map((staffUser) => {
      const metrics = actorMap[staffUser.name] || {
        handledComplaints: new Set(),
        resolvedComplaints: new Set(),
        lastActionAt: null,
      };
      const assignedCount = sortedComplaints.filter((complaint) => {
        if (complaint.assignedStaffId) {
          return Number(complaint.assignedStaffId) === Number(staffUser.id);
        }
        return (complaint.assignedStaffName || '').trim().toLowerCase() === (staffUser.name || '').trim().toLowerCase();
      }).length;
      const handledCount = metrics.handledComplaints.size;
      const resolvedCount = metrics.resolvedComplaints.size;
      const utilization = settings.maxComplaintsPerWorker
        ? Math.min(100, Math.round((handledCount / settings.maxComplaintsPerWorker) * 100))
        : 0;

      return {
        ...staffUser,
        status: staffUser.isActive ? 'active' : 'inactive',
        assigned: assignedCount,
        complaints: handledCount,
        completed: resolvedCount,
        utilization,
        lastActionAt: metrics.lastActionAt,
      };
    });
  }, [staffUsers, sortedComplaints, settings.maxComplaintsPerWorker]);

  const attendanceForDate = useMemo(() => {
    return attendanceRecords[attendanceDate] || {};
  }, [attendanceDate, attendanceRecords]);
  const attendanceSummary = useMemo(() => {
    return workerPerformance.reduce((accumulator, worker) => {
      const record = attendanceForDate[worker.id] || {};
      const status = record.status || (worker.isActive ? 'present' : 'absent');

      if (status === 'present') accumulator.present += 1;
      if (status === 'absent') accumulator.absent += 1;
      if (status === 'on_leave') accumulator.onLeave += 1;
      accumulator.total += 1;

      return accumulator;
    }, { present: 0, absent: 0, onLeave: 0, total: 0 });
  }, [attendanceForDate, workerPerformance]);

  const overdueComplaints = useMemo(() => {
    const thresholdHours = Number(settings.resolutionTargetHours) || DEFAULT_SETTINGS.resolutionTargetHours;
    const now = Date.now();
    return sortedComplaints.filter((complaint) => {
      if (normalizeStatus(complaint.status) === 'resolved') {
        return false;
      }
      const createdAt = new Date(complaint.createdAt).getTime();
      if (Number.isNaN(createdAt)) {
        return false;
      }
      const ageHours = (now - createdAt) / (1000 * 60 * 60);
      return ageHours >= thresholdHours;
    });
  }, [sortedComplaints, settings.resolutionTargetHours]);

  const notifications = useMemo(() => {
    const items = [];

    if (complaintStats.urgentPending > 0) {
      items.push({
        id: 'urgent-pending',
        message: `${complaintStats.urgentPending} urgent complaints need attention.`,
        level: 'warning',
        icon: FiAlertCircle,
      });
    }

    if (overdueComplaints.length > 0) {
      items.push({
        id: 'overdue-complaints',
        message: `${overdueComplaints.length} complaints have crossed the ${settings.resolutionTargetHours}-hour target.`,
        level: 'warning',
        icon: FiClock,
      });
    }

    const overloadedWorkers = workerPerformance.filter((worker) => worker.utilization >= 100);
    if (overloadedWorkers.length > 0) {
      items.push({
        id: 'overloaded-workers',
        message: `${overloadedWorkers.length} staff members are at or above the complaint load limit.`,
        level: 'info',
        icon: FiUsers,
      });
    }

    items.push({
      id: 'resolved-rate',
      message: `Resolution rate is currently ${complaintStats.resolvedRate}%.`,
      level: complaintStats.resolvedRate >= 70 ? 'success' : 'info',
      icon: FiCheckCircle,
    });

    return items;
  }, [complaintStats, overdueComplaints.length, settings.resolutionTargetHours, workerPerformance]);

  const visibleNotifications = notifications.filter((item) => !notificationState[item.id]);

  const reportComplaints = useMemo(() => {
    const cutoff = getPeriodCutoff(reportPeriod);
    if (!cutoff) {
      return sortedComplaints;
    }

    return sortedComplaints.filter((complaint) => {
      const createdAt = new Date(complaint.createdAt);
      return !Number.isNaN(createdAt.getTime()) && createdAt >= cutoff;
    });
  }, [reportPeriod, sortedComplaints]);

  const analyticsPriorityData = useMemo(() => {
    const counts = reportComplaints.reduce((accumulator, complaint) => {
      const key = (complaint.urgency || 'normal').toLowerCase();
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});

    return ['urgent', 'high', 'normal', 'low'].map((label) => ({
      label,
      count: counts[label] || 0,
    }));
  }, [reportComplaints]);

  const analyticsStatusData = useMemo(() => {
    const counts = reportComplaints.reduce((accumulator, complaint) => {
      const key = normalizeStatus(complaint.status);
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});

    return ['open', 'pending', 'inprogress', 'escalated', 'resolved'].map((label) => ({
      label,
      count: counts[label] || 0,
    }));
  }, [reportComplaints]);

  const exportComplaintReport = useCallback((format = 'csv', dataset = filteredComplaints, exportTitle = 'Active Complaints', filePrefix = 'admin-complaints') => {
    const rows = [
      ['Complaint Code', 'User', 'Email', 'Category', 'Priority', 'Status', 'Assignee', 'Created At', 'Resolved At', 'Admin Review'],
      ...dataset.map((complaint) => [
        complaint.complaintCode || `#${complaint.id}`,
        complaint.userName || 'Anonymous',
        complaint.userEmail || 'N/A',
        getComplaintCategoryLabel(complaint.category),
        (complaint.urgency || 'normal').toUpperCase(),
        getStatusLabel(complaint.status),
        complaint.assignedStaffName || 'Unassigned',
        formatDateTime(complaint.createdAt),
        formatDateTime(complaint.resolvedAt),
        complaint.adminReview || '',
      ]),
    ];

    return exportRows({
      fileName: `${filePrefix}-${toDateKey()}.${format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : 'csv'}`,
      sheetName: 'Complaints',
      title: exportTitle,
      rows,
    }, format);
  }, [filteredComplaints]);

  const exportStaffReport = useCallback((format = 'csv') => {
    const rows = [
      ['Name', 'Email', 'Role', 'Rank', 'Active', 'Handled Complaints', 'Resolved Complaints', 'Assigned Complaints', 'Utilization %', 'Last Action'],
      ...workerPerformance.map((worker) => [
        worker.name,
        worker.email,
        worker.role,
        worker.rank || '-',
        worker.isActive ? 'Yes' : 'No',
        worker.complaints,
        worker.completed,
        worker.assigned,
        worker.utilization,
        formatDateTime(worker.lastActionAt),
      ]),
    ];

    return exportRows({
      fileName: `admin-staff-${toDateKey()}.${format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : 'csv'}`,
      sheetName: 'Staff',
      title: 'Staff Management',
      rows,
    }, format);
  }, [workerPerformance]);

  const exportAttendanceReport = useCallback((format = 'csv') => {
    const rows = [
      ['Date', 'Staff', 'Email', 'Role', 'Status', 'Check-in', 'Check-out', 'Duration'],
      ...workerPerformance.map((worker) => {
        const record = attendanceForDate[worker.id] || {};
        const status = record.status || (worker.isActive ? 'present' : 'absent');
        return [
          attendanceDate,
          worker.name,
          worker.email,
          worker.role,
          getStatusLabel(status),
          record.checkIn || '-',
          record.checkOut || '-',
          getAttendanceDuration(record.checkIn, record.checkOut),
        ];
      }),
    ];

    return exportRows({
      fileName: `admin-attendance-${attendanceDate}.${format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : 'csv'}`,
      sheetName: 'Attendance',
      title: `Attendance Snapshot ${attendanceDate}`,
      rows,
    }, format);
  }, [attendanceDate, attendanceForDate, workerPerformance]);

  const exportSummaryReport = useCallback((format = 'csv', exportTitle = 'Admin Summary', filePrefix = 'admin-summary') => {
    const rows = [
      ['Area', 'Metric', 'Value'],
      ['Complaints', 'Total Complaints', complaintStats.totalComplaints],
      ['Complaints', 'Completed Today', complaintStats.completedToday],
      ['Complaints', 'In Progress', complaintStats.inProgressToday],
      ['Complaints', 'Open or Pending', complaintStats.pendingToday],
      ['Complaints', 'Urgent Pending', complaintStats.urgentPending],
      ['Complaints', 'Resolution Rate', `${complaintStats.resolvedRate}%`],
      ['Complaints', 'Average Resolution Time', complaintStats.averageTime],
      ['Attendance', 'Present', attendanceSummary.present],
      ['Attendance', 'Absent', attendanceSummary.absent],
      ['Attendance', 'On Leave', attendanceSummary.onLeave],
      ['Attendance', 'Total Staff', attendanceSummary.total],
      ['Reports', 'Complaints In Scope', reportComplaints.length],
      ['Reports', 'Tracked Staff', workerPerformance.length],
      ['Settings', 'Max Complaints Per Worker', settings.maxComplaintsPerWorker],
      ['Settings', 'Resolution Target Hours', settings.resolutionTargetHours],
      ['Settings', 'Two Factor Enabled', settings.enableTwoFactor ? 'Yes' : 'No'],
      ['Settings', 'Audit Log Enabled', settings.enableAuditLog ? 'Yes' : 'No'],
      ['Settings', 'Email Notifications', settings.emailNotifications ? 'Yes' : 'No'],
      ['Settings', 'SMS Critical Alerts', settings.smsCriticalAlerts ? 'Yes' : 'No'],
    ];

    return exportRows({
      fileName: `${filePrefix}-${toDateKey()}.${format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : 'csv'}`,
      sheetName: 'Summary',
      title: exportTitle,
      rows,
    }, format);
  }, [attendanceSummary, complaintStats, reportComplaints.length, settings, workerPerformance.length]);

  const exportResolvedComplaintReport = useCallback((format = 'csv') => {
    return exportComplaintReport(format, resolvedComplaints, 'Resolved Complaints', 'admin-resolved-complaints');
  }, [exportComplaintReport, resolvedComplaints]);

  const exportAssignmentReport = useCallback((format = 'csv') => {
    const rows = [
      ['Complaint Code', 'User', 'Category', 'Priority', 'Status', 'Current Assignee', 'Eligible Handler Count', 'Created At'],
      ...assignSectionComplaints.map((complaint) => [
        complaint.complaintCode || `#${complaint.id}`,
        complaint.userName || 'Anonymous',
        getComplaintCategoryLabel(complaint.category),
        (complaint.urgency || 'normal').toUpperCase(),
        getStatusLabel(complaint.status),
        complaint.assignedStaffName || 'Unassigned',
        getAssignableHandlersForComplaint(complaint).length,
        formatDateTime(complaint.createdAt),
      ]),
    ];

    return exportRows({
      fileName: `admin-assignments-${toDateKey()}.${format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : 'csv'}`,
      sheetName: 'Assignments',
      title: 'Complaint Assignments',
      rows,
    }, format);
  }, [assignSectionComplaints, getAssignableHandlersForComplaint]);

  const exportAnalyticsReport = useCallback((format = 'csv') => {
    const total = reportComplaints.length || 1;
    const rows = [
      ['Group', 'Label', 'Count', 'Share'],
      ...categoryData.map((item) => ['Category', getStatusLabel(item.name), item.count, `${Math.round((item.count / total) * 100)}%`]),
      ...analyticsPriorityData.map((item) => ['Priority', getStatusLabel(item.label), item.count, `${Math.round((item.count / total) * 100)}%`]),
      ...analyticsStatusData.map((item) => ['Status', getStatusLabel(item.label), item.count, `${Math.round((item.count / total) * 100)}%`]),
    ];

    return exportRows({
      fileName: `admin-analytics-${toDateKey()}.${format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : 'csv'}`,
      sheetName: 'Analytics',
      title: 'Advanced Analytics',
      rows,
    }, format);
  }, [analyticsPriorityData, analyticsStatusData, categoryData, reportComplaints.length]);

  const exportNotificationsReport = useCallback((format = 'csv') => {
    const rows = [
      ['Alert Id', 'Level', 'Message', 'Dismissed'],
      ...notifications.map((item) => [item.id, item.level, item.message, notificationState[item.id] ? 'Yes' : 'No']),
    ];

    return exportRows({
      fileName: `admin-alerts-${toDateKey()}.${format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : 'csv'}`,
      sheetName: 'Alerts',
      title: 'System Alerts',
      rows,
    }, format);
  }, [notificationState, notifications]);

  const exportSettingsReport = useCallback((format = 'csv') => {
    const rows = [
      ['Setting', 'Value'],
      ['Max Complaints Per Worker', settings.maxComplaintsPerWorker],
      ['Resolution Target Hours', settings.resolutionTargetHours],
      ['Two Factor Enabled', settings.enableTwoFactor ? 'Yes' : 'No'],
      ['Audit Log Enabled', settings.enableAuditLog ? 'Yes' : 'No'],
      ['Email Notifications', settings.emailNotifications ? 'Yes' : 'No'],
      ['SMS Critical Alerts', settings.smsCriticalAlerts ? 'Yes' : 'No'],
    ];

    return exportRows({
      fileName: `admin-settings-${toDateKey()}.${format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : 'csv'}`,
      sheetName: 'Settings',
      title: 'Admin Settings',
      rows,
    }, format);
  }, [settings]);

  const exportCurrentSection = useCallback(() => {
    const handlers = {
      home: () => exportSummaryReport(sectionExportFormat, 'Dashboard Overview', 'admin-dashboard-overview'),
      complaints: () => exportComplaintReport(sectionExportFormat),
      resolved: () => exportResolvedComplaintReport(sectionExportFormat),
      assign: () => exportAssignmentReport(sectionExportFormat),
      workers: () => exportStaffReport(sectionExportFormat),
      attendance: () => exportAttendanceReport(sectionExportFormat),
      reports: () => exportSummaryReport(sectionExportFormat),
      analytics: () => exportAnalyticsReport(sectionExportFormat),
      notifications: () => exportNotificationsReport(sectionExportFormat),
      settings: () => exportSettingsReport(sectionExportFormat),
    };

    const sectionTitles = {
      home: 'dashboard overview',
      complaints: 'complaints',
      resolved: 'resolved complaints',
      assign: 'assignments',
      workers: 'staff data',
      attendance: 'attendance data',
      reports: 'summary report',
      analytics: 'analytics',
      notifications: 'system alerts',
      settings: 'settings',
    };

    const exportHandler = handlers[activeSection];
    if (!exportHandler) {
      setAdminMessage('This section does not have exportable data.');
      return;
    }

    const exported = exportHandler();
    setAdminMessage(
      exported
        ? `Exported ${sectionTitles[activeSection]} as ${sectionExportFormat.toUpperCase()}.`
        : 'No rows are available to export for this section.'
    );
  }, [
    activeSection,
    exportAnalyticsReport,
    exportAssignmentReport,
    exportAttendanceReport,
    exportComplaintReport,
    exportNotificationsReport,
    exportResolvedComplaintReport,
    exportSettingsReport,
    exportStaffReport,
    exportSummaryReport,
    sectionExportFormat,
  ]);

  const menuItems = [
    { id: 'home', label: 'Dashboard', icon: FiHome },
    { id: 'complaints', label: 'Manage Complaints', icon: FiFileText },
    { id: 'resolved', label: 'Resolved Complaints', icon: FiCheckCircle },
    { id: 'assign', label: 'Assign Complaints', icon: FiCheckCircle },
    { id: 'workers', label: 'Staff Management', icon: FiUsers },
    { id: 'attendance', label: 'Attendance & Leaves', icon: FiCalendar },
    { id: 'reports', label: 'Reports', icon: FiBarChart2 },
    { id: 'analytics', label: 'Analytics', icon: FiTrendingUp },
    { id: 'notifications', label: 'System Alerts', icon: FiBell },
    { id: 'settings', label: 'Settings', icon: FiSettings },
  ];

  return (
    <div className={`admin-dashboard theme-${uiPreferences.theme}`}>
      {sidebarOpen && (
        <div
          className="admin-sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="admin-sidebar-header">
          <h2 className="admin-sidebar-brand">ResolveIT Admin</h2>
          <button
            className="admin-sidebar-toggle admin-sidebar-close"
            onClick={() => setSidebarOpen(false)}
          >
            <FiX size={24} />
          </button>
        </div>

        <nav className="admin-sidebar-menu">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`admin-menu-item ${activeSection === item.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveSection(item.id);
                  if (window.innerWidth < 768) {
                    setSidebarOpen(false);
                  }
                }}
              >
                <Icon className="admin-menu-icon" size={20} />
                <span className="admin-menu-label">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-user-card">
            <div className="admin-user-avatar">A</div>
            <div className="admin-user-details">
              <p className="admin-user-name">{user?.name}</p>
              <p className="admin-user-role">Administrator</p>
            </div>
          </div>
          <button className="admin-logout-btn" onClick={handleLogout}>
            <FiLogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      <main className={`admin-main-content ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        <div className="admin-top-bar">
          <button
            className="admin-menu-toggle"
            onClick={() => setSidebarOpen(true)}
          >
            <FiMenu size={24} />
          </button>
          <h1 className="admin-page-title">Admin Dashboard</h1>
          <div className="admin-top-bar-right">
            <div className="admin-top-export-controls">
              <select
                className="date-input admin-export-format-select"
                value={sectionExportFormat}
                onChange={(event) => setSectionExportFormat(event.target.value)}
              >
                {EXPORT_FORMAT_OPTIONS.map((option) => (
                  <option key={`top-export-${option.value}`} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button className="export-btn" onClick={exportCurrentSection}>
                <FiDownload size={18} /> Export Current Section
              </button>
            </div>
            <button
              className="admin-refresh-btn"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <FiRefreshCw size={20} className={refreshing ? 'spinning' : ''} />
            </button>
            <button
              className="admin-theme-icon-btn"
              type="button"
              onClick={toggleTheme}
              aria-label={uiPreferences.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={uiPreferences.theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {uiPreferences.theme === 'dark' ? <FiSun size={18} /> : <FiMoon size={18} />}
            </button>
            <span className="admin-user-email">{user?.email}</span>
          </div>
        </div>

        <div className="admin-page-content">
          {adminMessage && <p className="admin-panel-message">{adminMessage}</p>}

          {activeSection === 'home' && (
            <div className="admin-section home-section">
              <div className="admin-header">
                <h1>Welcome Back, {user?.name}!</h1>
                <p>System Status: <span className="status-badge active">Live Data Connected</span></p>
              </div>

              <div className="admin-alerts">
                <div className="admin-section-header compact">
                  <h3>System Alerts</h3>
                  <button className="filter-btn" onClick={() => setActiveSection('notifications')}>Open Alerts</button>
                </div>
                <div className="alerts-list">
                  {visibleNotifications.length === 0 && (
                    <div className="alert-item success">
                      <FiCheckCircle size={20} />
                      <span>No active system alerts right now.</span>
                    </div>
                  )}
                  {visibleNotifications.slice(0, 3).map((alert) => {
                    const AlertIcon = alert.icon;
                    return (
                      <div key={alert.id} className={`alert-item ${alert.level}`}>
                        <AlertIcon size={20} />
                        <span>{alert.message}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="admin-metrics-grid">
                <div className="admin-metric-card primary">
                  <div className="metric-header">
                    <FiFileText size={24} />
                    <span className="metric-title">Total Complaints</span>
                  </div>
                  <p className="metric-value">{complaintStats.totalComplaints}</p>
                  <p className="metric-change">Filtered queue ready for action</p>
                </div>

                <div className="admin-metric-card success">
                  <div className="metric-header">
                    <FiCheckCircle size={24} />
                    <span className="metric-title">Completed Today</span>
                  </div>
                  <p className="metric-value">{complaintStats.completedToday}</p>
                  <p className="metric-change">Resolution Rate: {complaintStats.resolvedRate}%</p>
                </div>

                <div className="admin-metric-card warning">
                  <div className="metric-header">
                    <FiClock size={24} />
                    <span className="metric-title">In Progress</span>
                  </div>
                  <p className="metric-value">{complaintStats.inProgressToday}</p>
                  <p className="metric-change">Avg Time: {complaintStats.averageTime}</p>
                </div>

                <div className="admin-metric-card danger">
                  <div className="metric-header">
                    <FiAlertCircle size={24} />
                    <span className="metric-title">Open or Pending</span>
                  </div>
                  <p className="metric-value">{complaintStats.pendingToday}</p>
                  <p className="metric-change">Urgent unresolved: {complaintStats.urgentPending}</p>
                </div>

                <div className="admin-metric-card info">
                  <div className="metric-header">
                    <FiUsers size={24} />
                    <span className="metric-title">Staff Present</span>
                  </div>
                  <p className="metric-value">{attendanceSummary.present}/{attendanceSummary.total}</p>
                  <p className="metric-change">On Leave: {attendanceSummary.onLeave}</p>
                </div>

                <div className="admin-metric-card secondary">
                  <div className="metric-header">
                    <FiTrendingUp size={24} />
                    <span className="metric-title">Active Staff Accounts</span>
                  </div>
                  <p className="metric-value">{workerPerformance.filter((item) => item.isActive).length}</p>
                  <p className="metric-change">Tracked staff: {workerPerformance.length}</p>
                </div>
              </div>

              <div className="admin-category-section">
                <h3>Complaints by Category</h3>
                <div className="category-grid">
                  {categoryData.length === 0 && (
                    <div className="category-card">
                      <div className="category-info">
                        <p className="category-name">No complaint categories yet</p>
                        <p className="category-value">Data appears here after submissions</p>
                      </div>
                    </div>
                  )}
                  {categoryData.map((category, index) => (
                    <div key={`${category.name}-${index}`} className="category-card">
                      <div className="category-color" style={{ background: category.color }} />
                      <div className="category-info">
                        <p className="category-name">{getStatusLabel(category.name)}</p>
                        <p className="category-value">{category.count} complaints</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="admin-quick-actions">
                <h3>Quick Actions</h3>
                <div className="action-buttons">
                  <button className="action-btn primary" onClick={() => setActiveSection('complaints')}>
                    <FiFileText size={18} />
                    View All Complaints
                  </button>
                  <button className="action-btn secondary" onClick={() => setActiveSection('workers')}>
                    <FiUsers size={18} />
                    Manage Staff
                  </button>
                  <button className="action-btn secondary" onClick={() => setActiveSection('reports')}>
                    <FiBarChart2 size={18} />
                    Export Reports
                  </button>
                  <button className="action-btn secondary" onClick={() => setActiveSection('settings')}>
                    <FiSettings size={18} />
                    Update Settings
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'complaints' && (
            <div className="admin-section">
              <div className="admin-section-header">
                <h1>Manage Complaints</h1>
                <div className="filter-actions">
                  <select className="date-input" value={itemsPerPage} onChange={(event) => setItemsPerPage(Number(event.target.value))}>
                    <option value={5}>5 / page</option>
                    <option value={10}>10 / page</option>
                    <option value={20}>20 / page</option>
                    <option value={50}>50 / page</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Search complaints, users or categories"
                    className="search-input"
                    value={complaintSearch}
                    onChange={(event) => setComplaintSearch(event.target.value)}
                  />
                  <select className="date-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">All Statuses</option>
                    <option value="open">Open</option>
                    <option value="pending">Pending</option>
                    <option value="inprogress">In Progress</option>
                    <option value="escalated">Escalated</option>
                  </select>
                  <select className="date-input" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                    <option value="all">All Categories</option>
                    {categoryData.map((category) => (
                      <option key={category.name} value={category.name.toLowerCase()}>{getStatusLabel(category.name)}</option>
                    ))}
                  </select>
                  <select className="date-input" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                    <option value="all">All Priorities</option>
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                  <button
                    className="filter-btn"
                    onClick={() => {
                      setComplaintSearch('');
                      setStatusFilter('all');
                      setCategoryFilter('all');
                      setPriorityFilter('all');
                    }}
                  >
                    <FiFilter size={18} />
                    Clear
                  </button>
                  <select className="date-input admin-export-format-select" value={sectionExportFormat} onChange={(event) => setSectionExportFormat(event.target.value)}>
                    {EXPORT_FORMAT_OPTIONS.map((option) => (
                      <option key={`complaint-export-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button className="export-btn" onClick={() => exportComplaintReport(sectionExportFormat)}>
                    <FiDownload size={18} />
                    Export {sectionExportFormat.toUpperCase()}
                  </button>
                </div>
              </div>

              <p className="admin-user-email">Showing {paginatedComplaints.length} of {filteredComplaints.length} active complaints</p>
              {complaintsLoading && <p>Loading complaints...</p>}

              <div className="complaints-table-container">
                <table className="admin-table admin-table-complaints">
                  <thead>
                    <tr>
                      <th>Complaint ID</th>
                      <th>User</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Assignee</th>
                      <th>Created At</th>
                      <th>Updated At</th>
                      <th>Proof</th>
                      <th>Timeline</th>
                      <th>Admin Review</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedComplaints.map((complaint) => (
                      <tr key={complaint.id}>
                        <td className="strong">{complaint.complaintCode || `#${complaint.id}`}</td>
                        <td>
                          <div>{complaint.userName || 'Anonymous'}</div>
                          <small className="admin-muted-text">{complaint.userEmail || 'No email'}</small>
                        </td>
                        <td><span className="badge category">{getComplaintCategoryLabel(complaint.category)}</span></td>
                        <td>{complaint.description?.trim() || 'no description availble'}</td>
                        <td><span className={`badge status ${getStatusClass(complaint.status)}`}>{getStatusLabel(complaint.status)}</span></td>
                        <td><span className={`badge priority ${(complaint.urgency || 'normal').toLowerCase()}`}>{(complaint.urgency || 'normal').toUpperCase()}</span></td>
                        <td>
                          {complaint.assignedStaffName ? (
                            <div>
                              <div>{complaint.assignedStaffName}</div>
                              <small className="admin-muted-text">{complaint.assignedStaffEmail || 'No email'}</small>
                            </div>
                          ) : (
                            <span className="admin-muted-text">Unassigned</span>
                          )}
                        </td>
                        <td>{formatDateTime(complaint.createdAt)}</td>
                        <td>{formatDateTime(complaint.updatedAt)}</td>
                        <td>
                          {complaint.proofFileUrl ? (
                            <a
                              className="admin-proof-link"
                              href={`${API_URL}${complaint.proofFileUrl}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <FiExternalLink size={14} />
                              Open
                            </a>
                          ) : 'No file'}
                        </td>
                        <td>
                          {!!getTimelineEntries(complaint).length && (
                            <div className="timeline-mini">
                              {getTimelineEntries(complaint).slice(-4).map((log, index) => (
                                <p key={`${complaint.id}-admin-log-${index}`}>
                                  {formatDateTime(log.when)} - {(log.status || log.eventType || '').toUpperCase()} - {log.comment || 'Updated'}{log.actor ? ` (by ${log.actor})` : ''}
                                </p>
                              ))}
                            </div>
                          )}
                          {!getTimelineEntries(complaint).length && 'No timeline yet'}
                        </td>
                        <td>{complaint.adminReview || 'No reply yet'}</td>
                        <td className="complaint-action-cell">
                          <div className="complaint-action-controls">
                            <select
                              className="date-input"
                              value={statusDrafts[complaint.id] || complaint.status || 'open'}
                              onChange={(event) => setStatusDrafts((prev) => ({ ...prev, [complaint.id]: event.target.value }))}
                            >
                              {getAllowedStatuses(statusDrafts[complaint.id] || complaint.status).map((statusOption) => (
                                <option key={`${complaint.id}-${statusOption}`} value={statusOption}>{getStatusLabel(statusOption)}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              className="search-input"
                              placeholder="Reply to user"
                              value={reviewDrafts[complaint.id] ?? complaint.adminReview ?? ''}
                              onChange={(event) => setReviewDrafts((prev) => ({ ...prev, [complaint.id]: event.target.value }))}
                            />
                            <select
                              className="date-input"
                              value={assigneeDrafts[complaint.id] ?? complaint.assignedStaffId ?? ''}
                              onChange={(event) => setAssigneeDrafts((prev) => ({ ...prev, [complaint.id]: event.target.value }))}
                            >
                              <option value="">Unassigned</option>
                              {getAssignableHandlersForComplaint(complaint).map((member) => (
                                  <option key={`assignee-${complaint.id}-${member.id}`} value={member.id}>
                                    {member.name} ({member.rank || member.role}{member.specializationCategory ? ` - ${getComplaintCategoryLabel(member.specializationCategory)}` : ''})
                                  </option>
                                ))}
                            </select>
                            <div className="complaint-action-buttons">
                              <button
                                className="complaint-action-btn secondary"
                                onClick={() => updateComplaintStatus(complaint.id, { assignmentOnly: true })}
                              >
                                Assign
                              </button>
                              <button
                                className="complaint-action-btn primary"
                                onClick={() => updateComplaintStatus(complaint.id)}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!complaintsLoading && paginatedComplaints.length === 0 && (
                      <tr>
                        <td colSpan={13} className="admin-empty-state-cell">No complaints match the current filters.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="filter-actions" style={{ marginTop: '12px', justifyContent: 'flex-end' }}>
                <button
                  className="filter-btn"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  Prev
                </button>
                <span className="admin-user-email">Page {currentPage} of {totalPages}</span>
                <button
                  className="filter-btn"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {activeSection === 'resolved' && (
            <div className="admin-section">
              <div className="admin-section-header">
                <h1>Resolved Complaints</h1>
                <div className="filter-actions">
                  <select className="date-input" value={resolvedItemsPerPage} onChange={(event) => setResolvedItemsPerPage(Number(event.target.value))}>
                    <option value={5}>5 / page</option>
                    <option value={10}>10 / page</option>
                    <option value={20}>20 / page</option>
                    <option value={50}>50 / page</option>
                  </select>
                  <select className="date-input admin-export-format-select" value={sectionExportFormat} onChange={(event) => setSectionExportFormat(event.target.value)}>
                    {EXPORT_FORMAT_OPTIONS.map((option) => (
                      <option key={`resolved-export-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button className="export-btn" onClick={() => exportResolvedComplaintReport(sectionExportFormat)}>
                    <FiDownload size={18} />
                    Export {sectionExportFormat.toUpperCase()}
                  </button>
                </div>
              </div>

              <p className="admin-user-email">Showing {paginatedResolvedComplaints.length} of {resolvedComplaints.length} resolved complaints</p>
              {complaintsLoading && <p>Loading complaints...</p>}

              <div className="complaints-table-container">
                <table className="admin-table admin-table-complaints">
                  <thead>
                    <tr>
                      <th>Complaint ID</th>
                      <th>User</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Assignee</th>
                      <th>Created At</th>
                      <th>Updated At</th>
                      <th>Proof</th>
                      <th>Timeline</th>
                      <th>Admin Review</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedResolvedComplaints.map((complaint) => (
                      <tr key={`resolved-main-${complaint.id}`}>
                        <td className="strong">{complaint.complaintCode || `#${complaint.id}`}</td>
                        <td>
                          <div>{complaint.userName || 'Anonymous'}</div>
                          <small className="admin-muted-text">{complaint.userEmail || 'No email'}</small>
                        </td>
                        <td><span className="badge category">{getComplaintCategoryLabel(complaint.category)}</span></td>
                        <td>{complaint.description?.trim() || 'no description availble'}</td>
                        <td><span className={`badge status ${getStatusClass(complaint.status)}`}>{getStatusLabel(complaint.status)}</span></td>
                        <td><span className={`badge priority ${(complaint.urgency || 'normal').toLowerCase()}`}>{(complaint.urgency || 'normal').toUpperCase()}</span></td>
                        <td>
                          {complaint.assignedStaffName ? (
                            <div>
                              <div>{complaint.assignedStaffName}</div>
                              <small className="admin-muted-text">{complaint.assignedStaffEmail || 'No email'}</small>
                            </div>
                          ) : (
                            <span className="admin-muted-text">Unassigned</span>
                          )}
                        </td>
                        <td>{formatDateTime(complaint.createdAt)}</td>
                        <td>{formatDateTime(complaint.updatedAt)}</td>
                        <td>
                          {complaint.proofFileUrl ? (
                            <a
                              className="admin-proof-link"
                              href={`${API_URL}${complaint.proofFileUrl}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <FiExternalLink size={14} />
                              Open
                            </a>
                          ) : 'No file'}
                        </td>
                        <td className="resolved-timeline-cell">
                          <div className="resolved-timeline-mini">
                            {buildResolvedTimelineSteps(complaint).map((step) => {
                              const hasTimestamp = Boolean(step.timestamp);
                              return (
                                <div
                                  key={`${complaint.id}-resolved-step-${step.key}`}
                                  className={`resolved-timeline-step ${hasTimestamp ? 'done' : 'waiting'}`}
                                >
                                  <span className="resolved-timeline-dot" aria-hidden="true" />
                                  <div className="resolved-timeline-content">
                                    <p className="resolved-timeline-label">{step.label}</p>
                                    <p className="resolved-timeline-meta">{hasTimestamp ? formatDateTime(step.timestamp) : 'Waiting'}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td>{complaint.adminReview || 'No reply yet'}</td>
                        <td className="complaint-action-cell">
                          <div className="complaint-action-controls">
                            <select
                              className="date-input"
                              value={statusDrafts[complaint.id] || complaint.status || 'resolved'}
                              onChange={(event) => setStatusDrafts((prev) => ({ ...prev, [complaint.id]: event.target.value }))}
                            >
                              {getAllowedStatuses(statusDrafts[complaint.id] || complaint.status).map((statusOption) => (
                                <option key={`resolved-${complaint.id}-${statusOption}`} value={statusOption}>{getStatusLabel(statusOption)}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              className="search-input"
                              placeholder="Reply to user"
                              value={reviewDrafts[complaint.id] ?? complaint.adminReview ?? ''}
                              onChange={(event) => setReviewDrafts((prev) => ({ ...prev, [complaint.id]: event.target.value }))}
                            />
                            <select
                              className="date-input"
                              value={assigneeDrafts[complaint.id] ?? complaint.assignedStaffId ?? ''}
                              onChange={(event) => setAssigneeDrafts((prev) => ({ ...prev, [complaint.id]: event.target.value }))}
                            >
                              <option value="">Unassigned</option>
                              {getAssignableHandlersForComplaint(complaint).map((member) => (
                                  <option key={`resolved-assignee-${complaint.id}-${member.id}`} value={member.id}>
                                    {member.name} ({member.rank || member.role}{member.specializationCategory ? ` - ${getComplaintCategoryLabel(member.specializationCategory)}` : ''})
                                  </option>
                                ))}
                            </select>
                            <div className="complaint-action-buttons">
                              <button
                                className="complaint-action-btn secondary"
                                onClick={() => updateComplaintStatus(complaint.id, { assignmentOnly: true })}
                              >
                                Assign
                              </button>
                              <button
                                className="complaint-action-btn primary"
                                onClick={() => updateComplaintStatus(complaint.id)}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!complaintsLoading && paginatedResolvedComplaints.length === 0 && (
                      <tr>
                        <td colSpan={13} className="admin-empty-state-cell">No resolved complaints available yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="filter-actions" style={{ marginTop: '12px', justifyContent: 'flex-end' }}>
                <button
                  className="filter-btn"
                  onClick={() => setResolvedCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={resolvedCurrentPage === 1}
                >
                  Prev
                </button>
                <span className="admin-user-email">Page {resolvedCurrentPage} of {resolvedTotalPages}</span>
                <button
                  className="filter-btn"
                  onClick={() => setResolvedCurrentPage((prev) => Math.min(resolvedTotalPages, prev + 1))}
                  disabled={resolvedCurrentPage === resolvedTotalPages}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {activeSection === 'workers' && (
            <div className="admin-section">
              <div className="admin-section-header">
                <h1>Staff Management</h1>
                <div className="filter-actions">
                  <button className="btn-primary" onClick={handleAddSampleStaffAndAssign} disabled={bulkStaffActionLoading}>
                    <FiPlus size={16} /> {bulkStaffActionLoading ? 'Applying...' : 'Add Staff + Assign Complaints'}
                  </button>
                  <select className="date-input admin-export-format-select" value={sectionExportFormat} onChange={(event) => setSectionExportFormat(event.target.value)}>
                    {EXPORT_FORMAT_OPTIONS.map((option) => (
                      <option key={`staff-export-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button className="btn-primary" onClick={() => exportStaffReport(sectionExportFormat)}>
                    <FiDownload size={16} /> Export {sectionExportFormat.toUpperCase()}
                  </button>
                </div>
              </div>

              <div className="setting-card admin-staff-form-card">
                <h3>Add New Staff or Admin</h3>
                <form className="admin-form-grid" onSubmit={handleCreateStaff}>
                  <input className="form-input" name="name" value={staffForm.name} onChange={handleStaffFormChange} placeholder="Full name" required />
                  <input className="form-input" name="email" value={staffForm.email} onChange={handleStaffFormChange} placeholder="Email address" type="email" required />
                  <input className="form-input" name="password" value={staffForm.password} onChange={handleStaffFormChange} placeholder="Temporary password" type="password" required />
                  <select className="date-input" name="role" value={staffForm.role} onChange={handleStaffFormChange}>
                    <option value="STAFF">Staff</option>
                    <option value="ADMIN">Admin</option>
                    <option value="USER">User</option>
                  </select>
                  <select className="date-input" name="rank" value={staffForm.rank} onChange={handleStaffFormChange}>
                    {STAFF_RANK_OPTIONS.map((rank) => (
                      <option key={rank} value={rank}>{rank}</option>
                    ))}
                  </select>
                  <select
                    className="date-input"
                    name="specializationCategory"
                    value={staffForm.specializationCategory}
                    onChange={handleStaffFormChange}
                    disabled={staffForm.role !== 'STAFF' || staffForm.rank !== 'Senior Handler'}
                  >
                    <option value="">Specialization (only for Senior Handler)</option>
                    {COMPLAINT_CATEGORY_OPTIONS.map((category) => (
                      <option key={category} value={category}>{getComplaintCategoryLabel(category)}</option>
                    ))}
                  </select>
                  <label className="checkbox-label admin-inline-checkbox">
                    <input type="checkbox" name="isActive" checked={staffForm.isActive} onChange={handleStaffFormChange} />
                    <span>Active account</span>
                  </label>
                  <button className="btn-primary" type="submit" disabled={staffFormLoading}>
                    <FiPlus size={16} /> {staffFormLoading ? 'Creating...' : 'Create User'}
                  </button>
                </form>
              </div>

              <div className="workers-grid">
                {usersLoading && <p>Loading users...</p>}
                {!usersLoading && workerPerformance.length === 0 && (
                  <div className="worker-card">
                    <div className="worker-info">
                      <h3>No staff accounts found</h3>
                      <p>Create one using the form above.</p>
                    </div>
                  </div>
                )}

                {workerPerformance.map((worker) => {
                  const draft = getUserDraft(worker);
                  return (
                    <div key={worker.id} className={`worker-card ${worker.isActive ? 'active' : 'inactive'}`}>
                      <div className="worker-header">
                        <div className="worker-avatar">{worker.name.charAt(0)}</div>
                        <div className="worker-info">
                          <h3>{worker.name}</h3>
                          <p>{worker.email}</p>
                          {worker.staffId && <p className="admin-muted-text">Staff ID: {worker.staffId}</p>}
                          <p className="admin-muted-text">
                            {worker.rank || worker.role}
                            {worker.specializationCategory ? ` - ${getComplaintCategoryLabel(worker.specializationCategory)}` : ''}
                          </p>
                        </div>
                        <span className={`status-indicator ${worker.isActive ? 'active' : 'on_leave'}`} title={worker.isActive ? 'active' : 'inactive'} />
                      </div>

                      <div className="worker-stats">
                        <div className="stat">
                          <span className="label">Handled</span>
                          <span className="value">{worker.complaints}</span>
                        </div>
                        <div className="stat">
                          <span className="label">Resolved</span>
                          <span className="value">{worker.completed}</span>
                        </div>
                        <div className="stat">
                          <span className="label">Assigned</span>
                          <span className="value">{worker.assigned}</span>
                        </div>
                      </div>

                      <div className="admin-inline-edit-grid">
                        <input className="form-input" value={draft.name} onChange={(event) => updateUserDraft(worker.id, 'name', event.target.value)} />
                        <input className="form-input" value={draft.email} onChange={(event) => updateUserDraft(worker.id, 'email', event.target.value)} />
                        <select className="date-input" value={draft.role} onChange={(event) => updateUserDraft(worker.id, 'role', event.target.value)}>
                          <option value="STAFF">Staff</option>
                          <option value="ADMIN">Admin</option>
                          <option value="USER">User</option>
                        </select>
                        <select className="date-input" value={draft.rank || 'Handler'} onChange={(event) => updateUserDraft(worker.id, 'rank', event.target.value)}>
                          {STAFF_RANK_OPTIONS.map((rank) => (
                            <option key={`${worker.id}-${rank}`} value={rank}>{rank}</option>
                          ))}
                        </select>
                        <select
                          className="date-input"
                          value={draft.specializationCategory || ''}
                          onChange={(event) => updateUserDraft(worker.id, 'specializationCategory', event.target.value)}
                          disabled={(draft.role || '').toUpperCase() !== 'STAFF' || (draft.rank || '').toLowerCase() !== 'senior handler'}
                        >
                          <option value="">Specialization (Senior Handler only)</option>
                          {COMPLAINT_CATEGORY_OPTIONS.map((category) => (
                            <option key={`${worker.id}-category-${category}`} value={category}>{getComplaintCategoryLabel(category)}</option>
                          ))}
                        </select>
                        <input
                          className="form-input"
                          type="password"
                          placeholder="New password (optional)"
                          value={draft.password}
                          onChange={(event) => updateUserDraft(worker.id, 'password', event.target.value)}
                        />
                        <label className="checkbox-label admin-inline-checkbox">
                          <input
                            type="checkbox"
                            checked={Boolean(draft.isActive)}
                            onChange={(event) => updateUserDraft(worker.id, 'isActive', event.target.checked)}
                          />
                          <span>{draft.isActive ? 'Active' : 'Inactive'}</span>
                        </label>
                      </div>

                      <div className="worker-status-text">
                        <span className={worker.isActive ? 'active-text' : 'leave-text'}>
                          {worker.isActive ? 'Active account' : 'Inactive account'}
                        </span>
                        <span className="admin-muted-text">Last action: {formatDateTime(worker.lastActionAt)}</span>
                      </div>

                      <div className="worker-actions">
                        <button className="btn-small" onClick={() => handleSaveUser(worker)} disabled={savingUserId === worker.id}>
                          {savingUserId === worker.id ? 'Saving...' : 'Save'}
                        </button>
                        <button className="btn-small secondary" onClick={() => updateUserDraft(worker.id, 'isActive', !draft.isActive)}>
                          {draft.isActive ? 'Mark Inactive' : 'Reactivate'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeSection === 'assign' && (
            <div className="admin-section">
              <div className="admin-section-header">
                <h1>Assign Complaints</h1>
                <div className="filter-actions">
                  <span className="admin-user-email">{assignSectionComplaints.length} active complaints</span>
                  <select className="date-input admin-export-format-select" value={sectionExportFormat} onChange={(event) => setSectionExportFormat(event.target.value)}>
                    {EXPORT_FORMAT_OPTIONS.map((option) => (
                      <option key={`assign-export-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button className="export-btn" onClick={() => exportAssignmentReport(sectionExportFormat)}>
                    <FiDownload size={18} /> Export {sectionExportFormat.toUpperCase()}
                  </button>
                </div>
              </div>

              {complaintsLoading && <p>Loading complaints...</p>}
              <div className="complaints-table-container">
                <table className="admin-table admin-table-assign">
                  <thead>
                    <tr>
                      <th>Complaint ID</th>
                      <th>User</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Assign To</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignSectionComplaints.map((complaint) => (
                      <tr key={`assign-${complaint.id}`}>
                        <td className="strong">{complaint.complaintCode || `#${complaint.id}`}</td>
                        <td>
                          <div>{complaint.userName || 'Anonymous'}</div>
                          <small className="admin-muted-text">{complaint.userEmail || 'No email'}</small>
                        </td>
                        <td><span className="badge category">{getComplaintCategoryLabel(complaint.category)}</span></td>
                        <td>{complaint.description?.trim() || 'no description availble'}</td>
                        <td><span className={`badge status ${getStatusClass(complaint.status)}`}>{getStatusLabel(complaint.status)}</span></td>
                        <td><span className={`badge priority ${(complaint.urgency || 'normal').toLowerCase()}`}>{(complaint.urgency || 'normal').toUpperCase()}</span></td>
                        <td>
                          <select
                            className="date-input"
                            value={assigneeDrafts[complaint.id] ?? ''}
                            onChange={(event) => setAssigneeDrafts((prev) => ({ ...prev, [complaint.id]: event.target.value }))}
                          >
                            <option value="">Select staff member</option>
                            {getAssignableHandlersForComplaint(complaint).map((member) => (
                                <option key={`assign-tab-${complaint.id}-${member.id}`} value={member.id}>
                                  {member.name} ({member.rank || member.role}{member.specializationCategory ? ` - ${getComplaintCategoryLabel(member.specializationCategory)}` : ''})
                                </option>
                              ))}
                          </select>
                        </td>
                        <td>
                          <button className="complaint-action-btn secondary" onClick={() => updateComplaintStatus(complaint.id, { assignmentOnly: true })}>
                            Assign
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!complaintsLoading && assignSectionComplaints.length === 0 && (
                      <tr>
                        <td colSpan={8} className="admin-empty-state-cell">No active complaints available for assignment.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeSection === 'attendance' && (
            <div className="admin-section">
              <div className="admin-section-header">
                <h1>Attendance & Leaves</h1>
                <div className="filter-actions">
                  <input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} className="date-input" />
                  <button className="btn-primary" onClick={handleSaveAttendanceMarks} disabled={attendanceSaving}>
                    {attendanceSaving ? 'Saving...' : 'Mark Attendance'}
                  </button>
                  <select className="date-input admin-export-format-select" value={sectionExportFormat} onChange={(event) => setSectionExportFormat(event.target.value)}>
                    {EXPORT_FORMAT_OPTIONS.map((option) => (
                      <option key={`attendance-export-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button className="export-btn" onClick={() => exportAttendanceReport(sectionExportFormat)}>
                    <FiDownload size={18} /> Export {sectionExportFormat.toUpperCase()}
                  </button>
                </div>
              </div>

              <div className="attendance-overview">
                <div className="attendance-stat present">
                  <span className="label">Present</span>
                  <span className="value">{attendanceSummary.present}</span>
                </div>
                <div className="attendance-stat absent">
                  <span className="label">Absent</span>
                  <span className="value">{attendanceSummary.absent}</span>
                </div>
                <div className="attendance-stat leave">
                  <span className="label">On Leave</span>
                  <span className="value">{attendanceSummary.onLeave}</span>
                </div>
                <div className="attendance-stat total">
                  <span className="label">Total Staff</span>
                  <span className="value">{attendanceSummary.total}</span>
                </div>
              </div>

              <div className="attendance-table-container">
                <h3>Daily Attendance Record</h3>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Staff Member</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Check-in</th>
                      <th>Check-out</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workerPerformance.map((worker) => {
                      const record = attendanceForDate[worker.id] || {};
                      const status = record.status || (worker.isActive ? 'present' : 'absent');

                      return (
                        <tr key={worker.id}>
                          <td className="strong">{worker.name}</td>
                          <td>{worker.role}</td>
                          <td>
                            <select className="date-input" value={status} onChange={(event) => updateAttendanceRecord(worker.id, 'status', event.target.value)}>
                              {ATTENDANCE_STATUS_OPTIONS.map((option) => (
                                <option key={option} value={option}>{getStatusLabel(option)}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input className="date-input" type="time" value={record.checkIn || ''} onChange={(event) => updateAttendanceRecord(worker.id, 'checkIn', event.target.value)} />
                          </td>
                          <td>
                            <input className="date-input" type="time" value={record.checkOut || ''} onChange={(event) => updateAttendanceRecord(worker.id, 'checkOut', event.target.value)} />
                          </td>
                          <td>{getAttendanceDuration(record.checkIn, record.checkOut)}</td>
                        </tr>
                      );
                    })}
                    {workerPerformance.length === 0 && (
                      <tr>
                        <td colSpan={6} className="admin-empty-state-cell">No staff accounts available for attendance tracking.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="leave-requests">
                <h3>Leave Summary</h3>
                <div className="empty-state">
                  <p>{attendanceSummary.onLeave} staff members are marked as on leave for {attendanceDate}.</p>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'reports' && (
            <div className="admin-section">
              <div className="admin-section-header">
                <h1>Reports & Analytics</h1>
                <div className="filter-actions">
                  <select className="period-select" value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value)}>
                    {REPORT_PERIOD_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option === 'all' ? 'All Time' : `Last ${option.replace('d', ' Days')}`}</option>
                    ))}
                  </select>
                  <select className="date-input admin-export-format-select" value={sectionExportFormat} onChange={(event) => setSectionExportFormat(event.target.value)}>
                    {EXPORT_FORMAT_OPTIONS.map((option) => (
                      <option key={`report-export-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button className="btn-primary" onClick={() => exportSummaryReport(sectionExportFormat)}>Generate Summary</button>
                </div>
              </div>

              <div className="reports-grid">
                <div className="report-card">
                  <h3>Complaint Report</h3>
                  <div className="report-content">
                    <div className="report-stat">
                      <span>In Scope</span>
                      <strong>{reportComplaints.length}</strong>
                    </div>
                    <div className="report-stat">
                      <span>Resolved</span>
                      <strong>{reportComplaints.filter((item) => normalizeStatus(item.status) === 'resolved').length}</strong>
                    </div>
                    <div className="report-stat">
                      <span>Overdue</span>
                      <strong>{overdueComplaints.length}</strong>
                    </div>
                  </div>
                  <button className="report-action-btn" onClick={() => exportComplaintReport(sectionExportFormat, reportComplaints, 'Complaint Report', 'admin-complaint-report')}>Download {sectionExportFormat.toUpperCase()}</button>
                </div>

                <div className="report-card">
                  <h3>Staff Performance</h3>
                  <div className="report-content">
                    <div className="report-stat">
                      <span>Tracked Staff</span>
                      <strong>{workerPerformance.length}</strong>
                    </div>
                    <div className="report-stat">
                      <span>At Capacity</span>
                      <strong>{workerPerformance.filter((worker) => worker.utilization >= 100).length}</strong>
                    </div>
                    <div className="report-stat">
                      <span>Active Accounts</span>
                      <strong>{workerPerformance.filter((worker) => worker.isActive).length}</strong>
                    </div>
                  </div>
                  <button className="report-action-btn" onClick={() => exportStaffReport(sectionExportFormat)}>Download {sectionExportFormat.toUpperCase()}</button>
                </div>

                <div className="report-card">
                  <h3>Attendance Snapshot</h3>
                  <div className="report-content">
                    <div className="report-stat">
                      <span>Present</span>
                      <strong>{attendanceSummary.present}</strong>
                    </div>
                    <div className="report-stat">
                      <span>Absent</span>
                      <strong>{attendanceSummary.absent}</strong>
                    </div>
                    <div className="report-stat">
                      <span>On Leave</span>
                      <strong>{attendanceSummary.onLeave}</strong>
                    </div>
                  </div>
                  <button className="report-action-btn" onClick={() => exportAttendanceReport(sectionExportFormat)}>Download {sectionExportFormat.toUpperCase()}</button>
                </div>

                <div className="report-card">
                  <h3>Admin Summary</h3>
                  <div className="report-content">
                    <div className="report-stat">
                      <span>Resolution Rate</span>
                      <strong>{complaintStats.resolvedRate}%</strong>
                    </div>
                    <div className="report-stat">
                      <span>Avg Time</span>
                      <strong>{complaintStats.averageTime}</strong>
                    </div>
                    <div className="report-stat">
                      <span>Categories</span>
                      <strong>{categoryData.length}</strong>
                    </div>
                  </div>
                  <button className="report-action-btn" onClick={() => exportSummaryReport(sectionExportFormat)}>Download {sectionExportFormat.toUpperCase()}</button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'analytics' && (
            <div className="admin-section">
              <div className="admin-section-header">
                <h1>Advanced Analytics</h1>
                <div className="filter-actions">
                  <select className="period-select" value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value)}>
                    {REPORT_PERIOD_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option === 'all' ? 'All Time' : `Last ${option.replace('d', ' Days')}`}</option>
                    ))}
                  </select>
                  <select className="date-input admin-export-format-select" value={sectionExportFormat} onChange={(event) => setSectionExportFormat(event.target.value)}>
                    {EXPORT_FORMAT_OPTIONS.map((option) => (
                      <option key={`analytics-export-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button className="export-btn" onClick={() => exportAnalyticsReport(sectionExportFormat)}>
                    <FiDownload size={18} /> Export {sectionExportFormat.toUpperCase()}
                  </button>
                </div>
              </div>

              <div className="analytics-container">
                <div className="analytics-card large">
                  <h3>Complaint Trends by Category</h3>
                  <div className="analytics-list">
                    {categoryData.map((item) => {
                      const percent = reportComplaints.length ? Math.round((item.count / reportComplaints.length) * 100) : 0;
                      return (
                        <div key={item.name} className="analytics-row">
                          <div className="analytics-row-label">
                            <span>{getStatusLabel(item.name)}</span>
                            <strong>{item.count}</strong>
                          </div>
                          <div className="analytics-progress">
                            <span className="analytics-progress-bar" style={{ width: `${percent}%`, background: item.color }} />
                          </div>
                        </div>
                      );
                    })}
                    {categoryData.length === 0 && <p>No category data available yet.</p>}
                  </div>
                </div>

                <div className="analytics-card">
                  <h3>Status Distribution</h3>
                  <div className="analytics-list">
                    {analyticsStatusData.map((item) => {
                      const percent = reportComplaints.length ? Math.round((item.count / reportComplaints.length) * 100) : 0;
                      return (
                        <div key={item.label} className="analytics-row compact">
                          <div className="analytics-row-label">
                            <span>{getStatusLabel(item.label)}</span>
                            <strong>{item.count}</strong>
                          </div>
                          <div className="analytics-progress small">
                            <span className="analytics-progress-bar" style={{ width: `${percent}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="analytics-card">
                  <h3>Priority Mix</h3>
                  <div className="analytics-list">
                    {analyticsPriorityData.map((item) => {
                      const percent = reportComplaints.length ? Math.round((item.count / reportComplaints.length) * 100) : 0;
                      return (
                        <div key={item.label} className="analytics-row compact">
                          <div className="analytics-row-label">
                            <span>{getStatusLabel(item.label)}</span>
                            <strong>{item.count}</strong>
                          </div>
                          <div className="analytics-progress small">
                            <span className="analytics-progress-bar priority" style={{ width: `${percent}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div className="admin-section">
              <div className="admin-section-header">
                <h1>System Alerts & Notifications</h1>
                <div className="filter-actions">
                  <button className="btn-primary" onClick={() => setActiveSection('settings')}>Configure Alerts</button>
                  <button className="filter-btn" onClick={restoreNotifications}>Restore Dismissed</button>
                </div>
              </div>

              <div className="notifications-grid">
                {visibleNotifications.length === 0 && (
                  <div className="notification-card success">
                    <div className="notification-header">
                      <FiCheckCircle size={24} />
                      <span className="level-badge success">CLEAR</span>
                    </div>
                    <p className="notification-message">There are no active notifications after the current dismissals.</p>
                    <div className="notification-time"><small>Updated now</small></div>
                  </div>
                )}
                {visibleNotifications.map((alert) => {
                  const AlertIcon = alert.icon;
                  return (
                    <div key={alert.id} className={`notification-card ${alert.level}`}>
                      <div className="notification-header">
                        <AlertIcon size={24} />
                        <span className={`level-badge ${alert.level}`}>{alert.level.toUpperCase()}</span>
                      </div>
                      <p className="notification-message">{alert.message}</p>
                      <div className="notification-time">
                        <small>Generated from live dashboard data</small>
                      </div>
                      <button className="btn-small secondary" onClick={() => dismissNotification(alert.id)}>Dismiss</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeSection === 'settings' && (
            <div className="admin-section">
              <div className="admin-section-header">
                <h1>Admin Settings</h1>
              </div>

              <div className="settings-grid">
                <div className="setting-card">
                  <h3>System Configuration</h3>
                  <div className="setting-item">
                    <label>Maximum Complaints per Worker</label>
                    <input type="number" name="maxComplaintsPerWorker" value={settings.maxComplaintsPerWorker} onChange={updateSettingsField} className="form-input" min={1} />
                  </div>
                  <div className="setting-item">
                    <label>Resolution Time Target (hours)</label>
                    <input type="number" name="resolutionTargetHours" value={settings.resolutionTargetHours} onChange={updateSettingsField} className="form-input" min={1} />
                  </div>
                  <p className="admin-muted-text">These values are used by staff load warnings and overdue complaint alerts.</p>
                </div>

                <div className="setting-card">
                  <h3>Security Settings</h3>
                  <div className="setting-item">
                    <label htmlFor="twofa" className="checkbox-label">
                      <input type="checkbox" id="twofa" name="enableTwoFactor" checked={settings.enableTwoFactor} onChange={updateSettingsField} />
                      <span>Enable Two-Factor Authentication reminder</span>
                    </label>
                  </div>
                  <div className="setting-item">
                    <label htmlFor="audit" className="checkbox-label">
                      <input type="checkbox" id="audit" name="enableAuditLog" checked={settings.enableAuditLog} onChange={updateSettingsField} />
                      <span>Enable audit logging reminder</span>
                    </label>
                  </div>
                  <p className="admin-muted-text">These preferences are persisted for the admin panel and reflected in alert behavior.</p>
                </div>

                <div className="setting-card">
                  <h3>Notification Preferences</h3>
                  <div className="setting-item">
                    <label htmlFor="email-notif" className="checkbox-label">
                      <input type="checkbox" id="email-notif" name="emailNotifications" checked={settings.emailNotifications} onChange={updateSettingsField} />
                      <span>Email notifications</span>
                    </label>
                  </div>
                  <div className="setting-item">
                    <label htmlFor="sms-notif" className="checkbox-label">
                      <input type="checkbox" id="sms-notif" name="smsCriticalAlerts" checked={settings.smsCriticalAlerts} onChange={updateSettingsField} />
                      <span>SMS alerts for critical issues</span>
                    </label>
                  </div>
                  <p className="admin-muted-text">Dismissed notifications can be restored from the alerts section at any time.</p>
                </div>

                <div className="setting-card danger-zone">
                  <h3>Danger Zone</h3>
                  <p>These actions affect only admin panel local preferences.</p>
                  <button className="btn-danger" onClick={() => setAttendanceRecords({})}>Clear Attendance Cache</button>
                  <button className="btn-danger" onClick={() => setNotificationState({})}>Reset Alert State</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ADashboard;
