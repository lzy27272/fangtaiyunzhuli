package cn.sifangguan.hotelaios.shared.api;

import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.security.AccessDeniedException;
import jakarta.validation.ConstraintViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler({AccessDeniedException.class})
    ProblemDetail forbidden(RuntimeException exception) {
        return problem(HttpStatus.FORBIDDEN, "访问被拒绝", exception.getMessage());
    }

    @ExceptionHandler({EmptyResultDataAccessException.class})
    ProblemDetail notFound(RuntimeException exception) {
        return problem(HttpStatus.NOT_FOUND, "资源不存在", "目标资源不存在或不属于当前租户");
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, ConstraintViolationException.class, IllegalArgumentException.class})
    ProblemDetail invalid(Exception exception) {
        return problem(HttpStatus.BAD_REQUEST, "请求校验失败", exception.getMessage());
    }

    @ExceptionHandler(TenantContext.MissingTenantContextException.class)
    ProblemDetail context(TenantContext.MissingTenantContextException exception) {
        return problem(HttpStatus.UNAUTHORIZED, "身份上下文缺失", exception.getMessage());
    }

    private ProblemDetail problem(HttpStatus status, String title, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail == null ? title : detail);
        problem.setTitle(title);
        return problem;
    }
}

