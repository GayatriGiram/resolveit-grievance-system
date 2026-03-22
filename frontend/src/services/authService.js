import axios from 'axios';
import API_URL from './apiConfig';

/**
 * Authentication Service for ResolveIT Grievance Management System
 * Handles all authentication-related API calls
 */

// Base URL for the backend API
const API_BASE_URL = `${API_URL}/api/auth`;

// Create axios instance with default configuration
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Register a new user
 * @param {Object} userData - User registration data
 * @param {string} userData.name - User's full name
 * @param {string} userData.email - User's email
 * @param {string} userData.password - User's password
 * @param {string} userData.role - User's role (user, admin, staff)
 * @returns {Promise} Response with user data
 */
export const register = async (userData) => {
  try {
    const response = await api.post('/register', userData);
    return {
      success: true,
      data: response.data,
      message: 'Registration successful',
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data || 'Registration failed. Please try again.',
    };
  }
};

/**
 * Login user
 * @param {Object} credentials - User login credentials
 * @param {string} credentials.email - User's email
 * @param {string} credentials.password - User's password
 * @param {string} credentials.role - User's role (user, admin, staff)
 * @returns {Promise} Response with JWT token and user data
 */
export const login = async (credentials) => {
  try {
    const response = await api.post('/login', credentials);
    
    if (response.data && response.data.token) {
      // Store JWT token in localStorage
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('userId', response.data.userId);
      localStorage.setItem('staffId', response.data.staffId || '');
      localStorage.setItem('userName', response.data.name);
      localStorage.setItem('userEmail', response.data.email);
      localStorage.setItem('userRole', response.data.role);
      
      return {
        success: true,
        data: response.data,
        message: 'Login successful',
      };
    }
    
    return {
      success: false,
      message: 'Invalid response from server',
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data || 'Login failed. Please check your credentials.',
    };
  }
};

/**
 * Logout user
 * Clears all authentication data from localStorage
 */
export const logout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('userId');
  localStorage.removeItem('staffId');
  localStorage.removeItem('userName');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userRole');
};

/**
 * Get stored JWT token
 * @returns {string|null} JWT token or null if not found
 */
export const getToken = () => {
  return localStorage.getItem('token');
};

/**
 * Get stored user data
 * @returns {Object|null} User data or null if not found
 */
export const getCurrentUser = () => {
  const token = getToken();
  
  if (!token) {
    return null;
  }
  
  return {
    userId: localStorage.getItem('userId'),
    staffId: localStorage.getItem('staffId'),
    name: localStorage.getItem('userName'),
    email: localStorage.getItem('userEmail'),
    role: localStorage.getItem('userRole'),
    token: token,
  };
};

/**
 * Check if user is authenticated
 * @returns {boolean} True if user is authenticated
 */
export const isAuthenticated = () => {
  return getToken() !== null;
};

/**
 * Validate JWT token
 * @returns {Promise<boolean>} True if token is valid
 */
export const validateToken = async () => {
  const token = getToken();
  
  if (!token) {
    return false;
  }
  
  try {
    const response = await api.get('/validate', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.status === 200;
  } catch (error) {
    logout(); // Clear invalid token
    return false;
  }
};

export const changePassword = async ({ currentPassword, newPassword }) => {
  try {
    const response = await api.put('/change-password', {
      currentPassword,
      newPassword,
    });

    return {
      success: true,
      message: response.data || 'Password changed successfully',
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data || 'Failed to change password. Please try again.',
    };
  }
};

/**
 * Axios interceptor to add JWT token to all requests
 */
api.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Axios interceptor to handle unauthorized responses
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      logout();
      window.location.href = '/'; // Redirect to login
    }
    return Promise.reject(error);
  }
);

export default api;
