package com.example.demo.service;

import com.example.demo.dto.AuthResponse;
import com.example.demo.dto.LoginRequest;
import com.example.demo.dto.RegisterRequest;
import com.example.demo.model.User;
import com.example.demo.repository.UserRepository;
import com.example.demo.util.JwtUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.Random;

/**
 * Authentication Service
 * Handles user registration and login logic
 */
@Service
public class AuthService {

    private static final String STAFF_ID_PREFIX = "STF";
    private static final String SPECIAL_ADMIN_EMAIL = "abhishekgupta.1856@outlook.com";
    private static final String RANDOM_ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private final Random random = new Random();

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtUtil jwtUtil;

    /**
     * Register a new user
     * @param registerRequest Registration details
     * @return AuthResponse with success message
     * @throws RuntimeException if email already exists
     */
    public AuthResponse register(RegisterRequest registerRequest) {
        String normalizedEmail = normalizeEmail(registerRequest.getEmail());

        // Check if email already exists
        if (userRepository.existsByEmail(normalizedEmail)) {
            throw new RuntimeException("Email already registered");
        }

        // Create new user with encrypted password
        User user = new User();
        user.setName(registerRequest.getName());
        user.setEmail(normalizedEmail);
        user.setPassword(passwordEncoder.encode(registerRequest.getPassword())); // BCrypt encryption

        // Role is derived from email domain.
        String role = resolveRoleByEmail(normalizedEmail);
        user.setRole(role);
        if ("STAFF".equals(role)) {
            user.setStaffId(generateStaffId());
        }
        user.setIsActive(true);

        // Save user to database
        User savedUser = userRepository.save(user);

        // Return success response
        return new AuthResponse(
                "Registration successful",
                savedUser.getId(),
                savedUser.getEmail()
        );
    }

    /**
     * Login user and generate JWT token
     * @param loginRequest Login credentials
     * @return AuthResponse with JWT token
     * @throws RuntimeException if credentials are invalid
     */
    public AuthResponse login(LoginRequest loginRequest) {
        String normalizedEmailInput = normalizeEmail(loginRequest.getEmail());

        // Find user by email
        User user = userRepository.findByEmail(normalizedEmailInput)
                .orElseThrow(() -> new RuntimeException("Invalid email or password"));

        // Verify password using BCrypt
        if (!passwordEncoder.matches(loginRequest.getPassword(), user.getPassword())) {
            throw new RuntimeException("Invalid email or password");
        }

        // Check if user is active
        if (!user.getIsActive()) {
            throw new RuntimeException("User account is inactive");
        }

        String normalizedRole = user.getRole() == null ? "" : user.getRole().trim().toUpperCase(Locale.ENGLISH);
        if (normalizedRole.isBlank()) {
            normalizedRole = resolveRoleByEmail(user.getEmail());
            user.setRole(normalizedRole);
        }

        if ("STAFF".equals(normalizedRole) && (user.getStaffId() == null || user.getStaffId().isBlank())) {
            user.setStaffId(generateStaffId());
        }

        if ("ADMIN".equals(normalizedRole) || "USER".equals(normalizedRole)) {
            user.setStaffId(null);
        }

        user = userRepository.save(user);

        // Note: Role is determined by user's role in database, not by login request
        // This ensures security - users cannot claim a role they don't have

        // Generate JWT token with userId, email, and role from database
        String token = jwtUtil.generateToken(user.getId(), user.getEmail(), user.getRole());

        // Return response with token and user details
        return new AuthResponse(
                token,
                user.getId(),
                user.getStaffId(),
                user.getName(),
                user.getEmail(),
                user.getRole()
        );
    }

    private String generateStaffId() {
        String id;
        int attempts = 0;
        do {
            StringBuilder randomPart = new StringBuilder();
            for (int i = 0; i < 8; i++) {
                randomPart.append(RANDOM_ALNUM.charAt(random.nextInt(RANDOM_ALNUM.length())));
            }
            id = STAFF_ID_PREFIX + randomPart.toString().toUpperCase(Locale.ENGLISH);
            attempts++;
            if (attempts > 20) {
                throw new RuntimeException("Could not generate unique staff ID");
            }
        } while (userRepository.existsByStaffId(id));

        return id;
    }

    private String normalizeEmail(String email) {
        if (email == null || email.trim().isEmpty()) {
            throw new RuntimeException("Email is required");
        }
        String normalized = email.trim().toLowerCase(Locale.ENGLISH);
        if (!normalized.contains("@") || !normalized.contains(".")) {
            throw new RuntimeException("A valid email is required");
        }
        return normalized;
    }

    private String resolveRoleByEmail(String email) {
        String normalized = normalizeEmail(email);
        if (SPECIAL_ADMIN_EMAIL.equals(normalized)) {
            return "ADMIN";
        }
        if (normalized.endsWith("@admin.com")) {
            return "ADMIN";
        }
        if (normalized.endsWith("@staff.com")) {
            return "STAFF";
        }
        return "USER";
    }

    /**
     * Validate JWT token
     * @param token JWT token
     * @return true if valid
     */
    public boolean validateToken(String token) {
        return jwtUtil.validateToken(token);
    }

    /**
     * Get user details from token
     * @param token JWT token
     * @return User object
     */
    public User getUserFromToken(String token) {
        String email = jwtUtil.extractEmail(token);
        return userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found"));
    }

    public void changePassword(String email, String currentPassword, String newPassword) {
        String normalizedEmail = normalizeEmail(email);

        if (currentPassword == null || currentPassword.trim().isEmpty()) {
            throw new RuntimeException("Current password is required");
        }

        if (newPassword == null || newPassword.length() < 6) {
            throw new RuntimeException("New password must be at least 6 characters");
        }

        if (currentPassword.equals(newPassword)) {
            throw new RuntimeException("New password must be different from current password");
        }

        User user = userRepository.findByEmail(normalizedEmail)
                .orElseThrow(() -> new RuntimeException("User not found"));

        if (!passwordEncoder.matches(currentPassword, user.getPassword())) {
            throw new RuntimeException("Current password is incorrect");
        }

        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);
    }
}
