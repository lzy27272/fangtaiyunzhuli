package cn.sifangguan.hotelaios.shared.context;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class TenantContextFilterTest {
    private final TenantContextFilter filter = new TenantContextFilter(true);

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    @Test
    void buildsAndClearsTenantContext() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/org/units");
        request.addHeader("X-Tenant-Id", tenantId.toString());
        request.addHeader("X-Actor-Id", actorId.toString());
        request.addHeader("X-Role-Code", "GENERAL_MANAGER");
        request.addHeader("X-Org-Scope", hotelId.toString());
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<TenantPrincipal> captured = new AtomicReference<>();

        filter.doFilter(request, response, (req, res) -> captured.set(TenantContext.require()));

        assertEquals(tenantId, captured.get().tenantId());
        assertEquals(actorId, captured.get().actorId());
        assertEquals("GENERAL_MANAGER", captured.get().roleCode());
        assertTrue(captured.get().orgScopes().contains(hotelId));
        assertNotNull(response.getHeader("X-Correlation-Id"));
        assertThrows(TenantContext.MissingTenantContextException.class, TenantContext::require);
    }

    @Test
    void rejectsMissingTenantHeader() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/org/units");
        request.addHeader("X-Actor-Id", UUID.randomUUID().toString());
        request.addHeader("X-Role-Code", "CEO");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (req, res) -> fail("请求不应进入业务链"));

        assertEquals(400, response.getStatus());
        assertTrue(response.getContentAsString().contains("X-Tenant-Id"));
    }

    @Test
    void failsClosedWhenDevelopmentHeaderAuthenticationIsDisabled() throws Exception {
        TenantContextFilter disabled = new TenantContextFilter(false);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/org/units");
        MockHttpServletResponse response = new MockHttpServletResponse();

        disabled.doFilter(request, response, (req, res) -> fail("请求不应进入业务链"));

        assertEquals(401, response.getStatus());
    }
}
