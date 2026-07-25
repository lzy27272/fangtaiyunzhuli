package cn.sifangguan.ota.api.auth.web;

import cn.sifangguan.ota.api.config.OtaSecurityProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

public final class CookieRequestGuard {
    public static final String CSRF_HEADER = "X-CSRF-TOKEN";
    private final OtaSecurityProperties properties;

    public CookieRequestGuard(OtaSecurityProperties properties) {
        this.properties = properties;
    }

    public String requireRefreshToken(HttpServletRequest request) {
        return requireCookie(request, properties.getCookie().getRefreshName());
    }

    public void verifyCsrf(HttpServletRequest request) {
        String header = request.getHeader(CSRF_HEADER);
        String cookie = requireCookie(request, properties.getCookie().getCsrfName());
        if (header == null || header.isBlank() || header.length() > 512) {
            throw new InvalidCsrfTokenException();
        }
        byte[] headerBytes = header.getBytes(StandardCharsets.UTF_8);
        byte[] cookieBytes = cookie.getBytes(StandardCharsets.UTF_8);
        try {
            if (!MessageDigest.isEqual(headerBytes, cookieBytes)) {
                throw new InvalidCsrfTokenException();
            }
        } finally {
            Arrays.fill(headerBytes, (byte) 0);
            Arrays.fill(cookieBytes, (byte) 0);
        }
    }

    public void verifyOriginWhenPresent(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin != null && !properties.getCors().getAllowedOrigins().contains(origin)) {
            throw new UntrustedOriginException();
        }
    }

    private static String requireCookie(HttpServletRequest request, String cookieName) {
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie cookie : cookies) {
                if (cookieName.equals(cookie.getName())
                        && cookie.getValue() != null
                        && !cookie.getValue().isBlank()
                        && cookie.getValue().length() <= 512) {
                    return cookie.getValue();
                }
            }
        }
        throw new InvalidCsrfTokenException();
    }
}
