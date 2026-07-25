package cn.sifangguan.ota.api.auth.web;

import cn.sifangguan.ota.api.auth.application.AuthenticationRejectedException;
import cn.sifangguan.ota.api.auth.application.LoginRateLimitedException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class AuthExceptionHandler {
    @ExceptionHandler(AuthenticationRejectedException.class)
    ProblemDetail authenticationRejected() {
        return problem(HttpStatus.UNAUTHORIZED, "Authentication failed", "AUTHENTICATION_REJECTED");
    }

    @ExceptionHandler(LoginRateLimitedException.class)
    ResponseEntity<ProblemDetail> loginRateLimited(LoginRateLimitedException exception) {
        ProblemDetail detail = problem(
                HttpStatus.TOO_MANY_REQUESTS, "Too many login attempts", "LOGIN_RATE_LIMITED");
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, Long.toString(exception.retryAfterSeconds()))
                .body(detail);
    }

    @ExceptionHandler({InvalidCsrfTokenException.class, UntrustedOriginException.class})
    ProblemDetail requestForgeryRejected() {
        return problem(HttpStatus.FORBIDDEN, "Request verification failed", "REQUEST_VERIFICATION_FAILED");
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail invalidRequest() {
        return problem(HttpStatus.BAD_REQUEST, "Request validation failed", "INVALID_REQUEST");
    }

    private static ProblemDetail problem(HttpStatus status, String title, String code) {
        ProblemDetail detail = ProblemDetail.forStatusAndDetail(status, title);
        detail.setTitle(title);
        detail.setProperty("code", code);
        return detail;
    }
}
