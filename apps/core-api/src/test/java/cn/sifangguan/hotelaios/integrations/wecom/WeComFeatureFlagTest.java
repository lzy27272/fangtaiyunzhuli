package cn.sifangguan.hotelaios.integrations.wecom;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class WeComFeatureFlagTest {
    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(WeComCallbackController.class, WeComOAuthController.class)
            .withBean(WeComCallbackService.class, () -> mock(WeComCallbackService.class))
            .withBean(WeComOAuthService.class, () -> mock(WeComOAuthService.class));

    @Test
    void endpointsDoNotExistByDefault() {
        contextRunner.run(context -> {
            assertThat(context).doesNotHaveBean(WeComCallbackController.class);
            assertThat(context).doesNotHaveBean(WeComOAuthController.class);
        });
    }

    @Test
    void endpointsExistOnlyWithTheirExplicitFlags() {
        contextRunner.withPropertyValues(
                "app.wecom.enabled=true",
                "app.security.local-login.enabled=true"
        ).run(context -> {
            assertThat(context).hasSingleBean(WeComCallbackController.class);
            assertThat(context).hasSingleBean(WeComOAuthController.class);
        });
    }
}
