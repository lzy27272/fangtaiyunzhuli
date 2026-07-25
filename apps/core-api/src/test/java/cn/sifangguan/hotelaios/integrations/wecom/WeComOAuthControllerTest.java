package cn.sifangguan.hotelaios.integrations.wecom;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.net.URI;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class WeComOAuthControllerTest {
    @Test
    void startBindsBrowserWithHostOnlySecureCookieAndNoStore() throws Exception {
        WeComOAuthService service = mock(WeComOAuthService.class);
        when(service.start("#/tasks?view=mine&taskId=10000000-0000-0000-0000-000000000001"))
                .thenReturn(new WeComOAuthService.Start(URI.create("https://open.weixin.qq.com/authorize"),
                        "browser-verifier", 600));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new WeComOAuthController(service)).build();

        mvc.perform(get("/api/v1/integrations/wecom/oauth/start")
                        .param("returnTo", "#/tasks?view=mine&taskId=10000000-0000-0000-0000-000000000001"))
                .andExpect(status().isFound())
                .andExpect(header().string("Cache-Control", "no-store, private"))
                .andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(header().string("Set-Cookie", containsString("__Host-wecom_oauth_verifier=browser-verifier")))
                .andExpect(header().string("Set-Cookie", containsString("Path=/")))
                .andExpect(header().string("Set-Cookie", containsString("Secure")))
                .andExpect(header().string("Set-Cookie", containsString("HttpOnly")))
                .andExpect(header().string("Set-Cookie", containsString("SameSite=Lax")));
    }

    @Test
    void callbackRequiresAndClearsTheBrowserVerifier() throws Exception {
        WeComOAuthService service = mock(WeComOAuthService.class);
        when(service.callback("provider-code", "state", "browser-verifier"))
                .thenReturn(URI.create("https://app.example.test/wecom-auth?exchange_code=once"));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new WeComOAuthController(service)).build();

        mvc.perform(get("/api/v1/integrations/wecom/oauth/callback")
                        .param("code", "provider-code").param("state", "state")
                        .cookie(new Cookie(WeComOAuthController.VERIFIER_COOKIE, "browser-verifier")))
                .andExpect(status().isFound())
                .andExpect(header().string("Set-Cookie", containsString("Max-Age=0")));
        verify(service).callback("provider-code", "state", "browser-verifier");

        mvc.perform(get("/api/v1/integrations/wecom/oauth/callback")
                        .param("code", "provider-code").param("state", "state"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("Set-Cookie", containsString("Max-Age=0")));
    }
}
