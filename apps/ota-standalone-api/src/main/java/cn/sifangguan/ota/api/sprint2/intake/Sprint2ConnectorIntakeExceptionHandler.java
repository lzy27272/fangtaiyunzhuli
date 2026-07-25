package cn.sifangguan.ota.api.sprint2.intake;

import cn.sifangguan.ota.api.sprint1.application.IdempotencyConflictException;
import cn.sifangguan.ota.api.sprint1.application.RowVersionConflictException;
import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = {
        Sprint2ConnectorIntakeController.class,
        Sprint2ConnectorAdmissionController.class
})
public class Sprint2ConnectorIntakeExceptionHandler {
    @ExceptionHandler(Sprint2ExternalActionBlockedException.class)
    ProblemDetail externalActionBlocked() {
        return problem(
                HttpStatus.CONFLICT,
                "External connector action is blocked",
                "SPRINT2_EXTERNAL_ACTION_BLOCKED");
    }

    @ExceptionHandler(ConnectorIntakeStorageUnavailableException.class)
    ProblemDetail storageUnavailable() {
        return problem(
                HttpStatus.SERVICE_UNAVAILABLE,
                "Connector intake storage is unavailable",
                "CONNECTOR_INTAKE_STORAGE_UNAVAILABLE");
    }

    @ExceptionHandler(IdempotencyConflictException.class)
    ProblemDetail idempotencyConflict() {
        return problem(
                HttpStatus.CONFLICT,
                "Idempotency key conflict",
                "IDEMPOTENCY_KEY_CONFLICT");
    }

    @ExceptionHandler(RowVersionConflictException.class)
    ProblemDetail rowVersionConflict() {
        return problem(
                HttpStatus.CONFLICT,
                "Row version conflict",
                "ROW_VERSION_CONFLICT");
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
