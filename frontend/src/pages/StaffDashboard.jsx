import React, { useCallback, useEffect, useState } from 'react';
import { FiClock, FiCheckCircle, FiCalendar, FiLogOut, FiMoon, FiSun, FiUser } from 'react-icons/fi';
import { getCurrentUser, logout } from '../services/authService';
import { getUiPreferences, updateUiPreferences } from '../services/preferencesService';
import {
  escalateStaffComplaint,
  getStaffAttendance,
  getStaffDashboard,
  resolveStaffComplaint,
} from '../services/staffService';
import './StaffDashboard.css';

const StaffDashboard = ({ onNavigateLanding }) => {
  const [user, setUser] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [uiPreferences, setUiPreferences] = useState(() => getUiPreferences());

  useEffect(() => {
    updateUiPreferences(uiPreferences);
  }, [uiPreferences]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboardData, attendanceData] = await Promise.all([
        getStaffDashboard(),
        getStaffAttendance(),
      ]);
      setDashboard(dashboardData);
      setAttendance(attendanceData || []);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load staff dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const currentUser = getCurrentUser();
    if (!currentUser || currentUser.role !== 'STAFF') {
      onNavigateLanding();
      return;
    }

    setUser(currentUser);
    void loadData();
  }, [loadData, onNavigateLanding]);

  const handleLogout = () => {
    logout();
    onNavigateLanding();
  };

  const handleThemeChange = (value) => {
    setUiPreferences((prev) => ({ ...prev, theme: value }));
  };

  const toggleTheme = () => {
    handleThemeChange(uiPreferences.theme === 'dark' ? 'light' : 'dark');
  };

  const formatDateTime = (value) => {
    if (!value) return 'N/A';
    return new Date(value).toLocaleString();
  };

  const normalizeStatus = (status) => {
    const normalized = (status || 'open').toLowerCase();
    if (normalized === 'in-progress' || normalized === 'in progress') {
      return 'inprogress';
    }
    if (normalized === 'done' || normalized === 'closed') {
      return 'resolved';
    }
    return normalized;
  };

  const normalizeComplaintCategory = (category) => {
    const normalized = `${category || ''}`.trim().toLowerCase();
    if (!normalized) {
      return 'it-support-request';
    }

    if (normalized.includes('hostel') || normalized.includes('academic') || normalized.includes('infrastructure')) {
      return 'it-support-request';
    }

    return normalized;
  };

  const getComplaintCategoryLabel = (category) => {
    return normalizeComplaintCategory(category)
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  const updateComplaintAction = async (complaintId, action) => {
    setError('');
    setActionLoading((prev) => ({ ...prev, [complaintId]: true }));

    const isResolve = action === 'resolve';
    const promptTitle = isResolve
      ? 'Add resolution note (optional)'
      : 'Add escalation note (optional)';
    const defaultNote = isResolve ? 'Resolved by staff' : 'Escalated by staff';
    const userNote = window.prompt(promptTitle, defaultNote);

    if (userNote === null) {
      setActionLoading((prev) => ({ ...prev, [complaintId]: false }));
      return;
    }

    try {
      if (isResolve) {
        await resolveStaffComplaint(complaintId, userNote.trim() || defaultNote);
      } else {
        await escalateStaffComplaint(complaintId, userNote.trim() || defaultNote);
      }
      await loadData();
    } catch (actionError) {
      setError(actionError.message || 'Unable to update complaint status');
    } finally {
      setActionLoading((prev) => ({ ...prev, [complaintId]: false }));
    }
  };

  if (loading) {
    return <div className="staff-page"><p className="staff-loading">Loading staff dashboard...</p></div>;
  }

  if (error) {
    return (
      <div className="staff-page">
        <p className="staff-error">{error}</p>
        <button className="staff-btn" onClick={loadData}>Retry</button>
      </div>
    );
  }

  const isSeniorHandler = (dashboard?.rank || '').toLowerCase() === 'senior handler';
  const specializationLabel = dashboard?.specializationCategory
    ? getComplaintCategoryLabel(dashboard.specializationCategory)
    : null;

  return (
    <div className={`staff-page theme-${uiPreferences.theme}`}>
      <header className="staff-header">
        <div>
          <h1>Staff Dashboard</h1>
          <p>{dashboard?.name} ({dashboard?.staffId || user?.staffId || 'N/A'})</p>
          <p>
            {dashboard?.rank || 'Staff'}
            {specializationLabel ? ` - ${specializationLabel}` : ''}
          </p>
        </div>
        <div className="staff-header-right">
          <button
            className="staff-theme-icon-btn"
            type="button"
            onClick={toggleTheme}
            aria-label={uiPreferences.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={uiPreferences.theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {uiPreferences.theme === 'dark' ? <FiSun size={16} /> : <FiMoon size={16} />}
          </button>
          <span className="staff-email">{user?.email}</span>
          <button className="staff-logout" onClick={handleLogout}>
            <FiLogOut size={16} /> Logout
          </button>
        </div>
      </header>

      {isSeniorHandler && (
        <section className="staff-section">
          <p>
            You are viewing escalated complaints for your specialization only.
          </p>
        </section>
      )}

      <section className="staff-cards">
        <div className="staff-card">
          <FiClock size={20} />
          <h3>Today's Assigned</h3>
          <p>{dashboard?.todayAssignedCount ?? 0}</p>
        </div>
        <div className="staff-card">
          <FiCheckCircle size={20} />
          <h3>Completed Today</h3>
          <p>{dashboard?.completedTodayCount ?? 0}</p>
        </div>
        <div className="staff-card">
          <FiCalendar size={20} />
          <h3>Completed This Month</h3>
          <p>{dashboard?.completedMonthCount ?? 0}</p>
        </div>
        <div className="staff-card">
          <FiUser size={20} />
          <h3>Today's Attendance</h3>
          <p>{dashboard?.todayAttendance?.status || 'Not marked'}</p>
        </div>
      </section>

      <section className="staff-section">
        <h2>Assigned Complaints</h2>
        <div className="staff-table-wrap">
          <table className="staff-table">
            <thead>
              <tr>
                <th>Complaint ID</th>
                <th>Category</th>
                <th>Description</th>
                <th>Status</th>
                <th>Priority</th>
                <th>User</th>
                <th>Updated At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(dashboard?.assignedComplaints || []).map((complaint) => {
                const normalizedStatus = normalizeStatus(complaint.status);
                const isLocked = normalizedStatus === 'resolved';
                const isEscalated = normalizedStatus === 'escalated';
                const isRowLoading = !!actionLoading[complaint.id];

                return (
                  <tr key={complaint.id}>
                    <td>{complaint.complaintCode || `#${complaint.id}`}</td>
                    <td>{getComplaintCategoryLabel(complaint.category)}</td>
                    <td>{complaint.description?.trim() || 'no description availble'}</td>
                    <td>{complaint.status}</td>
                    <td>{complaint.urgency}</td>
                    <td>{complaint.userName}</td>
                    <td>{formatDateTime(complaint.updatedAt)}</td>
                    <td>
                      <div className="staff-action-group">
                        <button
                          className="staff-action-btn resolve"
                          onClick={() => updateComplaintAction(complaint.id, 'resolve')}
                          disabled={isRowLoading || isLocked}
                        >
                          Resolve
                        </button>
                        <button
                          className="staff-action-btn escalate"
                          onClick={() => updateComplaintAction(complaint.id, 'escalate')}
                          disabled={isRowLoading || isLocked || isEscalated || isSeniorHandler}
                        >
                          Escalate
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(dashboard?.assignedComplaints || []).length === 0 && (
                <tr><td colSpan={8}>No assigned complaints yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="staff-section">
        <h2>Attendance (Last 30 Days)</h2>
        <div className="staff-table-wrap">
          <table className="staff-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Marked By</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.attendanceDate}</td>
                  <td>{entry.status}</td>
                  <td>{entry.checkInTime || '-'}</td>
                  <td>{entry.checkOutTime || '-'}</td>
                  <td>{entry.markedByName || '-'}</td>
                </tr>
              ))}
              {attendance.length === 0 && (
                <tr><td colSpan={5}>Attendance is not marked yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default StaffDashboard;
