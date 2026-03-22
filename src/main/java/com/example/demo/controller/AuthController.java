package com.example.demo.controller;

import com.example.demo.dto.AuthResponse;
import com.example.demo.dto.ChangePasswordRequest;
import com.example.demo.dto.LoginRequest;
import com.example.demo.dto.RegisterRequest;
import com.example.demo.service.AuthService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/**
 * Authentication Controller
 * Handles user registration and login endpoints
 * Base URL: /api/auth
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private AuthService authService;

    /**
     * Register new user
     * POST /api/auth/register
     * @param registerRequest User registration details (name, email, password)
     * @return ResponseEntity with AuthResponse
     */
    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody RegisterRequest registerRequest) {
        try {
            // Log incoming request
            System.out.println("Registration request received:");
            System.out.println("  Name: " + (registerRequest.getName() != null ? registerRequest.getName() : "null"));
            System.out.println("  Email: " + (registerRequest.getEmail() != null ? registerRequest.getEmail() : "null"));
            System.out.println("  Role: " + (registerRequest.getRole() != null ? registerRequest.getRole() : "null"));
            
            // Validate input
            if (registerRequest.getName() == null || registerRequest.getName().trim().isEmpty()) {
                return ResponseEntity.badRequest().body("Name is required");
            }
            if (registerRequest.getEmail() == null || registerRequest.getEmail().trim().isEmpty()) {
                return ResponseEntity.badRequest().body("Email is required");
            }
            if (registerRequest.getPassword() == null || registerRequest.getPassword().length() < 6) {
                return ResponseEntity.badRequest().body("Password must be at least 6 characters");
            }

            AuthResponse response = authService.register(registerRequest);
            System.out.println("Registration successful for: " + registerRequest.getEmail());
            return ResponseEntity.status(HttpStatus.CREATED).body(response);

        } catch (RuntimeException e) {
            System.err.println("Registration error: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(e.getMessage());
        } catch (Exception e) {
            System.err.println("Registration exception: " + e.getMessage());
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Registration failed: " + e.getMessage());
        }
    }

    /**
     * Login user
     * POST /api/auth/login
     * @param loginRequest User login credentials (email, password)
     * @return ResponseEntity with JWT token and user details
     */
    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest loginRequest) {
        try {
            // Validate input
            if (loginRequest.getEmail() == null || loginRequest.getEmail().trim().isEmpty()) {
                return ResponseEntity.badRequest().body("Email is required");
            }
            if (loginRequest.getPassword() == null || loginRequest.getPassword().trim().isEmpty()) {
                return ResponseEntity.badRequest().body("Password is required");
            }

            AuthResponse response = authService.login(loginRequest);
            return ResponseEntity.ok(response);

        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Login failed: " + e.getMessage());
        }
    }

    /**
     * Validate JWT token
     * GET /api/auth/validate
     * @param token JWT token from Authorization header
     * @return ResponseEntity with validation status
     */
    @GetMapping("/validate")
    public ResponseEntity<?> validateToken(@RequestHeader("Authorization") String token) {
        try {
            // Remove "Bearer " prefix if present
            if (token.startsWith("Bearer ")) {
                token = token.substring(7);
            }

            boolean isValid = authService.validateToken(token);
            if (isValid) {
                return ResponseEntity.ok("Token is valid");
            } else {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Invalid token");
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Token validation failed");
        }
    }

    @PutMapping("/change-password")
    public ResponseEntity<?> changePassword(
            @RequestBody ChangePasswordRequest request,
            Authentication authentication
    ) {
        try {
            if (authentication == null || authentication.getName() == null || authentication.getName().trim().isEmpty()) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Authentication required");
            }

            authService.changePassword(
                    authentication.getName(),
                    request.getCurrentPassword(),
                    request.getNewPassword()
            );
            return ResponseEntity.ok("Password changed successfully");
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Password change failed: " + e.getMessage());
        }
    }

    /**
     * Health check endpoint
     * GET /api/auth/health
     */
    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("Auth service is running");
    }
}
