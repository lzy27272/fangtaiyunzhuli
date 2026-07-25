package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes =
        BrowserAuthorizationRehearsalController.class)
public class BrowserAuthorizationRehearsalExceptionHandler {
    @ExceptionHandler(BrowserAuthorizationRehearsalNotFoundException.class)
    ProblemDetail notFound() {
        return problem(
                HttpStatus.NOT_FOUND,
                "Offline authorization rehearsal was not found",
                "OFFLINE_AUTHORIZATION_REHEARSAL_NOT_FOUND");
    }

    @ExceptionHandler(BrowserAuthorizationRehearsalConflictException.class)
    ProblemDetail conflict(
            BrowserAuthorizationRehearsalConflictException exception
    ) {
        return problem(
                HttpStatus.CONFLICT,
                "Offline authorization rehearsal conflict",
                exception.code());
    }

    @ExceptionHandler(BrowserAuthorizationRehearsalStorageException.class)
    ProblemDetail storageUnavailable() {
        return problem(
                HttpStatus.SERVICE_UNAVAILABLE,
                "Offline authorization rehearsal storage is unavailable",
                "OFFLINE_AUTHORIZATION_REHEARSAL_STORAGE_UNAVAILABLE");
    }

    @ExceptionHandler(SecurityException.class)
    ProblemDetail forbidden() {
        return problem(HttpStatus.FORBIDDEN, "Access denied", "ACCESS_DENIED");
    }

    @ExceptionHandler({
            IllegalArgumentException.class,
            ConstraintViolationException.class,
            HttpMessageNotReadableException.class
    })
    ProblemDetail invalidRequest() {
        return problem(
                HttpStatus.BAD_REQUEST,
                "Request validation failed",
                "INVALID_REQUEST");
    }

    private static ProblemDetail problem(
            HttpStatus status,
            String title,
            String code
    ) {
        ProblemDetail detail = ProblemDetail.forStatusAndDetail(status, title);
        detail.setTitle(title);
        detail.setProperty("code", code);
        return detail;
    }
}
