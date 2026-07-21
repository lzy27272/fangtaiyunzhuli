package cn.sifangguan.hotelaios.shared.context;

import java.util.Optional;

public final class TenantContext {
    private static final ThreadLocal<TenantPrincipal> CURRENT = new ThreadLocal<>();

    private TenantContext() {
    }

    public static void set(TenantPrincipal principal) {
        CURRENT.set(principal);
    }

    public static TenantPrincipal require() {
        TenantPrincipal principal = CURRENT.get();
        if (principal == null) {
            throw new MissingTenantContextException("缺少租户请求上下文");
        }
        return principal;
    }

    public static Optional<TenantPrincipal> current() {
        return Optional.ofNullable(CURRENT.get());
    }

    public static void clear() {
        CURRENT.remove();
    }

    public static final class MissingTenantContextException extends RuntimeException {
        public MissingTenantContextException(String message) {
            super(message);
        }
    }
}
