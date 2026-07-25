package cn.sifangguan.ota.api.sprint1.web;

import cn.sifangguan.ota.api.sprint1.application.IdempotencyConflictException;
import cn.sifangguan.ota.api.sprint1.application.RowVersionConflictException;
import cn.sifangguan.ota.api.sprint1.application.Sprint1ResourceNotFoundException;
import cn.sifangguan.ota.api.sprint1.config.SimulationUnavailableException;
import jakarta.validation.ConstraintViolationException;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = Sprint1Controller.class)
public class Sprint1ExceptionHandler {
    @ExceptionHandler(Sprint1ResourceNotFoundException.class)
    ProblemDetail notFound() {
        return problem(HttpStatus.NOT_FOUND, "Resource not found", "OTA_RESOURCE_NOT_FOUND");
    }

    @ExceptionHandler(IdempotencyConflictException.class)
    ProblemDetail idempotencyConflict() {
        return problem(HttpStatus.CONFLICT, "Idempotency key conflict", "IDEMPOTENCY_KEY_CONFLICT");
    }

    @ExceptionHandler(RowVersionConflictException.class)
    ProblemDetail rowVersionConflict() {
        return problem(HttpStatus.CONFLICT, "Row version conflict", "ROW_VERSION_CONFLICT");
    }

    @ExceptionHandler(DuplicateKeyException.class)
    ProblemDetail databaseConflict() {
        return problem(HttpStatus.CONFLICT, "Configuration conflict", "CONFIGURATION_CONFLICT");
    }

    @ExceptionHandler(SimulationUnavailableException.class)
    ProblemDetail simulationUnavailable() {
        return problem(HttpStatus.CONFLICT, "Simulation unavailable", "SIMULATION_UNAVAILABLE");
    }

    @ExceptionHandler(SecurityException.class)
    ProblemDetail forbidden() {
        return problem(HttpStatus.FORBIDDEN, "Access denied", "ACCESS_DENIED");
    }

    @ExceptionHandler({IllegalArgumentException.class, ConstraintViolationException.class})
    ProblemDetail invalidRequest() {
        return problem(HttpStatus.BAD_REQUEST, "Request validation failed", "INVALID_REQUEST");
    }

    @ExceptionHandler(DataAccessException.class)
    ProblemDetail databaseUnavailable() {
        return problem(
                HttpStatus.SERVICE_UNAVAILABLE,
                "OTA data service unavailable",
                "OTA_DATA_UNAVAILABLE");
    }

    private static ProblemDetail problem(HttpStatus status, String title, String code) {
        ProblemDetail detail = ProblemDetail.forStatusAndDetail(status, title);
        detail.setTitle(title);
        detail.setProperty("code", code);
        return detail;
    }
}
