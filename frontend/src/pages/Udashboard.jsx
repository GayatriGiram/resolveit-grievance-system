import React, { useState, useEffect } from 'react';
import { changePassword, logout } from '../services/authService';
import API_URL from '../services/apiConfig';
import { getUiPreferences, updateUiPreferences } from '../services/preferencesService';
import './Udashboard.css';
import { 
  FiHome, FiFileText, FiCheckCircle, FiBarChart2, 
  FiSettings, FiUser, FiPlus, FiLogOut, FiMenu, FiX,
  FiClock, FiAlertCircle, FiMoon, FiSun
} from 'react-icons/fi';

const ALLOWED_PROOF_EXTENSIONS = ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx'];
const USER_SETTINGS_KEY = 'resolveit-user-settings';

const DEFAULT_USER_SETTINGS = {
  emailNotifications: true,
  smsNotifications: true,
  profilePrivate: false,
};

const COMPLAINT_CATEGORIES = [
  { value: 'network', label: 'Network Issue' },
  { value: 'wifi-connectivity', label: 'Wi-Fi Connectivity' },
  { value: 'server-malfunction', label: 'Server Malfunction' },
  { value: 'software-bug', label: 'Software Bug' },
  { value: 'application-installation', label: 'Application Installation' },
  { value: 'access-issue', label: 'Access/Login Issue' },
  { value: 'password-reset', label: 'Password Reset Request' },
  { value: 'email-issue', label: 'Email / Outlook Issue' },
  { value: 'vpn-remote-access', label: 'VPN / Remote Access' },
  { value: 'hardware-failure', label: 'Hardware Failure' },
  { value: 'printer-scanner', label: 'Printer / Scanner Issue' },
  { value: 'cybersecurity', label: 'Cybersecurity Concern' },
  { value: 'data-backup-recovery', label: 'Data Backup / Recovery' },
  { value: 'performance-slow-system', label: 'Slow System / Performance' },
  { value: 'it-support-request', label: 'General IT Support Request' },
  { value: 'other', label: 'Other' },
];

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

const UDashboard = ({ onNavigateLanding }) => {
  const [activeSection, setActiveSection] = useState('home');
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [complaints, setComplaints] = useState([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'network',
    priority: 'normal',
  });
  const [proofFile, setProofFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [pageLoading, setPageLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [uiPreferences, setUiPreferences] = useState(() => getUiPreferences());
  const [userSettings, setUserSettings] = useState(() => {
    try {
      const stored = localStorage.getItem(USER_SETTINGS_KEY);
      return stored ? { ...DEFAULT_USER_SETTINGS, ...JSON.parse(stored) } : DEFAULT_USER_SETTINGS;
    } catch {
      return DEFAULT_USER_SETTINGS;
    }
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
  });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsMessageType, setSettingsMessageType] = useState('success');

  useEffect(() => {
    localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify(userSettings));
  }, [userSettings]);

  useEffect(() => {
    updateUiPreferences(uiPreferences);
  }, [uiPreferences]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Check if user is authenticated
    const savedToken = localStorage.getItem('token');
    
    if (!savedToken) {
      // No token found, redirect to login
      setTimeout(() => {
        onNavigateLanding();
      }, 0);
      return;
    }
    
    // User is authenticated, set user data
    const currentUser = {
      userId: localStorage.getItem('userId'),
      name: localStorage.getItem('userName'),
      email: localStorage.getItem('userEmail'),
      role: localStorage.getItem('userRole'),
      token: savedToken,
    };
    
    setUser(currentUser);
    setIsAuthenticated(true);
    setPageLoading(false);
    fetchComplaints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchComplaints = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/complaints`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) {
        const data = await response.json();
        setComplaints(data || []);
      }
    } catch (error) {
      console.error('Error fetching complaints:', error);
    }
  };

  const handleNewComplaintChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleProofFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) {
      setProofFile(null);
      return;
    }

    const extension = selectedFile.name.split('.').pop()?.toLowerCase();
    if (!extension || !ALLOWED_PROOF_EXTENSIONS.includes(extension)) {
      setMessage('❌ Invalid proof file type. Allowed: JPG, JPEG, PNG, PDF, DOC, DOCX');
      e.target.value = '';
      setProofFile(null);
      return;
    }

    setProofFile(selectedFile);
  };

  const handleSubmitComplaint = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const token = localStorage.getItem('token');
      const combinedDescription = `${formData.title.trim()}: ${formData.description.trim()}`;
      const multipartData = new FormData();
      multipartData.append('category', formData.category);
      multipartData.append('description', combinedDescription);
      multipartData.append('urgency', formData.priority);
      multipartData.append('priority', formData.priority);
      multipartData.append('userId', user.userId);
      if (proofFile) {
        multipartData.append('proofFile', proofFile);
      }

      const response = await fetch(`${API_URL}/api/complaints/with-proof`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: multipartData,
      });

      if (response.ok) {
        const savedComplaint = await response.json();
        setMessage('✅ Complaint submitted successfully!');
        setComplaints((prev) => [savedComplaint, ...prev]);
        setFormData({ title: '', description: '', category: 'network', priority: 'normal' });
        setProofFile(null);
        setTimeout(() => {
          setMessage('');
          setActiveSection('complaints');
          fetchComplaints();
        }, 2000);
      } else {
        const errorText = await response.text();
        setMessage(`❌ ${errorText || 'Error submitting complaint. Try again.'}`);
      }
    } catch (error) {
      setMessage('❌ Server error. Please try again.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

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

  const handleLanguageChange = (value) => {
    setUiPreferences((prev) => ({ ...prev, language: value }));
  };

  const updateUserSetting = (field, value) => {
    setUserSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handlePasswordFieldChange = (event) => {
    const { name, value } = event.target;
    setPasswordForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    setSettingsMessage('');

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmNewPassword) {
      setSettingsMessageType('error');
      setSettingsMessage('Please fill all password fields.');
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setSettingsMessageType('error');
      setSettingsMessage('New password must be at least 6 characters.');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmNewPassword) {
      setSettingsMessageType('error');
      setSettingsMessage('New password and confirm password do not match.');
      return;
    }

    setPasswordLoading(true);
    const response = await changePassword({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });
    setPasswordLoading(false);

    if (!response.success) {
      setSettingsMessageType('error');
      setSettingsMessage(response.message || 'Unable to change password.');
      return;
    }

    setSettingsMessageType('success');
    setSettingsMessage('Password changed successfully.');
    setPasswordForm({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
  };

  const getComplaintStats = () => {
    const stats = {
      total: complaints.length,
      openOrPending: complaints.filter(c => {
        const status = (c.status || '').toLowerCase();
        return status === 'open' || status === 'pending';
      }).length,
      resolved: complaints.filter(c => (c.status || '').toLowerCase() === 'resolved').length,
      inProgress: complaints.filter(c => (c.status || '').toLowerCase() === 'inprogress').length,
      escalated: complaints.filter(c => (c.status || '').toLowerCase() === 'escalated').length,
    };
    return stats;
  };

  const getComplaintTitle = (complaint) => {
    if (!complaint?.description) {
      return 'Complaint';
    }
    const parts = complaint.description.split(':');
    return parts[0]?.trim() || 'Complaint';
  };

  const getComplaintPriority = (complaint) => {
    return (complaint?.priority || complaint?.urgency || 'normal').toLowerCase();
  };

  const formatDateTime = (value) => {
    if (!value) return 'N/A';
    return new Date(value).toLocaleString();
  };

  const getStatusStage = (status) => {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'resolved') return 5;
    if (normalized === 'escalated') return 4;
    if (normalized === 'inprogress') return 3;
    if (normalized === 'pending') return 2;
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

  const getStatusDisplayLabel = (status) => {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'inprogress') return 'In Progress';
    if (normalized === 'escalated') return 'Escalated';
    if (normalized === 'resolved') return 'Resolved';
    if (normalized === 'pending') return 'Pending';
    return 'Open';
  };

  const stats = getComplaintStats();

  if (pageLoading) {
    return (
      <div className="user-dashboard">
        <main className="main-content">
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            minHeight: '100vh',
            color: '#00e38c'
          }}>
            <p>Loading...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const isHindi = uiPreferences.language === 'hi';
  const i18n = {
    welcome: isHindi ? 'स्वागत है' : 'Welcome',
    settingsTitle: isHindi ? 'सेटिंग्स और प्राथमिकताएं' : 'Settings & Preferences',
    settingsSubtitle: isHindi ? 'अपने अनुभव को अनुकूलित करें' : 'Customize your experience',
    notifications: isHindi ? 'सूचनाएं' : 'Notifications',
    privacy: isHindi ? 'गोपनीयता और सुरक्षा' : 'Privacy & Security',
    preferences: isHindi ? 'प्राथमिकताएं' : 'Preferences',
    emailNotifications: isHindi ? 'शिकायत अपडेट के लिए ईमेल सूचनाएं' : 'Email notifications for complaint updates',
    smsNotifications: isHindi ? 'तत्काल अपडेट के लिए SMS सूचनाएं' : 'SMS notifications for urgent updates',
    profilePrivate: isHindi ? 'प्रोफाइल निजी करें' : 'Make profile private',
    changePassword: isHindi ? 'पासवर्ड बदलें' : 'Change Password',
    changing: isHindi ? 'बदला जा रहा है...' : 'Changing...',
    currentPassword: isHindi ? 'वर्तमान पासवर्ड' : 'Current password',
    newPassword: isHindi ? 'नया पासवर्ड' : 'New password',
    confirmPassword: isHindi ? 'नया पासवर्ड पुष्टि करें' : 'Confirm new password',
    language: isHindi ? 'भाषा' : 'Language',
    theme: isHindi ? 'थीम' : 'Theme',
  };

  const menuItems = [
    { id: 'home', label: isHindi ? 'होम' : 'Home', icon: FiHome },
    { id: 'new-complaint', label: isHindi ? 'नई शिकायत दर्ज करें' : 'File New Complaint', icon: FiPlus },
    { id: 'complaints', label: isHindi ? 'शिकायतें देखें' : 'View Complaints', icon: FiFileText },
    { id: 'track', label: isHindi ? 'स्थिति ट्रैक करें' : 'Track Status', icon: FiClock },
    { id: 'analytics', label: isHindi ? 'विश्लेषण' : 'Analytics', icon: FiBarChart2 },
    { id: 'account', label: isHindi ? 'मेरा अकाउंट' : 'My Account', icon: FiUser },
    { id: 'settings', label: isHindi ? 'सेटिंग्स' : 'Settings', icon: FiSettings },
  ];

  return (
    <div className={`user-dashboard theme-${uiPreferences.theme}`}>
      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div 
          className="sidebar-overlay" 
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <h2 className="sidebar-brand">ResolveIT</h2>
          <button 
            className="sidebar-toggle sidebar-close"
            onClick={() => setSidebarOpen(false)}
            title="Close sidebar"
          >
            <FiX size={20} />
          </button>
        </div>

        <nav className="sidebar-menu">
          {menuItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`menu-item ${activeSection === item.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveSection(item.id);
                  // Only close sidebar on mobile (width < 768px)
                  if (window.innerWidth < 768) {
                    setSidebarOpen(false);
                  }
                }}
              >
                <Icon className="menu-icon" size={20} />
                <span className="menu-label">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{user?.name?.charAt(0).toUpperCase()}</div>
            <div className="user-details">
              <p className="user-name">{user?.name}</p>
              <p className="user-role">Complainant</p>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            <FiLogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`main-content ${!sidebarOpen ? 'sidebar-closed' : ''}`}>
        {/* Top Bar */}
        <div className="top-bar">
          <button 
            className="menu-toggle"
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
          >
            <FiMenu size={20} />
          </button>
          <h1 className="page-title">{i18n.welcome}, {user?.name}!</h1>
          <div className="top-bar-right">
            <button
              className="theme-icon-btn"
              type="button"
              onClick={toggleTheme}
              aria-label={uiPreferences.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={uiPreferences.theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {uiPreferences.theme === 'dark' ? <FiSun size={18} /> : <FiMoon size={18} />}
            </button>
            <span className="user-email">{user?.email}</span>
          </div>
        </div>

        {/* Page Content */}
        <div className="page-content">
          {/* HOME SECTION */}
          {activeSection === 'home' && (
            <div className="section home-section">
              <div className="welcome-header">
                <h1>Hi {user?.name}, it's your Dashboard</h1>
                <p>Manage your complaints and track their progress</p>
              </div>

              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-icon total">
                    <FiFileText size={28} />
                  </div>
                  <div className="stat-content">
                    <p className="stat-label">Total Complaints</p>
                    <p className="stat-value">{stats.total}</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon pending">
                    <FiAlertCircle size={28} />
                  </div>
                  <div className="stat-content">
                    <p className="stat-label">Submitted</p>
                    <p className="stat-value">{stats.openOrPending}</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon progress">
                    <FiClock size={28} />
                  </div>
                  <div className="stat-content">
                    <p className="stat-label">In Progress</p>
                    <p className="stat-value">{stats.inProgress + stats.escalated}</p>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon resolved">
                    <FiCheckCircle size={28} />
                  </div>
                  <div className="stat-content">
                    <p className="stat-label">Resolved</p>
                    <p className="stat-value">{stats.resolved}</p>
                  </div>
                </div>
              </div>

              <div className="quick-actions">
                <h3>Quick Actions</h3>
                <div className="action-buttons">
                  <button 
                    className="action-btn primary"
                    onClick={() => setActiveSection('new-complaint')}
                  >
                    <FiPlus size={20} />
                    File New Complaint
                  </button>
                  <button 
                    className="action-btn secondary"
                    onClick={() => setActiveSection('complaints')}
                  >
                    <FiFileText size={20} />
                    View My Complaints
                  </button>
                  <button 
                    className="action-btn secondary"
                    onClick={() => setActiveSection('track')}
                  >
                    <FiClock size={20} />
                    Track Status
                  </button>
                </div>
              </div>

              <div className="info-section">
                <h3>Quick Tips</h3>
                <div className="tips-grid">
                  <div className="tip-card">
                    <h4>📝 Filing a Complaint</h4>
                    <p>Be specific and detailed in your complaint description to help us resolve it faster.</p>
                  </div>
                  <div className="tip-card">
                    <h4>⏱️ Response Time</h4>
                    <p>Most complaints are addressed within 24-48 hours of submission.</p>
                  </div>
                  <div className="tip-card">
                    <h4>🔔 Updates</h4>
                    <p>Check back regularly or use the Track Status feature for live updates.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* NEW COMPLAINT SECTION */}
          {activeSection === 'new-complaint' && (
            <div className="section new-complaint-section">
              <div className="section-header">
                <h1>File New Complaint</h1>
                <p>Submit your grievance and we'll help resolve it</p>
              </div>

              {message && (
                <div className={`message ${message.includes('✅') ? 'success' : 'error'}`}>
                  {message}
                </div>
              )}

              <form onSubmit={handleSubmitComplaint} className="complaint-form">
                <div className="form-section">
                  <label htmlFor="title" className="form-label">
                    Complaint Title *
                  </label>
                  <input
                    type="text"
                    id="title"
                    name="title"
                    value={formData.title}
                    onChange={handleNewComplaintChange}
                    placeholder="Brief title of your complaint"
                    required
                    className="form-input"
                  />
                </div>

                <div className="form-row">
                  <div className="form-section">
                    <label htmlFor="category" className="form-label">
                      Category *
                    </label>
                    <select
                      id="category"
                      name="category"
                      value={formData.category}
                      onChange={handleNewComplaintChange}
                      className="form-select"
                    >
                      {COMPLAINT_CATEGORIES.map((category) => (
                        <option key={category.value} value={category.value}>{category.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-section">
                    <label htmlFor="priority" className="form-label">
                      Priority *
                    </label>
                    <select
                      id="priority"
                      name="priority"
                      value={formData.priority}
                      onChange={handleNewComplaintChange}
                      className="form-select"
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>

                <div className="form-section">
                  <label htmlFor="description" className="form-label">
                    Description *
                  </label>
                  <textarea
                    id="description"
                    name="description"
                    value={formData.description}
                    onChange={handleNewComplaintChange}
                    placeholder="Provide detailed information about your complaint..."
                    required
                    className="form-textarea"
                    rows="8"
                  />
                </div>

                <div className="form-section">
                  <label htmlFor="proofFile" className="form-label" required>
                    Upload Proof (JPG, JPEG, PNG, PDF, DOC, DOCX)
                  </label>
                  <input
                    type="file"
                    id="proofFile"
                    name="proofFile"
                    accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
                    onChange={handleProofFileChange}
                    className="form-input"
                  />
                  {proofFile && (
                    <p className="file-helper-text">Selected: {proofFile.name}</p>
                  )}
                </div>

                <div className="form-actions">
                  <button 
                    type="submit" 
                    className="btn-submit"
                    disabled={loading}
                  >
                    {loading ? 'Submitting...' : 'Submit Complaint'}
                  </button>
                  <button 
                    type="button" 
                    className="btn-cancel"
                    onClick={() => {
                      setFormData({ title: '', description: '', category: 'network', priority: 'normal' });
                      setProofFile(null);
                      setActiveSection('home');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* VIEW COMPLAINTS SECTION */}
          {activeSection === 'complaints' && (
            <div className="section complaints-section">
              <div className="section-header">
                <h1>My Complaints</h1>
                <p>View all your filed complaints and their details</p>
              </div>

              {complaints.length > 0 && (
                <div className="complaints-list">
                  {complaints.map((complaint) => (
                    <div key={complaint.id} className="complaint-card">
                      <div className="complaint-header">
                        <h3>{getComplaintTitle(complaint)}</h3>
                        <span className={`priority-badge ${getComplaintPriority(complaint)}`}>
                          {getComplaintPriority(complaint).toUpperCase()}
                        </span>
                      </div>
                      <p className="complaint-description">{complaint.description}</p>
                      <div className="complaint-meta">
                        <span className="category-badge">{getComplaintCategoryLabel(complaint.category)}</span>
                        <span className="status-badge">{(complaint.status || 'open').toUpperCase()}</span>
                      </div>
                      <div className="complaint-detail-grid">
                        <p><strong>Complaint ID:</strong> {complaint.complaintCode || `#${complaint.id}`}</p>
                        <p><strong>Open Date:</strong> {formatDateTime(complaint.createdAt)}</p>
                        <p><strong>Created At:</strong> {formatDateTime(complaint.createdAt)}</p>
                        <p><strong>Updated At:</strong> {formatDateTime(complaint.updatedAt)}</p>
                        <p><strong>Resolved At:</strong> {formatDateTime(complaint.resolvedAt)}</p>
                        <p><strong>Assigned Staff:</strong> {complaint.assignedStaffName || 'Not assigned yet'}</p>
                      </div>
                      <div className="admin-reply-box">
                        <strong>Admin Reply:</strong> {complaint.adminReview || 'No admin reply yet'}
                      </div>
                      {!!getTimelineEntries(complaint).length && (
                        <div className="timeline-box">
                          <p className="timeline-title">Timeline</p>
                          {getTimelineEntries(complaint).map((log, idx) => (
                            <p key={`${complaint.id}-timeline-${idx}`} className="timeline-item">
                              {formatDateTime(log.when)} - {(log.status || log.eventType || '').toUpperCase()} - {log.comment || 'Status updated'}{log.actor ? ` (by ${log.actor})` : ''}
                            </p>
                          ))}
                        </div>
                      )}
                      {complaint.proofFileUrl && (
                        <div className="proof-file-row">
                          <span>Proof:</span>
                          <a
                            href={`${API_URL}${complaint.proofFileUrl}`}
                            target="_blank"
                            rel="noreferrer"
                            className="proof-file-link"
                          >
                            {complaint.proofFileName || 'View uploaded file'}
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {complaints.filter((item) => (item.status || '').toLowerCase() === 'resolved').length > 0 && (
                <div className="done-complaints-panel">
                  <h3>Resolved Complaints</h3>
                  {complaints
                    .filter((item) => (item.status || '').toLowerCase() === 'resolved')
                    .map((item) => (
                      <p key={`done-${item.id}`}>
                        {item.complaintCode || `#${item.id}`} - resolved on {formatDateTime(item.resolvedAt)}
                      </p>
                    ))}
                </div>
              )}

              {complaints.length === 0 && (
                <div className="empty-state">
                  <FiFileText size={48} />
                  <p>No complaints filed yet</p>
                  <button 
                    className="btn-primary"
                    onClick={() => setActiveSection('new-complaint')}
                  >
                    File Your First Complaint
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TRACK STATUS SECTION */}
          {activeSection === 'track' && (
            <div className="section track-section">
              <div className="section-header">
                <h1>Track Complaint Status</h1>
                <p>Monitor the progress of your complaints</p>
              </div>

              {complaints.length > 0 ? (
                <div className="tracking-list">
                  {complaints.map((complaint, index) => (
                    <div key={complaint.id} className="tracking-card">
                      <div className="tracking-header">
                        <h3>{getComplaintTitle(complaint)}</h3>
                        <span className="tracking-id">ID: {complaint.complaintCode || `#${complaint.id || 1000 + index}`}</span>
                      </div>
                      <div className="status-summary-card">
                        <p className="status-summary-label">Status</p>
                        <p className="status-summary-value">{getStatusDisplayLabel(complaint.status)}</p>
                      </div>

                      {(() => {
                        const timelineEntries = getTimelineEntries(complaint);
                        const stages = [
                          { key: 'open', label: 'Complaint Submitted' },
                          { key: 'pending', label: 'Pending' },
                          { key: 'inprogress', label: 'In Progress' },
                          { key: 'escalated', label: 'Escalated' },
                          { key: 'resolved', label: 'Resolved' },
                        ];

                        const statusDateMap = {};
                        timelineEntries.forEach((entry) => {
                          if (entry.status) {
                            statusDateMap[(entry.status || '').toLowerCase()] = entry.when;
                          }
                        });

                        const currentStage = getStatusStage(complaint.status);
                        const sortedUpdates = [...timelineEntries].sort(
                          (a, b) => new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime()
                        );

                        return (
                          <>
                            <div className="status-vertical-timeline">
                              {stages.map((stage, stageIndex) => {
                                const completed = currentStage >= stageIndex + 1;
                                const active = currentStage === stageIndex + 1;
                                return (
                                  <div
                                    key={`${complaint.id}-stage-${stage.key}`}
                                    className={`status-stage ${completed ? 'completed' : ''}`}
                                  >
                                    <div className={`status-stage-dot ${active ? 'active' : ''}`}></div>
                                    <div className="status-stage-content">
                                      <p className="status-stage-title">{stage.label}</p>
                                      <p className="status-stage-date">
                                        {statusDateMap[stage.key] ? formatDateTime(statusDateMap[stage.key]) : 'Waiting'}
                                      </p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="updates-section">
                              <h4>Updates</h4>
                              {sortedUpdates.length === 0 && (
                                <p className="update-description">No updates yet</p>
                              )}
                              {sortedUpdates.map((log, idx) => (
                                <div key={`${complaint.id}-update-${idx}`} className="update-item">
                                  <p className="update-title">
                                    {log.eventType === 'comment'
                                      ? 'Admin Update'
                                      : getStatusDisplayLabel(log.status)}
                                  </p>
                                  <p className="update-description">
                                    {log.comment || 'Complaint status updated'}
                                    {log.actor ? ` (by ${log.actor})` : ''}
                                  </p>
                                  <p className="update-date">{formatDateTime(log.when)}</p>
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <FiClock size={48} />
                  <p>No complaints to track</p>
                  <button 
                    className="btn-primary"
                    onClick={() => setActiveSection('new-complaint')}
                  >
                    File a Complaint
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ANALYTICS SECTION */}
          {activeSection === 'analytics' && (
            <div className="section analytics-section">
              <div className="section-header">
                <h1>Analytics & Insights</h1>
                <p>Your complaint statistics and trends</p>
              </div>

              <div className="analytics-grid">
                <div className="analytics-card">
                  <h3>Resolution Rate</h3>
                  <div className="chart-placeholder">
                    <p>{stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0}%</p>
                    <small>of complaints resolved</small>
                  </div>
                </div>

                <div className="analytics-card">
                  <h3>Average Response Time</h3>
                  <div className="chart-placeholder">
                    <p>24-48h</p>
                    <small>typical response</small>
                  </div>
                </div>

                <div className="analytics-card">
                  <h3>Total Complaints</h3>
                  <div className="chart-placeholder">
                    <p>{stats.total}</p>
                    <small>filed this month</small>
                  </div>
                </div>

                <div className="analytics-card">
                  <h3>Current Status</h3>
                  <div className="chart-placeholder">
                    <p>{stats.openOrPending + stats.inProgress + stats.escalated}</p>
                    <small>active cases</small>
                  </div>
                </div>
              </div>

              <div className="status-breakdown">
                <h3>Status Breakdown</h3>
                <div className="breakdown-chart">
                  <div className="breakdown-item">
                    <span className="label">Open/Pending</span>
                    <div className="bar-container">
                      <div className="bar pending" style={{ width: `${stats.total > 0 ? (stats.openOrPending / stats.total) * 100 : 0}%` }}></div>
                    </div>
                    <span className="value">{stats.openOrPending}</span>
                  </div>
                  <div className="breakdown-item">
                    <span className="label">In Progress</span>
                    <div className="bar-container">
                      <div className="bar progress" style={{ width: `${stats.total > 0 ? (stats.inProgress / stats.total) * 100 : 0}%` }}></div>
                    </div>
                    <span className="value">{stats.inProgress}</span>
                  </div>
                  <div className="breakdown-item">
                    <span className="label">Resolved</span>
                    <div className="bar-container">
                      <div className="bar resolved" style={{ width: `${stats.total > 0 ? (stats.resolved / stats.total) * 100 : 0}%` }}></div>
                    </div>
                    <span className="value">{stats.resolved}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ACCOUNT SECTION */}
          {activeSection === 'account' && (
            <div className="section account-section">
              <div className="section-header">
                <h1>My Account</h1>
                <p>View and manage your account information</p>
              </div>

              <div className="account-info">
                <div className="profile-section">
                  <div className="profile-avatar">{user?.name?.charAt(0).toUpperCase()}</div>
                  <div className="profile-info">
                    <h2>{user?.name}</h2>
                    <p>{user?.email}</p>
                    <p className="role">Role: {user?.role || 'Complainant'}</p>
                  </div>
                </div>

                <div className="account-details">
                  <h3>Account Information</h3>
                  <div className="info-item">
                    <label>Full Name</label>
                    <p>{user?.name}</p>
                  </div>
                  <div className="info-item">
                    <label>Email Address</label>
                    <p>{user?.email}</p>
                  </div>
                  <div className="info-item">
                    <label>User ID</label>
                    <p>#{user?.userId}</p>
                  </div>
                  <div className="info-item">
                    <label>Account Status</label>
                    <p className="status-active">Active</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SETTINGS SECTION */}
          {activeSection === 'settings' && (
            <div className="section settings-section">
              <div className="section-header">
                <h1>{i18n.settingsTitle}</h1>
                <p>{i18n.settingsSubtitle}</p>
              </div>

              <div className="settings-grid">
                <div className="setting-card">
                  <h3>{i18n.notifications}</h3>
                  <div className="setting-item">
                    <label htmlFor="email-notif" className="checkbox-label">
                      <input
                        type="checkbox"
                        id="email-notif"
                        checked={Boolean(userSettings.emailNotifications)}
                        onChange={(event) => updateUserSetting('emailNotifications', event.target.checked)}
                      />
                      <span>{i18n.emailNotifications}</span>
                    </label>
                  </div>
                  <div className="setting-item">
                    <label htmlFor="sms-notif" className="checkbox-label">
                      <input
                        type="checkbox"
                        id="sms-notif"
                        checked={Boolean(userSettings.smsNotifications)}
                        onChange={(event) => updateUserSetting('smsNotifications', event.target.checked)}
                      />
                      <span>{i18n.smsNotifications}</span>
                    </label>
                  </div>
                </div>

                <div className="setting-card">
                  <h3>{i18n.privacy}</h3>
                  <div className="setting-item">
                    <label htmlFor="profile-private" className="checkbox-label">
                      <input
                        type="checkbox"
                        id="profile-private"
                        checked={Boolean(userSettings.profilePrivate)}
                        onChange={(event) => updateUserSetting('profilePrivate', event.target.checked)}
                      />
                      <span>{i18n.profilePrivate}</span>
                    </label>
                  </div>
                  <div className="setting-item">
                    <form className="password-form" onSubmit={handleChangePassword}>
                      <input
                        type="password"
                        name="currentPassword"
                        className="form-input"
                        placeholder={i18n.currentPassword}
                        value={passwordForm.currentPassword}
                        onChange={handlePasswordFieldChange}
                      />
                      <input
                        type="password"
                        name="newPassword"
                        className="form-input"
                        placeholder={i18n.newPassword}
                        value={passwordForm.newPassword}
                        onChange={handlePasswordFieldChange}
                      />
                      <input
                        type="password"
                        name="confirmNewPassword"
                        className="form-input"
                        placeholder={i18n.confirmPassword}
                        value={passwordForm.confirmNewPassword}
                        onChange={handlePasswordFieldChange}
                      />
                      <button className="link-btn" type="submit" disabled={passwordLoading}>
                        {passwordLoading ? i18n.changing : i18n.changePassword}
                      </button>
                    </form>
                    {settingsMessage && (
                      <p className={`settings-message ${settingsMessageType}`}>{settingsMessage}</p>
                    )}
                  </div>
                </div>

                <div className="setting-card">
                  <h3>{i18n.preferences}</h3>
                  <div className="setting-item">
                    <label htmlFor="language" className="form-label">{i18n.language}</label>
                    <select
                      id="language"
                      className="form-select"
                      value={uiPreferences.language}
                      onChange={(event) => handleLanguageChange(event.target.value)}
                    >
                      <option value="en">English</option>
                      <option value="hi">Hindi</option>
                    </select>
                  </div>
                  <div className="setting-item">
                    <label htmlFor="theme" className="form-label">{i18n.theme}</label>
                    <button
                      id="theme"
                      className="theme-icon-btn settings-theme-btn"
                      type="button"
                      onClick={toggleTheme}
                      aria-label={uiPreferences.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                      title={uiPreferences.theme === 'dark' ? 'Light mode' : 'Dark mode'}
                    >
                      {uiPreferences.theme === 'dark' ? <FiSun size={18} /> : <FiMoon size={18} />}
                      <span>{uiPreferences.theme === 'dark' ? 'Dark' : 'Light'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default UDashboard;
